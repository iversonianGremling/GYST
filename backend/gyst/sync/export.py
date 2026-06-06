"""Materialize GYST entities into per-project vault repos (Part I, Phase 1).

Read-only with respect to the database: we only SELECT rows and write files
under ``data/vault/``. Idempotent — managed paths (``_index.md``, ``notes/``,
``content/``) are rewritten each run so renames/deletes are reflected. Nothing
reads files back yet; that's Phase 3.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.core.models import Folder, Interest, Note, Project, Tag, Tagging
from gyst.sync import gitrepo, vault

log = logging.getLogger("gyst.sync.export")

# Top-level dirs within a repo that this exporter owns (cleared before rewrite).
_MANAGED = ("_index.md", "notes", "content")


async def _folders(session: AsyncSession) -> tuple[dict[str, str], dict[str, bool]]:
    """Returns ``(path_map, sync_map)``: folder_id -> slugified path, and
    folder_id -> sync_enabled."""
    folders = (await session.execute(select(Folder))).scalars().all()
    by_id = {f.id: f for f in folders}

    def path(fid: str | None) -> str:
        parts: list[str] = []
        seen: set[str] = set()
        while fid and fid in by_id and fid not in seen:
            seen.add(fid)
            f = by_id[fid]
            parts.append(vault.slugify(f.name))
            fid = f.parent_id
        return "/".join(reversed(parts))

    return ({f.id: path(f.id) for f in folders},
            {f.id: f.sync_enabled for f in folders})


async def _note_tags(session: AsyncSession) -> dict[str, list[str]]:
    """note_id -> sorted tag names."""
    rows = (await session.execute(
        select(Tagging.target_id, Tag.name)
        .join(Tag, Tag.id == Tagging.tag_id)
        .where(Tagging.target_type == "note")
    )).all()
    out: dict[str, list[str]] = {}
    for target_id, name in rows:
        out.setdefault(target_id, []).append(name)
    return {k: sorted(v) for k, v in out.items()}


def _reset_managed(repo_dir: Path) -> None:
    for name in _MANAGED:
        p = repo_dir / name
        if p.is_dir():
            shutil.rmtree(p)
        elif p.exists():
            p.unlink()


def _write(target: vault.RepoTarget, text: str) -> None:
    p = target.abspath
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


async def export_all(session: AsyncSession) -> dict:
    """Full materialization. Returns a summary dict."""
    interests = (await session.execute(select(Interest))).scalars().all()
    projects = {p.interest_id for p in (await session.execute(select(Project))).scalars().all()}
    project_settings = {
        p.interest_id: p for p in (await session.execute(select(Project))).scalars().all()
    }
    notes = (await session.execute(select(Note))).scalars().all()
    folder_path, folder_sync = await _folders(session)
    tags = await _note_tags(session)

    interest_by_id = {
        i.id: {"slug": i.slug, "is_project": i.id in projects, "kind": i.kind,
               "sync": i.sync_enabled}
        for i in interests
    }

    # Selection (docs/vault-sync.md §3): only sync-enabled interests materialize.
    enabled_interests = [i for i in interests if i.sync_enabled]

    def _note_synced(n: Note) -> bool:
        meta = interest_by_id.get(n.interest_id) if n.interest_id else None
        if meta and meta["sync"]:
            return True                       # belongs to a synced interest
        if not n.interest_id and n.folder_id and folder_sync.get(n.folder_id):
            return True                       # loose note in a synced folder
        return False

    synced_notes = [n for n in notes if _note_synced(n)]

    # Which repos will we touch? A repo per synced project; personal if it has
    # content interests or loose synced notes.
    repos: set[str] = set()
    for i in enabled_interests:
        if i.id in projects:
            repos.add(vault.project_repo(i.slug))
        else:
            repos.add(vault.PERSONAL_REPO)
    if any(not n.interest_id for n in synced_notes):
        repos.add(vault.PERSONAL_REPO)

    # Reset managed paths in every repo we're about to (re)write.
    for repo in repos:
        repo_dir = vault.VAULT_ROOT / repo
        repo_dir.mkdir(parents=True, exist_ok=True)
        _reset_managed(repo_dir)

    n_index = n_notes = 0

    # _index.md for each sync-enabled interest/project
    for i in enabled_interests:
        is_project = i.id in projects
        proj = project_settings.get(i.id)
        fm = vault.interest_frontmatter(
            gyst_id=i.id,
            kind="project" if is_project else "content",
            title=i.title,
            slug=i.slug,
            description=i.description,
            project_type=proj.type if proj else None,
            status=proj.status if proj else None,
            settings=proj.settings if proj else None,
            created_at=i.created_at,
            updated_at=i.updated_at,
        )
        body = i.description or ""
        target = vault.index_target(i.slug, is_project)
        _write(target, vault.dump(fm, body))
        n_index += 1

    # one file per synced note
    for n in synced_notes:
        meta = interest_by_id.get(n.interest_id) if n.interest_id else None
        fm = vault.note_frontmatter(
            gyst_id=n.id,
            title=n.title,
            slug=n.slug,
            interest_slug=meta["slug"] if meta else None,
            folder_path=folder_path.get(n.folder_id) if n.folder_id else None,
            tags=tags.get(n.id, []),
            pinned=n.pinned,
            created_at=n.created_at,
            updated_at=n.updated_at,
        )
        target = vault.note_target(
            n.slug,
            interest_slug=meta["slug"] if meta else None,
            interest_is_project=bool(meta and meta["is_project"]),
            folder_path=folder_path.get(n.folder_id) if n.folder_id else None,
        )
        _write(target, vault.dump(fm, n.body_md))
        n_notes += 1

    # init + commit each repo
    commits: dict[str, str | None] = {}
    for repo in sorted(repos):
        repo_dir = vault.VAULT_ROOT / repo
        # Skip an empty personal repo (no content interests, no loose notes)
        if repo == vault.PERSONAL_REPO and not any(
            (repo_dir / d).exists() for d in ("notes", "content")
        ):
            continue
        gitrepo.init(repo_dir)
        sha = gitrepo.commit_all(repo_dir, "gyst: vault export")
        commits[repo] = sha

    summary = {
        "repos": sorted(commits),
        "interests": n_index,
        "notes": n_notes,
        "commits": commits,
    }
    log.info("vault export: %s", summary)
    return summary

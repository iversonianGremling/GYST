"""Import vault repo files back into the DB (Part I, Phase 3 — inbound).

Reconciles Markdown files to ``Note`` rows keyed on the frontmatter ``gyst_id``.
``last_synced_hash`` is the origin-tag: a file whose hash equals the note's
``last_synced_hash`` is GYST's own last write, so it's skipped — this is what
prevents the DB→file→import→DB loop (docs/vault-sync.md §4.1).

Scope of this phase: create + update of note title/body/slug (the headline
"edit on desktop → see it in GYST" case). Deletes, folder moves and tag edits
round-trip in a later pass; true 3-way conflict handling is Phase 4. Inbound
changes win here (last-writer), and the note is left ``clean`` after import.
"""
from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.core.models import Interest, Note
from gyst.sync import vault

log = logging.getLogger("gyst.sync.importer")


def _iter_md(repo_dir: Path):
    for p in sorted(repo_dir.rglob("*.md")):
        if ".git" in p.parts:
            continue
        yield p


async def _resolve_interest_id(
    session: AsyncSession, *, fm_interest: str | None, repo_slug: str,
) -> str | None:
    """Best-effort: a note's interest is the frontmatter ``interest`` slug, or
    (for a project repo) the repo's own slug."""
    slug = fm_interest or repo_slug
    if not slug or slug == vault.PERSONAL_REPO:
        return None
    row = await session.execute(select(Interest).where(Interest.slug == slug))
    i = row.scalar_one_or_none()
    return i.id if i else None


async def import_repo(session: AsyncSession, repo_dir: Path, *, repo_slug: str) -> dict:
    """Apply on-disk changes in one repo to the DB. Returns a counts summary."""
    created = updated = skipped = conflicted = 0

    for path in _iter_md(repo_dir):
        text = path.read_text(encoding="utf-8")
        fm, body = vault.parse(text)
        if fm.get("type") in ("project", "content"):
            continue  # _index.md (interest/project) round-trip deferred
        h = vault.content_hash(text)
        gid = fm.get("gyst_id")
        title = fm.get("title") or "Untitled"
        slug = fm.get("slug") or vault.slugify(title)

        note = await session.get(Note, gid) if gid else None

        if note is None:
            interest_id = await _resolve_interest_id(
                session, fm_interest=fm.get("interest"), repo_slug=repo_slug,
            )
            note = Note(
                title=title, slug=slug, body_md=body, interest_id=interest_id,
                last_synced_hash=h, sync_status="clean",
            )
            if gid:
                note.id = gid  # preserve desktop-known identity
            session.add(note)
            created += 1
            continue

        if note.last_synced_hash == h:
            skipped += 1   # GYST's own last write — not a desktop edit
            continue

        # Both sides changed since last sync → don't clobber the GYST edit.
        # Park it as a conflict for the Phase 4 resolver (export skips conflicted
        # notes, so neither version is lost).
        if note.sync_status == "dirty":
            note.sync_status = "conflicted"
            conflicted += 1
            continue

        # File changed on the desktop side, GYST side clean → apply.
        note.title = title
        note.slug = slug
        note.body_md = body
        note.last_synced_hash = h
        note.sync_status = "clean"
        updated += 1

    if created or updated or conflicted:
        await session.commit()
    summary = {"repo": repo_slug, "created": created, "updated": updated,
               "skipped": skipped, "conflicted": conflicted}
    if created or updated or conflicted:
        log.info("vault import: %s", summary)
    return summary

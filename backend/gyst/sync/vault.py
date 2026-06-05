"""Vault serialization & path mapping (Part I, Phase 1).

Pure logic — no DB, no I/O beyond hashing strings. Turns GYST entities into
canonical Markdown-with-frontmatter and maps them to paths inside per-project
git repos under ``data/vault/``. See docs/vault-sync.md §3.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import yaml

from gyst.config import settings

# ── Locations ────────────────────────────────────────────────────────────────

VAULT_ROOT = settings.data.root / "vault"
PERSONAL_REPO = "personal"  # repo for content interests + loose notes


def slugify(text: str) -> str:
    """Mirror of notes._slugify — kept local so sync has no API dependency."""
    s = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[\s_-]+", "-", s).strip("-") or "untitled"


# ── Frontmatter (de)serialization ────────────────────────────────────────────

# A YAML dumper that emits deterministic, human-friendly frontmatter: keys in
# insertion order (we control the order), block style, unicode preserved.
class _VaultDumper(yaml.SafeDumper):
    pass


_VaultDumper.add_representer(
    str,
    lambda d, data: d.represent_scalar(
        "tag:yaml.org,2002:str", data,
        style="|" if "\n" in data else None,
    ),
)


def _iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, datetime) else v


def dump(frontmatter: dict[str, Any], body_md: str) -> str:
    """Serialize to canonical ``---\\nyaml\\n---\\n\\nbody`` form.

    Canonical = LF line endings, exactly one trailing newline, frontmatter keys
    in the given (caller-controlled) order. Drops ``None`` values so optional
    fields don't litter the file.
    """
    clean = {k: _iso(v) for k, v in frontmatter.items() if v is not None}
    fm = yaml.dump(
        clean, Dumper=_VaultDumper,
        sort_keys=False, allow_unicode=True, default_flow_style=False,
    ).strip("\n")
    body = body_md.replace("\r\n", "\n").rstrip("\n")
    return f"---\n{fm}\n---\n\n{body}\n"


_FM_RE = re.compile(r"\A---\n(.*?)\n---\n?", re.DOTALL)


def parse(text: str) -> tuple[dict[str, Any], str]:
    """Inverse of :func:`dump`. Returns ``(frontmatter, body_md)``.

    Tolerates files without frontmatter (returns ``({}, text)``) so
    desktop-created notes don't crash the importer (Phase 3).
    """
    text = text.replace("\r\n", "\n")
    m = _FM_RE.match(text)
    if not m:
        return {}, text.strip("\n")
    fm = yaml.safe_load(m.group(1)) or {}
    body = text[m.end():].strip("\n")
    return fm, body


def content_hash(text: str) -> str:
    """sha256 of the canonical file bytes — the sync-state change key (§4.1)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ── Path mapping ─────────────────────────────────────────────────────────────


@dataclass
class RepoTarget:
    """Where an entity's file lives: which repo, and the path within it."""
    repo: str                 # repo dir name under VAULT_ROOT (project slug | "personal")
    relpath: str              # POSIX path within the repo

    @property
    def repo_dir(self):
        return VAULT_ROOT / self.repo

    @property
    def abspath(self):
        return self.repo_dir / self.relpath


def project_repo(interest_slug: str) -> str:
    """A project interest gets its own repo named after its slug."""
    return interest_slug


def index_target(interest_slug: str, is_project: bool) -> RepoTarget:
    """`_index.md` for an Interest/Project."""
    if is_project:
        return RepoTarget(project_repo(interest_slug), "_index.md")
    return RepoTarget(PERSONAL_REPO, f"content/{interest_slug}/_index.md")


def note_target(
    note_slug: str,
    *,
    interest_slug: str | None,
    interest_is_project: bool,
    folder_path: str | None,
) -> RepoTarget:
    """Map a Note to its file. Notes of a project live in that project's repo
    under ``notes/``; everything else lands in the ``personal`` repo. The
    folder hierarchy becomes nested directories within the repo."""
    sub = f"{folder_path}/" if folder_path else ""
    fname = f"{note_slug}.md"
    if interest_slug and interest_is_project:
        return RepoTarget(project_repo(interest_slug), f"notes/{sub}{fname}")
    return RepoTarget(PERSONAL_REPO, f"notes/{sub}{fname}")


# ── Frontmatter builders (canonical key order lives here) ────────────────────


def note_frontmatter(
    *,
    gyst_id: str,
    title: str,
    slug: str,
    interest_slug: str | None,
    folder_path: str | None,
    tags: list[str],
    pinned: bool,
    created_at: Any,
    updated_at: Any,
) -> dict[str, Any]:
    return {
        "gyst_id": gyst_id,
        "type": "note",
        "title": title,
        "slug": slug,
        "interest": interest_slug,
        "folder": folder_path,
        "tags": tags or None,
        "pinned": True if pinned else None,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def interest_frontmatter(
    *,
    gyst_id: str,
    kind: str,                       # "content" | "project"
    title: str,
    slug: str,
    description: str | None,
    project_type: str | None = None,
    status: str | None = None,
    settings: dict[str, Any] | None = None,
    created_at: Any,
    updated_at: Any,
) -> dict[str, Any]:
    return {
        "gyst_id": gyst_id,
        "type": kind,
        "title": title,
        "slug": slug,
        "description": description,
        "project_type": project_type,
        "status": status,
        "settings": settings or None,
        "created_at": created_at,
        "updated_at": updated_at,
    }

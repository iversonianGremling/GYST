"""Minimal git wrapper over the ``git`` CLI (no gitpython dependency).

Phase 1 only needs local init + commit; Phase 2 extends this with remotes,
push/pull and LFS. Each project is its own repo (docs/vault-sync.md §3/§5).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

_AUTHOR_NAME = "GYST"
_AUTHOR_EMAIL = "gyst@local"

# git env that pins identity (the gyst service user has no global git config)
_ENV = {
    "GIT_AUTHOR_NAME": _AUTHOR_NAME,
    "GIT_AUTHOR_EMAIL": _AUTHOR_EMAIL,
    "GIT_COMMITTER_NAME": _AUTHOR_NAME,
    "GIT_COMMITTER_EMAIL": _AUTHOR_EMAIL,
    "GIT_TERMINAL_PROMPT": "0",
}


def _run(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    import os
    env = {**os.environ, **_ENV}
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=check, env=env,
    )


def is_repo(repo: Path) -> bool:
    return (repo / ".git").is_dir()


def init(repo: Path) -> None:
    repo.mkdir(parents=True, exist_ok=True)
    if not is_repo(repo):
        _run(repo, "init", "-q", "-b", "main")


def has_changes(repo: Path) -> bool:
    return bool(_run(repo, "status", "--porcelain").stdout.strip())


def commit_all(repo: Path, message: str) -> str | None:
    """Stage everything and commit. Returns the commit sha, or None if nothing
    changed."""
    _run(repo, "add", "-A")
    if not _run(repo, "diff", "--cached", "--quiet", check=False).returncode:
        return None  # nothing staged
    _run(repo, "commit", "-q", "-m", message)
    return _run(repo, "rev-parse", "HEAD").stdout.strip()


def head(repo: Path) -> str | None:
    r = _run(repo, "rev-parse", "HEAD", check=False)
    return r.stdout.strip() if r.returncode == 0 else None

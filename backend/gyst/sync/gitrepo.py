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


# ── Remotes / push / pull ────────────────────────────────────────────────────
#
# Auth is injected per-call as an HTTP Authorization header via `-c
# http.extraheader=...`, so the token is never persisted in `.git/config` or the
# remote URL on disk (docs/vault-sync.md §4.3).

def _auth_args(token: str | None) -> list[str]:
    return ["-c", f"http.extraheader=Authorization: token {token}"] if token else []


def set_remote(repo: Path, url: str, name: str = "origin") -> None:
    existing = _run(repo, "remote", check=False).stdout.split()
    if name in existing:
        _run(repo, "remote", "set-url", name, url)
    else:
        _run(repo, "remote", "add", name, url)


def push(repo: Path, url: str, *, token: str | None = None,
         branch: str = "main", name: str = "origin") -> None:
    set_remote(repo, url, name)
    _run(repo, *_auth_args(token), "push", "-u", name, f"HEAD:refs/heads/{branch}")


def pull(repo: Path, url: str, *, token: str | None = None,
         branch: str = "main", name: str = "origin") -> subprocess.CompletedProcess:
    set_remote(repo, url, name)
    # --no-edit keeps merges non-interactive; caller inspects returncode for conflicts.
    return _run(repo, *_auth_args(token), "pull", "--no-edit", name, branch, check=False)


def setup_lfs(repo: Path, patterns: tuple[str, ...] = ("media/**",)) -> None:
    """Track media via git-lfs. No-op-safe if git-lfs isn't installed (returns
    without raising so non-media repos keep working)."""
    if _run(repo, "lfs", "version", check=False).returncode != 0:
        return
    _run(repo, "lfs", "install", "--local")
    for p in patterns:
        _run(repo, "lfs", "track", p)

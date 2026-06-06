"""Gitea API client — auto-create a per-project repo and hand back its push URL.

Auth uses a single admin/API token from gyst.toml ``[gitea] token``. The token
is **never written to the repo on disk**: push auth is injected at call time via
an HTTP Authorization header (see gitrepo.push), not embedded in the remote URL.
"""
from __future__ import annotations

import logging

import httpx

from gyst.config import settings

log = logging.getLogger("gyst.sync.gitea")


class GiteaError(RuntimeError):
    pass


def _cfg() -> dict:
    return getattr(settings, "gitea", None) or {}


def enabled() -> bool:
    c = _cfg()
    return bool(c.get("url") and c.get("token"))


def _client() -> httpx.Client:
    c = _cfg()
    return httpx.Client(
        base_url=c["url"].rstrip("/"),
        headers={"Authorization": f"token {c['token']}", "Accept": "application/json"},
        timeout=15.0,
    )


def _owner() -> str:
    return _cfg().get("org", "gyst")


def remote_url(slug: str) -> str:
    """Token-free HTTP clone/push URL for a project repo."""
    base = _cfg()["url"].rstrip("/")
    return f"{base}/{_owner()}/{slug}.git"


def ensure_repo(slug: str, *, description: str = "") -> str:
    """Create ``<org>/<slug>`` if it doesn't exist; return its push URL.

    Creates the owning org on first use. Idempotent.
    """
    owner = _owner()
    with _client() as cli:
        r = cli.get(f"/api/v1/repos/{owner}/{slug}")
        if r.status_code == 200:
            return remote_url(slug)
        if r.status_code not in (404,):
            raise GiteaError(f"repo lookup failed: {r.status_code} {r.text}")

        # Ensure the org exists (admin token can create orgs).
        org = cli.get(f"/api/v1/orgs/{owner}")
        if org.status_code == 404:
            oc = cli.post("/api/v1/orgs", json={"username": owner})
            if oc.status_code not in (201, 422):  # 422 = already exists (race)
                raise GiteaError(f"org create failed: {oc.status_code} {oc.text}")

        cr = cli.post(
            f"/api/v1/orgs/{owner}/repos",
            json={
                "name": slug,
                "description": description[:255],
                "private": True,
                "auto_init": False,
                "default_branch": "main",
            },
        )
        if cr.status_code not in (201,):
            raise GiteaError(f"repo create failed: {cr.status_code} {cr.text}")
        log.info("created Gitea repo %s/%s", owner, slug)
        return remote_url(slug)

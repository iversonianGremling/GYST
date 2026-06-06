"""Sync orchestration (Part I, Phase 2): export → commit → push to Gitea.

Phase 2 is push-only (GYST → Gitea). Phase 3 adds the inbound watcher/import,
Phase 4 the conflict resolver. Designed to be called both from the scheduler
(periodic) and on demand.
"""
from __future__ import annotations

import asyncio
import logging

from gyst.config import settings
from gyst.db import SessionLocal
from gyst.sync import export, gitea, gitrepo, vault

log = logging.getLogger("gyst.sync.service")

# Serialize sync runs so a periodic tick and a manual trigger can't race on the
# same working trees.
_lock = asyncio.Lock()


async def sync_all() -> dict:
    """Materialize sync-enabled entities, commit each repo, and push to Gitea."""
    async with _lock:
        async with SessionLocal() as session:
            summary = await export.export_all(session)

        pushed: dict[str, str] = {}
        if gitea.enabled():
            token = settings.gitea.get("token")
            for repo in summary["repos"]:
                repo_dir = vault.VAULT_ROOT / repo
                try:
                    url = gitea.ensure_repo(repo, description=f"GYST vault: {repo}")
                    gitrepo.push(repo_dir, url, token=token, branch="main")
                    pushed[repo] = "ok"
                except Exception as e:  # network/auth failures are non-fatal
                    log.error("push %s failed: %s", repo, e)
                    pushed[repo] = f"error: {e}"
        else:
            log.info("Gitea not configured; export-only (no push)")

        summary["pushed"] = pushed
        return summary

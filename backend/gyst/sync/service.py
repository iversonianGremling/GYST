"""Sync orchestration (Part I): inbound import + outbound push.

One ``sync_all()`` cycle, lock-serialized:

  1. inbound  — pull each existing repo from Gitea, import file changes to the DB
                (only when ``[gitea] import_enabled`` is true; Phase 3)
  2. outbound — export DB → files, commit each repo
  3. push     — push each repo to Gitea

Inbound is gated by a default-off flag so the round-trip can be enabled only
after testing. Phase 4 replaces the "file wins / pull-merge" handling with true
3-way conflict detection + the in-app resolver.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from gyst.config import settings
from gyst.db import SessionLocal
from gyst.sync import export, gitea, gitrepo, importer, vault

log = logging.getLogger("gyst.sync.service")

# Serialize sync runs so a periodic tick and a manual trigger can't race.
_lock = asyncio.Lock()


def _existing_repos() -> list[Path]:
    root = vault.VAULT_ROOT
    if not root.exists():
        return []
    return [d for d in sorted(root.iterdir()) if (d / ".git").is_dir()]


def _import_enabled() -> bool:
    return bool((settings.gitea or {}).get("import_enabled"))


async def sync_all() -> dict:
    async with _lock:
        token = settings.gitea.get("token") if gitea.enabled() else None
        pulled: dict[str, str] = {}
        imported: dict[str, dict] = {}

        async with SessionLocal() as session:
            # 1. inbound: pull + import (desktop → Gitea → DB)
            if _import_enabled() and gitea.enabled():
                synced = await export.synced_repo_slugs(session)
                for repo_dir in _existing_repos():
                    slug = repo_dir.name
                    if slug not in synced:
                        continue  # stale/unselected repo on disk — don't import
                    try:
                        url = gitea.ensure_repo(slug)
                        res = gitrepo.pull(repo_dir, url, token=token, branch="main")
                        if res.returncode != 0:
                            # divergent histories / merge conflict — leave for Phase 4
                            pulled[slug] = "conflict-skip"
                            log.warning("pull %s needs manual merge:\n%s", slug, res.stderr[-400:])
                            continue
                        pulled[slug] = "ok"
                        imported[slug] = await importer.import_repo(
                            session, repo_dir, repo_slug=slug,
                        )
                    except Exception as e:
                        log.error("pull/import %s failed: %s", slug, e)
                        pulled[slug] = f"error: {e}"

            # 2. outbound: export DB → files + commit
            summary = await export.export_all(session)

        # 3. push
        pushed: dict[str, str] = {}
        if gitea.enabled():
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

        summary["pulled"] = pulled
        summary["imported"] = imported
        summary["pushed"] = pushed
        return summary

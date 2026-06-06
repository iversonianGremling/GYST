"""Background scheduler — runs feed.fetch and other periodic tasks."""
from __future__ import annotations

import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from gyst.config import settings

log = logging.getLogger("gyst.scheduler")

_scheduler: AsyncIOScheduler | None = None


async def _run_feed_fetch() -> None:
    from gyst.core.feed import run_fetch
    try:
        n = await run_fetch()
        if n:
            log.info("Scheduler: fetched %d new feed items", n)
    except Exception as e:
        log.error("Scheduler feed.fetch error: %s", e)


async def _run_vault_sync() -> None:
    from gyst.sync.service import sync_all
    try:
        s = await sync_all()
        if any(v for v in s.get("commits", {}).values()):
            log.info("Scheduler: vault sync %s", s.get("pushed"))
    except Exception as e:
        log.error("Scheduler vault sync error: %s", e)


def start() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler and _scheduler.running:
        return _scheduler

    _scheduler = AsyncIOScheduler()

    interval_minutes = getattr(settings, "feed", None)
    # Default to 30 min; allow override via settings if present
    minutes = 30
    try:
        minutes = int(settings.feed.fetch_interval_minutes)  # type: ignore[attr-defined]
    except AttributeError:
        pass

    _scheduler.add_job(
        _run_feed_fetch,
        trigger=IntervalTrigger(minutes=minutes),
        id="feed_fetch",
        replace_existing=True,
        misfire_grace_time=60,
    )

    # Vault sync (push GYST -> Gitea). Cheap no-op when nothing is sync-enabled.
    sync_minutes = int((settings.gitea or {}).get("sync_interval_minutes", 5))
    _scheduler.add_job(
        _run_vault_sync,
        trigger=IntervalTrigger(minutes=sync_minutes),
        id="vault_sync",
        replace_existing=True,
        misfire_grace_time=60,
    )

    _scheduler.start()
    log.info("Scheduler started (feed.fetch every %d min, vault_sync every %d min)",
             minutes, sync_minutes)
    return _scheduler


def stop() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        _scheduler = None

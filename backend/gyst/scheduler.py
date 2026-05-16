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

    _scheduler.start()
    log.info("Scheduler started (feed.fetch every %d min)", minutes)
    return _scheduler


def stop() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        _scheduler = None

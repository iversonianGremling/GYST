"""Feed ingest pipeline — calls feed.fetch hooks and upserts results."""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.core.models import FeedItem
from gyst.db import SessionLocal
from gyst.plugins import loader as plugin_loader
from gyst.plugins.api import PluginContext

log = logging.getLogger("gyst.feed")


async def run_fetch() -> int:
    """Run all feed.fetch hooks and upsert results. Returns number of new items."""
    async with SessionLocal() as session:
        ctx = PluginContext(session)
        results: list[list[dict[str, Any]]] = await plugin_loader.call_hook("feed.fetch", ctx)

        new_count = 0
        for batch in results:
            if not batch:
                continue
            for draft in batch:
                count = await _upsert_item(session, draft)
                new_count += count

        await session.commit()
        log.info("Feed fetch complete: %d new items", new_count)
        return new_count


async def _upsert_item(session: AsyncSession, draft: dict[str, Any]) -> int:
    source_plugin = draft.get("source_plugin", "unknown")
    external_id = draft.get("external_id")

    if external_id:
        existing = await session.execute(
            select(FeedItem).where(
                FeedItem.source_plugin == source_plugin,
                FeedItem.external_id == external_id,
            )
        )
        if existing.scalar_one_or_none():
            return 0  # already have it

    item = FeedItem(
        interest_id=draft.get("interest_id"),
        source_plugin=source_plugin,
        external_id=external_id,
        title=draft.get("title", "(untitled)"),
        url=draft.get("url"),
        payload=draft.get("payload", {}),
        fetched_at=datetime.now(UTC),
        score=float(draft.get("score", 0.5)),
        score_breakdown=draft.get("score_breakdown", {}),
    )
    session.add(item)
    return 1

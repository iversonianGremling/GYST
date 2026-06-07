"""Feed ingest pipeline — calls feed.fetch hooks and upserts results.

Each plugin that declares the ``feed.fetch`` hook gets its OWN
:class:`PluginContext` (plugin_id + per-plugin PluginSetting map + its fs dir),
matching the constructor in ``gyst.plugins.api``. (Previously this built a
single mis-shaped ``PluginContext(session)`` which raised ``TypeError`` every
tick — so no feed plugin ever actually fetched.)
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.config import settings
from gyst.core.models import Event, FeedItem, PluginSetting
from gyst.db import SessionLocal
from gyst.plugins import loader as plugin_loader
from gyst.plugins.api import PluginContext

log = logging.getLogger("gyst.feed")


async def _settings_map(session: AsyncSession, plugin_id: str) -> dict[str, Any]:
    rows = await session.execute(
        select(PluginSetting).where(PluginSetting.plugin_id == plugin_id)
    )
    return {s.key: s.value for s in rows.scalars()}


async def run_fetch() -> int:
    """Run all feed.fetch hooks and upsert results. Returns number of new items."""
    async with SessionLocal() as session:
        new_count = 0
        for plugin in plugin_loader.get_all():
            if not plugin.has_hook("feed.fetch"):
                continue
            smap = await _settings_map(session, plugin.id)
            ctx = PluginContext(plugin.id, session, settings.data.root, smap)
            try:
                batch: list[dict[str, Any]] = await plugin.call_hook("feed.fetch", ctx)
            except Exception as e:  # noqa: BLE001 — one bad plugin must not kill the run
                log.error("Plugin %s feed.fetch failed: %s", plugin.id, e)
                continue
            finally:
                await ctx.close()
            for draft in batch or []:
                new_count += await _upsert_item(session, draft)

        await session.commit()
        log.info("Feed fetch complete: %d new items", new_count)
        return new_count


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


async def _maybe_create_event(session: AsyncSession, draft: dict[str, Any]) -> None:
    """Create a calendar Event from a draft's `event` block when requested."""
    if not draft.get("create_event"):
        return
    ev = draft.get("event") or {}
    starts_at = _parse_dt(ev.get("starts_at"))
    if starts_at is None:
        return
    title = ev.get("title") or draft.get("title", "(untitled)")
    # Dedup by (title, starts_at): the same real event may arrive from several
    # connectors under different external_ids.
    dupe = await session.execute(
        select(Event).where(Event.title == title, Event.starts_at == starts_at)
    )
    if dupe.scalar_one_or_none():
        return
    session.add(Event(
        interest_id=draft.get("interest_id"),
        title=title,
        starts_at=starts_at,
        ends_at=_parse_dt(ev.get("ends_at")),
        body_md=ev.get("body_md", ""),
    ))


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
    await _maybe_create_event(session, draft)
    return 1

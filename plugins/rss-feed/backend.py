"""RSS / Atom feed plugin — per-interest feed subscriptions."""
from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import PluginSetting
from gyst.db import get_session

PLUGIN_ID = "rss-feed"
_ATOM = "http://www.w3.org/2005/Atom"
_SETTING_KEY = "feeds"

# Storage format: list of {"url": str, "interest_id": str | null}
# interest_id=null means a global feed (not tied to any interest).


async def _get_all_entries(session: AsyncSession) -> list[dict[str, Any]]:
    row = await session.execute(
        select(PluginSetting).where(
            PluginSetting.plugin_id == PLUGIN_ID,
            PluginSetting.key == _SETTING_KEY,
        )
    )
    setting = row.scalar_one_or_none()
    if not setting or not isinstance(setting.value, list):
        return []
    return setting.value  # type: ignore[return-value]


async def _save_entries(entries: list[dict[str, Any]], session: AsyncSession) -> None:
    row = await session.execute(
        select(PluginSetting).where(
            PluginSetting.plugin_id == PLUGIN_ID,
            PluginSetting.key == _SETTING_KEY,
        )
    )
    setting = row.scalar_one_or_none()
    if setting:
        setting.value = entries
    else:
        session.add(PluginSetting(plugin_id=PLUGIN_ID, key=_SETTING_KEY, value=entries))
    await session.commit()


# ── RSS / Atom parser ─────────────────────────────────────────────────────────

def _parse_feed(text: str, source_url: str, interest_id: str | None) -> list[dict[str, Any]]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []

    tag = root.tag.lower()
    items: list[dict[str, Any]] = []

    if "rss" in tag or root.find("channel") is not None:
        channel = root.find("channel") or root
        for item in channel.findall("item"):
            title = (item.findtext("title") or "").strip()
            link  = (item.findtext("link") or "").strip()
            desc  = (item.findtext("description") or "").strip()
            pub   = (item.findtext("pubDate") or "").strip()
            guid  = (item.findtext("guid") or link).strip()
            if title and link:
                items.append({
                    "source_plugin": PLUGIN_ID,
                    "external_id": hashlib.sha1(guid.encode()).hexdigest()[:16],
                    "title": title,
                    "url": link,
                    "interest_id": interest_id,
                    "payload": {"description": desc[:500], "pub_date": pub, "feed_url": source_url},
                    "score": 0.5,
                    "score_breakdown": {"source": "rss"},
                })

    elif "feed" in tag or f"{{{_ATOM}}}feed" == root.tag:
        for entry in root.findall(f"{{{_ATOM}}}entry"):
            title   = (entry.findtext(f"{{{_ATOM}}}title") or "").strip()
            link_el = entry.find(f"{{{_ATOM}}}link")
            link    = (link_el.get("href") if link_el is not None else "") or ""
            id_el   = entry.findtext(f"{{{_ATOM}}}id") or link
            summary = (entry.findtext(f"{{{_ATOM}}}summary") or "").strip()
            updated = (entry.findtext(f"{{{_ATOM}}}updated") or "").strip()
            if title and link:
                items.append({
                    "source_plugin": PLUGIN_ID,
                    "external_id": hashlib.sha1(id_el.encode()).hexdigest()[:16],
                    "title": title,
                    "url": link,
                    "interest_id": interest_id,
                    "payload": {"description": summary[:500], "pub_date": updated, "feed_url": source_url},
                    "score": 0.5,
                    "score_breakdown": {"source": "rss"},
                })

    return items


# ── Hook ──────────────────────────────────────────────────────────────────────

async def feed_fetch(ctx: Any) -> list[dict[str, Any]]:
    entries = await _get_all_entries(ctx.db)
    if not entries:
        return []

    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        for entry in entries:
            url         = entry.get("url", "")
            interest_id = entry.get("interest_id")
            if not url:
                continue
            try:
                resp = await client.get(url, headers={"User-Agent": "GYST/0.1 feed reader"})
                resp.raise_for_status()
                results.extend(_parse_feed(resp.text, url, interest_id))
            except Exception as e:
                ctx.log.warning("RSS fetch failed for %s: %s", url, e)

    return results


# ── Routes ────────────────────────────────────────────────────────────────────

def register_routes(router: APIRouter) -> None:

    @router.get("/feeds")
    async def list_feeds(
        interest_id: str | None = Query(None),
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        entries = await _get_all_entries(session)
        if interest_id is not None:
            entries = [e for e in entries if e.get("interest_id") == interest_id]
        return {"feeds": entries}

    @router.post("/feeds")
    async def add_feed(
        body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        url         = (body.get("url") or "").strip()
        interest_id = body.get("interest_id")  # str or None
        if not url:
            return {"error": "url required"}
        entries = await _get_all_entries(session)
        # Deduplicate on (url, interest_id) pair
        exists = any(e.get("url") == url and e.get("interest_id") == interest_id for e in entries)
        if not exists:
            entries.append({"url": url, "interest_id": interest_id})
            await _save_entries(entries, session)
        return {"feeds": entries}

    @router.delete("/feeds")
    async def remove_feed(
        body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        url         = (body.get("url") or "").strip()
        interest_id = body.get("interest_id")
        entries     = await _get_all_entries(session)
        entries     = [e for e in entries if not (e.get("url") == url and e.get("interest_id") == interest_id)]
        await _save_entries(entries, session)
        return {"feeds": entries}

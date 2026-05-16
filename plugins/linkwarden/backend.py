"""Linkwarden bookmark manager integration plugin.

Fetches bookmarks from a Linkwarden instance and surfaces them as feed items.
Collections in Linkwarden are optionally matched to GYST interests by name.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import Interest, PluginSetting
from gyst.db import get_session

PLUGIN_ID = "linkwarden"
log = logging.getLogger(f"gyst.plugin.{PLUGIN_ID}")


# ── Settings storage ──────────────────────────────────────────────────────────

async def _get_config(session: AsyncSession) -> dict[str, str]:
    rows = await session.execute(
        select(PluginSetting).where(PluginSetting.plugin_id == PLUGIN_ID)
    )
    return {r.key: r.value for r in rows.scalars().all()}  # type: ignore[union-attr]


async def _set_config(key: str, value: str, session: AsyncSession) -> None:
    row = await session.execute(
        select(PluginSetting).where(
            PluginSetting.plugin_id == PLUGIN_ID, PluginSetting.key == key
        )
    )
    setting = row.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        session.add(PluginSetting(plugin_id=PLUGIN_ID, key=key, value=value))
    await session.commit()


# ── Linkwarden API helpers ────────────────────────────────────────────────────

def _make_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}


async def _fetch_links(base_url: str, api_key: str) -> list[dict[str, Any]]:
    """Fetch all bookmarks, following cursor-based pagination."""
    headers = _make_headers(api_key)
    links: list[dict[str, Any]] = []
    cursor: int | None = None

    async with httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=20, follow_redirects=True) as client:
        while True:
            params: dict[str, Any] = {"limit": 50}
            if cursor is not None:
                params["cursor"] = cursor
            resp = await client.get("/api/v1/links", headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
            batch = data.get("response", [])
            if not batch:
                break
            links.extend(batch)
            # Linkwarden paginates by returning the last item's id as next cursor
            if len(batch) < 50:
                break
            cursor = batch[-1]["id"]

    return links


async def _fetch_collections(base_url: str, api_key: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=10, follow_redirects=True) as client:
        resp = await client.get("/api/v1/collections", headers=_make_headers(api_key))
        if resp.status_code == 200:
            return resp.json().get("response", [])
    return []


# ── Hook ──────────────────────────────────────────────────────────────────────

async def feed_fetch(ctx: Any) -> list[dict[str, Any]]:
    config = await _get_config(ctx.db)
    base_url = config.get("base_url", "").strip()
    api_key  = config.get("api_key", "").strip()

    if not base_url or not api_key:
        return []

    try:
        links       = await _fetch_links(base_url, api_key)
        collections = await _fetch_collections(base_url, api_key)
    except Exception as e:
        ctx.log.warning("Linkwarden fetch failed: %s", e)
        return []

    # Build collection_id → GYST interest_id map by matching name (case-insensitive)
    col_name_to_id: dict[str, str] = {c["name"].lower(): str(c["id"]) for c in collections}

    # Load interests from DB to match by title
    interests_rows = await ctx.db.execute(select(Interest))
    interest_map: dict[str, str] = {
        i.title.lower(): str(i.id) for i in interests_rows.scalars().all()
    }

    # collection_id → GYST interest_id
    col_to_interest: dict[int, str | None] = {}
    for col in collections:
        col_name = col["name"].lower()
        col_to_interest[col["id"]] = interest_map.get(col_name)

    results: list[dict[str, Any]] = []
    for link in links:
        url   = link.get("url", "").strip()
        title = (link.get("name") or link.get("url") or "").strip()
        if not url:
            continue

        uid  = str(link.get("id", ""))
        ext_id = hashlib.sha1(f"linkwarden:{uid}".encode()).hexdigest()[:16]

        col_id      = link.get("collectionId")
        interest_id = col_to_interest.get(col_id) if col_id else None

        tags = [t["name"] for t in link.get("tags", []) if isinstance(t, dict)]

        results.append({
            "source_plugin": PLUGIN_ID,
            "external_id": ext_id,
            "title": title or url,
            "url": url,
            "interest_id": interest_id,
            "payload": {
                "description": link.get("description") or "",
                "tags": tags,
                "collection": link.get("collection", {}).get("name") if link.get("collection") else None,
                "created_at": link.get("createdAt"),
                "linkwarden_id": uid,
            },
            "score": 0.6,
            "score_breakdown": {"source": "linkwarden"},
        })

    ctx.log.info("Linkwarden: imported %d bookmarks", len(results))
    return results


# ── Routes ────────────────────────────────────────────────────────────────────

def register_routes(router: APIRouter) -> None:

    @router.get("/settings")
    async def get_settings(
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        config = await _get_config(session)
        return {
            "base_url": config.get("base_url", ""),
            "api_key":  config.get("api_key", ""),
            "configured": bool(config.get("base_url") and config.get("api_key")),
        }

    @router.put("/settings")
    async def save_settings(
        body: dict[str, str],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        for key in ("base_url", "api_key"):
            if key in body:
                await _set_config(key, body[key].strip(), session)
        return {"ok": True}

    @router.post("/test")
    async def test_connection(
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        config = await _get_config(session)
        base_url = config.get("base_url", "").strip()
        api_key  = config.get("api_key", "").strip()
        if not base_url or not api_key:
            return {"ok": False, "error": "Not configured"}
        try:
            async with httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=8) as client:
                resp = await client.get("/api/v1/users/me", headers=_make_headers(api_key))
                resp.raise_for_status()
                data = resp.json()
                name = data.get("response", {}).get("name") or data.get("name") or "unknown"
            return {"ok": True, "user": name}
        except Exception as e:
            return {"ok": False, "error": str(e)}

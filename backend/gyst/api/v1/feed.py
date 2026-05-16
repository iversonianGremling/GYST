from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.feed import run_fetch
from gyst.core.models import FeedItem
from gyst.db import get_session

router = APIRouter(prefix="/feed", tags=["feed"])


def _out(f: FeedItem) -> dict[str, Any]:
    return {
        "id": f.id,
        "interest_id": f.interest_id,
        "source_plugin": f.source_plugin,
        "title": f.title,
        "url": f.url,
        "payload": f.payload,
        "fetched_at": f.fetched_at.isoformat(),
        "seen_at": f.seen_at.isoformat() if f.seen_at else None,
        "score": f.score,
        "score_breakdown": f.score_breakdown,
    }


@router.get("")
async def list_feed(
    unseen_only: bool = True,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    q = select(FeedItem)
    if unseen_only:
        q = q.where(FeedItem.seen_at.is_(None))
    q = q.order_by(FeedItem.score.desc(), FeedItem.fetched_at.desc()).limit(limit).offset(offset)
    result = await session.execute(q)
    return [_out(f) for f in result.scalars()]


@router.get("/stats")
async def feed_stats(
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    from sqlalchemy import func
    unread = (await session.execute(
        select(func.count()).where(FeedItem.seen_at.is_(None))
    )).scalar_one()
    total = (await session.execute(select(func.count(FeedItem.id)))).scalar_one()
    return {"unread": unread, "total": total}


@router.post("/refresh")
async def refresh_feed(_uid: int = Depends(require_auth)):
    """Manually trigger a feed.fetch run across all plugins."""
    new_items = await run_fetch()
    return {"new_items": new_items}


@router.post("/{id}/seen")
async def mark_seen(
    id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    f = await session.get(FeedItem, id)
    if not f:
        raise HTTPException(404)
    f.seen_at = datetime.now(UTC)
    await session.commit()
    return {"ok": True}

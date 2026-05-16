from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import TelemetryEvent
from gyst.db import get_session

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


class TelemetryIn(BaseModel):
    source: str
    ts: datetime
    kind: str
    target_url: str | None = None
    target_id: str | None = None
    duration_s: float | None = None
    meta: dict[str, Any] = {}


@router.post("/ingest")
async def ingest(
    body: list[TelemetryIn],
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    for item in body:
        session.add(TelemetryEvent(**item.model_dump()))
    await session.commit()
    return {"inserted": len(body)}


@router.get("/summary")
async def summary(
    from_: datetime | None = None,
    to: datetime | None = None,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    q_base = select(TelemetryEvent)
    if from_:
        q_base = q_base.where(TelemetryEvent.ts >= from_)
    if to:
        q_base = q_base.where(TelemetryEvent.ts <= to)

    result = await session.execute(q_base)
    events = result.scalars().all()

    total = len(events)
    by_source: dict[str, int] = {}
    for e in events:
        by_source[e.source] = by_source.get(e.source, 0) + 1

    return {"total": total, "by_source": by_source}


@router.get("/heatmap")
async def heatmap(
    from_: datetime | None = None,
    to: datetime | None = None,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    """Visits grouped by hour-of-day (0–23) and day-of-week (0=Sun)."""
    where = ""
    params: dict[str, Any] = {}
    if from_:
        where += " AND ts >= :from_"
        params["from_"] = from_.isoformat()
    if to:
        where += " AND ts <= :to"
        params["to"] = to.isoformat()

    result = await session.execute(
        text(f"""
            SELECT
                CAST(strftime('%H', ts) AS INTEGER) AS hour,
                CAST(strftime('%w', ts) AS INTEGER) AS dow,
                COUNT(*) AS visits
            FROM telemetry_event
            WHERE 1=1 {where}
            GROUP BY hour, dow
            ORDER BY hour, dow
        """),
        params,
    )
    return [{"hour": r[0], "dow": r[1], "visits": r[2]} for r in result.fetchall()]


@router.get("/daily")
async def daily_trend(
    days: int = 30,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    """Visit count per calendar day for the last N days."""
    result = await session.execute(
        text("""
            SELECT
                strftime('%Y-%m-%d', ts) AS day,
                COUNT(*) AS visits,
                SUM(COALESCE(duration_s, 0)) AS total_duration
            FROM telemetry_event
            WHERE ts >= datetime('now', :offset)
            GROUP BY day
            ORDER BY day
        """),
        {"offset": f"-{days} days"},
    )
    return [{"date": r[0], "visits": r[1], "total_duration": round(r[2] / 60, 1)} for r in result.fetchall()]


@router.get("/top-domains")
async def top_domains(
    limit: int = 20,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    result = await session.execute(
        text("""
            SELECT
                REPLACE(REPLACE(SUBSTR(target_url, INSTR(target_url, '://') + 3), 'www.', ''),
                    SUBSTR(SUBSTR(target_url, INSTR(target_url, '://') + 3), INSTR(SUBSTR(target_url, INSTR(target_url, '://') + 3), '/')), '') AS domain,
                COUNT(*) as visits,
                SUM(COALESCE(duration_s, 0)) as total_duration
            FROM telemetry_event
            WHERE target_url IS NOT NULL
            GROUP BY domain
            ORDER BY visits DESC
            LIMIT :limit
        """),
        {"limit": limit},
    )
    return [{"domain": r[0], "visits": r[1], "total_duration": r[2]} for r in result.fetchall()]

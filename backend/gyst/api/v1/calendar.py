from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import Event
from gyst.db import get_session

router = APIRouter(prefix="/events", tags=["calendar"])


class EventIn(BaseModel):
    title: str
    starts_at: datetime
    ends_at: datetime | None = None
    all_day: bool = False
    rrule: str | None = None
    body_md: str = ""
    color: str | None = None
    interest_id: str | None = None


class EventPatch(BaseModel):
    title: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    all_day: bool | None = None
    rrule: str | None = None
    body_md: str | None = None
    color: str | None = None
    interest_id: str | None = None


def _out(e: Event) -> dict[str, Any]:
    return {
        "id": e.id,
        "interest_id": e.interest_id,
        "title": e.title,
        "starts_at": e.starts_at.isoformat(),
        "ends_at": e.ends_at.isoformat() if e.ends_at else None,
        "all_day": e.all_day,
        "rrule": e.rrule,
        "body_md": e.body_md,
        "color": e.color,
        "created_at": e.created_at.isoformat(),
    }


@router.get("")
async def list_events(
    from_: datetime | None = None,
    to: datetime | None = None,
    interest_id: str | None = None,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    q = select(Event)
    if from_:
        q = q.where(Event.starts_at >= from_)
    if to:
        q = q.where(Event.starts_at <= to)
    if interest_id:
        q = q.where(Event.interest_id == interest_id)
    q = q.order_by(Event.starts_at)
    result = await session.execute(q)
    return [_out(e) for e in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_event(
    body: EventIn,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    event = Event(**body.model_dump())
    session.add(event)
    await session.commit()
    await session.refresh(event)
    return _out(event)


@router.get("/{id}")
async def get_event(
    id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    e = await session.get(Event, id)
    if not e:
        raise HTTPException(404)
    return _out(e)


@router.patch("/{id}")
async def patch_event(
    id: str,
    body: EventPatch,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    e = await session.get(Event, id)
    if not e:
        raise HTTPException(404)
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(e, field, val)
    await session.commit()
    await session.refresh(e)
    return _out(e)


@router.delete("/{id}", status_code=204)
async def delete_event(
    id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    e = await session.get(Event, id)
    if not e:
        raise HTTPException(404)
    await session.delete(e)
    await session.commit()

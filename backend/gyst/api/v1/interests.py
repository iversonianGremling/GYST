from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import Interest
from gyst.db import get_session

router = APIRouter(prefix="/interests", tags=["interests"])


def _slugify(title: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", title.lower())
    return re.sub(r"[\s_-]+", "-", slug).strip("-")


_DEFAULT_COVER_SETTINGS: dict[str, Any] = {
    "blur": 0,
    "brightness": 0.8,
    "overlay_color": "#000000",
    "overlay_opacity": 0.45,
    "position": "center",
    "scale": 1.05,
}


class InterestIn(BaseModel):
    kind: str = "project"
    title: str
    description: str | None = None
    cover_path: str | None = None


class InterestPatch(BaseModel):
    title: str | None = None
    kind: str | None = None
    description: str | None = None
    cover_path: str | None = None
    cover_settings: dict[str, Any] | None = None
    archived: bool | None = None


def _out(i: Interest) -> dict[str, Any]:
    return {
        "id": i.id,
        "kind": i.kind,
        "title": i.title,
        "slug": i.slug,
        "description": i.description,
        "cover_path": i.cover_path,
        "cover_settings": i.cover_settings or _DEFAULT_COVER_SETTINGS,
        "archived": i.archived,
        "created_at": i.created_at.isoformat(),
        "updated_at": i.updated_at.isoformat(),
    }


@router.get("")
async def list_interests(
    archived: bool = False,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    q = select(Interest).where(Interest.archived == archived).order_by(Interest.updated_at.desc())
    result = await session.execute(q)
    return [_out(i) for i in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_interest(
    body: InterestIn,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    slug = _slugify(body.title)
    existing = await session.execute(select(Interest).where(Interest.slug == slug))
    if existing.scalar_one_or_none():
        slug = f"{slug}-{int(datetime.now().timestamp())}"
    interest = Interest(kind=body.kind, title=body.title, slug=slug, description=body.description)
    session.add(interest)
    await session.commit()
    await session.refresh(interest)
    return _out(interest)


@router.get("/{id}")
async def get_interest(
    id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    i = await session.get(Interest, id)
    if not i:
        raise HTTPException(404)
    return _out(i)


@router.patch("/{id}")
async def patch_interest(
    id: str,
    body: InterestPatch,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    i = await session.get(Interest, id)
    if not i:
        raise HTTPException(404)
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(i, field, val)
    await session.commit()
    await session.refresh(i)
    return _out(i)


@router.delete("/{id}", status_code=204)
async def delete_interest(
    id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    i = await session.get(Interest, id)
    if not i:
        raise HTTPException(404)
    await session.delete(i)
    await session.commit()

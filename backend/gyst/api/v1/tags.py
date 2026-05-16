from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import Tag, Tagging
from gyst.db import get_session

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("")
async def list_tags(session: AsyncSession = Depends(get_session), _uid: int = Depends(require_auth)):
    result = await session.execute(select(Tag).order_by(Tag.name))
    return [{"id": t.id, "name": t.name} for t in result.scalars()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_tag(body: dict, session: AsyncSession = Depends(get_session), _uid: int = Depends(require_auth)):
    name = body.get("name", "").strip().lower()
    if not name:
        raise HTTPException(422, "name required")
    existing = await session.execute(select(Tag).where(Tag.name == name))
    if t := existing.scalar_one_or_none():
        return {"id": t.id, "name": t.name}
    tag = Tag(name=name)
    session.add(tag)
    await session.commit()
    await session.refresh(tag)
    return {"id": tag.id, "name": tag.name}


@router.post("/attach")
async def attach_tag(body: dict, session: AsyncSession = Depends(get_session), _uid: int = Depends(require_auth)):
    tagging = Tagging(tag_id=body["tag_id"], target_type=body["target_type"], target_id=str(body["target_id"]))
    session.add(tagging)
    await session.commit()
    return {"ok": True}


@router.delete("/attach")
async def detach_tag(body: dict, session: AsyncSession = Depends(get_session), _uid: int = Depends(require_auth)):
    result = await session.execute(
        select(Tagging).where(
            Tagging.tag_id == body["tag_id"],
            Tagging.target_type == body["target_type"],
            Tagging.target_id == str(body["target_id"]),
        )
    )
    t = result.scalar_one_or_none()
    if t:
        await session.delete(t)
        await session.commit()
    return {"ok": True}


@router.get("/{target_type}/{target_id}")
async def get_tags_for(
    target_type: str, target_id: str, session: AsyncSession = Depends(get_session), _uid: int = Depends(require_auth)
):
    q = select(Tag).join(Tagging, Tag.id == Tagging.tag_id).where(
        Tagging.target_type == target_type, Tagging.target_id == target_id
    )
    result = await session.execute(q)
    return [{"id": t.id, "name": t.name} for t in result.scalars()]

"""Folder CRUD — recursive tree for content, project, and note organization."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import Folder
from gyst.db import get_session

router = APIRouter(prefix="/folders", tags=["folders"])


def _out(f: Folder) -> dict[str, Any]:
    return {
        "id": f.id,
        "name": f.name,
        "parent_id": f.parent_id,
        "entity_type": f.entity_type,
        "color": f.color,
        "position": f.position,
        "sync_enabled": f.sync_enabled,
        "created_at": f.created_at.isoformat(),
    }


class FolderIn(BaseModel):
    name: str
    entity_type: str          # "content" | "project" | "note"
    parent_id: str | None = None
    color: str | None = None
    position: int = 0


class FolderPatch(BaseModel):
    name: str | None = None
    parent_id: str | None = None
    color: str | None = None
    position: int | None = None
    sync_enabled: bool | None = None


@router.get("")
async def list_folders(
    entity_type: str | None = None,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    q = select(Folder).order_by(Folder.position, Folder.created_at)
    if entity_type:
        q = q.where(Folder.entity_type == entity_type)
    result = await session.execute(q)
    return [_out(f) for f in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_folder(
    body: FolderIn,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    folder = Folder(
        name=body.name,
        entity_type=body.entity_type,
        parent_id=body.parent_id,
        color=body.color,
        position=body.position,
        created_at=datetime.now(UTC),
    )
    session.add(folder)
    await session.commit()
    await session.refresh(folder)
    return _out(folder)


@router.patch("/{id}")
async def patch_folder(
    id: str,
    body: FolderPatch,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    f = await session.get(Folder, id)
    if not f:
        raise HTTPException(404)
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(f, field, val)
    await session.commit()
    await session.refresh(f)
    return _out(f)


@router.delete("/{id}", status_code=204)
async def delete_folder(
    id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    f = await session.get(Folder, id)
    if not f:
        raise HTTPException(404)
    await session.delete(f)
    await session.commit()

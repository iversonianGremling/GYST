from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import Interest, Project
from gyst.db import get_session

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectIn(BaseModel):
    type: str = "generic"
    status: str = "active"
    settings: dict[str, Any] = {}


class ProjectPatch(BaseModel):
    type: str | None = None
    status: str | None = None
    settings: dict[str, Any] | None = None


def _out(p: Project) -> dict[str, Any]:
    return {
        "interest_id": p.interest_id,
        "type": p.type,
        "status": p.status,
        "settings": p.settings,
    }


@router.post("/{interest_id}", status_code=status.HTTP_201_CREATED)
async def create_project(
    interest_id: str,
    body: ProjectIn,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    interest = await session.get(Interest, interest_id)
    if not interest:
        raise HTTPException(404, "Interest not found")
    existing = await session.get(Project, interest_id)
    if existing:
        raise HTTPException(409, "Project already exists for this interest")
    project = Project(interest_id=interest_id, type=body.type, status=body.status, settings=body.settings)
    interest.kind = "project"
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return _out(project)


@router.get("/{interest_id}")
async def get_project(
    interest_id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    p = await session.get(Project, interest_id)
    if not p:
        raise HTTPException(404)
    return _out(p)


@router.patch("/{interest_id}")
async def patch_project(
    interest_id: str,
    body: ProjectPatch,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    p = await session.get(Project, interest_id)
    if not p:
        raise HTTPException(404)
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(p, field, val)
    await session.commit()
    await session.refresh(p)
    return _out(p)

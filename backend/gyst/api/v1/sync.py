"""Sync API — status, manual run, and the in-app conflict resolver (Phase 4)."""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.config import settings
from gyst.core.models import Note, SyncConflict
from gyst.db import get_session
from gyst.sync import gitea

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/status")
async def status(
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    open_conflicts = (await session.execute(
        select(func.count()).select_from(SyncConflict).where(SyncConflict.status == "open")
    )).scalar_one()
    return {
        "gitea_enabled": gitea.enabled(),
        "import_enabled": bool((settings.gitea or {}).get("import_enabled")),
        "gitea_url": (settings.gitea or {}).get("url"),
        "open_conflicts": open_conflicts,
    }


@router.post("/run")
async def run(_uid: int = Depends(require_auth)):
    """Trigger a full sync cycle now (pull → import → export → push)."""
    from gyst.sync.service import sync_all
    return await sync_all()


def _out(c: SyncConflict, note_title: str) -> dict:
    return {
        "id": c.id,
        "note_id": c.note_id,
        "note_title": note_title,
        "ours_title": c.ours_title,
        "ours_body": c.ours_body,
        "theirs_title": c.theirs_title,
        "theirs_body": c.theirs_body,
        "created_at": c.created_at.isoformat(),
    }


@router.get("/conflicts")
async def list_conflicts(
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    rows = (await session.execute(
        select(SyncConflict).where(SyncConflict.status == "open")
        .order_by(SyncConflict.created_at)
    )).scalars().all()
    out = []
    for c in rows:
        note = await session.get(Note, c.note_id)
        out.append(_out(c, note.title if note else c.ours_title))
    return out


class ResolveIn(BaseModel):
    choice: str   # "local" (keep ours) | "incoming" (accept theirs)


async def _resolve_one(session: AsyncSession, c: SyncConflict, choice: str) -> None:
    note = await session.get(Note, c.note_id)
    if note is not None:
        if choice == "incoming":
            # Accept desktop version into the DB; file already matches.
            note.title = c.theirs_title
            note.body_md = c.theirs_body
            note.last_synced_hash = c.theirs_hash
            note.sync_status = "clean"
        else:  # local — keep GYST version
            # Pin last_synced_hash to the incoming file's hash so the next import
            # skips it (no re-clobber); mark dirty so export pushes ours over it.
            note.last_synced_hash = c.theirs_hash
            note.sync_status = "dirty"
    c.status = "resolved"
    c.resolved_at = datetime.now(UTC)


@router.post("/conflicts/{cid}/resolve")
async def resolve(
    cid: int,
    body: ResolveIn,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    if body.choice not in ("local", "incoming"):
        raise HTTPException(400, "choice must be 'local' or 'incoming'")
    c = await session.get(SyncConflict, cid)
    if not c or c.status != "open":
        raise HTTPException(404, "conflict not found")
    await _resolve_one(session, c, body.choice)
    await session.commit()
    return {"ok": True}


@router.post("/conflicts/resolve-all")
async def resolve_all(
    body: ResolveIn,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    if body.choice not in ("local", "incoming"):
        raise HTTPException(400, "choice must be 'local' or 'incoming'")
    rows = (await session.execute(
        select(SyncConflict).where(SyncConflict.status == "open")
    )).scalars().all()
    for c in rows:
        await _resolve_one(session, c, body.choice)
    await session.commit()
    return {"resolved": len(rows)}

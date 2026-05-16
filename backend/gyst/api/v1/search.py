from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.db import get_session

router = APIRouter(prefix="/search", tags=["search"])


@router.get("")
async def search(
    q: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    # FTS5 over notes — table created by migration
    try:
        result = await session.execute(
            text("SELECT rowid, title, snippet(note_fts, 2, '<mark>', '</mark>', '…', 20) AS snippet FROM note_fts WHERE note_fts MATCH :q LIMIT 30"),
            {"q": q},
        )
        rows = result.fetchall()
        return [{"id": str(r[0]), "title": r[1], "snippet": r[2], "type": "note"} for r in rows]
    except Exception:
        # FTS table may not exist yet (before migration)
        return []

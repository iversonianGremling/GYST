"""Music project plugin — lyrics note + per-project settings."""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import Note, PluginSetting
from gyst.db import get_session

PLUGIN_ID = "music-project"


def _slugify(s: str) -> str:
    s = re.sub(r"[^\w\s-]", "", s.lower())
    return re.sub(r"[\s_-]+", "-", s).strip("-")


def _note_out(n: Note) -> dict[str, Any]:
    return {"id": n.id, "title": n.title, "body_md": n.body_md, "updated_at": n.updated_at.isoformat()}


def register_routes(router: APIRouter) -> None:

    @router.get("/lyrics/{interest_id}")
    async def get_or_create_lyrics(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        result = await session.execute(
            select(Note).where(Note.interest_id == interest_id, Note.slug == "lyrics")
        )
        note = result.scalar_one_or_none()
        if not note:
            note = Note(interest_id=interest_id, title="Lyrics", slug="lyrics", body_md="")
            session.add(note)
            await session.commit()
            await session.refresh(note)
        return _note_out(note)

    @router.get("/settings/{interest_id}")
    async def get_settings(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ) -> dict[str, Any]:
        result = await session.execute(
            select(PluginSetting).where(
                PluginSetting.plugin_id == PLUGIN_ID,
                PluginSetting.key == interest_id,
            )
        )
        row = result.scalar_one_or_none()
        return row.value if row else {"bpm": 120, "key": "C", "time_signature": "4/4"}

    @router.put("/settings/{interest_id}")
    async def save_settings(
        interest_id: str,
        body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        result = await session.execute(
            select(PluginSetting).where(
                PluginSetting.plugin_id == PLUGIN_ID,
                PluginSetting.key == interest_id,
            )
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = body
        else:
            session.add(PluginSetting(plugin_id=PLUGIN_ID, key=interest_id, value=body))
        await session.commit()
        return {"ok": True}

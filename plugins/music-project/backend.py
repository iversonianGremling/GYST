"""Music project plugin — lyrics note + per-project settings."""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import HTTPException

from gyst.auth import require_auth
from gyst.core.models import MusicScore, Note, PluginSetting
from gyst.db import get_session

PLUGIN_ID = "music-project"

# Ticks per quarter note for newly-created scores. Matches the frontend default
# in components/music/score/types.ts; standard MIDI resolution.
DEFAULT_PPQ = 480


def _slugify(s: str) -> str:
    s = re.sub(r"[^\w\s-]", "", s.lower())
    return re.sub(r"[\s_-]+", "-", s).strip("-")


def _note_out(n: Note) -> dict[str, Any]:
    return {"id": n.id, "title": n.title, "body_md": n.body_md, "updated_at": n.updated_at.isoformat()}


def _score_meta(s: MusicScore) -> dict[str, Any]:
    """List view — omits the (potentially large) doc payload."""
    return {
        "id": s.id,
        "interest_id": s.interest_id,
        "name": s.name,
        "kind": s.kind,
        "updated_at": s.updated_at.isoformat(),
        "created_at": s.created_at.isoformat(),
    }


def _score_full(s: MusicScore) -> dict[str, Any]:
    return {**_score_meta(s), "doc": s.doc}


def _empty_doc(kind: str, tempo: int, time_sig: str) -> dict[str, Any]:
    """Seed a fresh ScoreDoc. Mirrors the ScoreDoc shape in types.ts."""
    try:
        num, den = (int(x) for x in time_sig.split("/", 1))
    except (ValueError, AttributeError):
        num, den = 4, 4
    track = {
        "id": "t1",
        "name": "Track 1",
        "kind": kind,
        "instrument": "pluck",
        "notes": [],
    }
    if kind == "tab":
        track["tuning"] = ["E2", "A2", "D3", "G3", "B3", "E4"]
    return {
        "v": 1,
        "ppq": DEFAULT_PPQ,
        "tempo": tempo,
        "timeSig": [num, den],
        "tracks": [track],
    }


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

    # ── Scores (composition suite) ────────────────────────────────────────
    # A project owns many MusicScore rows. The list endpoint omits `doc` to keep
    # payloads small; the editor fetches one full score at a time.

    async def _settings_for(session: AsyncSession, interest_id: str) -> dict[str, Any]:
        result = await session.execute(
            select(PluginSetting).where(
                PluginSetting.plugin_id == PLUGIN_ID,
                PluginSetting.key == interest_id,
            )
        )
        row = result.scalar_one_or_none()
        return row.value if row else {"bpm": 120, "key": "C", "time_signature": "4/4"}

    @router.get("/scores/{interest_id}")
    async def list_scores(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ) -> list[dict[str, Any]]:
        result = await session.execute(
            select(MusicScore)
            .where(MusicScore.interest_id == interest_id)
            .order_by(MusicScore.updated_at.desc())
        )
        return [_score_meta(s) for s in result.scalars().all()]

    @router.post("/scores/{interest_id}")
    async def create_score(
        interest_id: str,
        body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ) -> dict[str, Any]:
        kind = body.get("kind", "midi")
        if kind not in ("midi", "tab"):
            raise HTTPException(400, "kind must be 'midi' or 'tab'")
        settings = await _settings_for(session, interest_id)
        doc = body.get("doc") or _empty_doc(
            kind, int(settings.get("bpm", 120)), settings.get("time_signature", "4/4")
        )
        score = MusicScore(
            interest_id=interest_id,
            name=body.get("name") or "Untitled",
            kind=kind,
            doc=doc,
        )
        session.add(score)
        await session.commit()
        await session.refresh(score)
        return _score_full(score)

    @router.get("/score/{score_id}")
    async def get_score(
        score_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ) -> dict[str, Any]:
        score = await session.get(MusicScore, score_id)
        if not score:
            raise HTTPException(404, "score not found")
        return _score_full(score)

    @router.put("/score/{score_id}")
    async def update_score(
        score_id: str,
        body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ) -> dict[str, Any]:
        score = await session.get(MusicScore, score_id)
        if not score:
            raise HTTPException(404, "score not found")
        if "name" in body:
            score.name = body["name"]
        if "doc" in body:
            score.doc = body["doc"]
        await session.commit()
        await session.refresh(score)
        return _score_meta(score)

    @router.delete("/score/{score_id}")
    async def delete_score(
        score_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        score = await session.get(MusicScore, score_id)
        if score:
            await session.delete(score)
            await session.commit()
        return {"ok": True}

    # ── Arrangement (clip timeline) ───────────────────────────────────────
    # One arrangement per project, stored as a PluginSetting (key arr:<iid>).

    @router.get("/arrangement/{interest_id}")
    async def get_arrangement(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ) -> dict[str, Any]:
        result = await session.execute(
            select(PluginSetting).where(
                PluginSetting.plugin_id == PLUGIN_ID,
                PluginSetting.key == f"arr:{interest_id}",
            )
        )
        row = result.scalar_one_or_none()
        if row:
            return row.value
        settings = await _settings_for(session, interest_id)
        try:
            num, den = (int(x) for x in settings.get("time_signature", "4/4").split("/", 1))
        except (ValueError, AttributeError):
            num, den = 4, 4
        return {
            "v": 1,
            "ppq": DEFAULT_PPQ,
            "tempo": int(settings.get("bpm", 120)),
            "timeSig": [num, den],
            "lanes": 4,
            "clips": [],
        }

    @router.put("/arrangement/{interest_id}")
    async def save_arrangement(
        interest_id: str,
        body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        key = f"arr:{interest_id}"
        result = await session.execute(
            select(PluginSetting).where(
                PluginSetting.plugin_id == PLUGIN_ID,
                PluginSetting.key == key,
            )
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = body
        else:
            session.add(PluginSetting(plugin_id=PLUGIN_ID, key=key, value=body))
        await session.commit()
        return {"ok": True}

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import Link, Note
from gyst.db import get_session

router = APIRouter(prefix="/notes", tags=["notes"])

_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


def _slugify(title: str) -> str:
    s = re.sub(r"[^\w\s-]", "", title.lower())
    return re.sub(r"[\s_-]+", "-", s).strip("-")


def _extract_wikilinks(body_md: str) -> list[str]:
    return _WIKILINK_RE.findall(body_md)


def _out(n: Note) -> dict[str, Any]:
    return {
        "id": n.id,
        "interest_id": n.interest_id,
        "title": n.title,
        "slug": n.slug,
        "body_md": n.body_md,
        "created_at": n.created_at.isoformat(),
        "updated_at": n.updated_at.isoformat(),
    }


async def _sync_wikilinks(note: Note, session: AsyncSession) -> None:
    # Remove old wikilinks from this note
    await session.execute(
        text("DELETE FROM link WHERE src_type='note' AND src_id=:id AND kind='wikilink'"),
        {"id": note.id},
    )
    titles = _extract_wikilinks(note.body_md)
    for title in titles:
        slug = _slugify(title)
        target = await session.execute(select(Note).where(Note.slug == slug))
        target_note = target.scalar_one_or_none()
        if target_note:
            link = Link(src_type="note", src_id=note.id, dst_type="note", dst_id=target_note.id, kind="wikilink")
            session.add(link)


@router.get("")
async def list_notes(
    interest_id: str | None = None,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    q = select(Note)
    if interest_id:
        q = q.where(Note.interest_id == interest_id)
    q = q.order_by(Note.updated_at.desc())
    result = await session.execute(q)
    return [_out(n) for n in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_note(
    body: dict,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    title = body.get("title", "Untitled")
    note = Note(
        interest_id=body.get("interest_id"),
        title=title,
        slug=_slugify(title),
        body_md=body.get("body_md", ""),
    )
    session.add(note)
    await session.flush()
    await _sync_wikilinks(note, session)
    await session.commit()
    await session.refresh(note)
    return _out(note)


@router.get("/{id}")
async def get_note(
    id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    n = await session.get(Note, id)
    if not n:
        raise HTTPException(404)
    return _out(n)


@router.patch("/{id}")
async def patch_note(
    id: str,
    body: dict,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    n = await session.get(Note, id)
    if not n:
        raise HTTPException(404)
    for field in ("title", "body_md", "interest_id"):
        if field in body:
            setattr(n, field, body[field])
    if "title" in body:
        n.slug = _slugify(body["title"])
    if "body_md" in body:
        await _sync_wikilinks(n, session)
    await session.commit()
    await session.refresh(n)
    return _out(n)


@router.delete("/{id}", status_code=204)
async def delete_note(
    id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    n = await session.get(Note, id)
    if not n:
        raise HTTPException(404)
    await session.delete(n)
    await session.commit()


@router.get("/{id}/backlinks")
async def get_backlinks(
    id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    result = await session.execute(
        select(Link).where(Link.dst_type == "note", Link.dst_id == id, Link.kind == "wikilink")
    )
    links = result.scalars().all()
    notes = []
    for link in links:
        n = await session.get(Note, link.src_id)
        if n:
            notes.append({"id": n.id, "title": n.title, "slug": n.slug})
    return notes

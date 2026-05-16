from __future__ import annotations

import hashlib
import mimetypes
from pathlib import Path
from typing import Any

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.config import settings
from gyst.core.models import MediaAsset
from gyst.db import get_session

router = APIRouter(prefix="/media", tags=["media"])

_MEDIA_ROOT = settings.data.root / "media"
_MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

_AUDIO_MIMES = {"audio/", "video/"}
_MIDI_EXTS = {".mid", ".midi"}
_TAB_EXTS = {".gp", ".gp5", ".gp4", ".gpx", ".musicxml", ".xml"}
_IMAGE_MIMES = {"image/"}


def _detect_kind(filename: str, mime: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in _MIDI_EXTS:
        return "midi"
    if ext in _TAB_EXTS:
        return "tab"
    if any(mime.startswith(p) for p in _AUDIO_MIMES):
        return "audio"
    if any(mime.startswith(p) for p in _IMAGE_MIMES):
        return "image"
    return "file"


def _out(a: MediaAsset) -> dict[str, Any]:
    return {
        "id": a.id,
        "interest_id": a.interest_id,
        "kind": a.kind,
        "original_name": a.original_name,
        "mime": a.mime,
        "duration_s": a.duration_s,
        "meta": a.meta,
        "created_at": a.created_at.isoformat(),
        "url": f"/api/v1/media/{a.id}/stream",
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_media(
    file: UploadFile = File(...),
    interest_id: str | None = Form(None),
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    content = await file.read()
    sha256 = hashlib.sha256(content).hexdigest()

    # Dedup by hash
    existing = await session.execute(select(MediaAsset).where(MediaAsset.sha256 == sha256))
    if dup := existing.scalar_one_or_none():
        return _out(dup)

    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    kind = _detect_kind(file.filename or "", mime)

    dest_dir = _MEDIA_ROOT / (interest_id or "_orphan")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{sha256[:16]}{Path(file.filename or '').suffix}"

    async with aiofiles.open(dest, "wb") as f:
        await f.write(content)

    asset = MediaAsset(
        interest_id=interest_id,
        kind=kind,
        path=str(dest.relative_to(settings.data.root)),
        sha256=sha256,
        mime=mime,
        original_name=file.filename or "",
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return _out(asset)


@router.get("/{id}/stream")
async def stream_media(
    id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    asset = await session.get(MediaAsset, id)
    if not asset:
        raise HTTPException(404)

    file_path = settings.data.root / asset.path
    if not file_path.exists():
        raise HTTPException(404, "File missing from disk")

    file_size = file_path.stat().st_size
    range_header = request.headers.get("range")

    if range_header:
        # Parse Range: bytes=start-end
        try:
            range_val = range_header.split("=")[1]
            start_str, end_str = range_val.split("-")
            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else file_size - 1
        except (IndexError, ValueError):
            raise HTTPException(416, "Invalid range")

        end = min(end, file_size - 1)
        chunk_size = end - start + 1

        async def iter_range():
            async with aiofiles.open(file_path, "rb") as f:
                await f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    chunk = await f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_range(),
            status_code=206,
            media_type=asset.mime,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
            },
        )

    async def iter_full():
        async with aiofiles.open(file_path, "rb") as f:
            while chunk := await f.read(65536):
                yield chunk

    return StreamingResponse(
        iter_full(),
        media_type=asset.mime,
        headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)},
    )


@router.get("")
async def list_media(
    interest_id: str | None = None,
    kind: str | None = None,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    q = select(MediaAsset)
    if interest_id:
        q = q.where(MediaAsset.interest_id == interest_id)
    if kind:
        q = q.where(MediaAsset.kind == kind)
    q = q.order_by(MediaAsset.created_at.desc())
    result = await session.execute(q)
    return [_out(a) for a in result.scalars().all()]


@router.delete("/{id}", status_code=204)
async def delete_media(
    id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    asset = await session.get(MediaAsset, id)
    if not asset:
        raise HTTPException(404)
    file_path = settings.data.root / asset.path
    if file_path.exists():
        file_path.unlink()
    await session.delete(asset)
    await session.commit()

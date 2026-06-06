"""Research project plugin — a lightweight reference library.

References (papers/books/links) with add-by-DOI (Crossref), BibTeX import/export,
tags and a reading-queue status. Literature notes stay as normal GYST notes.
"""
from __future__ import annotations

import re
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import PluginSetting, Reference
from gyst.db import get_session

PLUGIN_ID = "research-project"

_STATUSES = ("queued", "reading", "done")


# ── Plugin settings storage (Wallabag creds live here) ───────────────────────

async def _cfg(session: AsyncSession, plugin_id: str) -> dict:
    rows = await session.execute(
        select(PluginSetting).where(PluginSetting.plugin_id == plugin_id)
    )
    return {r.key: r.value for r in rows.scalars().all()}


async def _set_cfg(session: AsyncSession, plugin_id: str, key: str, value) -> None:
    row = (await session.execute(
        select(PluginSetting).where(PluginSetting.plugin_id == plugin_id, PluginSetting.key == key)
    )).scalar_one_or_none()
    if row:
        row.value = value
    else:
        session.add(PluginSetting(plugin_id=plugin_id, key=key, value=value))


async def _existing_external_ids(session: AsyncSession, interest_id: str, source: str) -> set[str]:
    rows = await session.execute(
        select(Reference.external_id).where(
            Reference.interest_id == interest_id, Reference.source_app == source,
        )
    )
    return {r[0] for r in rows.all() if r[0]}


def _out(r: Reference) -> dict[str, Any]:
    return {
        "id": r.id, "interest_id": r.interest_id, "kind": r.kind,
        "title": r.title, "authors": r.authors or [], "year": r.year,
        "doi": r.doi, "url": r.url, "tags": r.tags or [], "status": r.status,
        "note": r.note, "source_app": r.source_app, "added_at": r.added_at.isoformat(),
    }


# ── DOI / Crossref ───────────────────────────────────────────────────────────

async def _resolve_doi(doi: str) -> dict[str, Any]:
    doi = doi.strip().removeprefix("https://doi.org/").removeprefix("doi:").strip()
    async with httpx.AsyncClient(timeout=15.0) as cli:
        r = await cli.get(
            f"https://api.crossref.org/works/{doi}",
            headers={"User-Agent": "GYST/0.1 (self-hosted)"},
        )
    if r.status_code != 200:
        raise HTTPException(404, f"DOI not found ({r.status_code})")
    m = r.json().get("message", {})
    authors = [
        " ".join(p for p in (a.get("given"), a.get("family")) if p)
        for a in m.get("author", [])
    ]
    issued = m.get("issued", {}).get("date-parts", [[None]])
    year = issued[0][0] if issued and issued[0] else None
    kind = {"journal-article": "article", "book": "book",
            "proceedings-article": "article"}.get(m.get("type", ""), "article")
    return {
        "title": (m.get("title") or ["(untitled)"])[0],
        "authors": authors, "year": year, "doi": doi,
        "url": m.get("URL"), "kind": kind, "source_app": "doi",
    }


# ── BibTeX ───────────────────────────────────────────────────────────────────

_ENTRY_START_RE = re.compile(r"@(\w+)\s*\{")
_FIELD_RE = re.compile(r"(\w+)\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|\"[^\"]*\"|[^,\n]+)")


def _parse_bibtex(text: str) -> list[dict[str, Any]]:
    """Brace-balanced parse — tolerant of single-line and multi-line entries."""
    out: list[dict[str, Any]] = []
    for m in _ENTRY_START_RE.finditer(text):
        typ = m.group(1).lower()
        # Balance braces from the entry's opening '{' to find its end.
        depth, j = 1, m.end()
        while j < len(text) and depth:
            depth += 1 if text[j] == "{" else -1 if text[j] == "}" else 0
            j += 1
        body = text[m.end():j - 1]
        if "," not in body:
            continue
        _key, rest = body.split(",", 1)
        fields: dict[str, str] = {}
        for fm in _FIELD_RE.finditer(rest):
            fields[fm.group(1).lower()] = fm.group(2).strip().strip('{}"').strip()
        if not fields.get("title"):
            continue
        year = int(fields["year"]) if fields.get("year", "").isdigit() else None
        out.append({
            "title": fields["title"],
            "authors": [a.strip() for a in re.split(r"\s+and\s+", fields.get("author", "")) if a.strip()],
            "year": year, "doi": fields.get("doi"), "url": fields.get("url"),
            "kind": {"book": "book", "misc": "web"}.get(typ, "article"),
            "source_app": "bibtex",
        })
    return out


def _to_bibtex(r: Reference) -> str:
    surname = r.authors[0].split()[-1].lower() if r.authors else "ref"
    key = re.sub(r"[^a-z0-9]", "", surname) + (str(r.year) if r.year else "")
    typ = {"book": "book", "web": "misc"}.get(r.kind, "article")
    lines = [f"  title = {{{r.title}}}"]
    if r.authors:
        lines.append(f"  author = {{{' and '.join(r.authors)}}}")
    if r.year:
        lines.append(f"  year = {{{r.year}}}")
    if r.doi:
        lines.append(f"  doi = {{{r.doi}}}")
    if r.url:
        lines.append(f"  url = {{{r.url}}}")
    return f"@{typ}{{{key or r.id[:8]},\n" + ",\n".join(lines) + "\n}"


# ── Importers: Linkwarden (CT132) + Wallabag (CT145) ─────────────────────────

async def _fetch_linkwarden(base_url: str, api_key: str) -> list[dict[str, Any]]:
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    links: list[dict[str, Any]] = []
    cursor: int | None = None
    async with httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=20.0, follow_redirects=True) as cli:
        while True:
            params: dict[str, Any] = {"limit": 50}
            if cursor is not None:
                params["cursor"] = cursor
            r = await cli.get("/api/v1/links", headers=headers, params=params)
            r.raise_for_status()
            batch = r.json().get("response", [])
            if not batch:
                break
            links.extend(batch)
            if len(batch) < 50:
                break
            cursor = batch[-1]["id"]
    return links


async def _wallabag_token(c: dict) -> str:
    async with httpx.AsyncClient(base_url=c["url"].rstrip("/"), timeout=15.0, follow_redirects=True) as cli:
        r = await cli.post("/oauth/v2/token", data={
            "grant_type": "password",
            "client_id": c["client_id"], "client_secret": c["client_secret"],
            "username": c["username"], "password": c["password"],
        })
    if r.status_code != 200:
        raise HTTPException(400, f"Wallabag auth failed ({r.status_code})")
    return r.json()["access_token"]


async def _fetch_wallabag(c: dict) -> list[dict[str, Any]]:
    token = await _wallabag_token(c)
    out: list[dict[str, Any]] = []
    page = 1
    async with httpx.AsyncClient(base_url=c["url"].rstrip("/"), timeout=20.0, follow_redirects=True) as cli:
        while True:
            r = await cli.get("/api/entries.json", headers={"Authorization": f"Bearer {token}"},
                              params={"perPage": 50, "page": page})
            r.raise_for_status()
            d = r.json()
            items = d.get("_embedded", {}).get("items", [])
            out.extend(items)
            if page >= d.get("pages", 1) or not items:
                break
            page += 1
    return out


# ── Routes ───────────────────────────────────────────────────────────────────

def register_routes(router: APIRouter) -> None:

    @router.get("/references/{interest_id}")
    async def list_refs(
        interest_id: str,
        status: str | None = None,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        q = select(Reference).where(Reference.interest_id == interest_id)
        if status in _STATUSES:
            q = q.where(Reference.status == status)
        q = q.order_by(Reference.added_at.desc())
        return [_out(r) for r in (await session.execute(q)).scalars().all()]

    @router.post("/references/{interest_id}", status_code=201)
    async def create_ref(
        interest_id: str,
        body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        data: dict[str, Any] = {}
        if body.get("doi") and not body.get("title"):
            data.update(await _resolve_doi(body["doi"]))
        for k in ("title", "authors", "year", "doi", "url", "kind", "tags", "status", "note"):
            if body.get(k) is not None:
                data[k] = body[k]
        if not data.get("title"):
            raise HTTPException(400, "title or resolvable doi required")
        ref = Reference(
            interest_id=interest_id, title=data["title"],
            authors=data.get("authors", []), year=data.get("year"),
            doi=data.get("doi"), url=data.get("url"), kind=data.get("kind", "article"),
            tags=data.get("tags", []), status=data.get("status", "queued"),
            note=data.get("note"), source_app=data.get("source_app", "manual"),
        )
        session.add(ref)
        await session.commit()
        await session.refresh(ref)
        return _out(ref)

    @router.patch("/references/{interest_id}/{ref_id}")
    async def patch_ref(
        interest_id: str, ref_id: str, body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        ref = await session.get(Reference, ref_id)
        if not ref or ref.interest_id != interest_id:
            raise HTTPException(404)
        for k in ("title", "authors", "year", "doi", "url", "kind", "tags", "status", "note"):
            if k in body:
                setattr(ref, k, body[k])
        await session.commit()
        await session.refresh(ref)
        return _out(ref)

    @router.delete("/references/{interest_id}/{ref_id}", status_code=204)
    async def delete_ref(
        interest_id: str, ref_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        ref = await session.get(Reference, ref_id)
        if ref and ref.interest_id == interest_id:
            await session.delete(ref)
            await session.commit()

    @router.post("/references/{interest_id}/import-bibtex")
    async def import_bibtex(
        interest_id: str, body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        parsed = _parse_bibtex(body.get("bibtex", ""))
        for d in parsed:
            session.add(Reference(
                interest_id=interest_id, title=d["title"], authors=d["authors"],
                year=d["year"], doi=d["doi"], url=d["url"], kind=d["kind"],
                source_app="bibtex",
            ))
        await session.commit()
        return {"imported": len(parsed)}

    @router.get("/references/{interest_id}/export.bib")
    async def export_bibtex(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        rows = (await session.execute(
            select(Reference).where(Reference.interest_id == interest_id)
            .order_by(Reference.added_at)
        )).scalars().all()
        return PlainTextResponse("\n\n".join(_to_bibtex(r) for r in rows))

    # ── Importers (P2.E) ─────────────────────────────────────────────────────

    @router.get("/import/status")
    async def import_status(
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        lw = await _cfg(session, "linkwarden")
        wb = await _cfg(session, PLUGIN_ID)
        return {
            "linkwarden": bool(lw.get("base_url") and lw.get("api_key")),
            "wallabag": all(wb.get(f"wallabag_{k}") for k in ("url", "client_id", "client_secret", "username", "password")),
        }

    @router.get("/wallabag-settings")
    async def get_wallabag(
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        c = await _cfg(session, PLUGIN_ID)
        return {
            "url": c.get("wallabag_url", ""),
            "client_id": c.get("wallabag_client_id", ""),
            "username": c.get("wallabag_username", ""),
            "configured": bool(c.get("wallabag_url") and c.get("wallabag_password")),
        }

    @router.put("/wallabag-settings")
    async def put_wallabag(
        body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        for k in ("url", "client_id", "client_secret", "username", "password"):
            if body.get(k) is not None:
                await _set_cfg(session, PLUGIN_ID, f"wallabag_{k}", str(body[k]).strip())
        await session.commit()
        return {"ok": True}

    async def _import_refs(session, interest_id, source, items) -> int:
        existing = await _existing_external_ids(session, interest_id, source)
        added = 0
        for it in items:
            ext = str(it["id"])
            if ext in existing:
                continue
            if not it["url"]:
                continue
            session.add(Reference(
                interest_id=interest_id, title=it["title"] or it["url"], url=it["url"],
                kind="web", tags=it["tags"], status="queued",
                source_app=source, external_id=ext,
            ))
            added += 1
        await session.commit()
        return added

    @router.post("/import/linkwarden/{interest_id}")
    async def import_linkwarden(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        lw = await _cfg(session, "linkwarden")
        base, key = lw.get("base_url", "").strip(), lw.get("api_key", "").strip()
        if not base or not key:
            raise HTTPException(400, "Linkwarden not configured (set it in the Linkwarden plugin)")
        try:
            links = await _fetch_linkwarden(base, key)
        except Exception as e:
            raise HTTPException(502, f"Linkwarden fetch failed: {e}")
        items = [{
            "id": l.get("id"), "url": (l.get("url") or "").strip(),
            "title": (l.get("name") or l.get("url") or "").strip(),
            "tags": [t["name"] for t in l.get("tags", []) if isinstance(t, dict)],
        } for l in links]
        return {"imported": await _import_refs(session, interest_id, "linkwarden", items)}

    @router.post("/import/wallabag/{interest_id}")
    async def import_wallabag(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        c = await _cfg(session, PLUGIN_ID)
        cfg = {k: c.get(f"wallabag_{k}", "") for k in ("url", "client_id", "client_secret", "username", "password")}
        if not all(cfg.values()):
            raise HTTPException(400, "Wallabag not configured")
        try:
            entries = await _fetch_wallabag(cfg)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Wallabag fetch failed: {e}")
        items = [{
            "id": e.get("id"), "url": (e.get("url") or "").strip(),
            "title": (e.get("title") or e.get("url") or "").strip(),
            "tags": [t.get("label") for t in e.get("tags", []) if isinstance(t, dict)],
        } for e in entries]
        return {"imported": await _import_refs(session, interest_id, "wallabag", items)}

"""Code project plugin — link a GitHub repo and surface it inside GYST.

The GitHub fine-grained PAT is entered in the app (not gyst.toml) and stored in
the DB via PluginSetting. Read path (P2.C): repo metadata, README, issues,
commits, pull requests. Two-way issues (P2.D) come later.
"""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import PluginSetting
from gyst.db import get_session

PLUGIN_ID = "code-project"
TOKEN_KEY = "__github_token__"
GH = "https://api.github.com"


# ── PluginSetting helpers ────────────────────────────────────────────────────

async def _kv_get(session: AsyncSession, key: str) -> dict[str, Any] | None:
    row = (await session.execute(
        select(PluginSetting).where(PluginSetting.plugin_id == PLUGIN_ID, PluginSetting.key == key)
    )).scalar_one_or_none()
    return row.value if row else None


async def _kv_set(session: AsyncSession, key: str, value: dict[str, Any]) -> None:
    row = (await session.execute(
        select(PluginSetting).where(PluginSetting.plugin_id == PLUGIN_ID, PluginSetting.key == key)
    )).scalar_one_or_none()
    if row:
        row.value = value
    else:
        session.add(PluginSetting(plugin_id=PLUGIN_ID, key=key, value=value))


async def _kv_del(session: AsyncSession, key: str) -> None:
    row = (await session.execute(
        select(PluginSetting).where(PluginSetting.plugin_id == PLUGIN_ID, PluginSetting.key == key)
    )).scalar_one_or_none()
    if row:
        await session.delete(row)


async def _token(session: AsyncSession) -> str | None:
    v = await _kv_get(session, TOKEN_KEY)
    return (v or {}).get("token")


# ── GitHub API ───────────────────────────────────────────────────────────────

async def _gh(token: str, path: str, *, method: str = "GET",
              accept: str = "application/vnd.github+json",
              params: dict | None = None, json: dict | None = None) -> httpx.Response:
    async with httpx.AsyncClient(timeout=20.0) as cli:
        return await cli.request(
            method, f"{GH}{path}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": accept,
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "GYST/0.1",
            },
            params=params, json=json,
        )


def _parse_repo(s: str) -> tuple[str, str]:
    s = s.strip().removeprefix("https://github.com/").removeprefix("git@github.com:")
    s = s.removesuffix(".git").strip("/")
    parts = s.split("/")
    if len(parts) < 2 or not parts[0] or not parts[1]:
        raise HTTPException(400, "expected owner/repo")
    return parts[0], parts[1]


async def _require_link(session: AsyncSession, interest_id: str) -> tuple[str, str, str]:
    token = await _token(session)
    if not token:
        raise HTTPException(400, "GitHub token not configured")
    link = await _kv_get(session, interest_id)
    if not link or not link.get("owner"):
        raise HTTPException(404, "no repo linked")
    return token, link["owner"], link["repo"]


# ── Routes ───────────────────────────────────────────────────────────────────

def register_routes(router: APIRouter) -> None:

    @router.get("/settings")
    async def get_settings(
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        token = await _token(session)
        if not token:
            return {"configured": False, "login": None}
        r = await _gh(token, "/user")
        if r.status_code == 200:
            return {"configured": True, "login": r.json().get("login")}
        return {"configured": True, "login": None, "error": f"token invalid ({r.status_code})"}

    @router.put("/settings")
    async def put_settings(
        body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        token = (body.get("token") or "").strip()
        if not token:
            raise HTTPException(400, "token required")
        r = await _gh(token, "/user")
        if r.status_code != 200:
            raise HTTPException(400, f"token rejected by GitHub ({r.status_code})")
        await _kv_set(session, TOKEN_KEY, {"token": token})
        await session.commit()
        return {"configured": True, "login": r.json().get("login")}

    @router.delete("/settings", status_code=204)
    async def del_settings(
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        await _kv_del(session, TOKEN_KEY)
        await session.commit()

    @router.get("/link/{interest_id}")
    async def get_link(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        return await _kv_get(session, interest_id) or {}

    @router.put("/link/{interest_id}")
    async def put_link(
        interest_id: str,
        body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        token = await _token(session)
        if not token:
            raise HTTPException(400, "GitHub token not configured")
        owner, repo = _parse_repo(body.get("repo", ""))
        r = await _gh(token, f"/repos/{owner}/{repo}")
        if r.status_code != 200:
            raise HTTPException(404, f"repo not accessible ({r.status_code})")
        await _kv_set(session, interest_id, {"owner": owner, "repo": repo})
        await session.commit()
        return {"owner": owner, "repo": repo}

    @router.delete("/link/{interest_id}", status_code=204)
    async def del_link(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        await _kv_del(session, interest_id)
        await session.commit()

    @router.get("/overview/{interest_id}")
    async def overview(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        token, owner, repo = await _require_link(session, interest_id)
        r = await _gh(token, f"/repos/{owner}/{repo}")
        if r.status_code != 200:
            raise HTTPException(r.status_code, "repo fetch failed")
        m = r.json()
        rd = await _gh(token, f"/repos/{owner}/{repo}/readme", accept="application/vnd.github.html+json")
        return {
            "owner": owner, "repo": repo,
            "full_name": m.get("full_name"),
            "description": m.get("description"),
            "language": m.get("language"),
            "stars": m.get("stargazers_count"),
            "open_issues": m.get("open_issues_count"),
            "default_branch": m.get("default_branch"),
            "pushed_at": m.get("pushed_at"),
            "html_url": m.get("html_url"),
            "readme_html": rd.text if rd.status_code == 200 else "",
        }

    @router.get("/issues/{interest_id}")
    async def issues(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        token, owner, repo = await _require_link(session, interest_id)
        r = await _gh(token, f"/repos/{owner}/{repo}/issues",
                      params={"state": "open", "per_page": 50})
        if r.status_code != 200:
            raise HTTPException(r.status_code, "issues fetch failed")
        return [
            {
                "number": i["number"], "title": i["title"], "state": i["state"],
                "labels": [l["name"] for l in i.get("labels", [])],
                "comments": i.get("comments", 0), "html_url": i["html_url"],
                "user": i.get("user", {}).get("login"),
                "updated_at": i.get("updated_at"),
            }
            for i in r.json() if "pull_request" not in i   # the issues API also returns PRs
        ]

    @router.get("/pulls/{interest_id}")
    async def pulls(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        token, owner, repo = await _require_link(session, interest_id)
        r = await _gh(token, f"/repos/{owner}/{repo}/pulls",
                      params={"state": "open", "per_page": 50})
        if r.status_code != 200:
            raise HTTPException(r.status_code, "pulls fetch failed")
        return [
            {
                "number": p["number"], "title": p["title"],
                "user": p.get("user", {}).get("login"),
                "html_url": p["html_url"], "draft": p.get("draft", False),
                "updated_at": p.get("updated_at"),
            }
            for p in r.json()
        ]

    @router.get("/commits/{interest_id}")
    async def commits(
        interest_id: str,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        token, owner, repo = await _require_link(session, interest_id)
        r = await _gh(token, f"/repos/{owner}/{repo}/commits", params={"per_page": 20})
        if r.status_code != 200:
            raise HTTPException(r.status_code, "commits fetch failed")
        out = []
        for c in r.json():
            commit = c.get("commit", {})
            out.append({
                "sha": c["sha"][:8],
                "message": (commit.get("message", "").splitlines() or [""])[0],
                "author": (commit.get("author") or {}).get("name"),
                "date": (commit.get("author") or {}).get("date"),
                "html_url": c.get("html_url"),
            })
        return out

    # ── Two-way issues: write-through to GitHub (P2.D) ───────────────────────

    @router.post("/issues/{interest_id}", status_code=201)
    async def create_issue(
        interest_id: str, body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        token, owner, repo = await _require_link(session, interest_id)
        title = (body.get("title") or "").strip()
        if not title:
            raise HTTPException(400, "title required")
        r = await _gh(token, f"/repos/{owner}/{repo}/issues", method="POST",
                      json={"title": title, "body": body.get("body", "")})
        if r.status_code != 201:
            raise HTTPException(r.status_code, f"create failed: {r.text[:120]}")
        i = r.json()
        return {"number": i["number"], "title": i["title"], "html_url": i["html_url"]}

    @router.get("/issue/{interest_id}/{number}")
    async def get_issue(
        interest_id: str, number: int,
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        token, owner, repo = await _require_link(session, interest_id)
        r = await _gh(token, f"/repos/{owner}/{repo}/issues/{number}")
        if r.status_code != 200:
            raise HTTPException(r.status_code, "issue fetch failed")
        i = r.json()
        cr = await _gh(token, f"/repos/{owner}/{repo}/issues/{number}/comments",
                       params={"per_page": 100})
        comments = [
            {"user": c.get("user", {}).get("login"), "body": c.get("body", ""),
             "created_at": c.get("created_at")}
            for c in (cr.json() if cr.status_code == 200 else [])
        ]
        return {
            "number": i["number"], "title": i["title"], "body": i.get("body") or "",
            "state": i["state"], "user": i.get("user", {}).get("login"),
            "labels": [l["name"] for l in i.get("labels", [])],
            "html_url": i["html_url"], "comments": comments,
        }

    @router.patch("/issue/{interest_id}/{number}")
    async def edit_issue(
        interest_id: str, number: int, body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        token, owner, repo = await _require_link(session, interest_id)
        patch = {k: body[k] for k in ("title", "body", "state") if k in body}
        if patch.get("state") not in (None, "open", "closed"):
            raise HTTPException(400, "state must be open or closed")
        r = await _gh(token, f"/repos/{owner}/{repo}/issues/{number}",
                      method="PATCH", json=patch)
        if r.status_code != 200:
            raise HTTPException(r.status_code, f"edit failed: {r.text[:120]}")
        return {"ok": True, "state": r.json().get("state")}

    @router.post("/issue/{interest_id}/{number}/comment", status_code=201)
    async def comment_issue(
        interest_id: str, number: int, body: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _uid: int = Depends(require_auth),
    ):
        token, owner, repo = await _require_link(session, interest_id)
        text = (body.get("body") or "").strip()
        if not text:
            raise HTTPException(400, "comment body required")
        r = await _gh(token, f"/repos/{owner}/{repo}/issues/{number}/comments",
                      method="POST", json={"body": text})
        if r.status_code != 201:
            raise HTTPException(r.status_code, f"comment failed: {r.text[:120]}")
        return {"ok": True}

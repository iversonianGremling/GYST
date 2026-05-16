from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import (
    create_session_token,
    hash_password,
    make_session_cookie,
    require_auth,
    verify_password,
)
from gyst.config import settings
from gyst.db import get_session

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    password: str


@router.post("/auth/login")
async def login(body: LoginRequest, response: Response):
    stored = settings.auth.password_hash
    if not stored:
        raise HTTPException(status_code=503, detail="No password configured — set auth.password_hash in gyst.toml")
    if not verify_password(body.password, stored):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong password")
    token = create_session_token()
    response.set_cookie(**make_session_cookie(token))
    return {"ok": True}


@router.post("/auth/logout")
async def logout(response: Response, _uid: int = Depends(require_auth)):
    response.delete_cookie("gyst_session")
    return {"ok": True}


@router.get("/auth/me")
async def me(_uid: int = Depends(require_auth)):
    return {"authenticated": True}


@router.post("/auth/setup")
async def setup(body: LoginRequest, session: AsyncSession = Depends(get_session)):
    """One-time setup endpoint — only works when no password is configured yet."""
    if settings.auth.password_hash:
        raise HTTPException(status_code=403, detail="Password already configured")
    hashed = hash_password(body.password)
    # Print to stdout so user can paste into gyst.toml
    print(f"\n[auth] Generated password hash:\n{hashed}\n")
    return {"hash": hashed, "note": "Paste this into gyst.toml auth.password_hash and restart"}

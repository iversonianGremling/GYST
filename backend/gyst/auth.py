from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Cookie, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.config import settings
from gyst.db import get_session

_ph = PasswordHasher()
_signer = URLSafeTimedSerializer(settings.auth.secret_key, salt="gyst-session")


def hash_password(plain: str) -> str:
    return _ph.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, plain)
    except VerifyMismatchError:
        return False


def create_session_token(user_id: int = 1) -> str:
    return _signer.dumps({"uid": user_id, "tok": secrets.token_hex(8)})


def decode_session_token(token: str) -> int:
    max_age = settings.auth.session_ttl_days * 86400
    try:
        data = _signer.loads(token, max_age=max_age)
        return int(data["uid"])
    except (BadSignature, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")


def make_session_cookie(token: str) -> dict:
    return {
        "key": "gyst_session",
        "value": token,
        "httponly": True,
        "samesite": "lax",
        "max_age": settings.auth.session_ttl_days * 86400,
    }


async def require_auth(
    gyst_session: Annotated[str | None, Cookie()] = None,
) -> int:
    if not gyst_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return decode_session_token(gyst_session)

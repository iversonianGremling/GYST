"""Shared test fixtures — in-memory SQLite DB + authenticated AsyncClient."""
from __future__ import annotations

# ── Patch auth settings before any module reads them ─────────────────────────
# Auth reads settings.auth.password_hash at runtime and uses a module-level
# URLSafeTimedSerializer initialised with the secret key at import time.
# We fix both here, before any test code runs.
from itsdangerous import URLSafeTimedSerializer

import gyst.auth as _auth_mod
from gyst.auth import hash_password
from gyst.config import settings

TEST_PASSWORD = "hunter2testonly"
_TEST_SECRET   = "pytest-secret-key-do-not-use-in-production"
_TEST_HASH     = hash_password(TEST_PASSWORD)

settings.auth.password_hash = _TEST_HASH   # type: ignore[assignment]
settings.auth.secret_key    = _TEST_SECRET  # type: ignore[assignment]
_auth_mod._signer = URLSafeTimedSerializer(_TEST_SECRET, salt="gyst-session")

# ─────────────────────────────────────────────────────────────────────────────

import pytest
import pytest_asyncio


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from gyst.db import Base, get_session
from gyst.main import app

_ENGINE_URL = "sqlite+aiosqlite:///:memory:"


_FTS_STATEMENTS = [
    "CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(title, body_md, content='note', content_rowid='rowid')",
    "CREATE TRIGGER IF NOT EXISTS note_fts_insert AFTER INSERT ON note BEGIN INSERT INTO note_fts(rowid, title, body_md) VALUES (new.rowid, new.title, new.body_md); END",
    "CREATE TRIGGER IF NOT EXISTS note_fts_update AFTER UPDATE ON note BEGIN INSERT INTO note_fts(note_fts, rowid, title, body_md) VALUES ('delete', old.rowid, old.title, old.body_md); INSERT INTO note_fts(rowid, title, body_md) VALUES (new.rowid, new.title, new.body_md); END",
    "CREATE TRIGGER IF NOT EXISTS note_fts_delete AFTER DELETE ON note BEGIN INSERT INTO note_fts(note_fts, rowid, title, body_md) VALUES ('delete', old.rowid, old.title, old.body_md); END",
]


@pytest_asyncio.fixture
async def engine():
    from sqlalchemy import text as sa_text

    eng = create_async_engine(_ENGINE_URL, connect_args={"check_same_thread": False})
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for stmt in _FTS_STATEMENTS:
            await conn.execute(sa_text(stmt))
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def client(engine):
    """Authenticated AsyncClient wired to the in-memory DB."""
    TestSession = async_sessionmaker(engine, expire_on_commit=False)

    async def _override():
        async with TestSession() as s:
            yield s

    app.dependency_overrides[get_session] = _override

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
        assert r.status_code == 200, f"Login failed: {r.text}"
        yield c

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def anon_client(engine):
    """Unauthenticated client — for testing auth rejection."""
    TestSession = async_sessionmaker(engine, expire_on_commit=False)

    async def _override():
        async with TestSession() as s:
            yield s

    app.dependency_overrides[get_session] = _override

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()

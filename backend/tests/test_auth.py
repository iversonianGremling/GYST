"""Auth flow tests."""
import pytest
from httpx import AsyncClient

from tests.conftest import TEST_PASSWORD


@pytest.mark.anyio
async def test_login_ok(client: AsyncClient):
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 200


@pytest.mark.anyio
async def test_login_wrong_password(anon_client: AsyncClient):
    r = await anon_client.post("/api/v1/auth/login", json={"password": "wrongpassword"})
    assert r.status_code in (401, 403)


@pytest.mark.anyio
async def test_unauthenticated_rejected(anon_client: AsyncClient):
    r = await anon_client.get("/api/v1/interests")
    assert r.status_code == 401


@pytest.mark.anyio
async def test_logout(client: AsyncClient):
    r = await client.post("/api/v1/auth/logout")
    assert r.status_code in (200, 204)
    # After logout, protected routes should reject
    r2 = await client.get("/api/v1/interests")
    assert r2.status_code == 401

"""Smoke test — backend boots and /health responds."""
import pytest
from httpx import ASGITransport, AsyncClient

from gyst.main import app


@pytest.mark.anyio
async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

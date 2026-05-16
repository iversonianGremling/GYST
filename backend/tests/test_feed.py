"""Feed ingest — upsert and dedup."""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.core.feed import _upsert_item
from gyst.core.models import FeedItem


_DRAFT = {
    "source_plugin": "test-plugin",
    "external_id": "abc123",
    "title": "Test Item",
    "url": "https://example.com/1",
    "score": 0.5,
    "score_breakdown": {"source": "test"},
}


@pytest.mark.anyio
async def test_upsert_new_item(engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from sqlalchemy import select

    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        count = await _upsert_item(s, _DRAFT)
        await s.commit()
        assert count == 1

        result = await s.execute(select(FeedItem).where(FeedItem.external_id == "abc123"))
        item = result.scalar_one_or_none()
        assert item is not None
        assert item.title == "Test Item"


@pytest.mark.anyio
async def test_upsert_dedup(engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        c1 = await _upsert_item(s, _DRAFT)
        await s.commit()
        c2 = await _upsert_item(s, _DRAFT)
        await s.commit()
        assert c1 == 1
        assert c2 == 0  # duplicate — not inserted


@pytest.mark.anyio
async def test_feed_list_endpoint(client: AsyncClient):
    r = await client.get("/api/v1/feed")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.anyio
async def test_feed_stats(client: AsyncClient):
    r = await client.get("/api/v1/feed/stats")
    assert r.status_code == 200
    data = r.json()
    assert "unread" in data
    assert "total" in data

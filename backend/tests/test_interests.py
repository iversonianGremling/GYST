"""Interest CRUD tests."""
import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_list_empty(client: AsyncClient):
    r = await client.get("/api/v1/interests")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.anyio
async def test_create_and_get(client: AsyncClient):
    r = await client.post("/api/v1/interests", json={"title": "My Band", "kind": "project"})
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "My Band"
    assert data["slug"] == "my-band"
    assert data["kind"] == "project"
    assert data["archived"] is False
    assert "cover_settings" in data

    r2 = await client.get(f"/api/v1/interests/{data['id']}")
    assert r2.status_code == 200
    assert r2.json()["id"] == data["id"]


@pytest.mark.anyio
async def test_slug_dedup(client: AsyncClient):
    await client.post("/api/v1/interests", json={"title": "Duplicate"})
    r = await client.post("/api/v1/interests", json={"title": "Duplicate"})
    assert r.status_code == 201
    # Second slug must differ
    slugs = [i["slug"] for i in (await client.get("/api/v1/interests")).json()]
    assert len(set(slugs)) == len(slugs)


@pytest.mark.anyio
async def test_patch(client: AsyncClient):
    r = await client.post("/api/v1/interests", json={"title": "Old Title"})
    iid = r.json()["id"]

    r2 = await client.patch(f"/api/v1/interests/{iid}", json={"title": "New Title", "description": "desc"})
    assert r2.status_code == 200
    assert r2.json()["title"] == "New Title"
    assert r2.json()["description"] == "desc"


@pytest.mark.anyio
async def test_patch_cover_settings(client: AsyncClient):
    r = await client.post("/api/v1/interests", json={"title": "Visual"})
    iid = r.json()["id"]

    settings = {"blur": 6, "brightness": 0.7, "overlay_color": "#1a1a2e",
                "overlay_opacity": 0.6, "position": "top", "scale": 1.1}
    r2 = await client.patch(f"/api/v1/interests/{iid}", json={"cover_settings": settings})
    assert r2.status_code == 200
    assert r2.json()["cover_settings"]["blur"] == 6
    assert r2.json()["cover_settings"]["overlay_color"] == "#1a1a2e"


@pytest.mark.anyio
async def test_archive_filter(client: AsyncClient):
    r = await client.post("/api/v1/interests", json={"title": "Active"})
    iid = r.json()["id"]
    await client.post("/api/v1/interests", json={"title": "Also Active"})
    await client.patch(f"/api/v1/interests/{iid}", json={"archived": True})

    active = await client.get("/api/v1/interests")
    assert all(not i["archived"] for i in active.json())
    assert len(active.json()) == 1

    archived = await client.get("/api/v1/interests?archived=true")
    assert all(i["archived"] for i in archived.json())
    assert len(archived.json()) == 1


@pytest.mark.anyio
async def test_delete(client: AsyncClient):
    r = await client.post("/api/v1/interests", json={"title": "Temporary"})
    iid = r.json()["id"]
    r2 = await client.delete(f"/api/v1/interests/{iid}")
    assert r2.status_code == 204
    r3 = await client.get(f"/api/v1/interests/{iid}")
    assert r3.status_code == 404


@pytest.mark.anyio
async def test_get_404(client: AsyncClient):
    r = await client.get("/api/v1/interests/nonexistent-id")
    assert r.status_code == 404

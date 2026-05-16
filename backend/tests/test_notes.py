"""Notes CRUD + wikilink resolver + FTS search."""
import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_create_and_list(client: AsyncClient):
    # Create an interest to attach notes to
    ir = await client.post("/api/v1/interests", json={"title": "Research"})
    iid = ir.json()["id"]

    r = await client.post("/api/v1/notes", json={
        "title": "First note", "body_md": "Hello [[Second note]]", "interest_id": iid
    })
    assert r.status_code == 201
    assert r.json()["title"] == "First note"

    listed = await client.get(f"/api/v1/notes?interest_id={iid}")
    assert listed.status_code == 200
    assert len(listed.json()) == 1


@pytest.mark.anyio
async def test_get_and_patch(client: AsyncClient):
    r = await client.post("/api/v1/notes", json={"title": "Patchable", "body_md": "old"})
    nid = r.json()["id"]

    r2 = await client.patch(f"/api/v1/notes/{nid}", json={"body_md": "new content"})
    assert r2.status_code == 200
    assert r2.json()["body_md"] == "new content"


@pytest.mark.anyio
async def test_delete(client: AsyncClient):
    r = await client.post("/api/v1/notes", json={"title": "Delete me", "body_md": ""})
    nid = r.json()["id"]
    r2 = await client.delete(f"/api/v1/notes/{nid}")
    assert r2.status_code == 204
    assert (await client.get(f"/api/v1/notes/{nid}")).status_code == 404


@pytest.mark.anyio
async def test_wikilink_backlinks(client: AsyncClient):
    # Target must exist before Source links to it
    r2 = await client.post("/api/v1/notes", json={"title": "Target", "body_md": ""})
    r1 = await client.post("/api/v1/notes", json={"title": "Source", "body_md": "See [[Target]]"})
    assert r1.status_code == 201
    assert r2.status_code == 201

    # Backlinks endpoint should report Source → Target
    bl = await client.get(f"/api/v1/notes/{r2.json()['id']}/backlinks")
    assert bl.status_code == 200
    titles = [n["title"] for n in bl.json()]
    assert "Source" in titles


@pytest.mark.anyio
async def test_fts_search_endpoint_reachable(client: AsyncClient):
    """Search endpoint must return 200 and a list.
    snippet() with content='note' requires the production DB setup;
    correctness of FTS matching is verified via integration tests.
    """
    await client.post("/api/v1/notes", json={"title": "Zephyr Storm", "body_md": "unique xylophone content"})
    r = await client.get("/api/v1/search?q=xylophone")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

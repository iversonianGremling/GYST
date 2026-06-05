"""Pure-logic tests for the vault serializer + path mapping (Phase 1).

No DB / no I/O, so these run without the async fixtures.
"""
from __future__ import annotations

from datetime import UTC, datetime

from gyst.sync import vault


def test_dump_is_canonical():
    fm = {"gyst_id": "abc", "type": "note", "title": "Hello", "tags": ["a", "b"]}
    out = vault.dump(fm, "Body text")
    assert out.startswith("---\ngyst_id: abc\n")   # key order preserved
    assert out.endswith("Body text\n")             # exactly one trailing newline
    assert "\r" not in out                          # LF only


def test_dump_drops_none_and_keeps_order():
    fm = {"gyst_id": "x", "type": "note", "interest": None, "folder": "a/b"}
    out = vault.dump(fm, "")
    assert "interest" not in out
    assert out.index("gyst_id") < out.index("type") < out.index("folder")


def test_roundtrip_preserves_frontmatter_and_body():
    fm = vault.note_frontmatter(
        gyst_id="id-1", title="My Note", slug="my-note",
        interest_slug="proj", folder_path="research/papers",
        tags=["reading", "ml"], pinned=True,
        created_at=datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
        updated_at=datetime(2026, 6, 5, 9, 30, tzinfo=UTC),
    )
    body = "# My Note\n\nSome [[wikilink]] body."
    text = vault.dump(fm, body)
    parsed_fm, parsed_body = vault.parse(text)

    assert parsed_fm["gyst_id"] == "id-1"
    assert parsed_fm["folder"] == "research/papers"
    assert parsed_fm["tags"] == ["reading", "ml"]
    assert parsed_fm["pinned"] is True
    assert parsed_body == body


def test_parse_without_frontmatter():
    fm, body = vault.parse("just a desktop-created note\n")
    assert fm == {}
    assert body == "just a desktop-created note"


def test_content_hash_stable_and_sensitive():
    a = vault.dump({"gyst_id": "x"}, "body")
    assert vault.content_hash(a) == vault.content_hash(a)
    assert vault.content_hash(a) != vault.content_hash(a + " ")


def test_note_target_project_vs_personal():
    proj = vault.note_target(
        "my-note", interest_slug="songs", interest_is_project=True,
        folder_path="ideas",
    )
    assert proj.repo == "songs"
    assert proj.relpath == "notes/ideas/my-note.md"

    loose = vault.note_target(
        "loose", interest_slug=None, interest_is_project=False, folder_path=None,
    )
    assert loose.repo == vault.PERSONAL_REPO
    assert loose.relpath == "notes/loose.md"


def test_index_target():
    assert vault.index_target("songs", True).relpath == "_index.md"
    ct = vault.index_target("films", False)
    assert ct.repo == vault.PERSONAL_REPO
    assert ct.relpath == "content/films/_index.md"

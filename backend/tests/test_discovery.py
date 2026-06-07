"""Discovery P0+P1 tests — router, ICS parsing, relevance gate, Axenda e2e.

CT151 venv has no pytest → runs standalone against in-memory SQLite (does NOT
touch the live DB):
    PYTHONPATH=backend ../.venv/bin/python backend/tests/test_discovery.py
"""
import asyncio
import importlib.util
import logging
import sys
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from gyst.db import Base
from gyst.core.models import DiscoveryFeed, Interest, Place  # noqa: F401 (register tables)

_BACKEND = Path(__file__).resolve().parents[2] / "plugins" / "discovery" / "backend.py"
_spec = importlib.util.spec_from_file_location("discovery_backend", _BACKEND)
disc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(disc)


class _Ctx:
    def __init__(self, session):
        self.db = session
        self.log = logging.getLogger("test.discovery")


async def _session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return async_sessionmaker(engine, expire_on_commit=False)


_ICS = """BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-1@x
SUMMARY:Concerto de Test Band
DESCRIPTION:Unha noite de música en directo.\\n\\n  Concerto   \\n https://x/1
DTSTART;TZID=Europe/Madrid:20260701T200000
DTEND;TZID=Europe/Madrid:20260701T220000
LOCATION:Sala Capitol - Santiago de Compostela   -  A Coruña
URL;TYPE=URI:https://x/concerto
END:VEVENT
BEGIN:VEVENT
UID:evt-2@x
SUMMARY:Arte Abstracta Galega
DESCRIPTION:Mostra de pintura.\\n\\n  Exposición   \\n https://x/2
DTSTART;TZID=Europe/Madrid:20260702T100000
LOCATION:MARCO - Vigo   -  Pontevedra
URL;TYPE=URI:https://x/expo
END:VEVENT
END:VCALENDAR"""


def test_route_logic():
    stub = disc.StubConnector()
    assert disc._route({"concerts"}, None, [], stub) == {"concerts"}
    assert disc._route({"sports"}, None, [], stub) is None
    stub.needs_location = True
    assert disc._route({"concerts"}, None, [], stub) is None
    print("  ok: _route selection")


def test_ics_and_classify():
    evs = disc.parse_ics(_ICS)
    assert len(evs) == 2, evs
    assert evs[0]["SUMMARY"] == "Concerto de Test Band"
    assert evs[0]["DTSTART"].tzinfo is not None      # tz-aware (UTC)
    assert evs[0]["DTSTART"].hour == 18              # 20:00 Madrid (CEST) → 18:00 UTC
    assert disc.classify(evs[0]["DESCRIPTION"]) == "concerts"
    assert disc.classify(evs[1]["DESCRIPTION"]) == "exhibitions"
    assert disc.classify("Partido de futbol") == "sports"
    assert disc.classify("algo sen tipo") is None
    print("  ok: ICS parse + tz + classify")


def test_relevance_scoring():
    prof = disc.Profile(terms={"jazz"}, phrases={"test band"})
    s1, r1 = disc.score_event("Concerto de Test Band en directo", prof)
    assert s1 > 0 and any("test band" in x for x in r1)
    s2, _ = disc.score_event("Concerto de jazz", prof)
    assert s2 > 0
    s3, _ = disc.score_event("Exposicion de ceramica", prof)
    assert s3 == 0
    # Single-word names match whole words only — "arca" must NOT hit "comarca".
    arca = disc.Profile(terms=set(), phrases={"arca"})
    assert disc.score_event("Festa na comarca de Lugo", arca)[0] == 0
    assert disc.score_event("Concerto de Arca en Vigo", arca)[0] > 0
    empty = disc.Profile(set(), set())
    assert disc._apply_relevance([{"title": "x", "payload": {"match_text": "x"}}], empty) == []
    print("  ok: relevance scoring + word-boundary + empty-profile gate")


async def test_feed_fetch_stub():
    Session = await _session_factory()
    disc.CONNECTORS = [disc.StubConnector()]   # stub is not firehose → passes through
    async with Session() as s:
        p = Place(label="Galicia", scope="region", region="Galicia")
        s.add(p); await s.flush()
        s.add(DiscoveryFeed(label="f", place_id=p.id, categories=["concerts"],
                            subject_interest_ids=[], enabled=True, create_events=True))
        await s.commit()
        drafts = await disc.feed_fetch(_Ctx(s))
        assert len(drafts) == 1 and drafts[0]["external_id"].startswith("stub_")
        assert drafts[0]["create_event"] is True
    print("  ok: feed_fetch stub pipeline + event block")


async def test_axenda_relevance_e2e():
    Session = await _session_factory()
    conn = disc.AxendaConnector()
    async def _fake(ctx):
        return _ICS
    conn._ics_text = _fake
    disc.CONNECTORS = [conn]
    async with Session() as s:
        # Interest "Test Band" → profile phrase; only the concert should survive.
        s.add(Interest(kind="content", title="Test Band", slug="test-band"))
        p = Place(label="Galicia", scope="region", region="Galicia")
        s.add(p); await s.flush()
        s.add(DiscoveryFeed(label="Galicia culture", place_id=p.id,
                            categories=["concerts", "exhibitions"],
                            subject_interest_ids=[], enabled=True, create_events=False))
        await s.commit()
        drafts = await disc.feed_fetch(_Ctx(s))
        titles = [d["title"] for d in drafts]
        assert titles == ["Concerto de Test Band"], titles   # expo filtered out
        assert drafts[0]["score_breakdown"]["reasons"]
    print("  ok: Axenda firehose → only interest-matching events survive")


async def main() -> int:
    failures = 0
    tests = [test_route_logic, test_ics_and_classify, test_relevance_scoring,
             test_feed_fetch_stub, test_axenda_relevance_e2e]
    for fn in tests:
        try:
            res = fn()
            if asyncio.iscoroutine(res):
                await res
            print(f"PASS {fn.__name__}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            import traceback
            print(f"FAIL {fn.__name__}: {e!r}")
            traceback.print_exc()
    return failures


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

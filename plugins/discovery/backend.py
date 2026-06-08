"""Discovery plugin — composable interests (Place × subjects × categories) → events.

P0: facet model wiring + the connector registry/router.
P1: Galician Axenda connector (ICS) + the relevance gate — a "firehose" source
is filtered to only events that INTERSECT the user's interests (their tracked
artists/genres/topics/venues), never the whole regional agenda. See
docs/discovery.md.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.config import settings
from gyst.core.models import DiscoveryFeed, Interest, InterestFacet, Place, Tag
from gyst.db import get_session

PLUGIN_ID = "discovery"

# Controlled category vocabulary (docs/discovery.md §3.3).
CATEGORIES = {"concerts", "exhibitions", "theatre", "festivals", "talks", "sports"}


# ── Egress (privacy R1) ───────────────────────────────────────────────────────
# CT151's default route already exits via Mullvad (verified), so the default
# client is already private. egress="vpn" optionally forces the CT103 SOCKS
# proxy when configured; "residential" routing (byparr) is handled by the
# scraping/social connectors themselves, not here.

def _client(egress: str = "vpn") -> httpx.AsyncClient:
    proxy = settings.discovery.egress_proxy
    if egress == "vpn" and proxy:
        try:
            return httpx.AsyncClient(timeout=30, proxy=proxy)
        except Exception:  # socksio missing → fall back to default (already VPN)
            pass
    return httpx.AsyncClient(timeout=30)


# ── Connector contract (docs/discovery.md §4) ─────────────────────────────────

class Connector:
    id: str = "base"
    provides: set[str] = set()       # categories it can serve
    consumes: set[str] = set()       # facet types it can use
    needs_location: bool = False
    requires_subject: bool = False   # must have ≥1 matching subject facet
    firehose: bool = False           # bulk source → router applies relevance gate
    egress: str = "vpn"

    async def fetch(
        self,
        ctx: Any,
        *,
        place: Place | None,
        subjects: list[InterestFacet],
        categories: set[str],
        window: tuple[datetime, datetime],
        feed: DiscoveryFeed,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError


class StubConnector(Connector):
    """P0 smoke-test connector — emits one deterministic draft per feed so the
    pipeline (route → FeedItem → optional Event) can be verified. Harmless in
    production: only fires when a DiscoveryFeed routes 'concerts' to it."""
    id = "stub"
    provides = {"concerts"}
    consumes = {"genre"}
    needs_location = False
    requires_subject = False

    async def fetch(self, ctx, *, place, subjects, categories, window, feed):
        loc = place.label if place else "no-place"
        start = window[0] + timedelta(days=1)
        title = f"[stub] {loc} · {','.join(sorted(categories)) or 'any'}"
        return [{
            "source_plugin": PLUGIN_ID,
            "external_id": f"stub_{feed.id}",
            "title": title,
            "url": None,
            "interest_id": feed.interest_id,
            "payload": {"connector": self.id, "categories": sorted(categories),
                        "subjects": [s.facet_type for s in subjects]},
            "score": 0.1,
            "score_breakdown": {"connector": self.id},
            "create_event": bool(feed.create_events),
            "event": {"starts_at": start.isoformat(), "title": title},
        }]


# ── Relevance gate (the "intersect my interests" filter) ──────────────────────
# A firehose source (e.g. the Galician Axenda = every cultural event in Galicia)
# must NOT dump everything. We build the user's interest profile from their
# tracked interests and keep only events that intersect it. Deterministic,
# accent-insensitive term/phrase matching for now; a semantic (embedding) scorer
# can be added behind the same `score_event` seam later. See docs/discovery.md §7.

_WORD = re.compile(r"[a-z0-9]{3,}")


def _norm(s: str | None) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def _tokens(s: str | None) -> set[str]:
    return set(_WORD.findall(_norm(s)))


class Profile:
    """The user's interest fingerprint. `phrases` = multi-word names matched as
    substrings (artists, venues, interest titles); `terms` = single tokens
    matched on overlap (genres, topics, tags)."""
    def __init__(self, terms: set[str], phrases: set[str]) -> None:
        self.terms = terms
        self.phrases = phrases

    @property
    def empty(self) -> bool:
        return not (self.terms or self.phrases)


async def _setting(session: AsyncSession, key: str) -> Any:
    from gyst.core.models import PluginSetting
    row = await session.execute(select(PluginSetting).where(
        PluginSetting.plugin_id == PLUGIN_ID, PluginSetting.key == key))
    s = row.scalar_one_or_none()
    return s.value if s else None


async def _yamtrack_artists(ctx, url: str, token: str) -> list[dict[str, Any]]:
    """Fetch the user's tracked artists from yamtrack (CT150), cached ~6h. LAN
    call (no VPN lane). Names feed the relevance profile."""
    import json
    cache = ctx.fs / "yamtrack_artists.json"
    try:
        if cache.exists() and (datetime.now().timestamp() - cache.stat().st_mtime) < 6 * 3600:
            return json.loads(cache.read_text())
    except (OSError, ValueError):
        pass
    full = f"{url.rstrip('/')}/api/music/artists/{token}"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(full)
        r.raise_for_status()
        artists = r.json().get("artists", [])
    try:
        cache.write_text(json.dumps(artists))
    except OSError:
        pass
    return artists


async def build_profile(session: AsyncSession, ctx: Any = None) -> Profile:
    terms: set[str] = set()
    phrases: set[str] = set()

    interests = (await session.execute(
        select(Interest).where(Interest.kind == "content", Interest.archived.is_(False))
    )).scalars().all()
    facets = {f.interest_id: f for f in
              (await session.execute(select(InterestFacet))).scalars().all()}

    for it in interests:
        fac = facets.get(it.id)
        ref = (fac.entity_ref or {}) if fac else {}
        ftype = fac.facet_type if fac else "topic"
        if ftype in ("artist", "venue", "museum"):
            phrases.add(_norm(ref.get("name") or it.title))
        elif ftype == "genre":
            terms |= _tokens(ref.get("genre") or it.title)
        else:  # topic / untyped content interest
            terms |= _tokens(ref.get("text") or it.title)
            if len(_norm(it.title).split()) > 1:
                phrases.add(_norm(it.title))

    for t in (await session.execute(select(Tag))).scalars().all():
        terms |= _tokens(t.name)

    # yamtrack music library — the user's tracked artists become match phrases.
    if ctx is not None:
        yt_url = await _setting(session, "yamtrack_url")
        yt_token = await _setting(session, "yamtrack_token")
        if yt_url and yt_token:
            try:
                for a in await _yamtrack_artists(ctx, yt_url, yt_token):
                    phrases.add(_norm(a.get("name")))
            except Exception as e:  # noqa: BLE001 — yamtrack down must not break discovery
                ctx.log.warning("yamtrack profile fetch failed: %s", e)

    phrases = {p for p in phrases if len(p) >= 4}
    return Profile(terms, phrases)


def score_event(text: str, profile: Profile) -> tuple[float, list[str]]:
    n = _norm(text)
    toks = _tokens(text)
    reasons: list[str] = []
    score = 0.0
    for p in profile.phrases:
        if not p:
            continue
        # Single-word names must match a WHOLE word (so "arca" doesn't hit
        # "comarca"); multi-word names are safe as a substring.
        hit = (p in n) if " " in p else (p in toks)
        if hit:
            reasons.append(f"name:{p}")
            score += 0.6
    for h in sorted(toks & profile.terms):
        reasons.append(f"tag:{h}")
        score += 0.3
    return min(score, 1.0), reasons


def _apply_relevance(drafts: list[dict[str, Any]], profile: Profile) -> list[dict[str, Any]]:
    """Drop firehose drafts that don't intersect the user's interests."""
    if profile.empty:
        return []  # nothing to match against → show nothing (not the whole agenda)
    out: list[dict[str, Any]] = []
    for d in drafts:
        text = (d.get("payload") or {}).get("match_text") or d.get("title", "")
        rel, reasons = score_event(text, profile)
        if rel <= 0:
            continue
        d["score"] = round(min(1.0, 0.2 + rel), 3)
        d.setdefault("score_breakdown", {})
        d["score_breakdown"]["relevance"] = rel
        d["score_breakdown"]["reasons"] = reasons
        out.append(d)
    return out


# ── ICS parsing (minimal RFC 5545 — no external dep) ──────────────────────────

_MADRID = ZoneInfo("Europe/Madrid")


def _ics_unescape(v: str) -> str:
    return (v.replace("\\n", "\n").replace("\\N", "\n")
             .replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\"))


def _ics_dt(value: str, params: dict[str, str]) -> datetime | None:
    value = value.strip()
    try:
        if value.endswith("Z"):
            return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
        if "T" in value:
            naive = datetime.strptime(value, "%Y%m%dT%H%M%S")
        elif len(value) == 8:
            naive = datetime.strptime(value, "%Y%m%d")
        else:
            return None
    except ValueError:
        return None
    tz = ZoneInfo(params["TZID"]) if params.get("TZID") else _MADRID
    return naive.replace(tzinfo=tz).astimezone(UTC)


def parse_ics(text: str) -> list[dict[str, Any]]:
    # Unfold continuation lines (CRLF + space/tab).
    unfolded = re.sub(r"\r?\n[ \t]", "", text)
    events: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    for line in unfolded.splitlines():
        if line == "BEGIN:VEVENT":
            cur = {}
            continue
        if line == "END:VEVENT":
            if cur is not None:
                events.append(cur)
            cur = None
            continue
        if cur is None or ":" not in line:
            continue
        name_part, _, value = line.partition(":")
        name, *param_parts = name_part.split(";")
        params = dict(p.split("=", 1) for p in param_parts if "=" in p)
        name = name.upper()
        if name in ("DTSTART", "DTEND"):
            cur[name] = _ics_dt(value, params)
        elif name in ("SUMMARY", "DESCRIPTION", "LOCATION", "UID", "URL"):
            cur[name] = _ics_unescape(value).strip()
    return events


# Galician event-type keywords (in DESCRIPTION) → our category vocabulary.
_TYPE_MAP = [
    ("concerts", ("concerto", "concierto", "recital", "musica en vivo")),
    ("exhibitions", ("exposicion", "mostra", "exposicions")),
    ("festivals", ("festival", "feira", "romaria")),
    ("theatre", ("teatro", "danza", "espectaculo", "circo", "maxia", "monologo", "opera", "zarzuela")),
    ("talks", ("conferencia", "presentacion", "xornada", "congreso", "charla",
               "coloquio", "obradoiro", "curso", "relatorio", "mesa redonda",
               "seminario", "encontro", "cine", "cinema", "proxeccion")),
    ("sports", ("deporte", "carreira", "partido", "torneo")),
]


def classify(description: str) -> str | None:
    n = _norm(description)
    for cat, keys in _TYPE_MAP:
        if any(k in n for k in keys):
            return cat
    return None


class AxendaConnector(Connector):
    """Axenda de Cultura de Galicia (Xunta open data, ICS distribution) — the
    whole regional cultural agenda. firehose=True → the router's relevance gate
    keeps only events intersecting the user's interests."""
    id = "axenda-galicia"
    provides = {"concerts", "exhibitions", "theatre", "festivals", "talks"}
    consumes = {"place", "genre"}
    needs_location = False          # region-wide; place only narrows by concello
    firehose = True
    egress = "vpn"
    ICS_URL = ("https://abertos.xunta.gal/catalogo/cultura-ocio-deporte/-/dataset/"
               "0045/axenda-cultura-galicia/102/acceso-aos-datos.calendario")
    CACHE_TTL_S = 6 * 3600

    async def _ics_text(self, ctx) -> str:
        cache = ctx.fs / "axenda.ics"
        try:
            if cache.exists() and (datetime.now().timestamp() - cache.stat().st_mtime) < self.CACHE_TTL_S:
                return cache.read_text(encoding="utf-8")
        except OSError:
            pass
        async with _client(self.egress) as client:
            r = await client.get(self.ICS_URL, follow_redirects=True,
                                 headers={"User-Agent": "GYST/0.1 discovery"})
            r.raise_for_status()
        text = r.text
        try:
            cache.write_text(text, encoding="utf-8")
        except OSError:
            pass
        return text

    async def fetch(self, ctx, *, place, subjects, categories, window, feed):
        events = parse_ics(await self._ics_text(ctx))
        want_concello = _norm(place.city) if (place and place.scope == "city" and place.city) else None
        out: list[dict[str, Any]] = []
        for ev in events:
            starts = ev.get("DTSTART")
            if not isinstance(starts, datetime) or not (window[0] <= starts <= window[1]):
                continue
            cat = classify(ev.get("DESCRIPTION", ""))
            # Only drop on category when we positively detected one that's excluded.
            if categories and cat and cat not in categories:
                continue
            location = ev.get("LOCATION", "")
            if want_concello and want_concello not in _norm(location):
                continue
            summary = ev.get("SUMMARY", "(sen título)")
            desc = ev.get("DESCRIPTION", "")
            uid = ev.get("UID") or f"{summary}-{starts.isoformat()}"
            out.append({
                "source_plugin": PLUGIN_ID,
                "external_id": f"axenda_{uid}",
                "title": summary,
                "url": ev.get("URL"),
                "interest_id": feed.interest_id,
                "payload": {"connector": self.id, "category": cat or "other",
                            "location": location, "starts_at": starts.isoformat(),
                            "match_text": " · ".join([summary, desc, location])},
                "score": 0.4,
                "score_breakdown": {"connector": self.id, "category": cat or "other"},
                "create_event": bool(feed.create_events),
                "event": {"starts_at": starts.isoformat(),
                          "ends_at": ev["DTEND"].isoformat() if isinstance(ev.get("DTEND"), datetime) else None,
                          "title": summary, "body_md": desc[:800]},
            })
        return out


# Registry. StubConnector stays available for tests but is only wired in when
# debug is on, so it never injects synthetic items into real feeds.
CONNECTORS: list[Connector] = [AxendaConnector()]
if settings.server.debug:
    CONNECTORS.insert(0, StubConnector())


# ── Router (the feed.fetch hook) ──────────────────────────────────────────────

async def _enabled_feeds(session: AsyncSession) -> list[DiscoveryFeed]:
    rows = await session.execute(select(DiscoveryFeed).where(DiscoveryFeed.enabled.is_(True)))
    return list(rows.scalars())


async def _place(session: AsyncSession, place_id: str | None) -> Place | None:
    if not place_id:
        return None
    return await session.get(Place, place_id)


async def _subjects(session: AsyncSession, feed: DiscoveryFeed) -> list[InterestFacet]:
    ids = [i for i in (feed.subject_interest_ids or []) if not str(i).startswith("@")]
    if not ids:
        return []
    rows = await session.execute(
        select(InterestFacet).where(InterestFacet.interest_id.in_(ids))
    )
    return list(rows.scalars())


def _route(feed_cats: set[str], place: Place | None,
           subjects: list[InterestFacet], conn: Connector) -> set[str] | None:
    """Return the category slice this connector should serve, or None to skip."""
    cats = (conn.provides & feed_cats) if conn.provides else set(feed_cats)
    if conn.provides and not cats:
        return None
    if conn.needs_location and place is None:
        return None
    if conn.requires_subject and not any(s.facet_type in conn.consumes for s in subjects):
        return None
    return cats


async def feed_fetch(ctx: Any) -> list[dict[str, Any]]:
    if not settings.discovery.enabled:
        return []
    session: AsyncSession = ctx.db
    feeds = await _enabled_feeds(session)
    if not feeds:
        return []

    now = datetime.now(UTC)
    window = (now, now + timedelta(days=settings.discovery.window_days))
    profile = await build_profile(session, ctx)
    if profile.empty:
        ctx.log.info("discovery: empty interest profile — firehose sources will "
                     "emit nothing until interests are added")
    drafts: list[dict[str, Any]] = []

    for feed in feeds:
        place = await _place(session, feed.place_id)
        subjects = await _subjects(session, feed)
        feed_cats = {c for c in (feed.categories or []) if c in CATEGORIES}
        for conn in CONNECTORS:
            slice_cats = _route(feed_cats, place, subjects, conn)
            if slice_cats is None:
                continue
            try:
                got = await conn.fetch(ctx, place=place, subjects=subjects,
                                       categories=slice_cats, window=window, feed=feed)
            except Exception as e:  # noqa: BLE001 — isolate connector failures
                ctx.log.warning("connector %s failed for feed %s: %s", conn.id, feed.id, e)
                continue
            got = got or []
            if conn.firehose:
                got = _apply_relevance(got, profile)   # intersect-my-interests gate
            if feed.min_score:
                got = [d for d in got if float(d.get("score", 0)) >= feed.min_score]
            drafts.extend(got)
    return drafts


# ── Serialization ─────────────────────────────────────────────────────────────

def _place_dto(p: Place) -> dict[str, Any]:
    return {"id": p.id, "label": p.label, "scope": p.scope, "city": p.city,
            "region": p.region, "country": p.country, "lat": p.lat, "lon": p.lon,
            "radius_km": p.radius_km, "precision": p.precision, "is_home": p.is_home}


def _feed_dto(f: DiscoveryFeed) -> dict[str, Any]:
    return {"id": f.id, "label": f.label, "place_id": f.place_id,
            "categories": f.categories, "subject_interest_ids": f.subject_interest_ids,
            "enabled": f.enabled, "min_score": f.min_score,
            "create_events": f.create_events, "interest_id": f.interest_id}


# ── Routes ────────────────────────────────────────────────────────────────────

def register_routes(router: APIRouter) -> None:

    @router.get("/connectors")
    async def list_connectors(_uid: int = Depends(require_auth)):
        return {"categories": sorted(CATEGORIES), "connectors": [
            {"id": c.id, "provides": sorted(c.provides), "consumes": sorted(c.consumes),
             "needs_location": c.needs_location, "requires_subject": c.requires_subject,
             "egress": c.egress} for c in CONNECTORS]}

    # Results — the events that matched the user's interests (for the UI) ------
    @router.get("/results")
    async def results(session: AsyncSession = Depends(get_session),
                      _uid: int = Depends(require_auth)):
        from gyst.core.models import FeedItem
        rows = await session.execute(
            select(FeedItem).where(FeedItem.source_plugin == PLUGIN_ID)
            .order_by(FeedItem.score.desc(), FeedItem.fetched_at.desc()).limit(60))
        items = []
        for f in rows.scalars():
            p = f.payload or {}
            items.append({
                "id": f.id, "title": f.title, "url": f.url, "score": round(f.score, 3),
                "category": p.get("category"), "location": p.get("location"),
                "starts_at": p.get("starts_at"),
                "reasons": (f.score_breakdown or {}).get("reasons", []),
            })
        # Profile summary (incl. yamtrack via a lightweight ctx shim, cached).
        shim = SimpleNamespace(db=session, log=logging.getLogger("gyst.plugin.discovery"),
                               fs=settings.data.root / "plugins" / PLUGIN_ID)
        shim.fs.mkdir(parents=True, exist_ok=True)
        try:
            prof = await build_profile(session, shim)
            profile = {"phrases": len(prof.phrases), "terms": sorted(prof.terms)}
        except Exception:  # noqa: BLE001
            profile = {"phrases": 0, "terms": []}
        return {"items": items, "count": len(items), "profile": profile}

    # Sources / settings (yamtrack link, future API keys) ---------------------
    @router.get("/settings")
    async def get_settings(session: AsyncSession = Depends(get_session),
                           _uid: int = Depends(require_auth)):
        url = await _setting(session, "yamtrack_url")
        token = await _setting(session, "yamtrack_token")
        return {"yamtrack_url": url or "", "yamtrack_linked": bool(url and token)}

    @router.put("/settings")
    async def put_settings(body: dict[str, Any],
                           session: AsyncSession = Depends(get_session),
                           _uid: int = Depends(require_auth)):
        from gyst.core.models import PluginSetting
        for key in ("yamtrack_url", "yamtrack_token"):
            if key not in body:
                continue
            row = await session.execute(select(PluginSetting).where(
                PluginSetting.plugin_id == PLUGIN_ID, PluginSetting.key == key))
            s = row.scalar_one_or_none()
            if s:
                s.value = body[key]
            else:
                session.add(PluginSetting(plugin_id=PLUGIN_ID, key=key, value=body[key]))
        await session.commit()
        url = await _setting(session, "yamtrack_url")
        token = await _setting(session, "yamtrack_token")
        return {"yamtrack_url": url or "", "yamtrack_linked": bool(url and token)}

    # Places ------------------------------------------------------------------
    @router.get("/places")
    async def list_places(session: AsyncSession = Depends(get_session),
                          _uid: int = Depends(require_auth)):
        rows = await session.execute(select(Place).order_by(Place.is_home.desc(), Place.label))
        return {"places": [_place_dto(p) for p in rows.scalars()]}

    @router.post("/places")
    async def add_place(body: dict[str, Any], session: AsyncSession = Depends(get_session),
                        _uid: int = Depends(require_auth)):
        p = Place(
            label=(body.get("label") or "").strip() or "Unnamed",
            scope=body.get("scope", "city"), city=body.get("city"),
            region=body.get("region"), country=body.get("country"),
            lat=body.get("lat"), lon=body.get("lon"),
            radius_km=int(body.get("radius_km", 50)),
            precision=body.get("precision", "city"), is_home=bool(body.get("is_home", False)),
        )
        session.add(p)
        await session.commit()
        return _place_dto(p)

    @router.patch("/places/{place_id}")
    async def edit_place(place_id: str, body: dict[str, Any],
                         session: AsyncSession = Depends(get_session),
                         _uid: int = Depends(require_auth)):
        p = await session.get(Place, place_id)
        if not p:
            return {"error": "not found"}
        for k in ("label", "scope", "city", "region", "country", "lat", "lon",
                  "radius_km", "precision", "is_home"):
            if k in body:
                setattr(p, k, body[k])
        await session.commit()
        return _place_dto(p)

    @router.delete("/places/{place_id}")
    async def del_place(place_id: str, session: AsyncSession = Depends(get_session),
                        _uid: int = Depends(require_auth)):
        p = await session.get(Place, place_id)
        if p:
            await session.delete(p)
            await session.commit()
        return {"ok": True}

    # Feeds -------------------------------------------------------------------
    @router.get("/feeds")
    async def list_feeds(session: AsyncSession = Depends(get_session),
                         _uid: int = Depends(require_auth)):
        rows = await session.execute(select(DiscoveryFeed).order_by(DiscoveryFeed.label))
        return {"feeds": [_feed_dto(f) for f in rows.scalars()]}

    @router.post("/feeds")
    async def add_feed(body: dict[str, Any], session: AsyncSession = Depends(get_session),
                       _uid: int = Depends(require_auth)):
        cats = [c for c in (body.get("categories") or []) if c in CATEGORIES]
        f = DiscoveryFeed(
            label=(body.get("label") or "").strip() or "Untitled feed",
            place_id=body.get("place_id"), categories=cats,
            subject_interest_ids=body.get("subject_interest_ids") or [],
            enabled=bool(body.get("enabled", True)),
            min_score=float(body.get("min_score", 0.0)),
            create_events=bool(body.get("create_events", False)),
            interest_id=body.get("interest_id"),
        )
        session.add(f)
        await session.commit()
        return _feed_dto(f)

    @router.patch("/feeds/{feed_id}")
    async def edit_feed(feed_id: str, body: dict[str, Any],
                        session: AsyncSession = Depends(get_session),
                        _uid: int = Depends(require_auth)):
        f = await session.get(DiscoveryFeed, feed_id)
        if not f:
            return {"error": "not found"}
        if "categories" in body:
            f.categories = [c for c in body["categories"] if c in CATEGORIES]
        for k in ("label", "place_id", "subject_interest_ids", "enabled",
                  "min_score", "create_events", "interest_id"):
            if k in body:
                setattr(f, k, body[k])
        await session.commit()
        return _feed_dto(f)

    @router.delete("/feeds/{feed_id}")
    async def del_feed(feed_id: str, session: AsyncSession = Depends(get_session),
                       _uid: int = Depends(require_auth)):
        f = await session.get(DiscoveryFeed, feed_id)
        if f:
            await session.delete(f)
            await session.commit()
        return {"ok": True}

    # Facets ------------------------------------------------------------------
    @router.get("/facets")
    async def get_facet(interest_id: str = Query(...),
                        session: AsyncSession = Depends(get_session),
                        _uid: int = Depends(require_auth)):
        fac = await session.get(InterestFacet, interest_id)
        if not fac:
            return {"facet": None}
        return {"facet": {"interest_id": fac.interest_id, "facet_type": fac.facet_type,
                          "entity_ref": fac.entity_ref, "location_mode": fac.location_mode}}

    @router.put("/facets/{interest_id}")
    async def set_facet(interest_id: str, body: dict[str, Any],
                        session: AsyncSession = Depends(get_session),
                        _uid: int = Depends(require_auth)):
        fac = await session.get(InterestFacet, interest_id)
        if not fac:
            fac = InterestFacet(interest_id=interest_id, facet_type=body.get("facet_type", "topic"))
            session.add(fac)
        if "facet_type" in body:
            fac.facet_type = body["facet_type"]
        if "entity_ref" in body:
            fac.entity_ref = body["entity_ref"]
        if "location_mode" in body:
            fac.location_mode = body["location_mode"]
        await session.commit()
        return {"interest_id": fac.interest_id, "facet_type": fac.facet_type,
                "entity_ref": fac.entity_ref, "location_mode": fac.location_mode}

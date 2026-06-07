# GYST Discovery — Composable Interests & Event Fetching

Design doc. Precedes code (per the vault-sync convention). Reviewed by: _pending_.
Status: **DRAFT for review.** Target container: **CT151** (`/opt/gyst`).

---

## 1. Goal

Turn GYST from "a music-artist → nearby-gigs" point feature into a general,
**composable discovery engine**. You assemble what you care about from small
building blocks — *places*, *subjects*, *categories* — and the system routes
each combination to whatever data sources can serve it, then surfaces results
as scored `FeedItem`s and calendar `Event`s.

Examples the model must express:
- "Jazz **concerts** + **exhibitions** near **Madrid**"
- "Anything by the **artists in my yamtrack library**, within 50 km of home"
- "**Theatre & festivals** in **Lisbon** the week I'm visiting"
- "New **exhibitions** at these 4 specific **museums**"

Categories in scope (user confirmed all): concerts/gigs, museums/exhibitions,
theatre/arts & festivals, talks/meetups, sports.

This **reuses the existing feed engine unchanged**: `core/feed.py run_fetch()`
fans out to `feed.fetch` hooks → `_upsert_item()` → scored `FeedItem`; the
`Event` model already carries `interest_id`, `starts_at`, `rrule`. The new work
is a thin **facet model** + a **connector registry/router** + the connectors.

---

## 2. Privacy requirements (first-class constraint)

User priority: *"as long as it preserves my privacy I don't care that much."*
These are hard requirements, not nice-to-haves:

- **R1 — Egress isolation.** Every outbound discovery request leaves via a
  non-home IP. **VERIFIED 2026-06-07:** CT151's *default* egress already exits
  through Mullvad (baseline check → Sweden exit `89.37.63.232`), because the LAN
  routes through the CT103 gateway. So R1 is satisfied by default routing — no
  per-connector proxy strictly required. Two lanes remain available:
  - `vpn` → default route (already Mullvad), or force via the SOCKS5 proxy
    `socks5h://10.10.10.1:1080` on CT103 (microsocks, reachable from CT151,
    confirmed same exit). `[discovery] egress_proxy` defaults to `""` (use
    default route); set it to the SOCKS URL to force (needs `socksio` — optional,
    deferred). NB CT103 `:8080` is `vpn-health.py`, **not** a proxy.
  - `residential` → byparr (CT124, `192.168.1.164:8191`) — Cloudflare-protected
    scrape targets and the social bridge (§6.6); residential IP.
  Connectors get clients via the discovery module's `_client(egress)` helper,
  never a bare ad-hoc client. Direct-LAN calls (yamtrack) use the default route.
- **R2 — No account-linked identifiers where avoidable.** Bandsintown `app_id`
  is an arbitrary account-less string → use a random one. Ticketmaster is the
  one source needing an email-registered key → isolate it; its key is the only
  PII-linkable credential and is used over the VPN lane only.
- **R3 — Data minimization.** Only the minimum query params leave the box
  (a city/lat-lon at chosen precision, a genre or artist name, a date window).
  Your full artist list, library, location history, and ratings **stay in
  SQLite** and are never shipped wholesale to a third party. Location precision
  is configurable (city-centroid by default, not exact home coords).
- **R4 — Local secrets.** All keys live in `gyst.toml [discovery]` or
  `PluginSetting`, both gitignored / never materialized to the vault.
- **R5 — No third-party telemetry.** Connectors send no analytics; honor a
  global kill-switch (`[discovery] enabled`).

---

## 3. Data model (facets)

Additive migration. New tables; existing models untouched.

### 3.1 `Place`
A saved location. You can have several; one is `is_home`. A Place can be a
**city** or a **region** (`scope="city"|"region"`) — region-scope skips the
municipality filter so region-wide feeds (e.g. the Galician Axenda, §6.4) return
all municipalities.
```
Place(id, label, scope="city"|"region", city, region, country,
      lat, lon, radius_km, precision="city"|"exact", is_home: bool, created_at)
```
`precision="city"` → queries use the city centroid + radius (R3). `"exact"`
only when a source needs it and you opt in per-place.

**Seed Places (user, 2026-06-07) — home/focus = Galicia:**
| label | scope | notes |
|-------|-------|-------|
| **Galicia** | region | **home + focus**; drives the Galician Axenda connector (all concellos) |
| Vigo | city | Galicia; primary local city (MARCO, Museo do Mar, venues) |
| Santiago de Compostela | city | Galicia; primary local city (CGAC, Cidade da Cultura, Sala Capitol) |
| Bilbao | city | secondary (Guggenheim, BBK venues) |
| Madrid | city | secondary (strong Ticketmaster + open-data) |
| Barcelona | city | secondary (strong Ticketmaster + Open Data BCN) |

Galicia is the priority: connectors and source work are ordered to make the
Galician feed land first (§9). The two Galician cities sit *inside* the Galicia
region Place but are kept as their own Places for city-scoped sources
(Ticketmaster, venue/museum recipes) and tighter radius control.

### 3.2 Subject facet — extend `Interest`, don't fork it
A "subject" is just an `Interest` (kind=content) with a typed sidecar so we
know *how* to query for it. Reuses the existing Interest/folder/notes UI.
```
InterestFacet(interest_id PK/FK, facet_type, entity_ref JSON, location_mode)
  facet_type   = "artist" | "genre" | "venue" | "museum" | "topic"
  entity_ref   = { mbid, name } | { genre } | { venue_id, source } |
                 { museum_url, name } | { text }
  location_mode= "place" | "global"   # is this subject location-bound?
```
- `artist` rows auto-imported from yamtrack (CT150) — name + **MusicBrainz
  MBID** (reliable Bandsintown matching). See §6.2.
- `genre` / `topic` are free text used as API keywords / scrape filters.
- `venue` / `museum` bind to a specific program source (its own listing page
  or ICS feed).

### 3.3 `DiscoveryFeed` — the composition
The composable unit the user assembles.
```
DiscoveryFeed(id, label, place_id FK?, categories JSON[str],
              subject_interest_ids JSON[str], enabled, min_score,
              create_events: bool, interest_id FK?,   # where results land
              created_at)
```
A feed = `Place × {subjects} × {categories}`. `subject_interest_ids` may be
explicit, or a special token `"@yamtrack-artists"` / `"@all-genres"` to mean
"expand dynamically at fetch time." Results attach to `interest_id` (or to each
matched subject interest) for the existing per-interest feed views.

### 3.4 `EventSource` cache key
Events dedup by `(source, external_id)` in `FeedItem` (already supported) and
calendar `Event`s dedup by `title + starts_at + place` (no external key on
`Event`, matching the current model note). A small `discovery_seen` helper or a
deterministic `external_id` avoids duplicate calendar rows.

---

## 4. Connector contract

A **connector** is a plugin (or a registered adapter inside one
`discovery` plugin — see §4.1) that declares *what slices of a feed it can
serve*:

```python
class Connector:
    id: str                      # "ticketmaster", "bandsintown", "museum-scrape", "ics"
    provides: set[str]           # categories: {"concerts","theatre","sports",...}
    consumes: set[str]           # facet types it can use: {"genre","artist","place"}
    needs_location: bool
    egress: "vpn" | "residential" | "lan"

    async def fetch(self, ctx, *, place, subjects, categories, window) \
        -> list[FeedDraft]: ...
```

`FeedDraft` is the existing `feed.fetch` dict shape (`source_plugin`,
`external_id`, `title`, `url`, `interest_id`, `payload`, `score`,
`score_breakdown`) plus optional `event` block `{starts_at, ends_at, venue,
lat, lon}` that the upsert path turns into a calendar `Event`.

`ctx.http` for a discovery connector is pre-wired to the connector's `egress`
lane (R1): `vpn` → proxied via CT103, `residential` → routed through byparr,
`lan` → direct (yamtrack, etc.). Connectors must not construct their own
unproxied clients.

### 4.1 One `discovery` plugin, many connectors
Rather than one plugin per source (heavy: manifest+widget each), use a single
`plugins/discovery/` plugin whose `feed_fetch(ctx)` runs the **router** (§5)
over a registry of connector classes in `plugins/discovery/connectors/`. Adding
a source = adding one file + registering it. One settings widget
(`settings.feeds` slot) manages Places, Feeds, and per-connector keys. This
keeps the existing plugin contract intact while making sources cheap to add.

---

## 5. Discovery feed composition & routing

`feed_fetch(ctx)` (the `feed.fetch` hook) does:

1. Load enabled `DiscoveryFeed`s.
2. For each feed: resolve `place`, expand `subjects` (incl. `@yamtrack-artists`
   pulled live from CT150), list `categories`, compute the date `window`
   (default: now → +90 days).
3. **Route:** for each connector, intersect `connector.provides ∩
   feed.categories` and `connector.consumes ∩ subject facet types`. If non-empty
   (and location available when `needs_location`), call `connector.fetch(...)`
   with only the relevant slice.
4. Collect `FeedDraft`s → score (§7) → dedup → return to `core/feed.py`'s
   `_upsert_item` (FeedItems) and create calendar `Event`s where
   `feed.create_events`.

Routing table (initial):

| Connector       | provides                                   | consumes              | location | egress      |
|-----------------|--------------------------------------------|-----------------------|----------|-------------|
| `ticketmaster`  | concerts, theatre, festivals, sports, film | genre, place          | yes      | vpn         |
| `bandsintown`   | concerts                                   | artist, place(filter) | filter   | vpn         |
| `ics`           | any (whatever the calendar holds)          | venue, museum, place  | optional | vpn         |
| `city-opendata` | concerts, exhibitions, talks, theatre      | place, genre          | yes      | vpn         |
| `museum-scrape` | exhibitions                                | museum, place         | yes      | residential |

Per-connector results carry `score_breakdown.connector` so the UI can show
provenance and you can mute a flaky source.

---

## 6. Source connectors (phased by effort/coverage)

### Tier 1 — APIs (no scraping, build first)

**6.1 Ticketmaster Discovery API** — the workhorse.
- Free key (5k req/day, 5/sec). One email-registered key (R2: VPN-only lane).
- `GET /discovery/v2/events.json?city=&latlong=&radius=&unit=km&
  classificationName=&keyword=&startDateTime=&endDateTime=&apikey=`.
- `classificationName` → our categories: Music→concerts, "Arts & Theatre"→
  theatre/festivals, Sports→sports, Film→film.
- Maps `_embedded.events[]` → drafts; `external_id = "tm_" + event.id`; event
  block from `dates.start.dateTime` + `_embedded.venues[0]`.
- Decent ES/EU coverage. Covers 4 of 5 categories from one connector.

**6.2 Bandsintown** — indie gigs Ticketmaster misses.
- Free arbitrary `app_id` (R2). `GET https://rest.bandsintown.com/artists/
  id_<MBID>/events?app_id=` (MBID match is reliable).
- Subjects = `artist` facets, auto-synced from yamtrack:
  - **New endpoint on yamtrack (CT150)**: token-guarded
    `GET /integrations/api/music/artists/<token>` reusing the existing
    per-user `User.token` (same pattern as jellyfin/plex webhooks:
    `@login_not_required`, `User.objects.get(token=token)`), returning
    `[{name, mbid, source, score}]`. (This was planned as task #19 — still the
    cleanest source.)
  - The `bandsintown` connector pulls that list (LAN egress, direct to CT150),
    filters events to the feed's `place` by haversine.
- Per-artist result cache in `ctx.fs` (~12 h TTL) to be polite + cut egress.

### Tier 2 — open data / ICS (cheap, high value)

**6.3 Galician Axenda Cultural connector — ⭐ the focus-region workhorse.**
The Xunta de Galicia publishes the *Axenda de cultura de Galicia* as official
open data (`abertos.xunta.gal` dataset **0045**): one feed covering **all
Galician concellos**, with events typed (`espectáculo | concerto | obradoiro |
exposición …`) — i.e. concerts + exhibitions + theatre + workshops in a single
source, filterable by concello, type, organizer, audience. No key, no scraping.
For the focus region this single connector beats both Ticketmaster (thin in
Galicia) and per-museum scraping, so it's promoted to **P1**.
- Distributions (verified 2026-06-07):
  - JSON web service — `https://abertos.xunta.gal/catalogo/cultura-ocio-deporte/-/dataset/0045/axenda-cultura-galicia/103/acceso-aos-datos.json`
  - ICS — `…/dataset/0045/axenda-cultura-galicia/102/acceso-aos-datos.calendario`
  - RSS — `…/dataset/0045/axenda-cultura-galicia/101/acceso-aos-datos.rss`
  - JSON has a published manual (PDF on the dataset page) — confirm exact query
    params (concello/type/date) against it during P1; fall back to client-side
    filter if the service returns the full set.
- `consumes: {place, genre}`, `provides: {concerts, exhibitions, theatre,
  festivals, talks}`, `needs_location: yes` (region or concello), `egress: vpn`.
- Region-scope Place "Galicia" → all concellos; city-scope Vigo/Santiago →
  filter to that concello. Maps event type → our categories; `external_id`
  from the event's stable id (or hash of title+date+concello).

**6.4 Generic ICS connector.** Many venues/museums/promoters publish `.ics`
(incl. the Axenda's own ICS above as a zero-code fallback). Config: list of
`{ics_url, category, venue, place_id?}` (per-`venue`/`museum` facet or global).
Parse VEVENTs → drafts. Zero per-source code.

**6.5 Other-city open-data agendas (secondary).** Per-city adapters for the
non-Galician Places: **Madrid** (datos.madrid.es agenda), **Barcelona** (Open
Data BCN agenda cultural), **Bilbao** (open-data / Bilbao Turismo). Same shape
as 6.3. Lower priority than Galicia; built when those Places get used (P4+).

### Tier 3 — scraping (museums/exhibitions, indie venues)

No universal exhibitions API exists → per-source "recipes."
- **Config-driven scraper:** a recipe = `{url, egress: residential|vpn,
  row_selector, fields:{title, date, url, ...}, date_format}`. Adding a museum =
  adding a recipe (JSON), not code. `httpx`+`selectolax` for plain pages;
  **byparr (CT124)** for Cloudflare-protected ones (R1 residential lane;
  single-flight + cache results, per the byparr note).
- Start with a handful of museums tied to `museum` facets; expand opportunistically.
- Polite: per-domain rate limit, `ctx.fs` cache, respect `robots` where present.

**6.6 Social bridge — "weird locals" (IG/FB-only venues). Last-resort tier.**
User wants small venues that may only have an Instagram/Facebook page. Reality
(verified 2026-06-07):
- **Instagram** has *no* official RSS and no read API for accounts you don't own
  (Basic Display API shut down Dec 2024; Graph API = own accounts only).
- **Facebook** killed native RSS in 2015; the Events Graph edge was gutted
  post-2018 → no arbitrary public-event query.
- All "IG/FB RSS" is therefore **unofficial scraping**, fragile and maintenance-
  heavy.
Approach (cheap because it reuses the existing `rss-feed` plugin):
1. Stand up a **self-hosted RSSHub or RSS-Bridge** (small new LXC; route via
   byparr residential IP, optional throwaway IG cookie) → turns a handle into a
   normal RSS URL. Keeps it private/in-house vs paid SaaS (RSS.app/RSSground,
   which would see our queries).
2. A `venue` facet carries optional `{instagram, facebook}` handles; a
   `social-bridge` resolver maps handle → bridge RSS URL → feeds the generic
   RSS/ICS connector.
3. **Extraction pass:** posts are not events → emit *low-confidence drafts* into
   a **review inbox** (FeedItem with `payload.needs_review=true`, low score); the
   user confirms/edits before they become calendar Events. Date/venue from
   caption via regex + LLM; **flyer-only posts (event info baked into the image)
   need OCR/vision** — the genuinely hard tail, deferred.
**Prefer the non-social surface first:** most "weird locals" also have an
own-site listing/ICS, or are already on Bandsintown / the Galician Axenda — try
those before the social bridge. Social is explicitly best-effort + manual-review.

Dropped/avoided sources (documented so we don't revisit): **Eventbrite** (public
search API removed ~2020) and **Meetup** (Pro-only API) — both only reachable by
scraping now, deferred to Tier 3 if ever.

---

## 7. Scoring & dedup

- **Base score** per draft from connector confidence + facet match strength
  (exact artist MBID > genre keyword > city-wide listing).
- **Boosts:** subject `Interest`/`Rating` (you rated the artist highly in
  yamtrack), proximity (closer = higher), soonness (this week > next month).
- **Suppression:** reuse the existing keyword/tag dislike mechanism if present;
  honor `feed.min_score`.
- **Dedup:** same gig from Ticketmaster + Bandsintown + a venue ICS → merge on
  `(normalized title, date, venue)`; keep the richest payload, union sources in
  `score_breakdown.connector`.

---

## 8. UI

One `DiscoveryWidget` in the `settings.feeds` slot (matches `rss-feed`), tabs:
- **Places** — add/edit Place (city geocode via a privacy-respecting geocoder,
  radius, precision, set-home).
- **Feeds** — compose a DiscoveryFeed: pick Place + categories (checkboxes) +
  subjects (artists from yamtrack / genres / specific venues-museums) + min-score
  + "create calendar events" + Refresh-now. Live list of upcoming results.
- **Sources** — per-connector enable + keys (Ticketmaster key, Bandsintown
  app_id, ICS urls, scrape recipes), egress lane indicator, last-run status.

Results flow into the existing per-interest feed view and (opt-in) the calendar.

---

## 9. Phases

Reordered to front-load **Galicia** (user's focus, 2026-06-07).

- **P0 — Facet model + router skeleton.** Migration (`Place`, `InterestFacet`,
  `DiscoveryFeed`); `plugins/discovery/` with `feed_fetch` router + connector
  registry; `[discovery]` config incl. `egress_proxy`; egress-aware `ctx.http`.
  No real source yet → wire a stub connector + tests. Seed the 6 Places (§3.1).
- **P1 — Galician Axenda Cultural connector** (§6.3). The focus-region payoff:
  one keyless open-data source → concerts + exhibitions + theatre across all
  Galician concellos. Validates the whole pipeline (route → fetch → score →
  FeedItem + Event) end-to-end with **no API key and no scraping**. Needs only
  the Galicia/Vigo/Santiago Places (already seeded).
- **P2 — Ticketmaster connector** (§6.1). Adds big-venue Galicia shows + full
  coverage for the secondary cities (Madrid/Barcelona/Bilbao). *Needs the free
  key entered in the Sources UI.*
- **P3 — Bandsintown + yamtrack artist endpoint** (task #19) + artist-facet
  auto-import. Per-artist cache. Indie gigs for your library's artists.
- **P4 — DiscoveryWidget UI** (Places / Feeds / Sources tabs).
- **P5 — Generic ICS connector + secondary-city open-data** (Madrid/BCN/Bilbao).
- **P6 — Config-driven scraper + first Galician museum recipes** (byparr lane):
  CGAC, MARCO Vigo, Cidade da Cultura, Museo do Mar — exhibitions the Axenda
  misses.
- **P7 — Social bridge (§6.6)** — self-hosted RSSHub/RSS-Bridge LXC + venue
  `{instagram,facebook}` handles → review-inbox drafts. Best-effort. Flyer
  OCR/vision split out as P7b if worthwhile.
- **P8 — Scoring/dedup polish, suppression, calendar integration, roadmap note.**

P0–P2 already give a working Galicia-focused feed (local culture + ticketed
events) with zero scraping. P3 adds your artists; P5–P6 fill indie/museum gaps;
P7 is the best-effort IG/FB tail. Each phase committed on a `feat/discovery`
branch.

**P0 also fixes a found bug** (like the vault-sync `register_routes` one): the
feed pipeline is currently dead — `core/feed.py` calls `PluginContext(session)`
but the constructor needs `(plugin_id, session, data_root, _settings)`, so
`run_fetch()` `TypeError`s every tick and rss/linkwarden have never fetched. P0
rebuilds the fetch loop to construct a correct **per-plugin** ctx (revives those
plugins too) + extends `_upsert_item` to optionally create a calendar `Event`
from a draft's `event` block when `draft.create_event`.

---

## 10. Egress / infra notes

- Build/deploy gotchas inherited from vault-sync: CT151 venv is uv-managed
  (no pip/pytest → manual `PYTHONPATH=backend .venv/bin/python` test harness);
  run git as `su gyst`; `alembic upgrade head` auto-runs on boot; **vite build**
  needs `NODE_OPTIONS=--max-old-space-size=1400` at 1024 MB RAM (no `pct set
  --memory` bump needed), built as `su gyst`, dist served by FastAPI static.
- Egress (RESOLVED 2026-06-07): CT151 default route already exits via Mullvad
  (verified). `[discovery] egress_proxy` defaults to `""` (use default route);
  optional force via `socks5h://10.10.10.1:1080` (CT103 microsocks, needs
  `socksio`). byparr (CT124 `192.168.1.164:8191`) = residential lane for
  scraping + social bridge.
- Plugin load: `[plugins] enabled = []` means **load all** (filter is
  `if enabled and id not in enabled`), so the new `discovery` plugin auto-loads
  with no toml change.

---

## 11. Configuration & prerequisites

**All user-facing config is entered in the UI at runtime** (the `DiscoveryWidget`
`Places` / `Sources` tabs → `PluginSetting`), never hardcoded or committed —
same pattern as the in-app GitHub PAT / Wallabag creds. None of it is a *build*
prerequisite; the connectors are city-agnostic and read whatever's been entered.

UI-entered (no code coupling):
- **Home city / location** → `Places` tab (geocoded to centroid; exact coords
  opt-in per R3).
- **Ticketmaster Discovery API key** → `Sources` tab (free,
  developer.ticketmaster.com; the one email-linked credential, VPN-only lane).
- **Bandsintown app_id** → `Sources` tab (any arbitrary string, no signup).

Locations resolved (2026-06-07): **Galicia = home/focus** (Vigo + Santiago de
Compostela), secondary Madrid/Barcelona/Bilbao — seeded as Places in P0 (§3.1).

The genuine non-UI items:
- **City/region open-data adapters** are the only place a location couples to
  code (each portal's API differs). For the focus region this is the **Galician
  Axenda connector (P1, §6.3)** — endpoints already verified. Secondary cities
  (Madrid/BCN/Bilbao) get their own adapters in P5. Everything else
  (Ticketmaster, Bandsintown, ICS, scraper) is generic.
- **CT103 Mullvad proxy port** (infra, R1 egress lane) — confirm CT103 exposes
  an HTTP/SOCKS proxy reachable from CT151, or add one. Not a UI item.

Open design questions for review:
- Should results attach to **each matched subject interest**, to the
  DiscoveryFeed's own `interest_id`, or both? (Leaning: matched subject when
  there's a clear one, else the feed's interest.)
- Calendar `Event`s: auto-create for all results, or only ones you ⭐/RSVP?
  (Leaning: opt-in per feed via `create_events`, plus manual "add to calendar".)
- Geocoder choice for Places (privacy): self-hostable (Nominatim/Photon) vs a
  one-off lookup. Leaning self-host or cached static city list to avoid leaking.

# GYST — Get Your Shit Together

A self-hosted personal hub for tracking **interests** (things you consume) and **projects** (things you make). Aggregates RSS feeds, notes, calendar, media, and local telemetry into one place — with an anti-slop recommendation engine to keep you on track instead of doom-scrolling.

> Single-user, self-hosted. Designed for a Proxmox LXC container with Caddy in front.

## Features

- **Interests & projects** — track content (articles, videos, books) and your own work (music, code, research) in one namespace
- **Markdown notes** — `[[wikilink]]` syntax, backlinks, FTS5 full-text search, split editor
- **Calendar** — events with recurrence, linked to interests
- **Media uploads** — drag-drop, audio player with waveform seek, image gallery, tab/MIDI files
- **Feed aggregator** — RSS/Atom per-interest subscriptions, scheduled fetch, unread badge
- **Music project tools** — alphaTab tab renderer, Tone.js polysynth, Web MIDI input, sample browser, lyrics editor
- **Linkwarden integration** — imports bookmarks as feed items, matches collections to interests
- **Telemetry dashboards** — browser history heatmap, daily activity chart, top domains
- **Plugin system** — drop a folder in `plugins/`, restart, done

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12 · FastAPI · SQLite WAL · SQLAlchemy 2 async · Alembic |
| Frontend | React 18 · Vite · TypeScript · Tailwind CSS · Zustand · React Router v6 |
| Plugins | In-process Python modules + React widgets via `manifest.json` |
| Deployment | LXC container · systemd · Caddy |

## Quick start (dev)

**Prerequisites:** Python ≥ 3.12, Node.js ≥ 20

```bash
git clone https://github.com/YOUR_USERNAME/gyst.git
cd gyst
```

### 1. Configure

```bash
cp gyst.toml.example gyst.toml
```

Generate a password hash and secret key:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e .
python -c "from gyst.auth import hash_password; print(hash_password('yourpassword'))"
python -c "import secrets; print(secrets.token_hex(32))"
```

Paste both values into `gyst.toml` under `[auth]`.

### 2. Run the backend

```bash
cd backend
source .venv/bin/activate
alembic upgrade head
uvicorn gyst.main:app --reload --reload-dir gyst
```

Backend runs at **http://127.0.0.1:8000** — API docs at `/api/docs`.

### 3. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** and log in.

## Project structure

```
gyst/
├── backend/
│   ├── gyst/
│   │   ├── main.py            # FastAPI app, plugin bootstrap, lifespan
│   │   ├── config.py          # pydantic-settings, reads gyst.toml
│   │   ├── db.py              # SQLAlchemy async engine + session dep
│   │   ├── auth.py            # Argon2 password + signed session cookie
│   │   ├── core/
│   │   │   ├── models.py      # All SQLAlchemy models
│   │   │   └── *.py           # Service layer per domain
│   │   ├── api/v1/            # REST routers (one file per domain)
│   │   └── plugins/           # Loader, PluginContext, hook protocols
│   ├── alembic/               # DB migrations
│   └── tests/
├── frontend/
│   └── src/
│       ├── api/client.ts      # Typed fetch client
│       ├── stores/            # Zustand stores
│       ├── components/        # Shared UI components
│       ├── pages/             # Route-level pages
│       └── plugins/           # Registry, <PluginSlot>, static widget map
├── plugins/                   # First-party plugins
│   ├── hello-world/
│   ├── music-project/         # Lyrics, samples, tabs, synth
│   ├── rss-feed/              # RSS/Atom aggregator
│   └── linkwarden/            # Linkwarden bookmark integration
├── data/                      # Runtime data — gitignored
│   ├── gyst.db
│   ├── media/
│   └── telemetry/raw/
├── deploy/
│   ├── lxc-setup.md
│   ├── systemd/gyst.service
│   └── caddy/Caddyfile
└── gyst.toml                  # Main config (copy from gyst.toml.example)
```

## Plugin system

A plugin is a directory in `plugins/` with a `manifest.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "backend": "backend.py",
  "widget": "MyWidget",
  "hooks": ["feed.fetch"],
  "ui_slots": ["settings.integrations"],
  "permissions": ["http.outbound"]
}
```

**Backend hook** (`backend.py`):

```python
from gyst.plugins.api import PluginContext

async def feed_fetch(ctx: PluginContext) -> list[dict]:
    resp = await ctx.http.get("https://example.com/feed.json")
    return [{"title": i["title"], "url": i["url"], "source_plugin": "my-plugin",
             "external_id": i["id"], "score": 0.5, "score_breakdown": {}} for i in resp.json()]

def register_routes(router):   # optional — mounts at /api/v1/plugins/my-plugin/
    @router.get("/status")
    async def status():
        return {"ok": True}
```

**Frontend widget** — a default-exported React component, registered in `frontend/src/plugins/widgets.ts` and lazy-loaded into any `<PluginSlot name="..." />`:

```tsx
export default function MyWidget(props: Record<string, unknown>) {
  return <div>Hello from {String(props.interestId)}</div>
}
```

Available hooks: `feed.fetch` · `feed.normalize` · `recs.feature` · `telemetry.ingest`

UI slots: `sidebar.nav` · `feed.card.actions` · `settings.feeds` · `settings.integrations` · `interest.project`

## Configuration (`gyst.toml`)

```toml
[server]
host = "127.0.0.1"
port = 8000

[auth]
password_hash = ""       # python -c "from gyst.auth import hash_password; print(hash_password('pw'))"
secret_key    = ""       # python -c "import secrets; print(secrets.token_hex(32))"
session_ttl_days = 30

[data]
root = "./data"

[plugins]
enabled = []             # empty = all discovered; or ["rss-feed", "linkwarden"]
directory = "./plugins"

[recs]
embedding_model = "all-MiniLM-L6-v2"
w_embed  = 0.5
w_tag    = 0.3
w_rating = 0.15
w_slop   = 0.05
```

Environment variable overrides: `GYST_SERVER__PORT=9000`, `GYST_AUTH__SECRET_KEY=...`

## Deployment (LXC)

See [`deploy/lxc-setup.md`](deploy/lxc-setup.md) for full instructions.

```bash
# Inside the container
cd /opt/gyst
./scripts/build.sh
systemctl start gyst
systemctl reload caddy
```

## Browser history telemetry

Sync Firefox history from your laptop via cron:

```bash
rsync -az ~/.mozilla/firefox/*.default-release/places.sqlite \
  gyst-host:/opt/gyst/data/telemetry/raw/places.sqlite
```

The `browser-history` plugin (in progress) parses it incrementally.

## Roadmap

- [x] Interests + projects + notes + wikilinks + FTS5 search
- [x] Calendar with event CRUD
- [x] Media uploads (audio, images, files)
- [x] Plugin system with manifest + UI slots
- [x] RSS/Atom feed aggregator (per-interest subscriptions)
- [x] Linkwarden bookmark integration
- [x] Music project: tab renderer (alphaTab), polysynth (Tone.js), Web MIDI, lyrics, samples
- [x] Telemetry dashboards (heatmap, daily chart, top domains)
- [ ] Containerize: LXC provisioning, systemd, Caddy TLS
- [ ] Recommendations engine (sentence-transformers + anti-slop scorer)
- [ ] Search page / modal (FTS5 backend ready)
- [ ] Browser history parser plugin
- [ ] ytfront / redlib / Kavita plugins
- [ ] Steam playtime telemetry
- [ ] Mobile app (Capacitor)

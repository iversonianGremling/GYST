# Telemetry rsync setup

GYST expects browser history dumps in `data/telemetry/raw/` on the server.
The `browser-history` plugin (post-MVP) reads from there incrementally.

## Directory layout

```
data/telemetry/raw/
├── firefox/
│   └── places.sqlite          # rsync'd from ~/.mozilla/firefox/<profile>/places.sqlite
└── chrome/
    └── History                # rsync'd from ~/.config/google-chrome/Default/History
```

## Cron (laptop → server)

Add to laptop's crontab (`crontab -e`):

```cron
# Every 30 min, sync Firefox history to GYST server
*/30 * * * *  rsync -az --no-perms \
  ~/.mozilla/firefox/$(ls ~/.mozilla/firefox/ | grep default | head -1)/places.sqlite \
  gyst-server:/home/gyst/data/telemetry/raw/firefox/places.sqlite

# Chrome / Chromium — close Chrome first or use a copy to avoid lock contention
*/30 * * * *  rsync -az --no-perms \
  ~/.config/google-chrome/Default/History \
  gyst-server:/home/gyst/data/telemetry/raw/chrome/History
```

Replace `gyst-server` with your Proxmox LXC hostname or IP (add to `~/.ssh/config`).

## SSH key setup

On the laptop:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/gyst_sync -N ""
ssh-copy-id -i ~/.ssh/gyst_sync.pub gyst-server
```

Then reference the key in `~/.ssh/config`:
```
Host gyst-server
  HostName 192.168.1.xxx
  User gyst
  IdentityFile ~/.ssh/gyst_sync
```

## Manual ingest via API

Alternatively, push events directly with no rsync:

```bash
curl -s -X POST https://gyst.local/api/v1/telemetry/ingest \
  -H 'Content-Type: application/json' \
  -b 'gyst_session=<token>' \
  -d '[
    {
      "source": "browser",
      "ts": "2026-05-16T10:30:00",
      "kind": "visit",
      "target_url": "https://example.com",
      "duration_s": 120
    }
  ]'
```

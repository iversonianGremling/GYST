# GYST — Versioning, Sync & Project Structures Design

Status: **Draft for review** · Owner: vde · Date: 2026-06-06
Target app: GYST (CT151, `/opt/gyst`, FastAPI + SQLite + React)

This doc has two parts:
- **Part I — Vault sync:** version control + desktop sync of GYST notes/projects via
  a markdown vault + Gitea (CT156). Sections 1–11.
- **Part II — Project type structures & integrations:** proper per-type structures
  for `code` and `research` projects (today they wrongly reuse the *music* layout),
  plus **two-way GitHub sync** for code projects. Sections 12–18.

## 1. Goal

Give GYST **version control** over its projects and notes ("nodes") and let those
sync bidirectionally with **desktop apps using free tools**, including:

- Real `git push`/`pull` from free desktop clients (VS Code, GitHub Desktop, the
  Obsidian-git plugin on CT130, plain `git`).
- Edit on the desktop → changes reflect back inside GYST.
- Versioned history + restore (browse, diff, revert).
- **Automatic merge-conflict detection with markers and an in-app resolver**, so
  conflicts are resolved *inside GYST*, not on the command line.
- Per-folder opt-in: choose which folders synchronize.

Decisions locked with the user:
- **Transport: Gitea** on a new container **CT156** (primary version control).
- **Scope: full bidirectional + in-app resolver** (all 4 phases below).
- This document precedes any code.

## 2. The core idea: a Markdown "vault" bridge

GYST stores everything in SQLite (`data/gyst.db`). That data splits in two:

| Mergeable text (version it) | Structural / derived (DB-only, rebuildable) |
|---|---|
| `Note.body_md` — the "nodes" | folder tree* , `Link` (wikilinks)* , `Tag`/`Tagging`* |
| `Interest`/`Project` description + settings | `Rating`, `TelemetryEvent`, `FeedItem` |
| `Event.body_md` | `Embedding`, `note_fts*` (FTS index) |

`*` The user-meaningful structural bits (folder path, tags, wikilinks) are
**encoded into Markdown frontmatter** so they survive a desktop round-trip.
Purely derived data (embeddings, FTS, telemetry, feed) stays DB-only and is
simply rebuilt after import.

Git and desktop editors are excellent at the left column and hostile to raw
SQLite. So we **materialize the editable content as a file tree (the "vault")**,
version *that* with git, and treat SQLite as a reconstructable index. GYST is
already shaped for this: notes have `slug`, `body_md`, `[[wikilinks]]`
(`_extract_wikilinks` in `api/v1/notes.py`), folders carry `entity_type`, and
media is already on-disk files with `sha256` (`MediaAsset`).

### Architecture

```
                       ┌─────────────── CT151 GYST ───────────────┐
   SQLite (truth) ◄──► │  vault-sync engine (new: gyst/sync/)      │
                       │   • materialize Notes/Projects → .md      │
   data/vault/  ◄──────┤     (YAML frontmatter: id, tags, links…)  │
   (git working tree)  │   • inotify watcher: file edits → DB      │
                       │   • 3-way conflict detect + markers       │
                       │   • in-app conflict resolver (new UI)     │
                       └──────────┬────────────────────────────────┘
                                  │ git push/pull (token auth)
                       ┌──────────▼─────────┐
                       │  CT156  Gitea      │  free history / web diff / revert
                       └──────────┬─────────┘
              git clone / pull    │
                       ┌──────────▼─────────────────────────────┐
          Desktop:  VS Code · GitHub Desktop · Obsidian-git (CT130) · git CLI
```

## 3. Vault layout & file format

**One git repo per project** (locked). `data/vault/` holds *N* independent git
repos — one per sync-enabled Interest/Project, each with its own `.git` and its
own Gitea remote — plus one `personal/` repo for loose notes not tied to a
project. This matches "clone just the project I'm working on" and keeps history
scoped per project.

```
data/vault/
  personal/                     # repo: loose notes / content interests
    .git/  .gyst/
    notes/<folder-path>/<note-slug>.md
    content/<interest-slug>/_index.md
  <project-slug>/               # repo: ONE project  (own .git, own Gitea remote)
    .git/                       #   origin = CT156 gitea:gyst/<project-slug>.git
    .gitattributes              #   git-lfs filters for media (see below)
    .gyst/sync-state.json       #   per-path: last_synced_hash, last_synced_commit
    _index.md                   #   the Interest/Project (description, settings)
    notes/<note-slug>.md        #   Notes ("nodes"), nested by folder path
    media/                      #   media committed IN-repo via git-lfs (locked)
  <other-project-slug>/ ...
```

- **Media in-vault (locked):** media is committed into the project's repo under
  `media/`, tracked by **git-lfs** (`.gitattributes`: `media/** filter=lfs`).
  Gitea has a built-in LFS server, so no extra service. (Supersedes the earlier
  "exclude media" lean.)
- Folder hierarchy (`Folder.parent_id`) maps to **directory nesting** *within a
  repo*; only folders with `sync_enabled = true` are materialized.
- A project's `sync_enabled` flip = create its Gitea repo + `git init` its vault
  dir; un-sync = stop committing (repo retained).

### Note file format

```markdown
---
gyst_id: 7c1f…           # stable UUID — identity survives rename/move
type: note
title: My Note
slug: my-note
interest: <interest-slug or null>
folder: research/papers   # path; drives directory placement
tags: [reading, ml]
pinned: false
created_at: 2026-06-01T12:00:00Z
updated_at: 2026-06-05T09:30:00Z
---

# My Note

Body markdown here, with [[wikilinks]] preserved verbatim.
```

`_index.md` for an Interest/Project uses `type: project` (or `content`) and
carries `status`, `project.type`, and `settings` (as a YAML block) in frontmatter.

**Identity rule:** `gyst_id` is authoritative. Rename/move on desktop = same
`gyst_id`, new path → GYST updates `slug`/`folder_id`, not a new row. New file
without `gyst_id` (created on desktop) = GYST mints a row and writes the id back.

## 4. Sync engine (new module `backend/gyst/sync/`)

```
sync/
  __init__.py
  vault.py        # paths, frontmatter (de)serialize, slug<->path mapping
  export.py       # DB row  -> .md file  (materialize)
  importer.py     # .md file -> DB row  (reconcile on gyst_id)
  gitrepo.py      # thin wrapper: init, add, commit, pull, push, merge-file
  watcher.py      # watchdog observer on data/vault/, debounced queue
  conflict.py     # 3-way merge, marker injection, conflict records
  state.py        # .gyst/sync-state.json read/write
  service.py      # orchestration; hooks into scheduler + lifespan
```

### 4.1 Change tracking & loop prevention

- Per path we store `last_synced_hash` (sha256 of canonical file bytes) and
  `last_synced_commit` in `.gyst/sync-state.json` **and** a new DB column set on
  the row (see migration §6).
- **Origin tagging:** when GYST writes a file itself, it records the new hash in
  state *before* releasing the watcher; the watcher ignores events whose on-disk
  hash already equals the recorded `last_synced_hash`. This breaks the
  DB→file→watcher→DB loop. Watcher events are also debounced (~750 ms) per path.

### 4.2 Conflict model (3-way)

On an inbound file change for `gyst_id`:

```
base   = content at last_synced_commit (git show)
ours   = current DB body (materialized canonically)
theirs = current file on disk
```

- If `ours == base` → fast-forward: import `theirs` into DB.
- If `theirs == base` → no real change (or our own write) → ignore.
- Else → run `git merge-file -p ours base theirs`:
  - clean merge → write merged to both DB and file, commit.
  - conflict → write the file **with `<<<<<<< / ======= / >>>>>>>` markers**,
    create a `SyncConflict` row (status=open), and surface it in the resolver UI.
    The note is flagged `conflicted` and excluded from auto-export until resolved.

Frontmatter conflicts (tags/folder/etc.) are merged field-wise; only true
divergences become markers (rendered as a small YAML conflict block).

### 4.3 Commit / push policy

- Auto-commit on debounced change batches (author `GYST <gyst@local>`), message
  like `gyst: update <slug> (+1 note)`.
- `pull` on a scheduler interval (default 2 min) and on app start; `push` after
  each successful local commit. Auth via a Gitea **deploy token** stored in
  `gyst.toml` (`[sync]` section), never in the repo.
- Network failures are non-fatal: local commits queue; resync on next tick.

## 5. Gitea on CT156

- New unprivileged LXC (Debian), Gitea binary or `docker`-less native install,
  SQLite backend (single-user scale), **LFS enabled**, bound to LAN; reverse-proxy
  via CT113 (nginxproxymanager) as `gitea.<lan-domain>` — consistent with the
  existing stack.
- **One Gitea repo per project** under a `gyst` org/user:
  `gyst/<project-slug>.git`, plus `gyst/personal.git`. GYST **auto-creates** each
  repo via the Gitea API when a project's `sync_enabled` is turned on, using a
  single admin/API token. (Decision locked: per-project repos, not one mono-vault.)
- Desktop clients clone the specific project they want,
  `http(s)://gitea…/gyst/<project-slug>.git`. Free options: VS Code Git, GitHub
  Desktop, Obsidian-git (CT130 already runs Obsidian — vault is Obsidian-compatible
  markdown), or plain `git`.
- Backups: fold the Gitea container into the existing `pve-lxc-backup` routine.

## 6. Schema changes (Alembic migration)

Additive only — safe, reversible.

```
folder.sync_enabled        BOOL  default false   # per-folder opt-in
note.vault_path            STR   nullable         # materialized location
note.last_synced_hash      STR   nullable
note.last_synced_commit    STR   nullable
note.sync_status           STR   default 'clean'  # clean|dirty|conflicted
interest.sync_enabled      BOOL  default false
# new table:
sync_conflict(id, target_type, target_id, vault_path,
              base_blob, ours_blob, theirs_blob,
              status='open|resolved', created_at, resolved_at)
```

Same async session pattern as `db.py`; new model in `core/models.py`.

## 7. Backend API additions (`api/v1/sync.py`)

```
GET    /api/v1/sync/status              # ahead/behind, dirty count, conflicts
POST   /api/v1/sync/pull                # manual pull
POST   /api/v1/sync/push                # manual push
GET    /api/v1/sync/conflicts           # list open SyncConflict
GET    /api/v1/sync/conflicts/{id}      # base/ours/theirs for the resolver
POST   /api/v1/sync/conflicts/{id}/resolve  # body: merged content + choice
PATCH  /api/v1/folders/{id}             # extend: set sync_enabled
GET    /api/v1/sync/history?path=…      # git log for a note (restore UI)
POST   /api/v1/sync/restore             # checkout a path@commit
```

## 8. Frontend additions

- **Sync status pill** in the app chrome (clean / N dirty / N conflicts), polling
  `/sync/status`.
- **Conflict resolver page** (`pages/SyncConflicts.tsx`, route in `routes.tsx`):
  list of conflicts → 3-pane view (theirs | merged-editable | ours) with
  "use mine / use theirs / keep both" and a save that calls `…/resolve`.
- **Folder sync toggle** in folder settings (drives `sync_enabled`).
- **History/restore** affordance on a note (git log → pick commit → restore).

## 9. Phasing & task breakdown

**Phase 1 — Foundation (read-only export, zero risk).** Branch
`feat/vault-sync`.
- `sync/vault.py` + `export.py`: materialize Notes/Projects → `.md` with
  frontmatter; canonical serializer (stable key order, LF, trailing newline).
- `git init data/vault`, initial commit. No import, no watcher yet.
- Unit tests: round-trip serialize/parse; slug↔path mapping.
- Reversible: deleting `data/vault/` undoes everything.

**Phase 2 — Gitea + selection + auto-commit.**
- Provision CT156 Gitea; repo + deploy token; `[sync]` config.
- `gitrepo.py` push/pull; folder `sync_enabled` migration + toggle.
- Auto-commit on DB writes (hook note/project create/patch/delete).
- Now: full versioned history, browsable in Gitea, restorable.

**Phase 3 — Inbound import (desktop → DB), bidirectional.**
- `watcher.py` (watchdog) + debounce + origin-tagging (loop prevention).
- `importer.py`: reconcile on `gyst_id`; handle create/update/rename/move/delete.
- Rebuild derived data (FTS, wikilinks via existing `_sync_wikilinks`) on import.

**Phase 4 — Conflict detection + in-app resolver.**
- `conflict.py` 3-way merge + marker injection + `SyncConflict` records.
- Sync API endpoints; resolver page + status pill + history/restore UI.

## 10. Risks & mitigations

- **Sync loops** → hash-based origin tagging + debounce (§4.1). Highest-risk item;
  Phase 3 ships behind a config flag and gets heavy testing on a throwaway vault.
- **Data loss on bad merge** → never destructive: conflicts always preserve both
  sides as markers + stored blobs in `SyncConflict`; git history is the backstop.
- **Identity drift on rename** → `gyst_id` frontmatter is authoritative (§3).
- **Secrets in repo** → tokens only in `gyst.toml` (gitignored); `.gyst/` holds no
  credentials.
- **Large/binary media** → committed in-vault via **git-lfs** (locked); Gitea's
  built-in LFS server holds the blobs so repos stay light. Watch LFS quota/backups.
- **Scope creep** → derived data (embeddings/FTS/telemetry/feed) is explicitly
  out of sync scope; rebuilt locally.

## 11. Resolved decisions (Part I)

1. **Media:** commit into the vault via **git-lfs**. ✓
2. **Granularity:** **one repo per project** (+ a `personal` repo). ✓
3. **Events/calendar:** **not included** — deferred, out of scope for now. ✓
4. **Gitea install:** **proceed** with CT156. (Method: native binary unless you
   say otherwise — leaner than distro packaging, current upstream version.)

---

# Part II — Project type structures & integrations

## 12. Problem

Project "structure" is delivered by a **plugin** that ships a backend
(`plugins/<id>/backend.py`) plus a frontend **widget** mounted in the
`interest.project` UI slot. Today `music-project` is the *only* such plugin, and
`PluginSlot` (`frontend/src/plugins/slots.tsx`) renders **every** plugin in that
slot regardless of `Project.type`. `InterestDetail.tsx` already passes
`projectType` into the slot (`:319`) but nothing filters on it.

Result: `code` and `research` projects (both selectable in `Projects.tsx`, and
valid `Project.type` values) render music's **Lyrics / Samples / Tabs / Synth**
tabs. We want real, type-appropriate structures.

Decisions locked with the user (2026-06-06): **two-way** GitHub sync from the
start · **clone** the repo (not metadata-only) · research sources = **standalone
manager + import** from Linkwarden (CT132)/Wallabag (CT145) · build **after vault
Phase 1**, folded into this doc.

## 13. Per-type dispatch (small shared change)

- Add optional `project_types: [...]` to plugin `manifest.json` (absent/empty =
  show for all types). Surface it in `PluginManifest`
  (`backend/gyst/plugins/loader.py`) and the `/api/v1/plugins` payload + the
  frontend `Plugin` type.
- `PluginSlot` filters: render a plugin's widget only if `projectType` ∈
  `plugin.project_types` (or it's empty). `InterestDetail` already supplies
  `projectType`.
- Set `music-project` manifest → `"project_types": ["music"]`. Immediately stops
  music bleeding into code/research. `generic` projects show no project widget
  (just the existing Notes/Media/Feeds tabs).

## 14. `code-project` plugin

Manifest: `id: code-project`, `widget: CodeProjectWidget`,
`ui_slots: ["interest.project"]`, `project_types: ["code"]`.

**Widget tabs**
- **Overview** — repo README (rendered from the clone), metadata (language, last
  push, default branch), open issue/PR counts, sync status pill.
- **Issues** — mirrored GitHub issues + local todos in one list (two-way, §16).
- **Pull requests** — list + state (read-mostly; comments two-way optional later).
- **Activity** — recent commits (from the clone) + PR timeline.
- **Notes** — architecture/decision notes = normal GYST `Note`s, so they ride the
  **vault → Gitea** sync from Part I. (Code in GitHub, notes about it in Gitea.)
- **Settings** — link `owner/repo`, branch, clone path, sync direction toggle.

**Backend routes** (`plugins/code-project/backend.py`)
```
POST   /link/{interest_id}        # {repo_url, branch} -> store + initial clone+sync
DELETE /link/{interest_id}        # unlink (keep or drop clone)
GET    /status/{interest_id}      # ahead/behind, last_synced_at, dirty/conflict counts
POST   /sync/{interest_id}        # manual pull+push
GET    /issues/{interest_id}      # mirrored issues
POST   /issues/{interest_id}      # create local -> pushed to GitHub on next sync
PATCH  /issues/{interest_id}/{n}  # edit (flips dirty flag; pushed on sync)
GET    /pulls/{interest_id}
GET    /commits/{interest_id}
```

## 15. Repo clone management

- Clones live at `data/repos/<interest_id>/` — **outside** the vault and
  `.gitignore`d from it (already versioned on GitHub; too large to double-track).
- Clone/fetch via `git` with a credential helper feeding the PAT
  (`GIT_ASKPASS`/`-c http.extraheader`), never embedding the token in the remote
  URL on disk.
- **"Two-way" scope clarification:** code itself is *fetch/clone only* — you edit
  code in your IDE and push from there, not from GYST. The two-way behaviour
  applies to **issues** (and later PR comments), not to source files. The clone
  exists for in-app browsing/README/commit history and to keep a fresh local copy.
- Keep clones fresh on the scheduler interval; expose read-only file browse in the
  Overview tab.

## 16. GitHub sync engine (`backend/gyst/sync/github.py`)

- GitHub REST API via `httpx` (add dep if missing on CT151), authed with a
  **fine-grained PAT** (scopes: Contents read, Issues read/write, Pull requests
  read) stored in `gyst.toml` `[github] token = "..."` (gitignored). Single token,
  single-user. CT151 has `git` but **no `gh`**; we use the REST API + `git`
  directly rather than depending on `gh`.
- **Mirror tables** (new): `code_repo(interest_id, owner, repo, default_branch,
  clone_path, last_synced_at, etag, ahead, behind)` and
  `gh_issue(interest_id, number, title, body, state, labels JSON,
  last_synced_hash, sync_status, updated_at)`.
- **Two-way issues = same model as the vault** (§4.2): per-issue
  `last_synced_hash`; base = last synced, ours = local mirror, theirs = GitHub.
  Clean → apply; both changed → **`SyncConflict` with `target_type='gh_issue'`**,
  surfaced in the **same in-app resolver** built in Part I Phase 4. Local-created
  issues (no `number` yet) are POSTed to GitHub, then back-filled with the number.
- Scheduler job (APScheduler, like `scheduler.py`): `git fetch` each linked repo +
  reconcile issues, default every ~10 min; plus manual `/sync`.

## 17. `research-project` plugin

Manifest: `id: research-project`, `widget: ResearchProjectWidget`,
`project_types: ["research"]`.

**Widget tabs**
- **Library** — references: title, authors, year, DOI/URL, BibTeX, tags, status.
- **Literature notes** — per-source GYST `Note`s linked to a reference (ride the
  vault).
- **Findings / Outline** — a synthesis `Note`.
- **Reading queue** — references with `status` in {queued, reading, done}.
- **Settings** — import sources, default citation style.

**Backend** (`plugins/research-project/backend.py`)
- `reference` table: `(id, interest_id, kind, title, authors JSON, year, doi, url,
  bibtex, tags JSON, status, source_app, external_id, added_at)`.
- CRUD + **add-by-DOI/URL** (resolve metadata via Crossref/`doi.org` + Open Graph)
  + **BibTeX import/export**.
- **Import from existing apps** (the "both" choice): reuse the existing
  `linkwarden` plugin's API client (CT132) and add a Wallabag (CT145) client;
  import a collection/tag as references (`source_app`,`external_id` for dedup).
  Couples only optionally — standalone works with neither.

## 18. Phasing (Part II) — after vault Phase 1

- **P2.A — Dispatch + scaffolds:** `project_types` filtering; tag `music-project`;
  empty `code-project`/`research-project` plugins + widgets registered. Verifies
  type-correct rendering with no behaviour yet.
- **P2.B — Research project:** `reference` model, Library/Queue/Notes widget,
  BibTeX + DOI add. (No external deps — lands fast.)
- **P2.C — Code project, read path:** link+clone, mirror issues/PRs/commits,
  Overview/Issues/Activity tabs (read-only pull).
- **P2.D — Code project, write path:** local issue create/edit → push; two-way
  reconcile reusing `SyncConflict` + the Part I resolver. (Depends on vault
  Phase 4 resolver UI.)
- **P2.E — Research imports:** Linkwarden + Wallabag importers.

Dependency note: P2.D reuses the **conflict resolver from Part I Phase 4**, so
order is: vault P1 → P2.A/B/C (parallel-ish) → vault P2–P4 → P2.D → P2.E.

## 19. Resolved decisions (Part II)

5. **Code-project ADR notes placement:** my call → nest under the **project's own
   vault repo** (`notes/`), same as any other note. The GitHub code clone stays
   separate in `data/repos/`; the *notes about* the code live in that project's
   Gitea repo. Consistent with §3 one-repo-per-project. ✓
6. **PR comments:** **not needed** — single author, no PR discussion. Issues stay
   two-way; PRs are read-only list/state only. (Drops P2.D's PR-comment scope.) ✓
7. **Citation export:** **BibTeX first.** CSL/APA later if wanted. ✓
8. **GitHub auth:** **one fine-grained PAT for all repos**, in `gyst.toml`
   `[github]`. ✓

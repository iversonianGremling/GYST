from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON, Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gyst.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    from datetime import UTC
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "user"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    password_hash: Mapped[str] = mapped_column(String, default="")


# ---------------------------------------------------------------------------
# Taxonomy
# ---------------------------------------------------------------------------

class Tag(Base):
    __tablename__ = "tag"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)


class Tagging(Base):
    __tablename__ = "tagging"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tag.id", ondelete="CASCADE"))
    target_type: Mapped[str] = mapped_column(String)   # "interest" | "note" | "feed_item" | ...
    target_id: Mapped[str] = mapped_column(String)


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------

class Folder(Base):
    __tablename__ = "folder"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("folder.id", ondelete="CASCADE"))
    entity_type: Mapped[str] = mapped_column(String, nullable=False)  # "content" | "project" | "note"
    color: Mapped[str | None] = mapped_column(String)   # hex, e.g. "#6366f1"
    position: Mapped[int] = mapped_column(Integer, default=0)
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=False)  # materialize to vault
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    children: Mapped[list["Folder"]] = relationship(
        "Folder", back_populates="parent", cascade="all, delete-orphan",
    )
    parent: Mapped["Folder | None"] = relationship("Folder", back_populates="children", remote_side="Folder.id")


# ---------------------------------------------------------------------------
# Interests
# ---------------------------------------------------------------------------

class Interest(Base):
    __tablename__ = "interest"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String, nullable=False)   # "content" | "project"
    title: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    cover_path: Mapped[str | None] = mapped_column(String)
    cover_settings: Mapped[dict | None] = mapped_column(JSON)
    folder_id: Mapped[str | None] = mapped_column(ForeignKey("folder.id", ondelete="SET NULL"))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=False)  # materialize to vault
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    project: Mapped["Project | None"] = relationship("Project", back_populates="interest", uselist=False)
    notes: Mapped[list["Note"]] = relationship("Note", back_populates="interest")
    events: Mapped[list["Event"]] = relationship("Event", back_populates="interest")
    media_assets: Mapped[list["MediaAsset"]] = relationship("MediaAsset", back_populates="interest")


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class Project(Base):
    __tablename__ = "project"
    interest_id: Mapped[str] = mapped_column(ForeignKey("interest.id", ondelete="CASCADE"), primary_key=True)
    type: Mapped[str] = mapped_column(String, default="generic")  # music|research|code|generic
    status: Mapped[str] = mapped_column(String, default="active")
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    interest: Mapped[Interest] = relationship("Interest", back_populates="project")


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

class Note(Base):
    __tablename__ = "note"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    interest_id: Mapped[str | None] = mapped_column(ForeignKey("interest.id", ondelete="SET NULL"))
    folder_id: Mapped[str | None] = mapped_column(ForeignKey("folder.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    cover_path: Mapped[str | None] = mapped_column(String)
    cover_settings: Mapped[dict | None] = mapped_column(JSON)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    body_md: Mapped[str] = mapped_column(Text, default="")
    # Vault sync-state (docs/vault-sync.md §4.1/§6)
    vault_path: Mapped[str | None] = mapped_column(String)
    last_synced_hash: Mapped[str | None] = mapped_column(String)
    last_synced_commit: Mapped[str | None] = mapped_column(String)
    sync_status: Mapped[str] = mapped_column(String, default="clean")  # clean|dirty|conflicted
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    interest: Mapped[Interest | None] = relationship("Interest", back_populates="notes")


class Link(Base):
    __tablename__ = "link"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    src_type: Mapped[str] = mapped_column(String)   # "note" | "interest" ...
    src_id: Mapped[str] = mapped_column(String)
    dst_type: Mapped[str] = mapped_column(String)
    dst_id: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String, default="wikilink")  # wikilink|hyperlink


# ---------------------------------------------------------------------------
# Events / Calendar
# ---------------------------------------------------------------------------

class Event(Base):
    __tablename__ = "event"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    interest_id: Mapped[str | None] = mapped_column(ForeignKey("interest.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String, nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    rrule: Mapped[str | None] = mapped_column(String)   # RFC 5545 RRULE string
    body_md: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    interest: Mapped[Interest | None] = relationship("Interest", back_populates="events")


# ---------------------------------------------------------------------------
# Media
# ---------------------------------------------------------------------------

class MediaAsset(Base):
    __tablename__ = "media_asset"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    interest_id: Mapped[str | None] = mapped_column(ForeignKey("interest.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String, default="file")  # audio|image|midi|tab|file
    path: Mapped[str] = mapped_column(String, nullable=False)  # relative to data.root/media/
    sha256: Mapped[str] = mapped_column(String, nullable=False)
    mime: Mapped[str] = mapped_column(String, default="application/octet-stream")
    original_name: Mapped[str] = mapped_column(String, default="")
    duration_s: Mapped[float | None] = mapped_column(Float)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    interest: Mapped[Interest | None] = relationship("Interest", back_populates="media_assets")


# ---------------------------------------------------------------------------
# Ratings
# ---------------------------------------------------------------------------

class Rating(Base):
    __tablename__ = "rating"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    target_type: Mapped[str] = mapped_column(String)
    target_id: Mapped[str] = mapped_column(String)
    value: Mapped[int] = mapped_column(Integer, default=0)   # -1 | 0 | 1 (thumbs) or 1-5
    note: Mapped[str | None] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------------------------------------------------------------------------
# Feed
# ---------------------------------------------------------------------------

class FeedItem(Base):
    __tablename__ = "feed_item"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    interest_id: Mapped[str | None] = mapped_column(ForeignKey("interest.id", ondelete="SET NULL"))
    source_plugin: Mapped[str] = mapped_column(String)
    external_id: Mapped[str] = mapped_column(String)           # plugin-scoped dedup key
    title: Mapped[str] = mapped_column(String, default="")
    url: Mapped[str | None] = mapped_column(String)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    score: Mapped[float] = mapped_column(Float, default=0.0)
    score_breakdown: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


# ---------------------------------------------------------------------------
# Telemetry
# ---------------------------------------------------------------------------

class TelemetryEvent(Base):
    __tablename__ = "telemetry_event"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String)   # browser|steam|player|manual
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    kind: Mapped[str] = mapped_column(String)     # visit|play|purchase|...
    target_url: Mapped[str | None] = mapped_column(String)
    target_id: Mapped[str | None] = mapped_column(String)
    duration_s: Mapped[float | None] = mapped_column(Float)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------

class Embedding(Base):
    __tablename__ = "embedding"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    target_type: Mapped[str] = mapped_column(String)
    target_id: Mapped[str] = mapped_column(String)
    vec: Mapped[bytes] = mapped_column(LargeBinary)  # raw float32 LE bytes
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# ---------------------------------------------------------------------------
# Plugin settings
# ---------------------------------------------------------------------------

class PluginSetting(Base):
    __tablename__ = "plugin_setting"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_id: Mapped[str] = mapped_column(String, nullable=False)
    key: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[Any] = mapped_column(JSON)


# ---------------------------------------------------------------------------
# Vault sync conflicts (Part I, Phase 4)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Research references (Part II — research-project plugin)
# ---------------------------------------------------------------------------

class Reference(Base):
    __tablename__ = "reference"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    interest_id: Mapped[str] = mapped_column(ForeignKey("interest.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String, default="article")  # article|book|web|...
    title: Mapped[str] = mapped_column(String, nullable=False)
    authors: Mapped[list] = mapped_column(JSON, default=list)      # list[str]
    year: Mapped[int | None] = mapped_column(Integer)
    doi: Mapped[str | None] = mapped_column(String)
    url: Mapped[str | None] = mapped_column(String)
    bibtex: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list] = mapped_column(JSON, default=list)         # list[str]
    status: Mapped[str] = mapped_column(String, default="queued")  # queued|reading|done
    note: Mapped[str | None] = mapped_column(Text)                 # quick annotation
    source_app: Mapped[str | None] = mapped_column(String)         # manual|doi|bibtex|linkwarden|wallabag
    external_id: Mapped[str | None] = mapped_column(String)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SyncConflict(Base):
    __tablename__ = "sync_conflict"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    note_id: Mapped[str] = mapped_column(ForeignKey("note.id", ondelete="CASCADE"))
    ours_title: Mapped[str] = mapped_column(String, default="")    # GYST/local version
    ours_body: Mapped[str] = mapped_column(Text, default="")
    theirs_title: Mapped[str] = mapped_column(String, default="")  # incoming/desktop version
    theirs_body: Mapped[str] = mapped_column(Text, default="")
    theirs_hash: Mapped[str] = mapped_column(String, default="")   # incoming file content hash
    status: Mapped[str] = mapped_column(String, default="open")    # open|resolved
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------------------------------------------------------------------------
# Code-project local tasks (Part II — code-project plugin)
#
# Purely local TODOs for a code project. Kept separate from GitHub issues
# (a code project is local-first; GitHub is an optional remote).
# ---------------------------------------------------------------------------

class CodeTask(Base):
    __tablename__ = "code_task"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    interest_id: Mapped[str] = mapped_column(ForeignKey("interest.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="open")    # open|done
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# ---------------------------------------------------------------------------
# Music scores (Part III — music-project plugin, composition suite)
#
# A structured "score document" authored in the piano-roll / tab / sing editors.
# `doc` holds the full ScoreDoc JSON (tracks → notes with tick timing, plus
# optional per-note lyric syllables and an audio-link offset). Kept separate
# from MediaAsset (which stores uploaded/exported binary files) so editing is
# native and lossless; export to .mid happens client-side on demand.
# ---------------------------------------------------------------------------

class MusicScore(Base):
    __tablename__ = "music_score"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    interest_id: Mapped[str] = mapped_column(ForeignKey("interest.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String, nullable=False, default="Untitled")
    kind: Mapped[str] = mapped_column(String, default="midi")   # midi|tab
    doc: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# ---------------------------------------------------------------------------
# Discovery (docs/discovery.md) — composable interests → events
#
# Three facets that compose into a DiscoveryFeed:
#   Place      — a saved location (city or region) with radius.
#   InterestFacet — a typed sidecar on an Interest telling connectors HOW to
#                   query for it (artist MBID, genre keyword, venue/museum
#                   program, free topic, or a social handle).
#   DiscoveryFeed — Place × {subject interests} × {categories}; the router
#                   (plugins/discovery) fans each slice out to the connectors
#                   that can serve it and emits FeedItem + (opt) calendar Event.
# ---------------------------------------------------------------------------

class Place(Base):
    __tablename__ = "place"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    label: Mapped[str] = mapped_column(String, nullable=False)
    scope: Mapped[str] = mapped_column(String, default="city")        # city|region
    city: Mapped[str | None] = mapped_column(String)
    region: Mapped[str | None] = mapped_column(String)
    country: Mapped[str | None] = mapped_column(String)
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    radius_km: Mapped[int] = mapped_column(Integer, default=50)
    precision: Mapped[str] = mapped_column(String, default="city")    # city|exact
    is_home: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class InterestFacet(Base):
    __tablename__ = "interest_facet"
    interest_id: Mapped[str] = mapped_column(
        ForeignKey("interest.id", ondelete="CASCADE"), primary_key=True,
    )
    # artist | genre | venue | museum | topic | social
    facet_type: Mapped[str] = mapped_column(String, nullable=False)
    # shape depends on facet_type, e.g.
    #   artist -> {mbid, name}            genre  -> {genre}
    #   venue  -> {name, instagram?, facebook?, website?, ics_url?}
    #   museum -> {name, url?}            topic  -> {text}
    #   social -> {instagram?, facebook?}
    entity_ref: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    location_mode: Mapped[str] = mapped_column(String, default="place")  # place|global
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DiscoveryFeed(Base):
    __tablename__ = "discovery_feed"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    label: Mapped[str] = mapped_column(String, nullable=False)
    place_id: Mapped[str | None] = mapped_column(ForeignKey("place.id", ondelete="SET NULL"))
    categories: Mapped[list] = mapped_column(JSON, default=list)            # list[str]
    subject_interest_ids: Mapped[list] = mapped_column(JSON, default=list)  # list[str] | ["@yamtrack-artists"]
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    min_score: Mapped[float] = mapped_column(Float, default=0.0)
    create_events: Mapped[bool] = mapped_column(Boolean, default=False)
    interest_id: Mapped[str | None] = mapped_column(ForeignKey("interest.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

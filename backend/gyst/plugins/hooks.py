"""Typed hook signatures. Plugins implement whichever they declare in manifest."""
from __future__ import annotations

from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from gyst.plugins.api import PluginContext

HOOK_NAMES: frozenset[str] = frozenset(
    [
        "feed.fetch",       # async (ctx) -> list[dict]
        "feed.normalize",   # async (ctx, raw: dict) -> dict
        "recs.feature",     # async (ctx, item: dict) -> float
        "telemetry.ingest", # async (ctx, path: str) -> int  (# rows inserted)
    ]
)


@runtime_checkable
class FeedFetchHook(Protocol):
    async def feed_fetch(self, ctx: "PluginContext") -> list[dict]: ...


@runtime_checkable
class FeedNormalizeHook(Protocol):
    async def feed_normalize(self, ctx: "PluginContext", raw: dict) -> dict: ...


@runtime_checkable
class RecsFeatureHook(Protocol):
    async def recs_feature(self, ctx: "PluginContext", item: dict) -> float: ...


@runtime_checkable
class TelemetryIngestHook(Protocol):
    async def telemetry_ingest(self, ctx: "PluginContext", path: str) -> int: ...

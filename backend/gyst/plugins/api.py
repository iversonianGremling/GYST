"""PluginContext — the object every plugin backend receives."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession


class PluginContext:
    def __init__(
        self,
        plugin_id: str,
        session: AsyncSession,
        data_root: Path,
        _settings: dict[str, Any],
    ) -> None:
        self.plugin_id = plugin_id
        self.db = session
        self._settings = _settings
        self.fs = data_root / "plugins" / plugin_id
        self.fs.mkdir(parents=True, exist_ok=True)
        self.log = logging.getLogger(f"gyst.plugin.{plugin_id}")
        self._http: httpx.AsyncClient | None = None

    @property
    def http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=30)
        return self._http

    def setting(self, key: str, default: Any = None) -> Any:
        return self._settings.get(key, default)

    async def close(self) -> None:
        if self._http and not self._http.is_closed:
            await self._http.aclose()

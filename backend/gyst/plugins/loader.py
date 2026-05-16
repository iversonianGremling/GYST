"""Plugin discovery, manifest validation, and hook registration."""
from __future__ import annotations

import importlib.util
import json
import logging
import types
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from gyst.config import settings
from gyst.plugins.hooks import HOOK_NAMES

log = logging.getLogger("gyst.plugins")

_REQUIRED_MANIFEST_KEYS = {"id", "name", "version"}

_registry: dict[str, "_LoadedPlugin"] = {}


class _LoadedPlugin:
    def __init__(self, manifest: dict[str, Any], module: types.ModuleType | None) -> None:
        self.manifest = manifest
        self.id: str = manifest["id"]
        self.name: str = manifest["name"]
        self.hooks: list[str] = manifest.get("hooks", [])
        self.ui_slots: list[str] = manifest.get("ui_slots", [])
        self.widget: str | None = manifest.get("widget")
        self._module = module

    def has_hook(self, name: str) -> bool:
        return name in self.hooks and self._module is not None and hasattr(self._module, name.replace(".", "_"))

    async def call_hook(self, name: str, *args: Any, **kwargs: Any) -> Any:
        fn_name = name.replace(".", "_")
        fn = getattr(self._module, fn_name, None)
        if fn is None:
            return None
        return await fn(*args, **kwargs)

    def register_routes(self, parent: APIRouter) -> None:
        if self._module is None:
            return
        fn = getattr(self._module, "register_routes", None)
        if fn is None:
            return
        sub = APIRouter(prefix=f"/{self.id}", tags=[self.id])
        fn(sub)
        parent.include_router(sub)


def _load_module(plugin_dir: Path, backend_file: str) -> types.ModuleType | None:
    py_path = plugin_dir / backend_file
    if not py_path.exists():
        return None
    spec = importlib.util.spec_from_file_location(f"gyst_plugin_{plugin_dir.name}", py_path)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    except Exception as e:
        log.error("Failed to load plugin %s: %s", plugin_dir.name, e)
        return None
    return mod


def discover(plugin_dir: Path | None = None) -> list[_LoadedPlugin]:
    plugin_dir = plugin_dir or settings.plugins.directory
    if not plugin_dir.exists():
        log.warning("Plugin directory %s does not exist", plugin_dir)
        return []

    enabled = set(settings.plugins.enabled)
    loaded: list[_LoadedPlugin] = []

    for candidate in sorted(plugin_dir.iterdir()):
        if not candidate.is_dir():
            continue
        manifest_path = candidate / "manifest.json"
        if not manifest_path.exists():
            continue

        try:
            manifest = json.loads(manifest_path.read_text())
        except json.JSONDecodeError as e:
            log.error("Invalid manifest in %s: %s", candidate, e)
            continue

        missing = _REQUIRED_MANIFEST_KEYS - manifest.keys()
        if missing:
            log.error("Plugin %s manifest missing keys: %s", candidate, missing)
            continue

        plugin_id = manifest["id"]
        if enabled and plugin_id not in enabled:
            log.debug("Plugin %s disabled by config", plugin_id)
            continue

        # Validate declared hooks
        bad_hooks = [h for h in manifest.get("hooks", []) if h not in HOOK_NAMES]
        if bad_hooks:
            log.error("Plugin %s declares unknown hooks: %s", plugin_id, bad_hooks)
            continue

        backend_file = manifest.get("backend")
        module = _load_module(candidate, backend_file) if backend_file else None

        plugin = _LoadedPlugin(manifest, module)
        _registry[plugin_id] = plugin
        loaded.append(plugin)
        log.info("Loaded plugin: %s v%s", plugin.name, manifest["version"])

    return loaded


def get_all() -> list[_LoadedPlugin]:
    return list(_registry.values())


def get(plugin_id: str) -> _LoadedPlugin | None:
    return _registry.get(plugin_id)


async def call_hook(name: str, *args: Any, **kwargs: Any) -> list[Any]:
    results = []
    for plugin in _registry.values():
        if plugin.has_hook(name):
            try:
                result = await plugin.call_hook(name, *args, **kwargs)
                results.append(result)
            except Exception as e:
                log.error("Plugin %s hook %s failed: %s", plugin.id, name, e)
    return results

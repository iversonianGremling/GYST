"""Plugin loader — discovery, validation, bad-manifest rejection."""
import json
import pytest
from pathlib import Path

from gyst.plugins import loader


@pytest.fixture
def plugin_dir(tmp_path: Path) -> Path:
    return tmp_path / "plugins"


def _write_plugin(base: Path, plugin_id: str, manifest: dict, with_backend: bool = False):
    d = base / plugin_id
    d.mkdir(parents=True)
    (d / "manifest.json").write_text(json.dumps(manifest))
    if with_backend:
        (d / "backend.py").write_text(
            "async def feed_fetch(ctx): return []\n"
            "def register_routes(router): pass\n"
        )
    return d


def test_discover_valid_plugin(plugin_dir: Path):
    _write_plugin(plugin_dir, "my-plugin", {
        "id": "my-plugin", "name": "My Plugin", "version": "0.1.0",
        "hooks": [], "ui_slots": [],
    })
    loader._registry.clear()
    plugins = loader.discover(plugin_dir)
    assert len(plugins) == 1
    assert plugins[0].id == "my-plugin"


def test_discover_with_hook(plugin_dir: Path):
    _write_plugin(plugin_dir, "feed-plugin", {
        "id": "feed-plugin", "name": "Feed", "version": "0.1.0",
        "backend": "backend.py", "hooks": ["feed.fetch"], "ui_slots": [],
    }, with_backend=True)
    loader._registry.clear()
    plugins = loader.discover(plugin_dir)
    assert plugins[0].has_hook("feed.fetch")


def test_rejects_missing_required_keys(plugin_dir: Path):
    _write_plugin(plugin_dir, "bad-plugin", {"id": "bad-plugin"})  # missing name + version
    loader._registry.clear()
    plugins = loader.discover(plugin_dir)
    assert len(plugins) == 0


def test_rejects_unknown_hook(plugin_dir: Path):
    _write_plugin(plugin_dir, "bad-hook", {
        "id": "bad-hook", "name": "Bad", "version": "0.1.0",
        "hooks": ["nonexistent.hook"], "ui_slots": [],
    })
    loader._registry.clear()
    plugins = loader.discover(plugin_dir)
    assert len(plugins) == 0


def test_rejects_invalid_json(plugin_dir: Path):
    d = plugin_dir / "corrupt"
    d.mkdir(parents=True)
    (d / "manifest.json").write_text("{not valid json")
    loader._registry.clear()
    plugins = loader.discover(plugin_dir)
    assert len(plugins) == 0


def test_skips_non_directories(plugin_dir: Path):
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "stray_file.txt").write_text("hello")
    loader._registry.clear()
    plugins = loader.discover(plugin_dir)
    assert len(plugins) == 0

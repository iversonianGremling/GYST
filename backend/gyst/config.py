from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomllib  # type: ignore[no-redef]  # backport

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT = Path(__file__).parent.parent.parent  # repo root


def _load_toml() -> dict[str, Any]:
    p = _ROOT / "gyst.toml"
    if p.exists():
        with p.open("rb") as f:
            return tomllib.load(f)
    return {}


_toml = _load_toml()


class _Server(BaseSettings):
    host: str = _toml.get("server", {}).get("host", "127.0.0.1")
    port: int = _toml.get("server", {}).get("port", 8000)
    debug: bool = _toml.get("server", {}).get("debug", False)


class _Data(BaseSettings):
    root: Path = Path(_toml.get("data", {}).get("root", str(_ROOT / "data")))

    @field_validator("root", mode="before")
    @classmethod
    def _resolve(cls, v: Any) -> Path:
        p = Path(v)
        return p if p.is_absolute() else (_ROOT / p).resolve()


class _Auth(BaseSettings):
    password_hash: str = _toml.get("auth", {}).get("password_hash", "")
    secret_key: str = _toml.get("auth", {}).get("secret_key", "dev-insecure-key")
    session_ttl_days: int = _toml.get("auth", {}).get("session_ttl_days", 30)


class _Plugins(BaseSettings):
    enabled: list[str] = _toml.get("plugins", {}).get("enabled", [])
    directory: Path = Path(_toml.get("plugins", {}).get("directory", str(_ROOT / "plugins")))

    @field_validator("directory", mode="before")
    @classmethod
    def _resolve(cls, v: Any) -> Path:
        p = Path(v)
        return p if p.is_absolute() else (_ROOT / p).resolve()


class _Recs(BaseSettings):
    embedding_model: str = _toml.get("recs", {}).get("embedding_model", "all-MiniLM-L6-v2")
    w_embed: float = _toml.get("recs", {}).get("w_embed", 0.5)
    w_tag: float = _toml.get("recs", {}).get("w_tag", 0.3)
    w_rating: float = _toml.get("recs", {}).get("w_rating", 0.15)
    w_slop: float = _toml.get("recs", {}).get("w_slop", 0.05)
    slop_session_threshold_s: int = _toml.get("recs", {}).get("slop_session_threshold_s", 120)


class _Scheduler(BaseSettings):
    feed_interval_minutes: int = _toml.get("scheduler", {}).get("feed_interval_minutes", 60)
    embed_interval_minutes: int = _toml.get("scheduler", {}).get("embed_interval_minutes", 360)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GYST_", env_nested_delimiter="__")

    server: _Server = _Server()
    data: _Data = _Data()
    auth: _Auth = _Auth()
    plugins: _Plugins = _Plugins()
    recs: _Recs = _Recs()
    scheduler: _Scheduler = _Scheduler()
    gitea: dict[str, Any] = _toml.get("gitea", {})   # url, token, org (vault sync)


settings = Settings()

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PERSONALCLOUD_", env_file=".env")

    service_name: str = "personalcloud-storage"
    storage_root: Path = Field(default=Path("../../storage-root"))
    trash_dir: str = ".personalcloud-trash"
    internal_api_token: str | None = None
    allow_insecure_api: bool = False
    max_text_preview_bytes: int = 1_048_576

    @property
    def resolved_storage_root(self) -> Path:
        return self.storage_root.expanduser().resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()

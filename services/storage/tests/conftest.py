import pytest

from app.config import get_settings


@pytest.fixture(autouse=True)
def configure_internal_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_INTERNAL_API_TOKEN", "test-token")
    monkeypatch.delenv("PERSONALCLOUD_ALLOW_INSECURE_API", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()

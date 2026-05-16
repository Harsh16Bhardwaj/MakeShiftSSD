import secrets

from fastapi import Header, HTTPException, status

from app.config import get_settings


def require_internal_token(
    token: str | None = Header(default=None, alias="X-PersonalCloud-Token"),
) -> None:
    settings = get_settings()

    if settings.allow_insecure_api:
        return

    expected = settings.internal_api_token
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal API token is not configured",
        )

    if token is None or not secrets.compare_digest(token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal API token",
        )

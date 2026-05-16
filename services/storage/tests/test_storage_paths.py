from pathlib import Path

import pytest

from app.storage import StoragePathError, safe_join, to_api_path


def test_safe_join_allows_root(tmp_path: Path) -> None:
    assert safe_join(tmp_path, "") == tmp_path.resolve()


def test_safe_join_allows_nested_relative_path(tmp_path: Path) -> None:
    assert safe_join(tmp_path, "photos/2026") == (tmp_path / "photos" / "2026").resolve()


@pytest.mark.parametrize(
    "requested_path",
    [
        "../outside",
        "photos/../outside",
        "/absolute",
        "C:/Windows",
        "photos//bad",
        "./photos",
    ],
)
def test_safe_join_blocks_unsafe_paths(tmp_path: Path, requested_path: str) -> None:
    with pytest.raises(StoragePathError):
        safe_join(tmp_path, requested_path)


def test_to_api_path_returns_posix_path(tmp_path: Path) -> None:
    nested = tmp_path / "photos" / "trip"
    nested.mkdir(parents=True)
    assert to_api_path(tmp_path, nested) == "photos/trip"


def test_safe_join_blocks_symlink_escape(tmp_path: Path) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    link = tmp_path / "outside-link"

    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"symlink creation is not available: {exc}")

    with pytest.raises(StoragePathError):
        safe_join(tmp_path, "outside-link")

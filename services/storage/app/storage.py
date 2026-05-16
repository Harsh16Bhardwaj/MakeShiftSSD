from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from uuid import uuid4


class StoragePathError(ValueError):
    """Raised when a requested storage path escapes the configured root."""


def ensure_storage_root(root: Path) -> Path:
    resolved = root.expanduser().resolve()
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved


def ensure_trash(root: Path, trash_dir: str) -> Path:
    validate_entry_name(trash_dir)
    trash = safe_join(root, trash_dir)
    trash.mkdir(parents=True, exist_ok=True)
    return trash


def safe_join(root: Path, requested_path: str | None) -> Path:
    resolved_root = root.expanduser().resolve()
    relative = _normalize_relative_path(requested_path)
    candidate = (resolved_root / relative).resolve()

    if candidate != resolved_root and resolved_root not in candidate.parents:
        raise StoragePathError("Path escapes the configured storage root")

    return candidate


def to_api_path(root: Path, item: Path) -> str:
    relative = item.resolve().relative_to(root.resolve())
    return relative.as_posix()


def validate_entry_name(name: str) -> str:
    normalized = name.strip()

    if normalized != name or normalized == "":
        raise StoragePathError("Name cannot be empty or padded with spaces")

    if normalized in {".", ".."}:
        raise StoragePathError("Name contains unsafe segments")

    if any(separator in normalized for separator in ("/", "\\")):
        raise StoragePathError("Name cannot contain path separators")

    if ":" in normalized:
        raise StoragePathError("Drive-qualified names are not allowed")

    return normalized


def collision_safe_path(parent: Path, name: str) -> Path:
    validate_entry_name(name)
    target = parent / name
    if not target.exists():
        return target

    stem = target.stem
    suffix = target.suffix
    counter = 1
    while True:
        candidate = parent / f"{stem} ({counter}){suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def build_trash_path(trash: Path, source: Path) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return collision_safe_path(trash, f"{timestamp}-{uuid4().hex}-{source.name}")


def _normalize_relative_path(requested_path: str | None) -> Path:
    if requested_path is None or requested_path.strip() == "":
        return Path()

    path = requested_path.replace("\\", "/")

    if ":" in path:
        raise StoragePathError("Drive-qualified paths are not allowed")

    if path.startswith("./") or "//" in path:
        raise StoragePathError("Path contains unsafe segments")

    pure = PurePosixPath(path)

    if pure.is_absolute():
        raise StoragePathError("Absolute paths are not allowed")

    if any(part in {"", ".", ".."} for part in pure.parts):
        raise StoragePathError("Path contains unsafe segments")

    return Path(*pure.parts)

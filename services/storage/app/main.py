import logging
import mimetypes
import shutil
import tempfile
import zipfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from starlette.background import BackgroundTask
from fastapi.responses import FileResponse

from app.auth import require_internal_token
from app.config import get_settings
from app.schemas import (
    BulkFileOperationRequest,
    BulkMutationResponse,
    CreateFolderRequest,
    DirectoryListing,
    FileItem,
    HealthResponse,
    MutationResponse,
    PreviewInfo,
    RenameRequest,
)
from app.storage import (
    StoragePathError,
    build_trash_path,
    collision_safe_path,
    ensure_storage_root,
    ensure_trash,
    safe_join,
    to_api_path,
    validate_entry_name,
)

logger = logging.getLogger("personalcloud.storage")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if not settings.allow_insecure_api and not settings.internal_api_token:
        raise RuntimeError(
            "PERSONALCLOUD_INTERNAL_API_TOKEN is required unless "
            "PERSONALCLOUD_ALLOW_INSECURE_API=true"
        )
    root = ensure_storage_root(settings.resolved_storage_root)
    logger.info("storage service started root=%s", root)
    yield


app = FastAPI(
    title="PersonalCloud Storage Service",
    version="0.1.0",
    description="Trusted local filesystem service for PersonalCloud.",
    lifespan=lifespan,
)

api = APIRouter(prefix="/api", dependencies=[Depends(require_internal_token)])


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    root = settings.resolved_storage_root
    return HealthResponse(
        service=settings.service_name,
        status="ok",
        storage_root=str(root),
        storage_root_exists=root.exists(),
    )


@api.get("/files", response_model=DirectoryListing)
def list_directory(path: str = Query(default="")) -> DirectoryListing:
    settings = get_settings()
    root = ensure_storage_root(settings.resolved_storage_root)

    try:
        directory = safe_join(root, path)
    except StoragePathError as exc:
        logger.warning("blocked unsafe list path path=%s error=%s", path, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not directory.exists():
        raise HTTPException(status_code=404, detail="Directory does not exist")

    if not directory.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    items = [
        _build_file_item(root, child)
        for child in sorted(directory.iterdir(), key=_sort_key)
        if not (directory == root and child.name == settings.trash_dir)
    ]
    return DirectoryListing(path=to_api_path(root, directory), items=items)


@api.post("/folders", status_code=201, response_model=MutationResponse)
def create_folder(request: CreateFolderRequest) -> MutationResponse:
    root = ensure_storage_root(get_settings().resolved_storage_root)
    parent = _resolve_existing_directory(root, request.parent_path)

    try:
        name = validate_entry_name(request.name)
    except StoragePathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    target = parent / name
    if target.exists():
        raise HTTPException(status_code=409, detail="Folder already exists")

    target.mkdir()
    logger.info("folder created path=%s", to_api_path(root, target))
    return MutationResponse(path=to_api_path(root, target), message="Folder created")


@api.post("/files/upload", status_code=201, response_model=MutationResponse)
async def upload_file(parent_path: str = Form(default=""), file: UploadFile = File()) -> MutationResponse:
    root = ensure_storage_root(get_settings().resolved_storage_root)
    parent = _resolve_existing_directory(root, parent_path)

    try:
        filename = validate_entry_name(file.filename or "")
    except StoragePathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    target = parent / filename
    if target.exists():
        raise HTTPException(status_code=409, detail="File already exists")

    try:
        with target.open("wb") as output:
            shutil.copyfileobj(file.file, output, length=1024 * 1024)
    finally:
        await file.close()

    logger.info("file uploaded path=%s", to_api_path(root, target))
    return MutationResponse(path=to_api_path(root, target), message="File uploaded")


@api.get("/files/download")
def download_file(path: str = Query()) -> FileResponse:
    root = ensure_storage_root(get_settings().resolved_storage_root)
    target = _resolve_existing_path(root, path)

    if not target.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    logger.info("file download path=%s", to_api_path(root, target))
    return FileResponse(path=target, filename=target.name)


@api.get("/files/archive")
def archive_folder(path: str = Query()) -> FileResponse:
    root = ensure_storage_root(get_settings().resolved_storage_root)
    target = _resolve_existing_path(root, path)

    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    archive_file = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    archive_path = Path(archive_file.name)
    archive_file.close()

    try:
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for child in target.rglob("*"):
                archive.write(child, child.relative_to(target.parent))
    except Exception:
        archive_path.unlink(missing_ok=True)
        raise

    logger.info("folder archive path=%s", to_api_path(root, target))
    return FileResponse(
        path=archive_path,
        filename=f"{target.name or 'root'}.zip",
        media_type="application/zip",
        background=BackgroundTask(archive_path.unlink, missing_ok=True),
    )


@api.get("/files/preview")
def preview_file(path: str = Query()) -> FileResponse:
    root = ensure_storage_root(get_settings().resolved_storage_root)
    target = _resolve_existing_path(root, path)

    if not target.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    preview_info = _preview_info(target)
    if not preview_info.supported or preview_info.mime_type is None:
        raise HTTPException(
            status_code=415,
            detail=preview_info.reason or "File type is not supported for preview",
        )

    logger.info("file preview path=%s media_type=%s", to_api_path(root, target), preview_info.mime_type)
    return FileResponse(
        path=target,
        media_type=preview_info.mime_type,
        headers={
            "Content-Disposition": f'inline; filename="{target.name}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@api.get("/files/preview-info", response_model=PreviewInfo)
def preview_info(path: str = Query()) -> PreviewInfo:
    root = ensure_storage_root(get_settings().resolved_storage_root)
    target = _resolve_existing_path(root, path)

    if not target.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    return _preview_info(target)


@api.patch("/files/rename", response_model=MutationResponse)
def rename_item(request: RenameRequest) -> MutationResponse:
    settings = get_settings()
    root = ensure_storage_root(settings.resolved_storage_root)
    source = _resolve_existing_path(root, request.path)
    _ensure_mutable_source(root, source, settings.trash_dir)

    try:
        new_name = validate_entry_name(request.new_name)
    except StoragePathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    target = source.parent / new_name
    if target.exists():
        raise HTTPException(status_code=409, detail="Destination already exists")

    source.rename(target)
    logger.info("item renamed source=%s target=%s", request.path, to_api_path(root, target))
    return MutationResponse(path=to_api_path(root, target), message="Item renamed")


@api.post("/files/copy", response_model=BulkMutationResponse)
def copy_items(request: BulkFileOperationRequest) -> BulkMutationResponse:
    settings = get_settings()
    root = ensure_storage_root(settings.resolved_storage_root)
    destination_parent = _resolve_existing_directory(root, request.destination_parent_path)
    copied_paths: list[str] = []

    if not request.source_paths:
        raise HTTPException(status_code=400, detail="No source paths provided")

    for source_path in request.source_paths:
        source = _resolve_existing_path(root, source_path)
        _ensure_mutable_source(root, source, settings.trash_dir)
        _ensure_valid_transfer(source, destination_parent)

        target = collision_safe_path(destination_parent, source.name)
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            shutil.copy2(source, target)
        copied_paths.append(to_api_path(root, target))

    logger.info(
        "items copied count=%s destination=%s",
        len(copied_paths),
        to_api_path(root, destination_parent),
    )
    return BulkMutationResponse(paths=copied_paths, message="Items copied")


@api.post("/files/move", response_model=BulkMutationResponse)
def move_items(request: BulkFileOperationRequest) -> BulkMutationResponse:
    settings = get_settings()
    root = ensure_storage_root(settings.resolved_storage_root)
    destination_parent = _resolve_existing_directory(root, request.destination_parent_path)
    moved_paths: list[str] = []

    if not request.source_paths:
        raise HTTPException(status_code=400, detail="No source paths provided")

    for source_path in request.source_paths:
        source = _resolve_existing_path(root, source_path)
        _ensure_mutable_source(root, source, settings.trash_dir)
        _ensure_valid_transfer(source, destination_parent)

        target = collision_safe_path(destination_parent, source.name)
        shutil.move(str(source), str(target))
        moved_paths.append(to_api_path(root, target))

    logger.info(
        "items moved count=%s destination=%s",
        len(moved_paths),
        to_api_path(root, destination_parent),
    )
    return BulkMutationResponse(paths=moved_paths, message="Items moved")


@api.delete("/files", response_model=MutationResponse)
def trash_item(path: str = Query()) -> MutationResponse:
    settings = get_settings()
    root = ensure_storage_root(settings.resolved_storage_root)
    source = _resolve_existing_path(root, path)
    _ensure_mutable_source(root, source, settings.trash_dir)

    trash = ensure_trash(root, settings.trash_dir)
    target = build_trash_path(trash, source)
    shutil.move(str(source), str(target))

    logger.info("item moved to trash source=%s trash=%s", path, to_api_path(root, target))
    return MutationResponse(path=to_api_path(root, target), message="Item moved to trash")


def _build_file_item(root: Path, item: Path) -> FileItem:
    stat = item.stat()
    return FileItem(
        name=item.name,
        path=to_api_path(root, item),
        kind="directory" if item.is_dir() else "file",
        size_bytes=None if item.is_dir() else stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
    )


def _sort_key(path: Path) -> tuple[int, str]:
    return (0 if path.is_dir() else 1, path.name.lower())


def _preview_info(path: Path) -> PreviewInfo:
    suffix = path.suffix.lower()
    guessed_type, _ = mimetypes.guess_type(path.name)
    size_bytes = path.stat().st_size

    if guessed_type and (
        guessed_type.startswith("image/")
        or guessed_type.startswith("video/")
        or guessed_type.startswith("audio/")
        or guessed_type == "application/pdf"
    ):
        return PreviewInfo(
            supported=True,
            kind=_preview_kind_from_mime(guessed_type),
            mime_type=guessed_type,
            size_bytes=size_bytes,
        )

    if suffix in _TEXT_PREVIEW_EXTENSIONS:
        max_size = get_settings().max_text_preview_bytes
        if size_bytes > max_size:
            return PreviewInfo(
                supported=False,
                kind="unsupported",
                mime_type=guessed_type or "text/plain; charset=utf-8",
                size_bytes=size_bytes,
                reason=f"Text preview too large. Limit is {max_size} bytes.",
            )

        return PreviewInfo(
            supported=True,
            kind="text",
            mime_type=guessed_type or "text/plain; charset=utf-8",
            size_bytes=size_bytes,
        )

    return PreviewInfo(
        supported=False,
        kind="unsupported",
        mime_type=guessed_type,
        size_bytes=size_bytes,
        reason="File type is not supported for preview",
    )


def _preview_kind_from_mime(mime_type: str) -> str:
    if mime_type.startswith("image/"):
        return "image"
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("audio/"):
        return "audio"
    if mime_type == "application/pdf":
        return "pdf"
    return "unsupported"


def _resolve_existing_path(root: Path, requested_path: str) -> Path:
    try:
        target = safe_join(root, requested_path)
    except StoragePathError as exc:
        logger.warning("blocked unsafe path path=%s error=%s", requested_path, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not target.exists():
        raise HTTPException(status_code=404, detail="Path does not exist")

    return target


def _resolve_existing_directory(root: Path, requested_path: str) -> Path:
    directory = _resolve_existing_path(root, requested_path)

    if not directory.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    return directory


def _ensure_mutable_source(root: Path, source: Path, trash_dir: str) -> None:
    if source == root:
        raise HTTPException(status_code=400, detail="Storage root cannot be modified")

    trash_path = safe_join(root, trash_dir)
    if source == trash_path or trash_path in source.parents:
        raise HTTPException(status_code=400, detail="Trash contents cannot be modified through this endpoint")


def _ensure_valid_transfer(source: Path, destination_parent: Path) -> None:
    if source == destination_parent:
        raise HTTPException(status_code=400, detail="Cannot transfer an item into itself")

    if source.is_dir() and source in destination_parent.parents:
        raise HTTPException(status_code=400, detail="Cannot transfer a folder into its own child")


app.include_router(api)


_TEXT_PREVIEW_EXTENSIONS = {
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonl",
    ".csv",
    ".tsv",
    ".log",
    ".xml",
    ".yaml",
    ".yml",
    ".ini",
    ".env",
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".css",
    ".scss",
    ".html",
    ".sql",
    ".sh",
    ".ps1",
    ".bat",
    ".toml",
}

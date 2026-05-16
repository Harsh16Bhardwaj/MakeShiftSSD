from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    service: str
    status: Literal["ok"]
    storage_root: str
    storage_root_exists: bool


class FileItem(BaseModel):
    name: str
    path: str
    kind: Literal["file", "directory"]
    size_bytes: int | None
    modified_at: datetime


class DirectoryListing(BaseModel):
    path: str
    items: list[FileItem]


class SearchResponse(BaseModel):
    query: str
    items: list[FileItem]
    total: int


class CreateFolderRequest(BaseModel):
    parent_path: str = ""
    name: str


class RenameRequest(BaseModel):
    path: str
    new_name: str


class BulkFileOperationRequest(BaseModel):
    source_paths: list[str]
    destination_parent_path: str = ""


class MutationResponse(BaseModel):
    path: str
    message: str


class BulkMutationResponse(BaseModel):
    paths: list[str]
    message: str


class PreviewInfo(BaseModel):
    supported: bool
    kind: Literal["image", "video", "audio", "pdf", "text", "unsupported"]
    mime_type: str | None
    size_bytes: int
    reason: str | None = None

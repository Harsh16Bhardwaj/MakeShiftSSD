from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app

AUTH_HEADERS = {"X-PersonalCloud-Token": "test-token"}


def test_health_reports_storage_root(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()

    response = TestClient(app).get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "personalcloud-storage"
    assert data["status"] == "ok"
    assert data["storage_root"] == str(tmp_path.resolve())


def test_api_rejects_missing_token(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()

    response = TestClient(app).get("/api/files", params={"path": ""})

    assert response.status_code == 401


def test_api_rejects_wrong_token(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()

    response = TestClient(app).get(
        "/api/files",
        params={"path": ""},
        headers={"X-PersonalCloud-Token": "wrong"},
    )

    assert response.status_code == 401


def test_list_directory_returns_directories_before_files(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    (tmp_path / "z-file.txt").write_text("hello", encoding="utf-8")
    (tmp_path / "a-folder").mkdir()

    response = TestClient(app).get("/api/files", params={"path": ""}, headers=AUTH_HEADERS)

    assert response.status_code == 200
    data = response.json()
    assert data["path"] == "."
    assert [item["name"] for item in data["items"]] == ["a-folder", "z-file.txt"]
    assert data["items"][0]["kind"] == "directory"
    assert data["items"][1]["kind"] == "file"


def test_search_finds_nested_files_and_directories(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    (tmp_path / "photos").mkdir()
    (tmp_path / "photos" / "summer-photo.jpg").write_bytes(b"image")

    response = TestClient(app).get(
        "/api/files/search",
        params={"query": "photo"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2
    assert [item["path"] for item in data["items"]] == ["photos", "photos/summer-photo.jpg"]


def test_search_index_invalidates_after_upload(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)

    first_search = client.get(
        "/api/files/search",
        params={"query": "new-note"},
        headers=AUTH_HEADERS,
    )
    assert first_search.status_code == 200
    assert first_search.json()["total"] == 0

    upload_response = client.post(
        "/api/files/upload",
        data={"parent_path": ""},
        files={"file": ("new-note.txt", b"hello", "text/plain")},
        headers=AUTH_HEADERS,
    )
    assert upload_response.status_code == 201

    second_search = client.get(
        "/api/files/search",
        params={"query": "new-note"},
        headers=AUTH_HEADERS,
    )
    assert second_search.status_code == 200
    assert second_search.json()["total"] == 1


def test_list_directory_rejects_unsafe_path(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()

    response = TestClient(app).get(
        "/api/files",
        params={"path": "../outside"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 400


def test_create_folder_upload_download_rename_and_trash(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)

    create_response = client.post(
        "/api/folders",
        json={"parent_path": "", "name": "docs"},
        headers=AUTH_HEADERS,
    )
    assert create_response.status_code == 201
    assert create_response.json()["path"] == "docs"

    upload_response = client.post(
        "/api/files/upload",
        data={"parent_path": "docs"},
        files={"file": ("note.txt", b"hello personal cloud", "text/plain")},
        headers=AUTH_HEADERS,
    )
    assert upload_response.status_code == 201
    assert upload_response.json()["path"] == "docs/note.txt"
    assert (tmp_path / "docs" / "note.txt").read_bytes() == b"hello personal cloud"

    download_response = client.get(
        "/api/files/download",
        params={"path": "docs/note.txt"},
        headers=AUTH_HEADERS,
    )
    assert download_response.status_code == 200
    assert download_response.content == b"hello personal cloud"

    rename_response = client.patch(
        "/api/files/rename",
        json={"path": "docs/note.txt", "new_name": "renamed.txt"},
        headers=AUTH_HEADERS,
    )
    assert rename_response.status_code == 200
    assert rename_response.json()["path"] == "docs/renamed.txt"
    assert not (tmp_path / "docs" / "note.txt").exists()
    assert (tmp_path / "docs" / "renamed.txt").exists()

    delete_response = client.delete(
        "/api/files",
        params={"path": "docs/renamed.txt"},
        headers=AUTH_HEADERS,
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["path"].startswith(".personalcloud-trash/")
    assert not (tmp_path / "docs" / "renamed.txt").exists()
    assert any((tmp_path / ".personalcloud-trash").iterdir())


def test_conflicts_return_409(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    (tmp_path / "docs").mkdir()
    (tmp_path / "a.txt").write_text("a", encoding="utf-8")
    (tmp_path / "b.txt").write_text("b", encoding="utf-8")

    folder_response = client.post(
        "/api/folders",
        json={"parent_path": "", "name": "docs"},
        headers=AUTH_HEADERS,
    )
    assert folder_response.status_code == 409

    upload_response = client.post(
        "/api/files/upload",
        data={"parent_path": ""},
        files={"file": ("a.txt", b"duplicate", "text/plain")},
        headers=AUTH_HEADERS,
    )
    assert upload_response.status_code == 409

    rename_response = client.patch(
        "/api/files/rename",
        json={"path": "a.txt", "new_name": "b.txt"},
        headers=AUTH_HEADERS,
    )
    assert rename_response.status_code == 409


def test_copy_and_move_items(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    (tmp_path / "source").mkdir()
    (tmp_path / "target").mkdir()
    (tmp_path / "source" / "note.txt").write_text("copy me", encoding="utf-8")

    copy_response = client.post(
        "/api/files/copy",
        json={"source_paths": ["source/note.txt"], "destination_parent_path": "target"},
        headers=AUTH_HEADERS,
    )
    assert copy_response.status_code == 200
    assert copy_response.json()["paths"] == ["target/note.txt"]
    assert (tmp_path / "source" / "note.txt").exists()
    assert (tmp_path / "target" / "note.txt").read_text(encoding="utf-8") == "copy me"

    move_response = client.post(
        "/api/files/move",
        json={"source_paths": ["source/note.txt"], "destination_parent_path": "target"},
        headers=AUTH_HEADERS,
    )
    assert move_response.status_code == 200
    assert move_response.json()["paths"] == ["target/note (1).txt"]
    assert not (tmp_path / "source" / "note.txt").exists()
    assert (tmp_path / "target" / "note (1).txt").read_text(encoding="utf-8") == "copy me"


def test_move_folder_into_own_child_is_rejected(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    (tmp_path / "parent" / "child").mkdir(parents=True)

    response = TestClient(app).post(
        "/api/files/move",
        json={"source_paths": ["parent"], "destination_parent_path": "parent/child"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 400


def test_download_directory_returns_400(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()

    response = TestClient(app).get(
        "/api/files/download",
        params={"path": ""},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 400


def test_archive_folder_returns_zip(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "note.txt").write_text("zip me", encoding="utf-8")

    response = TestClient(app).get(
        "/api/files/archive",
        params={"path": "docs"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/zip")
    assert response.content.startswith(b"PK")


def test_archive_file_returns_400(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    (tmp_path / "note.txt").write_text("not a folder", encoding="utf-8")

    response = TestClient(app).get(
        "/api/files/archive",
        params={"path": "note.txt"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 400


def test_preview_text_file_returns_content(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    (tmp_path / "note.txt").write_text("preview me", encoding="utf-8")

    response = TestClient(app).get(
        "/api/files/preview",
        params={"path": "note.txt"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.content == b"preview me"
    assert response.headers["content-type"].startswith("text/plain")


def test_preview_info_text_file_returns_metadata(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    (tmp_path / "note.txt").write_text("preview me", encoding="utf-8")

    response = TestClient(app).get(
        "/api/files/preview-info",
        params={"path": "note.txt"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["supported"] is True
    assert data["kind"] == "text"
    assert data["mime_type"].startswith("text/plain")
    assert data["size_bytes"] == 10
    assert data["reason"] is None


@pytest.mark.parametrize(
    ("filename", "expected_type"),
    [
        ("image.png", "image/png"),
        ("doc.pdf", "application/pdf"),
    ],
)
def test_preview_browser_native_types_return_content_type(
    tmp_path: Path,
    monkeypatch,
    filename: str,
    expected_type: str,
) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    (tmp_path / filename).write_bytes(b"fake preview bytes")

    response = TestClient(app).get(
        "/api/files/preview",
        params={"path": filename},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(expected_type)


def test_preview_info_browser_native_type_returns_kind(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    (tmp_path / "image.png").write_bytes(b"fake preview bytes")

    response = TestClient(app).get(
        "/api/files/preview-info",
        params={"path": "image.png"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["supported"] is True
    assert data["kind"] == "image"
    assert data["mime_type"] == "image/png"


def test_preview_unsupported_file_returns_415(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    (tmp_path / "archive.bin").write_bytes(b"\x00\x01")

    response = TestClient(app).get(
        "/api/files/preview",
        params={"path": "archive.bin"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 415


def test_preview_info_unsupported_file_returns_reason(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    (tmp_path / "archive.bin").write_bytes(b"\x00\x01")

    response = TestClient(app).get(
        "/api/files/preview-info",
        params={"path": "archive.bin"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["supported"] is False
    assert data["kind"] == "unsupported"
    assert data["size_bytes"] == 2
    assert data["reason"] == "File type is not supported for preview"


def test_preview_info_oversized_text_returns_reason(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("PERSONALCLOUD_MAX_TEXT_PREVIEW_BYTES", "4")
    get_settings.cache_clear()
    (tmp_path / "large.txt").write_text("too large", encoding="utf-8")

    response = TestClient(app).get(
        "/api/files/preview-info",
        params={"path": "large.txt"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["supported"] is False
    assert data["kind"] == "unsupported"
    assert data["reason"] == "Text preview too large. Limit is 4 bytes."


def test_preview_oversized_text_returns_415(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("PERSONALCLOUD_MAX_TEXT_PREVIEW_BYTES", "4")
    get_settings.cache_clear()
    (tmp_path / "large.txt").write_text("too large", encoding="utf-8")

    response = TestClient(app).get(
        "/api/files/preview",
        params={"path": "large.txt"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 415
    assert response.json()["detail"] == "Text preview too large. Limit is 4 bytes."


def test_preview_directory_returns_400(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()

    response = TestClient(app).get(
        "/api/files/preview",
        params={"path": ""},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 400


def test_preview_info_directory_returns_400(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()

    response = TestClient(app).get(
        "/api/files/preview-info",
        params={"path": ""},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 400


def test_preview_missing_path_returns_404(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()

    response = TestClient(app).get(
        "/api/files/preview",
        params={"path": "missing.txt"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 404


def test_preview_info_missing_path_returns_404(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()

    response = TestClient(app).get(
        "/api/files/preview-info",
        params={"path": "missing.txt"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 404


def test_delete_missing_path_returns_404(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()

    response = TestClient(app).delete(
        "/api/files",
        params={"path": "missing.txt"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 404


def test_mutations_reject_storage_root(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)

    rename_response = client.patch(
        "/api/files/rename",
        json={"path": "", "new_name": "new-root"},
        headers=AUTH_HEADERS,
    )
    delete_response = client.delete("/api/files", params={"path": ""}, headers=AUTH_HEADERS)

    assert rename_response.status_code == 400
    assert delete_response.status_code == 400


@pytest.mark.parametrize(
    ("method", "url", "kwargs"),
    [
        ("get", "/api/files", {"params": {"path": "../outside"}}),
        ("post", "/api/folders", {"json": {"parent_path": "../outside", "name": "bad"}}),
        (
            "post",
            "/api/files/upload",
            {
                "data": {"parent_path": "../outside"},
                "files": {"file": ("bad.txt", b"bad", "text/plain")},
            },
        ),
        ("get", "/api/files/download", {"params": {"path": "../outside"}}),
        ("get", "/api/files/archive", {"params": {"path": "../outside"}}),
        ("get", "/api/files/preview", {"params": {"path": "../outside"}}),
        ("get", "/api/files/preview-info", {"params": {"path": "../outside"}}),
        ("patch", "/api/files/rename", {"json": {"path": "../outside", "new_name": "bad"}}),
        ("post", "/api/files/copy", {"json": {"source_paths": ["../outside"], "destination_parent_path": ""}}),
        ("post", "/api/files/move", {"json": {"source_paths": ["../outside"], "destination_parent_path": ""}}),
        ("delete", "/api/files", {"params": {"path": "../outside"}}),
    ],
)
def test_api_operations_reject_unsafe_paths(
    tmp_path: Path,
    monkeypatch,
    method: str,
    url: str,
    kwargs: dict,
) -> None:
    monkeypatch.setenv("PERSONALCLOUD_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)

    response = getattr(client, method)(url, headers=AUTH_HEADERS, **kwargs)

    assert response.status_code == 400

# PersonalCloud Architecture

This file is an append-only architecture journal and interview-prep artifact. Update it whenever the system design changes, a meaningful tradeoff is made, or a technology decision is revisited.

## System Overview

PersonalCloud turns a secondary Windows PC into a private personal cloud server.

The secondary PC runs a Python/FastAPI storage service that owns all filesystem access. A Next.js app provides the user-facing interface and BFF layer for authentication, SSR-friendly views, request proxying, and metadata caching. Remote access is handled through Tailscale so trusted devices can reach the server over a private encrypted network without public port forwarding.

The system starts with one assigned storage root. Users can create folders, upload files, download files, preview supported files, rename items, and move items to trash. The app should never expose arbitrary machine paths.

## Core Architecture Diagram

```mermaid
flowchart LR
  A["Primary PC / Mobile"] --> B["Tailscale private network"]
  B --> C["Next.js UI + BFF"]
  C --> D["FastAPI storage service"]
  D --> E["Assigned storage root"]
  D --> F["Health endpoint + logs"]
  G["Windows Task Scheduler"] --> H["Watchdog script"]
  H --> F
  H --> D
  D -. "future one-way backup" .-> I["rclone"]
  I -.-> J["Google Drive"]
  A -. "future manual chunk upload" .-> K["Cloudflare R2 inbox"]
  K -. "future worker import" .-> D
```

## Runtime Responsibilities

### Next.js UI/BFF

- Presents the file manager UI.
- Handles login and secure session cookie.
- Routes browser requests through server routes.
- Applies metadata caching for folder listings and storage stats where safe.
- Keeps FastAPI internals away from direct browser exposure.
- Attaches the FastAPI internal token only from server-side BFF routes.
- Proxies preview streams so supported files can render in the browser without exposing FastAPI directly.
- Uses FastAPI preview metadata instead of duplicating preview type decisions in browser code.

### FastAPI Storage Service

- Owns trusted filesystem operations.
- Validates every requested path against the configured storage root.
- Lists folders, accepts uploads, streams downloads, streams previews, creates folders, renames items, and moves items to trash.
- Owns preview classification and text preview size limits through `preview-info`.
- Requires an internal `X-PersonalCloud-Token` header for `/api/*` routes, while leaving `/health` public for watchdog checks.
- Exposes health status for watchdog checks.
- Writes logs useful for debugging crashes, denied paths, and file operation failures.

### Windows Reliability Layer

- Starts the app stack through Task Scheduler on boot/login/wake.
- Runs a watchdog that checks service health.
- Restarts unhealthy services when possible.
- Writes startup, crash, restart, and health-check logs.

### Future Cloud Inbox Worker

- Polls Cloudflare R2 for completed upload manifests.
- Downloads chunk objects into local staging.
- Verifies chunk hashes and whole-file hashes before final commit.
- Atomically moves completed files into the configured storage root.
- Deletes imported cloud chunks only after local verification succeeds.

## Current Implementation Notes

### Monorepo Boundary

PersonalCloud is one product with two runtimes:

```text
apps/web
  Next.js App Router UI
  BFF route handlers
  session cookie auth

services/storage
  FastAPI trusted filesystem API
  path validation
  streaming file responses
  metadata cache and search index
```

The practical rule is simple: browser code talks to `apps/web`; only server-side Next.js route handlers talk to `services/storage`.

### Path Safety Boundary

The storage root is the strongest security boundary in the system. Every requested path is normalized, joined to the configured root, resolved, and then checked to prove it did not escape.

Key implementation shape in `services/storage/app/storage.py`:

```python
def safe_join(root: Path, requested_path: str | None) -> Path:
    resolved_root = root.expanduser().resolve()
    relative = _normalize_relative_path(requested_path)
    candidate = (resolved_root / relative).resolve()

    if candidate != resolved_root and resolved_root not in candidate.parents:
        raise StoragePathError("Path escapes the configured storage root")

    return candidate
```

This blocks traversal, absolute paths, drive-qualified paths, malformed path segments, and symlink escapes after resolution.

### BFF Token Boundary

The FastAPI token is never exposed to browser JavaScript. Next.js route handlers attach it server-side.

Key implementation shape in `apps/web/lib/storage-api.ts`:

```ts
export function storageHeaders(extra?: HeadersInit): HeadersInit {
  return {
    ...extra,
    "X-PersonalCloud-Token": requireEnv("PERSONALCLOUD_INTERNAL_API_TOKEN"),
  };
}
```

The browser sees only same-origin routes such as `/api/storage/list`; the BFF forwards to FastAPI with the internal header.

### Session Model

V1 is single-admin. The login token is checked by Next.js, then the app sets a signed HTTP-only cookie.

Theory:

- The admin token is a bootstrap secret, not a user account database.
- The browser session cookie is signed so the server can verify it without storing session rows.
- The cookie is HTTP-only so client JavaScript cannot read it.

This is intentionally simpler than OAuth or multi-user accounts because v1 is a private single-owner appliance.

### Directory Metadata Cache

FastAPI currently keeps an in-memory directory listing cache:

```python
_DIRECTORY_CACHE: dict[tuple[str, str], DirectoryListing] = {}
_SEARCH_INDEX_CACHE: dict[str, list[FileItem]] = {}
```

The cache is invalidated after every mutation that can change metadata:

```python
def _invalidate_metadata_cache(root: Path) -> None:
    root_key = str(root)
    for key in [key for key in _DIRECTORY_CACHE if key[0] == root_key]:
        del _DIRECTORY_CACHE[key]
    _SEARCH_INDEX_CACHE.pop(root_key, None)
```

Practical tradeoff:

- Good enough for a single-process local service.
- Fast and simple.
- Not durable and not shared across multiple Uvicorn workers.

Revisit when search, trash restore, audit history, or multi-process deployment needs durable state. SQLite should be the first upgrade path.

### Search Index

Search is metadata-only and built from the filesystem. The index excludes trash and returns matching file/folder metadata.

Current behavior:

- Search matches against `name` and API `path`.
- Results are limited.
- Index is rebuilt after cache invalidation.
- No raw file contents are indexed.

Theory:

Search indexing is separate from file storage. The filesystem remains source of truth; the index is only an acceleration structure.

### Streaming And Archive Downloads

Downloads, previews, and folder archives are streamed through FastAPI and proxied by Next.js.

For normal files:

```python
return FileResponse(path=target, filename=target.name)
```

For folder archive download:

```python
with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for child in target.rglob("*"):
        archive.write(child, child.relative_to(target.parent))
```

The archive is generated server-side so compression still respects root-bound path validation. Temporary ZIP files are cleaned after the response through a background task.

### Preview Model

Preview support is decided by FastAPI, not the frontend. The UI asks `preview-info` first, then renders only supported browser-native types.

Supported v1 preview kinds:

- image
- video
- audio
- PDF
- text/code below the configured size limit

Unsupported files show metadata and download action. There is no Office conversion, thumbnail generation pipeline, or raw file content cache yet.

### Finder-Style UI

The current UI is intentionally modeled more like macOS Finder than a web admin table:

- desktop root folder
- explorer window with sidebar
- grid, compact, and details views
- right-click and three-dot context menus
- multi-select and keyboard shortcuts
- floating preview overlay
- background and motion controls

Practical reason: file management is a spatial task. A familiar desktop model reduces friction compared with a CRUD table.

### Current API Contract

FastAPI internal API:

```http
GET    /health
GET    /api/files?path=
GET    /api/files/search?query=
POST   /api/folders
POST   /api/files/upload
GET    /api/files/download?path=
GET    /api/files/archive?path=
GET    /api/files/preview?path=
GET    /api/files/preview-info?path=
PATCH  /api/files/rename
POST   /api/files/copy
POST   /api/files/move
DELETE /api/files?path=
```

Next.js browser-facing BFF routes mirror these storage operations under `/api/storage/*` and add `/api/session/login` plus `/api/session/logout`.

## Interview Explanation

### Problem

I had an unused secondary PC with spare disk capacity. Instead of treating it as wasted hardware, I built a private cloud appliance that exposes one safe storage root to my own devices.

### Constraints

- The machine may reboot, sleep, or be physically remote.
- The app must not expose the whole filesystem.
- Large files should stream rather than load into memory.
- The browser should not know backend service secrets.
- V1 should be usable locally before adding cloud or sync complexity.

### Key Tradeoffs

- FastAPI over Node-only backend: better local filesystem and automation story.
- Next.js BFF over direct browser-to-FastAPI calls: cleaner session and token boundary.
- Tailscale over public port forwarding: smaller attack surface.
- In-memory metadata cache over SQLite first: faster progress, simpler deployment.
- Soft delete over hard delete: safer personal storage behavior.
- Browser-native preview over conversion pipeline: useful coverage without heavyweight processing.

### Scaling Path

The project can grow in layers:

1. In-memory metadata cache.
2. SQLite metadata/search/trash/audit state.
3. Windows watchdog and startup reliability.
4. Tailscale hardening and device setup guide.
5. One-way backup.
6. Manual cloud inbox with chunk manifests and hash verification.

### Failure Modes To Discuss

- FastAPI token leak: rotate token, keep it out of browser, consider mTLS later.
- Cache stale after mutation: invalidate root cache on every write operation.
- Disk full: add preflight checks before upload/archive/chunk import.
- Symlink escape: resolve final path and prove it remains under root.
- Partial uploads: current multipart is not resumable; future cloud inbox uses chunk manifests.
- Trash growth: add retention cleanup and restore metadata.

## Decision Log

### Decision: Python/FastAPI For Storage Backend

- Alternatives considered: Node.js/TypeScript backend, hybrid Node plus Python scripts.
- Why chosen: Python is a strong fit for local-agent work on Windows: filesystem operations, watchdog scripts, health checks, automation, and future `rclone` orchestration.
- What we lose: TypeScript types are not shared automatically between frontend and backend.
- What would make us revisit: if API contract drift becomes painful, if streaming performance is insufficient, or if the project benefits more from a single-language full-stack codebase.

### Decision: Next.js As UI And BFF

- Alternatives considered: browser calls FastAPI directly, FastAPI serves templates, single-page React app only.
- Why chosen: Next.js gives SSR options, server routes, session handling, cache-aware data loading, and a polished frontend story.
- What we lose: two app runtimes instead of one.
- What would make us revisit: if deployment complexity outweighs SSR/BFF benefits for the personal server use case.

### Decision: Tailscale Private Network For V1

- Alternatives considered: public port forwarding, Cloudflare Tunnel with Access, VPN hosted manually.
- Why chosen: Tailscale gives encrypted private access across devices without exposing a public file server.
- What we lose: access requires devices to join the tailnet.
- What would make us revisit: if the project needs public share links or a domain-based demo with external reviewers.

### Decision: Single Storage Root

- Alternatives considered: arbitrary filesystem browser, multiple mounted folders, per-user roots.
- Why chosen: one configured root is easier to secure, explain, test, and recover.
- What we lose: less flexibility for browsing the whole secondary PC.
- What would make us revisit: if the product needs multiple explicitly approved libraries such as Photos, Videos, and Documents.

### Decision: Metadata Cache Instead Of File Content Cache

- Alternatives considered: no cache, cache raw file contents, generated preview cache.
- Why chosen: metadata caching improves navigation speed while avoiding file privacy, invalidation, and disk-pressure risks.
- What we lose: repeated downloads/previews still stream from disk.
- What would make us revisit: if thumbnail generation, search indexing, or offline preview speed becomes a priority.

### Decision: Soft Delete/Trash

- Alternatives considered: hard delete, no delete in v1.
- Why chosen: personal storage needs protection from accidental mobile deletes while keeping the file manager complete.
- What we lose: trash consumes storage until cleaned.
- What would make us revisit: if storage pressure requires scheduled permanent cleanup.

### Decision: Browser-Native Previews

- Alternatives considered: generated thumbnails, Office document conversion, external preview service.
- Why chosen: browser-native previews cover common media and document inspection needs with low complexity.
- What we lose: `.docx`, `.xlsx`, and `.pptx` previews are not first-class in v1.
- What would make us revisit: if Office document preview becomes central to the user workflow.

### Decision: Preview Streaming Without Preview Cache

- Alternatives considered: generated thumbnail cache, storing preview derivatives, loading file contents through the Next.js client first.
- Why chosen: streaming keeps large previews memory-conscious and preserves the source file as the only stored artifact.
- What we lose: repeated previews are read from disk each time and media thumbnails are not precomputed.
- What would make us revisit: if gallery navigation, offline browsing, or thumbnail-heavy media workflows become a priority.

### Decision: Server-Owned Preview Metadata

- Alternatives considered: frontend extension checks, duplicated frontend/backend mappings, MIME sniffing in the browser.
- Why chosen: FastAPI already owns trusted file metadata and path validation, so it should decide whether a file can be previewed and why not.
- What we lose: the UI needs one extra metadata request before rendering a preview.
- What would make us revisit: if latency becomes noticeable and metadata is later included in cached directory listings.

### Decision: Plan Google Drive Backup, Do Not Implement In First Functional Milestone

- Alternatives considered: immediate one-way backup, immediate two-way sync, Syncthing-first design.
- Why chosen: stable local file serving should come before backup/sync complexity.
- What we lose: v1 does not provide cloud fallback when the secondary PC is offline.
- What would make us revisit: after core file operations, previews, auth, and watchdog reliability are working.

### Decision: Monorepo For Mixed Tech Stack

- Alternatives considered: separate frontend and backend repositories, backend-only repository first.
- Why chosen: the project is one product made of multiple apps. A monorepo keeps shared docs, architecture decisions, setup scripts, and handoff context in one place while still allowing Next.js and FastAPI to use separate tooling.
- What we lose: the repo has more than one runtime and dependency manager.
- What would make us revisit: if frontend and backend develop independently enough to need separate release cycles or access control.

### Decision: No External Database In V1

- Alternatives considered: PostgreSQL, SQLite from day one, object storage service.
- Why chosen: the filesystem is the source of truth for v1. Avoiding an external database keeps the secondary PC deployable as a local appliance and reduces setup failure points.
- What we lose: no durable audit log, search index, trash manifest, or sync state table yet.
- What would make us revisit: when metadata caching, restore history, search, audit trails, or backup state need durable structured storage. SQLite should be the first database considered.

### Decision: Internal Service Token For FastAPI API Routes

- Alternatives considered: no FastAPI auth until Next.js exists, full user login in FastAPI, mTLS between local services.
- Why chosen: a simple internal token gives the future Next.js BFF a clear backend boundary without duplicating user-facing session auth.
- What we lose: token rotation and per-client permissions are not modeled yet.
- What would make us revisit: if FastAPI is ever exposed beyond localhost/Tailscale-private access or if multiple backend clients need separate credentials.

### Decision: Signed Cookie Session In Next.js

- Alternatives considered: unsigned cookie flag, FastAPI-owned login, no login until later.
- Why chosen: the browser gets a simple admin login while the internal FastAPI token stays server-side inside Next.js BFF routes.
- What we lose: this is still single-admin auth, not user accounts or device pairing.
- What would make us revisit: if multi-user access, revocation, or device management becomes part of the product.

### Decision: Filesystem-Only Trash For Chunk 2

- Alternatives considered: hard delete, JSON manifest, SQLite-backed trash records.
- Why chosen: moving deleted items into a hidden trash folder protects against accidental deletes without adding a database before restore/audit requirements exist.
- What we lose: there is no first-class restore metadata yet.
- What would make us revisit: when restore UI, retention cleanup, or audit history becomes part of the roadmap.

### Decision: Cloudflare R2 For Future Cloud Inbox

- Alternatives considered: Cloudinary, Backblaze B2, Supabase Storage, Firebase Storage, Appwrite Storage, provider-free local-only uploads.
- Why chosen: R2 has a strong free tier for this learning project, S3-compatible APIs, no direct egress charges, and enough capacity to test 400 MB chunked uploads without making cloud storage the source of truth.
- What we lose: account setup and object-storage credentials are required; the app gains a cloud dependency for the optional inbox path.
- What would make us revisit: if R2 account setup blocks progress, if free-tier limits change, or if Backblaze B2 becomes easier for the target workflow.

### Decision: Reject Cloudinary As General File Inbox

- Alternatives considered: using Cloudinary as an inbox dump, using it as a hot cache, using it only for media previews.
- Why chosen: Cloudinary is excellent for image/video management, but arbitrary large personal files, resumable chunk ingestion, privacy controls, and temporary staging fit object storage better.
- What we lose: built-in media transformations and CDN conveniences for files placed in the inbox.
- What would make us revisit: if a later media gallery feature needs image/video transformations, thumbnails, or optimized delivery.

### Decision: Manual Chunks-As-Objects Upload Protocol

- Alternatives considered: provider-native multipart upload, whole-file cloud upload, direct upload to the secondary PC only.
- Why chosen: manual chunking is a deliberate learning goal. It exposes hashing, manifests, resumability, worker import, integrity checks, and atomic file commit in a way provider-native multipart hides.
- What we lose: more code, more edge cases, and more object operations than provider-native multipart.
- What would make us revisit: if reliability or provider costs become more important than learning value.

### Decision: Desktop-Style File Explorer UI

- Alternatives considered: table-first file manager, dashboard card layout, mobile-only list view.
- Why chosen: the product maps naturally to familiar desktop file management, so a root desktop icon, explorer window, folder/file tiles, back/forward navigation, and bottom-right controls make the storage server feel like a remote desktop folder instead of a generic admin table.
- What we lose: dense table scanning for large directories is less efficient until we add list/grid view switching.
- What would make us revisit: if users manage folders with hundreds of files at a time, need sortable columns, or need keyboard-heavy power-user workflows.

## Tradeoff Entry Template

Use this format for future decisions:

```md
### Decision: <short title>

- Alternatives considered:
- Why chosen:
- What we lose:
- What would make us revisit:
```

## Concept Notes

### Private Networking And Zero-Trust Access

The safest v1 access model is private networking through Tailscale. It reduces attack surface because the app does not need to accept traffic from the open internet. Application auth is still required because network trust alone should not be the only control.

Relevant interview angle: defense in depth. Tailscale protects network access, Next.js handles user session, FastAPI validates backend service requests, and filesystem guards protect storage boundaries.

### SSR, BFF, And Caching

Next.js gives the project a clean browser-facing boundary. It can render fast initial pages, keep backend details private, and cache metadata that is safe to reuse. The BFF pattern also keeps browser auth simpler because the browser talks to one origin.

Relevant interview angle: the frontend is not just a static UI; it owns session boundaries, request shaping, and cache strategy.

### Filesystem Path Traversal Protection

Every file operation must resolve user input into a normalized path and prove the final path remains inside the configured storage root. This applies to list, upload, download, preview, rename, delete, restore, and future backup operations.

Relevant interview angle: filesystem APIs are dangerous when user input is treated like a path. The storage root is a security boundary.

### Streaming Downloads And Previews

Large files should be streamed rather than read fully into memory. This matters for videos, large archives, and mobile downloads. Preview and download routes should share the same auth and path validation model.

Relevant interview angle: file-serving systems need backpressure-aware streaming and memory discipline.

### Watchdogs And Self-Healing Services

The secondary PC may reboot, sleep, lose network, or run without direct supervision. Task Scheduler plus a watchdog gives practical reliability without needing a full service manager in v1.

Relevant interview angle: reliability is not just uptime claims; it is boot behavior, health checks, restart policy, and logs.

### Backup Consistency And Conflict Handling

Google Drive backup is useful, but two-way sync creates conflict and deletion semantics. The safer path is one-way backup first, then optional import or conflict-aware sync later.

Relevant interview angle: distributed file sync looks simple but becomes hard around deletes, renames, concurrent edits, and partial uploads.

### Cloud Inbox And Manual Chunking

The cloud inbox is a future ingestion path, not a serving cache. For a large file, the browser creates an upload session, splits the file into chunks, hashes each chunk, uploads each chunk as a separate object, and publishes a manifest. The secondary PC worker later downloads chunks, verifies integrity, reassembles the file in staging, verifies the full file hash, and atomically moves the final file into the storage root.

Relevant interview angle: this is a miniature distributed upload protocol. It covers chunk tables, hash verification, resumability, offline workers, idempotent retries, atomic commits, quota cleanup, and privacy tradeoffs.

Default protocol notes:

- Default chunk size should start at 8 MB or 16 MB.
- Object keys should follow `inbox/{uploadId}/chunks/{chunkIndex}`.
- Local staging should use `.personalcloud-staging/{uploadId}/chunks`.
- SQLite becomes justified when this chunk starts because upload sessions and chunk status need durable state.
- Reassembly must never happen directly at the final file path.
- Cloud chunks should be deleted only after local verification and commit succeed.

## References To Track

- [Next.js caching docs](https://nextjs.org/docs/app/building-your-application/caching)
- [FastAPI custom response and streaming docs](https://fastapi.tiangolo.com/advanced/custom-response/)
- [Tailscale Funnel/private access docs](https://tailscale.com/docs/features/tailscale-funnel)
- [Cloudflare Tunnel docs](https://developers.cloudflare.com/tunnel/)
- [rclone Google Drive docs](https://rclone.org/drive/)
- [Syncthing docs](https://docs.syncthing.net/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Backblaze B2 pricing structure](https://help.backblaze.com/hc/en-us/articles/217667478-Understanding-B2-Pricing-Structure)
- [Tigris pricing](https://www.tigrisdata.com/docs/pricing/)
- [Supabase pricing](https://supabase.com/pricing)
- [Cloudinary file size limits](https://support.cloudinary.com/hc/en-us/articles/202520592-Do-you-have-a-file-size-limit-)

## Architecture Update Log

### 2026-05-15: Initial Architecture Baseline

- Created the initial architecture direction for a private personal cloud hosted on a secondary Windows PC.
- Chose Python/FastAPI for trusted storage operations and local automation.
- Chose Next.js for UI, BFF behavior, session handling, SSR options, and metadata caching.
- Chose Tailscale for v1 remote access to avoid public internet exposure.
- Set the v1 safety boundary around one configured storage root.
- Planned browser-native previews, metadata caching, soft delete, and watchdog reliability.
- Deferred Google Drive/rclone integration until after the core server is stable.

### 2026-05-15: FastAPI Storage Service Scaffold

- Created a monorepo layout with `services/storage` for the Python/FastAPI service.
- Added an initial health endpoint and root-bound directory listing endpoint.
- Added safe path resolution tests that block traversal, absolute paths, and malformed relative paths.
- Kept v1 storage filesystem-first with no external database.

### 2026-05-15: Future Cloud Inbox Direction

- Planned a later manual chunk-based cloud inbox for large remote uploads.
- Chose Cloudflare R2 as the default provider candidate because its free tier, S3-compatible APIs, and direct egress model fit temporary chunk staging.
- Kept Backblaze B2 as the fallback provider candidate.
- Rejected Cloudinary as a general arbitrary-file inbox/cache while leaving it open for future media-specific features.
- Defined chunks-as-objects as the learning path instead of provider-native multipart upload.
- Kept cloud inbox after the local storage, Next.js file manager, previews, caching, and reliability chunks.

### 2026-05-15: FastAPI Storage Core Completion

- Added internal token protection for `/api/*` routes and kept `/health` public for watchdogs.
- Completed local filesystem operations for folder creation, multipart upload, streaming download, rename, and move-to-trash.
- Kept normal multipart upload for local/Tailscale v1 and deferred manual chunking to the cloud inbox chunk.
- Kept trash filesystem-only with collision-safe names under `.personalcloud-trash`.
- Added tests for auth, unsafe paths across operations, symlink escapes, operation conflicts, and full upload/download/rename/delete flow.

### 2026-05-15: Next.js File Manager

- Added `apps/web` as the local Next.js App Router frontend with npm, TypeScript, and Tailwind.
- Added signed HTTP-only cookie login using `PERSONALCLOUD_ADMIN_TOKEN` and `PERSONALCLOUD_SESSION_SECRET`.
- Added BFF routes for listing, folder creation, upload, download, rename, and delete.
- Kept `X-PersonalCloud-Token` server-side so browser requests never expose the FastAPI internal token.
- Added a responsive file manager UI for browsing folders, creating folders, uploading, downloading, renaming, and moving items to trash.

### 2026-05-15: Browser-Native Preview System

- Added FastAPI `GET /api/files/preview` with the same internal token auth and path validation as downloads.
- Added Next.js `GET /api/storage/preview` so preview streams pass through the BFF and keep FastAPI private.
- Added file-manager preview actions and a preview panel for image, video, audio, PDF, and text/code files.
- Kept unsupported file types graceful with metadata and download behavior instead of conversion.
- Avoided thumbnails, raw content caching, Office conversion, Cloudinary, and generated preview assets for this chunk.

### 2026-05-15: Preview Hardening

- Added FastAPI `GET /api/files/preview-info` as the source of truth for preview support, kind, MIME type, size, and unsupported reason.
- Added `PERSONALCLOUD_MAX_TEXT_PREVIEW_BYTES` with a 1 MB default to prevent loading oversized text files into the browser.
- Added Next.js `GET /api/storage/preview-info` as the authenticated BFF route for preview metadata.
- Removed frontend-owned extension mapping and made the preview panel render from server-owned metadata.
- Added tests for preview metadata, unsupported files, oversized text, unsafe paths, missing paths, and directories.

### 2026-05-16: Desktop-Style File Manager UI

- Reworked the Next.js file manager from a table-first layout into a desktop-style interface.
- Added light/dark mode using CSS variables and persisted the chosen theme in local storage.
- Added a root desktop folder, an explorer window with close/minimize controls, icon-grid file browsing, and bottom-right back/forward/refresh/upload actions.
- Kept FastAPI and Next.js BFF contracts unchanged so the UI polish did not weaken the storage security boundary.

### 2026-05-16: File Explorer Interaction Refinement

- Made dark mode the default visual theme at the CSS and React state level.
- Removed the duplicate Root tile from inside the Root directory view.
- Replaced hover-only file actions with right-click and three-dot context menus for each entity.
- Kept item operations scoped to item menus: folders expose open/rename/delete/properties, while files expose preview/download/rename/delete/properties.
- Kept folder-level tools in the side panel and folder background menu: upload, new folder, refresh, sort, view mode, and copy current path.
- Deferred cut/copy/paste file movement because it needs explicit backend move/copy APIs rather than UI-only state.

### 2026-05-16: Floating Preview And Desktop Background Polish

- Replaced the side preview panel with a full-window floating preview overlay inside the explorer.
- Added top-right preview controls for download and close so media inspection behaves like a focused viewer.
- Added an explicit top-right close button for the explorer in addition to the macOS-style window control dots.
- Added subtle animated desktop background treatment using CSS gradients and an SVG grid pattern without adding third-party UI dependencies.
- Kept previews browser-native and streamed through the existing Next.js BFF routes.

### 2026-05-16: Finder-Style Explorer Expansion

- Added a macOS-inspired sidebar for Root, media/document smart filters, and root upload.
- Added grid, compact, and details views so the file manager can switch between visual browsing and denser scanning.
- Added image thumbnails by loading supported image files through the existing authenticated preview route.
- Added multi-select, select-all, keyboard shortcuts, and Finder-style clipboard actions for copy, cut, and paste.
- Added FastAPI bulk copy/move endpoints plus Next.js BFF routes so paste operations are real filesystem operations, not client-only UI state.
- Added multi-file upload from one picker interaction with a visible upload queue and per-file progress/status.
- Kept file movement inside the configured storage root and collision-safe by default.

### 2026-05-16: Finder Polish, Dialogs, And Folder Archive Download

- Moved shortcut help into a header icon that opens a modal instead of occupying persistent explorer space.
- Added a background picker modal that stores a selected desktop background image locally in the browser.
- Replaced delete browser alerts with an in-app confirmation modal for all delete actions.
- Added dismiss controls for the upload queue so completed or failed batch-upload rows can be cleared manually.
- Added folder archive download through FastAPI `GET /api/files/archive` and a Next.js BFF proxy route.
- Kept folder archive generation server-side so compression respects storage-root validation and does not expose filesystem paths to the browser.
- Positioned three-dot context menus from the clicked button geometry so menus open beside the selected file/folder instead of far away.

### 2026-05-16: Metadata Cache, Search Index, And Explorer Accessibility

- Added an in-memory FastAPI metadata cache for directory listings keyed by storage root and requested path.
- Added a simple FastAPI search index built from filesystem metadata and invalidated after upload, folder create, rename, copy, move, and trash operations.
- Added a Next.js BFF search route so the browser still does not call FastAPI directly.
- Added explorer top-bar search across files and folders using the backend index.
- Increased the explorer size and reduced title/navigation bar height to give the file area more room.
- Added background motion controls with full, slow, and off modes, plus CSS respect for `prefers-reduced-motion`.
- Improved context menu placement with viewport-aware clamping/flipping so menus stay reachable near lower screen edges.

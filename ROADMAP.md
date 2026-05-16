# PersonalCloud Roadmap

This roadmap breaks the project into manageable chunks. Work on one chunk at a time so future context handoffs stay simple and implementation decisions remain traceable.

## Chunk 1: Docs And Repo Foundation

Goal: establish the project direction before writing application code.

Deliverables:

- Create `AGENTS.md`, `ROADMAP.md`, and `ARCHITECTURE.md`.
- Define the stack: Next.js UI/BFF, Python/FastAPI storage service, Tailscale private access, Windows watchdog reliability.
- Record v1 boundaries: single admin user, one assigned storage root, metadata caching, browser-native previews, soft delete, no two-way sync.

Acceptance criteria:

- Future agents can understand the mission, safety rules, architecture direction, and active roadmap from the docs alone.
- `ARCHITECTURE.md` contains an initial decision log and tradeoff format.

## Chunk 2: FastAPI Storage Core

Goal: build the trusted local storage service.

Deliverables:

- Configure a single storage root through environment/config.
- Implement safe path resolution and root-boundary validation.
- Add APIs for folder listing, upload, download, create folder, rename, and move-to-trash.
- Add a health endpoint for watchdog checks.
- Add structured logs for file operations and errors.

Acceptance criteria:

- Path traversal, absolute paths, encoded traversal, and symlink escapes are blocked.
- File operations work only inside the configured root.
- The service can stream files without loading entire large files into memory.
- Health endpoint returns enough status for a watchdog to make restart decisions.

## Chunk 3: Next.js File Manager

Goal: create the user-facing app.

Deliverables:

- Build login screen using the single admin token model.
- Store the authenticated session in a secure cookie.
- Add file browser, upload, download, create folder, rename, and delete-to-trash flows.
- Route browser requests through Next.js server routes instead of exposing FastAPI directly.
- Make the layout usable on desktop and mobile.

Acceptance criteria:

- Unauthenticated users cannot list, preview, upload, download, rename, or delete files.
- The UI can navigate directories without leaving the configured root.
- Next.js acts as a BFF boundary for auth, caching, and request forwarding.

## Chunk 4: Preview System

Goal: allow users to inspect files before downloading.

Deliverables:

- Add browser-native preview panel for images, videos, audio, PDFs, and text/code files.
- Stream preview content through authenticated routes.
- Show metadata and download action for unsupported file types.

Acceptance criteria:

- Preview routes enforce the same auth and path safety rules as downloads.
- Large media previews stream instead of buffering fully in the app.
- Unsupported file types fail gracefully.

## Chunk 5: Caching And Indexing

Goal: improve perceived speed while keeping file contents private and fresh.

Deliverables:

- Cache directory listings, file metadata, and storage stats.
- Invalidate relevant cache entries after upload, rename, folder creation, delete, and restore.
- Consider SQLite only if metadata, indexing, search, or audit requirements outgrow in-memory/simple-file cache.

Acceptance criteria:

- Directory reloads are fast for common navigation paths.
- Mutations do not leave stale listings visible.
- Raw file contents are not cached by the app layer.

## Chunk 6: Windows Reliability

Goal: make the secondary PC behave like an unattended personal server.

Deliverables:

- Add a startup script for the app stack.
- Add a watchdog script that checks `/health` and restarts unhealthy services.
- Document Task Scheduler triggers for boot, login, and wake-from-sleep.
- Write logs for startup, crashes, restarts, and health failures.

Acceptance criteria:

- Server starts automatically after boot/login.
- Watchdog restarts the service after failure.
- Wake-from-sleep behavior is documented and testable.

## Chunk 7: Remote Access Hardening

Goal: make access safe and repeatable from primary PC and mobile.

Deliverables:

- Document Tailscale setup for secondary PC, primary PC, and mobile.
- Verify access over the tailnet.
- Add a security checklist covering tokens, local firewall, no public ports, and backup of config.
- Document Cloudflare Access as a future optional public-domain path, not v1 behavior.

Acceptance criteria:

- App is reachable from trusted devices over Tailscale.
- No router port forwarding is required.
- Security assumptions are explicit.

## Chunk 8: Cloud Inbox And Manual Chunk Sync

Goal: support large remote uploads when the secondary PC is offline or unreliable, while keeping local storage as the source of truth.

Deliverables:

- Use Cloudflare R2 as the default cloud inbox provider, with Backblaze B2 as the fallback candidate.
- Add a manual chunk upload protocol where the browser splits large files, hashes chunks, uploads each chunk as its own object, and writes a manifest.
- Add durable local state with SQLite for upload sessions, chunk records, retry counts, import status, and errors.
- Add a secondary-PC worker that downloads chunks, verifies hashes, reassembles into staging, verifies the final file, and atomically commits into the storage root.
- Add cleanup rules for imported cloud chunks, abandoned uploads, and quota protection.

Acceptance criteria:

- A 400 MB file can be represented as a manifest plus chunk objects without routing bytes through the Next.js server.
- Interrupted browser uploads can resume by checking existing chunks.
- Worker imports are resumable and never write partially assembled files directly to the final destination.
- Corrupted or missing chunks are detected before final commit.
- Cloud inbox remains temporary staging, not a serving cache or primary file store.

## Chunk 9: Backup And Sync

Goal: add backup without turning v1 into a conflict-heavy sync product.

Deliverables:

- Document planned `rclone` integration separately from cloud inbox ingestion.
- Implement one-way backup from selected storage folders to Google Drive.
- Log backup status, failures, and last successful run.
- Later evaluate conflict-safe import or two-way sync.

Acceptance criteria:

- Backup does not corrupt or delete source files.
- Sync failures are visible in logs/status.
- Two-way sync is not added until conflict and deletion semantics are designed.
- Backup remains local-to-cloud durability, while cloud inbox remains cloud-to-local ingestion.

## Chunk 10: Resume Polish

Goal: make the project easy to demo and explain.

Deliverables:

- Add README with setup, screenshots, and demo flow.
- Add architecture diagrams.
- Add interview notes for problem, constraints, tradeoffs, failure modes, and scaling path.
- Add a short demo script showing local storage, remote access, preview, cache, and watchdog behavior.

Acceptance criteria:

- A reviewer can understand why the project is more than a CRUD file manager.
- The docs explain the system design decisions crisply.
- Demo flow highlights security, reliability, and user experience.

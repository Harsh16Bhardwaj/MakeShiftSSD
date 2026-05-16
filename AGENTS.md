# PersonalCloud Agent Guide

## Mission

PersonalCloud turns a secondary Windows PC into a private personal cloud server. The machine should expose a controlled storage directory to the owner's primary PC and mobile devices through a secure private network, while staying reliable enough to run unattended in the background.

This is also a resume-worthy full-stack infrastructure project. Every major decision should be explainable in interviews: security boundaries, file streaming, caching, watchdog reliability, remote access, and backup tradeoffs.

## Current Architecture Direction

- Frontend: Next.js app used as the user-facing UI and BFF layer.
- Backend: Python/FastAPI storage service that owns trusted filesystem operations.
- Remote access: Tailscale private network for v1.
- Reliability: Windows Task Scheduler plus a watchdog script.
- Storage model: one configured storage root; never expose the whole computer.
- Auth model: single admin token for v1, with a secure session cookie at the Next.js layer.
- Cache model: cache directory metadata and storage stats, not raw file contents.
- Preview model: browser-native previews for images, videos, audio, PDFs, and text/code files.
- Delete model: soft delete/trash instead of direct hard delete.
- Future cloud inbox: Cloudflare R2 is the planned provider for manual chunk-based cloud-to-local ingestion.

## Hard Safety Rules

- All file operations must stay inside the configured storage root.
- Never add an arbitrary machine-wide file browser.
- Normalize and validate paths before reading, writing, moving, deleting, or streaming files.
- Block path traversal attempts such as `../`, absolute paths, encoded traversal, and symlinks escaping the root.
- Do not expose the app through public port forwarding in v1.
- Do not cache raw file contents in the application layer until there is a specific design for invalidation, privacy, and storage pressure.
- Treat delete as move-to-trash unless a later roadmap item explicitly adds permanent deletion.
- Treat cloud inbox storage as temporary staging only; the local filesystem remains the source of truth.
- Do not use Cloudinary as a general-purpose arbitrary-file relay/cache. It may be reconsidered later only for media-specific transformations or previews.
- Manual chunk uploads must verify chunk hashes and whole-file hashes before committing files into the storage root.

## Development Principles

- Work one roadmap chunk at a time.
- Keep changes narrow and aligned with `ROADMAP.md`.
- Update `ARCHITECTURE.md` whenever a meaningful tradeoff, technology choice, or architecture change is made.
- Prefer secure defaults over convenience.
- Keep the docs useful for both engineering handoff and interview preparation.
- Favor boring, observable reliability: health endpoints, logs, watchdog checks, and explicit startup behavior.
- Keep the first version single-user/admin-only unless the roadmap is intentionally expanded.

## V1 Non-Goals

- No public internet exposure.
- No two-way Google Drive sync.
- No multi-user permission model.
- No arbitrary filesystem browsing outside the configured root.
- No Office document conversion pipeline.
- No generated thumbnail system unless the preview roadmap is expanded.
- No cloud inbox implementation until the local file server, Next.js file manager, previews, caching, and reliability chunks are stable.
- No provider-native multipart upload as the primary learning path for the cloud inbox; the planned feature is manual chunks-as-objects.

## Expected Project Shape

The exact folder structure can evolve, but future implementation should keep these responsibilities clear:

- `apps/web` or equivalent: Next.js UI and BFF routes.
- `services/storage` or equivalent: FastAPI storage service.
- `scripts/windows` or equivalent: startup, watchdog, and Task Scheduler helpers.
- `docs` or root Markdown files: architecture, roadmap, setup, and interview notes.

## Handoff Checklist For Future Agents

Before editing code:

1. Read this file.
2. Read `ROADMAP.md` and identify the active chunk.
3. Read `ARCHITECTURE.md` for decisions already made.
4. Keep the implementation inside the active chunk unless the user explicitly expands scope.
5. If a new tradeoff is introduced, append it to `ARCHITECTURE.md`.

# PersonalCloud

PersonalCloud is a private cloud project for turning a secondary Windows PC into a secure storage server reachable from trusted devices over Tailscale.

The project is intentionally structured as a monorepo: one repository contains the FastAPI storage service, the future Next.js web app, Windows automation scripts, and architecture documentation. This keeps cross-service decisions, setup, and handoffs in one place while still allowing each tech stack to have its own tooling.

## Current Status

- Docs foundation exists in `AGENTS.md`, `ROADMAP.md`, and `ARCHITECTURE.md`.
- FastAPI storage service scaffold exists in `services/storage`.
- Next.js file manager exists in `apps/web`.
- Future cloud inbox is documented as a later manual chunk upload feature, not current v1 behavior.

## Why No External DB Yet

V1 uses the filesystem as the source of truth. Files are stored under one configured storage root, and metadata is read from disk.

SQLite may be added later for durable audit logs, cached indexes, trash manifests, backup state, or search metadata. A networked external database is intentionally avoided for v1 because this project should work as a local appliance on the secondary PC.

## Future Cloud Inbox

Large remote uploads will eventually use a manual chunk protocol:

- Browser splits a file into chunks.
- Browser hashes each chunk.
- Browser uploads chunk objects to Cloudflare R2.
- Browser publishes a manifest.
- The secondary PC worker downloads chunks, verifies hashes, reassembles in staging, verifies the final file, and atomically commits into local storage.

This is future work. Cloud inbox is temporary staging only; the local filesystem remains the source of truth. Cloudinary is intentionally not the general-purpose inbox provider because arbitrary large file relay fits object storage better.

## FastAPI Storage Service

```powershell
cd D:\PersonalCloud\services\storage
uv sync
Copy-Item .env.example .env
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
```

Set a real local service token in `.env` before running outside quick experiments:

```env
PERSONALCLOUD_INTERNAL_API_TOKEN=replace-with-a-long-random-token
PERSONALCLOUD_MAX_TEXT_PREVIEW_BYTES=1048576
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

List the root folder:

```powershell
$headers = @{ "X-PersonalCloud-Token" = "replace-with-a-long-random-token" }
Invoke-RestMethod "http://127.0.0.1:8765/api/files?path=" -Headers $headers
```

Create a folder:

```powershell
$body = @{ parent_path = ""; name = "docs" } | ConvertTo-Json
Invoke-RestMethod "http://127.0.0.1:8765/api/folders" -Method Post -Headers $headers -ContentType "application/json" -Body $body
```

Upload a file:

```powershell
curl.exe -X POST "http://127.0.0.1:8765/api/files/upload" `
  -H "X-PersonalCloud-Token: replace-with-a-long-random-token" `
  -F "parent_path=docs" `
  -F "file=@D:\path\to\file.txt"
```

Download a file:

```powershell
curl.exe -L "http://127.0.0.1:8765/api/files/download?path=docs/file.txt" `
  -H "X-PersonalCloud-Token: replace-with-a-long-random-token" `
  -o file.txt
```

Rename a file or folder:

```powershell
$body = @{ path = "docs/file.txt"; new_name = "renamed.txt" } | ConvertTo-Json
Invoke-RestMethod "http://127.0.0.1:8765/api/files/rename" -Method Patch -Headers $headers -ContentType "application/json" -Body $body
```

Move an item to trash:

```powershell
Invoke-RestMethod "http://127.0.0.1:8765/api/files?path=docs/renamed.txt" -Method Delete -Headers $headers
```

Preview a supported file:

```powershell
curl.exe -L "http://127.0.0.1:8765/api/files/preview?path=docs/file.txt" `
  -H "X-PersonalCloud-Token: replace-with-a-long-random-token"
```

Check preview support before streaming:

```powershell
Invoke-RestMethod "http://127.0.0.1:8765/api/files/preview-info?path=docs/file.txt" -Headers $headers
```

## Next.js Web App

```powershell
cd D:\PersonalCloud\apps\web
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set matching local tokens in `apps\web\.env.local`:

```env
PERSONALCLOUD_ADMIN_TOKEN=replace-with-a-login-token
PERSONALCLOUD_SESSION_SECRET=replace-with-at-least-32-random-characters
PERSONALCLOUD_STORAGE_API_URL=http://127.0.0.1:8765
PERSONALCLOUD_INTERNAL_API_TOKEN=replace-with-the-same-token-used-by-fastapi
```

Open:

```text
http://127.0.0.1:3000
```

The browser talks to Next.js only. Next.js proxies storage requests to FastAPI and attaches `X-PersonalCloud-Token` server-side.

The file manager supports browser-native previews for common images, audio, video, PDFs, and text/code files. FastAPI owns preview support decisions through `preview-info`; unsupported files keep the download path available without attempting conversion. Text preview is capped by `PERSONALCLOUD_MAX_TEXT_PREVIEW_BYTES`.

## Local End-To-End Test Guide

Use two different tokens:

- `PERSONALCLOUD_ADMIN_TOKEN`: typed into the login page.
- `PERSONALCLOUD_INTERNAL_API_TOKEN`: shared only between Next.js and FastAPI.

For local testing, this setup is fine:

```env
PERSONALCLOUD_ADMIN_TOKEN=personalcloud-dev-admin
PERSONALCLOUD_INTERNAL_API_TOKEN=personalcloud-dev-internal-token
```

Start FastAPI in one PowerShell:

```powershell
cd D:\PersonalCloud\services\storage
uv sync
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
```

Start Next.js in another PowerShell:

```powershell
cd D:\PersonalCloud\apps\web
npm install
npm run dev
```

If Next.js shows a Webpack/RSC runtime error such as `__webpack_modules__[moduleId] is not a function`, clear the generated dev cache and restart:

```powershell
cd D:\PersonalCloud\apps\web
npm run dev:clean
```

Open the app:

```text
http://127.0.0.1:3000
```

Login with:

```text
personalcloud-dev-admin
```

Do not login with `personalcloud-dev-internal-token`; that token is only for server-to-server calls.

Functional test checklist:

1. Login and confirm the page redirects to `/files`.
2. Create a folder named `docs`.
3. Upload a small `.txt` file into `docs`.
4. Click preview and confirm the text appears in the preview panel.
5. Download the file and confirm the contents match.
6. Rename the file.
7. Upload an unsupported file such as `.bin` and confirm preview shows a graceful unsupported message.
8. Move a file or folder to trash and confirm it disappears from the listing.

Direct login API sanity check:

```powershell
@'
const response = await fetch("http://127.0.0.1:3000/api/session/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: "personalcloud-dev-admin" })
});
console.log(response.status, await response.text(), response.headers.get("set-cookie"));
'@ | node
```

Expected result: status `200`, body `{"ok":true}`, and a `personalcloud_session` cookie.

## Verification

FastAPI:

```powershell
cd D:\PersonalCloud\services\storage
uv run pytest
uv run ruff check .
```

Next.js:

```powershell
cd D:\PersonalCloud\apps\web
npm run typecheck
npm run lint
npm run build
```

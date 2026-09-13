# Design: User Feedback And Log Upload

## End-to-End Flow

1. The user opens Settings > General, enters feedback, and checks the optional attach-logs control.
2. Renderer calls `submitFeedback({ message, includeLogs })` through the existing bridge.
3. Main-process IPC validates the plain JSON payload, collects only controlled `app-*.log` files when opted in, applies the existing logger redaction a second time, writes a temporary zip in the OS temp directory, and calls Ops Center with multipart form data.
4. Ops Center authenticates ingest with `X-Catalog-Key`, validates fields and file limits, stores a random basename under `OPS_FEEDBACK_MEDIA_DIR`, persists metadata, and returns the feedback id.
5. Admin-only APIs return bounded list rows, full detail, and a safe attachment download.

## Contract

- `POST /api/v1/feedback` multipart fields: `message` (required), `client_id` (optional hashed id), `app_version` (optional), `platform` (optional), `log_archive` (optional zip).
- `GET /api/v1/feedback?limit=&offset=` admin only: `{ items, total }`; list items contain id, truncated message, platform, app_version, has_logs, created_at.
- `GET /api/v1/feedback/{id}` admin only: full metadata and message, attachment metadata without absolute paths.
- `GET /api/v1/feedback/{id}/attachment` admin only: download response with attachment disposition.
- Ingest authentication: existing catalog key. Admin APIs: existing JWT `require_admin`.

## Data And Retention

- `user_feedback`: UUID id, bounded message, optional hashed client id, app/platform metadata, status default `new`, timestamps.
- `feedback_attachments`: feedback id, random stored basename, original extension only, size, SHA-256, timestamp, expiry.
- Default metadata retention 90 days and attachment retention 30 days; cleanup is explicit and must never traverse outside the configured storage root.

## Security

- No archive extraction. Reject non-regular files, symlinks, path traversal, multiple files, unsupported archive type, and size over limits.
- Stored filenames are generated UUID basenames. Download resolves the DB-authorized basename and requires the resolved file to be a direct child of the configured root.
- Desktop requests inherit existing HTTPS/loopback, timeout, response-limit, and redirect rejection constraints.
- No feedback body, attachment path, API key, bearer token, cookie, or archive original name is written to operational logs.

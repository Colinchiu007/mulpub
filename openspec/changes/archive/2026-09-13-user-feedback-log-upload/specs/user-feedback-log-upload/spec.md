# User Feedback And Log Upload Specification

## ADDED Requirements

### Requirement: Desktop feedback submission
The desktop Settings > General page SHALL allow a user to submit a non-empty bounded feedback message and explicitly choose whether sanitized application logs are attached.

#### Scenario: Submit feedback without logs
- **WHEN** the user enters valid feedback and leaves attach logs disabled
- **THEN** the desktop submits the message without reading or sending local log files and shows a success state after the server accepts it

#### Scenario: Reject blank feedback
- **WHEN** the user submits an empty or whitespace-only message
- **THEN** the renderer does not invoke the upload IPC and shows the localized validation message

### Requirement: Controlled log upload
The desktop main process SHALL collect only regular `app-*.log` files from its internal logger directory, redact sensitive values again, and enforce bounded archive/file sizes before upload.

#### Scenario: Opt-in log collection
- **WHEN** the user enables attach logs
- **THEN** the main process creates a temporary archive containing only accepted log files and uploads it without exposing the log directory or API key to renderer code

#### Scenario: Unsafe log file rejected
- **WHEN** a candidate log is a symlink, directory, non-matching file, or exceeds the configured limit
- **THEN** it is excluded or the submission fails closed according to the size contract, and no unsafe path is uploaded

### Requirement: Feedback ingest
The Ops Center SHALL accept feedback only through the configured catalog key, validate multipart fields and archive limits, and persist metadata and attachment metadata with random storage basenames.

#### Scenario: Valid ingest
- **WHEN** a request has a valid catalog key and valid message with an optional valid zip archive
- **THEN** Ops Center persists the feedback and returns its id without exposing a filesystem path

#### Scenario: Invalid ingest authentication
- **WHEN** the catalog key is missing, wrong, or not configured
- **THEN** Ops Center rejects the request with the existing fail-closed authentication behavior and does not create a record or file

### Requirement: Admin feedback inspection
The Ops Center SHALL restrict feedback listing, detail, and attachment download to administrators.

#### Scenario: Admin lists and inspects feedback
- **WHEN** an administrator requests the list and opens one row
- **THEN** the list returns bounded preview fields, detail returns the full message and safe attachment metadata, and download returns the authorized file as an attachment

#### Scenario: Non-admin denied
- **WHEN** an unauthenticated or non-admin user requests feedback list, detail, or download
- **THEN** the request is rejected without revealing whether a record or attachment exists

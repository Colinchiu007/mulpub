# Proposal: User Feedback And Log Upload

## Why

Users currently have no direct way to report a problem from the desktop application, and operators cannot inspect the context needed to triage issues. The existing application logger and Ops Center catalog-key transport provide a controlled foundation for a bounded, opt-in feedback channel.

## What Changes

- Add feedback text and explicit log attachment opt-in to desktop Settings > General.
- Collect only application log files from the main process, redact them, create a bounded zip archive, and submit it with feedback metadata.
- Add an Ops Center feedback resource with admin list/detail/download APIs and a Vue page/menu entry.

## Impact

This adds a persistent SQLite resource and a private attachment directory to Ops Center, plus a new cross-process desktop IPC contract. Existing catalog-key configuration is reused; no renderer access token or new identity API is introduced.

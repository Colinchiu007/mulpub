# App-Live White Screen: Root Cause and Auto-Heal Runbook

> English companion to `docs/app-live-sync-workflow.md`.
> Covers the 2026-10 blank-UI incident and the probe / auto-heal hardening added by
> branch `applive-hardening` (scopes 1 and 2 of the second durable PR).
> Launcher script content stays pure ASCII; this runbook is English by design.

## 1. Symptom

- The Electron window opens, but the renderer shows a blank / white screen.
- `GET http://localhost:<vitePort>/` does not return a usable HTML document
  (connection refused, hang, or an empty / non-HTML body).
- The backend (`MP_BACKEND_PORT`) may still be listening; the failure is on the
  frontend serving path, not the API.

## 2. Root Cause (the 2026-10 incident)

- The Vite dev server that backs the Electron renderer was **killed or left
  zombied by an external actor** (process gone or hung, socket not serving).
- This was **not** an application code fault. The fix in production was simply to
  relaunch Vite — no code change was required for that incident.
- Without a liveness probe, a dead Vite is only discovered *after* the white
  screen appears, which is a poor operator experience and wastes a restart cycle.

## 3. Why a code change is still warranted

- The launcher (`scripts/mp-applive-launcher.ps1`) had no probe, so it could not
  tell the difference between "window not visible yet" and "Vite is dead".
- This branch adds a mechanical probe (scope 1) and an optional, env-gated
  auto-heal (scope 2) so the launcher can self-detect and self-recover instead of
  handing the operator a white screen.

## 4. New Behavior

### Scope 1 — Vite Liveness Probe

- `Test-ViteServing` issues `GET http://localhost:<per-worktree vitePort>/`.
- The body is matched for one of: `<!DOCTYPE html>`, `<html`, or `vite`.
- Emits `VITE_SERVING` when matched, `VITE_NOT_SERVING` otherwise.
- Ports are resolved per-worktree via `dev-ports.js resolveDevPorts($Worktree)`
  (issue #2459 port-isolation is preserved; the probe targets *our* port, not a
  hardcoded one).

### Scope 2 — Optional Auto-Heal (env-gated, default OFF)

- `MP_APPLIVE_AUTOHEAL` — enable auto-heal. Default `OFF` (opt-in) so the
  launcher never silently restarts a live instance.
- `MP_APPLIVE_AUTOHEAL_MAX` — max restart attempts. Default `3`; an invalid or
  non-positive value falls back to `3`.
- `Invoke-AppliveAutoHeal` runs only when enabled. On `VITE_NOT_SERVING` it
  re-invokes `Start-AppliveInstance`, waits for the window
  (`Wait-AppliveWindow`), waits for the backend (`Wait-AppliveBackend`), then
  re-probes (`Test-ViteServing`), looping up to `Max` attempts.
- Status tokens:
  - `AUTOHEAL_DISABLED` — env not enabled.
  - `AUTOHEAL_ENABLED` — env enabled; entering the loop.
  - `AUTOHEAL_RESTART attempt=n/Max` — a restart was attempted.
  - `AUTOHEAL_EXHAUSTED` — attempts exhausted without `VITE_SERVING`.
- The auto-heal path and the probe are fully injectable for tests; under
  `-Test` no real process is launched and no `Start-Sleep` is performed.

## 5. Operational Runbook

**Detect**
- Window open but renderer blank.
- Launcher log contains `VITE_NOT_SERVING` (probe failed).

**Manual recover (same as the live 2026-10 fix)**
- Relaunch the app via `scripts/sync-app.ps1` or `scripts/mp-applive-launcher.ps1`.
- A clean Vite restart restores the document and the white screen clears.

**Enable auto-heal (opt-in)**
- Before launching, set the environment variable
  `MP_APPLIVE_AUTOHEAL=1` (and optionally `MP_APPLIVE_AUTOHEAL_MAX=<n>`).
- Default remains `OFF` so existing launch flows are unchanged.

**Tune**
- Raise/lower `MP_APPLIVE_AUTOHEAL_MAX` only if restart cadence needs adjusting;
  out-of-range values are clamped to `3`.

## 6. Verification

- `scripts/mp-applive-launcher.test.ps1` covers the probe and auto-heal counting:
  - `Test-ViteServing` — HTML body detected, non-200 / non-HTML body rejected,
    exception path safe.
  - `Get-AppliveAutoHealConfig` — default off / max 3, env override, invalid max
    fallback.
  - `Invoke-AppliveAutoHeal` — disabled = 0 restarts, enabled max=3 = 3 restarts,
    enabled max=2 = 2 restarts.
- The test is wired into CI `quality-gate.yml` Gate 2d (plain `pwsh -File` line
  under `set -e`, so a failure aborts the step).

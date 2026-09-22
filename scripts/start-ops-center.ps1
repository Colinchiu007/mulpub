# start-ops-center.ps1
# Launch / refresh the ops-center FastAPI backend (default port 8010) as a
# "regular deployment": code runs from a persistent git worktree kept on
# origin/main, while runtime data (.env + config.db) lives in a decoupled
# anchor directory, kept OFF the shared coordination root.
#
# This mirrors the start-app skill pattern:
#   - CODE  : persistent worktree ($LiveWt), advanced by a SAFE fast-forward only.
#   - DATA  : anchor dir ($Anchor) holding .env + config.db (survives worktree
#             cleanup, never committed). The backend is pointed at it via
#             OPS_DB_PATH / OPS_CONFIG_OUTPUT_DIR / OPS_FEEDBACK_MEDIA_DIR.
#
# The worktree's ops-center/backend/.env is a throwaway copy staged from the
# anchor .env each run (it is gitignored). Edit the ANCHOR .env, never the copy.
#
# NOTE: Run from a NORMAL terminal. The agent sandbox must not do whole-tree
# git writes; this script only does a safe --ff-only (ahead=0) and refuses if
# the worktree has diverged.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\start-ops-center.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\start-ops-center.ps1 -PrepareOnly
param(
  [string]$RepoRoot = 'D:\Data\projects\Multi-Publish',
  [string]$LiveWt   = 'D:\Data\projects\mp-worktrees\mp-app-live2',
  [string]$Anchor   = 'D:\Data\projects\mp-ops-data',
  [string]$Python   = (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
  [int]$Port        = 8010,
  [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$be = Join-Path $LiveWt 'ops-center\backend'

Write-Host '[1/6] advance persistent worktree to origin/main (safe --ff-only)'
git -C $LiveWt fetch origin | Out-Null
$lr = (git -C $LiveWt rev-list --left-right --count HEAD...origin/main) -split "`t"
$ahead = [int]$lr[0]; $behind = [int]$lr[1]
if ($ahead -gt 0) {
  Write-Warning "worktree diverged (ahead=$ahead). --ff-only skipped to avoid clobbering local commits. Merge origin/main in a normal terminal, then re-run."
} else {
  git -C $LiveWt merge --ff-only origin/main | Out-Null
}
Write-Host ('    HEAD=' + (git -C $LiveWt rev-parse --short HEAD) + '  origin/main=' + (git -C $LiveWt rev-parse --short origin/main))
if (-not (Test-Path (Join-Path $be 'services\logto_verifier.py'))) {
  throw 'new code (services/logto_verifier.py) not present in worktree -- HEAD not advanced to the merge; abort to avoid serving stale code.'
}

Write-Host '[2/6] ensure anchor data exists'
if (-not (Test-Path (Join-Path $Anchor '.env')))     { throw "anchor .env missing: $Anchor\.env" }
if (-not (Test-Path (Join-Path $Anchor 'config.db'))) { throw "anchor config.db missing: $Anchor\config.db" }

Write-Host '[3/6] stage worktree .env from anchor (gitignored throwaway)'
Copy-Item (Join-Path $Anchor '.env') (Join-Path $be '.env') -Force

if ($PrepareOnly) { Write-Host 'PrepareOnly: code+data staged, not launching (port untouched).'; exit 0 }

Write-Host "[4/6] stop existing listener on port $Port"
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Write-Host '[5/6] launch uvicorn (detached, worktree code, anchor data)'
if (-not (Test-Path $Python)) { throw "python not found: $Python" }
Start-Process -FilePath $Python `
  -ArgumentList @('-m','uvicorn','main:app','--host','127.0.0.1','--port',"$Port") `
  -WorkingDirectory $be -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $be '.run.log') `
  -RedirectStandardError  (Join-Path $be '.run.err.log')

Write-Host '[6/6] verify health'
$ok = $false
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$Port/health" -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
}
if ($ok) {
  Write-Host 'OPS_CENTER_LIVE_OK'
} else {
  Write-Warning "health check failed; inspect $be\.run.err.log"
  exit 1
}

# mp-anchor-health.ps1 - Persistence-anchor health lint for the Multi-Publish app.
#
# The gitignored anchor dir <repo>\shared-user-data carries the login state and data
# that must survive every worktree/branch cleanup:
#   multi-publish.db            model keys / settings   (FAIL when missing)
#   backend-data\accounts.json  social-media logins     (FAIL when missing)
#   identity-session.json       Logto session           (WARN - absent before 1st login)
#   session\ / credentials\     runtime auth stores      (WARN when missing)
#   <anchor>.backups\           hot snapshots            (WARN when stale > 7 days)
#
# Exit codes: 0 = ANCHOR_OK / ANCHOR_WARN (lint findings printed)
#             1 = ANCHOR_FAIL (anchor dir or a critical file missing/broken)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/mp-anchor-health.ps1
#   ... -RepoRoot D:\Data\projects\Multi-Publish
# Pure ASCII.
[CmdletBinding()]
param(
  [string]$RepoRoot = 'D:\Data\projects\Multi-Publish',
  [int]$BackupStaleDays = 7
)
$ErrorActionPreference = 'Continue'
$fail = $false
$warn = $false

function Say($lvl, $msg) { Write-Host ("[{0}] {1}" -f $lvl, $msg) }

$anchor = Join-Path $RepoRoot 'shared-user-data'
if (-not (Test-Path -LiteralPath $anchor)) {
  Say 'FAIL' "anchor directory missing: $anchor"
  Write-Host 'ANCHOR_FAIL'
  exit 1
}
Say 'OK' "anchor directory present: $anchor"

# --- critical files -----------------------------------------------------------
$db = Join-Path $anchor 'multi-publish.db'
if (Test-Path -LiteralPath $db) {
  $size = (Get-Item -LiteralPath $db).Length
  if ($size -gt 0) { Say 'OK' ("multi-publish.db present ({0} KB)" -f [math]::Round($size/1KB)) }
  else { Say 'FAIL' 'multi-publish.db is empty (0 bytes)'; $fail = $true }
} else { Say 'FAIL' 'multi-publish.db missing (model keys/settings lost)'; $fail = $true }

$accounts = Join-Path $anchor 'backend-data\accounts.json'
if (Test-Path -LiteralPath $accounts) {
  try {
    $null = Get-Content -LiteralPath $accounts -Raw -Encoding UTF8 | ConvertFrom-Json
    Say 'OK' 'backend-data\accounts.json present and valid JSON'
  } catch {
    Say 'FAIL' "backend-data\accounts.json is NOT valid JSON: $($_.Exception.Message)"; $fail = $true
  }
} else { Say 'FAIL' 'backend-data\accounts.json missing (platform logins lost)'; $fail = $true }

# --- warn-level files ---------------------------------------------------------
$identity = Join-Path $anchor 'identity-session.json'
if (Test-Path -LiteralPath $identity) {
  Say 'OK' 'identity-session.json present (Logto login state)'
} else {
  Say 'WARN' 'identity-session.json absent - sign in once inside the app to create it'
  $warn = $true
}
foreach ($d in @('session', 'credentials')) {
  $p = Join-Path $anchor $d
  if (-not (Test-Path -LiteralPath $p)) { Say 'WARN' "subdir missing: $d"; $warn = $true }
}

# --- hot-backup freshness -----------------------------------------------------
$backupRoot = $anchor.TrimEnd('\', '/') + '.backups'
if (Test-Path -LiteralPath $backupRoot) {
  $latest = @(Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue |
              Sort-Object Name -Descending) | Select-Object -First 1
  if ($latest) {
    $ageDays = ((Get-Date) - $latest.LastWriteTime).TotalDays
    if ($ageDays -gt $BackupStaleDays) {
      Say 'WARN' ("newest backup is {0:N1} days old (limit {1})" -f $ageDays, $BackupStaleDays); $warn = $true
    } else {
      Say 'OK' ("backups fresh (latest: {0})" -f $latest.Name)
    }
  } else { Say 'WARN' 'backup root exists but is empty'; $warn = $true }
} else {
  Say 'WARN' "no hot backups yet ($backupRoot absent) - run sync-app.ps1 -Safe once"
  $warn = $true
}

if ($fail) { Write-Host 'ANCHOR_FAIL'; exit 1 }
if ($warn) { Write-Host 'ANCHOR_WARN'; exit 0 }
Write-Host 'ANCHOR_OK'
exit 0

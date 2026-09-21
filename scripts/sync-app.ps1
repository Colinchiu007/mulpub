# sync-app.ps1 - One-command sync + launch for the Multi-Publish desktop app.
#
# Goal: eliminate per-launch dependency reinstall and login-state hunting.
#   - Keeps a persistent run worktree (mp-app-live2) with preserved node_modules.
#   - Syncs the worktree to latest origin/main (fetch + detached checkout + clean).
#   - Reinstalls deps only when pnpm-lock.yaml SHA256 changes (lockfile hash gate).
#   - Launches the app with the shared userData anchor (shared-user-data), so model
#     settings and social-media login states persist across restarts.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/sync-app.ps1          # full sync + launch (run manually, outside the sandbox)
#   powershell -ExecutionPolicy Bypass -File scripts/sync-app.ps1 -PrepareOnly   # full sync only (manual pre-sync)
#   powershell -ExecutionPolicy Bypass -File scripts/sync-app.ps1 -Safe    # fetch + heal + deps only (safe for unattended automation)
#
# Pure ASCII. No Chinese. No BOM.
[CmdletBinding()]
param(
  [string]$Worktree = 'D:/Data/projects/mp-worktrees/mp-app-live2',
  [string]$Profile  = 'D:/Data/projects/Multi-Publish/shared-user-data',
  [switch]$PrepareOnly,
  [switch]$Safe
)
$ErrorActionPreference = 'Stop'
function Write-Info($m){ Write-Host $m }
function Norm-Path([string]$p) { return (($p -replace '/', '\').TrimEnd('\')) }

# self-locate node and prepend to PATH (managed node may not be on system PATH)
$nodeExe = $null
$cn = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($cn) { $nodeExe = $cn.Source }
if (-not $nodeExe) {
  $cand = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions\22.22.2\node.exe'
  if (Test-Path -LiteralPath $cand) { $nodeExe = $cand }
}
if ($nodeExe) { $env:Path = (Split-Path $nodeExe -Parent) + ';' + $env:Path }
else { Write-Info 'WARN: node not found on PATH; pnpm/node calls may fail' }

# 1. resolve main repo root: parent of the shared .git (works for worktree and main)
$repoRoot = 'D:/Data/projects/Multi-Publish'
try {
  $common = (git -C $Worktree rev-parse --git-common-dir 2>$null)
  if ($common) { $repoRoot = Split-Path (Resolve-Path $common).Path }
} catch {}
Write-Info ("repoRoot = " + $repoRoot)
Write-Info ("worktree = " + $Worktree)

# 2. worktree health: ensure it is a valid git worktree
$gitFile = Join-Path $Worktree '.git'
if (-not (Test-Path -LiteralPath $gitFile)) {
  Write-Info 'ERROR: worktree .git missing. Recreate it with:'
  Write-Info ("  git worktree add --detach `"$Worktree`" origin/main")
  Write-Info '  then move your preserved node_modules back into it.'
  exit 1
}

# 2b. anchor hot backup + health lint (runs even when the app is live, hence placed
#     BEFORE the live-app early-exit below). Snapshots the small persistence files of
#     shared-user-data into '<anchor>.backups\<yyyyMMdd-HHmmss>\' and keeps the newest
#     7 sets, so a stray 'git clean -xfd' or manual rm in another session can be rolled
#     back to at most one day of lost login-state churn.
$anchorDir = Norm-Path $Profile
$anchorFiles = @('multi-publish.db', (Join-Path 'backend-data' 'accounts.json'), 'identity-session.json')
try {
  $present = @($anchorFiles | Where-Object { Test-Path -LiteralPath (Join-Path $anchorDir $_) })
  if ($present.Count -gt 0) {
    $backupRoot = $anchorDir + '.backups'
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dest = Join-Path $backupRoot $stamp
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    foreach ($f in $present) {
      try {
        $fd = Join-Path $dest $f
        $fp = Split-Path $fd -Parent
        if (-not (Test-Path -LiteralPath $fp)) { New-Item -ItemType Directory -Path $fp -Force | Out-Null }
        Copy-Item -LiteralPath (Join-Path $anchorDir $f) -Destination $fd -Force -ErrorAction Stop
      } catch {
        Write-Info ("WARN: anchor snapshot skipped {0} ({1})" -f $f, $_.Exception.Message)
      }
    }
    # prune: only delete timestamp-named dirs we created, newest 7 kept
    $stale = @(Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue |
               Where-Object { $_.Name -match '^\d{8}-\d{6}$' } |
               Sort-Object Name -Descending | Select-Object -Skip 7)
    foreach ($s in $stale) { Remove-Item -LiteralPath $s.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Info ("anchor snapshot -> $dest ($($present.Count) file(s)); pruned $($stale.Count) old set(s)")
  } else {
    Write-Info 'WARN: no anchor files found to snapshot (first run before any login?)'
  }
} catch {
  Write-Info ("WARN: anchor snapshot failed: $($_.Exception.Message)")
}
$anchorLint = Join-Path $PSScriptRoot 'mp-anchor-health.ps1'
if (Test-Path -LiteralPath $anchorLint) {
  & powershell -ExecutionPolicy Bypass -File $anchorLint -RepoRoot $repoRoot
  Write-Info ("anchor health lint exit=$LASTEXITCODE")
}

# 3. is a live app involved? (avoid rewriting code underneath a running window)
#    Two signals, both must be checked (2026-09-20 stale-renderer incident):
#      a) an Electron whose binary lives under this worktree;
#      b) any Electron MAIN holding the shared userData profile from ELSEWHERE
#         (another worktree/dir). Such a stale main keeps the single-instance
#         lock, so checkout updates the disk while the user keeps staring at the
#         pre-upgrade renderer.
#    Separator-hard: process paths always use backslashes while $Worktree may
#    arrive with forward slashes; a mismatched -like silently sees nothing.
#    Full mode still proceeds (the launcher audit-stops foreign holders before
#    relaunch); -Safe/-PrepareOnly skip the sync to protect the live session.
$wtBwd = $Worktree.Replace('/', '\')
$wtFwd = $Worktree.Replace('\', '/')
$electronProcs = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue)
$runningSame = @($electronProcs | Where-Object {
  $_.ExecutablePath -and (($_.ExecutablePath -like ($wtBwd + '*')) -or ($_.ExecutablePath -like ($wtFwd + '*')))
})
$runningForeign = @()
$auditModule = Join-Path $PSScriptRoot 'applive-foreign-audit.ps1'
if (Test-Path -LiteralPath $auditModule) {
  . $auditModule
  $profileOwnerSplit = Split-ForeignProfileOwners -Owners @(Get-ElectronProfileOwners -ProfilePath $Profile) -WorktreePath $Worktree
  $runningForeign = @($profileOwnerSplit.Foreign | Where-Object { $_.IsMain })
}
$running = @($runningSame) + @($runningForeign)
if ($running -and ($PrepareOnly -or $Safe)) {
  Write-Info ('WARN: app is currently running (sameWorktree=' + $runningSame.Count + ' foreignProfileHolders=' + $runningForeign.Count + '); skipping git sync to avoid disruption.')
  Write-Info 'SYNC skipped (live app detected)'
  exit 0
}

# 4. sync to latest origin/main
#    Default / -PrepareOnly: full tree rewrite (checkout -f origin/main + clean). This is
#    reliable in a normal terminal but may be killed by the agent sandbox, so it must NOT
#    run from the unattended automation. For the automation use -Safe.
#    -Safe: fetch only, then heal a torn worktree (git checkout HEAD -- .) without rewriting
#    the tree, so it can never leave the worktree in a torn state.
git -C $Worktree fetch origin main
if ($Safe) {
  $dirty = (git -C $Worktree status --porcelain)
  if ($dirty) {
    Write-Info 'worktree dirty/torn; healing to HEAD (Safe mode)'
    git -C $Worktree checkout HEAD -- .
  } else {
    Write-Info 'worktree clean; Safe mode skips tree rewrite (run manual sync to update code)'
  }
} else {
  git -C $Worktree checkout -f origin/main
  git -C $Worktree clean -fd
  Write-Info 'synced worktree to origin/main'
}

# 5. conditional pnpm install (lockfile hash gate)
$lockPath = Join-Path $repoRoot 'pnpm-lock.yaml'
$leaf = (Split-Path $Worktree -Leaf)
$lockHashFile = Join-Path $env:TEMP ("mp-applive-lockhash-" + $leaf)
$newHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $lockPath).Hash
$needInstall = $false
if (-not (Test-Path -LiteralPath (Join-Path $Worktree 'node_modules'))) {
  $needInstall = $true
} elseif (-not (Test-Path -LiteralPath $lockHashFile)) {
  $needInstall = $true
} else {
  $old = (Get-Content -LiteralPath $lockHashFile -Raw).Trim()
  if ($old -ne $newHash) { $needInstall = $true }
}
if ($needInstall) {
  Write-Info 'pnpm-lock.yaml changed or node_modules missing -> installing'
  Push-Location $Worktree
  & pnpm install --frozen-lockfile
  Pop-Location
  Set-Content -Path $lockHashFile -Value $newHash -Encoding ASCII
  Write-Info 'pnpm install done; lockhash updated'
} else {
  Write-Info 'pnpm deps up to date (lockhash match)'
}

# 6. ensure electron binary present
Push-Location $Worktree
& node scripts/ensure-electron.js
Pop-Location
Write-Info 'ensure-electron done'

if ($PrepareOnly) {
  Write-Info 'PREPARE_ONLY done'
  exit 0
}

# 7. launch via detached launcher (non-blocking; node escapes the agent job via WMI)
$launcher = Join-Path $repoRoot 'scripts/mp-applive-launcher.ps1'
Start-Process powershell.exe -ArgumentList ("-ExecutionPolicy Bypass -File `"$launcher`" -Worktree `"$Worktree`" -Profile `"$Profile`"") -WindowStyle Normal
Write-Info 'launcher started (detached); app will appear shortly'

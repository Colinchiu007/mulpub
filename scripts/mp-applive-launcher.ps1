# mp-applive-launcher.ps1 - Detached launcher for Multi-Publish desktop.
# Launches the app via WMI Win32_Process.Create so it survives the parent
# PowerShell session / agent job exit. Pure ASCII. No Chinese. No BOM.
[CmdletBinding()]
param(
  [string]$Worktree = 'D:/Data/projects/mp-worktrees/mp-app-live2',
  [string]$Profile  = 'D:/Data/projects/Multi-Publish/shared-user-data'
)
$ErrorActionPreference = 'Stop'
function Write-Info($m){ Write-Host $m }

# node self-locate
$nodeExe = $null
$c = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) { $nodeExe = $c.Source }
if (-not $nodeExe) {
  $cand = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions\22.22.2\node.exe'
  if (Test-Path -LiteralPath $cand) { $nodeExe = $cand }
}
if (-not $nodeExe) { Write-Info 'ERROR: node not found'; exit 1 }
$nodeDir = Split-Path $nodeExe -Parent
Write-Info ("node = " + $nodeExe)

# python self-locate (system 3.12)
$pyExe = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
if (Test-Path -LiteralPath $pyExe) {
  Write-Info ("python = " + $pyExe)
} else {
  Write-Info 'python 3.12 not found at LOCALAPPDATA; relying on PATH python'
  $pyExe = 'python'
}

# repo root via git common-dir (parent of shared .git)
$repoRoot = 'D:/Data/projects/Multi-Publish'
try {
  $common = (git -C $Worktree rev-parse --git-common-dir 2>$null)
  if ($common) { $repoRoot = Split-Path (Resolve-Path $common).Path }
} catch {}

# derive ports by worktree path
$portScript = Join-Path $repoRoot 'apps/desktop/scripts/dev-ports.js'
$portErr = $null
$portsJson = & $nodeExe -e 'const { resolveDevPorts } = require(process.argv[1]); process.stdout.write(JSON.stringify(resolveDevPorts(process.argv[2])))' $portScript $Worktree 2>$portErr
$ports = $portsJson | ConvertFrom-Json
$vitePort = [int]$ports.vite
$cdpPort = [int]$ports.cdp
Write-Info ("ports vite=" + $vitePort + " cdp=" + $cdpPort)

# stop existing electron from this worktree (single-instance)
# Normalize separators: process Path uses backslashes while callers may pass
# forward slashes; a mismatched -like silently skips the old instance and the
# new launch is then dropped by the single-instance lock.
$wtNorm = $Worktree.Replace('/', '\')
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -like ($wtNorm + '*')) } | ForEach-Object { Stop-Process -Id $_.Id -Force; Write-Info ("stop old electron pid=" + $_.Id) }
# also stop stale dev.js/vite node processes bound to this worktree, otherwise
# they keep the derived vite/cdp ports and race the new instance
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like ('*' + $Worktree + '*') -or $_.CommandLine -like ('*' + $wtNorm + '*') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Info ('stop old node pid=' + $_.ProcessId) }

# ---- foreign profile-holder audit (start-app fastpath hardening, 2026-09-20) ----
# The same-worktree stop above cannot see an OLDER Electron launched from any
# other directory/worktree while sharing this userData profile. That stale main
# keeps the Chromium single-instance lock: the new instance quits silently and
# its second-instance handler only re-focuses the OLD window, so the user keeps
# looking at a pre-upgrade renderer even though the worktree code is current.
# Mirror start-desktop.ps1 -StopForeignProfile semantics into the fastpath:
# audit-stop every foreign main holding this profile before launching.
$auditModule = Join-Path $PSScriptRoot 'applive-foreign-audit.ps1'
$auditAvailable = (Test-Path -LiteralPath $auditModule)
if ($auditAvailable) {
  . $auditModule
  $profileOwners = @(Get-ElectronProfileOwners -ProfilePath $Profile)
  $ownerSplit = Split-ForeignProfileOwners -Owners $profileOwners -WorktreePath $Worktree
  foreach ($f in $profileOwners) {
    Write-Info ('PROFILE_OWNER pid=' + $f.Pid + ' main=' + $f.IsMain + ' sameWorktree=' + ($ownerSplit.Same -contains $f) + ' exe=' + $f.ExePath)
  }
  foreach ($f in $ownerSplit.ForeignMain) {
    Stop-Process -Id $f.Pid -Force -ErrorAction SilentlyContinue
    Write-Info ('stop foreign-profile electron pid=' + $f.Pid + ' exe=' + $f.ExePath)
  }
} else {
  Write-Info 'WARN: applive-foreign-audit.ps1 missing; foreign profile holders will NOT be audited'
}
Start-Sleep -Seconds 2

# build detached launch command line (env-set via cmd /c)
# NOTE: cmd `set VAR=val & ...` folds the trailing space into the value
# (shared-user-data ' ' broke python-backend mkdir). Always use the quoted
# form `set "VAR=val"` so values never carry trailing whitespace.
$desktopDir = Join-Path $Worktree 'apps/desktop'
$Profile = $Profile.Trim()
$inner = 'set "PATH=' + $nodeDir + ';%PATH%" & set "MP_VITE_PORT=' + $vitePort + '" & set "MP_CDP_PORT=' + $cdpPort + '" & set "ELECTRON_USER_DATA_DIR=' + $Profile + '" & set "MP_PYTHON=' + $pyExe + '" & set "MP_CDP_ALLOW_ALL_ORIGINS=1" & cd /d "' + $desktopDir + '" & node scripts/dev.js'
$cmdLine = "cmd.exe /c $inner"
Write-Info ("launch cmd: " + $cmdLine)

# WMI/Win32_Process.Create breaks the agent job association -> true detach.
# Use Invoke-CimMethod (avoids the deserialized-object quirk of Get-WmiObject).
# Fallback to Start-Process when WMI is unavailable (e.g. normal interactive terminal).
$launched = $false
try {
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine }
  if ($result.ReturnValue -eq 0) {
    Write-Info ("CHILD_PID=" + $result.ProcessId)
    $launched = $true
  } else {
    Write-Info ("WARN: WMI launch rc=" + $result.ReturnValue + "; falling back to Start-Process")
  }
} catch {
  Write-Info ("WARN: WMI unavailable (" + $_.Exception.Message + "); falling back to Start-Process")
}
if (-not $launched) {
  Start-Process cmd.exe -ArgumentList ('/c ' + $cmdLine) -WindowStyle Normal
  Write-Info 'CHILD launched via Start-Process'
}

# poll for visible electron window
$deadline = (Get-Date).AddSeconds(150)
$win = $null
while ((Get-Date) -lt $deadline) {
  $win = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($wtNorm + '*') -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($win) { break }
  Start-Sleep -Seconds 3
}
if ($win) {
  Write-Info ("WINDOW pid=" + $win.Id + " handle=" + $win.MainWindowHandle + " title=" + $win.MainWindowTitle)
} else {
  Write-Info 'WARN: no visible window within 150s; app may still be starting'
  # Misleading-window guard: when the launcher reports failure but the operator
  # still SEES a window, that window almost certainly belongs to a stale
  # Electron main holding the profile single-instance lock (pre-upgrade
  # renderer), NOT to this launch. Name the candidates instead of leaving the
  # user to assume the old window is the new app.
  if ($auditAvailable) {
    $holderLines = @(Get-ElectronLockHolderCandidates)
    if ($holderLines.Count -gt 0) {
      Write-Info 'LOCK_HOLDER_CANDIDATES (live Electron mains; a visible old window belongs to one of these, not this launch):'
      foreach ($l in $holderLines) { Write-Info ('  ' + $l) }
    } else {
      Write-Info 'LOCK_HOLDER_CANDIDATES: none (no Electron main process alive)'
    }
  }
}

# verify main backend (python, port 8299) actually came up: a visible window
# alone does NOT prove services are healthy (see 2026-09-20 trailing-space bug)
$backendOk = $false
$beDeadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $beDeadline) {
  $listen = Get-NetTCPConnection -LocalPort 8299 -State Listen -ErrorAction SilentlyContinue
  if ($listen) { $backendOk = $true; break }
  Start-Sleep -Seconds 3
}
if ($backendOk) {
  Write-Info 'MAIN_BACKEND_LISTENING port=8299'
  Write-Info 'START_CONTRACT_OK'
} else {
  Write-Info 'WARN: MAIN_BACKEND_NOT_LISTENING port=8299 within 60s; check shared-user-data/logs/app-*.log for PythonBridge errors'
  Write-Info 'WARN: if a window from a PREVIOUS launch is still visible, it is a stale instance; this launch did not take over (see LOCK_HOLDER_CANDIDATES)'
}

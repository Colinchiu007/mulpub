# mp-applive-launcher.ps1 - Detached launcher for Multi-Publish desktop.
# Launches the app via WMI Win32_Process.Create so it survives the parent
# PowerShell session / agent job exit. Pure ASCII. No Chinese. No BOM.
[CmdletBinding()]
param(
  [string]$Worktree = 'D:/Data/projects/mp-worktrees/mp-app-live2',
  [string]$Profile  = 'D:/Data/projects/mulpub/shared-user-data',
  [switch]$Test
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
if (-not $nodeExe) {
  if ($Test) { Write-Info 'WARN: node not found under -Test; using bare node'; $nodeExe = 'node' }
  else { Write-Info 'ERROR: node not found'; exit 1 }
}
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
$repoRoot = 'D:/Data/projects/mulpub'
try {
  $common = (git -C $Worktree rev-parse --git-common-dir 2>$null)
  if ($common) { $repoRoot = Split-Path (Resolve-Path $common).Path }
} catch {}

# derive ports by worktree path
$portScript = Join-Path $repoRoot 'apps/desktop/scripts/dev-ports.js'
$portsJson = & $nodeExe -e 'const { resolveDevPorts } = require(process.argv[1]); process.stdout.write(JSON.stringify(resolveDevPorts(process.argv[2])))' $portScript $Worktree 2>$null
$ports = $null
try { $ports = $portsJson | ConvertFrom-Json } catch { $ports = $null }
if (-not $ports) {
  if ($Test) {
    # Under -Test we only need the functions defined for unit testing; do not
    # abort. Use placeholder ports so callers can run without a real worktree.
    Write-Info 'WARN: dev-ports resolve failed under -Test; using placeholder ports'
    $vitePort = 5199; $cdpPort = 9222; $backendPort = 8299
  } else {
    Write-Info ("ERROR: failed to resolve dev ports: " + $portErr); exit 1
  }
} else {
  $vitePort = [int]$ports.vite
  $cdpPort = [int]$ports.cdp
  # #2459: backend port is now derived per worktree (see dev-ports.js), so the probe
  # below must target OUR port. A hardcoded 8299 would either be answered by another
  # session's backend (false START_CONTRACT_OK) or by nobody (success reported as failure).
  $backendPort = [int]$ports.backend
}
Write-Info ("ports vite=" + $vitePort + " cdp=" + $cdpPort + " backend=" + $backendPort)

# Normalize separators: process Path uses backslashes while callers may pass
# forward slashes; a mismatched -like silently skips the old instance and the
# new launch is then dropped by the single-instance lock.
$wtNorm = $Worktree.Replace('/', '\')

# ---- helpers (defined at top so the script is dot-source-safe under -Test) ----

# Probe the Vite frontend dev server. The launcher already verifies the
# Electron window and the Python backend listener, but a zombied/killed Vite
# dev server still leaves a window + backend up while serving a white/blank
# screen. This probe closes that gap: GET / and require real HTML back.
# Inject -HttpGet in tests to avoid real network calls.
function Test-ViteServing {
  param(
    [int]$VitePort,
    [scriptblock]$HttpGet = $null
  )
  $ok = $false
  try {
    if ($HttpGet) {
      $resp = & $HttpGet ("http://127.0.0.1:" + $VitePort + "/")
    } else {
      $resp = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $VitePort + "/") -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    }
    if ($resp -and ([int]$resp.StatusCode) -eq 200) {
      $body = [string]$resp.Content
      if ($body -match '<!DOCTYPE html>' -or $body -match '<html' -or $body -match 'vite') {
        $ok = $true
      }
    }
  } catch {
    $ok = $false
  }
  if ($ok) { Write-Info ("VITE_SERVING port=" + $VitePort) } else { Write-Info ("VITE_NOT_SERVING port=" + $VitePort) }
  return $ok
}

# Auto-heal configuration, read from env (default OFF, retry cap 3).
function Get-AppliveAutoHealConfig {
  $raw = [string]$env:MP_APPLIVE_AUTOHEAL
  $enabled = ($raw -eq '1' -or $raw -eq 'true' -or $raw -eq 'on')
  $max = 3
  $m = [string]$env:MP_APPLIVE_AUTOHEAL_MAX
  if ($m -match '^\d+$' -and [int]$m -gt 0) { $max = [int]$m }
  return [PSCustomObject]@{ Enabled = $enabled; Max = $max }
}

# Auto-heal loop: if Vite is not serving and auto-heal is enabled, restart the
# instance up to Max times, re-probing each time. All steps are injectable so the
# loop can be unit-tested without launching real processes.
function Invoke-AppliveAutoHeal {
  param(
    [int]$VitePort,
    [string]$Worktree,
    [string]$WtNorm,
    [string]$Profile,
    [string]$RepoRoot,
    [string]$NodeDir,
    [string]$PyExe,
    [int]$CdpPort,
    [int]$BackendPort,
    [scriptblock]$StartInstance = $null,
    [scriptblock]$WaitWindow = $null,
    [scriptblock]$WaitBackend = $null,
    [scriptblock]$ProbeVite = $null
  )
  $ah = Get-AppliveAutoHealConfig
  if ($ah.Enabled) {
    Write-Info 'AUTOHEAL_ENABLED'
    $viteOk = if ($ProbeVite) { & $ProbeVite -VitePort $VitePort } else { Test-ViteServing -VitePort $VitePort }
    $attempt = 0
    while (-not $viteOk -and $attempt -lt $ah.Max) {
      $attempt++
      Write-Info ("AUTOHEAL_RESTART attempt=" + $attempt + "/" + $ah.Max)
      if ($StartInstance) {
        & $StartInstance -Worktree $Worktree -WtNorm $wtNorm -Profile $Profile -RepoRoot $RepoRoot -NodeDir $NodeDir -PyExe $PyExe -VitePort $VitePort -CdpPort $CdpPort -BackendPort $BackendPort
      } else {
        Start-AppliveInstance -Worktree $Worktree -WtNorm $wtNorm -Profile $Profile -RepoRoot $RepoRoot -NodeDir $NodeDir -PyExe $PyExe -VitePort $VitePort -CdpPort $CdpPort -BackendPort $BackendPort
      }
      $win = if ($WaitWindow) { & $WaitWindow -WtNorm $wtNorm -MaxAttempts 50 } else { Wait-AppliveWindow -WtNorm $wtNorm -MaxAttempts 50 }
      $backendOk = if ($WaitBackend) { & $WaitBackend -BackendPort $BackendPort -WorktreePath $Worktree -MaxAttempts 20 } else { Wait-AppliveBackend -BackendPort $BackendPort -WorktreePath $Worktree -MaxAttempts 20 }
      $viteOk = if ($ProbeVite) { & $ProbeVite -VitePort $VitePort } else { Test-ViteServing -VitePort $VitePort }
    }
    if (-not $viteOk) {
      Write-Info ("AUTOHEAL_EXHAUSTED attempts=" + $attempt + " max=" + $ah.Max)
    }
  } else {
    Write-Info 'AUTOHEAL_DISABLED'
  }
}

# Wait for a visible Electron window owned by this worktree.
# Inject -GetElectron in tests to avoid real process enumeration / sleeps.
function Wait-AppliveWindow {
  param(
    [string]$WtNorm,
    [int]$MaxAttempts = 50,
    [scriptblock]$GetElectron = $null
  )
  $win = $null
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    if ($GetElectron) { $procs = & $GetElectron } else { $procs = @(Get-Process electron -ErrorAction SilentlyContinue) }
    $win = $procs | Where-Object { $_.Path -and ($_.Path -like ($WtNorm + '*')) -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($win) { break }
    Start-Sleep -Seconds 3
  }
  return $win
}

# #2459: named, reusable listener-ownership resolver. A listener on the derived
# backend port is only "ours" if the process that owns the TCP listener has a
# command line naming THIS worktree. Another worktree may hold the same derived
# port (collision) or a stale process may hold it; in both cases we must not
# report START_CONTRACT_OK for someone else's backend. Extracted as a named
# function so the structural lock in dev-ports.test.js can assert the check is
# not inlined and silently dropped on refactor.
function Get-BackendListenerOwnership {
  param(
    [object]$Connection,
    [string]$WorktreePath,
    [scriptblock]$GetProc = $null
  )
  if (-not $Connection) { return $null }
  $procId = [int]$Connection.OwningProcess
  if ($GetProc) {
    $proc = & $GetProc -ProcessId $procId
  } else {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
  }
  if (-not $proc) { return $null }
  # ordinal Contains, not -like: [ ] * ? inside a path would be read as wildcards
  $cmd = [string]$proc.CommandLine
  $mine = $cmd.Contains($WorktreePath) -or $cmd.Contains($WorktreePath.Replace('/', '\'))
  return [PSCustomObject]@{ Pid = $procId; Name = [string]$proc.Name; Mine = [bool]$mine }
}

# Wait for the main backend (python) to listen AND be owned by this worktree.
# A listener alone is not enough (#2459): another worktree may hold the port.
# Inject -GetNetTcp / -GetProc in tests to avoid real TCP / WMI enumeration.
function Wait-AppliveBackend {
  param(
    [int]$BackendPort,
    [string]$WorktreePath,
    [int]$MaxAttempts = 20,
    [scriptblock]$GetNetTcp = $null,
    [scriptblock]$GetProc = $null
  )
  $ok = $false
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    if ($GetNetTcp) { $conns = & $GetNetTcp -Port $BackendPort } else { $conns = @(Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue) }
    $owner = $null
    foreach ($conn in $conns) {
      $owner = Get-BackendListenerOwnership -Connection $conn -WorktreePath $WorktreePath -GetProc $GetProc
      break
    }
    if ($owner -and $owner.Mine) { $ok = $true; break }
    if ($owner) { Write-Info ('BACKEND_PORT_HELD_BY_OTHER pid=' + $owner.Pid + ' exe=' + $owner.Name + ' port=' + $BackendPort) }
    Start-Sleep -Seconds 3
  }
  return $ok
}

# Stop any prior instance of this worktree and launch a fresh detached app.
# Destructive steps accept injected scriptblocks (-StopElectron/-StopNode/-Launch)
# so tests can verify orchestration without touching real processes.
function Start-AppliveInstance {
  param(
    [string]$Worktree,
    [string]$WtNorm,
    [string]$Profile,
    [string]$RepoRoot,
    [string]$NodeDir,
    [string]$PyExe,
    [int]$VitePort,
    [int]$CdpPort,
    [int]$BackendPort,
    [scriptblock]$StopElectron = $null,
    [scriptblock]$StopNode = $null,
    [scriptblock]$Launch = $null
  )
  # stop existing electron from this worktree (single-instance)
  if ($StopElectron) {
    & $StopElectron -WtNorm $WtNorm
  } else {
    Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -like ($WtNorm + '*')) } | ForEach-Object { Stop-Process -Id $_.Id -Force; Write-Info ("stop old electron pid=" + $_.Id) }
  }
  # also stop stale dev.js/vite node processes bound to this worktree, otherwise
  # they keep the derived vite/cdp ports and race the new instance
  if ($StopNode) {
    & $StopNode -Worktree $Worktree -WtNorm $WtNorm
  } else {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like ('*' + $Worktree + '*') -or $_.CommandLine -like ('*' + $wtNorm + '*') } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Info ('stop old node pid=' + $_.ProcessId) }
  }

  # foreign profile-holder audit (start-app fastpath hardening, 2026-09-20)
  # The same-worktree stop above cannot see an OLDER Electron launched from any
  # other directory/worktree while sharing this userData profile. That stale main
  # keeps the Chromium single-instance lock: the new instance quits silently and
  # its second-instance handler only re-focuses the OLD window, so the user keeps
  # looking at a pre-upgrade renderer even though the worktree code is current.
  # Mirror start-desktop.ps1 -StopForeignProfile semantics into the fastpath:
  # audit-stop every foreign main holding this profile before launching.
  # Under -Test the audit + sleep are skipped so the unit test never touches
  # real Electron processes or blocks. The orchestration (who gets stopped)
  # is still verified via injected -StopElectron/-StopNode scriptblocks.
  if (-not $Test) {
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
  } else {
    Write-Info 'TEST: skip foreign-profile audit + sleep'
  }

  # build detached launch command line (env-set via cmd /c)
  # NOTE: cmd `set VAR=val & ...` folds the trailing space into the value
  # (shared-user-data ' ' broke python-backend mkdir). Always use the quoted
  # form `set "VAR=val"` so values never carry trailing whitespace.
  $desktopDir = Join-Path $Worktree 'apps/desktop'
  $Profile = $Profile.Trim()
  $inner = 'set "PATH=' + $nodeDir + ';%PATH%" & set "MP_VITE_PORT=' + $vitePort + '" & set "MP_CDP_PORT=' + $cdpPort + '" & set "BACKEND_PORT=' + $backendPort + '" & set "ELECTRON_USER_DATA_DIR=' + $Profile + '" & set "MP_PYTHON=' + $pyExe + '" & set "MP_CDP_ALLOW_ALL_ORIGINS=1" & cd /d "' + $desktopDir + '" & node scripts/dev.js'
  $cmdLine = "cmd.exe /c $inner"
  Write-Info ("launch cmd: " + $cmdLine)

  if ($Launch) {
    & $Launch -CommandLine $cmdLine
    return
  }

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
}

# ---- main (skipped under -Test so the script is unit-testable by dot-sourcing) ----
if (-not $Test) {
  Start-AppliveInstance -Worktree $Worktree -WtNorm $wtNorm -Profile $Profile -RepoRoot $repoRoot -NodeDir $nodeDir -PyExe $pyExe -VitePort $vitePort -CdpPort $cdpPort -BackendPort $backendPort

  # poll for visible electron window
  $win = Wait-AppliveWindow -WtNorm $wtNorm -MaxAttempts 50
  if ($win) {
    Write-Info ("WINDOW pid=" + $win.Id + " handle=" + $win.MainWindowHandle + " title=" + $win.MainWindowTitle)
  } else {
    Write-Info 'WARN: no visible window within 150s; app may still be starting'
    # Misleading-window guard: when the launcher reports failure but the operator
    # still SEES a window, that window almost certainly belongs to a stale
    # Electron main holding the profile single-instance lock (pre-upgrade
    # renderer), NOT to this launch. Name the candidates instead of leaving the
    # user to assume the old window is the new app.
    if (Get-Command Get-ElectronLockHolderCandidates -ErrorAction SilentlyContinue) {
      $holderLines = @(Get-ElectronLockHolderCandidates)
      if ($holderLines.Count -gt 0) {
        Write-Info 'LOCK_HOLDER_CANDIDATES (live Electron mains; a visible old window belongs to one of these, not this launch):'
        foreach ($l in $holderLines) { Write-Info ('  ' + $l) }
      } else {
        Write-Info 'LOCK_HOLDER_CANDIDATES: none (no Electron main process alive)'
      }
    }
  }

  # verify main backend (python) actually came up: a visible window
  # alone does NOT prove services are healthy (see 2026-09-20 trailing-space bug)
  $backendOk = Wait-AppliveBackend -BackendPort $backendPort -WorktreePath $Worktree -MaxAttempts 20
  if ($backendOk) {
    Write-Info ("MAIN_BACKEND_LISTENING port=" + $backendPort + " (owned by this worktree)")
    Write-Info 'START_CONTRACT_OK'
  } else {
    Write-Info ('WARN: MAIN_BACKEND_NOT_LISTENING port=' + $backendPort + ' within 60s (ownership not proven); check shared-user-data/logs/app-*.log for PythonBridge errors')
    Write-Info 'WARN: if a window from a PREVIOUS launch is still visible, it is a stale instance; this launch did not take over (see LOCK_HOLDER_CANDIDATES)'
  }

  # ---- scope 1: Vite frontend dev-server liveness probe ----
  # The window + backend can both be healthy while Vite is dead (zombied or
  # externally killed dev server) -> the user gets a blank/white screen. Probe
  # the dev server and report it explicitly so the gap is no longer silent.
  $viteOk = Test-ViteServing -VitePort $vitePort

  # ---- scope 2: auto-heal restart on probe failure (env-gated, default OFF) ----
  # Delegates to Invoke-AppliveAutoHeal. Real functions are used by passing
  # $null scriptblocks; tests inject fakes to count orchestration without
  # touching real processes. Default OFF -> emits AUTOHEAL_DISABLED.
  Invoke-AppliveAutoHeal -VitePort $vitePort -Worktree $Worktree -WtNorm $wtNorm -Profile $Profile -RepoRoot $repoRoot -NodeDir $nodeDir -PyExe $pyExe -CdpPort $cdpPort -BackendPort $backendPort -StartInstance $null -WaitWindow $null -WaitBackend $null -ProbeVite $null
}

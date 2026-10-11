#requires -Version 7
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'mp-applive-launcher.ps1') -Test

# ---- 1) Test-ViteServing: HTML -> serving, failure -> not serving ----
$htmlGet = { param($u) [PSCustomObject]@{ StatusCode = 200; Content = '<!DOCTYPE html><html><body>app</body></html>' } }
if (-not (Test-ViteServing -VitePort 5199 -HttpGet $htmlGet)) { throw 'HTML should be VITE_SERVING' }
Write-Host 'PASS vite-serving html'

$badGet = { param($u) [PSCustomObject]@{ StatusCode = 500; Content = '' } }
if (Test-ViteServing -VitePort 5199 -HttpGet $badGet) { throw '500 should be VITE_NOT_SERVING' }
Write-Host 'PASS vite-serving non-200'

$failGet = { param($u) throw 'connection refused' }
if (Test-ViteServing -VitePort 5199 -HttpGet $failGet) { throw 'exception should be VITE_NOT_SERVING' }
Write-Host 'PASS vite-serving exception'

$emptyGet = { param($u) [PSCustomObject]@{ StatusCode = 200; Content = 'not html here' } }
if (Test-ViteServing -VitePort 5199 -HttpGet $emptyGet) { throw 'non-html body should be VITE_NOT_SERVING' }
Write-Host 'PASS vite-serving non-html body'

# ---- 2) Get-AppliveAutoHealConfig: default OFF cap 3, env override ----
$oldA = $env:MP_APPLIVE_AUTOHEAL; $oldM = $env:MP_APPLIVE_AUTOHEAL_MAX
try {
  $env:MP_APPLIVE_AUTOHEAL = $null; $env:MP_APPLIVE_AUTOHEAL_MAX = $null
  $c = Get-AppliveAutoHealConfig
  if ($c.Enabled) { throw 'default should be disabled' }
  if ($c.Max -ne 3) { throw "default max should be 3, got $($c.Max)" }
  Write-Host 'PASS autoheal default off'

  $env:MP_APPLIVE_AUTOHEAL = '1'; $env:MP_APPLIVE_AUTOHEAL_MAX = '5'
  $c = Get-AppliveAutoHealConfig
  if (-not $c.Enabled) { throw 'env=1 should enable' }
  if ($c.Max -ne 5) { throw "max should be 5, got $($c.Max)" }
  Write-Host 'PASS autoheal env override'

  $env:MP_APPLIVE_AUTOHEAL = 'true'; $env:MP_APPLIVE_AUTOHEAL_MAX = '0'
  $c = Get-AppliveAutoHealConfig
  if (-not $c.Enabled) { throw 'env=true should enable' }
  if ($c.Max -ne 3) { throw "invalid max should fall back to 3, got $($c.Max)" }
  Write-Host 'PASS autoheal invalid max fallback'
} finally {
  $env:MP_APPLIVE_AUTOHEAL = $oldA; $env:MP_APPLIVE_AUTOHEAL_MAX = $oldM
}

# ---- 3) Wait-AppliveBackend: ownership logic (Mine vs other) ----
# backend owned by THIS worktree -> ok; owned by another -> not ok
$wt = 'D:\Data\projects\mp-worktrees\mp-app-live2'
$getTcpMine = { param($Port) @([PSCustomObject]@{ OwningProcess = 1234 }) }
$getProcMine = { param($ProcessId) [PSCustomObject]@{ Name = 'node.exe'; CommandLine = "node $wt\apps\desktop\scripts\dev.js" } }
if (-not (Wait-AppliveBackend -BackendPort 8299 -WorktreePath $wt -MaxAttempts 1 -GetNetTcp $getTcpMine -GetProc $getProcMine)) {
  throw 'own backend should be detected as Mine'
}
Write-Host 'PASS backend ownership mine'

$getTcpOther = { param($Port) @([PSCustomObject]@{ OwningProcess = 5678 }) }
$getProcOther = { param($ProcessId) [PSCustomObject]@{ Name = 'node.exe'; CommandLine = 'node C:\other\apps\desktop\scripts\dev.js' } }
if (Wait-AppliveBackend -BackendPort 8299 -WorktreePath $wt -MaxAttempts 1 -GetNetTcp $getTcpOther -GetProc $getProcOther) {
  throw 'other worktree backend must NOT count as Mine'
}
Write-Host 'PASS backend ownership other-rejected'

# ---- 4) Wait-AppliveWindow: window detection + timeout ----
$winGet = { @([PSCustomObject]@{ Path = "$wt\node_modules\electron\dist\electron.exe"; MainWindowHandle = 123; Id = 42 }) }
if (-not (Wait-AppliveWindow -WtNorm $wt.Replace('/','\') -MaxAttempts 1 -GetElectron $winGet)) {
  throw 'visible window should be detected'
}
Write-Host 'PASS window detection'

# ---- 5) Start-AppliveInstance: orchestrates stop+launch via injected blocks ----
$stopped = $false; $launchedCmd = $null
$stopEl = { param($WtNorm) $script:stopped = $true }
$stopNd = { param($Worktree,$WtNorm) }
$launch = { param($CommandLine) $script:launchedCmd = $CommandLine }
Start-AppliveInstance -Worktree $wt -WtNorm $wt.Replace('/','\') -Profile 'D:\Data\projects\mulpub\shared-user-data' -RepoRoot 'D:\Data\projects\mulpub' -NodeDir 'C:\node' -PyExe 'python' -VitePort 5199 -CdpPort 9222 -BackendPort 8299 -StopElectron $stopEl -StopNode $stopNd -Launch $launch
if (-not $stopped) { throw 'StopElectron should have been called' }
if ([string]::IsNullOrEmpty($launchedCmd) -or $launchedCmd -notlike '*node scripts/dev.js*') { throw "unexpected launch command: $launchedCmd" }
Write-Host 'PASS instance orchestration'

# ---- 6) Invoke-AppliveAutoHeal: orchestration count + default OFF ----
$oldA = $env:MP_APPLIVE_AUTOHEAL; $oldM = $env:MP_APPLIVE_AUTOHEAL_MAX
try {
  # probe always fails -> drive the loop; count StartInstance re-invocations
  $probeFail = { param($VitePort) $false }
  $winStub = { param($WtNorm,$MaxAttempts) [PSCustomObject]@{ Id = 1; MainWindowHandle = 1; MainWindowTitle = 'x' } }
  $backendStub = { param($BackendPort,$WorktreePath,$MaxAttempts) $true }
  $count = 0
  $startStub = { param($Worktree,$WtNorm,$Profile,$RepoRoot,$NodeDir,$PyExe,$VitePort,$CdpPort,$BackendPort) $script:count++ }

  # default OFF -> must NOT call StartInstance even though probe fails
  $env:MP_APPLIVE_AUTOHEAL = $null; $env:MP_APPLIVE_AUTOHEAL_MAX = $null
  $count = 0
  Invoke-AppliveAutoHeal -VitePort 5199 -Worktree $wt -WtNorm $wt.Replace('/','\') -Profile 'D:\Data\projects\mulpub\shared-user-data' -RepoRoot 'D:\Data\projects\mulpub' -NodeDir 'C:\node' -PyExe 'python' -CdpPort 9222 -BackendPort 8299 -StartInstance $startStub -WaitWindow $winStub -WaitBackend $backendStub -ProbeVite $probeFail
  if ($count -ne 0) { throw "disabled autoheal must not restart, got $count" }
  Write-Host 'PASS autoheal disabled no restart'

  # enabled, max=3 -> exactly 3 re-invocations (initial probe fails, then loop up to Max)
  $env:MP_APPLIVE_AUTOHEAL = '1'; $env:MP_APPLIVE_AUTOHEAL_MAX = '3'
  $count = 0
  Invoke-AppliveAutoHeal -VitePort 5199 -Worktree $wt -WtNorm $wt.Replace('/','\') -Profile 'D:\Data\projects\mulpub\shared-user-data' -RepoRoot 'D:\Data\projects\mulpub' -NodeDir 'C:\node' -PyExe 'python' -CdpPort 9222 -BackendPort 8299 -StartInstance $startStub -WaitWindow $winStub -WaitBackend $backendStub -ProbeVite $probeFail
  if ($count -ne 3) { throw "enabled autoheal must restart Max=3 times, got $count" }
  Write-Host 'PASS autoheal restart up to max'

  # enabled, max=2 -> exactly 2 re-invocations (stops at cap)
  $env:MP_APPLIVE_AUTOHEAL = 'true'; $env:MP_APPLIVE_AUTOHEAL_MAX = '2'
  $count = 0
  Invoke-AppliveAutoHeal -VitePort 5199 -Worktree $wt -WtNorm $wt.Replace('/','\') -Profile 'D:\Data\projects\mulpub\shared-user-data' -RepoRoot 'D:\Data\projects\mulpub' -NodeDir 'C:\node' -PyExe 'python' -CdpPort 9222 -BackendPort 8299 -StartInstance $startStub -WaitWindow $winStub -WaitBackend $backendStub -ProbeVite $probeFail
  if ($count -ne 2) { throw "enabled autoheal must stop at max=2, got $count" }
  Write-Host 'PASS autoheal stops at cap'
} finally {
  $env:MP_APPLIVE_AUTOHEAL = $oldA; $env:MP_APPLIVE_AUTOHEAL_MAX = $oldM
}

# ---- 7) live smoke: functions must not throw when called on the real host ----
$probe = Test-ViteServing -VitePort 5199
Write-Host ("live probe ok=" + $probe)
$cfg = Get-AppliveAutoHealConfig
Write-Host ("live config enabled=" + $cfg.Enabled + " max=" + $cfg.Max)

Write-Host 'APPLIVE_LAUNCHER_TEST_OK'

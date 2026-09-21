<#
.SYNOPSIS
  Foreign profile-holder audit helpers for the start-app fastpath launcher.

.DESCRIPTION
  The fastpath (sync-app.ps1 -> mp-applive-launcher.ps1) only stopped Electron
  processes whose binary path lived under the run worktree. An older Electron
  started from ANY other directory but holding the SAME userData profile keeps
  the Chromium single-instance lock: the new instance quits silently and the
  second-instance handler just re-focuses the OLD window (old renderer bundle).
  This module detects those foreign holders so the launcher can audit-stop them,
  and exposes lock-holder diagnostics so a missing window is never mistaken for
  a healthy app.

  Compatible with Windows PowerShell 5.1 and pwsh 7 (the launcher runs under
  powershell.exe 5.1, so NO #requires here). Pure ASCII.
#>

function Get-ProfilePathVariants {
  <#
  .SYNOPSIS
    Return slash/backslash variants of a profile path for command-line matching.
    dev-launcher.js may render --user-data-dir with either separator style.
  #>
  param([Parameter(Mandatory)][string]$ProfilePath)
  $trimmed = $ProfilePath.Trim().TrimEnd('\', '/')
  $variants = @($trimmed, $trimmed.Replace('/', '\'), $trimmed.Replace('\', '/'))
  @($variants | Select-Object -Unique)
}

function Get-ElectronProfileOwners {
  <#
  .SYNOPSIS
    Electron processes whose command line carries --user-data-dir=<ProfilePath>.
  .PARAMETER Processes
    Inject Win32_Process-like objects for tests; defaults to a live CIM scan.
  #>
  param(
    [Parameter(Mandatory)][string]$ProfilePath,
    [object[]]$Processes
  )
  if ($null -eq $Processes) {
    $Processes = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue)
  }
  $patterns = @(Get-ProfilePathVariants -ProfilePath $ProfilePath | ForEach-Object {
    ('--user-data-dir=("?' + [regex]::Escape($_) + '"?)(?=\s|$)')
  })
  $seen = @{}
  $result = @()
  foreach ($p in $Processes) {
    if (-not $p.CommandLine) { continue }
    $hit = $false
    foreach ($pat in $patterns) {
      if ($p.CommandLine -match $pat) { $hit = $true; break }
    }
    if (-not $hit) { continue }
    $key = [string]$p.ProcessId
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $result += [pscustomobject]@{
      Pid         = $p.ProcessId
      ExePath     = $p.ExecutablePath
      IsMain      = ($p.CommandLine -notmatch '--type=')
      CommandLine = $p.CommandLine
    }
  }
  # Deliberately NOT wrapping with a leading comma: callers already do @(...),
  # and a nested array breaks member access ($_.Pid) on the owner objects.
  $result
}

function Split-ForeignProfileOwners {
  <#
  .SYNOPSIS
    Classify profile owners by worktree ownership: Same (expected, handled by
    the launcher's own-worktree stop) vs Foreign (stale holder to audit-stop).
  #>
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Owners,
    [Parameter(Mandatory)][string]$WorktreePath
  )
  $variants = @(Get-ProfilePathVariants -ProfilePath $WorktreePath)
  $same = @($Owners | Where-Object {
    $exe = $_.ExePath
    ($exe -and (@($variants | Where-Object { $exe -like ($_ + '*') }).Count -gt 0))
  })
  $foreign = @($Owners | Where-Object { $same -notcontains $_ })
  [pscustomobject]@{
    Same        = $same
    Foreign     = $foreign
    ForeignMain = @($foreign | Where-Object { $_.IsMain })
    HasForeign  = ($foreign.Count -gt 0)
  }
}

function Get-ElectronLockHolderCandidates {
  <#
  .SYNOPSIS
    Diagnostic lines for all live Electron MAIN processes. When the launcher
    sees no window after startup these are the processes most likely holding
    the single-instance lock (i.e. the visible "old renderer" window owner).
  #>
  param([object[]]$Processes)
  if ($null -eq $Processes) {
    $Processes = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue)
  }
  $lines = @()
  foreach ($p in $Processes) {
    if ($p.CommandLine -and ($p.CommandLine -match '--type=')) { continue }
    $cmd = [string]$p.CommandLine
    if ($cmd.Length -gt 160) { $cmd = $cmd.Substring(0, 160) + '...' }
    $lines += ('pid=' + $p.ProcessId + ' exe=' + $p.ExecutablePath + ' cmd=' + $cmd)
  }
  $lines
}

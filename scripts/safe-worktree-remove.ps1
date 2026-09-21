<#
.SYNOPSIS
    Safely remove a git worktree (AGENTS.md guardrails R1-R5; hardened 2026-08-28).

.DESCRIPTION
    Hardened against a VERIFIED cascade-delete failure mode: `git worktree remove --force`
    recurses THROUGH junctions/symlinks and deletes their TARGETS. If a worktree contains a
    junction pointing at the shared main workspace, removing it wipes the main workspace
    including its .git directory.

    The previous implementation could not detect that because its link scan was capped at
    -Depth 3, while pnpm `@multi-publish/*` workspace links live at depth 5 - i.e. every
    real worktree in this project sat outside the scan horizon.

    Pipeline:
      R1  baseline snapshot (porcelain status + stash count)
      R3  FULL-DEPTH link scan; BLOCK on any link resolving outside the worktree
      R3b unlink every link inside the worktree BEFORE removal (neutralises traversal
          even if a link somehow evades R3)
      R4  stop processes whose image path is strictly inside the worktree
      R5  git worktree remove [--force]
      R6  residual directory cleanup via .NET Delete (safe once links are unlinked)
      R7  verify main workspace matches baseline (status AND stash count)

.PARAMETER Worktree
    Absolute path of the worktree to remove.

.PARAMETER Force
    Allow `git worktree remove --force`. Requires -ConfirmDirtyDiscarded.

.PARAMETER ConfirmDirtyDiscarded
    Explicit acknowledgement that dirty/untracked content in the worktree may be discarded.

.PARAMETER MainWorkspace
    Main workspace path. Auto-derived via `git rev-parse --git-common-dir`, which resolves
    correctly even when the script is invoked from inside a linked worktree.

.PARAMETER ProtectedDataRoot
    Absolute path(s) that must NEVER be deleted or swallowed by the removal (persistence
    anchors, e.g. shared-user-data holding login state / DB). Defaults to
    '<MainWorkspace>\shared-user-data'. Removal is refused when the target equals, contains
    or sits inside any protected root.

.PARAMETER WhatIf
    Print the plan and every command that would run; change nothing.

.EXAMPLE
    safe-worktree-remove.ps1 -Worktree D:\...\mp-foo -WhatIf
    safe-worktree-remove.ps1 -Worktree D:\...\mp-foo -Force -ConfirmDirtyDiscarded
#>
param(
    [Parameter(Mandatory = $true)][string]$Worktree,
    [switch]$Force,
    [switch]$ConfirmDirtyDiscarded,
    [string]$MainWorkspace = "",
    [string[]]$ProtectedDataRoot = @(),
    [switch]$WhatIf
)

$ErrorActionPreference = 'Continue'

# ---------------- helpers ----------------
function Write-Section([string]$t) { Write-Host ""; Write-Host ("=== {0} ===" -f $t) }
function Norm([string]$p) { if (-not $p) { return '' }; return (($p -replace '/', '\').TrimEnd('\')) }
function Test-PathInside([string]$Path, [string]$Root) {
    $p = Norm $Path; $r = Norm $Root
    if (-not $p -or -not $r) { return $false }
    return ($p -eq $r) -or $p.StartsWith($r + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Resolve-LinkTarget([string]$LinkPath) {
    # Junction/symlink .Target may be relative - resolve against the LINK's own directory.
    $it = Get-Item -LiteralPath $LinkPath -Force -ErrorAction SilentlyContinue
    if (-not $it) { return $null }
    $t = ''
    if ($it.PSObject.Properties.Name -contains 'Target') {
        $v = $it.Target
        if ($v -is [array]) { $t = ($v -join '') } else { $t = [string]$v }
    }
    if (-not $t) { return $null }
    $parent = Split-Path -Path $LinkPath -Parent
    $abs = if ([System.IO.Path]::IsPathRooted($t)) { [System.IO.Path]::GetFullPath($t) }
           else { [System.IO.Path]::GetFullPath((Join-Path $parent $t)) }
    return (Norm $abs)
}

function Get-Links([string]$Root) {
    # Full depth, cmd-implemented, not bounded by -Depth. Returns absolute link paths.
    $raw = & cmd /c "dir /aL /s /b `"$Root`"" 2>$null
    return @($raw | Where-Object { $_ -and ($_.Trim().Length -gt 0) } | ForEach-Object { $_.Trim() })
}

# ---------------- resolve main workspace ----------------
if (-not $MainWorkspace) {
    $gcd = (& git rev-parse --git-common-dir 2>$null).Trim()
    if ($gcd) {
        $base = if ([System.IO.Path]::IsPathRooted($gcd)) { $gcd } else { Join-Path (Get-Location).Path $gcd }
        $MainWorkspace = Split-Path -Path (Norm ([System.IO.Path]::GetFullPath($base))) -Parent
    }
}
if (-not $MainWorkspace) { Write-Host "FATAL: cannot derive main workspace; pass -MainWorkspace."; exit 1 }

$main = Norm ([System.IO.Path]::GetFullPath($MainWorkspace))
if (-not (Test-Path -LiteralPath $main)) { Write-Host "FATAL: main workspace not found: $main"; exit 1 }
$inside = (& git -C $main rev-parse --is-inside-work-tree 2>$null)
if ($LASTEXITCODE -ne 0 -or $inside -notmatch 'true') {
    Write-Host "FATAL: not a git working tree: $main"; exit 1
}

$wt = Norm ([System.IO.Path]::GetFullPath($Worktree))
if ($wt -eq $main) { Write-Host "FATAL: target is the main workspace itself."; exit 1 }
if (-not (Test-Path -LiteralPath $wt)) { Write-Host "SKIP: worktree does not exist: $wt"; exit 0 }

# ---------------- R0 protected persistence anchors (never deletable) ----------------
# shared-user-data is the gitignored persistence anchor (identity session, accounts,
# multi-publish.db). It legitimately never lives inside a worktree; hitting this guard
# means the target path was mis-specified. Refuse in every containment direction.
if (-not $ProtectedDataRoot -or $ProtectedDataRoot.Count -eq 0) {
    $ProtectedDataRoot = @(Join-Path $main 'shared-user-data')
}
$anchors = @($ProtectedDataRoot | ForEach-Object { Norm ([System.IO.Path]::GetFullPath($_)) } | Where-Object { $_ })
foreach ($a in $anchors) {
    if ($wt -eq $a -or (Test-PathInside $a $wt) -or (Test-PathInside $wt $a)) {
        Write-Host ""
        Write-Host "  BLOCKED (R0): target overlaps a PROTECTED persistence anchor."
        Write-Host "    anchor : $a"
        Write-Host "    target : $wt"
        Write-Host "  The anchor holds login state / accounts / DB and must never be removed."
        exit 6
    }
}

# ---------------- R1 baseline ----------------
Write-Section "R1 baseline snapshot (main workspace)"
$baseline      = @(git -C $main status --porcelain 2>$null)
$baselineStash = @(git -C $main stash list 2>$null).Count
$baselineFile  = Join-Path $env:TEMP ("wt-baseline-" + [guid]::NewGuid().ToString('N') + ".txt")
$baseline | Set-Content -LiteralPath $baselineFile -Encoding utf8
Write-Host "  main          : $main"
Write-Host "  target        : $wt"
Write-Host "  dirty entries : $($baseline.Count)"
Write-Host "  stash entries : $baselineStash"
# R1b: anchor presence snapshot - verified intact again in R7 (cascade-delete tripwire).
$anchorBefore = @{}
foreach ($a in $anchors) { $anchorBefore[$a] = (Test-Path -LiteralPath $a) }
Write-Host ("  anchors seen  : " + (@($anchors | Where-Object { $anchorBefore[$_] }).Count) + "/" + $anchors.Count)

# ---------------- R3 full-depth link scan ----------------
Write-Section "R3 full-depth link scan"
$links = Get-Links $wt
Write-Host "  links found (full depth) : $($links.Count)"
$escaping = @(); $selfContained = @()
foreach ($l in $links) {
    $t = Resolve-LinkTarget $l
    if (-not $t) {
        # Unresolvable link: fail closed.
        $escaping += [pscustomobject]@{ Link = $l; Target = '(unresolvable)' }
        continue
    }
    if (Test-PathInside $t $wt) { $selfContained += [pscustomobject]@{ Link = $l; Target = $t } }
    else { $escaping += [pscustomobject]@{ Link = $l; Target = $t } }
}
Write-Host "  self-contained : $($selfContained.Count)"
Write-Host "  ESCAPING       : $($escaping.Count)"

if ($escaping.Count -gt 0) {
    Write-Host ""
    Write-Host "  BLOCKED: these links resolve OUTSIDE the worktree. Removing the worktree"
    Write-Host "  through them destroys their targets (verified: git worktree remove --force"
    Write-Host "  recurses through junctions)."
    foreach ($e in $escaping) {
        $hitsMain = if (Test-PathInside $e.Target $main) { '   <== points at MAIN workspace' } else { '' }
        Write-Host ("    {0}" -f $e.Link)
        Write-Host ("      -> {0}{1}" -f $e.Target, $hitsMain)
    }
    Write-Host ""
    Write-Host "  To proceed, unlink them first (removes the LINK only; target untouched):"
    foreach ($e in $escaping) { Write-Host ("    cmd /c rmdir `"{0}`"" -f $e.Link) }
    Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
    exit 2
}

# ---------------- registration + dirty ----------------
$registered = $false
foreach ($line in @(git -C $main worktree list --porcelain 2>$null)) {
    if ((Norm ($line -replace '^worktree ', '')) -eq $wt) { $registered = $true }
}
$dirty = @(if ($registered) { git -C $wt status --porcelain 2>$null })
Write-Host "  git-registered : $registered"
Write-Host "  worktree dirty : $($dirty.Count)"

# ---------------- WhatIf ----------------
if ($WhatIf) {
    Write-Host ""
    Write-Host "=== WHATIF (nothing has been changed) ==="
    Write-Host "  would unlink : $($selfContained.Count) self-contained link(s)"
    foreach ($s in $selfContained) { Write-Host ("    cmd /c rmdir `"{0}`"   (target {1})" -f $s.Link, $s.Target) }
    $forceFlag = if ($Force) { '--force ' } else { '' }
    Write-Host ("  would run    : git -C `"{0}`" worktree remove {1}`"{2}`"" -f $main, $forceFlag, $wt)
    Write-Host "  would then   : [System.IO.Directory]::Delete('$wt', `$true)  if the directory remains"
    Write-Host "  would verify : main status + stash count unchanged vs baseline"
    Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
    exit 0
}

# ---------------- gate: dirty / force ----------------
if ($dirty.Count -gt 0 -and -not $ConfirmDirtyDiscarded) {
    Write-Host ""
    Write-Host "  BLOCKED: worktree has $($dirty.Count) dirty/untracked entr(y/ies)."
    $dirty | Select-Object -First 20 | ForEach-Object { Write-Host "    $_" }
    Write-Host "  Commit/stash them, or re-run with -ConfirmDirtyDiscarded."
    Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
    exit 4
}
if ($Force -and -not $ConfirmDirtyDiscarded) {
    Write-Host ""
    Write-Host "  BLOCKED: -Force discards the worktree's dirty/untracked content."
    Write-Host "  Re-run with -Force -ConfirmDirtyDiscarded once you have inspected it."
    Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
    exit 4
}

# ---------------- R3b unlink BEFORE removal ----------------
Write-Section "R3b unlink links (neutralises traversal)"
$unlinked = @()
foreach ($s in $selfContained) {
    & cmd /c "rmdir `"$($s.Link)`"" 2>$null | Out-Null
    if (-not (Test-Path -LiteralPath $s.Link)) {
        $unlinked += $s
        Write-Host "  unlinked : $($s.Link)"
    } else {
        Write-Host "  FAILED   : $($s.Link)"
    }
}
if ($unlinked.Count -gt 0) {
    Write-Host "  ($($unlinked.Count) link(s) removed; targets untouched. Recreate with:)"
    foreach ($s in $unlinked) { Write-Host ("    cmd /c mklink /J `"{0}`" `"{1}`"" -f $s.Link, $s.Target) }
}

# ---------------- R4 stop processes ----------------
Write-Section "R4 stop processes (strictly inside the worktree)"
$names = @('node', 'electron', 'esbuild', 'dotnet', 'python', 'pwsh')
$procs = @(Get-Process -Name $names -ErrorAction SilentlyContinue |
           Where-Object { $_.Path -and (Test-PathInside $_.Path $wt) })
if ($procs.Count -eq 0) { Write-Host "  none" }
foreach ($p in $procs) {
    Write-Host "  STOP $($p.ProcessName) #$($p.Id)  $($p.Path)"
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}

# ---------------- R5 git worktree remove ----------------
Write-Section "R5 git worktree remove"
if ($registered) {
    $gitArgs = @('-C', $main, 'worktree', 'remove')
    if ($Force) { $gitArgs += '--force' }
    $gitArgs += $wt
    & git @gitArgs 2>&1 | Out-String | Write-Host
    $rc = $LASTEXITCODE
    if ($rc -ne 0) {
        Write-Host "  git worktree remove failed (rc=$rc)."
        Write-Host "  NOTHING was deleted: links were unlinked, git registry untouched."
        Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
        exit 1
    }
    & git -C $main worktree prune 2>&1 | Out-Null
} else {
    Write-Host "  not registered with git; skipping git remove (residual cleanup below)."
}

# ---------------- R6 residual directory ----------------
if (Test-Path -LiteralPath $wt) {
    Write-Section "R6 residual directory cleanup"
    # Re-scan: a link could have been (re)created between R3 and here.
    $late = @(Get-Links $wt)
    foreach ($l in $late) { & cmd /c "rmdir `"$l`"" 2>$null | Out-Null }
    Write-Host "  late links unlinked : $($late.Count)"
    try {
        [System.IO.Directory]::Delete($wt, $true)
        Write-Host "  deleted : $wt"
    } catch {
        Write-Host "  FAILED  : $($_.Exception.Message)"
        Write-Host "  Directory partially removed. Handle remaining paths individually;"
        Write-Host "  never use Remove-Item -Recurse on a tree that may contain links."
        Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
        exit 5
    }
}

# ---------------- R7 verify ----------------
Write-Section "R7 verify main workspace vs baseline"
$after       = @(git -C $main status --porcelain 2>$null)
$afterStash  = @(git -C $main stash list 2>$null).Count
$beforeSet   = @{}; $baseline | ForEach-Object { $beforeSet[$_] = $true }
$newEntries  = @($after | Where-Object { -not $beforeSet.ContainsKey($_) })

$failed = $false
if ($newEntries.Count -gt 0) {
    Write-Host "  FAIL: main workspace has changes outside the baseline:"
    $newEntries | Select-Object -First 20 | ForEach-Object { Write-Host "    $_" }
    $failed = $true
}
if ($afterStash -ne $baselineStash) {
    Write-Host "  FAIL: stash count changed $baselineStash -> $afterStash"
    $failed = $true
}
# R7b: every anchor that existed before must still exist (cascade delete would wipe it).
foreach ($a in $anchors) {
    if ($anchorBefore[$a] -and -not (Test-Path -LiteralPath $a)) {
        Write-Host "  FAIL: protected anchor vanished: $a"
        $failed = $true
    }
}
if ($failed) {
    Write-Host "  Possible cascade delete. Run safe-restore-deleted.ps1 in the main workspace."
    Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
    exit 3
}
Write-Host "  PASS: main workspace status and stash count match the baseline."
Write-Host "  worktree gone : $(-not (Test-Path -LiteralPath $wt))"
Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
Write-Host "DONE"

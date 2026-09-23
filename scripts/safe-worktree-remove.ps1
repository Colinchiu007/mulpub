<#
.SYNOPSIS
    Safely remove a git worktree (implements the AGENTS.md R1-R5 removal rules as pipeline
    stages R0-R7; hardened 2026-08-28 and 2026-09-23).

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
      R3  FULL-DEPTH link scan; BLOCK on any link resolving outside the worktree, and on
          any directory that could not be enumerated (a partial scan proves nothing)
      R3b unlink every link inside the worktree BEFORE removal (neutralises traversal
          even if a link somehow evades R3)
      R4  stop processes whose image path is strictly inside the worktree
      R5  git worktree remove [--force]; when git already unregistered the worktree and
          only failed to delete the tree, warn and fall through instead of aborting
      R6  residual directory cleanup, long-path aware, with a robocopy mirror fallback
      R7  verify main workspace matches baseline (status AND stash count)

    Long-path hardening (2026-09-23, found while removing mp-batch-check-progress-speed):
    every enumeration, existence check and delete now goes through worktree-fs-longpath.ps1,
    because this machine runs Windows PowerShell 5.1 with LongPathsEnabled=0 and git
    core.longpaths unset, i.e. everything below the path parser stops at MAX_PATH (260
    chars) and a pnpm workspace node_modules tree exceeds that routinely. Two distinct
    failures came from it:

      * R3 found links with `cmd /c dir /aL /s /b`, which under-reports deep trees SILENTLY
        (measured: 6 of 14 entries, empty stderr). "0 escaping links" was therefore able to
        green-light the cascade delete this guard exists to prevent.
      * R6 deleted with `[IO.Directory]::Delete($wt, $true)`, which throws past 260 chars,
        while R5 exited on any non-zero git code before R6 could run - the one failure mode
        that needs the cleanup was the one that skipped it.

    Regression coverage: scripts/worktree-fs-longpath.test.ps1. It asserts that the
    unprefixed delete still fails on the same fixture, so the tests cannot decay into a
    no-op if the fixture ever stops exercising MAX_PATH.

    Known boundary of the busy-holder scan (exit code 9): it matches the worktree path against
    ExecutablePath and CommandLine only, because Win32_Process exposes neither of the two things that
    would make it complete - a process CWD is not published there, and reading it costs a PEB walk per
    process. A process whose executable lives outside the worktree and whose command line never names
    the path, while its CWD sits inside it (seen in practice: an IDE terminal leaving a hanging
    `git cat-file --batch-check` behind), therefore passes the scan and can still make R6 delete part
    of the tree. R6 failing leaves the directory registered-with-git-but-half-present, which is
    recoverable and always reported; the unblock is to locate that CWD owner out of band (NtQuery-
    InformationProcess + ReadProcessMemory over each PID) and stop only that plumbing process.

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

# ---------------- long-path primitives ----------------
# $PSScriptRoot is the *caller's* folder inside a dot-sourced file, so the helper script's own
# path has to come from MyInvocation; $PSCommandPath is the modern form, the rest is the
# -File fallback. Without this the library resolves against the invoking worktree and is lost.
$__swrSelf = if ($PSCommandPath) { $PSCommandPath } elseif ($MyInvocation.MyCommand.Path) { $MyInvocation.MyCommand.Path } else { $null }
$__swrHere = if ($__swrSelf) { Split-Path -Parent $__swrSelf } else { $null }
if (-not $__swrHere -or -not (Test-Path -LiteralPath (Join-Path $__swrHere 'worktree-fs-longpath.ps1'))) {
    Write-Host 'FATAL: scripts/worktree-fs-longpath.ps1 not found next to safe-worktree-remove.ps1; refusing to run with MAX_PATH-bound guards.'
    exit 8
}
. (Join-Path $__swrHere 'worktree-fs-longpath.ps1')

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

function Get-LinkScan([string]$Root) {
    # Full depth through the \\?\ walk: bounded neither by -Depth nor by MAX_PATH.
    # Returns the report object (Links / Errors / Enumerated) so callers can fail closed
    # on a partial scan instead of mistaking blindness for safety.
    return (Get-FsLinkReport -Root $Root)
}

function Test-WorktreeRegistered([string]$Root) {
    foreach ($line in @(git -C $script:main worktree list --porcelain 2>$null)) {
        if ((Norm ($line -replace '^worktree ', '')) -eq $Root) { return $true }
    }
    return $false
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
$scan  = Get-LinkScan $wt
$links = @($scan.Links)
Write-Host "  links found (full depth) : $($links.Count)"
Write-Host "  entries enumerated       : $($scan.Enumerated)"
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
    foreach ($e in $escaping) { Write-Host ("    Remove-FsLink `"{0}`"" -f $e.Link) }
    Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
    exit 2
}

if ($scan.Errors.Count -gt 0) {
    Write-Host ""
    Write-Host "  BLOCKED (R3): the link scan could not enumerate every directory, so it"
    Write-Host "  cannot prove that no link escapes the worktree. A partial scan is not"
    Write-Host "  evidence of safety - failing closed."
    $scan.Errors | Select-Object -First 20 | ForEach-Object { Write-Host "    $_" }
    Write-Host ""
    Write-Host "  Release whatever holds those paths (a shell cwd inside the worktree, a"
    Write-Host "  running dev server, antivirus) and re-run."
    Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
    exit 7
}

# ---------------- registration + dirty ----------------
$registered = [bool](Test-WorktreeRegistered $wt)
$dirty = @(if ($registered) { git -C $wt status --porcelain 2>$null })
Write-Host "  git-registered : $registered"
Write-Host "  worktree dirty : $($dirty.Count)"

# ---------------- busy-holder scan (before anything is destroyed) ----------------
# Runs ahead of the WhatIf branch on purpose: -WhatIf has to show the refusal it would hit.
$allProcs = @()
$procEnumError = ''
try {
    $allProcs = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
} catch {
    $procEnumError = $_.Exception.Message
}
$busy = $null
if (-not $procEnumError) {
    $ances = @(Resolve-ProcessAncestors -Processes $allProcs -SelfId $PID)
    $busy = Split-WorktreeHolders -Processes $allProcs -Worktree $wt -SelfId $PID -AncestorIds $ances
    Write-Host "  busy holders : $($busy.Holders.Count) process(es) reach inside without living inside"
    foreach ($p in $busy.Holders) {
        $cl = [string]$p.CommandLine
        if ($cl.Length -gt 150) { $cl = $cl.Substring(0, 150) + '...' }
        Write-Host "    #$($p.ProcessId) $($p.Name)  $cl"
    }
} else {
    Write-Host "  busy holders : UNKNOWN (process enumeration failed: $procEnumError)"
}

# ---------------- WhatIf ----------------
if ($WhatIf) {
    Write-Host ""
    Write-Host "=== WHATIF (nothing has been changed) ==="
    Write-Host "  would unlink : $($selfContained.Count) self-contained link(s)"
    foreach ($s in $selfContained) { Write-Host ("    Remove-FsLink `"{0}`"   (target {1})" -f $s.Link, $s.Target) }
    $forceFlag = if ($Force) { '--force ' } else { '' }
    Write-Host ("  would run    : git -C `"{0}`" worktree remove {1}`"{2}`"" -f $main, $forceFlag, $wt)
    Write-Host "  would then   : Remove-FsDirectory `$wt (\\?\ prefixed), falling back to Clear-FsDirectoryByMirror, if the directory remains"
    if ($procEnumError) { Write-Host "  would REFUSE : idleness unproven (process enumeration failed) -> exit 9" }
    elseif ($busy.Holders.Count -gt 0) { Write-Host "  would REFUSE : $($busy.Holders.Count) live holder(s) -> exit 9" }
    else { Write-Host "  would pass   : no process references this worktree" }
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
    # Link only (recursive = $false is the whole point): the target is never touched, and a
    # link whose own path sits past MAX_PATH is still reachable, which cmd rmdir is not.
    [void](Remove-FsLink $s.Link)
    if (-not (Test-FsEntry $s.Link)) {
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

# ---------------- gate: live holders / unproven idleness ----------------
if ($procEnumError) {
    Write-Host ""
    Write-Host "  BLOCKED: processes could not be enumerated ($procEnumError), so the tree's idleness is"
    Write-Host "  unproven. Refusing anyway: an unproven busy state is exactly the false negative this"
    Write-Host "  guard exists for - R3 learned the same lesson from the link scanner."
    Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
    exit 9
}
if ($busy.Holders.Count -gt 0) {
    Write-Host ""
    Write-Host "  BLOCKED: $($busy.Holders.Count) process(es) hold paths inside $wt while their executable"
    Write-Host "  lives outside it (e.g. a global node running <$wt>\...\vitest), so R4 cannot judge"
    Write-Host "  whether stopping them is safe - they usually belong to another session."
    Write-Host "  Deleting now would leave a half-removed tree. Let them finish (or stop them yourself)"
    Write-Host "  and re-run; the script is safe to repeat."
    Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
    exit 9
}

# ---------------- R5 git worktree remove ----------------
Write-Section "R5 git worktree remove"
$residualOnly = $false
if ($registered) {
    $gitArgs = @('-C', $main, 'worktree', 'remove')
    if ($Force) { $gitArgs += '--force' }
    $gitArgs += $wt
    & git @gitArgs 2>&1 | Out-String | Write-Host
    $rc = $LASTEXITCODE
    if ($rc -ne 0) {
        # rc != 0 does NOT mean nothing happened. git removes the administrative entry and
        # the working-tree link file first and deletes the directory last; when the delete is
        # the part that fails (Windows MAX_PATH: "error: failed to delete ... Filename too
        # long") the worktree is already unregistered and only the tree is left behind.
        # Aborting there skips the cleanup that exists for exactly that state.
        $stillRegistered = [bool](Test-WorktreeRegistered $wt)
        $dirPresent      = [bool](Test-FsEntry $wt)
        $disposition = Resolve-RemoveDisposition -ExitCode $rc -Registered $stillRegistered -DirPresent $dirPresent
        if ($disposition -eq 'hard_fail') {
            Write-Host "  git worktree remove failed (rc=$rc) and the worktree is STILL REGISTERED."
            Write-Host "  NOTHING was deleted: links were unlinked, git registry untouched."
            Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
            exit 1
        }
        Write-Host "  git worktree remove returned rc=$rc -> disposition: $disposition."
        Write-Host "  The registration is already gone; only the directory is left behind."
        Write-Host "  Continuing to R6 instead of aborting (that abort was the defect)."
        $residualOnly = $true
    }
    & git -C $main worktree prune 2>&1 | Out-Null
} else {
    Write-Host "  not registered with git; skipping git remove (residual cleanup below)."
}

# ---------------- R6 residual directory ----------------
if (Test-FsEntry $wt) {
    Write-Section "R6 residual directory cleanup (long-path aware)"
    # Re-scan: a link could have been (re)created between R3 and here.
    $lateScan = Get-LinkScan $wt
    if ($lateScan.Errors.Count -gt 0) {
        Write-Host "  BLOCKED: the residual tree can no longer be scanned completely, so it"
        Write-Host "  cannot be deleted safely either. Failing closed."
        $lateScan.Errors | Select-Object -First 20 | ForEach-Object { Write-Host "    $_" }
        Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
        exit 7
    }
    $late = @($lateScan.Links)
    foreach ($l in $late) { [void](Remove-FsLink $l) }
    Write-Host "  late links unlinked : $($late.Count)"

    $rm = Remove-FsDirectory $wt
    if ($rm.Ok) {
        Write-Host "  deleted via $($rm.Strategy) : $wt"
    } else {
        Write-Host "  $($rm.Strategy) failed: $($rm.Error)"
        Write-Host "  falling back to the robocopy empty-mirror purge (/XJ keeps links out)"
        $mir = Clear-FsDirectoryByMirror $wt
        if ($mir.Ok) {
            Write-Host "  deleted via robocopy-mirror (exit $($mir.RobocopyExit)) : $wt"
        } else {
            Write-Host "  FAILED  : $($mir.Error)"
            Write-Host "  Directory partially removed. Handle remaining paths individually;"
            Write-Host "  never use Remove-Item -Recurse on a tree that may contain links."
            Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
            exit 5
        }
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
Write-Host "  worktree gone : $(-not (Test-FsEntry $wt))   (residual-only purge: $residualOnly)"
Remove-Item -LiteralPath $baselineFile -ErrorAction SilentlyContinue
Write-Host "DONE"

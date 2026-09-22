<#
.SYNOPSIS
    Long-path-safe filesystem primitives for worktree removal (Windows / PowerShell 5.1).

.DESCRIPTION
    Why this exists (regression 2026-09-23, found while removing mp-batch-check-progress-speed):

      PowerShell 5.1 runs on .NET Framework without OS long-path awareness on this machine
      (registry LongPathsEnabled = 0) and git has core.longpaths unset. Every Win32 call that
      goes through the normal path parser therefore stops at MAX_PATH (260 chars). A pnpm
      workspace node_modules tree exceeds that easily, so a worktree removal can fail in the
      middle of a delete, and - far worse - a link scan can silently report fewer entries
      than exist.

      Measured on this machine (scripts/worktree-fs-longpath.test.ps1 carries the executable
      version of these numbers, deep tree with 585-char leaf paths):

        cmd /c "dir /s /b <root>"            saw 6 of 20 entries, stderr EMPTY  (silent truncation)
        [IO.Directory]::Delete($p, $true)     FAILED  (PathTooLong / DirectoryNotFound)
        Remove-Item -Recurse -Force           FAILED  (DirectoryNotFound)
        [IO.Directory]::Delete('\\?\'+$p, ..) OK
        robocopy <empty> $p /MIR /XJ          OK      (exit code <= 7 means success)

      The `\\?\` extended-length prefix bypasses MAX_PATH parsing, which is what makes the
      guards below actually see - and actually delete - a real worktree.

    Safety contract for callers:
      * Get-FsLinkReport never descends into a reparse point, so it cannot enumerate (or
        later delete) anything through a junction that points outside the scanned root.
      * Get-FsLinkReport reports enumeration ERRORS. A scan that could not read part of the
        tree must be treated as fail-closed: "no escaping links found" is not evidence of
        safety when the scanner was blind.
      * Remove-FsLink only ever removes the link itself (recursive = $false).
      * Nothing here follows or resolves a link target for deletion.

.EXAMPLE
    . (Join-Path $PSScriptRoot 'worktree-fs-longpath.ps1')
    $rep = Get-FsLinkReport -Root 'D:\Data\projects\mp-worktrees\mp-foo'
    if ($rep.Errors.Count) { exit 1 }
#>
Set-StrictMode -Off
$ErrorActionPreference = 'Continue'

# Strip the extended-length marker again, so reported paths stay usable by callers that do
# not need (or want) the prefix - e.g. Get-Item, which resolves link targets from a plain path.
function Remove-LongPathPrefix {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ($Path.StartsWith('\\?\UNC\')) { return '\\' + $Path.Substring(8) }
    if ($Path.StartsWith('\\?\'))     { return $Path.Substring(4) }
    return $Path
}

# Prefix an absolute Windows path with the extended-length marker so the Win32 layer stops
# applying MAX_PATH. Idempotent; resolves relative input against the current directory.
function Get-LongPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $p = ($Path -replace '/', '\')
    if ($p.StartsWith('\\?\') -or $p.StartsWith('\\.\')) { return $p }
    if (-not [System.IO.Path]::IsPathRooted($p)) { $p = [System.IO.Path]::GetFullPath($p) }
    if ($p.StartsWith('\\')) { return '\\?\UNC\' + $p.Substring(2) }
    return '\\?\' + $p
}

# Long-path-aware existence check covering files, directories and reparse points.
function Test-FsEntry {
    param([Parameter(Mandatory = $true)][string]$Path)
    $lp = Get-LongPath $Path
    try {
        if ([System.IO.Directory]::Exists($lp)) { return $true }
        if ([System.IO.File]::Exists($lp)) { return $true }
    } catch { return $false }
    return $false
}

# True when the entry itself is a reparse point (junction, symlink, mount point).
# Reads the attribute instead of File.ResolveLinkTarget so it works on PS 5.1 / .NET Framework.
function Test-FsReparsePoint {
    param([Parameter(Mandatory = $true)][string]$Path)
    try { $attr = [System.IO.File]::GetAttributes((Get-LongPath $Path)) } catch { return $false }
    return (($attr -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

<#
.DESCRIPTION
    Full-depth link scan that is not bounded by MAX_PATH.

    Returns [pscustomobject] with:
      Root        absolute normalised root
      Links       string[] absolute paths of reparse points found (NOT descended into)
      Errors      string[] '<path> :: <reason>' for entries that could not be enumerated
      Enumerated  how many entries were actually visited (tests use this to prove depth reach)

    A non-empty Errors array means the scan was partial. Callers must fail closed.
#>
function Get-FsLinkReport {
    param([Parameter(Mandatory = $true)][string]$Root)
    $abs = [System.IO.Path]::GetFullPath(($Root -replace '/', '\')).TrimEnd('\')
    $links  = New-Object System.Collections.ArrayList
    $errors = New-Object System.Collections.ArrayList
    $seen   = 0
    $stack  = New-Object System.Collections.Stack
    $stack.Push((Get-LongPath $abs))
    while ($stack.Count -gt 0) {
        $cur = $stack.Pop()
        try { $entries = [System.IO.Directory]::EnumerateFileSystemEntries($cur) }
        catch {
            [void]$errors.Add((Remove-LongPathPrefix $cur) + ' :: ' + $_.Exception.GetType().Name)
            continue
        }
        foreach ($e in $entries) {
            $seen++
            # One syscall per entry, not two: the same attribute flags answer both questions.
            try { $attr = [System.IO.File]::GetAttributes($e) }
            catch {
                [void]$errors.Add((Remove-LongPathPrefix $e) + ' :: GetAttributes ' + $_.Exception.GetType().Name)
                continue
            }
            if (($attr -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                [void]$links.Add((Remove-LongPathPrefix $e))
                continue
            }
            # Plain directory: descend. Reparse points were excluded above, so the walk never
            # follows a link into a foreign tree.
            if (($attr -band [System.IO.FileAttributes]::Directory) -ne 0) { $stack.Push($e) }
        }
    }
    return [pscustomobject]@{
        Root       = $abs
        Links      = @($links)
        Errors     = @($errors)
        Enumerated = $seen
    }
}

# Remove a reparse point without touching its target (recursive = $false is the whole point).
function Remove-FsLink {
    param([Parameter(Mandatory = $true)][string]$Path)
    $lp = Get-LongPath $Path
    try {
        if ([System.IO.Directory]::Exists($lp)) { [System.IO.Directory]::Delete($lp, $false) }
        else { [System.IO.File]::Delete($lp) }
    } catch { return [pscustomobject]@{ Ok = $false; Error = $_.Exception.Message } }
    return [pscustomobject]@{ Ok = (-not (Test-FsEntry $Path)); Error = '' }
}

# Recursive delete that survives paths past MAX_PATH.
function Remove-FsDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    $lp = Get-LongPath $Path
    if (-not [System.IO.Directory]::Exists($lp)) {
        return [pscustomobject]@{ Ok = $true; Strategy = 'already-gone'; Error = '' }
    }
    try {
        [System.IO.Directory]::Delete($lp, $true)
        return [pscustomobject]@{ Ok = (-not [System.IO.Directory]::Exists($lp)); Strategy = 'io-recursive'; Error = '' }
    } catch {
        return [pscustomobject]@{ Ok = $false; Strategy = 'io-recursive'; Error = $_.Exception.Message }
    }
}

<#
.DESCRIPTION
    robocopy empty-mirror purge: the second strategy, for trees a direct .NET delete could not
    finish. /XJ excludes junctions, so a leftover link makes the mirror non-empty and the root
    delete fails loudly - fail closed, never a traversal.
    Returns [pscustomobject] @{ Ok; RobocopyExit; Error }.
#>
function Clear-FsDirectoryByMirror {
    param([Parameter(Mandatory = $true)][string]$Path)
    $empty = Join-Path $env:TEMP ('mp-empty-mirror-' + [guid]::NewGuid().ToString('N'))
    try {
        [void][System.IO.Directory]::CreateDirectory($empty)
        & robocopy $empty $Path /MIR /NJH /NJS /NFL /NDL /NP /R:1 /W:1 /XJ | Out-Null
        $rc = $LASTEXITCODE
        # robocopy treats 0-7 as success; 8 and above are real failures.
        if ($rc -ge 8) {
            return [pscustomobject]@{ Ok = $false; RobocopyExit = $rc; Error = "robocopy exit $rc" }
        }
        [void][System.IO.Directory]::Delete((Get-LongPath $Path), $false)
        return [pscustomobject]@{ Ok = (-not [System.IO.Directory]::Exists((Get-LongPath $Path))); RobocopyExit = $rc; Error = '' }
    } catch {
        return [pscustomobject]@{ Ok = $false; RobocopyExit = -1; Error = $_.Exception.Message }
    } finally {
        try { if ([System.IO.Directory]::Exists($empty)) { [void][System.IO.Directory]::Delete($empty, $false) } } catch { }
    }
}

<#
.DESCRIPTION
    Decide what to do after `git worktree remove` returned a non-zero exit code.

    This is the control-flow half of the 2026-09-23 defect: the old script exited immediately
    on any non-zero code, which short-circuited the residual-directory cleanup that exists
    precisely for the "git finished its bookkeeping but could not delete the tree" case.

    Inputs are observed state, never assumptions:
      ExitCode    rc from git worktree remove
      Registered  still present in `git worktree list`?
      DirPresent  directory still on disk?

    Returns one of:
      ok                  clean removal
      hard_fail          git refused and the registration stands -> keep the old blocking behaviour
      unregistered_empty already fully gone
      purge_residual     git unregistered itself but left the directory -> fall through to cleanup
#>
function Resolve-RemoveDisposition {
    param(
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [Parameter(Mandatory = $true)][bool]$Registered,
        [Parameter(Mandatory = $true)][bool]$DirPresent
    )
    if ($ExitCode -eq 0 -and -not $Registered -and -not $DirPresent) { return 'ok' }
    if ($Registered) { return 'hard_fail' }
    if (-not $DirPresent) { return 'unregistered_empty' }
    return 'purge_residual'
}

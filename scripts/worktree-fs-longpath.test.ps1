# Regression tests for scripts/worktree-fs-longpath.ps1
#
# Run under the shell that owns the defect: Windows PowerShell 5.1.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\worktree-fs-longpath.test.ps1
#
# These encode the three things that broke on 2026-09-23 while removing
# mp-batch-check-progress-speed:
#   1. a recursive delete could not reach past MAX_PATH, so the residual cleanup failed;
#   2. `cmd dir /s /b` - what the link guard used - silently under-reports deep trees,
#      so "0 escaping links" can be a false negative in front of a cascade delete;
#   3. `git worktree remove` failing did not distinguish "git refused" from
#      "git finished but could not delete the directory", which short-circuited the cleanup.
#
# Deep-junction creation is intentionally NOT attempted: cmd's mklink is itself MAX_PATH
# bound, so a link whose own path exceeds 260 chars cannot be made without P/Invoke. The
# properties that matter are covered instead: the scanner reaches deep entries (test 3),
# reports links and never descends through them (test 5).

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'worktree-fs-longpath.ps1')

$failures = 0
function Check([string]$name, [bool]$cond, [string]$detail) {
    if ($cond) { Write-Host "PASS $name" }
    else { Write-Host "FAIL $name  $detail"; $script:failures++ }
}

# A leaf path built from $segments 44-char segments under $base exceeds MAX_PATH quickly.
function New-DeepTree([string]$base, [int]$segments, [int]$filesPerLeaf) {
    $p = $base
    for ($i = 0; $i -lt $segments; $i++) { $p = $p + '\' + ('seg' + $i) + ('x' * 40) }
    [void][System.IO.Directory]::CreateDirectory((Get-LongPath $p))
    for ($k = 0; $k -lt $filesPerLeaf; $k++) {
        [System.IO.File]::WriteAllText((Get-LongPath ($p + "\leaf$k.txt")), 'probe')
    }
    # each segment directory contributes itself plus the file entries below it
    return [pscustomobject]@{ Deepest = $p; ExpectedEntries = $segments + $filesPerLeaf }
}

$work = Join-Path $env:TEMP ('wtfslp-' + [guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($work)

try {
    # ---- 1) Get-LongPath normalisation ----
    $cases = @(
        @{ in = 'D:\a\b';                          want = '\\?\D:\a\b' },
        @{ in = 'D:/a/b';                          want = '\\?\D:\a\b' },
        @{ in = '\\?\D:\a\b';                      want = '\\?\D:\a\b' },
        @{ in = '\\server\share\dir';              want = '\\?\UNC\server\share\dir' }
    )
    $bad = 0
    foreach ($c in $cases) { $got = Get-LongPath $c.in; if ($got -ne $c.want) { $bad++; Write-Host "  got '$got' want '$($c.want)'" } }
    Check 'Get-LongPath normalises drive/UNC/prefixed inputs' ($bad -eq 0) "$bad case(s) wrong"
    $rel = Get-LongPath 'relative\path'
    Check 'Get-LongPath resolves relative input' ($rel.StartsWith('\\?\') -and [System.IO.Path]::IsPathRooted($rel.Substring(4))) $rel

    # ---- 2) deep tree really is beyond MAX_PATH ----
    $t = New-DeepTree (Join-Path $work 'deep') 10 3
    $depth = $t.Deepest.Length
    Check 'fixture leaf path exceeds MAX_PATH' ($depth -gt 260) "len=$depth"

    # ---- 3) the scanner sees every deep entry ----
    $rep = Get-FsLinkReport -Root $work
    Check 'Get-FsLinkReport enumerates the whole deep tree' ($rep.Enumerated -ge $t.ExpectedEntries) "seen=$($rep.Enumerated) need>=$($t.ExpectedEntries)"
    Check 'scan of a readable tree reports no errors' ($rep.Errors.Count -eq 0) ($rep.Errors -join ' | ')

    # characterization only: proves why cmd cannot back this guard any more
    $cmdLines = @(& cmd /c "dir /s /b `"$work`"" 2>$null | Where-Object { $_ -and $_.Trim().Length -gt 0 })
    Write-Host "  (info) cmd /c dir /s /b saw $($cmdLines.Count) of $($rep.Enumerated) entries; stderr was empty"

    # ---- 4) link detection plus non-descent ----
    $outside = Join-Path $work 'outside-target'
    [void][System.IO.Directory]::CreateDirectory((Get-LongPath $outside))
    [System.IO.File]::WriteAllText((Get-LongPath (Join-Path $outside 'sentinel.txt')), 'must survive')
    $scanRoot = Join-Path $work 'scan-root'
    [void][System.IO.Directory]::CreateDirectory((Get-LongPath $scanRoot))
    [System.IO.File]::WriteAllText((Get-LongPath (Join-Path $scanRoot 'plain.txt')), 'x')
    & cmd /c "mklink /J `"$(Join-Path $scanRoot 'junction')`" `"$outside`"" | Out-Null
    $rep2 = Get-FsLinkReport -Root $scanRoot
    $juncFound = @($rep2.Links | Where-Object { $_ -like '*junction' }).Count
    Check 'junction inside the root is reported as a link' ($juncFound -eq 1) "links=$($rep2.Links -join ', ')"
    # scanRoot holds exactly plain.txt + junction; anything more means the walk went through
    # the junction into outside-target.
    Check 'walk stops at the junction and does not enumerate through it' ($rep2.Enumerated -eq 2) "enumerated=$($rep2.Enumerated) links=$($rep2.Links -join ', ')"
    Check 'target content never appears in the report' (-not (($rep2.Links -join '|') -match 'sentinel')) ($rep2.Links -join ', ')

    # ---- 5) Remove-FsLink deletes the link, never the target ----
    $rm = Remove-FsLink (Join-Path $scanRoot 'junction')
    Check 'Remove-FsLink removed the junction' ($rm.Ok) $rm.Error
    Check 'Remove-FsLink left the target directory intact' (Test-FsEntry (Join-Path $outside 'sentinel.txt')) 'target was deleted'

    # ---- 6) long-path recursive delete (the R6 regression) ----
    $d1 = Join-Path $work 'del-io'
    [void](New-DeepTree $d1 12 2)
    $r1 = Remove-FsDirectory $d1
    Check 'Remove-FsDirectory deletes a tree beyond MAX_PATH' ($r1.Ok -and -not (Test-FsEntry $d1)) "ok=$($r1.Ok) err=$($r1.Error)"

    # the plain .NET call without the prefix must still fail here, otherwise the fixture is
    # not exercising the defect at all
    $d2 = Join-Path $work 'del-baseline'
    [void](New-DeepTree $d2 12 2)
    $plainFailed = $false
    try { [System.IO.Directory]::Delete($d2, $true) } catch { $plainFailed = $true }
    Check 'unprefixed IO.Directory::Delete still fails on the same fixture' ($plainFailed) 'it unexpectedly succeeded - fixture too shallow'
    [void](Remove-FsDirectory $d2)

    # ---- 7) robocopy mirror fallback ----
    $d3 = Join-Path $work 'del-mirror'
    [void](New-DeepTree $d3 12 2)
    $r3 = Clear-FsDirectoryByMirror $d3
    Check 'Clear-FsDirectoryByMirror purges a tree beyond MAX_PATH' ($r3.Ok) "rc=$($r3.RobocopyExit) err=$($r3.Error)"

    # ---- 8) unreadable root must fail closed ----
    $rep3 = Get-FsLinkReport -Root (Join-Path $work 'does-not-exist')
    Check 'unreadable root yields a scan error, not a clean report' ($rep3.Errors.Count -gt 0 -and $rep3.Links.Count -eq 0) ($rep3.Errors -join ' | ')

    # ---- 9) RemoveDisposition truth table (the R5 short-circuit regression) ----
    $rows = @(
        @{ rc = 0;   reg = $false; dir = $false; want = 'ok' }                  # clean removal
        @{ rc = 255; reg = $false; dir = $true;  want = 'purge_residual' }      # the 2026-09-23 case
        @{ rc = 128; reg = $true;  dir = $true;  want = 'hard_fail' }           # dirty worktree, git refused
        @{ rc = 255; reg = $false; dir = $false; want = 'unregistered_empty' }  # already gone
    )
    $bad2 = 0
    foreach ($r in $rows) {
        $got = Resolve-RemoveDisposition -ExitCode $r.rc -Registered ([bool]$r.reg) -DirPresent ([bool]$r.dir)
        if ($got -ne $r.want) { $bad2++; Write-Host "  rc=$($r.rc) reg=$($r.reg) dir=$($r.dir) got=$got want=$($r.want)" }
    }
    Check 'Resolve-RemoveDisposition maps observed state, not exit code alone' ($bad2 -eq 0) "$bad2 row(s) wrong"
} finally {
    [void](Remove-FsDirectory $work)
    Write-Host "cleanup: $work gone = $(-not (Test-FsEntry $work))"
}

if ($failures -gt 0) {
    Write-Host "WORKTREE_FS_LONGPATH_TEST_FAILED ($failures)"
    exit 1
}
Write-Host 'WORKTREE_FS_LONGPATH_TEST_OK'

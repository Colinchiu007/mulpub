# Regression tests for scripts/worktree-fs-longpath.ps1
#
# Run under either shell - the file self-probes the running process's long-path capability
# (see Get-LongPathCapability) instead of assuming one:
#   pwsh       -NoProfile -ExecutionPolicy Bypass -File scripts\worktree-fs-longpath.test.ps1
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

# Probe: make ONE unprefixed CreateDirectory call on a path that certainly exceeds MAX_PATH.
# Success means this process may use long paths; a throw means it may not. We deliberately do
# not infer the answer from the registry or from a manifest - both have to be read, and reading
# them does not prove what applies to *this* process. Only the real out-of-bounds call is the
# referee. The registry value is still read and printed, purely so the log line is explainable.
# NOTE: comments in this file stay ASCII - it is BOM-less UTF-8, and Windows PowerShell 5.1
# decodes BOM-less UTF-8 as ANSI, so non-ASCII bytes here corrupt parsing (measured: ParserError).
function Get-LongPathCapability([string]$ProbeRoot) {
    $reg = 0
    try {
        $v = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -ErrorAction Stop).LongPathsEnabled
        if ($null -ne $v) { $reg = [int]$v }
    } catch { $reg = 0 }
    # same depth as section 6: 12 segments x 43 chars, always past 260
    $p = Join-Path $ProbeRoot 'cap-probe'
    for ($i = 0; $i -lt 12; $i++) { $p = $p + '\' + ('seg' + $i) + ('x' * 40) }
    $capable = $false
    $note = ''
    try { [void][System.IO.Directory]::CreateDirectory($p); $capable = $true } catch { $note = $_.Exception.GetType().Name }
    if ($capable) { [void](Remove-FsDirectory $p) }
    return [pscustomobject]@{ Registry = $reg; Capable = $capable; Depth = $p.Length; Note = $note }
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

    # Whether the UNPREFIXED recursive .NET delete can cross MAX_PATH depends on the process
    # running this test, not on the shell's name: it is governed by the LongPathsEnabled registry
    # value AND by whether this exe's manifest declares longPathAware (pwsh 7 does, Windows
    # PowerShell 5.1 does not), and .NET Framework 4.6.2+ adds the prefix itself once the OS
    # opt-in is on. Measured three environments, three outcomes: this machine under 5.1 fails,
    # this machine under pwsh 7 succeeds, and on the CI runner BOTH shells succeed
    # (run 36313053992 / step Gate 2d-b, shell: powershell 5.1). Hard-coding either expectation
    # therefore produces a false red in the other one, so we probe this process first:
    #   - process cannot take long paths  => the unprefixed delete MUST fail; that failure is
    #     what proves the fixture is deep enough for the positive control to mean anything
    #   - process can take long paths     => this cell cannot judge depth (section 2's
    #     depth>260 hard assertion does that instead); we only assert the outcome agrees with
    #     the probe, which still catches a genuinely anomalous environment (e.g. a held handle)
    # The triple is printed on every run so the next tuning has data instead of guesses.
    $cap = Get-LongPathCapability -ProbeRoot $work
    Write-Host ("  (probe) LongPathsEnabled={0} processCapable={1} sampleDepth={2} note={3}" -f $cap.Registry, $cap.Capable, $cap.Depth, $cap.Note)
    $d2 = Join-Path $work 'del-baseline'
    [void](New-DeepTree $d2 12 2)
    $plainFailed = $false
    try { [System.IO.Directory]::Delete($d2, $true) } catch { $plainFailed = $true }
    Write-Host ("  (probe) unprefixedDeleteFailed={0}" -f $plainFailed)
    if ($cap.Capable) {
        Check 'unprefixed delete outcome matches the probed process capability' (-not $plainFailed) 'probe said the process CAN take long paths, but the unprefixed delete failed'
    } else {
        Check 'unprefixed IO.Directory::Delete still fails on the same fixture' ($plainFailed) 'it unexpectedly succeeded - fixture too shallow'
    }
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
    # ---- 10) holder classification (the R4 argv blind-spot regression) ----
    $wtRoot = 'D:\Data\projects\mp-worktrees\mp-foo'
    $rowsP = @(
        [pscustomobject]@{ ProcessId = 100; Name = 'node.exe'; ParentProcessId = 101; ExecutablePath = 'C:\nodejs\node.exe'; CommandLine = 'node   "D:\Data\projects\mp-worktrees\mp-foo\node_modules\.bin\..\vitest\vitest.mjs" run' }
        [pscustomobject]@{ ProcessId = 101; Name = 'cmd.exe';   ParentProcessId = 0;   ExecutablePath = 'C:\Windows\System32\cmd.exe'; CommandLine = 'cmd /c powershell -File safe-worktree-remove.ps1 -Worktree D:\Data\projects\mp-worktrees\mp-foo' }
        [pscustomobject]@{ ProcessId = 999; Name = 'powershell.exe'; ParentProcessId = 101; ExecutablePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'; CommandLine = 'powershell -File safe-worktree-remove.ps1 -Worktree D:\Data\projects\mp-worktrees\mp-foo' }
        [pscustomobject]@{ ProcessId = 102; Name = 'esbuild.exe'; ParentProcessId = 100; ExecutablePath = 'D:\Data\projects\mp-worktrees\mp-foo\node_modules\@esbuild\win32-x64\esbuild.exe'; CommandLine = 'esbuild --service=0.0' }
        [pscustomobject]@{ ProcessId = 103; Name = 'node.exe'; ParentProcessId = 1; ExecutablePath = ''; CommandLine = 'node D:/Data/projects/mp-worktrees/mp-foo/scripts/x.js' }
        [pscustomobject]@{ ProcessId = 104; Name = 'node.exe'; ParentProcessId = 1; ExecutablePath = 'C:\nodejs\node.exe'; CommandLine = 'node D:\Data\projects\mp-worktrees\mp-foobar\y.js' }
        [pscustomobject]@{ ProcessId = 105; Name = 'chrome.exe'; ParentProcessId = 1; ExecutablePath = 'C:\Program Files\Google\Chrome\chrome.exe'; CommandLine = '--type=renderer' }
    )
    $ancesP = @(Resolve-ProcessAncestors -Processes $rowsP -SelfId 999)
    $splitP = Split-WorktreeHolders -Processes $rowsP -Worktree $wtRoot -SelfId 999 -AncestorIds $ancesP
    $holderIds = @($splitP.Holders.ProcessId)
    $killIds = @($splitP.KillList.ProcessId)
    Check 'the invoking script and its ancestors are never holders' (-not ($holderIds -contains 999) -and -not ($holderIds -contains 101)) ($holderIds -join ',')
    Check 'exe-outside + argv-inside is reported as a holder' ($holderIds -contains 100) ($holderIds -join ',')
    Check 'forward slashes in the command line still count as a reference' ($holderIds -contains 103) ($holderIds -join ',')
    Check 'a sibling worktree with a longer name is not matched by prefix' (-not ($holderIds -contains 104) -and -not ($killIds -contains 104)) 'false positive'
    Check 'an unrelated process is ignored entirely' (-not ($holderIds -contains 105)) 'noise'
    Check 'the esbuild living inside stays on the narrow stop list' ($killIds -contains 102) ($killIds -join ',')
    Check 'holder and stop lists are disjoint' (@(Compare-Object $holderIds $killIds -IncludeEqual -ExcludeDifferent).Count -eq 0) 'overlap'

    # ---- 11) Test-PathReferencedByLine boundary semantics ----
    Check 'a reference continuing below the root matches' (Test-PathReferencedByLine -CommandLine 'open D:\a\b\wt\file.txt' -Root 'D:\a\b\wt') ''
    Check 'a trailing separator on the root still matches' (Test-PathReferencedByLine -CommandLine 'D:\a\b\wt\x' -Root 'D:\a\b\wt\') ''
    Check 'a bare root reference matches' (Test-PathReferencedByLine -CommandLine 'remove D:\a\b\wt' -Root 'D:\a\b\wt') ''
    Check 'a longer sibling name must not match' (-not (Test-PathReferencedByLine -CommandLine 'D:\a\b\wt2\x' -Root 'D:\a\b\wt')) 'false positive'
    Check 'empty command line is never a reference' (-not (Test-PathReferencedByLine -CommandLine '' -Root 'D:\a\b\wt')) ''
    Check 'null command line is never a reference' (-not (Test-PathReferencedByLine -CommandLine $null -Root 'D:\a\b\wt')) ''

    # ---- 12/13/14) the 2026-10-14 blind spots: "dirty: 0" was not a measurement ----
    # Three defects are locked here, all of which produced a PASSING gate in front of a
    # 20 MB worktree: (a) `git status --porcelain` never lists ignored files; (b) the dirty
    # array collapsed to empty whenever the worktree was unregistered, so the -Confirm gate
    # could never fire in exactly the state that needs it; (c) R7 called any concurrent
    # baseline drift a cascade, which in this repo burns the signal to nothing.
    $secCount = 0
    function Check2([string]$name, [bool]$cond, [string]$detail) {
        $script:secCount++
        Check $name $cond $detail
    }
    # An exception inside a section must NOT silently drop the remaining assertions: the
    # harness only counts failures via Check, so a vanished section would otherwise print OK.
    try {
        $prereq = @('Get-WorktreeContent', 'Resolve-ContentDisposition', 'Resolve-DriftDisposition', 'Format-ContentSummary', 'Test-DriftCascadeSymbol') | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }
        Check2 'all five new predicates exist before their sections run' ($prereq.Count -eq 0) ('missing: ' + ($prereq -join ', '))

        # 12) content classification: "no content" vs "cannot tell" must be distinguishable
        $rowsC = @(
            @{ reg = $true;  lines = @();        tree = $true;  files = 0;    basis = 'measured-git' }
            @{ reg = $false; lines = $null;     tree = $true;  files = 4210; basis = 'measured-fs' }
            @{ reg = $true;  lines = $null;     tree = $true;  files = 5;    basis = 'measured-fs' }
            @{ reg = $false; lines = $null;     tree = $false; files = 0;    basis = 'unproven' }
            @{ reg = $true;  lines = @('');     tree = $true;  files = 0;    basis = 'measured-git' }
        )
        $badC = 0
        foreach ($r in $rowsC) {
            $c = Get-WorktreeContent -PorcelainLines $r.lines -Registered $r.reg -TreeEnumerated $r.tree -TopLevelEntries $r.files
            if ($c.Basis -ne $r.basis) { $badC++; Write-Host "  reg=$($r.reg) tree=$($r.tree) got=$($c.Basis) want=$($r.basis)" }
        }
        Check2 'Get-WorktreeContent separates measured from unproven' ($badC -eq 0) "$badC row(s) wrong"
        $mixed = Get-WorktreeContent -PorcelainLines @('?? untracked.js', '!! ignored.log', '!! build.log', 'M  tracked.js', ' D deleted.js', 'A  added.js', 'R  ren.js', 'UU conf.js', '') -Registered $true -TreeEnumerated $true -TopLevelEntries 99
        Check2 'ignored (!! entries) get their own tier instead of being folded into dirty' ($mixed.Ignored -eq 2) "ignored=$($mixed.Ignored)"
        Check2 'untracked (??) is its own tier' ($mixed.Untracked -eq 1) "untracked=$($mixed.Untracked)"
        Check2 'tracked-dirty covers M/D/A/R/U and excludes ?? and !!' ($mixed.TrackedDirty -eq 5) "tracked=$($mixed.TrackedDirty)"
        Check2 'a blank porcelain line is not content' ((Get-WorktreeContent -PorcelainLines @('') -Registered $true -TreeEnumerated $true -TopLevelEntries 0).TrackedDirty -eq 0 -and (Get-WorktreeContent -PorcelainLines @('') -Registered $true -TreeEnumerated $true -TopLevelEntries 0).Untracked -eq 0) 'blank line counted as content'
        $unreg = Get-WorktreeContent -PorcelainLines $null -Registered $false -TreeEnumerated $true -TopLevelEntries 4210
        $untrackedOnly = Get-WorktreeContent -PorcelainLines @('?? scratch.js') -Registered $true -TreeEnumerated $true -TopLevelEntries 1
        Check2 'unregistered never collapses into an empty git measurement' ($unreg.Basis -eq 'measured-fs' -and $unreg.GitMeasured -eq $false) "basis=$($unreg.Basis) gitMeasured=$($unreg.GitMeasured)"
        Check2 'fs-only mode still reports a size so the gate can refuse' ($unreg.TopLevelEntries -eq 4210) "files=$($unreg.TopLevelEntries)"

        # 2026-10-15 review round 3 (i3/i4): the ignored tier arrives from its OWN cheap probe
        # (`git status --porcelain --ignored`, default untracked mode, which collapses ignored
        # directories), because `--untracked-files=all --ignored` was measured to emit
        # 55,191 lines on a task worktree and 127,654 on the shared root - the guard would pay
        # that recursion on every removal. So the count is ENTRIES, and it must distinguish
        # "probed and empty" from "probe never answered" - printing 0 for the latter would
        # recreate, inside the new code, the exact "constructed zero" this change removes.
        $pr3 = Get-WorktreeContent -PorcelainLines @() -Registered $true -TreeEnumerated $true -TopLevelEntries 0 -IgnoredProbeLines @('!! node_modules/', '!! dist/', '!! a.log')
        Check2 'the ignored probe counts collapsed entries and marks them known' ($pr3.Ignored -eq 3 -and $pr3.IgnoredKnown) "ignored=$($pr3.Ignored) known=$($pr3.IgnoredKnown)"
        $emptyProbe = Get-WorktreeContent -PorcelainLines @() -Registered $true -TreeEnumerated $true -TopLevelEntries 0 -IgnoredProbeLines @()
        Check2 'an answered-but-empty probe is a measurement of zero' ($emptyProbe.Ignored -eq 0 -and $emptyProbe.IgnoredKnown) "known=$($emptyProbe.IgnoredKnown)"
        $noProbe = Get-WorktreeContent -PorcelainLines @() -Registered $true -TreeEnumerated $true -TopLevelEntries 0 -IgnoredProbeLines $null
        Check2 'a failed ignored probe reads as unknown, never as a clean zero' ((-not $noProbe.IgnoredKnown) -and $noProbe.Ignored -eq 0) "known=$($noProbe.IgnoredKnown) ignored=$($noProbe.Ignored)"
        $fsIgn = Get-WorktreeContent -PorcelainLines $null -Registered $false -TreeEnumerated $true -TopLevelEntries 5 -IgnoredProbeLines $null
        Check2 'a non-git basis leaves the ignored tier unknown rather than clean' ((-not $fsIgn.IgnoredKnown) -and $fsIgn.Ignored -eq 0) "known=$($fsIgn.IgnoredKnown)"

        # 13) the gate matrix, as a pure mapping (no filesystem involved)
        $cleanC = Get-WorktreeContent -PorcelainLines @() -Registered $true -TreeEnumerated $true -TopLevelEntries 0
        $dirtyC = Get-WorktreeContent -PorcelainLines @('M  x.js') -Registered $true -TreeEnumerated $true -TopLevelEntries 1
        $bigIg  = Get-WorktreeContent -PorcelainLines @('!! big.log') -Registered $true -TreeEnumerated $true -TopLevelEntries 1
        $smallIg = Get-WorktreeContent -PorcelainLines @('!! small.log') -Registered $true -TreeEnumerated $true -TopLevelEntries 1
        $fsOnly = Get-WorktreeContent -PorcelainLines $null -Registered $false -TreeEnumerated $true -TopLevelEntries 4210
        $blind  = Get-WorktreeContent -PorcelainLines $null -Registered $false -TreeEnumerated $false -TopLevelEntries 0
        # Signature after the decision-layer review correction (2026-10-15): there is no byte
        # budget any more. Ignored VOLUME must not block - node_modules is ignored and always
        # huge, so a volume gate would fire on every removal and push callers toward -Force.
        # The rows below assert exactly that, plus the contract that remains real:
        # unmeasurable content blocks, and unproven cannot be signed off.
        $rowsD = @(
            @{ c = $cleanC;        conf = $false; want = 'ok' }
            @{ c = $dirtyC;        conf = $false; want = 'confirm_required' }
            @{ c = $dirtyC;        conf = $true;  want = 'ok' }
            @{ c = $bigIg;         conf = $false; want = 'ok' }
            @{ c = $smallIg;       conf = $false; want = 'ok' }
            @{ c = $fsOnly;        conf = $false; want = 'confirm_required' }
            @{ c = $fsOnly;        conf = $true;  want = 'ok' }
            @{ c = $blind;         conf = $true;  want = 'unproven' }
            @{ c = $untrackedOnly; conf = $false; want = 'confirm_required' }
        )
        $badD = 0
        foreach ($r in $rowsD) {
            $got = Resolve-ContentDisposition -Content $r.c -Confirmed $r.conf
            if ($got -ne $r.want) { $badD++; Write-Host "  basis=$($r.c.Basis) ign=$($r.ign) conf=$($r.conf) got=$got want=$($r.want)" }
        }
        Check2 'Resolve-ContentDisposition blocks on measurability, never on ignored volume' ($badD -eq 0) "$badD row(s) wrong"

        # 14) R7 drift classification
        $rowsR = @(
            @{ new = @();                                                   want = 'clean' }
            @{ new = @('M  .quality-gates.md');                             want = 'benign_drift' }
            @{ new = @('A  openspec/records/x.md', 'M  CHANGELOG.md');      want = 'benign_drift' }
            @{ new = @('?? .ccg/reviews/abc.json');                         want = 'benign_drift' }
            @{ new = @(' M apps/desktop/electron/main.js');                 want = 'benign_drift' }
            @{ new = @('R  x.js -> y.js');                                  want = 'benign_drift' }
            @{ new = @(' D apps/desktop/package.json');                     want = 'cascade' }
            @{ new = @('M  ok.js', ' D missing.js');                        want = 'cascade' }
            @{ new = @('DU both.js');                                       want = 'cascade' }
            @{ new = @('UD both.js');                                       want = 'cascade' }
        )
        $badR = 0
        foreach ($r in $rowsR) {
            $got = Resolve-DriftDisposition -NewEntries $r.new
            if ($got -ne $r.want) { $badR++; Write-Host "  entries=[$($r.new -join ', ')] got=$got want=$($r.want)" }
        }
        Check2 'Resolve-DriftDisposition calls a cascade only on D/U symbols' ($badR -eq 0) "$badR row(s) wrong"
        Check2 'concurrent staging reads as drift, not damage' ((Resolve-DriftDisposition -NewEntries @('A  .ccg/reviews/04f4c269731d7a9b7345bbb0a8fba6f4d105e28c.json')) -eq 'benign_drift') 'mislabelled as cascade'
        Check2 'any deletion in main stays a hard failure' ((Resolve-DriftDisposition -NewEntries @('M  x', 'D  y')) -eq 'cascade') 'gate weakened'

        # 15) real-git fixture for the ignored tier (closes tasks 2.6 / 6.6 for this口径).
        # Pure-mapping rows above cannot prove that `git status --porcelain -uall` really
        # omits ignored files, or that plain `--ignored` really reports them - that claim is
        # about git's behaviour, so it must be run against git. Repo is unborn on purpose:
        # `git add` + a working tree is enough for status, and no commit identity is needed.
        # git absence is a NAMED failure, never a silent skip (a skipped lock reads as a pass).
        $gitCmd = Get-Command git -ErrorAction SilentlyContinue
        Check2 'git is available for the real-git fixture (absence must be loud, not skipped)' ($null -ne $gitCmd) 'git not on PATH'
        $gr = Join-Path $env:TEMP ('wtfslp-git-' + [guid]::NewGuid().ToString('N'))
        [void](New-Item -ItemType Directory -Force -Path (Join-Path $gr 'ignored'))
        [System.IO.File]::WriteAllText((Join-Path $gr '.gitignore'), "ignored/`nskip.log`n", [System.Text.UTF8Encoding]::new($false))
        [System.IO.File]::WriteAllText((Join-Path $gr 'tracked.js'), 'v1', [System.Text.UTF8Encoding]::new($false))
        [System.IO.File]::WriteAllText((Join-Path $gr 'ignored/blob.txt'), 'x', [System.Text.UTF8Encoding]::new($false))
        [System.IO.File]::WriteAllText((Join-Path $gr 'skip.log'), 'x', [System.Text.UTF8Encoding]::new($false))
        [System.IO.File]::WriteAllText((Join-Path $gr 'scratch.js'), 'x', [System.Text.UTF8Encoding]::new($false))
        [void](& git -C $gr init -q 2>&1)
        [void](& git -C $gr add tracked.js 2>&1)
        [System.IO.File]::WriteAllText((Join-Path $gr 'tracked.js'), 'v2', [System.Text.UTF8Encoding]::new($false))
        $gateOut = @(& git -C $gr status --porcelain --untracked-files=all 2>$null)
        $probeOut = @(& git -C $gr status --porcelain --ignored 2>$null)
        $gitOk = ($LASTEXITCODE -eq 0)
        Check2 'the gate call really does not list ignored content (the original blind spot)' `
            (@($gateOut | Where-Object { "$_" -like '*ignored/blob.txt*' -or "$_" -like '*skip.log*' }).Count -eq 0) `
            ('gate output listed ignored: ' + (($gateOut | Where-Object { "$_" -like '*.log*' -or "$_" -like 'ignored/*' }) -join ','))
        # Collapsing is the point: plain --ignored reports `!! ignored/` (ONE entry for a
        # directory of files), which is exactly why this probe costs 10-80 lines instead of
        # the 55,191 that `-uall --ignored` emits. Note the patterns: `-like '!! ignored/*'`
        # ALSO matches the collapsed line itself (the `*` matches empty), which is what a
        # first version of this assertion got wrong - children must be matched with `?*`.
        $probeHits = @($probeOut | Where-Object { ("$_" -like '*ignored*') -or ("$_" -like '*skip.log*') }).Count
        Check2 'the ignored probe really reports the ignored files (positive half of the blind spot)' ($gitOk -and $probeHits -ge 2) ("probeLines=$(@($probeOut).Count) hits=$probeHits gitOk=$gitOk")
        $collapsed = @($probeOut | Where-Object { "$_" -eq '!! ignored/' }).Count
        $expanded = @($probeOut | Where-Object { "$_" -like '!! ignored/?*' }).Count
        Check2 'the probe really collapses an ignored directory into one entry (the cost argument)' `
            ($collapsed -eq 1 -and $expanded -eq 0) ("collapsed=$collapsed expanded=$expanded")
        $rc15 = Get-WorktreeContent -PorcelainLines $gateOut -IgnoredProbeLines $probeOut -Registered $true -TreeEnumerated $true -TopLevelEntries 0
        Check2 'real-git tiers: trackedDirty/untracked/ignored all measured independently' `
            ($rc15.TrackedDirty -ge 1 -and $rc15.Untracked -ge 1 -and $rc15.Ignored -ge 1 -and $rc15.IgnoredKnown) `
            ("tracked=$($rc15.TrackedDirty) untracked=$($rc15.Untracked) ignored=$($rc15.Ignored) known=$($rc15.IgnoredKnown)")
        Check2 'real-git gate: untracked content demands confirmation, and confirming satisfies it' `
            ((Resolve-ContentDisposition -Content $rc15 -Confirmed $false) -eq 'confirm_required' -and (Resolve-ContentDisposition -Content $rc15 -Confirmed $true) -eq 'ok') ''

        # 16) the PRINT surface, also a pure function (round-2 review i4: the change exists
        # because a printed "dirty: 0" was read as "nothing here" when it meant "nothing
        # measured" - so a bare zero in the summary line for a non-git basis is the same bug
        # wearing new clothes, and it must be locked, not promised).
        $sGit = Format-ContentSummary $mixed
        Check2 'measured-git prints the real numbers and names the unit' `
            ($sGit -match 'trackedDirty=5' -and $sGit -match 'untracked=1' -and $sGit -match '2 entries') "got=$sGit"
        $sFs = Format-ContentSummary $unreg
        Check2 'measured-fs prints n/a for the git tiers, never a bare 0' `
            ($sFs -match 'trackedDirty=n/a' -and -not ($sFs -match 'trackedDirty=0')) "got=$sFs"
        # QM-6 F2: n/a alone is not enough - the refusal must carry the number that triggered
        # it, otherwise the operator reading only the BLOCKED line sees three unknowns and no
        # reason to sign off.
        Check2 'measured-fs summary carries the entry count that triggers the gate' ($sFs -match 'topLevelEntries=4210') "got=$sFs"
        # QM-6 F4: with no git answer there is nothing to count - the tier must stay at 0 AND
        # be flagged unknown, never silently filled from a probe the caller may still pass.
        Check2 'a non-git basis never fills the ignored tier even if probe lines are supplied' `
            ((Get-WorktreeContent -PorcelainLines $null -IgnoredProbeLines @('!! a/', '!! b/') -Registered $false -TreeEnumerated $true -TopLevelEntries 3).Ignored -eq 0) 'ignored populated without git'
        $sBlind = Format-ContentSummary $blind
        Check2 'unproven prints n/a on all three tiers (no number is a measurement here)' `
            ($sBlind -match 'trackedDirty=n/a' -and $sBlind -match 'untracked=n/a' -and $sBlind -match 'ignored=n/a') "got=$sBlind"

        # 17) precedence of the refusals is a property of the script BODY, so it is locked
        # against the source of safe-worktree-remove.ps1. Only statements are counted
        # (^\s*exit N\s*$): the docblock and the "would REFUSE ... -> exit 9" preview strings
        # both contain the same words, and a lock that matches comments proves nothing -
        # a comment can say anything while the code does the opposite.
        $guardPath = Join-Path $here 'safe-worktree-remove.ps1'
        $glines = @(Get-Content -LiteralPath $guardPath)
        Check2 'the guard source is readable by this lock (absence must be loud, not skipped)' ($glines.Count -gt 100) ("lines=$($glines.Count)")
        $i10 = @(0..($glines.Count - 1) | Where-Object { $glines[$_] -match '^\s*exit 10\s*$' })
        $i4 = @(0..($glines.Count - 1) | Where-Object { $glines[$_] -match '^\s*exit 4\s*$' })
        $iKill = @(0..($glines.Count - 1) | Where-Object { $glines[$_] -match 'Stop-Process' })
        Check2 'unproven refuses before the tree can be touched, and never after a kill has been attempted' `
            ($i10.Count -eq 1 -and $iKill.Count -ge 1 -and $i10[0] -lt $iKill[0]) `
            ("exit10=$($i10 -join ',') firstKill=$($iKill[0])")
        Check2 'the content gate (exit 4) is evaluated ahead of the holder gate' `
            ($i4.Count -ge 1 -and $iKill.Count -ge 1 -and $i4[0] -lt $iKill[0]) ("exit4=$($i4 -join ',')")
        [void](Remove-FsDirectory $gr)
    } catch {
        Write-Host "FAIL sections 12-14 aborted: $($_.Exception.Message)"
        $script:failures++
    }
    # anti-blindness: a section that vanished mid-way must not read as a pass
    # 30 is the exact number of Check2 calls in sections 12-17; raise it only with the block.
    Check 'sections 12-17 executed every one of their 30 assertions' ($secCount -eq 30) "ran=$secCount"
} finally {
    [void](Remove-FsDirectory $work)
    Write-Host "cleanup: $work gone = $(-not (Test-FsEntry $work))"
}

if ($failures -gt 0) {
    Write-Host "WORKTREE_FS_LONGPATH_TEST_FAILED ($failures)"
    exit 1
}
Write-Host 'WORKTREE_FS_LONGPATH_TEST_OK'

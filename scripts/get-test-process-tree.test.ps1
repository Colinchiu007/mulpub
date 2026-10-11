# Regression tests for scripts/get-test-process-tree.ps1
#
# Scope: the PID-reuse guard. The CI call sites (Gate 4 / Desktop shards) feed the result
# straight into `taskkill /T /F`, so a false positive is not just a red check - it aims a
# force-kill at OS-critical processes. Measured on run 36519025075 attempt 1: all 12517 tests
# passed, yet the walk reported csrss.exe / winlogon.exe / fontdrvhost.exe / dwm.exe as leaked
# test children, because the root pnpm PID had been recycled and those boot-time processes
# record that number as their ParentProcessId.
#
# Everything here runs against an injected process table, so it is deterministic and touches no
# real process. Case 6 is the anti-blindness assertion: with the guard switched off the SAME
# fixture must reproduce the false positive, otherwise the fixture proves nothing.
#
# Comments stay ASCII: BOM-less UTF-8 .ps1 files are decoded as ANSI by Windows PowerShell 5.1.
#
#   pwsh       -NoProfile -ExecutionPolicy Bypass -File scripts/get-test-process-tree.test.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/get-test-process-tree.test.ps1

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$lib = Join-Path $here 'get-test-process-tree.ps1'
if (-not (Test-Path -LiteralPath $lib)) { throw "library missing: $lib" }
. $lib

$passed = 0
function Check([bool]$cond, [string]$name, [string]$detail) {
    if ($cond) { Write-Host "PASS $name"; $script:passed++ }
    else { Write-Host "FAIL $name  $detail"; throw "FAIL: $name" }
}

# $Created stays untyped on purpose: case 5 must be able to hand the library a null
# CreationDate, and a [datetime] constraint would reject it in the fixture instead of
# letting the library prove it fails loudly.
function P([int]$Id, [int]$Parent, [string]$Name, $Created) {
    [pscustomobject]@{ ProcessId = $Id; ParentProcessId = $Parent; Name = $Name; CreationDate = $Created }
}

# The incident shape, pinned to absolute times so no clock can drift between cases.
$launch = Get-Date '2026-09-29T04:00:00'
$boot = Get-Date '2026-09-29T03:00:00'
$rootPid = 6556

$bootTree = @(
    (P 6548 $rootPid 'csrss.exe' $boot),
    (P 6064 $rootPid 'winlogon.exe' $boot),
    (P 6864 6064 'fontdrvhost.exe' $boot),
    (P 7004 6064 'dwm.exe' $boot)
)
$leakedTree = @(
    (P 9001 $rootPid 'node.exe' (Get-Date '2026-09-29T04:05:00')),
    (P 9002 9001 'electron.exe' (Get-Date '2026-09-29T04:06:00'))
)

function IdsOf($rows) { (@($rows | ForEach-Object { [int]$_.ProcessId }) | Sort-Object) -join ',' }

# --- 1: boot-time processes must never be reported as descendants of a recycled PID --------
$r = @(Get-TestProcessTree -RootProcessId $rootPid -NotBefore $launch -Processes $bootTree)
Check ($r.Count -eq 0) 'guard rejects boot-time processes' "got=$(IdsOf $r)"

# --- 2: a genuine leaked child (and its own child) must still be caught --------------------
$r = @(Get-TestProcessTree -RootProcessId $rootPid -NotBefore $launch -Processes $leakedTree)
Check ((IdsOf $r) -eq '9001,9002') 'guard keeps real leaked descendants' "got=$(IdsOf $r)"

# --- 3: mixed table - the incident plus a genuine leak - only the leak is reported ----------
$mixed = @($bootTree) + @($leakedTree)
$r = @(Get-TestProcessTree -RootProcessId $rootPid -NotBefore $launch -Processes $mixed)
Check ((IdsOf $r) -eq '9001,9002') 'mixed table reports only the leak' "got=$(IdsOf $r)"

# --- 4: the root itself stays in the result while it is alive (old behaviour preserved) -----
$table = @(P $rootPid 1 'pnpm.exe' $launch) + @($bootTree)
$r = @(Get-TestProcessTree -RootProcessId $rootPid -NotBefore $launch -Processes $table)
Check ((IdsOf $r) -eq "$rootPid") 'alive root is still reported' "got=$(IdsOf $r)"

# --- 5: an unparsable CreationDate must fail loudly, never silently pass -------------------
$broken = @(P 9100 $rootPid 'node.exe' $null)
$threw = $false
try { $null = @(Get-TestProcessTree -RootProcessId $rootPid -NotBefore $launch -Processes $broken) }
catch { $threw = $true }
Check $threw 'missing CreationDate throws (no silent pass)' 'returned without error'

# --- 6: anti-blindness - with the guard off, this very fixture DOES misfire ----------------
# Default -NotBefore is [datetime]::MinValue, i.e. the pre-fix behaviour. If this case ever
# returns 0, the fixture has stopped exercising the bug and cases 1-3 prove nothing.
$r = @(Get-TestProcessTree -RootProcessId $rootPid -Processes $bootTree)
Check ((IdsOf $r) -eq '6064,6548,6864,7004') 'fixture reproduces the pre-fix false positive' "got=$(IdsOf $r)"

# --- 7: a cycle must not hang the walk (each pid is expanded at most once) -----------------
$a = P 9201 $rootPid 'a.exe' (Get-Date '2026-09-29T04:01:00')
$b = P 9202 9201 'b.exe' (Get-Date '2026-09-29T04:01:00')
$cyclic = @($a, $b, (P 9201 9202 'a.exe' (Get-Date '2026-09-29T04:01:00')))
$r = @(Get-TestProcessTree -RootProcessId $rootPid -NotBefore $launch -Processes $cyclic)
Check ($r.Count -le 2) 'cycle terminates instead of hanging' "got=$(IdsOf $r)"

# --- 8: end-to-end against the REAL CIM path ----------------------------------------------
# Cases 1-7 inject a table, so they cannot catch the one thing that would make the guard
# silently useless: Win32_Process.CreationDate not comparing correctly against a local
# Get-Date (e.g. a UTC/local mismatch would reject *everything* and the gate would read green
# forever). Spawn a genuine child of this process and require it to show up.
$mark = Get-Date
$child = Start-Process -FilePath (Get-Process -Id $PID).Path `
    -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 20' -PassThru
try {
    Start-Sleep -Seconds 2
    $r = @(Get-TestProcessTree -RootProcessId $PID -NotBefore $mark)
    $found = @($r | Where-Object { [int]$_.ProcessId -eq [int]$child.Id }).Count
    Check ($found -eq 1) 'real CIM path finds a live child' `
        ("child=$($child.Id) returned=$(IdsOf $r) mark=$($mark.ToString('o'))")
} finally {
    # Always reap the process this test started, pass or fail: otherwise it becomes the
    # "leftover child process" some other run's gate reports.
    try { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue } catch { }
}

# --- 9: the attribution column - command line must reach the log ---------------------------
# Why these three cases exist: on 2026-10-11 Gate 4 burned its full 30-minute budget and the
# printed table was 13 rows of `node.exe` with near-identical working sets. Format-Table picks
# the Win3_Process default column set, and CommandLine is NOT in it, so the log could not say
# which package was still running. These cases pin the projection that fixes that.
function PC([int]$Id, [int]$Parent, [string]$Name, $Created, [string]$Cmd) {
    [pscustomobject]@{ ProcessId = $Id; ParentProcessId = $Parent; Name = $Name; CreationDate = $Created; CommandLine = $Cmd }
}

$noisy = "node  apps/desktop/vitest.mjs`r`n run --dir ."
$line9 = Format-TestProcessTreeLine -Process (PC 9100 $rootPid 'node.exe' $launch $noisy)
Check ($line9.Contains('pid=9100') -and $line9.Contains('parent=6556') -and $line9.Contains('node.exe :: node apps/desktop/vitest.mjs run --dir .')) `
    'detail line carries the command line with whitespace folded' $line9
Check (-not $line9.Contains("`r") -and -not $line9.Contains("`n")) 'detail line is single-line (grep-able in CI logs)' $line9

# --- 10: unreadable command line must be said out loud, never left blank -------------------
$line10a = Format-TestProcessTreeLine -Process (PC 9101 $rootPid 'node.exe' $launch '   ')
Check ($line10a.Contains(':: <unreadable>')) 'blank CommandLine projects as <unreadable>, not empty' $line10a
# The OLD fixture shape (no CommandLine property at all) must not throw and must say the same.
$line10b = Format-TestProcessTreeLine -Process (P 9102 $rootPid 'node.exe' $launch)
Check ($line10b.Contains(':: <unreadable>')) 'missing CommandLine property projects as <unreadable>' $line10b
$line10c = Format-TestProcessTreeLine -Process (P 9103 0 'cmd.exe' $launch)
Check ($line10c.Contains('parent=0')) 'parent pid is reported when present' $line10c
$orphan = [pscustomobject]@{ ProcessId = 9104; Name = 'node.exe' }
$line10d = Format-TestProcessTreeLine -Process $orphan
Check ($line10d.Contains('parent=<unknown>')) 'absent ParentProcessId says <unknown> instead of 0' $line10d

# --- 11: truncation keeps one row per process ----------------------------------------------
# MaxCmdLen bounds the command FIELD (the 'node ' prefix counts toward it), so the expected
# tail must be derived from the same string rather than hand-counted. A first version of this
# case asserted x*50 and failed on len=108: the implementation was right, the arithmetic was not.
$long = 'node ' + ('x' * 400)
$line11 = Format-TestProcessTreeLine -Process (PC 9105 $rootPid 'node.exe' $launch $long) -MaxCmdLen 50
Check ($line11.EndsWith($long.Substring(0, 50) + '...')) 'long command line is truncated to MaxCmdLen' ("tail=" + $line11.Substring($line11.Length - 12))
Check (-not $line11.Contains($long.Substring(0, 60))) 'nothing beyond MaxCmdLen leaks into the log' $line11

# --- 12: an empty tree must still print (silence is not evidence) ---------------------------
# Write-Host goes to the information stream (6); 6>&1 is how both 5.1 and 7 let a test read it.
$printed = @((Write-TestProcessTreeDetail -Processes @()) 6>&1 | ForEach-Object { [string] $_ })
Check ($printed.Count -eq 1 -and $printed[0].Contains('rows=0')) 'empty tree prints rows=0 instead of nothing' ($printed -join '|')
$two = @(Get-TestProcessTree -RootProcessId $rootPid -NotBefore $launch -Processes $leakedTree)
$printed2 = @((Write-TestProcessTreeDetail -Processes $two) 6>&1 | ForEach-Object { [string] $_ })
Check ($printed2.Count -eq 3 -and $printed2[0].Contains('rows=2') -and $printed2[1].Contains('pid=9001') -and $printed2[2].Contains('pid=9002')) `
    'detail prints one line per row after the count line' ($printed2 -join '|')

Write-Host "OK: $passed checks passed"

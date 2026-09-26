# Regression test for the hook-comparison semantics in mp-worktree-health.ps1.
#
# Locks both directions:
#   positive - an installed hook may carry a trailing third-party block
#              (IDE-injected tracker) and must still satisfy -RequireHooks
#   negative - rewriting, prepending to, or deleting the authoritative hook body
#              must still fail -RequireHooks (containment must not weaken detection)
#
# Note on encoding: all fixture writes go through [IO.File] bytes. Set-Content and
# Add-Content with -Encoding UTF8 emit a BOM under Windows PowerShell 5.1, which would
# make the installed hook differ from the (BOM-less) authoritative source and turn a
# green suite red for reasons unrelated to the logic under test.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/mp-worktree-health.test.ps1
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$health = Join-Path $root 'scripts/mp-worktree-health.ps1'
if (-not (Test-Path -LiteralPath $health)) { throw "health script missing: $health" }
foreach ($h in @('pre-commit', 'post-checkout')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root "scripts/hooks/$h"))) { throw "fixture source missing: scripts/hooks/$h" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('mp-health-test-' + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $tmp 'repo'
New-Item -ItemType Directory -Force -Path $repo | Out-Null
$env:GIT_AUTHOR_NAME = 'Health Hook Test'
$env:GIT_AUTHOR_EMAIL = 'health@test.local'
$env:GIT_COMMITTER_NAME = 'Health Hook Test'
$env:GIT_COMMITTER_EMAIL = 'health@test.local'
$passed = 0
$failed = 0

function Assert([bool]$condition, [string]$message) {
    if ($condition) { $script:passed++; Write-Host "PASS: $message" }
    else { $script:failed++; Write-Host "FAIL: $message" }
}
function Write-Bytes([string]$path, [byte[]]$bytes) { [IO.File]::WriteAllBytes($path, $bytes) }
function Read-Bytes([string]$path) { [IO.File]::ReadAllBytes($path) }
function Text([string]$s) { [Text.Encoding]::UTF8.GetBytes($s) }
function Concat([byte[]]$a, [byte[]]$b) {
    $out = New-Object byte[] ($a.Length + $b.Length)
    [Array]::Copy($a, 0, $out, 0, $a.Length)
    [Array]::Copy($b, 0, $out, $a.Length, $b.Length)
    return ,$out
}

function Invoke-Health([string]$script, [string]$reportName) {
    $report = Join-Path $tmp ($reportName + '.json')
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Root $repo -RequireHooks -ReportPath $report -Quiet | Out-Null
    $rc = $LASTEXITCODE
    $json = $null
    if (Test-Path -LiteralPath $report) { $json = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json }
    return @{ rc = $rc; report = $json }
}
function HookOf($report, [string]$name) { return @($report.hooks | Where-Object { $_.name -eq $name })[0] }

$tracker = "`n# BEGIN Third-party tracker`nprevious_head=`"`$1`"`n# END Third-party tracker`n"

try {
    Push-Location $repo
    & git init -q -b main
    Pop-Location

    New-Item -ItemType Directory -Force -Path (Join-Path $repo 'scripts/hooks') | Out-Null
    foreach ($h in @('pre-commit', 'post-checkout')) {
        $src = Read-Bytes (Join-Path $root "scripts/hooks/$h")
        Write-Bytes (Join-Path $repo "scripts/hooks/$h") $src
        Write-Bytes (Join-Path $repo ".git/hooks/$h") $src
    }

    # case 1: byte-identical install satisfies the gate
    $r = Invoke-Health $health 'case1'
    Assert ($r.rc -eq 0) 'identical installed hooks satisfy -RequireHooks'
    $pc = HookOf $r.report 'post-checkout'
    Assert ($pc.match -eq $true -and $pc.identical -eq $true -and $pc.appendedBytes -eq 0) 'identical hook reports match/identical with zero appended bytes'

    # case 2: trailing third-party block is tolerated (the Qoder tracker shape)
    $orig = Read-Bytes (Join-Path $repo 'scripts/hooks/post-checkout')
    Write-Bytes (Join-Path $repo '.git/hooks/post-checkout') (Concat $orig (Text $tracker))
    $r = Invoke-Health $health 'case2'
    Assert ($r.rc -eq 0) 'installed hook with a trailing third-party block still satisfies -RequireHooks'
    $pc = HookOf $r.report 'post-checkout'
    Assert ($pc.match -eq $true) 'appended hook keeps match=true'
    Assert ($pc.identical -eq $false) 'appended hook reports identical=false'
    Assert ($pc.appendedBytes -eq ([Text.Encoding]::UTF8.GetByteCount($tracker))) ('appended hook reports the exact appended byte count (got ' + $pc.appendedBytes + ')')

    # case 3: rewriting the authoritative body is still detected
    $tampered = Concat (Text ("# NEUTERED`n")) $orig
    Write-Bytes (Join-Path $repo '.git/hooks/post-checkout') $tampered
    $r = Invoke-Health $health 'case3'
    Assert ($r.rc -ne 0) 'rewritten hook body still fails -RequireHooks'
    Assert ((HookOf $r.report 'post-checkout').match -eq $false) 'rewritten hook body reports match=false'

    # case 4: body intact but a foreign block prepended -> rejected
    Write-Bytes (Join-Path $repo '.git/hooks/post-checkout') (Concat (Text ("# FOREIGN PREPEND`n")) $orig)
    $r = Invoke-Health $health 'case4'
    Assert ($r.rc -ne 0) 'prepended foreign block before the hook body fails -RequireHooks'

    # case 5: installed hook missing entirely -> rejected
    Remove-Item -LiteralPath (Join-Path $repo '.git/hooks/post-checkout') -Force
    $r = Invoke-Health $health 'case5'
    Assert ($r.rc -ne 0) 'missing installed hook fails -RequireHooks'
    Assert ((HookOf $r.report 'post-checkout').installedExists -eq $false) 'missing installed hook reports installedExists=false'

    Write-Host ''
    if ($failed -eq 0) {
        Write-Host "PASS: $passed mp-worktree-health hook checks" -ForegroundColor Green
        exit 0
    }
    Write-Host "FAILED: $failed of $($passed + $failed) mp-worktree-health hook checks" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

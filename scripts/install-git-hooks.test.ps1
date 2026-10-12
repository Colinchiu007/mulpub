# Regression test for scripts/install-git-hooks.ps1
#
# Why this file exists: install-git-hooks.ps1 is the only thing that carries the
# authoritative hook bodies from scripts/hooks/ into $GIT_COMMON_DIR/hooks, and it is
# invoked automatically by start-mp-task.ps1 at every task start. Before this lock it had
# no test at all: a broken source glob, a lost -Force, or a relative common-dir
# resolution would have removed the branch guard and the review-record auto-staging
# silently, because CI never installs hooks and no required check looked at this script.
#
# Locked behaviours (each case fails for its own reason):
#   1 installs every non-test source file byte-for-byte, into the shared common dir
#   2 skips *.test.* files so test fixtures never become live hooks
#   3 overwrites a stale/corrupted installed hook (no -Force would leave it in place)
#   4 exits non-zero when scripts/hooks is missing, without installing anything
#   5 a reinstall removes a third-party appended tail, restoring the authoritative body
#   6 running from a repository subdirectory still targets the absolute common dir
#
# Encoding: every fixture write goes through [IO.File] bytes; Set-Content -Encoding UTF8
# adds a BOM under Windows PowerShell 5.1 and would make installed bytes differ from the
# BOM-less authoritative source for reasons unrelated to the logic under test.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/install-git-hooks.test.ps1
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installer = Join-Path $root 'scripts/install-git-hooks.ps1'
if (-not (Test-Path -LiteralPath $installer)) { throw "installer missing: $installer" }

foreach ($h in @('pre-commit', 'post-checkout')) {
    $srcPath = Join-Path $root "scripts/hooks/$h"
    if (-not (Test-Path -LiteralPath $srcPath)) { throw "authoritative hook missing: scripts/hooks/$h" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('mp-install-hooks-test-' + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $tmp 'repo'
New-Item -ItemType Directory -Force -Path $repo | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $repo 'scripts/hooks') | Out-Null

$env:GIT_AUTHOR_NAME = 'Install Hooks Test'
$env:GIT_AUTHOR_EMAIL = 'hooks@test.local'
$env:GIT_COMMITTER_NAME = 'Install Hooks Test'
$env:GIT_COMMITTER_EMAIL = 'hooks@test.local'

$passed = 0
$failed = 0
function Assert([bool]$condition, [string]$message) {
    if ($condition) { $script:passed++; Write-Host "PASS: $message" }
    else { $script:failed++; Write-Host "FAIL: $message" }
}
function Write-Text([string]$path, [string]$text) { [IO.File]::WriteAllBytes($path, [Text.Encoding]::UTF8.GetBytes($text)) }
function Read-Bytes([string]$path) { return [IO.File]::ReadAllBytes($path) }
function Same-Bytes([string]$a, [string]$b) {
    if (-not (Test-Path -LiteralPath $a) -or -not (Test-Path -LiteralPath $b)) { return $false }
    $ba = Read-Bytes $a
    $bb = Read-Bytes $b
    if ($ba.Length -ne $bb.Length) { return $false }
    for ($i = 0; $i -lt $ba.Length; $i++) { if ($ba[$i] -ne $bb[$i]) { return $false } }
    return $true
}
function Delete-File([string]$path) {
    if (Test-Path -LiteralPath $path) { [IO.File]::Delete($path) }
}
# git and powershell.exe write progress to stderr even on SUCCESS. Under
# $ErrorActionPreference='Stop' a `2>&1` capture turns that benign output into a
# terminating NativeCommandError (documented repo trap, hit by start-mp-task.ps1 and by
# session-write-guard.test.ps1). So relax the preference only for the capture window and
# always judge by the exit code, never by the stream.
function Invoke-Native([scriptblock]$block) {
    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $block 2>&1 | Out-Null
        return $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $saved }
}
function Common-Dir([string]$r) {
    $c = (& git -C $r rev-parse --path-format=absolute --git-common-dir 2>$null)
    if (-not $c) { throw "cannot resolve common dir for $r" }
    return $c.Trim()
}
function Invoke-Installer([string]$cwdDir) {
    # The installer resolves the repository from the current directory, exactly like
    # start-mp-task.ps1 invoking it through powershell.exe (Windows PowerShell 5.1).
    Push-Location -LiteralPath $cwdDir
    try {
        $rc = Invoke-Native { & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer }
        return @{ rc = $rc }
    }
    finally { Pop-Location }
}

function Seed-Repo([string]$r) {
    New-Item -ItemType Directory -Force -Path (Join-Path $r 'scripts/hooks') | Out-Null
    Copy-Item -LiteralPath (Join-Path $root 'scripts/hooks/pre-commit') -Destination (Join-Path $r 'scripts/hooks/pre-commit') -Force
    Copy-Item -LiteralPath (Join-Path $root 'scripts/hooks/post-checkout') -Destination (Join-Path $r 'scripts/hooks/post-checkout') -Force
    $rc = Invoke-Native { & git -C $r init -q }
    if ($rc -ne 0) { throw "git init failed in $r (rc=$rc)" }
}

try {
    $r1 = Join-Path $tmp 'case1'
    Seed-Repo $r1
    $c1 = Common-Dir $r1
    # Remove both installed hooks first, so a green case 1 can only mean this script put them back.
    Delete-File (Join-Path $c1 'hooks/pre-commit')
    Delete-File (Join-Path $c1 'hooks/post-checkout')
    $res = Invoke-Installer $r1
    Assert ($res.rc -eq 0) 'case1: installer exits 0 in a seeded repository'
    Assert (Same-Bytes (Join-Path $r1 'scripts/hooks/pre-commit') (Join-Path $c1 'hooks/pre-commit')) 'case1: pre-commit installed byte-for-byte from scripts/hooks'
    Assert (Same-Bytes (Join-Path $r1 'scripts/hooks/post-checkout') (Join-Path $c1 'hooks/post-checkout')) 'case1: post-checkout installed byte-for-byte from scripts/hooks'

    $r2 = Join-Path $tmp 'case2'
    Seed-Repo $r2
    $c2 = Common-Dir $r2
    Write-Text (Join-Path $r2 'scripts/hooks/pre-commit.test.ps1') "# fixture, must never be installed`r`n"
    Delete-File (Join-Path $c2 'hooks/pre-commit.test.ps1')
    $null = Invoke-Installer $r2
    $fixtureDst = Join-Path $c2 'hooks/pre-commit.test.ps1'
    Assert (-not (Test-Path -LiteralPath $fixtureDst)) 'case2: *.test.* in scripts/hooks is skipped, never becomes a live hook'
    Assert (Same-Bytes (Join-Path $r2 'scripts/hooks/pre-commit') (Join-Path $c2 'hooks/pre-commit')) 'case2: real hooks still installed while fixtures are skipped'

    $r3 = Join-Path $tmp 'case3'
    Seed-Repo $r3
    $c3 = Common-Dir $r3
    # The stale-hook case must be READ-ONLY, not merely different content: Copy-Item
    # overwrites an ordinary existing file with or without -Force, so a plain stale file
    # cannot detect the loss of -Force (proved by mutation: removing -Force stayed green).
    # -Force is load-bearing exactly for read-only/hidden destinations, which is the real
    # shape after an editor or an antivirus locks .git/hooks entries.
    $stale = Join-Path $c3 'hooks/pre-commit'
    Write-Text $stale "#!/bin/sh`nexit 0   # stale: no branch guard, no record auto-staging`n"
    Set-ItemProperty -LiteralPath $stale -Name IsReadOnly -Value $true
    Assert (Get-Item -LiteralPath $stale).IsReadOnly 'case3: fixture installed hook really is read-only before install (otherwise -Force is untestable)'
    $null = Invoke-Installer $r3
    Assert (Same-Bytes (Join-Path $r3 'scripts/hooks/pre-commit') $stale) 'case3: read-only stale installed hook is overwritten by the authoritative body'

    $r4 = Join-Path $tmp 'case4'
    New-Item -ItemType Directory -Force -Path $r4 | Out-Null
    & git -C $r4 init -q 2>&1 | Out-Null
    $c4 = Common-Dir $r4
    Delete-File (Join-Path $c4 'hooks/pre-commit')
    Delete-File (Join-Path $c4 'hooks/post-checkout')
    $res4 = Invoke-Installer $r4
    Assert ($res4.rc -ne 0) 'case4: missing scripts/hooks exits non-zero instead of reporting success'
    Assert (-not (Test-Path -LiteralPath (Join-Path $c4 'hooks/pre-commit'))) 'case4: nothing is installed on the failure path'

    $r5 = Join-Path $tmp 'case5'
    Seed-Repo $r5
    $c5 = Common-Dir $r5
    # mp-worktree-health.ps1 deliberately tolerates a trailing third-party block; the
    # recovery path is this reinstall, so the append must disappear here.
    # Order matters: a freshly git-init-ed repository has no hooks/pre-commit at all
    # (only *.sample), so install first, then append, then reinstall.
    $null = Invoke-Installer $r5
    $pre = Join-Path $c5 'hooks/pre-commit'
    Assert (Same-Bytes (Join-Path $r5 'scripts/hooks/pre-commit') $pre) 'case5: baseline install matches the authoritative body'
    $tracker = "# BEGIN Third-party tracker`nprevious_head=`"`$1`"`n# END Third-party tracker`n"
    $existing = Read-Bytes $pre
    $trackerBytes = [Text.Encoding]::UTF8.GetBytes($tracker)
    $appended = New-Object byte[] ($existing.Length + $trackerBytes.Length)
    [Array]::Copy($existing, 0, $appended, 0, $existing.Length)
    [Array]::Copy($trackerBytes, 0, $appended, $existing.Length, $trackerBytes.Length)
    [IO.File]::WriteAllBytes($pre, $appended)
    Assert ((Read-Bytes $pre).Length -gt $existing.Length) 'case5: the appended tail really landed before the reinstall'
    $tailBefore = (Read-Bytes $pre).Length
    $null = Invoke-Installer $r5
    Assert (Same-Bytes (Join-Path $r5 'scripts/hooks/pre-commit') $pre) 'case5: reinstall strips a third-party appended tail and restores the authoritative body'
    Assert ((Read-Bytes $pre).Length -lt $tailBefore) 'case5: installed hook got shorter, i.e. the append is gone'

    $r6 = Join-Path $tmp 'case6'
    Seed-Repo $r6
    $c6 = Common-Dir $r6
    $sub = Join-Path $r6 'scripts'
    Delete-File (Join-Path $c6 'hooks/pre-commit')
    # Running from a subdirectory is the documented supported mode. The failure mode is a
    # RELATIVE common-dir resolution: git would then report `.git` for the subdirectory run
    # and the install would land in <repo>/scripts/.git/hooks, leaving the real shared
    # hooks untouched. Note the source directory itself is <repo>/scripts/hooks, so an
    # assertion on that path would be trivially true and proves nothing.
    $res6 = Invoke-Installer $sub
    Assert ($res6.rc -eq 0) 'case6: installer exits 0 when run from a repository subdirectory'
    Assert (Same-Bytes (Join-Path $r6 'scripts/hooks/pre-commit') (Join-Path $c6 'hooks/pre-commit')) 'case6: subdirectory run still targets the absolute common dir'
    Assert (-not (Test-Path -LiteralPath (Join-Path $sub '.git/hooks/pre-commit'))) 'case6: nothing is installed into a relative .git under the current directory'
}
finally {
    Pop-Location -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($failed -eq 0) {
    Write-Host "PASS: $passed install-git-hooks checks" -ForegroundColor Green
    exit 0
}
Write-Host "FAILED: $failed of $($passed + $failed) install-git-hooks checks" -ForegroundColor Red
exit 1

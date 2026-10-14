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

    # 恢复钩子：后面的登记制用例只针对 outside 判定，不能被 case5 留下的缺钩红灯污染
    Write-Bytes (Join-Path $repo '.git/hooks/post-checkout') $orig

    function NormKey([string]$p) { return $p.Replace('\','/').TrimEnd('/').ToLowerInvariant() }

    # ---- 受管外来 worktree 登记制（2026-10-01）----
    # worktree add 需要至少一个提交。fixture 自己装了仓库钩子（供前置用例校验），
    # fixture 的 git 操作必须把 hooksPath 指到空目录禁用钩子，否则 pre-commit /
    # post-checkout 会在临时仓库里被触发，把测试本身打成红。
    $noHooks = Join-Path $tmp 'no-hooks'
    New-Item -ItemType Directory -Force -Path $noHooks | Out-Null
    & git -C $repo -c "core.hooksPath=$noHooks" add -A
    & git -C $repo -c "core.hooksPath=$noHooks" commit -q -m 'init'
    $outsideWt = Join-Path $tmp 'outside-wt'
    & git -C $repo -c "core.hooksPath=$noHooks" worktree add -q $outsideWt -b outside-branch
    Assert (Test-Path -LiteralPath $outsideWt) 'fixture: outside worktree created'

    # case 6: 隔离目录之外的 linked worktree、未登记 -> 仍然红（fail-closed 保留）
    $r = Invoke-Health $health 'case6'
    Assert ($r.rc -ne 0) 'unregistered outside linked worktree still fails the gate'
    Assert ((@($r.report.outsideWorktrees) | ForEach-Object { NormKey $_ }) -contains (NormKey $outsideWt)) 'unregistered outside worktree is listed in outsideWorktrees'

    # case 7: MP_ALLOWED_WORKTREES 精确登记 -> 放行并留痕
    $env:MP_ALLOWED_WORKTREES = $outsideWt
    $r = Invoke-Health $health 'case7'
    Assert ($r.rc -eq 0) 'registered outside worktree (env) satisfies the gate'
    Assert (@($r.report.outsideWorktrees).Count -eq 0) 'registered outside worktree no longer listed in outsideWorktrees'
    Assert ((@($r.report.exemptedWorktrees) | ForEach-Object { NormKey $_ }) -contains (NormKey $outsideWt)) 'registered outside worktree is recorded in exemptedWorktrees'
    Remove-Item Env:MP_ALLOWED_WORKTREES -ErrorAction SilentlyContinue

    # case 8: 注册表文件（固定机器本地路径，测试用 MP_ALLOWED_WORKTREES_FILE 指向夹具）同样放行
    $registryPath = Join-Path $tmp 'allowed-worktrees.json'
    $env:MP_ALLOWED_WORKTREES_FILE = $registryPath
    [IO.File]::WriteAllText($registryPath, ('["' + (NormKey $outsideWt) + '"]'), [Text.Encoding]::UTF8)
    $r = Invoke-Health $health 'case8'
    Assert ($r.rc -eq 0) 'registered outside worktree (registry file) satisfies the gate'
    Assert ($r.report.allowedRegistry.valid -eq $true -and $r.report.allowedRegistry.count -eq 1) 'registry reports valid with one entry'

    # case 9: 注册表 JSON 损坏 -> fail-closed（视为空表），并置 valid=false
    [IO.File]::WriteAllText($registryPath, '{ this is not json', [Text.Encoding]::UTF8)
    $r = Invoke-Health $health 'case9'
    Assert ($r.rc -ne 0) 'corrupted registry fails closed (unknown outside worktree is red again)'
    Assert ($r.report.allowedRegistry.valid -eq $false) 'corrupted registry reports allowedRegistry.valid=false'

    # case 10: 登记只做整路径精确匹配，不得前缀通配——登记了另一个路径，真实外来 worktree 仍然红
    [IO.File]::WriteAllText($registryPath, ('["' + (NormKey $outsideWt) + '-sibling"]'), [Text.Encoding]::UTF8)
    $r = Invoke-Health $health 'case10'
    Assert ($r.rc -ne 0) 'registry entry for a different path does not exempt the outside worktree'
    Remove-Item Env:MP_ALLOWED_WORKTREES_FILE -ErrorAction SilentlyContinue

    # ---- 登记表生命周期（2026-10-14）：陈旧登记项检测 + 登记入口 ----
    # 动机：实测现场 wt-mp-ccgrecord 消失约 7 天后登记项仍留在表里，报表无任何异常信号；
    # 且 harness 级 agent 工具建的外来 worktree 不会自动登记 ⇒ outside 判据必然判红。
    # 下面 5 例同时锁「出声的形状」与「STRICT 档的形状」，并锁登记入口脚本的四个动作。

    # case 11: 登记项指向一个已不存在的 worktree ⇒ 报告 staleAllowedEntries，默认仍放行（rc=0）
    # 夹具注意：此时表里必须**同时**登记活的 outsideWt，否则未登记的外来 worktree 会让 outside
    # 判据先红，rc 就不为 0 —— 那样测的是「未登记红」而不是「陈旧登记项不红」。
    $staleKey = NormKey (Join-Path $tmp 'gone-worktree')
    $env:MP_ALLOWED_WORKTREES_FILE = $registryPath
    [IO.File]::WriteAllText($registryPath, ('["' + (NormKey $outsideWt) + '","' + $staleKey + '"]'), [Text.Encoding]::UTF8)
    $r = Invoke-Health $health 'case11'
    Assert ($r.rc -eq 0) 'stale registry entry does not fail the gate by default (voice-only)'
    Assert ((@($r.report.staleAllowedEntries) | ForEach-Object { NormKey $_ }) -contains $staleKey) 'stale entry is reported in staleAllowedEntries'
    Assert ($r.report.staleAllowedStrict -eq $false) 'default mode reports staleAllowedStrict=false'

    # case 12: MP_ALLOWED_WORKTREES_STRICT=1 ⇒ 陈旧登记项判红（fail-closed）
    $env:MP_ALLOWED_WORKTREES_STRICT = '1'
    $r = Invoke-Health $health 'case12'
    Assert ($r.rc -ne 0) 'stale registry entry fails the gate under MP_ALLOWED_WORKTREES_STRICT=1'
    Assert ($r.report.staleAllowedStrict -eq $true) 'strict mode reports staleAllowedStrict=true'
    Remove-Item Env:MP_ALLOWED_WORKTREES_STRICT -ErrorAction SilentlyContinue

    # case 13: 登记项仍对应真实 linked worktree ⇒ 不是 stale（放进 exempted，不进 stale）
    [IO.File]::WriteAllText($registryPath, ('["' + (NormKey $outsideWt) + '"]'), [Text.Encoding]::UTF8)
    $r = Invoke-Health $health 'case13'
    Assert ($r.rc -eq 0) 'live registered worktree satisfies the gate'
    Assert (@($r.report.staleAllowedEntries).Count -eq 0) 'live registered worktree is not reported as stale'
    Assert ((@($r.report.exemptedWorktrees) | ForEach-Object { NormKey $_ }) -contains (NormKey $outsideWt)) 'live registered worktree stays in exemptedWorktrees'

    # ---- 登记入口脚本 scripts/register-allowed-worktree.ps1 ----
    $regScript = Join-Path $root 'scripts/register-allowed-worktree.ps1'
    if (-not (Test-Path -LiteralPath $regScript)) { throw "register script missing: $regScript" }
    function Invoke-Register([string[]]$regArgs) {
        $out = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $regScript -RegistryPath $registryPath @regArgs 2>&1
        return @{ rc = $LASTEXITCODE; text = ($out -join "`n") }
    }

    # case 14: 登记一个外来 worktree ⇒ 表里出现归一化键，健康检查随之放行
    # 断言用 ASCII：脚本面向 PowerShell 5.1 调用（测试里经 powershell.exe -File 起子进程），
    # 5.1 读无 BOM UTF-8 的中文会按 GBK 解读成乱码（实测 Write-Host 中文输出变 `宸茬櫥璁`），
    # 因此入口脚本的所有用户可见输出一律 ASCII，断言随之匹配 ASCII。
    $rr = Invoke-Register @('-Register', $outsideWt)
    Assert ($rr.rc -eq 0) 'register entry point exits 0'
    Assert ($rr.text -match 'registered' -or $rr.text -match 'already registered') 'register entry point reports success'
    $regKeys = @((Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json) | ForEach-Object { NormKey $_ })
    Assert ($regKeys -contains (NormKey $outsideWt)) 'registered key (normalised) is present in the registry file'
    $r = Invoke-Health $health 'case14'
    Assert ($r.rc -eq 0) 'registered outside worktree satisfies the gate via the entry point'

    # case 15: 重复登记幂等（不得写重复键，否则 diff 噪声会掩盖真实变更）
    $rr = Invoke-Register @('-Register', $outsideWt)
    Assert ($rr.rc -eq 0) 're-registering the same path exits 0'
    $regKeys2 = @((Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json) | ForEach-Object { NormKey $_ })
    Assert ($regKeys2.Count -eq 1) 're-registering does not duplicate the key'
    Assert ($rr.text -match 'already registered') 're-register reports idempotent no-op'

    # case 16: -Clean 剔除失效项、保留活项；清理后 STRICT 档也放行
    [IO.File]::WriteAllText($registryPath, ('["' + (NormKey $outsideWt) + '","' + $staleKey + '"]'), [Text.Encoding]::UTF8)
    $rr = Invoke-Register @('-Clean')
    Assert ($rr.rc -eq 0) 'clean exits 0'
    $regKeys3 = @((Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json) | ForEach-Object { NormKey $_ })
    Assert ($regKeys3 -contains (NormKey $outsideWt)) 'clean keeps the live entry'
    Assert ($regKeys3 -notcontains $staleKey) 'clean removes the stale entry'
    $env:MP_ALLOWED_WORKTREES_STRICT = '1'
    $r = Invoke-Health $health 'case16'
    Assert ($r.rc -eq 0) 'after clean, strict mode also passes (no stale entries left)'
    Remove-Item Env:MP_ALLOWED_WORKTREES_STRICT -ErrorAction SilentlyContinue

    # case 17: -Verify 只读（不改文件），并把 STALE 项点出来
    # 夹具顺序：先写入目标内容，再取 mtime 基线。反序会让基线取在写入之前，
    # 于是"我自己刚写的那次"被算成 Verify 的修改，断言恒红。
    [IO.File]::WriteAllText($registryPath, ('["' + $staleKey + '"]'), [Text.Encoding]::UTF8)
    Start-Sleep -Milliseconds 20
    $before = (Get-Item -LiteralPath $registryPath).LastWriteTimeUtc
    $rr = Invoke-Register @('-Verify')
    Assert ($rr.rc -eq 0) 'verify exits 0'
    Assert ($rr.text -match 'STALE') 'verify names the stale entry'
    Assert ((Get-Item -LiteralPath $registryPath).LastWriteTimeUtc -eq $before) 'verify does not modify the registry file'

    Remove-Item Env:MP_ALLOWED_WORKTREES_FILE -ErrorAction SilentlyContinue

    Write-Host ''
    if ($failed -eq 0) {
        Write-Host "PASS: $passed mp-worktree-health hook checks" -ForegroundColor Green
        exit 0
    }
    Write-Host "FAILED: $failed of $($passed + $failed) mp-worktree-health hook checks" -ForegroundColor Red
    exit 1
}
finally {
    Remove-Item Env:MP_ALLOWED_WORKTREES -ErrorAction SilentlyContinue
    Remove-Item Env:MP_ALLOWED_WORKTREES_FILE -ErrorAction SilentlyContinue
    Pop-Location -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

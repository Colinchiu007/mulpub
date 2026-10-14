<#
.SYNOPSIS
    检查 Multi-Publish 共享主目录是否满足隔离合同。
.DESCRIPTION
    只读检查：主 worktree 必须是 main、干净、无事故 marker，hooks 必须与
    权威源一致（已装钩子须以仓库源原文开头，允许其后追加第三方块，报告中的
    appendedBytes 记录追加长度；改写或前置注入仍判为不一致），
    所有 linked worktree 必须位于隔离目录（默认仓库父目录下 mp-worktrees）；
    受管外来 worktree 走登记制（allowed-worktrees.json / MP_ALLOWED_WORKTREES），
    登记项失效时报告 staleAllowedEntries（默认仅出声，MP_ALLOWED_WORKTREES_STRICT=1 判红）；
    可选的 -RequireWriteGuard 同时校验实时写保护任务已注册且正在运行。
#>
[CmdletBinding()]
param(
    [string]$Root = '',
    [string]$ReportPath = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Mulpub\session-isolation\health.json'),
    [string]$WorktreeRoot = '',
    [string]$GitPath = '',
    [switch]$RequireClean,
    [switch]$RequireHooks,
    [switch]$RequirePrimary,
    [switch]$RequireWriteGuard,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\','/')

$git = $GitPath
if (-not $git -and $env:MP_GIT) { $git = $env:MP_GIT }
if (-not $git) {
    $gitCmd = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($gitCmd -and $gitCmd.Source) { $git = $gitCmd.Source }
}
if (-not $git -or -not (Test-Path -LiteralPath $git)) {
    foreach ($candidate in @('C:\Program Files\Git\cmd\git.exe','C:\Program Files (x86)\Git\cmd\git.exe','D:\Program Files\Git\cmd\git.exe')) {
        if (Test-Path -LiteralPath $candidate) { $git = $candidate; break }
    }
}
if (-not $git -or -not (Test-Path -LiteralPath $git)) {
    throw '找不到 git.exe；请安装 Git for Windows，或通过 -GitPath / MP_GIT 指定'
}
function Git([string[]]$gitArgs) { & $git -C $root @gitArgs }

$branch = (Git @('branch','--show-current')).Trim()
# clean 判定只看已跟踪文件：.ccg/、.agent_context/ 等目录被 Write Guard 放行直接落盘，
# 未跟踪证据文件是共享根的设计内常态，不应阻塞 -RequireClean 任务入口（worktree add / 分支操作不受未跟踪文件影响）。
$status = @(Git @('status','--porcelain=v1','--untracked-files=no'))
$marker = Join-Path $root '.agent_context/shared-root-violation'
$common = (Git @('rev-parse','--path-format=absolute','--git-common-dir')).Trim().TrimEnd('\','/')
$primaryGit = (Git @('rev-parse','--path-format=absolute','--git-dir')).Trim().TrimEnd('\','/')
$isPrimary = $common -eq $primaryGit
if (-not $common -or -not $primaryGit) { throw '无法解析 Git common-dir 或 worktree git-dir' }

$worktreeRoot = $WorktreeRoot
if (-not $worktreeRoot -and $env:MP_WORKTREES) { $worktreeRoot = $env:MP_WORKTREES }
if (-not $worktreeRoot) { $worktreeRoot = Join-Path (Split-Path -Parent $root) 'mp-worktrees' }
if (-not [IO.Path]::IsPathRooted($worktreeRoot)) { $worktreeRoot = Join-Path $root $worktreeRoot }
$worktreeRoot = [IO.Path]::GetFullPath($worktreeRoot).TrimEnd('\','/')
$worktreeKey = $worktreeRoot.Replace('\','/').TrimEnd('/')

$hookResults = @()
foreach ($name in @('pre-commit','post-checkout')) {
    $source = Join-Path $root "scripts/hooks/$name"
    $installed = Join-Path $common "hooks/$name"
    $sourceBytes = if (Test-Path -LiteralPath $source) { [IO.File]::ReadAllBytes($source) } else { $null }
    $installedBytes = if (Test-Path -LiteralPath $installed) { [IO.File]::ReadAllBytes($installed) } else { $null }
    # Compare bytes, not hashes: the repo hook body must appear verbatim at the very
    # start of the installed hook. A trailing third-party block (e.g. an IDE-injected
    # tracker appended to .git/hooks/*) is tolerated and reported as appendedBytes,
    # while any rewrite / prepend / middle edit of the authoritative body still fails.
    # Byte-exact equality was rejected because it turns such an append into a permanent
    # -RequireHooks red light, which pushes sessions toward bypassing the gate.
    $prefixMatch = $false
    $appendedBytes = 0
    if ($sourceBytes -and $installedBytes -and $installedBytes.Length -ge $sourceBytes.Length) {
        $prefixMatch = $true
        for ($i = 0; $i -lt $sourceBytes.Length; $i++) {
            if ($sourceBytes[$i] -ne $installedBytes[$i]) { $prefixMatch = $false; break }
        }
        if ($prefixMatch) { $appendedBytes = $installedBytes.Length - $sourceBytes.Length }
    }
    $identical = ($prefixMatch -and $appendedBytes -eq 0)
    $hookResults += [ordered]@{ name=$name; sourceExists=[bool]$sourceBytes; installedExists=[bool]$installedBytes; identical=$identical; match=$prefixMatch; appendedBytes=$appendedBytes }
}

$guardTask = Get-ScheduledTask -TaskPath '\Mulpub\' -TaskName 'Session Isolation Write Guard' -ErrorAction SilentlyContinue
$guardRunning = $false
if ($guardTask) {
    # The guard now runs under a non-interactive (S4U) principal, i.e. in another session, and a
    # non-elevated caller cannot read other sessions' CommandLine - the property comes back
    # $null, so a name match on it reports "not running" for a guard that is in fact enforcing.
    # Measured 2026-10-03: session-0 powershell (parent = Task Scheduler) with unreadable
    # CommandLine, task State=Running, and a probe file under apps/ was quarantined within ~1s.
    # The task's own state is the primary signal; the process match stays as corroboration
    # because it still works when both live in the caller's session.
    $guardRunning = ([string]$guardTask.State) -eq 'Running'
    if (-not $guardRunning) {
        $guardProcs = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*guard-shared-root-writes.ps1*' })
        $guardRunning = $guardProcs.Count -gt 0
    }
}
$quarantineRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Mulpub\session-isolation\quarantine'
$guardFiles = @()
$violationCount = 0
if (Test-Path -LiteralPath $quarantineRoot) {
    $guardFiles = @(Get-ChildItem -LiteralPath $quarantineRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'violations.jsonl' })
    $violationLog = Join-Path $quarantineRoot 'violations.jsonl'
    if (Test-Path -LiteralPath $violationLog) { $violationCount = @(Get-Content -LiteralPath $violationLog -ErrorAction SilentlyContinue | Where-Object { $_.Trim() }).Count }
}

$worktreeLines = @(Git @('worktree','list','--porcelain'))
$paths = @($worktreeLines | Where-Object { $_ -like 'worktree *' } | ForEach-Object { $_.Substring(9) })
$rootKey = $root.Replace('\','/').TrimEnd('/')

# 受管外来 worktree 登记制（2026-10-01）：harness 级工具（如 WorkBuddy 的项目工作区）会向
# 共享仓库注册隔离目录之外的 linked worktree，这不是会话隔离能消除的进程。登记制把
# 「未知外来 worktree 一律红」收窄为「未登记的红、已登记的放行并留痕」，fail-closed 保留：
# 注册表 JSON 解析失败视为空表（未登记仍红），并在报告里置 allowedRegistry.valid=false。
# 注册表固定在机器本地 %LOCALAPPDATA%\Mulpub\session-isolation\（与 health.json 同目录），
# 不写入仓库、不随 -ReportPath 漂移 —— 否则换一个报告路径登记就「消失」，测试口径与真实口径分叉。
# 测试用 MP_ALLOWED_WORKTREES_FILE 指向夹具文件；MP_ALLOWED_WORKTREES（分号分隔）可免落盘临时追加。
# 判据是整路径精确匹配（大小写/斜杠归一化后），不做前缀通配 —— 白名单一旦可通配，
# 就离「整目录豁免」的门禁腐化只差一次手滑。
$allowedRegistryPath = if ($env:MP_ALLOWED_WORKTREES_FILE) { $env:MP_ALLOWED_WORKTREES_FILE } else { Join-Path (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Mulpub\session-isolation') 'allowed-worktrees.json' }
$allowedKeys = @()
$allowedRegistryValid = $true
if (Test-Path -LiteralPath $allowedRegistryPath) {
    try {
        $parsed = Get-Content -LiteralPath $allowedRegistryPath -Raw | ConvertFrom-Json
        foreach ($entry in @($parsed)) {
            if ($entry -is [string] -and $entry.Trim()) {
                $allowedKeys += $entry.Replace('\','/').TrimEnd('/').ToLowerInvariant()
            } else {
                $allowedRegistryValid = $false
            }
        }
    } catch {
        $allowedRegistryValid = $false
    }
}
if ($env:MP_ALLOWED_WORKTREES) {
    foreach ($p in $env:MP_ALLOWED_WORKTREES.Split(';')) {
        if ($p.Trim()) { $allowedKeys += $p.Replace('\','/').TrimEnd('/').ToLowerInvariant() }
    }
}

$isOutsidePath = {
    param([string]$worktreePath)
    $k = $worktreePath.Replace('\','/').TrimEnd('/')
    $k -ne $rootKey -and -not $k.StartsWith(($worktreeKey + '/mp-'), [StringComparison]::OrdinalIgnoreCase)
}
$outside = @($paths | Where-Object { (& $isOutsidePath $_) -and ($allowedKeys -notcontains $_.Replace('\','/').TrimEnd('/').ToLowerInvariant()) })
$exempted = @($paths | Where-Object { (& $isOutsidePath $_) -and ($allowedKeys -contains $_.Replace('\','/').TrimEnd('/').ToLowerInvariant()) })
$hooksBad = @($hookResults | Where-Object { -not $_.match }).Count -gt 0
$rootAllowed = if ($RequirePrimary) { $isPrimary -and $branch -eq 'main' } else { $isPrimary -or $rootKey.StartsWith(($worktreeKey + '/mp-'), [StringComparison]::OrdinalIgnoreCase) }
$writeGuardOk = [bool]$guardTask -and $guardRunning

# 陈旧登记项检测（2026-10-14）：登记表此前无生命周期管理——登记项对应的 worktree 被删后
# 条目永久残留，报表上看不出任何异常。实测现场：`wt-mp-ccgrecord` 已于 2026-10-07 前后
# 消失（既不在 `git worktree list`、路径也不存在），登记项却留到 2026-10-14 才被发现。
# 判据：登记项既不是本仓库已注册的 linked worktree、对应路径也不存在 ⇒ stale。
# 默认只出声不拦（MP_ALLOWED_WORKTREES_STRICT=1 时判红）：登记表是机器本地文件，
# 别的会话可能正在登记一个「即将建好」的 worktree，此刻把它判红会造成无谓阻塞；
# 出声的形状是报告里的 staleAllowedEntries + 非 Quiet 时的一行 WARN，
# 并由 scripts/register-allowed-worktree.ps1 在登记动作里顺手清理死项。
$liveKeys = @($paths | ForEach-Object { $_.Replace('\','/').TrimEnd('/').ToLowerInvariant() })
$staleAllowed = @($allowedKeys | Where-Object { $liveKeys -notcontains $_ -and -not (Test-Path -LiteralPath ($_ -replace '/','\')) } | Sort-Object)
$staleStrict = ($env:MP_ALLOWED_WORKTREES_STRICT -eq '1')

$ok = $rootAllowed -and -not (Test-Path $marker) -and (($RequireClean -eq $false) -or $status.Count -eq 0) -and (($RequireHooks -eq $false) -or -not $hooksBad) -and $outside.Count -eq 0 -and $allowedRegistryValid -and (($RequireWriteGuard -eq $false) -or $writeGuardOk) -and (-not $staleStrict -or $staleAllowed.Count -eq 0)

$writeGuard = [ordered]@{ taskRegistered=[bool]$guardTask; running=$guardRunning; quarantineCount=$guardFiles.Count; violations=$violationCount; ok=$writeGuardOk }
$allowedRegistry = [ordered]@{ path=$allowedRegistryPath; valid=$allowedRegistryValid; count=$allowedKeys.Count }
$report = [ordered]@{ checkedAt=(Get-Date).ToUniversalTime().ToString('o'); root=$root; worktreeRoot=$worktreeRoot; primary=$isPrimary; branch=$branch; clean=($status.Count -eq 0); marker=(Test-Path $marker); hooks=$hookResults; writeGuard=$writeGuard; worktreeCount=$paths.Count; outsideWorktrees=$outside; exemptedWorktrees=$exempted; allowedRegistry=$allowedRegistry; staleAllowedEntries=$staleAllowed; staleAllowedStrict=$staleStrict; ok=$ok }
$parent = Split-Path -Parent $ReportPath
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
if (-not $Quiet) {
    $report | ConvertTo-Json -Depth 6 | Write-Output
    if ($staleAllowed.Count -gt 0) {
        # 先算后赋：PowerShell 5.1 不支持 `$x = if (...) {...} else {...}` 这种把 if 当表达式的写法
        # （实测 5.1 在此处报 "Unexpected token"，且 5.1 对无 BOM UTF-8 的中文按 GBK 解读出乱码 token）。
        if ($staleStrict) { $mode = 'blocking (MP_ALLOWED_WORKTREES_STRICT=1)' } else { $mode = 'voice-only' }
        Write-Warning ("[stale-allowed] {0} stale allowed-worktree entr(y|ies) [{1}]: {2}. Clean: pwsh -File scripts/register-allowed-worktree.ps1 -Clean" -f $staleAllowed.Count, $mode, ($staleAllowed -join ' ; '))
    }
}
if (-not $ok) { exit 1 }

<#
.SYNOPSIS
    检查 Multi-Publish 共享主目录是否满足隔离合同。
.DESCRIPTION
    只读检查：主 worktree 必须是 main、干净、无事故 marker，hooks 必须与
    权威源一致（已装钩子须以仓库源原文开头，允许其后追加第三方块，报告中的
    appendedBytes 记录追加长度；改写或前置注入仍判为不一致），
    所有 linked worktree 必须位于隔离目录（默认仓库父目录下 mp-worktrees）；
    可选的 -RequireWriteGuard 同时校验实时写保护任务已注册且正在运行。
#>
[CmdletBinding()]
param(
    [string]$Root = '',
    [string]$ReportPath = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Multi-Publish\session-isolation\health.json'),
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

$guardTask = Get-ScheduledTask -TaskPath '\Multi-Publish\' -TaskName 'Session Isolation Write Guard' -ErrorAction SilentlyContinue
$guardRunning = $false
if ($guardTask) {
    $guardProcs = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*guard-shared-root-writes.ps1*' })
    $guardRunning = $guardProcs.Count -gt 0
}
$quarantineRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Multi-Publish\session-isolation\quarantine'
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
$outside = @($paths | Where-Object { $pathKey = $_.Replace('\','/').TrimEnd('/'); $pathKey -ne $rootKey -and -not $pathKey.StartsWith(($worktreeKey + '/mp-'), [StringComparison]::OrdinalIgnoreCase) })
$hooksBad = @($hookResults | Where-Object { -not $_.match }).Count -gt 0
$rootAllowed = if ($RequirePrimary) { $isPrimary -and $branch -eq 'main' } else { $isPrimary -or $rootKey.StartsWith(($worktreeKey + '/mp-'), [StringComparison]::OrdinalIgnoreCase) }
$writeGuardOk = [bool]$guardTask -and $guardRunning
$ok = $rootAllowed -and -not (Test-Path $marker) -and (($RequireClean -eq $false) -or $status.Count -eq 0) -and (($RequireHooks -eq $false) -or -not $hooksBad) -and $outside.Count -eq 0 -and (($RequireWriteGuard -eq $false) -or $writeGuardOk)

$writeGuard = [ordered]@{ taskRegistered=[bool]$guardTask; running=$guardRunning; quarantineCount=$guardFiles.Count; violations=$violationCount; ok=$writeGuardOk }
$report = [ordered]@{ checkedAt=(Get-Date).ToUniversalTime().ToString('o'); root=$root; worktreeRoot=$worktreeRoot; primary=$isPrimary; branch=$branch; clean=($status.Count -eq 0); marker=(Test-Path $marker); hooks=$hookResults; writeGuard=$writeGuard; worktreeCount=$paths.Count; outsideWorktrees=$outside; ok=$ok }
$parent = Split-Path -Parent $ReportPath
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
if (-not $Quiet) { $report | ConvertTo-Json -Depth 6 | Write-Output }
if (-not $ok) { exit 1 }

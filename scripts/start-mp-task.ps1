<#
.SYNOPSIS
    创建并打开 Multi-Publish 的独立任务 worktree。
.DESCRIPTION
    运行时代码任务的统一入口：校验共享主目录、安装并校验 Git hooks，
    再通过 session-init.sh 创建或复用隔离 worktree（默认仓库父目录下 mp-worktrees）。
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9][a-z0-9-]*$')]
    [string]$TaskName,
    [switch]$NoDeps,
    [switch]$NoShell,
    [string]$WorktreeRoot = '',
    [string]$GitBash = ''
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$bash = $GitBash
if (-not $bash -and $env:MP_GIT_BASH) { $bash = $env:MP_GIT_BASH }
if (-not $bash) {
    $gitCmd = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($gitCmd -and $gitCmd.Source) {
        $candidate = Join-Path (Split-Path (Split-Path $gitCmd.Source -Parent) -Parent) 'usr\bin\bash.exe'
        if (Test-Path -LiteralPath $candidate) { $bash = $candidate }
    }
}
if (-not $bash) {
    foreach ($candidate in @('C:\Program Files\Git\usr\bin\bash.exe','C:\Program Files (x86)\Git\usr\bin\bash.exe','D:\Program Files\Git\usr\bin\bash.exe')) {
        if (Test-Path -LiteralPath $candidate) { $bash = $candidate; break }
    }
}
if (-not $bash -or -not (Test-Path -LiteralPath $bash)) {
    throw '未找到 Git for Windows Bash；请安装 Git for Windows，或通过 -GitBash / MP_GIT_BASH 指定 bash.exe'
}
$primary = (& git -C $repo worktree list --porcelain | Where-Object { $_ -like 'worktree *' } | Select-Object -First 1).Substring(9)

function Invoke-RepoPowerShell([string]$script, [string[]]$arguments) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo "scripts/$script") @arguments
    if ($LASTEXITCODE -ne 0) { throw "$script 失败，退出码 $LASTEXITCODE" }
}

Invoke-RepoPowerShell 'mp-worktree-health.ps1' @('-Root', $primary, '-RequireClean', '-RequirePrimary')
Invoke-RepoPowerShell 'install-git-hooks.ps1' @()
Invoke-RepoPowerShell 'mp-worktree-health.ps1' @('-Root', $primary, '-RequireClean', '-RequireHooks', '-RequirePrimary')

$worktreeRoot = $WorktreeRoot
if (-not $worktreeRoot -and $env:MP_WORKTREES) { $worktreeRoot = $env:MP_WORKTREES }
if (-not $worktreeRoot) { $worktreeRoot = Join-Path (Split-Path -Parent $repo) 'mp-worktrees' }
if (-not [IO.Path]::IsPathRooted($worktreeRoot)) { $worktreeRoot = Join-Path $repo $worktreeRoot }
$worktreeRoot = [IO.Path]::GetFullPath($worktreeRoot)
New-Item -ItemType Directory -Force -Path $worktreeRoot | Out-Null

if ($NoDeps) { $env:GWM_SKIP_DEPS = '1' }
$env:MP_WORKTREES = $worktreeRoot
try {
    # 2026-09-15：Join-Path 产生反斜杠路径，Git Bash 的 dirname/cd 会因转义失败 →
    # 统一改为正斜杠传入（Git Bash 对 D:/... 形式可正常解析）。
    $initScript = (Join-Path $repo 'scripts/session-init.sh') -replace '\\', '/'
    $output = & $bash $initScript $TaskName 2>&1
    $exitCode = $LASTEXITCODE
} finally {
    Remove-Item Env:GWM_SKIP_DEPS -ErrorAction SilentlyContinue
    Remove-Item Env:MP_WORKTREES -ErrorAction SilentlyContinue
}
if ($exitCode -ne 0) { $output | Write-Host; throw "session-init.sh 失败，退出码 $exitCode" }

$worktree = Join-Path $worktreeRoot "mp-$TaskName"
if (-not (Test-Path -LiteralPath (Join-Path $worktree '.git'))) { throw "未找到创建后的 worktree: $worktree" }
Write-Host ($output -join [Environment]::NewLine)
Write-Host "任务 worktree: $worktree" -ForegroundColor Green
if (-not $NoShell -and $PSCmdlet.ShouldProcess($worktree, '打开独立 PowerShell')) {
    $command = "Set-Location -LiteralPath '$worktree'; Write-Host 'Multi-Publish isolated task: $TaskName' -ForegroundColor Green"
    Start-Process powershell.exe -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) -WorkingDirectory $worktree
}

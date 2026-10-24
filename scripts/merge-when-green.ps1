<#
.SYNOPSIS
  Wait for a PR's CI checks to pass, then merge. Safe replacement for `gh pr merge --auto`,
  which merges immediately on private/free repos because required status checks cannot be set.
.DESCRIPTION
  用法:
    pwsh scripts/merge-when-green.ps1 -PrNumber 1234
    pwsh scripts/merge-when-green.ps1 -PrNumber 1234 -Method squash -DeleteBranch
  前置: gh CLI 已登录；目标 PR 处于 OPEN 且可合并。
  行为: 轮询等待 CI 检查全部结束（带硬截止，避免单 runner 拥堵时无限阻塞）-> 解析结论
        -> 全部成功才合并；任何失败 / 超时 / 无检查 都拒绝合并并以非零退出。
  背景: 本仓为私有免费仓，GitHub 不允许设置 required status checks（403），
        故 `gh pr merge --auto` 因“无必需检查”而立即合并。此脚本用显式等待替代 --auto。
  注意: 检查状态由 scripts/lib/pr-checks.js 统一取（它优先用 gh pr checks --json name,state；
        老 gh 不认 --json 时自动降级到 gh api commits/<sha>/check-runs）⇒ state 为大写
        （PENDING/IN_PROGRESS/QUEUED/SUCCESS/FAILURE…）；
        合并改用 REST API（gh api -X PUT .../merge），避免本环境 gh pr merge 无 --yes 的问题。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, HelpMessage = 'PR 编号')]
  [int]$PrNumber,

  [ValidateSet('merge', 'squash', 'rebase')]
  [string]$Method = 'squash',

  [int]$TimeoutMinutes = 120,

  [int]$PollSeconds = 30,

  [switch]$DeleteBranch
)

$ErrorActionPreference = 'Stop'

function Fail([string]$msg, [int]$code) {
  Write-Host ("FAIL(" + $code + "): " + $msg) -ForegroundColor Red; [Console]::Error.WriteLine("FAIL(" + $code + "): " + $msg)
  exit $code
}

# 1) PR 基本状态（mergeable 可能为 UNKNOWN，重试几次等待 GitHub 计算完）
$prJson = gh pr view $PrNumber --json state, mergeable, headRefName 2>&1
if ($LASTEXITCODE -ne 0) { Fail "无法获取 PR #$PrNumber 信息: $prJson" 1 }
$pr = $prJson | ConvertFrom-Json
if ($pr.state -ne 'OPEN') { Fail "PR #$PrNumber 不是 OPEN 状态 ($($pr.state))，中止合并。" 1 }

$mergeable = $pr.mergeable
for ($i = 0; $i -lt 3 -and $mergeable -eq 'UNKNOWN'; $i++) {
  Start-Sleep -Seconds 5
  $mergeable = (gh pr view $PrNumber --json mergeable --jq '.mergeable' 2>$null)
}
if ($mergeable -ne 'MERGEABLE') { Fail "PR #$PrNumber 当前不可合并 ($mergeable)，请先解决冲突。" 1 }

# 取数层（2026-10-24）：统一走 scripts/lib/pr-checks.js（两个合并入口共用的唯一真源）。
#   它优先用 `gh pr checks --json name,state`；老 gh（不认 --json 这个后加的 flag）自动降级到
#   `gh api commits/<sha>/check-runs`（同名取最新一次 run，与真 gh 的 rollup 语义一致）。
#   ⚠️ 取数失败**不再**回落成「0 条检查」——那会让 break 条件永不满足，
#      在「CI 其实早就全绿」的状态下空转到超时，且日志误导成「runner 可能离线」。
$repo = (gh pr view $PrNumber --json repository --jq '.repository.nameWithOwner' 2>$null)
if (-not $repo) { $repo = 'Colinchiu007/mulpub' }
$errFile = [System.IO.Path]::GetTempFileName()

# 2) 轮询等待所有检查结束（带硬截止，避免单 runner 拥堵时无限阻塞）
Write-Host "==> 等待 PR #$PrNumber 的 CI 检查完成（最多 $TimeoutMinutes 分钟）..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$IncompleteStates = @('PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED')
while ($true) {
  $now = Get-Date
  if ($now -ge $deadline) { Fail "超时：CI 检查在 $TimeoutMinutes 分钟内未全部结束。" 2 }

  $cur = node scripts/lib/pr-checks.js --pr $PrNumber --repo $repo --format json 2>$errFile
  if ($LASTEXITCODE -ne 0) {
    $why = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue)
    $first = ($why -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
    Write-Host "  取数失败（**不是**「没有 CI 检查」）：$first；继续等待..."
    Start-Sleep -Seconds $PollSeconds
    continue
  }
  $checks = $cur | ConvertFrom-Json
  $all = @($checks)
  $pending = @($all | Where-Object { $_.state -in $IncompleteStates })
  if ($all.Count -gt 0 -and $pending.Count -eq 0) { break }
  if ($all.Count -eq 0) {
    Write-Host "  尚未产生 CI 检查（runner 可能离线），继续等待..."
  } else {
    $remain = [math]::Round(($deadline - $now).TotalMinutes, 1)
    Write-Host "  $($all.Count) 个检查，仍有 $($pending.Count) 个未完成，继续等待（剩余约 ${remain} 分钟）..."
  }
  Start-Sleep -Seconds $PollSeconds
}

# 3b) 主干红 / 本 PR 新增红的闸门（判据唯一实现：scripts/lib/main-red.js，本入口只调用不判定）
#     rc=1 新增红；rc=2 主干红着；rc=3 未证实；rc=4 闸门自身故障。一律停手，不得重推掩盖。
#     ⛔ 整段必须排在下面「本 PR 失败清单」之前（第五轮 C2）：主干红时每个 PR 的 required Gate Result
#     都跟着红，先按「PR 有红」退出的话闸门一次都不会跑，而「只剩一句未通过、把真实原因（主干红）
#     藏成我的 PR 有问题」正是本片立项要消灭的那句话。
$allow = if ($env:MAIN_RED_ALLOW) { @('--allow-main-red', $env:MAIN_RED_ALLOW) } else { @() }
# 稳定窗参数透传（2026-10-22，change: main-red-run-baseline）：主干 tip 在读数期间移动时，
# 闸门自己会作废那次读数并有界重试（默认 3 次 × 90 秒）；这里只暴露覆盖口，不改判定。
$win = @()
if ($env:MAIN_RED_ATTEMPTS) { $win += @('--attempts', $env:MAIN_RED_ATTEMPTS) }
if ($env:MAIN_RED_RETRY_SECONDS) { $win += @('--retry-seconds', $env:MAIN_RED_RETRY_SECONDS) }
& node scripts/check-main-red.js --pr $PrNumber @allow @win
if ($LASTEXITCODE -ne 0) { Fail "STOP：main-red 闸门拒绝合并 PR #$PrNumber（rc=$LASTEXITCODE；读本脚本上一行的 verdict 行）" 7 }

# 3) 解析最终结论（仅用 state，不依赖 conclusion 字段）
$final = node scripts/lib/pr-checks.js --pr $PrNumber --repo $repo --format json 2>$errFile
if ($LASTEXITCODE -ne 0) {
  $why = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue)
  Fail "取不到 PR #$PrNumber 的检查状态（**不是**「没有检查」）：$why —— 请读原因后重试，不要据此合并。" 5
}
$all = @($final | ConvertFrom-Json)
$total = $all.Count
if ($total -eq 0) {
  Fail "PR #$PrNumber 没有任何 CI 检查（runner 可能离线）。出于安全不自动合并。" 5
}

$pending = @($all | Where-Object { $_.state -in $IncompleteStates })
$failed  = @($all | Where-Object { $_.state -in @('FAILURE', 'CANCELLED', 'TIMED_OUT', 'ERROR') })

if ($pending.Count -gt 0) {
  $names = ($pending | ForEach-Object { $_.name }) -join ', '
  Fail "仍有检查未完成: $names" 3
}
if ($failed.Count -gt 0) {
  Write-Host "CI 检查失败清单:" -ForegroundColor Red
  $failed | ForEach-Object { Write-Host "  - $($_.name): $($_.state)" }
  Fail "CI 检查未通过，拒绝合并 PR #$PrNumber。" 4
}

# 4) 全部通过 -> 合并（REST API 直接合并，无需 --yes，原子且可靠）
$prHeadSha = (gh pr view $PrNumber --json headRefOid --jq '.headRefOid' 2>$null)
if (-not $prHeadSha) { Fail '取不到 PR head sha——不传 sha 的合并落的是「执行那一刻的 head」，闸门验过的 sha 与真正进主干的产物可以不是同一笔（第五轮 C6）' 7 }
$mergeApiArgs = @('-X', 'PUT', "repos/$repo/pulls/$PrNumber/merge", '-f', "merge_method=$Method", '-f', "sha=$prHeadSha")
if ($DeleteBranch) { $mergeApiArgs += @('-f', 'delete_branch=true') }
Write-Host "==> 所有 CI 检查通过，合并 PR #$PrNumber ($Method)$(if ($DeleteBranch) { ' 并删除分支' })..." -ForegroundColor Green
gh api @mergeApiArgs 2>&1
if ($LASTEXITCODE -ne 0) { Fail "gh api 合并失败（PR 可能已不可合并或有冲突），未合并。" 6 }
Write-Host "✓ PR #$PrNumber 已合并。" -ForegroundColor Green
Remove-Item $errFile -ErrorAction SilentlyContinue

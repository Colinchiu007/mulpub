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
  Write-Error $msg
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

# 2) 轮询等待所有检查结束（带硬截止，避免单 runner 拥堵时无限阻塞）
Write-Host "==> 等待 PR #$PrNumber 的 CI 检查完成（最多 $TimeoutMinutes 分钟）..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
while ($true) {
  $now = Get-Date
  if ($now -ge $deadline) { Fail "超时：CI 检查在 $TimeoutMinutes 分钟内未全部结束。" 2 }

  $cur = gh pr checks $PrNumber --json name, state, conclusion 2>&1
  if ($LASTEXITCODE -ne 0) { Start-Sleep -Seconds 10; continue }
  $checks = $cur | ConvertFrom-Json
  $all = @($checks)
  $pending = @($all | Where-Object { $_.state -in @('pending', 'in_progress', 'queued', 'waiting') })
  if ($all.Count -gt 0 -and $pending.Count -eq 0) { break }
  if ($all.Count -eq 0) {
    Write-Host "  尚未产生 CI 检查（runner 可能离线），继续等待..."
  } else {
    $remain = [math]::Round(($deadline - $now).TotalMinutes, 1)
    Write-Host "  $($all.Count) 个检查，仍有 $($pending.Count) 个未完成，继续等待（剩余约 ${remain} 分钟）..."
  }
  Start-Sleep -Seconds $PollSeconds
}

# 3) 解析最终结论
$checks = (gh pr checks $PrNumber --json name, state, conclusion 2>&1 | ConvertFrom-Json)
$all = @($checks)
$total = $all.Count
if ($total -eq 0) {
  Fail "PR #$PrNumber 没有任何 CI 检查（runner 可能离线）。出于安全不自动合并。" 5
}

$pending = @($all | Where-Object { $_.state -in @('pending', 'in_progress', 'queued', 'waiting') })
$failed  = @($all | Where-Object {
  $_.conclusion -eq 'failure' -or $_.state -eq 'error' -or
  $_.conclusion -eq 'timed_out' -or $_.conclusion -eq 'cancelled'
})

if ($pending.Count -gt 0) {
  $names = ($pending | ForEach-Object { $_.name }) -join ', '
  Fail "仍有检查未完成: $names" 3
}
if ($failed.Count -gt 0) {
  Write-Host "CI 检查失败清单:" -ForegroundColor Red
  $failed | ForEach-Object { Write-Host "  - $($_.name): $($_.conclusion)" }
  Fail "CI 检查未通过，拒绝合并 PR #$PrNumber。" 4
}

# 4) 全部通过 -> 合并
$mergeArgs = @('pr', 'merge', "$PrNumber", "--$Method", '--yes')
if ($DeleteBranch) { $mergeArgs += '--delete-branch' }
Write-Host "==> 所有 CI 检查通过，合并 PR #$PrNumber ($Method)$(if ($DeleteBranch) { ' 并删除分支' })..." -ForegroundColor Green
gh @mergeArgs 2>&1
if ($LASTEXITCODE -ne 0) { Fail "gh pr merge 失败。" 6 }
Write-Host "✓ PR #$PrNumber 已合并。" -ForegroundColor Green

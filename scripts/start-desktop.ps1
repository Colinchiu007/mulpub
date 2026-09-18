#requires -Version 7
<#
.SYNOPSIS
  Multi-Publish 桌面启动契约：保证每次启动 = 最新代码 + 正确工作区。

.DESCRIPTION
  1) 定工作区：显式 -Worktree（默认脚本所在仓库根），校验 git 根 + apps/desktop；
  2) 同步最新：git fetch + 落后则 merge --ff-only origin/main（脏文件冲突 fail-closed）；
  3) 端口归属：mp-worktrees 下按路径稳定派生独立端口（默认 5174/9222），
     被非目标 worktree 的 Vite 占用 → 报错退出，绝不静默连别人的 Vite；
  4) 清旧实例：同 profile 单实例锁会让重启失效，先停旧 Electron/launcher/Vite；
  5) 依赖健康：scripts/ensure-desktop-deps.js（缺失时内建最小脆弱依赖检查）；
  6) 证据输出：worktree/branch/HEAD + 窗口 handle/标题 + Vite 归属 + (可选) identity。

.PARAMETER Worktree
  目标 worktree 绝对路径；默认 = 本脚本所在仓库根。

.PARAMETER Profile
  ELECTRON_USER_DATA_DIR（默认 D:\tmp\Multi-Publish-debug-profile）。

.PARAMETER NoSync
  跳过 git fetch + ff-only 同步。

.PARAMETER NoDepsCheck
  跳过依赖健康检查/自愈。

.PARAMETER InvalidateViteCache
  启动前失效陈旧 Vite optimize 缓存（改名保留）。

.PARAMETER CheckIdentity
  窗口出现后经 CDP 校验登录态（scripts/start-desktop-identity.js）。

.PARAMETER StopForeignProfile
  检测到其他 worktree 占用同一 profile 时：默认 fail-closed 报错退出；
  加本开关则审计停止那些 Electron 实例后继续启动。

.PARAMETER SelfTest
  自检模式：验证「枚举后 PID 已退出」竞态被容忍（不启动应用）。

.PARAMETER Json
  输出 JSON 证据块。

.EXAMPLE
  pwsh -File scripts/start-desktop.ps1 -Worktree D:\Data\projects\mp-worktrees\mp-desktop-dev -CheckIdentity
#>
[CmdletBinding()]
param(
  [string]$Worktree = '',
  [string]$Profile = 'D:\tmp\Multi-Publish-debug-profile',
  [switch]$NoSync,
  [switch]$NoDepsCheck,
  [switch]$InvalidateViteCache,
  [switch]$CheckIdentity,
  [switch]$StopForeignProfile,
  [switch]$ForceShared,
  [switch]$SelfTest,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$repoRoot = if ($Worktree) { $Worktree } else { (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
try { $repoRoot = (Resolve-Path -LiteralPath $repoRoot).Path } catch { }  # 归一化为原生反斜杠，Path -like 匹配与斜杠方向无关
$evidence = [ordered]@{ worktree = $repoRoot; startedAt = (Get-Date).ToString('o') }
# 审计日志：所有清理/停止/启动动作留痕，并发互杀立即可查（D:\Temp\mp-start-desktop-audit.log）
$auditLog = Join-Path $env:TEMP 'mp-start-desktop-audit.log'
function Add-Audit([string]$action, [string]$detail = '') {
  try {
    $line = "[{0:o}] {1} {2}" -f (Get-Date), $action, $detail
    Add-Content -LiteralPath $auditLog -Value $line -Encoding utf8 -ErrorAction SilentlyContinue
  } catch { }
}
Add-Audit 'RUN' "worktree=$repoRoot profile=$Profile"

function Write-Line($msg) { if (-not $Json) { Write-Host $msg } }
function Fail($msg) { Add-Audit 'FAIL' $msg; Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }
function Stop-ProcessIfAlive([int]$ProcessId, [string]$Label) {
  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    Add-Audit "STOP $Label" "pid=$ProcessId"
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    Write-Line "stop     : $Label PID $ProcessId"
  } else {
    Add-Audit "SKIP $Label" "pid=$ProcessId 已退出"
    Write-Line "skip     : $Label PID $ProcessId 已退出（忽略）"
  }
}

# ---- 0. 自检（回归保护：枚举后 PID 已退出的竞态必须被容忍）----
if ($SelfTest) {
  Stop-ProcessIfAlive -ProcessId 99999999 -Label 'selftest'
  Write-Line "audit    : $auditLog"
  Write-Line 'SELFTEST_OK'
  exit 0
}


# ---- 0b. Node 自定位（不依赖调用方 PATH；fnm/普通终端常缺 node）----
$nodeExe = $null
$cmdNode = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($cmdNode) { $nodeExe = $cmdNode.Source }
if (-not $nodeExe) {
  foreach ($cand in @(
    (Join-Path $env:LOCALAPPDATA 'hermes\node\node.exe'),
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'fnm\node-versions\*\*\node.exe')
  )) {
    $hit = Get-Item -Path $cand -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { $nodeExe = $hit.FullName; break }
  }
}
if (-not $nodeExe) { Fail '找不到 node：请先安装/激活 Node（如 fnm install --latest && fnm use）' }
$env:Path = (Split-Path $nodeExe -Parent) + ';' + $env:Path
$evidence.node = $nodeExe
Write-Line "node     : $nodeExe"

# ---- 0c. Python 自定位（与 node 同理：不依赖调用方 PATH，避免 WorkBuddy 托管 Python 截胡裸 python）----
# 2026-09-18 缺陷修复：固定路径优先于 py launcher。父会话 PATH 里 py 可能被
# GitHub Actions runner 工具缓存（_work/_tool/Python）等裸解释器截胡，其无
# pydantic/splitter 业务依赖，导致 SplitterBridge/PromptBridge 启动失败。
$pyExe = $null
foreach ($cand in @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe')
)) { if (Test-Path -LiteralPath $cand) { $pyExe = $cand; break } }
if (-not $pyExe) {
  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pyLauncher) {
    try {
      $r = & $pyLauncher.Source -3.12 -c 'import sys; print(sys.executable)' 2>$null
      if ($r) {
        # 取首行并强制字符串（py 输出可能多行/数组，避免 Trim/Test-Path 收到数组）
        $candidate = ([string]$r).Trim() -split '\r?\n' | Select-Object -First 1
        # 排除工具缓存/沙箱裸解释器（github-runner/_work/_tool/hostedtoolcache 等），
        # 与 electron-runtime-env.js UNTRUSTED_PYTHON_MARKERS 保持一致（两侧需同步更新）
        if ($candidate -notmatch 'github-runner|_work[\/]_tool|hostedtoolcache') {
          if (Test-Path -LiteralPath $candidate) { $pyExe = $candidate }
        }
      }
    } catch { }
  }
}
if ($pyExe) {
  $env:Path = (Split-Path $pyExe -Parent) + ';' + $env:Path
  $evidence.python = $pyExe
  Write-Line "python   : $pyExe (已前置到 PATH — 裸 'python' 现指向系统 Python 3.12)"
} else {
  Write-Line 'python   : 未定位系统 Python 3.12，依赖调用方 PATH 的 python'
}

# ---- 1. 工作区校验 ----
if (-not (Test-Path -LiteralPath $repoRoot)) { Fail "worktree 不存在: $repoRoot" }
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'apps\desktop'))) { Fail "不是 Multi-Publish 仓库根（缺 apps/desktop）: $repoRoot" }
$branch = git -C $repoRoot branch --show-current 2>$null
$head = git -C $repoRoot log -1 --format='%h %s' 2>$null
if (-not $head) { Fail "非 git 工作区: $repoRoot" }
$evidence.branch = $branch
$evidence.head = $head
Write-Line "worktree : $repoRoot"

# ---- 1b. 共享主工作区守卫（fail-closed）----
$gitDir = git -C $repoRoot rev-parse --git-dir 2>$null
$commonDir = git -C $repoRoot rev-parse --git-common-dir 2>$null
$isSharedMain = ($gitDir -and $commonDir -and $gitDir -eq $commonDir)
if ($isSharedMain -and -not $ForceShared) {
  Fail "目标 $repoRoot 是共享主工作区（git-dir == common-dir）——本脚本会 fetch/merge 并强制停止进程，禁止对共享主工作区执行；请改用专用 worktree（如 D:\Data\projects\mp-worktrees\mp-desktop-dev），或 -ForceShared 显式确认（高风险，不推荐）"
}
Write-Line "branch   : $branch"
Write-Line "head     : $head"

# ---- 2. 同步最新（可选）----
if (-not $NoSync) {
  git -C $repoRoot fetch origin 2>$null | Out-Null
  $counts = git -C $repoRoot rev-list --left-right --count HEAD...origin/main 2>$null
  Write-Line "sync     : ahead/behind origin/main = $counts"
  if ($counts) {
    $parts = ($counts.Trim() -split '\s+')
    if ($parts.Count -eq 2 -and [int]$parts[1] -gt 0) {
      $behind = [int]$parts[1]
      $ahead = [int]$parts[0]
      if ($ahead -gt 0) {
        # 分叉状态（本地领先 + 落后）：--ff-only 必然失败，fallback 到普通 merge
        Write-Line "sync     : 分叉状态（领先 $ahead / 落后 $behind），执行 merge origin/main ..."
        git -C $repoRoot merge origin/main 2>&1 | ForEach-Object { Write-Line "  $_" }
        if ($LASTEXITCODE -ne 0) { Fail 'merge origin/main 失败（可能脏文件冲突），请先处理未提交修改' }
      } else {
        # 仅落后：可 fast-forward
        Write-Line 'sync     : 落后 origin/main，执行 merge --ff-only ...'
        git -C $repoRoot merge --ff-only origin/main 2>&1 | ForEach-Object { Write-Line "  $_" }
        if ($LASTEXITCODE -ne 0) { Fail 'merge --ff-only 失败（可能脏文件冲突），请先处理未提交修改' }
      }
    }
  }
  # 合并后验证落后数必须为 0，否则 Fail（防旧代码启动）
  $after = git -C $repoRoot rev-list --left-right --count HEAD...origin/main 2>$null
  if ($after) {
    $ap = ($after.Trim() -split '\s+')
    if ($ap.Count -eq 2 -and [int]$ap[1] -gt 0) {
      Fail "同步后仍落后 origin/main（$after），拒绝启动——避免用旧代码启动。请先处理同步问题"
    }
  }
  $evidence.head = git -C $repoRoot log -1 --format='%h %s'
}

# ---- 3. 端口解析（worktree 独立端口：mp-worktrees 下按路径稳定派生，杜绝并发互抢）----
$portScript = Join-Path $repoRoot 'apps/desktop/scripts/dev-ports.js'
$portErr = $null
$portsJson = & $nodeExe -e 'const { resolveDevPorts } = require(process.argv[1]); process.stdout.write(JSON.stringify(resolveDevPorts(process.argv[2])))' $portScript $repoRoot 2>$portErr
if ($LASTEXITCODE -ne 0 -or -not $portsJson) { Fail "端口解析失败（dev-ports.js）exit=${LASTEXITCODE}: $portErr" }
try { $ports = $portsJson | ConvertFrom-Json } catch { Fail "端口 JSON 解析失败: $($_.Exception.Message) - 原文: $portsJson" }
if (-not $ports -or -not $ports.vite -or -not $ports.cdp) { Fail "端口解析结果不完整（dev-ports.js）: $portsJson" }
$vitePort = [int]$ports.vite
$cdpPort = [int]$ports.cdp
$evidence.vitePort = $vitePort
$evidence.cdpPort = $cdpPort
$portTag = if ($ports.derived) { '（worktree 派生）' } else { '（默认）' }
Add-Audit 'PORTS' "vite=$vitePort cdp=$cdpPort derived=$($ports.derived)"
Write-Line "ports    : vite=$vitePort cdp=$cdpPort $portTag"

# ---- 3b. 端口归属检查（fail-closed）----
$conn = Get-NetTCPConnection -LocalPort $vitePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
  $ownerCmd = $owner.CommandLine
  if ($ownerCmd -and ($ownerCmd -match [regex]::Escape($repoRoot + [char]92))) {
    Add-Audit "STOP vite" "pid=$($conn.OwningProcess) cmd=$ownerCmd"
    Write-Line "port$vitePort : 本 worktree 的残留 Vite（PID $($conn.OwningProcess)），先停止"
    Stop-Process -Id $conn.OwningProcess -Force
  } else {
    Fail "$vitePort 被其他 worktree/进程占用（PID $($conn.OwningProcess): $ownerCmd）——拒绝启动，避免加载错误代码"
  }
}

# ---- 4. 清理旧实例（单实例锁）----
$oldElectron = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$repoRoot*" }
foreach ($p in $oldElectron) { Stop-ProcessIfAlive -ProcessId $p.Id -Label 'electron' }
$oldLaunchers = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match [regex]::Escape($repoRoot + [char]92) -and ($_.CommandLine -like '*dev.js*' -or $_.CommandLine -like "*vite*${vitePort}*" -or $_.CommandLine -like '*vite*5174*') }
foreach ($p in $oldLaunchers) { Stop-ProcessIfAlive -ProcessId $p.ProcessId -Label 'node' }
Add-Audit 'CLEAN' "oldElectron=$($oldElectron.Count) oldLaunchers=$($oldLaunchers.Count)"
Start-Sleep -Seconds 2

# ---- 3c. CDP 端口归属检查（fail-closed）----
$cdpConn = Get-NetTCPConnection -LocalPort $cdpPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($cdpConn) {
  $cdpOwner = Get-CimInstance Win32_Process -Filter "ProcessId=$($cdpConn.OwningProcess)"
  $cdpCmd = $cdpOwner.CommandLine
  if ($cdpCmd -and ($cdpCmd -match [regex]::Escape($repoRoot + [char]92))) {
    Add-Audit "STOP cdp-electron" "pid=$($cdpConn.OwningProcess) cmd=$cdpCmd"
    Write-Line "port$cdpPort : 本 worktree 的残留 Electron（PID $($cdpConn.OwningProcess)），先停止"
    Stop-Process -Id $cdpConn.OwningProcess -Force
  } else {
    Fail "$cdpPort 被其他 worktree/进程占用（PID $($cdpConn.OwningProcess): $cdpCmd）——拒绝启动，避免身份/CDP 读错对象"
  }
}
# ---- 3d. Profile 单实例锁跨 worktree 冲突检查（fail-closed）----
$profileLockModule = Join-Path $PSScriptRoot 'desktop-profile-lock.ps1'
if (Test-Path -LiteralPath $profileLockModule) {
  . $profileLockModule
  $lockReport = Get-ProfileLockReport -ProfilePath $Profile -RepoRoot $repoRoot
  $evidence.profileLockOwners = @($lockReport.Owners).Count
  $evidence.profileLockForeign = @($lockReport.Foreign).Count
  Write-Line "profile  : 同 profile Electron 占用 same=$($lockReport.Same.Count) foreign=$($lockReport.Foreign.Count)"
  if ($lockReport.HasForeign) {
    $foreignDesc = (($lockReport.Foreign | ForEach-Object { "PID $($_.Pid) @ $($_.ExePath)" }) -join '; ')
    if ($StopForeignProfile) {
      Add-Audit 'STOP foreign-profile' $foreignDesc
      foreach ($p in $lockReport.ForeignMain) { Stop-ProcessIfAlive -ProcessId $p.Pid -Label 'foreign-profile-electron' }
      Start-Sleep -Seconds 2
      Write-Line "profile  : 已审计停止其他 worktree 的 Electron（$($lockReport.ForeignMain.Count) 个主进程）"
    } else {
      Fail "profile '$Profile' 正被其他 worktree 的 Electron 占用（$foreignDesc）。单实例锁互杀会导致窗口空白；请先停止该实例，或加 -StopForeignProfile 让脚本审计停止后继续"
    }
  }
} else {
  Write-Line 'profile  : desktop-profile-lock.ps1 缺失，跳过跨 worktree profile 锁检查'
}

# ---- 5. 依赖健康 ----
if (-not $NoDepsCheck) {
  $ensure = Join-Path $repoRoot 'scripts\ensure-desktop-deps.js'
  if (Test-Path -LiteralPath $ensure) {
    Write-Line 'deps     : 运行 ensure-desktop-deps.js（自检+自愈）...'
    Push-Location $repoRoot
    try {
      & $nodeExe scripts/ensure-desktop-deps.js 2>&1 | ForEach-Object { Write-Line "  $_" }
      if ($LASTEXITCODE -ne 0) { Fail '依赖自愈未通过（ensure-desktop-deps 非零）' }
    } finally { Pop-Location }
  } else {
    Write-Line 'deps     : ensure-desktop-deps.js 未合入 main，内建最小脆弱依赖检查（PR #714 合并后自动升级）'
    $fragile = @(
      @{ Name = '@img\sharp-win32-x64'; Files = @('index.cjs', 'lib\sharp-win32-x64-0.35.1.node') },
      @{ Name = '@img\colour'; Files = @('index.cjs') },
      @{ Name = '@element-plus\icons-vue'; Files = @('dist\index.js') },
      @{ Name = '@ctrl\tinycolor'; Files = @('dist\public_api.js') }
    )
    foreach ($f in $fragile) {
      $dir = Join-Path $repoRoot ("node_modules\" + $f.Name)
      $missing = @($f.Files | Where-Object { -not (Test-Path -LiteralPath (Join-Path $dir $_)) })
      if (-not (Test-Path -LiteralPath $dir) -or $missing.Count -gt 0) {
        Fail "脆弱依赖不完整: $($f.Name)（缺失 $($missing -join ', ')）——请先在含 PR #714 的 worktree 运行 node scripts/ensure-desktop-deps.js"
      }
    }
    Write-Line 'deps     : 最小检查通过'
  }
}

# ---- 5b. Vite 缓存失效（可选）----
if ($InvalidateViteCache) {
  $viteDeps = Join-Path $repoRoot 'apps\desktop\node_modules\.vite\deps'
  if (Test-Path -LiteralPath $viteDeps) {
    $newName = $viteDeps + '.stale-' + (Get-Date -Format 'yyyyMMddHHmmss')
    Rename-Item -LiteralPath $viteDeps -NewName $newName
    Write-Line "vite     : 缓存失效 -> $newName"
    $evidence.viteCacheInvalidated = $newName
  } else {
    Write-Line 'vite     : 无陈旧缓存'
  }
}

# ---- 6. 启动 ----
$launcherLog = Join-Path $env:TEMP 'mp-start-dev.out.log'
$launcherErr = Join-Path $env:TEMP 'mp-start-dev.err.log'
$env:MP_VITE_PORT = "$vitePort"
$env:MP_CDP_PORT = "$cdpPort"
$env:ELECTRON_USER_DATA_DIR = $Profile
$launcher = Start-Process $nodeExe -WorkingDirectory (Join-Path $repoRoot 'apps\desktop') -ArgumentList 'scripts/dev.js' -WindowStyle Hidden -RedirectStandardOutput $launcherLog -RedirectStandardError $launcherErr -PassThru
$evidence.launcherPid = $launcher.Id
Add-Audit 'LAUNCHER' "pid=$($launcher.Id) log=$launcherLog"
Write-Line "launcher : PID $($launcher.Id)（log: $launcherLog）"

# ---- 7. 轮询可见窗口 ----
$deadline = (Get-Date).AddSeconds(150)
$win = $null
while ((Get-Date) -lt $deadline) {
  $win = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$repoRoot*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($win) { break }
  Start-Sleep -Seconds 3
}
if (-not $win) {
  Write-Host 'ERROR: 150s 内未出现可见主窗口' -ForegroundColor Red
  Get-Content $launcherErr -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  exit 1
}
$evidence.electronPid = $win.Id
$evidence.windowHandle = $win.MainWindowHandle
$evidence.windowTitle = $win.MainWindowTitle
Add-Audit 'WINDOW' "pid=$($win.Id) handle=$($win.MainWindowHandle) title=$($win.MainWindowTitle)"
Write-Line "window   : PID $($win.Id) handle=$($win.MainWindowHandle) title=$($win.MainWindowTitle)"

# ---- 8. 证据：Vite 归属 + 页面 URL + (可选) identity ----
$conn2 = Get-NetTCPConnection -LocalPort $vitePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn2) {
  $viteOwner = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn2.OwningProcess)"
  $evidence.vitePid = $conn2.OwningProcess
  $evidence.viteCmdline = $viteOwner.CommandLine
  Write-Line ("vite     : PID " + $conn2.OwningProcess)
}
try {
  $page = (Invoke-RestMethod -Uri "http://127.0.0.1:$cdpPort/json/list" -TimeoutSec 5) | Where-Object { $_.type -eq 'page' -and $_.url -like "http://127.0.0.1:${vitePort}*" } | Select-Object -First 1
  if ($page) { $evidence.pageUrl = $page.url; Write-Line "page     : $($page.url)" }
} catch { Write-Line 'page     : CDP 未就绪（跳过）' }

if ($CheckIdentity) {
  $idJs = Join-Path $PSScriptRoot 'start-desktop-identity.js'
  $idOut = & $nodeExe $idJs 2>$null
  $evidence.identity = $idOut
  Write-Line "identity : $idOut"
}

Add-Audit 'OK' "head=$head branch=$branch"
Write-Line 'START_CONTRACT_OK'
if ($Json) { $evidence | ConvertTo-Json -Depth 6 }
exit 0





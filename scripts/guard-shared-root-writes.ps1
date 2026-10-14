<#
.SYNOPSIS
    Multi-Publish 共享主目录实时写保护。
.DESCRIPTION
    监听共享 main worktree，把守卫目录下非 gitignored 的运行时文件写入移入仓库外
    隔离目录；tracked 文件从 HEAD 精确恢复。docs/scripts/openspec 等允许目录放行。
    支持 -ProcessPaths 单次处理（测试用）、-Reconcile 全量对账（单次，运维/测试用）
    与 -Watch 常驻三种模式。

    -Watch 启动时会先跑一次 -Reconcile 全量对账再进入事件循环：watcher 只对**实时**
    事件起作用，本进程未运行期间（AtLogOn 拉起前、崩溃、重启）或事件因缓冲区溢出
    被丢弃时发生的漂移**永远不会被回看**，于是「guard 是 Running、violations.jsonl
    是空的」与「共享根已漂移数天」可以同时为真（2026-10-13 实测：59 个漂移的运行时
    文件里 56 个没有任何记录，最早的已存在 8 天）。
#>
[CmdletBinding()]
param(
    [string]$Root = '',
    [string]$QuarantineRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Mulpub\session-isolation\quarantine'),
    [string]$GitPath = '',
    [string[]]$ProcessPaths,
    [switch]$Watch,
    [switch]$Reconcile,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\','/')
$quarantine = [IO.Path]::GetFullPath($QuarantineRoot).TrimEnd('\','/')
New-Item -ItemType Directory -Force -Path $quarantine | Out-Null

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

# Top-level directory segments that must never be watched. They generate
# massive event storms during git operations (.git/objects, index) and builds
# (node_modules/, dist/), which overflow the FileSystemWatcher buffer and crash
# the watcher. They are gitignored / internal and never hold guard-relevant
# runtime writes, so excluding them at the event-collection stage both removes
# the storm source and avoids needless git calls per event.
$script:excludedSegments = @('.git', 'node_modules', '.vite', 'dist', 'dist-electron', '.playwright-browsers', '.idea', '.turbo', '.codegraph')

function Test-ExcludedSegment([string]$Path) {
    foreach ($seg in $script:excludedSegments) {
        if ($Path -match "(?<![\w-])[\\/]?$([regex]::Escape($seg))[\\/]") { return $true }
    }
    return $false
}

# 对抗评审产物（.adversarial）与 .ccg 同性质：纯 .md + .json、已跟踪入库（174 个文件）、
# 且 classify-docs-only.js 的 docs 白名单已含 .adversarial/**。两份名单必须一致——
# 漏项的后果：评审产物每写一次就被隔离一次（实测一轮评审 11 个文件全被移走），
# 评审记录在共享主目录永远留不下来。
# 2026-10-14 实测：本处两份名单与 classify-docs-only.js 的 CI_IGNORED_PATHS 互不认账，
# 漂移面 181 个**已追踪**文件（.quality-rhythm 156 / 根级 .md 与 .gitignore 23 / .claude 1 / .agents 1）。
# 后果不是报错而是静默撤销：在共享根改 .gitignore，1 秒后被搬进隔离区并从 HEAD 回滚
# （violations.jsonl 现场：quarantined-tracked @ .gitignore，2026-10-14T11:07:20Z）。
# 同形第二次（第一次是 #3272 放行 .adversarial），所以由 scripts/check-guard-classify-alignment.js
# 逐项对账钉住，且其债务清单只能缩小。LICENSE/.editorconfig 虽在 classify 名单内但实测未被追踪，
# 不为它们建死条目；根级其余 22 个 .md 属历史残留，进对账锁的缩小清单而非本名单（不固化垃圾）。
$allowedTop = @('docs','01-docs','scripts','openspec','.ccg','.agent_context','.hermes','.adversarial','.quality-rhythm','.claude','.agents')
$allowedRootFiles = @('AGENTS.md','README.md','CHANGELOG.md','.quality-gates.md','.gitignore')
$script:ignoreUntil = @{}

function Get-RelativePath([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path)) { $Path = Join-Path $root $Path }
    $full = [IO.Path]::GetFullPath($Path)
    $rootKey = $root.TrimEnd('\','/') + '\'
    if ($full.StartsWith($rootKey, [StringComparison]::OrdinalIgnoreCase)) {
        return $full.Substring($rootKey.Length).Replace('\','/')
    }
    throw "path outside shared root: $Path"
}

function Test-AllowedPath([string]$relative) {
    if ($relative -eq '') { return $true }
    $parts = $relative.Split('/')
    if ($parts[0] -eq '.git') { return $true }
    if ($allowedTop -contains $parts[0]) { return $true }
    if ($parts.Count -eq 1 -and $allowedRootFiles -contains $relative) { return $true }
    return $false
}

function Test-TrackedFile([string]$relative) {
    $out = @(Git @('ls-files','--stage','--',$relative) 2>$null)
    return ($out.Count -eq 1 -and $out[0] -match '^100(644|755|120000)\s')
}

function Test-MatchesIndex([string]$relative, [string]$full) {
    # 内容与 index（=HEAD，clean 树）一致则放行。
    # 修复隔离风暴：restore/checkout 重写同一文件会再次触发事件，
    # 仅靠 ignoreUntil(3s) 无法覆盖延迟事件，导致隔离->恢复->再隔离自持循环。
    $stage = @(Git @('ls-files','--stage','--',$relative) 2>$null)
    if ($stage.Count -ne 1 -or $stage[0] -notmatch '^100(644|755|120000)\s([0-9a-f]{40})\s') { return $false }
    $indexHash = $Matches[2]
    # git 2.55 起 hash-object 的 --path 与 --no-filters 互斥（usage: [--path=<file> | --no-filters]），
    # 同时传会直接 error 而非降级；原始字节口径无需 --path，过滤器口径见下一行的 $filteredHash。
    $diskHash = @(Git @('hash-object','--no-filters','--',$full) 2>$null)
    if ($diskHash.Count -ge 1 -and $diskHash[0].Trim() -eq $indexHash) { return $true }
    $filteredHash = @(Git @('hash-object','--path',$relative,'--',$full) 2>$null)
    return ($filteredHash.Count -ge 1 -and $filteredHash[0].Trim() -eq $indexHash)
}

function Test-GitIgnored([string]$relative) {
    $null = Git @('check-ignore','-q','--',$relative) 2>$null
    return $LASTEXITCODE -eq 0
}

function Write-Violation([string]$relative, [string]$action, [long]$size, [string]$detail = '') {
    $entry = @{
        ts     = (Get-Date).ToUniversalTime().ToString('o')
        path   = $relative
        action = $action
        size   = $size
        detail = $detail
    } | ConvertTo-Json -Compress
    try {
        Add-Content -LiteralPath (Join-Path $quarantine 'violations.jsonl') -Value $entry -Encoding UTF8 -ErrorAction Stop
    } catch {
        Write-Warning "cannot append violation log for $relative`: $($_.Exception.Message)"
    }
    # 会话可见告警：隔离动作同时写共享根 .agent_context/write-guard-alert.json，
    # 让未来会话进入共享主目录时直接感知违规并改用隔离 worktree（violations.jsonl 在 LocalAppData，会话默认不可见）。
    try {
        $alertDir = Join-Path $root '.agent_context'
        New-Item -ItemType Directory -Force -Path $alertDir | Out-Null
        $alert = @{
            ts     = (Get-Date).ToUniversalTime().ToString('o')
            path   = $relative
            action = $action
            size   = $size
            detail = $detail
            hint   = 'Shared main dir is read-only for runtime paths (apps/ packages/ ops-center/ config/ .github/). Edit inside an isolated worktree: scripts/start-mp-task.ps1 -TaskName <task>'
        } | ConvertTo-Json -Compress
        $alertPath = Join-Path $alertDir 'write-guard-alert.json'
        $tmpPath = $alertPath + '.tmp'
        Set-Content -LiteralPath $tmpPath -Value $alert -Encoding UTF8 -ErrorAction Stop
        Move-Item -LiteralPath $tmpPath -Destination $alertPath -Force -ErrorAction Stop
    } catch {
        Write-Warning "cannot write write-guard-alert for $relative`: $($_.Exception.Message)"
    }
}

function Restore-Tracked([string]$relative) {
    $null = Git @('restore','--source=HEAD','--worktree','--',$relative) 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git restore failed for $relative" }
    $script:ignoreUntil[$relative] = (Get-Date).AddSeconds(3)
}

function Invoke-GuardPath([string]$Path) {
    $relative = Get-RelativePath $Path
    $result = [ordered]@{ path = $relative; action = 'skipped'; detail = '' }
    if (Test-AllowedPath $relative) { return $result }

    $full = Join-Path $root ($relative.Replace('/','\'))
    if (Test-Path -LiteralPath $full -PathType Container) { return $result }
    $exists = Test-Path -LiteralPath $full -PathType Leaf
    $tracked = Test-TrackedFile $relative
    if (-not $exists -and -not $tracked) { return $result }
    if (-not $tracked -and (Test-GitIgnored $relative)) { return $result }
    if ($exists -and $tracked -and (Test-MatchesIndex $relative $full)) { return $result }

    if (-not $exists) {
        if ($tracked) {
            try {
                Restore-Tracked $relative
                $result.action = 'restored-deleted'
            } catch {
                $result.action = 'restore-failed'
                $result.detail = $_.Exception.Message
            }
            Write-Violation $relative $result.action 0 $result.detail
        }
        return $result
    }

    $size = (Get-Item -LiteralPath $full).Length
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
    $safe = $relative.Replace('/','_')
    $dest = Join-Path $quarantine ($stamp + '-' + $safe)
    $counter = 1
    while (Test-Path -LiteralPath $dest) {
        $dest = Join-Path $quarantine ($stamp + '-' + $counter + '-' + $safe)
        $counter++
    }

    $moved = $false
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        try {
            Move-Item -LiteralPath $full -Destination $dest -Force -ErrorAction Stop
            $moved = $true
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }

    if ($moved) {
        if ($tracked) {
            try {
                Restore-Tracked $relative
                $result.action = 'quarantined-tracked'
            } catch {
                $result.action = 'quarantined-restore-failed'
                $result.detail = $_.Exception.Message
            }
        } else {
            $result.action = 'quarantined-untracked'
        }
    } else {
        $result.action = 'move-failed'
        $result.detail = 'file locked or unavailable after bounded retries'
    }
    Write-Violation $relative $result.action $size $result.detail
    return $result
}

function Invoke-GuardPaths([string[]]$Paths) {
    # 返回结构化结果而不是「日志 + int 混在管线里」：后者会让 `$failures = Invoke-GuardPaths ...`
    # 拿到字符串数组，`-gt 0` 退化成对字符串逐元素比较，rc 判据失真。
    $failures = 0
    $logs = New-Object 'System.Collections.Generic.List[string]'
    foreach ($path in $Paths) {
        if ([string]::IsNullOrWhiteSpace($path)) { continue }
        try {
            $result = Invoke-GuardPath $path
            $logs.Add(("[{0}] {1} {2}" -f $result.action, $result.path, $result.detail))
            if ($result.action -in @('move-failed','restore-failed','quarantined-restore-failed')) { $failures++ }
        } catch {
            $logs.Add(("[error] {0} : {1}" -f $path, $_.Exception.Message))
            $failures++
        }
    }
    [pscustomobject]@{ Failures = $failures; Logs = $logs.ToArray() }
}

<#
  Startup reconciliation (2026-10-13, change: guard-startup-reconcile).

  Why it exists: the watcher only reacts to LIVE FileSystemWatcher events. Anything
  written while this process is not running (AtLogOn restart, crash, reboot) or lost
  to a buffer overflow is never revisited, so the drift persists indefinitely. The
  guard then reports Running with an empty violations log while the shared root has
  been dirty for days — the failure is silent exactly where it matters.
  Measured 2026-10-13 on this repo: 56 of 59 drifted runtime files had NO record at
  all, the oldest 8 days old; health.json said `clean: false` the whole time.

  Deliberate scope: tracked drift only (modified + deleted). Untracked non-ignored
  files stay the live watcher's job — sweeping a whole backlog of them at startup
  has a much larger blast radius for no extra safety on the tracked invariant.

  Uses ONE `git status` instead of per-file `ls-files`: the protected prefixes hold
  ~8.6k tracked files and a per-file probe would mean thousands of git invocations
  at startup, blocking the watcher for minutes. Semantics are equivalent — a file
  matching the index is judged `skipped` by Invoke-GuardPath anyway.
#>
function Get-Driftset {
    $prefixes = @('apps','packages','ops-center','config','.github')
    $gitArgs = @('status','--porcelain','--untracked-files=no','--') + @($prefixes | ForEach-Object { "$_/" })
    $out = @(Git $gitArgs 2>$null)
    if ($LASTEXITCODE -ne 0) { throw "git status failed while reconciling (exit $LASTEXITCODE)" }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    $paths = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in $out) {
        if ($line.Length -lt 4) { continue }
        $rel = $line.Substring(3).Trim()
        # 重命名形如 `R  old -> new`，只处理新路径
        if ($rel -match ' -> ') { $rel = ($rel -split ' -> ')[-1].Trim() }
        $rel = $rel.Trim('"')
        if (-not $rel) { continue }
        # 引号路径含 C 风格转义（非 ASCII 文件名）时不做猜测：出声告警而非静默跳过
        if ($rel -match '\\') {
            Write-Warning "reconcile: 跳过无法安全解析的转义路径（请手工核查）: $rel"
            continue
        }
        if (Test-AllowedPath $rel) { continue }
        if ($seen.Add($rel)) { $paths.Add((Join-Path $root ($rel.Replace('/','\')))) }
    }
    return ,$paths
}

function Invoke-ReconcilePass {
    # 返回结构化对象、**不**在里面 Write-Output：否则日志行会与返回值一起被调用点
    # 的 `$x = Invoke-ReconcilePass` 捕获走（日志被吞 + `-gt 0` 退化成逐元素比较）。
    # 这个形态在同一文件里刚修过一次，函数边界上不得重犯。
    $paths = Get-Driftset
    if ($paths.Count -eq 0) {
        return [pscustomobject]@{ Drifted = 0; Failures = 0; Logs = @() }
    }
    $result = Invoke-GuardPaths $paths
    [pscustomobject]@{ Drifted = $paths.Count; Failures = $result.Failures; Logs = $result.Logs }
}

if ($ProcessPaths) {
    $result = Invoke-GuardPaths $ProcessPaths
    foreach ($line in $result.Logs) { if (-not $Quiet) { Write-Output $line } }
    if ($result.Failures -gt 0) { exit 1 }
    exit 0
}

if ($Reconcile) {
    # 单次全量对账（运维/测试用）。默认非静默：这是「静默盲区」的修复，
    # 把自己的产出也做成静默的等于换个地方藏同一类问题。
    $pass = Invoke-ReconcilePass
    if (-not $Quiet) {
        Write-Output ("[reconcile] drifted tracked runtime paths: {0}" -f $pass.Drifted)
        foreach ($line in $pass.Logs) { Write-Output $line }
    }
    if ($pass.Failures -gt 0) { exit 1 }
    exit 0
}

if (-not $Watch) {
    # Use throw (not Write-Error+exit) so that dot-sourcing the script for
    # testing/function reuse does not terminate the host session.
    throw "need either -Watch or -ProcessPaths"
}

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $root
$watcher.IncludeSubdirectories = $true
$watcher.Filter = '*'
$watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::CreationTime -bor [System.IO.NotifyFilters]::Size -bor [System.IO.NotifyFilters]::DirectoryName
$sources = @('guard.created','guard.changed','guard.renamed','guard.deleted')
$null = Register-ObjectEvent -InputObject $watcher -EventName Created -SourceIdentifier $sources[0]
$null = Register-ObjectEvent -InputObject $watcher -EventName Changed -SourceIdentifier $sources[1]
$null = Register-ObjectEvent -InputObject $watcher -EventName Renamed -SourceIdentifier $sources[2]
$null = Register-ObjectEvent -InputObject $watcher -EventName Deleted -SourceIdentifier $sources[3]
<#
  Buffer-overflow guard: when the event rate exceeds the internal buffer,
  FileSystemWatcher raises an Error event instead of delivering events. Without
  handling it the watcher effectively goes blind / self-destructs. We drain the
  collected events and keep watching rather than exiting.
#>
$null = Register-ObjectEvent -InputObject $watcher -EventName Error -SourceIdentifier 'guard.error' -Action {
    try {
        $e = $Event.SourceEventArgs
        if ($e -and $e.GetException) {
            Write-Warning ("guard buffer overflow / watcher error: " + $e.GetException().Message)
        }
    } catch {
        Write-Warning ("guard error event handling failed: " + $_.Exception.Message)
    }
}
$watcher.EnableRaisingEvents = $true

function Invoke-GuardCycle {
    $pending = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($source in $sources) {
        $events = @(Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue)
        foreach ($eventItem in $events) {
            $args = $eventItem.SourceEventArgs
            $paths = @()
            if ($args -is [System.IO.RenamedEventArgs]) {
                if ($args.FullPath) { $paths += $args.FullPath }
                if ($args.OldFullPath) { $paths += $args.OldFullPath }
            } elseif ($args -and $args.FullPath) {
                $paths += $args.FullPath
            }
            foreach ($p in $paths) {
                # Drop storm-source paths at collection time (cheap, no git call).
                if (-not (Test-ExcludedSegment $p)) { $null = $pending.Add($p) }
            }
            Remove-Event -EventIdentifier $eventItem.EventIdentifier -ErrorAction SilentlyContinue
        }
    }
    foreach ($path in $pending) {
        try {
            $relative = Get-RelativePath $path
        } catch {
            continue
        }
        if ($script:ignoreUntil.ContainsKey($relative)) {
            if ((Get-Date) -lt $script:ignoreUntil[$relative]) { continue }
            $script:ignoreUntil.Remove($relative)
        }
        try {
            $result = Invoke-GuardPath $path
            if (-not $Quiet -and $result.action -ne 'skipped') {
                Write-Output ("[{0}] {1} {2}" -f $result.action, $result.path, $result.detail)
            }
        } catch {
            Write-Warning "watch processing failed for $path`: $($_.Exception.Message)"
        }
    }
}

# 进入事件循环前先跑一次全量对账，补上「进程未运行期间 / 事件被缓冲区丢弃期间」产生的漂移。
# 放在 EnableRaisingEvents 之后：这样对账自身的恢复动作也会走事件流并被 ignoreUntil 吸收，
# 而不会与 watcher 互相打架。失败不阻断监听——守卫瞎着比半瞎更糟，但要出声。
try {
    $reconcile = Invoke-ReconcilePass
    if (-not $Quiet) {
        Write-Output ("[reconcile] drifted tracked runtime paths: {0}" -f $reconcile.Drifted)
        foreach ($line in $reconcile.Logs) { Write-Output $line }
    }
    if ($reconcile.Failures -gt 0) {
        Write-Warning ("startup reconcile had {0} failed path(s); check violations.jsonl" -f $reconcile.Failures)
    }
} catch {
    Write-Warning ("startup reconcile failed, continuing to watch: " + $_.Exception.Message)
}

try {
    while ($true) {
        try {
            # Drain any pending buffer-overflow errors and run one guard cycle.
            $errEvents = @(Get-Event -SourceIdentifier 'guard.error' -ErrorAction SilentlyContinue)
            foreach ($e in $errEvents) { Remove-Event -EventIdentifier $e.EventIdentifier -ErrorAction SilentlyContinue }
            Invoke-GuardCycle
        } catch {
            # Never let an unexpected exception kill the watcher; log and keep looping.
            Write-Warning ("guard cycle threw, continuing: " + $_.Exception.Message)
        }
        Start-Sleep -Milliseconds 400
    }
} finally {
    $watcher.EnableRaisingEvents = $false
    $watcher.Dispose()
    foreach ($source in $sources) {
        Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
    }
    Get-Event -SourceIdentifier 'guard.error' -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
}

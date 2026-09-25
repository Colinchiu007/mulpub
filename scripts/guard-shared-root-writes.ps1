<#
.SYNOPSIS
    Multi-Publish 共享主目录实时写保护。
.DESCRIPTION
    监听共享 main worktree，把守卫目录下非 gitignored 的运行时文件写入移入仓库外
    隔离目录；tracked 文件从 HEAD 精确恢复。docs/scripts/openspec 等允许目录放行。
    支持 -ProcessPaths 单次处理（测试用）与 -Watch 常驻两种模式。
#>
[CmdletBinding()]
param(
    [string]$Root = '',
    [string]$QuarantineRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Multi-Publish\session-isolation\quarantine'),
    [string]$GitPath = '',
    [string[]]$ProcessPaths,
    [switch]$Watch,
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

$allowedTop = @('docs','01-docs','scripts','openspec','.ccg','.agent_context','.hermes')
$allowedRootFiles = @('AGENTS.md','README.md','CHANGELOG.md','.quality-gates.md')
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
    $failures = 0
    foreach ($path in $Paths) {
        if ([string]::IsNullOrWhiteSpace($path)) { continue }
        try {
            $result = Invoke-GuardPath $path
            if (-not $Quiet) {
                Write-Output ("[{0}] {1} {2}" -f $result.action, $result.path, $result.detail)
            }
            if ($result.action -in @('move-failed','restore-failed','quarantined-restore-failed')) { $failures++ }
        } catch {
            Write-Warning "guard processing failed for $path`: $($_.Exception.Message)"
            $failures++
        }
    }
    return $failures
}

if ($ProcessPaths) {
    $failures = Invoke-GuardPaths $ProcessPaths
    if ($failures -gt 0) { exit 1 }
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

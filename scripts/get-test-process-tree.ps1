<#
.SYNOPSIS
    从根进程出发收集其后代进程树，带 PID 复用防护。

.DESCRIPTION
    调用方（CI 的 Gate 4 / Desktop shards）在 pnpm 退出后用本函数判断"有没有漏下测试子
    进程"，并对结果逐个 `taskkill /T /F`。

    旧实现只按数字 ParentProcessId 递归，而根 PID 在根进程退出后会被 Windows 回收。一旦
    回收者的编号恰好等于某个长命系统进程**所记录的**父 PID，那些开机期就存在的进程就会被
    认成测试子进程 —— 实测 run 36519025075 attempt 1 认出了 csrss.exe / winlogon.exe /
    fontdrvhost.exe / dwm.exe，随后对它们下 taskkill /F（在 runner 上只得到拒绝访问，所以
    表现为一条莫名的红而不是事故）。

    防护用的不变量与进程名、镜像路径都无关：**子进程的创建时间不得早于其父进程**。真实的
    node / electron / python 测试子进程一定晚于其父启动，因此不会被漏掉；而开机期进程永远
    早于任何 runner 进程，因此不可能被认成后代。按名字或路径前缀做黑名单都会漏（工具缓存里
    的 node.exe 不在 workspace 下），故不采用。

.NOTES
    本文件被 dot-source 使用（只提供函数、不执行任何动作），因此刻意不写顶层 param 块。
#>

function Get-TestProcessTree {
    param(
        [Parameter(Mandatory = $true)][int] $RootProcessId,
        # 根进程的创建时间下界锚点（调用方在 Start-Process **之前**取一次 Get-Date）。
        # 缺省为 MinValue = 不启用时间防护，仅用于单元测试里复现旧行为。
        [datetime] $NotBefore = [datetime]::MinValue,
        # 注入点：默认取真实进程表；测试传入构造的 PSCustomObject 数组以做到完全确定。
        [array] $Processes
    )

    if (-not $Processes) { $Processes = @(Get-CimInstance -ClassName Win32_Process) }

    $toDateTime = {
        param ($value, $label)
        # 时间字段读不出来时必须**响亮失败**：静默放行会让这条防护变成恒真的装饰门禁。
        if ($null -eq $value) { throw "[process-tree] $label 缺少 CreationDate，无法判定父子时序" }
        try { return [datetime] $value } catch { throw "[process-tree] $label 的 CreationDate 无法解析: $value" }
    }

    # 刻意用普通数组而非 List[object]：后者与 @() 做 + 会抛 System.ArgumentException
    # "Argument types do not match"（实测），而这里的量级用 += 完全够。
    $accepted = @()
    $rejectedByTime = @()
    $expanded = [System.Collections.Generic.HashSet[int]]::new()
    [void] $expanded.Add($RootProcessId)

    $stack = New-Object System.Collections.Generic.Stack[object]
    $stack.Push(@{ Id = $RootProcessId; Created = $NotBefore })

    while ($stack.Count -gt 0) {
        $node = $stack.Pop()
        foreach ($proc in $Processes) {
            $procId = [int] $proc.ProcessId
            if ($procId -eq $RootProcessId) { continue }
            if ([int] $proc.ParentProcessId -ne $node.Id) { continue }

            $created = & $toDateTime $proc.CreationDate "PID $procId"
            if ($created -lt $node.Created) {
                $rejectedByTime += $proc
                continue
            }
            if (-not $expanded.Add($procId)) { continue }

            $accepted += $proc
            $stack.Push(@{ Id = $procId; Created = $created })
        }
    }

    # 根进程若仍在表里就一并返回（与旧实现一致：那意味着根其实没退出）。
    $root = @($Processes | Where-Object { [int] $_.ProcessId -eq $RootProcessId })
    $result = @($root) + @($accepted)

    Write-Host ("[process-tree] scanned={0} descendants={1} rejected-by-time={2} root={3} notBefore={4}" -f `
        @($Processes).Count, $accepted.Count, $rejectedByTime.Count, $RootProcessId, $NotBefore.ToString('o'))

    return $result
}

<#
.SYNOPSIS
    把进程树的一行投影成可 grep 的单行文本（含命令行原文）。

.DESCRIPTION
    `Get-TestProcessTree` 的结果直接喂给 `Format-Table` 时，显示列由 Win32_Process 的
    默认格式集决定 —— ProcessId / Name / HandleCount / WorkingSetSize / VirtualSize。
    **命令行不在其中**，而调用方真正要回答的问题是"是哪个包的测试还挂着"：
    2026-10-11 那次 Gate 4 跑到 30 分钟预算到点，日志里 13 个存活进程全是
    `node.exe`（working set 相近），从表格读不出任何归属，排查只能靠猜。

    这里刻意**不改** `Get-TestProcessTree` 的输出形状：它的结果同时被
    `$remainingTestProcesses.Count` 计数、被 `taskkill /PID` 消费，改形状会把那些
    既有判据一起牵动。投影单独成函数，只在"要给人看"的分支调用。

    命令行取不到时（权限不足、或注入的夹具没有这个属性）如实写 `<unreadable>`，
    不得留空 —— 空串读起来像"这进程没命令行"，而真实含义是"我没读到"。
    空白折叠成单个空格并截断，保证一条记录一行，便于 CI 日志按行 grep。
#>
function Format-TestProcessTreeLine {
    param(
        [Parameter(Mandatory = $true)] $Process,
        [int] $MaxCmdLen = 300
    )

    $cmd = ''
    if ($null -ne $Process.PSObject.Properties['CommandLine']) {
        $cmd = [string] $Process.CommandLine
    }
    if ([string]::IsNullOrWhiteSpace($cmd)) { $cmd = '<unreadable>' }
    $cmd = ($cmd -replace '\s+', ' ').Trim()
    if ($MaxCmdLen -gt 0 -and $cmd.Length -gt $MaxCmdLen) { $cmd = $cmd.Substring(0, $MaxCmdLen) + '...' }

    $parent = '<unknown>'
    if ($null -ne $Process.PSObject.Properties['ParentProcessId']) { $parent = [string] ([int] $Process.ParentProcessId) }

    return ('[process-tree-detail] pid={0} parent={1} {2} :: {3}' -f [string] ([int] $Process.ProcessId), $parent, [string] $Process.Name, $cmd)
}

<#
.SYNOPSIS
    逐行打印进程树的命令行原文；空集合也必须出声。
#>
function Write-TestProcessTreeDetail {
    param(
        [array] $Processes,
        [int] $MaxCmdLen = 300
    )

    $rows = @($Processes)
    # rows=0 必须打出来：调用方拿不到后代时，"什么都没打印"与"打印了 0 条"是两种证据，
    # 前者读起来像脚本没跑（本仓的装饰性门禁反复出在这种形态上）。
    Write-Host ('[process-tree-detail] rows=' + $rows.Count)
    foreach ($row in $rows) {
        Write-Host (Format-TestProcessTreeLine -Process $row -MaxCmdLen $MaxCmdLen)
    }
}

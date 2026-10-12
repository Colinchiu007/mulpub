# App-Live 自动修复机制真机验证报告

> 简体中文版真机验证记录，与英文 companion `docs/app-live-white-screen-runbook.md` 配套。
> 英文 runbook 按设计保持纯 ASCII / English（launcher 脚本与 runbook 约定如此）；
> 本报告作为中文交付物，沉淀本次对自动修复（auto-heal）机制的实机验证证据。

## 1. 目的与范围

本报告的验证目标只有一个：**在真机上确认 `scripts/mp-applive-launcher.ps1` 的 opt-in 自动修复链路，能在 Vite 持续被杀的情况下，按环境上限（`MP_APPLIVE_AUTOHEAL_MAX`，默认 `3`）重启整个实例，并在用尽额度后正确发出 `AUTOHEAL_EXHAUSTED` 信号。**

验证不涉及任何运行时代码改动——它是一次**运行时行为测试**（启动 / 终止应用）。共享仓库根未编辑任何 `apps/`、`packages/`、`.github/` 等受写保护的路径；本报告与流程载体（`.quality-gates.md`、ledger）经 docs-only 通道走 PR 落地。

## 2. 前置条件

- 目标工作区：`D:/Data/projects/mp-worktrees/mp-app-live2`（launcher 默认 `$Worktree`，分支锚点 `68838e9ab`）。
- 端口（由 `apps/desktop/scripts/dev-ports.js` 按工作区路径 fnv1a 解析，issue #2459 端口隔离已保持）：
  - Vite：`5231`
  - CDP：`9279`
  - 后端：`18357`
- 验证前该 live2 实例已正常在线（窗口可见、Vite 5231 可服务）。
- 自动修复默认 **OFF**：`MP_APPLIVE_AUTOHEAL` 不设置时，常规 `/start-app`（`scripts/sync-app.ps1` 快速通道）**不会**转发该变量，因此默认启动等同于 `AUTOHEAL_DISABLED`。要启用必须在 launcher 自身进程环境里显式设置该变量——所以本次验证**直接调用 launcher 脚本并注入环境变量**，而非经 `sync-app.ps1`。

## 3. 验证方法

采用「launcher 带环境变量启动 + 外部看门狗持续杀 Vite」的组合，把单趟自动修复循环逼到上限：

1. 在独立 PowerShell 进程里运行 launcher，注入
   `$env:MP_APPLIVE_AUTOHEAL='1'`（其余用默认 `Max=3`）。
2. 另起一个**看门狗** PowerShell 循环（仓库外 `D:\Temp\autoheal-watchdog.ps1`，不入库），每 3 秒检测 `127.0.0.1:5231` 的监听进程，按
   `CommandLine -match 'vite\.js.*--port 5231'` 定位 Vite 进程并 `Stop-Process -Force`。
3. 看门狗在检测到停止信号文件 `D:\Temp\autoheal-stop.txt` 时退出，从而可以在「逼到 cap 之后」停止杀进程、确保最后一次重启后 Vite 恢复健康。

**关键机制细节（实测确认）**：auto-heal 是 launcher 启动流程末尾的**单趟循环**（`Invoke-AppliveAutoHeal` 在 `Test-ViteServing` 之后运行，循环 `while (-not $viteOk -and $attempt -lt $ah.Max)`）。一次启动窗口内若只杀一次 Vite，循环只重启一次即退出并判定成功。要逼出 `AUTOHEAL_EXHAUSTED`，必须在**每次自动重启拉起新的 Vite 之后再次把它杀掉**，直到用尽 3 次额度；随后停止杀进程，让第 3 次（或最后未达成功前的）重启后的 Vite 保持健康。

看门狗自身匹配需排除运行它的宿主进程（`Get-CimInstance Win32_Process` 的 `CommandLine LIKE '%autoheal-watchdog.ps1%'` 会同时命中 DSH 运行器与当前 pwsh 的 `-Command` 字面量），必须以 PID 排除自匹配，否则会得到错误的「看门狗仍在」误判。

## 4. 关键证据（launcher 输出转写）

以下为 launcher 直接输出的状态 token 序列（`Tee-Object` 落盘于 `D:\Temp\autoheal-launcher.log`）：

```
AUTOHEAL_ENABLED
VITE_NOT_SERVING port=5231
AUTOHEAL_RESTART attempt=1/3     # 调起真实 Start-AppliveInstance，CHILD_PID=45460
AUTOHEAL_RESTART attempt=2/3     # CHILD_PID=25828
AUTOHEAL_RESTART attempt=3/3     # CHILD_PID=24156
AUTOHEAL_EXHAUSTED attempts=3 max=3
[status: completed, exit code: 0]
```

含义逐条：

- `AUTOHEAL_ENABLED`：环境变量生效，进入自动修复循环。
- `VITE_NOT_SERVING port=5231`：探针确认 5231 端口未返回可用 HTML（被看门狗杀死）。
- `AUTOHEAL_RESTART attempt=N/3`：第 N 次重启整个 live2 实例（强制终止该工作区全部 electron + node，再 detached 拉起 `node scripts/dev.js`），每次重启后都重新等待窗口（`Wait-AppliveWindow` 50×3s）、等待后端（`Wait-AppliveBackend` 20×3s）并重新探针，仍不达 `VITE_SERVING` 即进入下一轮。
- `AUTOHEAL_EXHAUSTED attempts=3 max=3`：用尽默认上限 3 次仍未恢复，按设计停止重启并上报耗尽。
- 退出码 `0`：launcher 自身流程正常结束（耗尽是预期业务状态，不是崩溃）。

## 5. 结论

自动修复链路在真机上的行为与设计一致：

1. **环境门控有效**：仅当 `MP_APPLIVE_AUTOHEAL` 命中 `1/true/on` 才进入循环；默认 OFF 时 launcher 输出 `AUTOHEAL_DISABLED`，绝不静默重启在线实例（已用「不带该变量再启一次」复测确认：`VITE_SERVING` + `AUTOHEAL_DISABLED`）。
2. **额度上限生效**：默认 `Max=3`，看门狗持续杀 Vite 时，重启动作恰好执行 3 次后停止并发出 `AUTOHEAL_EXHAUSTED`，未出现第 4 次重启。
3. **状态 token 完整**：`AUTOHEAL_ENABLED → VITE_NOT_SERVING → AUTOHEAL_RESTART×3 → AUTOHEAL_EXHAUSTED` 完整闭环，可作为运维可观测信号。
4. **退出码正确**：耗尽属预期业务态，`exit code: 0`，不会误导上层编排。

## 6. 自动修复设计要点（便于运维参照）

- `MP_APPLIVE_AUTOHEAL`：启用开关，默认 OFF（opt-in），避免 launcher 自动重启正在运行的实例。
- `MP_APPLIVE_AUTOHEAL_MAX`：最大重启次数，默认 `3`；非法 / 非正整数回落 `3`。
- `Invoke-AppliveAutoHeal` 仅在启用时运行；在 `VITE_NOT_SERVING` 时重调 `Start-AppliveInstance` → 等窗口 → 等后端 → 重探针，循环至 `Max`。
- 状态 token：`AUTOHEAL_DISABLED` / `AUTOHEAL_ENABLED` / `AUTOHEAL_RESTART attempt=n/Max` / `AUTOHEAL_EXHAUSTED`。
- 探针与自动修复路径在 `-Test` 模式下完全可注入：不启真实进程、不 `Start-Sleep`，由 `scripts/mp-applive-launcher.test.ps1` 覆盖（禁用=0 次、启用 max=3=3 次、max=2=2 次），并已接入 CI Gate 2d。

## 7. 验证后恢复说明

逼到 cap 的验证会真实中断 live2 实例最多 3 次。验证结束后按以下步骤恢复：

1. 创建停止信号文件 `D:\Temp\autoheal-stop.txt`，确认看门狗进程已退出（按 PID 排除自匹配核验，避免 DSH 运行器 / 当前 pwsh 的 `-Command` 字面量造成误判）。
2. 不带 `MP_APPLIVE_AUTOHEAL` 重新调用 launcher（恢复默认 OFF 行为）。
3. 复测健康：探针输出 `VITE_SERVING port=5231` 且 `AUTOHEAL_DISABLED`；HTTP `GET 127.0.0.1:5231/` 返回 `200` 且 body 含有效 HTML；后端 `18357` 监听；Electron 窗口标题「社媒管家」在线。

本次验证后已按上述步骤恢复，live2（vite 5231 / cdp 9279 / backend 18357）确认健康，无孤儿 Vite 残留，看门狗已退出。

## 8. 风险与注意事项

- 自动修复调用的是**真实** `Start-AppliveInstance`，会强制终止该工作区全部 electron + node 再重启——在真机上会中断用户正在运行的会话。本验证属用户明确授权「完整逼到 cap」的受控操作，非必要不要在生产会话上复跑。
- 单趟循环特性意味着「启动脚本退出后再杀 Vite」不会被捕获；要触发重启必须在该次启动窗口内杀 Vite，且要逼出耗尽必须在每次重启后持续杀。
- 看门狗脚本与日志位于仓库外的 `D:\Temp\`，不随本仓库提交；清理它们不影响任何受管文件（如需清理走 `node scripts/safe-delete.js --allow-outside`）。

# QM-6 后端轴（claude）——findings 五条（2026-10-15，PR #3620）

模型名唯一真源：`~/.claude/.ccg/config.toml` 的 `[routing.backend].primary` = `claude`。
调用：`codeagent-wrapper --backend claude --lite "<prompt>" .`，cwd/workdir 为该 worktree。

## 两次尝试

| # | 日志 | 结局 |
| --- | --- | --- |
| 1 | `D:/Temp/qm6-3620-backend.log` + `codeagent-wrapper-28776.log`（27 MB） | **`claude execution timeout`（80 分钟）**，wrapper 事后删除了日志。核实过：那 27 MB 里 `"type":"result"` 事件 **0 条**，最后几行是 `InputValidationError: Bash failed due to the following issues` 的反复空转 ⇒ 它不是"想得久"，是卡在命令参数校验失败的循环里 |
| 2 | `D:/Temp/qm6-3620-backend2.log` | **交付 5 条 findings**。改的不只是提示词长度，而是**任务形态**：明写「只读文件、禁止调用任何命令类工具」，并把范围从 3 个文件收到 2 个。这条差异就是归因证据——第 1 次失败的成因是工具空转，不是提示词超长（本仓另有反例：提示词以 `-` 结尾却拿到完整载荷） |

## findings 原文（severity 用后端给的 high/medium/low 档位）

### 1 (high) `.github/scripts/agent-review-gate.js`
`isCoverageOnlyFailure` 用 `summary.total > 0` 作为「审计确实量出了项」的唯一证据，而 summary 恰恰是裁判自报、
已在文件上方注释里被证明不可靠（#3617 出现 total=218 与 coverageRate:0.36 同时成立）。崩溃或半成品审计只要写出
`exitCodes=['COVERAGE_FAIL']` 且 total>0（而不是注释假设的恒 0），就会走 COVERAGE_BACKLOG_REPORT 出口 0 放行——
把「审计没跑成」的 FAIL 读成「存量欠账是别人的」。防御依赖 run-autonomous-e2e.js 的 catch 恒清 total 这一跨文件约定，
约定破坏即整闸漏放。
建议：要求 `coverage.details` 非空且存在 missing/partial 类条目，或用 `details.length>0 && countBy('missing')>0` 替代。

### 2 (medium) `.github/scripts/agent-review-gate.js`
NEED_HUMAN 分支在 `requiredFeatureIds` 判据之前触发且完全不看 ids。当 workflow 传了 required-feature-ids
（本 PR 声明了特性、审计面被收窄）而审计器返回 NEED_HUMAN 时，仍走 PROMPT_REVIEW_REQUIRED 出口 0 放行；
此时 NEED_HUMAN 说的正是「本 PR 声称的特性未覆盖」，一条应判 COVERAGE_FAIL 的失败被报告型通道放行。
建议：ids 非空时按 COVERAGE_FAIL 阻塞，仅 ids 为空时才把 NEED_HUMAN 当 advisory。

### 3 (low) `.github/scripts/agent-review-gate.js`
`coverageShape` 的 `inScope` 取 `coverage.auditedCount`、`judged` 取 `details.length`，两个计数源不等价：
生产方没写 auditedCount 时句子静默降级成 `in scope N/A`；且 `judged` 与 covered/partial/missing 三分项无相等约束，
details 里出现第四种 type 时读者会看到总数与分项对不上的数。
建议：只从 `details[].type` 计数并去掉 inScope；或按 {covered,partial,missing,other} 归类，其它类目单列。

### 4 (medium) `scripts/gate9-classify.js`
去掉标题/label 豁免后，绕过面完全落到「只认两个前端前缀」：任何落在 `apps/desktop/`、`ops-center/` 之外的前端源码
（`packages/*/src` 里渲染的组件、`apps/` 其它子应用、`ops-center/` 除 `frontend/src` 之外的前端路径）都被
「未触及任何前端源码目录」打成 report-only；ops-center 的 srcDir 写死 `ops-center/frontend/src`，与变更实际落点
不保证重合；后端/脚本改动一律不审。
建议：前端目录改成可枚举清单 + 内容校验；未知但疑似前端的路径 fail-closed 走 full。

### 5 (low) `scripts/gate9-classify.js`
`allDocOnly` 对 `DOC_ONLY_PATH_PREFIXES` 的松散前缀（裸 `docs/`、`openspec/`、`AGENTS.md`、`.quality-gates.md`）
只做 `startsWith` 判定，不校验目录内容 ⇒ 把真实源码放进这些前缀下即可整 PR 免审。
建议：加内容指纹（扩展名/文件头/是否被构建目标引用），或收紧前缀。

逐条处置见 `gate9-ratchet-review-response.md`。

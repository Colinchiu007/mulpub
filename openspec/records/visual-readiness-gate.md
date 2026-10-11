---
record: visual-readiness-gate
task: 让「视图从未渲染出来」成为硬失败——修 film-engineering 就绪选择器 + Gate 7 按退出码 3 阻断（就绪类与像素类分档）
date: 2026-10-11
---

## 本次执行记录：视觉就绪门禁（visual-readiness-gate，2026-10-11）

- 变更类型与隔离声明：**混合 PR**（`apps/desktop/tests/**` + `.github/workflows` + `.github/scripts` + 文档）⇒ 必须走隔离 worktree `mp-visual-readiness-gate`（分支 `visual-readiness-gate`），且 `classify-docs-only` 判 `docs-only=false`，重型门禁不得短路。
- 规格与方案：`01-docs/PRD-VISUAL-READINESS-GATE-2026-10-11.md`（QM-5 五步 + R1–R15 场景矩阵 + §2b 归属与净差量 + §5 实测反证与六格行为表 + §6 不在范围登记 + §8 两轮 QM-6 处置）。

### 做了什么

1. **根因**：`routeView('film-engineering', '/film-engineering', '.film-canvas-view')` 指向的节点**不在该路由上** —— `/film-engineering` 渲染 Hub（`.film-hub-view`），canvas 是 `v-if="isMounted('canvas')"` 的懒挂载标签页（默认 `auto`），所以每次 run 都烧满 15s 就绪预算后抛超时。锚点改为 `.film-hub-view .fh-title`。**归属**：re-sync 时该行与 origin/main 冲突，另一会话已独立把同一选择器改成 `.film-hub-view`（出处 #3234 / batch-teleport-fix），本 PR 取更深的锚点并合并两侧注释；本 PR 的净差量是 Gate 7 的 `= 3` 判定与 `ready-classification` 分档（实测 main 两者都没有），详见 PRD §2b。
2. **分档**：新增唯一实现 `apps/desktop/tests/visual-testing/ready-classification.js`，按 `error.code`（`ERR_VISUAL_APP_READY_TIMEOUT` / `ERR_VISUAL_READY_SELECTOR_TIMEOUT`）把「视图从未渲染出来」与「像素/校验失败」分开；就绪 ⇒ `ERR_VISUAL_NOT_READY` ⇒ **exit 3**。
3. **两套 `runViewSuite` 共用同一份分类**（`all-views` 与 `supplementary-views` 各有一份聚合循环，只改一侧会让 Gate 7 的另一条判定永远点不到火）。
4. **Gate 7 参与判定**：四个套件退出码任一 `= 3` ⇒ 在 `$pixelExit` 判定之前 `exit 3` 并点名套件；`1` 仍交 Gate 7b 的两轮甄别（把「非 0 即拦」当收敛会把真实存在的采集抖动变成所有 PR 的常量红）。

### 验证（本地实跑数字，逐条可在 PRD §5/§7 复核）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 分类回归锁（R1–R15） | `pnpm exec vitest run tests/visual-testing/visual-readiness-classification.test.js` | `Tests 15 passed (15)` |
| 消费者并集 | 上述 + `tests/visual-ci.test.js` + `tests/visual-testing/condition-waiting.test.js` + `electron/tests/visual-view-runner.test.js` | `4 passed / Tests 72 passed (72)` |
| workflow 结构锁（含新锁） | `node --test .github/scripts/workflow-contract.test.js` | `35 pass / 0 fail`（改前基线 34） |
| Gate 7 判定行为表 | 抽出 workflow 原文喂 `pwsh` 跑六格 | 全 0 ⇒ rc=0；`views=3`/`pixel=3` ⇒ rc=3 点名套件；`views=1` ⇒ rc=0；**删掉 `$suitesNotReady = ''` 初始化 ⇒ rc=3 且名单为空** |
| 变异 N1–N8 | `mutate_vrg2.cjs`（rc 为准，还原后 `Buffer.compare` 逐字节相同） | `red=8/8 notRed=0` |
| 打包（QM-1） | 本 PR 不改 `apps/desktop/electron/**` 与 `packages/rpa-engine/**` | 不适用（判据：`git diff --name-only` 命中 0） |

### QM-6 双模型外部评审（替代通道，标准通道本机不可用）

`ccg-deep-review.js` 缺失且 CC Switch `:15721` 探针 DOWN（`routing.backend=codex` / `routing.frontend=claude` 两个 primary 都经该端口），故走既有替代通道 `opencode run --agent plan --auto`。

- **后端轴 `opencode/nemotron-3-ultra-free`**：1 Critical（B 误拦）+ 4 项明确结论（A 不漏拦 / C 聚合语义符合 / D PowerShell 安全 / E 第 4 条验收只能 CI 现场证伪）。
- **Critical 内容**：初版 `isReadyFailure` 带 `error.name === 'TimeoutError'` 兜底。我复核后确认成立且**是本 PR 自引入的回归**：`_waitForApplicationReady` 已把该阶段所有超时改写成两个码（`test-runner.js:231-250`），兜底捞不到任何就绪路径；它捞到的是补充套件 4 个带 `trigger`/`afterTrigger` 视图的 `page.click`/`page.waitForSelector` 超时，以及 `page.goto` 的 15s 超时（裸 `TimeoutError`，`test-runner.js:292-295`）—— 这些会被编成 `exit 3`，绕过 Gate 7b 的两轮甄别，正是本分档要防的"把抖动变成常量红"。
- **处置**：删掉兜底，新增 R12（trigger 点击超时仍 1）+ R13（共享分类逐判例），并加变异 **N7＝把兜底加回来 ⇒ 实测 RED（`Failed Tests 2`）**；同批复跑 `red=7/7 notRed=0`、`Tests 13 passed (13)`、并集 `70 passed (70)`。
- **我的操作错误（已写入跨会话记忆）**：两路评审运行期间我在同一 worktree 跑了变异电池，前端轴点名观察到 `// MUT N6` 瞬时态。后果不是改坏了什么（每个变异都 `Buffer.compare` 还原过），而是**它读到的是哪一版无法事后重建** ⇒ 它的每条结论我都重新独立取证，没有照抄。
- **未采纳**：评审建议为 click/waitForSelector 新增 `ERR_VISUAL_TRIGGER_TIMEOUT`/`ERR_VISUAL_DIALOG_TIMEOUT` 两个码——那属新增契约，而这些失败的目标语义就是"不阻断"，1 档已足够。
- **前端/工程轴 `opencode/ling-3.1-flash-free`**：Critical=1（它读到的 tip `7d37f1e2b` 仍带兜底，已由上一条闭合；我按 `git show HEAD` 复核确认 HEAD 里 `return error.name` 那行不存在）+ Minor=7，**采纳 5 条**：消息模板与 `code` 赋值收进共享模块 `buildSuiteError`（R11 加两条锁 + 反证 N8 实测 RED）；`close()` 抛错不得吞掉已收集的就绪失败（两套改「视图失败优先、close 挂 cause」，新增 R14/R15）；删掉零消费者的 re-export 并纠正那句不实注释；`classifyFailures` 改名 `classifyVisualFailures`（与 `autonomous-enforce-loop.js:197` 同名不同义）；workflow 里如实注明 pixel/dark 的 `-eq 3` 当前不可达。**未采纳 2 条**并写明理由（`waitForSelector` 超时面已被 R13 钉住、聚合器 3→1 稀释属汇总非门禁）。逐条处置见 PRD §8 前端轴小节。

### 合并前 head 上的 CI 现场（回填时当场从 Actions 日志取，行号为真）

head `399477f1c` / run `38112354996` / job `114390819091`：

```
:856  [GATE-7] suite exits: pixel=0 views=0 views-supplement=0 dark=0
:865  [GATE-7] All visual tests passed
:1353 [GATE-7B] round 1 clean
```

三个步骤的 `step.conclusion` 逐个为 `success`（Gate 7 / Gate 7c / Gate 7b —— 只看步骤名会把被 `if:` 跳过的步骤误读成跑过）；整份日志里**没有**运行时的 `[VISUAL-READY]` 行。

口径修正（不沿用本篇早先那句过度声明）：这行现场证明的是**「Gate 7 在这个 head 上真的判了，且没有就绪故障被吞」**。"根因被修掉"不能单独记在本 PR 头上 —— 见 PRD §2b，main 已由另一会话独立把同一选择器改掉；本 PR 的净差量是那道判定与分档机制（实测 main 上两者都没有）。

| 门禁 | 结果 |
| --- | --- |
| 远程同步 | PASS（PR #3297 → main `942506fe9` @ 2026-10-11T13:28:12+08:00；`git ls-remote --heads origin visual-readiness-gate` = 0 行） |

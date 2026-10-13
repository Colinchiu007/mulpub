# Tasks — fix-risk-hold-false-positive

> 真机边界：本机无可用公众号/抖音等**真实风控触发会话**，「真实风控命中 → 挂起 → 横幅 → 人工恢复」全链真机回归**未做**（见 design.md §4）。本次验收边界为单元 + 集成层，含变异反证。

## 1. 复现与根因取证（QM-5 ①）

- [x] 读码取证：判定只吃文本 —— `phase4-events.js` 只拿到 `task.error`（旧 L236 `isRiskBlocked(task.error)`）
- [x] 读码取证：结构化信号被丢弃 —— `api-publish-engine/src/index.js` 旧 L95 与 `publisher-router.js` 三个发布器均 `throw new Error(result.error)`
- [x] 读码取证：词表无边界 —— 旧 `RISK_RE` 含裸 `601` / `10000015` / `risk` / `frequent` / `verify` / `验证`
- [x] 实测取证 A1–A7：7 类普通失败文案在旧词表下全部命中（附录 A）
- [x] 实测取证：`accountId` 缺失 ⇒ `isSuspended` 对该平台全部账号为真（一次无账号失败冻结整平台）
- [x] 实测取证：全仓发布链 674 文件扫描，确认误判面来自**外部平台/网关错误文本**而非仓内字面量
- [x] 读码取证：两处 `RISK_RE` 已漂移（桌面多 `安全验证|操作频繁|captcha`，注释仍写「保持同义」）
- [ ] 真机复现：用运行中的应用触发一次真实风控并观察横幅（无会话，**PENDING**）

## 2. 契约层（先测试后实现）

- [x] `packages/api-publish-engine/test/risk-signals.test.js`：45 例（结构化优先 / 误判面 / 真风控召回 / suspends 不变量 / 边界与并集）
- [x] 登记 `risk-signals.test.js` 进 `scripts/run-tests.js` 的 `VITEST_FILES`（引擎 direct 组无 `describe` 全局，不登记即 `ReferenceError`）
- [x] `apps/desktop/electron/services/publish-risk.test.js`：扩到 15 例（兼容签名 + 误判面 + 结构化优先 + 单一真源同引用断言）
- [x] `packages/api-publish-engine/src/publish/core/risk-signals.js`：`classifyRisk` / `isRiskText` / 三个正则 / `RISK_CODES`

## 3. 接线（结构化信号搬运链路）

- [x] 引擎 `src/index.js`：`publishViaApi` 抛错保留 `code` / `riskBlocked` / `loginExpired`
- [x] 桌面 `publisher-router.js`：新增 `attachRiskSignals`，接入 `RpaPublisher` / `ApiPublisher` / `BackendPublisher`
- [x] `shared-utils/task-queue.js`：失败时落 `task.errorCode`（缺省 `null`）/ `task.riskBlocked`（缺省 `false`）
- [x] 桌面 `phase4-events.js`：判定改 `classifyRisk({error, code, riskBlocked})`，按 `suspends` 分流

## 4. 判定与粒度（P0-2 / P1-3）

- [x] 两处 `RISK_RE` 收敛为单一真源（`publish-mode-runner.js` 与 `publish-risk.js` 均 require `risk-signals`）
- [x] `publish-mode-runner.js` 挂起点加强弱闸门（弱信号停报但**不挂起**，另记 WARN）
- [x] `phase4-events.js`：弱信号不挂起、不广播、不发 IPC，仅结构化日志 `weak-signal-not-suspended`
- [x] `accountId` 解析加 `task.accountId` 兜底；弱信号 + 无账号零挂起；强信号 + 无账号仍平台级

## 5. 记录与显示项（P1-4）

- [x] `risk-suspender.js`：rec 增加 `signal`（≤64 截断）与 `strength`（白名单）；不落原始错误文本
- [x] 桌面 `risk-suspender-store.js`：水合透传 `signal`/`strength`（旧记录不伪造）
- [x] 渲染层 `risk-suspended-tracker.js`：`normalize` 保留 `signal`/`strength`（非法值归一 `null`）
- [x] `RiskSuspendedBanner.vue`：粒度标签 / 检测时间 / 判定依据三个显示项 + 标题分流
- [x] `publish/{zh,en}.js`：5 个新 key 成对（`suspendedAllAccounts` / `scopeAllAccounts` / `detectedAt` / `evidenceStrong` / `evidenceWeak` / `guidanceAllAccounts`）

## 6. 变异反证（已实跑）

- [x] M1 `task-queue` 的两个赋值改成 no-op ⇒ `Tests 2 failed | 35 passed (37)`（新增 3 例中 2 例立红）
- [x] 恢复后 ⇒ `Tests 37 passed (37)`
- [x] 反证纪律：只证「业务改动变红」不算，必须证「把锁本身改成 no-op 立红」—— M1 即此，已确认

## 7. 测试执行记录（实测数字）

| 范围 | 命令 | 结果 |
|---|---|---|
| 引擎全量 | `cd packages/api-publish-engine && node scripts/run-tests.js` | 379 passed / 40 files + direct 组全通过 |
| shared-utils 全量 | `cd packages/shared-utils && pnpm run test` | 844 passed / 10 skipped / 41 files |
| 桌面受影响 6 文件 | `cd apps/desktop && pnpm exec vitest run <6 files>` | 171 passed |

## 8. 文档与证据

- [x] `01-docs/PRD-RISK-HOLD-MISJUDGE-FIX-2026-10-13.md`（数据校验 / 流程 / 功能逻辑 / 交互 / 显示项 / 提示文字 / 边界 / 验收 + 附录 A、B）
- [x] `openspec/changes/fix-risk-hold-false-positive/`（proposal / design / specs / tasks）
- [x] `openspec/records/fix-risk-hold-false-positive.md`
- [x] `CHANGELOG.md`
- [x] `.quality-gates.md` 本次执行记录
- [x] 三类记忆：内置 `01-docs/learnings.md`、外部 `~/.gstack/projects/multi-publish/learnings.jsonl`、EverOS `~/.everos/multi-publish/learnings-2026-10-13-*.md`

## 9. 门禁

- [x] `pre-code-edit-guard.ps1` exit 0（隔离 worktree）
- [x] eslint（`apps/desktop` `pnpm run lint`）
- [x] locale 成对 + CJK 基线（Gate 7）
- [x] QM-1 本地打包
- [x] QM-2 代码审查必检项
- [ ] 远程同步（PR 合并后回填）

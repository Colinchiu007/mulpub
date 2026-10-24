# Design: gate-timeout-coverage-72

## 1. timeout 取值：72，且必须恰等于 required

- 判据本体 `scripts/check-coverage-budget.js` 的 `UNDER_BUDGET` 条件是 `timeout < ceil(floor × SAFETY_MULTIPLIER)`，
  `SAFETY_MULTIPLIER` 取自 `scripts/lib/gate-budget.js`（= 1.5），
  `floor = max(maxMinutes, censoredAtCeiling > 0 ? ceilingMinutesSampled : 0)`（成功样本右截尾）。
- 120 趟窗口同口径重采样（`scripts/coverage-budget-sample.js`）：`floor = 47.37` 分 ⇒ `required = ceil(47.37 × 1.5) = 72`。
- **取 72 而不是 70**：仓内既有先例里 timeout 恰好等于 `ceil(max × 1.5)`，不多给。
  70 同样满足 `70 ≥ 72`？**不满足**（70 < 72 ⇒ `UNDER_BUDGET` 红）。
  ⇒ **只有 72 及以上合规**，而 72 恰等于 required ⇒ 不欠账、也不过给。

### 1.1 `HARD_RATIO` 不是「余量为 0」的依据

`scripts/lib/gate-budget.js` 里另有 `HARD_RATIO = 0.9`，但它**只用于 `HUGGING` 规则**
（`maxMinutes ≥ 0.9 × timeout` ⇒ 贴脸告警），**不是**「余量必须为 0」的判据。
本 change 不用它作依据，只用它反证 72 不构成贴脸：`47.37 < 0.9 × 72 = 64.8` ⇒ 不触发 `HUGGING`。

## 2. provenance **不能**加 `note` 字段（parity 锁）

- `scripts/lib/gate-timeout-registry.js:145-152` 的 `coverageProvenance()` 是
  `Object.assign({ jobName, workflowPath }, e.provenance, { ... })` ⇒ **条目 provenance 里多一个键就直通到 `PROVENANCE`**。
- `scripts/check-coverage-budget.test.js:139-147`（锁 7）比对「采集器产出的字段集」与「判据常量的字段集」**逐字相等**。
  采集器 `buildProvenance` **不产 `note`** ⇒ 字段集多出 `note` ⇒ 红。
- **对照实验**：`origin/main` 上同一条测试 26/26 全绿；加 `note` 后 25/26；移除后回到 26/26 ⇒ 因果确凿。
- ⚠️ **仓内有个误导性先例**：`schedule-heartbeat` 那一格的 provenance 里就带 `note`，
  但那一格**永远不会被 `coverageProvenance()` 取到** ⇒ **不构成「可以往 provenance 塞 note」的依据**。
- 结论：依据（重采样方法、窗口、判据）改放 **workflow 注释 + PRD + 执行记录**，不动 provenance 的字段集。

## 3. 注册表是「每 job 压成一行」的紧凑格式 ⇒ 只做文本级最小替换

- `scripts/gate-timeout-registry.json` 的排版是 **一个 job 一行**（`{"workflow": "...", "jobId": "...", ...}`）。
  用 `json.load` → 改 → `json.dumps(indent=2)` 写回 ⇒ **diff 变成 430 行变化（+409/−28）**，而实际只改了一个条目。
- 正解：**定位那一整行 → 文本级替换** ⇒ 同处改动 **430 行噪音 diff → 3 行**。
- 判据：`json.loads` 成功**不代表** `json.dumps` 能写回同一个形状 ⇒ 改任何「看起来是 JSON 的台账」前先 `head -20` 看真实排版；
  写回后必须 `git diff --stat` 看形状。

## 4. 提交必须用明确文件清单，禁止 `git add -A`

- `scripts/check-text-encoding-integrity.test.js`（第 73-89 行）会**故意写一个含 U+FFFD 的文件**
  `01-docs/__encoding-gate-mutation-probe.md` 并 `git add -N` ⇒ **跑完残留在工作区**。
- 被 `git add -A` 扫进提交后：`node scripts/check-text-encoding-integrity.js` 当场 `EXIT=1`「新增 1 处编码损坏」
  ⇒ changes job 红 ⇒ 8 个重型作业被 needs 跳过 ⇒ gate-result exit 1 ⇒ **PR 必红**。
- 修法：**提交前用明确文件清单 `git add`**，跑完该门禁后 `git status` 复查并清残渣。

## 5. 质量节拍适用性判定

- `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ **`docs-only=false`（8 个文件）**
  ⇒ 改了 `.github/workflows/` 与 `scripts/` 工具脚本 ⇒ 按 `AGENTS.md` 属**混合 PR** ⇒ 跑**完整**质量节拍，
  **不得借道 docs-only 通道**。
- **QM-1（electron 主进程打包验证）不适用**：触发条件是「修改 `apps/desktop/electron/` 或 `packages/rpa-engine/` 下代码」，
  本 change 两个目录都不碰 ⇒ 不跑打包。作为佐证，`scripts/qm1-child-env.test.js`（7/7）与
  `scripts/qm1-paths.test.js`（10/10）本地全绿。
- **QM-6（双模型外部评审）不强制但已执行**：本 change 以 `openspec/` + `docs/` + `scripts/` 工具脚本为主，
  按 `AGENTS.md` 不强制 QM-6；实际已用多轨独立审查执行（量化 / 门禁 / 契约安全 / 流程 CI / 对抗性红队），
  其结论逐条回源码与实跑复验后才落盘。
- **QM-5 行题约定不适用于本篇执行记录**：`scripts/check-record-qm5-rows.js` 的进域判据是
  「记录里出现 QM-5 步骤标记」⇒ 一条都没有 ⇒ 不进域、不要求补齐步骤。
  ⇒ 本篇记录**不得**写入该形态的标记，否则会立刻要求 ①②④⑤ 齐全而当场红。

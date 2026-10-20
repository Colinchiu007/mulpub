# BUGFIX：历史记录失败卡片直出英文技术原文（2026-10-20）

- **严重程度**：P1（用户可见、违反项目铁律、影响所有失败任务卡片）
- **关联 PRD**：`01-docs/PRD-USER-FACING-ERROR-MESSAGES-2026-10-20.md`
- **关联 change**：`openspec/changes/error-message-user-friendly-audit/`

---

## 1. 根因溯源（第一性原因）

### 1.1 症状

「视频创作 → 历史记录 → 执行失败」标签的任务卡片，失败原因显示：

```
Input media exceeds the total size limit
```

### 1.2 第一性引入点

`apps/desktop/electron/services/story2video-compose-engine.js` 的 compose 预检分支，自该引擎建立起就把英文技术 message 当作**唯一**失败载荷：

```js
return { code: -1, message: 'Input media exceeds the total size limit' }
```

同文件另有 20+ 处同类英文 message（`ffmpeg not found`、`Scene media path is not allowed or unreadable at index N`、`Composed video duration exceeds the allowed limit of N minutes` 等）。

### 1.3 当时的意图（为什么这么写）

引擎是**纯 Node + ffmpeg 子进程**实现，早期设计把 `message` 当作「给上层的诊断文本」——上层（stage-executor → pipeline-engine）只需要一个字符串写进 `run.error` 落库，前端从历史记录读出来显示。当时**没有**「用户直接看这个字段」的意识，也没有稳定错误码的概念（`errorCode` 机制是 2026-08-11 `prompt-user-friendly-i18n` 才在 IPC 拒绝路径上建立的，且只覆盖 `license-access-control.js` / `model-provider-manager.js`）。

### 1.4 四层逃逸链

| 层 | 位置 | 为什么没拦住 |
| --- | --- | --- |
| ① 主进程 | `story2video-compose-engine.js:951` | 没有「必须返回稳定 errorCode」的契约 |
| ② stage 边界 | `stage-executor.js:746` | 只透传 `error` 字符串，`errorCode` 无处可去 |
| ③ 落库 | `pipeline-engine.js:2120` `_finalizeRun` | 只写 `run.error`，快照只存 `error` |
| ④ 渲染端 | `pipeline-error-formatter.js:215` | 「短自然语言直出」分支把 41 字符的英文技术句判成自然语言 |

**第 ④ 层的判据本身**：

```js
if (raw.length <= 120 && !/[{}\[\]]|Error code|ENOENT|ECONNREFUSED|at\s+|line\s+\d+/i.test(raw)) {
  return { message: raw, key: '', params: {} }   // ← 原样透出
}
```

`Input media exceeds the total size limit`：长度 41 ✅、无 `{}` ✅、无 `Error code` ✅、无 `ENOENT` ✅、无 `at `/`line N` ✅ ⇒ **全部条件满足，直出**。

---

## 2. 逃逸分析（按测试层级逐层）

| 层级 | 有没有对应测试 | 为什么没拦住 |
| --- | --- | --- |
| 单元测试（compose-engine） | 有（158 例），但**只断言 `result.code === -1`**，从不断言 `errorCode` | 断言层写错：验证了「失败了」，没验证「失败时带了稳定码」 |
| 单元测试（pipeline-engine） | 有（72 例），只断言 `snapshot.error` 字符串 | 同上，无 `errorCode` 字段可断言 |
| 单元测试（stage-executor） | 有（77 例），mock `composeVideo` 返回 `{ code: -1, message: 'ffmpeg failed' }` | mock 本身不带 `errorCode`，测试与生产契约脱节 |
| 集成测试 | `pipeline-story2video-contract.test.js`（27 例）覆盖成功路径 | 失败路径只测「不假装成功」，不测「失败信息可本地化」 |
| 端到端测试 | `e2e-full-pipeline.test.js` 用真实 ffmpeg，走成功路径 | 无失败卡片的文案断言 |
| 视觉回归 | QM-4 45 视图 + 32 工作流 | 无「失败卡片显示英文」这类断言场景 |
| 代码审查 | 每 2-3 功能 review | **审查盲区**：`message: '英文'` 看起来是合理的诊断文本，不在既有审查清单的「用户可见文案」射程内（清单只列了 IPC handler 的 message 铁律） |

### 逃逸链归类

- **测试场景缺失**：没有任何一层测试断言「失败返回体带稳定 errorCode」。
- **测试质量不足**：既有断言只验证 `code === -1`，属于「验证了失败事实，没验证失败契约」。
- **审查盲区**：QM-2 的 message 铁律条目挂在「IPC handler」上，compose 引擎不在其列。
- **流程缺失**：新增英文 message 不需要同步任何东西——三处渲染正则、locale 文案、主进程常量之间**没有对账机制**。

---

## 3. 系统性漏洞定位（具体到文件）

| 漏洞 | 文件 | 具体缺陷 |
| --- | --- | --- |
| **契约缺失** | `apps/desktop/electron/services/story2video-compose-engine.js` | 无 `errorCode` 常量集合，无组装器；28 处 `return { code: -1, message: <英文/中文> }` 形态各异 |
| **字段丢弃** | `apps/desktop/electron/services/stage-executor.js:746` | COMPOSE 失败分支只 `return { success: false, error: ... }` |
| **落库丢字段** | `apps/desktop/electron/services/pipeline-engine.js:2120` + `run-state-store.js:125` | `_finalizeRun` 与快照都只存 `error` |
| **启发式泄漏通道** | `apps/desktop/src/utils/pipeline-error-formatter.js:215` | 「长度 < 120 且无技术标记 ⇒ 透传原文」不认英文技术句 |
| **无双源对账** | `src/story2video/story2video-notifications.js` + `src/utils/pipeline-error-formatter.js` + `src/utils/user-facing-error.js` | 三套归一化各自维护正则，无机械判据校验「主进程新增 message 已同步」 |
| **门禁视野外** | `.github/scripts/check-locale-sync.js` | `--cjk` 只扫 `apps/desktop/src` 与 `packages/python-backend/src`，**不扫 `apps/desktop/electron`** |
| **审查清单射程不足** | `AGENTS.md` QM-2 | message 铁律只点名 IPC handler，未覆盖 service / stage 返回值 |

---

## 4. 修复方案 + 回归保护测试

### 4.1 修复（四层全堵）

| 层 | 改动 |
| --- | --- |
| ① 主进程 | 新增 `COMPOSE_ERROR_CODES`（8 码）+ `composeFailure()` 组装器；预检/时长类失败一律返回 `{ code: -1, errorCode, message, messageParams }` |
| ② stage | COMPOSE 失败分支上抛 `errorCode` / `messageParams` |
| ③ 落库 | 新增 `buildStageFailureError()`；`_finalizeRun` 落 `run.error`（字符串不变）/ `run.errorCode` / `run.errorParams`；`getRunSnapshot` 与 run-state 快照增补同名字段 |
| ④ 渲染端 | 三通道双轨归一化（`errorCode` 优先 + 存量原文模式兜底）；`COMPOSE_ERROR_KEY_MAP` 显式映射；locale 新增 6 条文案 + 2 个兜底标签 |

### 4.2 回归保护测试（写在哪个文件 + 怎么测 + 什么模式）

| 测试文件 | 新增用例数 | 模式 | 断言什么 |
| --- | --- | --- | --- |
| `apps/desktop/electron/services/story2video-compose-engine.test.js` | 5 | 单元（真实临时文件 fixture） | `errorCode` 值正确；`messageParams.scene` 为 1-based；`limitMb`/`actualMb` 匹配 `/^\d+(\.\d+)?(KB\|MB)$/` |
| `apps/desktop/electron/tests/pipeline-engine.test.js` | 3 | 单元（mock stageExecutor） | 带码落库；无码不写；字符串 error 旧调用方不回归 |
| `apps/desktop/src/story2video/story2video-notifications.test.js` | 5 | 单元 | errorCode 直连 / 存量原文 / en 界面 / 弹窗路径 / 不泄漏英文 |
| `apps/desktop/src/utils/pipeline-error-formatter.test.js` | 4 | 单元 | 规则命中；体积按序提取；中文形态；en 界面 |
| `apps/desktop/src/views/CreateViewHistory.test.js` | 2 | 组件（mount + template-aware i18n mock） | 卡片不显英文/不显 key/体积可见；存量数据同样归一化 |
| `scripts/check-compose-error-codes.test.js` | 7 | 门禁自测（沙箱 + 变异） | 基线 PASS + 6 道变异全部 rc=1 |

### 4.3 机械门禁（防再犯的核心增量）

`scripts/check-compose-error-codes.js` 校验四侧一致：

1. `COMPOSE_ERROR_CODES` 值集合 == `COMPOSE_ERROR_KEY_MAP` 键集合；
2. 每个映射值在 `locales/story2video/{zh,en}.js` 均存在且为字符串；
3. 新增码的文案 `{占位符}` 能在主进程 `messageParams` 找到（`PARAM_COVERAGE_CODES` 白名单控制范围，既有码由 normalizeParams 推导的除外）。

接入 `.github/workflows/quality-gate.yml` 的 `changes` job（`Gate 12g`，位于非 PR 早退之前），并登记到 `scripts/check-unwired-tests.js` 的 `MUST_LIVE_IN_UNGATED_JOB`。

---

## 5. 预防措施（落到具体文件变更）

| # | 措施 | 落地文件 |
| --- | --- | --- |
| 1 | 新增机械门禁 + 6 道变异反证 | `scripts/check-compose-error-codes.js` / `.test.js` / `quality-gate.yml` Gate 12g |
| 2 | 接线锁登记（防只接在被短路 job） | `scripts/check-unwired-tests.js` `MUST_LIVE_IN_UNGATED_JOB` |
| 3 | AGENTS.md QM-2 新增「service/stage 返回值 message 铁律」条目 | `AGENTS.md` |
| 4 | openspec 规格固化「主进程业务失败必须返回稳定错误码」 | `openspec/changes/error-message-user-friendly-audit/specs/user-facing-messages/spec.md` |
| 5 | 详版 PRD（数据校验/流程/交互/显示项/提示文字全表） | `01-docs/PRD-USER-FACING-ERROR-MESSAGES-2026-10-20.md` |
| 6 | 历史记录失败卡片显示契约补充 | `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` |
| 7 | 产品契约条目 | `01-docs/PRD.md` |
| 8 | CHANGELOG 置顶 | `CHANGELOG.md` |
| 9 | learnings 置顶（含「变异必须断言已落地」教训） | `01-docs/learnings.md` |
| 10 | 执行记录 | `openspec/records/error-message-user-friendly-audit.md` |
| 11 | 记忆三路沉淀 | `~/.dsh/memory/Mulpub/` + gstack `learnings.jsonl` + EverOS |

---

## 6. 过程教训（本轮新踩的坑）

### 6.1 变异测试用 PowerShell `-replace` 会静默不生效

第一轮做门禁变异反证时，用 PowerShell `-replace "第 \{scene\} ...", "第 \{sceneIndex\} ..."`。PowerShell 正则把 `{scene}` 当作 .NET 量化表达式，替换结果写成字面 `\{scene\}`——**文件确实被改了**（`Select-String` 能 grep 到 `sceneIndex`），但门禁 PASS。差点写成「M3 MISSED_BY_DESIGN」。

**正解**：变异必须用 Node/Python 脚本做字符串替换，且**断言变异确实改变了文件内容**（`mutate()` 内的 `assert.notStrictEqual(after, before)`）。本轮测试文件里已固化这条。

### 6.2 沙箱路径：脚本按 `__dirname/..` 定位仓库根，副本必须放子目录

`check-compose-error-codes.js` 用 `path.resolve(__dirname, '..')` 定位仓库根。自测第一版把脚本副本放进沙箱**根**，结果 ROOT 解析成沙箱的父目录（系统临时目录），四个依赖文件全部 ENOENT，7 个用例全红——而门禁本身在真实仓库是 PASS 的。

**正解**：副本放 `<sandbox>/scripts/`，与仓库同构。

### 6.3 组件测试的 i18n mock 语义差异

`CreateViewHistory.test.js` 既有 mock 约定「无参返回 key」，而 `formatError` 重构后走「先取模板再自行插值」路径，需要无参时返回**字符串原文**。直接改全局 mock 会一次性破坏 13 个既有用例。

**正解**：保留原 mock，新增 `templateAwareT` 只供新用例使用（`mountHistory(history, props, t)` 第三参）。

### 6.4 「先用 msg !== key 判断」是错的

重构 `formatError` 时第一版写 `let msg = this.$t?.(key) || ''; ... if (msg && msg !== key) return msg`。生产 vue-i18n 对字符串消息不会自动插值，无参调用拿到的是**未插值模板**；若模板恰好等于 key（不可能）或 mock 返回 key，就会走到兜底。

**正解**：先取原文，再插值，最后比较。

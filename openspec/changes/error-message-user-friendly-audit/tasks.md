# tasks — error-message-user-friendly-audit

## 1. 主进程：稳定错误码契约

- [x] 1.1 `apps/desktop/electron/services/story2video-compose-engine.js` 新增 `COMPOSE_ERROR_CODES` 封闭常量集合（8 个码）+ `composeFailure()` 组装器 + `bytesToSize()` 自适应单位函数
- [x] 1.2 预检分支接入：`INPUT_SIZE_EXCEEDED`（场景媒体累计 / BGM 计入总量两处）、`SCENE_MEDIA_UNREADABLE`、`SCENE_AUDIO_UNREADABLE`
- [x] 1.3 时长分支接入：`SEGMENT_DURATION_EXCEEDED` / `OUTPUT_DURATION_EXCEEDED`（含 requested/composed 两类复用）/ `AUDIO_DURATION_EXCEEDED`
- [x] 1.4 `FFMPEG_NOT_FOUND` / `INVALID_ASSET_MANIFEST` 两个既有英文分支接入稳定码
- [x] 1.5 导出 `COMPOSE_ERROR_CODES`（供测试与门禁读取）
- [x] 1.6 回归测试：`story2video-compose-engine.test.js` 新增 `预检失败稳定错误码契约` describe（5 例：总量超限 / BGM 计入 / 场景媒体 / 场景旁白 / 不泄漏英文）

## 2. 主进程：错误码穿透 stage 与落库边界

- [x] 2.1 `stage-executor.js` COMPOSE 失败分支上抛 `errorCode` / `messageParams`
- [x] 2.2 `pipeline-engine.js` 新增 `buildStageFailureError()`；`_finalizeRun` 分别落 `run.error`（字符串契约不变）/ `run.errorCode` / `run.errorParams`
- [x] 2.3 `_finalizeRun` 内 `terminalStage.error` 与终态日志同样容忍结构化 error（字符串归一）
- [x] 2.4 `getRunSnapshot()` 增补 `errorCode` / `errorParams`（IPC 边界输出 `null` 而非 `undefined`）
- [x] 2.5 `run-state-store.js` 快照增补 `errorCode` / `errorParams`（`version` 保持 1，纯增量字段）
- [x] 2.6 回归测试：`electron/tests/pipeline-engine.test.js` 新增 `stage 失败稳定错误码上抛` describe（3 例：带码落库 / 无码不写 / 字符串 error 旧调用方）

## 3. 渲染端：三通道归一化

- [x] 3.1 `notification-error-patterns.js` 新增 3 个 compose 预检模式（`COMPOSE_INPUT_SIZE_EXCEEDED_PATTERN` / `COMPOSE_SCENE_MEDIA_UNREADABLE_PATTERN` / `COMPOSE_SCENE_AUDIO_UNREADABLE_PATTERN`）
- [x] 3.2 `story2video-notifications.js` 新增 3 个 key + `errorCode` 直连分支 + 原文模式分支（判定顺序早于 `COMPOSE_STAGE_PATTERN`）
- [x] 3.3 `normalizeParams` 新增 compose 预检参数归一化分支（场景号 / 体积），兜底词走 locale（`labels.currentScene` / `labels.unknownSize`），不硬编码中文
- [x] 3.4 `pipeline-error-formatter.js` RULES 新增 `compose_input_size_exceeded` 规则，可从原文按出现顺序提取 `actualMb` / `limitMb`
- [x] 3.5 `history-utils.js` 新增 `COMPOSE_ERROR_KEY_MAP` 显式映射表（8 条）
- [x] 3.6 `CreateViewHistory.vue` `formatError` 重构：formatter 优先 → 稳定码映射兜底 → 原文透传；参数用展开合并（`context` 空串保留键位）
- [x] 3.7 回归测试：`story2video-notifications.test.js` 新增 describe（5 例）；`pipeline-error-formatter.test.js` 新增 describe（4 例）；`CreateViewHistory.test.js` 新增 2 例 + 新增 `templateAwareT` mock（不破坏既有「无参返回 key」约定）

## 4. locale：zh/en 成对文案

- [x] 4.1 `compose_input_size_exceeded` / `compose_scene_media_unreadable` / `compose_scene_audio_unreadable` / `compose_ffmpeg_not_found` / `compose_invalid_asset_manifest` / `compose_audio_duration_exceeded`（zh/en 成对，含体积/场景号插值与可操作建议）
- [x] 4.2 `labels.currentScene` / `labels.unknownSize`（兜底标签）
- [x] 4.3 `compose_duration_exceeded` 的 `{limitMinutes}` 占位符**不改**（既有契约，由 normalizeParams 推导）

## 5. 机械门禁（防再犯）

- [x] 5.1 新增 `scripts/check-compose-error-codes.js`（只 require node 内置模块）
- [x] 5.2 新增 `scripts/check-compose-error-codes.test.js`（7 例：基线 PASS + 6 道变异反证）
- [x] 5.3 接入 `.github/workflows/quality-gate.yml` 的 `changes` job（`Gate 12g`，非 PR 早退之前）
- [x] 5.4 登记到 `scripts/check-unwired-tests.js` 的 `MUST_LIVE_IN_UNGATED_JOB`（`check-unwired-tests.js` 实跑 rc=0）

## 6. 文档与沉淀

- [x] 6.1 `01-docs/PRD-USER-FACING-ERROR-MESSAGES-2026-10-20.md`（详版 PRD：数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字全表）
- [x] 6.2 `01-docs/BUGFIX-HISTORY-CARD-RAW-ENGLISH-ERROR-2026-10-20.md`（根因溯源 + 逃逸链 + 系统性漏洞 + 回归保护 + 预防措施，QM-5 五步）
- [x] 6.3 `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` 补充失败原因显示契约（§3.2.1）
- [x] 6.4 `01-docs/PRD.md` §产品契约条目
- [x] 6.5 `CHANGELOG.md` 置顶条目
- [x] 6.6 `01-docs/learnings.md` 置顶章节
- [x] 6.7 `openspec/records/error-message-user-friendly-audit.md` 执行记录
- [x] 6.8 记忆三路沉淀（内置 `~/.dsh/memory/Mulpub/` / 外部 learnings + gstack jsonl / EverOS add→flush→读回）

## 7. 交付

- [x] 7.1 质量节拍门禁自检（locale 三项 / 品牌残留 / 行尾对账 / docs-sync / 债务预算 / unwired 棘轮）
- [ ] 7.2 QM-1 打包验证（未改 electron 主进程 require 结构；本地打包待 CI 后补）
- [x] 7.3 推送 + PR #4062 + rebase 消解追加型文件冲突（两侧记录都保留）
- [ ] 7.4 CI 全绿后自动 squash 合并 + worktree 按 R1-R5 清理

## 8. 追加：逐文件行数门禁拆分（2026-10-20）

`story2video-notifications.js` 因本次新增分支从 497 → 543 行，触发债务熔断 `filesOver500: 96 > 95`。按 AGENTS.md 拆分为三个模块（行为零变化，216 例回归锁定）。

**实物归属**：拆分代码由提交 `4be07714f` 引入（本 PR 的主修复提交）；本节勾选落在其后的文档提交上，故在此显式记下归属，读者不必回翻 PR 历史即可核验（CCG 外部评审 i2 指出原版只有勾选、无归属指针）。

- [x] 8.1 `story2video-notifications-keys.js`（109 行）：`STORY2VIDEO_NOTIFICATION_KEYS` 单一真源，避免 params 模块反向 import 主模块形成循环依赖 —— 归属 `4be07714f`
- [x] 8.2 `story2video-notification-params.js`（261 行）：`normalizeStory2VideoParams` / `interpolateStory2VideoMessage` / `resolveLocaleRef` —— 归属 `4be07714f`
- [x] 8.3 主模块保留「消息渲染编排 + 归一化判定 + 导出 API」（238 行）—— 归属 `4be07714f`
- [x] 8.4 债务门禁复跑 `filesOver500: 95 == 95` 回到基线内 —— 复跑读数见本 PR 提交 `4be07714f` 之后的门禁输出

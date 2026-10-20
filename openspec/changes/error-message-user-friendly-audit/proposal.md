# error-message-user-friendly-audit：compose 预检失败用户友好化 + 全量提示错误排查

## Why

用户报障：**「视频创作 → 历史记录 → 执行失败」标签的任务卡片，失败原因显示 `Input media exceeds the total size limit`**。这是 API 接口返回的原始英文技术信息，没有做用户友好化处理。

项目此前已立过铁律：**所有提示/报错信息都必须用用户友好的自然语言说明，并给出建议或解决方法；文字必须支持多语言版**（`01-docs/coding-standards.md` message 铁律、`openspec/specs/user-facing-messages/spec.md`、`01-docs/PROMPT-TEXT-SPEC.md`）。这次又违反了，需要查清为什么不处理，并做一次全量排查。

### 根因（第一性原因）

逃逸链有四层，缺任何一层都不会漏：

1. **主进程把英文技术 message 当作唯一失败载荷**。`story2video-compose-engine.js` 的预检分支直接 `return { code: -1, message: 'Input media exceeds the total size limit' }`——没有稳定 `errorCode`，也没有可插值 `messageParams`。同文件另有 20+ 处同类英文 message（`ffmpeg not found`、`Scene media path is not allowed or unreadable at index N`、`Composed video duration exceeds the allowed limit of N minutes` 等）。

2. **stage 边界把结构化字段丢光**。`stage-executor.js` 的 COMPOSE 分支只 `return { success: false, error: result.message }`——即便引擎给了 `errorCode` 也传不出去。

3. **落库只存字符串**。`pipeline-engine.js` 的 `_finalizeRun(run, 'failed', result.error)` 只写 `run.error`，`errorCode`/`messageParams` 无处安放；`run-state-store.js` 的快照同样只存 `error`。

4. **渲染端「短自然语言直出」分支成为泄漏通道**。`pipeline-error-formatter.js` 的兜底逻辑是 `raw.length <= 120 && !/[{}\[\]]|Error code|ENOTDIR|.../` → 原样返回原文。`Input media exceeds the total size limit` 长度 41、无任何技术标记，于是**被判成"已经是自然语言"直接透出**。而它的规则表里既没有这条模式，`story2video-notifications.js` 的归一化正则也没有。

**根本的设计缺陷**：三套渲染路径（`story2video-notifications.js`、`pipeline-error-formatter.js`、`user-facing-error.js`）都靠**匹配英文原文**来还原语义。只要主进程新增一处英文 message 而不同步三处正则，就必然泄漏。这不是"漏改一处"，而是**契约本身缺失**——没有"主进程必须返回稳定 errorCode"的强制要求，也没有机械门禁去校验。

### 为什么之前没人处理

- 2026-08-11 `prompt-user-friendly-i18n` 那次统一整改覆盖的是 `license-access-control.js` / `model-provider-manager.js` 的 IPC 拒绝路径与 `user-facing-error.js`，**compose 引擎的预检失败不在射程内**（它不走 IPC handler，而是经 `service-bus.composeVideo → stage-executor → pipeline-engine` 落库，前端从历史记录读）。
- 2026-08-19 `s2v-history-error-message-hardening` 只修了 `{sceneText}` 占位符泄漏，规则表按"已知错误文本"逐条加，**没有回填"新增英文 message 必须同步归一化"的契约**。
- CJK 门禁（`check-locale-sync.js --cjk`）只扫 `apps/desktop/src` 与 `packages/python-backend/src`，**不扫 `apps/desktop/electron`**——主进程新增英文 message 完全在门禁视野外。

## What Changes

- **主进程：稳定错误码契约（新增单一真源）**
  - `story2video-compose-engine.js` 导出 `COMPOSE_ERROR_CODES` 与 `composeFailure()` 组装器；预检/时长类失败一律返回 `{ code: -1, errorCode, message, messageParams }`。
  - 覆盖：`COMPOSE_FFMPEG_NOT_FOUND` / `COMPOSE_INVALID_ASSET_MANIFEST` / `COMPOSE_INPUT_SIZE_EXCEEDED` / `COMPOSE_SCENE_MEDIA_UNREADABLE` / `COMPOSE_SCENE_AUDIO_UNREADABLE` / `COMPOSE_SEGMENT_DURATION_EXCEEDED` / `COMPOSE_DURATION_EXCEEDED` / `COMPOSE_AUDIO_DURATION_EXCEEDED`。
  - `messageParams` 只放**可插值用户可读值**（`limitMb`/`actualMb` 为带单位体积串、`scene` 为 1-based 场景号、`limit` 为格式化时长），不放裸字节数/路径/堆栈。

- **主进程：错误码穿透 stage 与落库边界**
  - `stage-executor.js` COMPOSE 失败分支上抛 `errorCode`/`messageParams`。
  - `pipeline-engine.js` 新增 `buildStageFailureError()`：把 `{error, errorCode, messageParams}` 构造成可上抛对象；`_finalizeRun` 分别落 `run.error`（字符串契约不变）、`run.errorCode`、`run.errorParams`；`getRunSnapshot` 增补同名字段（IPC 边界输出 `null` 而非 `undefined`）。
  - `run-state-store.js` 快照增补 `errorCode`/`errorParams`（version 保持 1，纯增量字段）。

- **渲染端：三通道同时认「稳定码 + 存量英文原文」**
  - `notification-error-patterns.js` 新增 `COMPOSE_INPUT_SIZE_EXCEEDED_PATTERN` / `COMPOSE_SCENE_MEDIA_UNREADABLE_PATTERN` / `COMPOSE_SCENE_AUDIO_UNREADABLE_PATTERN`，且判定顺序**早于** `COMPOSE_STAGE_PATTERN` 与「短自然语言直出」分支。
  - `story2video-notifications.js` 新增 3 个 key + 参数归一化分支（含场景号/体积兜底，兜底词走 locale，不硬编码）。
  - `pipeline-error-formatter.js` RULES 新增 `compose_input_size_exceeded` 规则，可从原文提取 `actualMb`/`limitMb`。
  - `CreateViewHistory.vue` `formatError` 改为「formatter 优先 → 稳定码映射兜底 → 原文透传」；错误码 → locale key 用**显式映射表** `COMPOSE_ERROR_KEY_MAP`（`history-utils.js`），禁止字符串拼接猜测。

- **locale：zh/en 成对新增 5 条文案**
  - `compose_input_size_exceeded` / `compose_scene_media_unreadable` / `compose_scene_audio_unreadable`（含体积、场景号插值与可操作建议）。
  - `labels.currentScene` / `labels.unknownSize`（兜底标签，避免空占位符）。

- **机械门禁（防再犯，本 change 的核心增量）**
  - 新增 `scripts/check-compose-error-codes.js`：断言 `story2video-compose-engine.js` 的 `COMPOSE_ERROR_CODES` 与 `history-utils.js` 的 `COMPOSE_ERROR_KEY_MAP` **一一对应**，且每个 key 在 `locales/story2video/{zh,en}.js` 均存在。新增错误码漏改任一侧即红。
  - 接入 `quality-gate.yml` 的 `changes` job（不被 docs-only 短路、位于非 PR 早退之前）。
  - 接线锁由 `scripts/check-unwired-tests.js` 的 `MUST_LIVE_IN_UNGATED_JOB` 登记（`check-compose-error-codes.js` 是门禁数据文件，必须先接线再进白名单）。

## Impact

- **受影响代码**：`apps/desktop/electron/services/{story2video-compose-engine.js, stage-executor.js, pipeline-engine.js, run-state-store.js}`、`apps/desktop/src/{story2video/*, utils/pipeline-error-formatter.js, views/CreateViewHistory.vue, views/history-utils.js, locales/story2video/{zh,en}.js}`、`.github/workflows/quality-gate.yml`、`scripts/`。
- **行为变更**：历史记录失败卡片在 compose 预检失败时显示自然语言上限提示（含实际/上限体积与操作建议），不再显示英文原文。存量历史数据（只有英文 `run.error`）同样被归一化。
- **兼容性**：`run.error` / `stage.error` 保持字符串契约（恢复门控 `RESUME_BLOCKING_ERROR_PATTERN`、阶段摘要均读字符串）；新增字段为 additive，旧快照缺省为 `null`/`undefined`，读取端已容忍。
- **风险**：`_finalizeRun` 现接受字符串或结构化对象——已加类型分支与回归测试；`getRunSnapshot` 输出新增两个字段，IPC 消费方（前端轮询）忽略未知字段，无破坏。
- **不在本 change 范围**：compose 引擎其余 20+ 处英文 message 的全面 errorCode 化（`ffmpeg not found`、`Narration concat failed` 等执行阶段错误）——它们多数已由既有 `COMPOSE_STAGE_PATTERN` + `compose_failed` 文案覆盖为"视频合成失败 + 建议"，本次只做预检类（用户可直接行动的那批）。列为后续 change。

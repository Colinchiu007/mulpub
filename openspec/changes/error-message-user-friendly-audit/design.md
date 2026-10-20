# design — error-message-user-friendly-audit

## 1. 方案对比

| 方案 | 做法 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| A. 只补正则 | 在 `pipeline-error-formatter.js` 与 `story2video-notifications.js` 各加一条匹配 `Input media exceeds...` 的模式 | 改动最小，一次到位 | **没解决问题**：主进程还有 20+ 处英文 message，下次新增同样泄漏；三处正则靠人同步 | ❌ |
| B. 只改主进程文案为中文 | 把 `message` 改成中文自然语言 | 卡片立即变中文 | 违背多语言（英文用户看到中文）；`run.error` 中文又会让英文界面出错；恢复门控 `RESUME_BLOCKING_ERROR_PATTERN` 等文本匹配受影响 | ❌ |
| C. **稳定错误码契约 + 显式映射 + 机械门禁** | 主进程返回 `errorCode` + `messageParams`；渲染端按码查显式映射表；门禁校验三侧一致 | 多语言天然成立（文案在 locale）；新增码漏改会被机械抓到；`run.error` 字符串契约不变，恢复门控不受影响 | 改动面较大（4 个主进程文件 + 5 个渲染端文件 + 1 个门禁） | ✅ **选 C** |

**为什么不能只做 A**：本次事故的四层逃逸链里，最根本的是第 4 层「渲染端靠匹配英文原文还原语义」。只要这个机制不变，任何新增英文 message 都是潜在泄漏。C 把「语义」从文本提到稳定码，文本模式只作为存量数据兼容通道。

**为什么保留文本模式通道**：历史库里已有大量只有英文 `run.error` 的存量失败记录，不能要求用户重跑。因此归一化必须是双通道：`errorCode` 优先，原文模式兜底。

## 2. 数据流

```
story2video-compose-engine.compose()
  └─ 预检失败 → composeFailure(COMPOSE_ERROR_CODES.INPUT_SIZE_EXCEEDED, <诊断原文>, {limitMb, actualMb, scene})
       │
       ▼
service-bus.composeVideo()            （原样返回引擎结果）
       │
       ▼
stage-executor COMPOSE 分支
  └─ { success:false, error:<message>, errorCode, messageParams }   ← 2.1：不再丢结构化字段
       │
       ▼
pipeline-engine._executeStage → executeStage / _autoAdvanceRun
  └─ buildStageFailureError(result) → { message, errorCode, messageParams }   ← 2.2
       │
       ▼
_finalizeRun(run, 'failed', stageError)
  ├─ run.error       = <message 字符串>      （契约不变）
  ├─ run.errorCode   = 'COMPOSE_INPUT_SIZE_EXCEEDED'
  └─ run.errorParams = { limitMb, actualMb, scene }
       │
       ├─ getRunSnapshot() → IPC → 前端轮询（含 errorCode/errorParams，无码时 null）
       └─ run-state-store 快照（errorCode/errorParams，version 仍为 1）
              │
              ▼
       CreateViewHistory.formatError(item)
         ├─ formatPipelineError(item.error)  → key + params（存量原文通道）
         ├─ COMPOSE_ERROR_KEY_MAP[item.errorCode] → key（稳定码通道）
         ├─ 参数合并：{ ...formatterParams, ...item.errorParams }
         └─ $t(key) 取模板 → 自行插值 → 渲染
```

## 3. 关键设计决策

### 3.1 `run.error` 为什么必须保持字符串

`RESUME_BLOCKING_ERROR_PATTERN` / `CONTENT_POLICY_ERROR_PATTERN`（`history-utils.js`）、阶段摘要渲染、`getHistory()` 都读 `run.error` 做字符串匹配。改成对象会一次性破坏这些路径。因此结构化字段**另起** `run.errorCode` / `run.errorParams`，不动 `run.error`。

### 3.2 错误码到 locale key 为什么必须显式映射

字符串推导（`'story2video.' + code.replace(/^COMPOSE_/, 'compose_').toLowerCase()`）在本轮第一版就是这么写的，随即发现两个问题：

1. `COMPOSE_DURATION_EXCEEDED` → `compose_duration_exceeded` 恰好对，但 `COMPOSE_AUDIO_DURATION_EXCEEDED` → `compose_audio_duration_exceeded` 需要额外确认存在；
2. 推导规则本身没有判据守护——拼错的 key 会让 vue-i18n 原样返回 key 字符串，**直接显示 `story2video.compose_xxx` 给用户**。

因此改为 `COMPOSE_ERROR_KEY_MAP` 显式表，并由 `check-compose-error-codes.js` 校验「表 ↔ 主进程常量 ↔ locale 文案」三侧相等。

### 3.3 三个时长码为什么不能合并成一个

`COMPOSE_SEGMENT_DURATION_EXCEEDED`（单段旁白）、`COMPOSE_DURATION_EXCEEDED`（成片总时长）、`COMPOSE_AUDIO_DURATION_EXCEEDED`（旁白总时长）对用户的**建议不同**：前者要「拆分该段文案」，后两者要「缩短文案或减少场景」。合并会让用户按错误建议操作。`requested` / `composed` 两类与「成片总时长」建议相同，故复用 `COMPOSE_DURATION_EXCEEDED`，不新增文案（避免同义多份文案漂移）。

### 3.4 兜底词为什么走 locale 而不硬编码

第一版把「该场景 / 允许上限」硬编码在 `story2video-notifications.js` 里，被 `check-locale-sync.js --cjk` 当场判红（新增 2 处硬编码中文）。这验证了 CJK 门禁确实在守这条线——正确做法是把兜底词也写进 `locales/story2video/{zh,en}.js` 的 `labels`。

### 3.5 门禁为什么住 `changes` job

本锁的输入含 `locales/story2video/{zh,en}.js` 与 `src/views/history-utils.js`。若只改文案/映射，PR 会被 `classify-docs-only.js` 判为 docs-only，`static-gates` 整个 job 被短路 ⇒ 锁一次都不跑。因此按 `MUST_LIVE_IN_UNGATED_JOB` 登记并接入 `changes` job（该 job 无 `Install deps`，故判据只 require node 内置模块）。

### 3.6 为什么保留「短自然语言直出」分支而不删掉

`pipeline-error-formatter.js` 的 `raw.length <= 120 && !/技术标记/` → 透传原文，是**既有设计**（`user-facing-error.js` 的 learnings 明确要求「对已是自然语言的原因文本应原样透传保留信息」）。删掉会让「排期失败：任务不存在」这类中文原因退化成通用文案，违背「保留具体原因」的需求。本次只在其**之前**插入 compose 预检规则，不改该分支本身。

## 4. 已知限制（不假装已闭合）

1. **compose 执行阶段（ffmpeg 子进程）的 20+ 处英文 message 未全面 errorCode 化**（`ffmpeg did not produce output`、`Narration concat failed` 等）。它们多数已被既有 `COMPOSE_STAGE_PATTERN` + `compose_failed` 文案覆盖为「视频合成失败 + 检查磁盘/从断点继续」，用户可操作；本次只做预检类（用户可直接行动的那批）。列为后续 change。
2. **`looksTechnical` 不认英文句子**。`TECHNICAL_TEXT_PATTERNS` 只匹配通道名 / 大写下划线码 / 栈信息 / IP:端口，纯英文技术句（如本次的 `Input media exceeds...`）不在域内。要覆盖需引入英文技术词表，误报风险高（会把正常英文提示判成技术文本），本次不做。
3. **存量历史记录不会自动补 errorCode**。只有新产生的失败运行带 `errorCode`；存量记录走原文模式通道归一化（已由测试锁定行为一致）。

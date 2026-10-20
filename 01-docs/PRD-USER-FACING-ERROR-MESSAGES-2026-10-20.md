# PRD：用户可见提示与错误信息全量友好化（compose 预检失败专项）

- **文档版本**：v1.0
- **日期**：2026-10-20
- **关联 change**：`openspec/changes/error-message-user-friendly-audit/`
- **关联规格**：`openspec/specs/user-facing-messages/spec.md`（本 PRD 是该规格在「非 IPC 失败路径」上的落地合同）

---

## 1. 背景与问题

### 1.1 用户报障原文

> 视频创作-历史记录中-执行失败标签，任务卡片上的失败原因，显示 "Input media exceeds the total size limit"
> 是 API 接口返回的实际信息吧？没有做用户友好化的处理。
> 之前就在项目中制定过原则：所有的提示或报错信息，都应该用用户友好的自然语言说明，并给出建议或解决方法。并且文字要支持多语言版。
> 这个情况怎么又违反了原则？查一下为什么不进行处理。并且进行全部提示和错误信息的排查。

### 1.2 原则来源（项目既有铁律，非本次新立）

| 文件 | 条款 |
| --- | --- |
| `01-docs/coding-standards.md` L43 | **message 铁律**：必须为自然语言（具体原因 + 解决方法建议）；禁止拼入内部通道名、英文括号注释、内部错误码、栈信息、IP:端口 |
| `openspec/specs/user-facing-messages/spec.md` | 访问控制拒绝结果返回稳定 `errorCode` + 去掉内部通道名的自然语言 `message` |
| `01-docs/PROMPT-TEXT-SPEC.md` L30 | `message` 必须是自然语言（具体原因 + 解决方法建议）；未知错误含技术标识 → 兜底，其余自然语言原因文本 → 原样透传 |
| `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` L117 | 主进程/历史记录可保存技术错误，但 renderer 不直接回显 provider JSON、HTTP code、堆栈、token 或内部前缀 |
| `01-docs/PRD-video-creation.md` L1991 | 失败任务额外显示失败环节和自然语言"失败原因"，不得直接展示原始错误对象 |

### 1.3 逃逸链（为什么这次又违反）

```
① 主进程把英文技术 message 当作唯一失败载荷
   story2video-compose-engine.js:951  return { code: -1, message: 'Input media exceeds the total size limit' }
   ↓ 没有 errorCode，没有 messageParams
② stage 边界把结构化字段丢光
   stage-executor.js:746  return { success: false, error: (result && result.message) || 'Compose failed' }
   ↓ 即便引擎给了 errorCode 也传不出去
③ 落库只存字符串
   pipeline-engine.js:2120  if (error) run.error = error;
   ↓ errorCode/messageParams 无处安放
④ 渲染端「短自然语言直出」分支成为泄漏通道
   pipeline-error-formatter.js:215  if (raw.length <= 120 && !/技术标记/) return { message: raw, ... }
   ↓ 长度 41、无技术标记 ⇒ 被判成"已经是自然语言"直接透出
   ⇒ 用户在历史记录失败卡片看到英文
```

### 1.4 为什么之前没人处理（归因，不停在"漏改一处"）

| 时间 | 整改 | 覆盖范围 | 为什么没覆盖本次 |
| --- | --- | --- | --- |
| 2026-08-11 | `prompt-user-friendly-i18n` | `license-access-control.js` / `model-provider-manager.js` 的 IPC 拒绝路径 + 新增 `user-facing-error.js` | compose 引擎不走 IPC handler，经 `service-bus → stage-executor → pipeline-engine` 落库，**不在射程内** |
| 2026-08-19 | `s2v-history-error-message-hardening` | `{sceneText}` 占位符泄漏 | 规则表按「已知错误文本」逐条加，**没有回填「新增英文 message 必须同步归一化」的契约** |
| 持续 | CJK 门禁 `check-locale-sync.js --cjk` | `apps/desktop/src` 与 `packages/python-backend/src` | **不扫 `apps/desktop/electron`** ⇒ 主进程新增英文 message 完全在门禁视野外 |

**系统性漏洞**：三套渲染路径（`story2video-notifications.js` / `pipeline-error-formatter.js` / `user-facing-error.js`）都靠**匹配英文原文**还原语义。只要主进程新增一处英文 message 而不同步正则，就必然泄漏。这不是"漏改一处"，而是**契约本身缺失**——没有"主进程必须返回稳定 errorCode"的强制要求，也没有机械门禁校验三侧一致。

---

## 2. 目标与非目标

### 2.1 目标

1. compose 预检类失败在历史记录失败卡片显示**当前语言的自然语言**，含具体原因 + 可操作建议，不出现英文原文、i18n key、占位符。
2. 建立「稳定错误码」契约，使新增失败分支**漏改任一侧即被机械门禁拦截**。
3. 存量历史记录（只有英文 `run.error`）同样归一化，不要求用户重跑。
4. `run.error` 字符串契约不变，恢复门控 / 阶段摘要 / 历史读取零影响。

### 2.2 非目标（本次明确不做）

- compose **执行阶段**（ffmpeg 子进程）20+ 处英文 message 的全面 errorCode 化——已由既有 `compose_failed` 文案覆盖为可操作建议，列为后续 change。
- 删除 `pipeline-error-formatter.js` 的「短自然语言直出」分支——它是 `PROMPT-TEXT-SPEC.md` 要求的「保留具体原因」机制，本次只在其之前插入规则。
- `looksTechnical` 增加英文技术词表——误报风险高，本次不做。

---

## 3. 功能逻辑

### 3.1 主进程错误码表（`COMPOSE_ERROR_CODES`）

| 常量名 | errorCode 值 | 触发条件 | messageParams | locale key |
| --- | --- | --- | --- | --- |
| `FFMPEG_NOT_FOUND` | `COMPOSE_FFMPEG_NOT_FOUND` | `this.ffmpegBinary` 为空 | — | `compose_ffmpeg_not_found` |
| `INVALID_ASSET_MANIFEST` | `COMPOSE_INVALID_ASSET_MANIFEST` | `normalizeComposeScenes` 返回空 | — | `compose_invalid_asset_manifest` |
| `INPUT_SIZE_EXCEEDED` | `COMPOSE_INPUT_SIZE_EXCEEDED` | 场景媒体累计或 BGM 计入后超过 `maxInputTotalBytes` | `{limitMb, actualMb, scene?}` / `{limitMb, actualMb, kind:'bgm'}` | `compose_input_size_exceeded` |
| `SCENE_MEDIA_UNREADABLE` | `COMPOSE_SCENE_MEDIA_UNREADABLE` | 场景 `imagePath`/`videoPath` 解析失败 | `{scene}` | `compose_scene_media_unreadable` |
| `SCENE_AUDIO_UNREADABLE` | `COMPOSE_SCENE_AUDIO_UNREADABLE` | 场景 `audioPath` 解析失败 | `{scene}` | `compose_scene_audio_unreadable` |
| `SEGMENT_DURATION_EXCEEDED` | `COMPOSE_SEGMENT_DURATION_EXCEEDED` | 多场景时单段旁白超 `maxSegmentDurationSeconds` | `{limit, scene}` | `compose_segment_duration_exceeded` |
| `OUTPUT_DURATION_EXCEEDED` | `COMPOSE_DURATION_EXCEEDED` | 旁白总时长 / 成片时长 / 请求时长超 `maxDurationSeconds` | `{limit}` | `compose_duration_exceeded` |
| `AUDIO_DURATION_EXCEEDED` | `COMPOSE_AUDIO_DURATION_EXCEEDED` | 旁白总时长超 `maxAudioDurationSeconds`（更严旁白约束） | `{limit}` | `compose_audio_duration_exceeded` |

**场景号口径**：`messageParams.scene` 是 **1-based**（`index + 1`），与用户认知的「第 N 个场景」一致；`MUST NOT` 是 0-based 数组索引。

**体积口径**：`bytesToSize()` 自适应单位——`>= 1MB` 输出 `xxx.xMB`，否则输出 `xxxKB`（至少 1KB）。避免「0.0 MB」把上限显示成 0 的误导。

### 3.2 渲染端归一化优先级

```
formatError(item)
  ├─ item.error 为空 → genericFailure
  ├─ ① formatPipelineError(item.error) → { key, params }   （存量原文通道）
  ├─ ② COMPOSE_ERROR_KEY_MAP[item.errorCode] → key          （稳定码通道）
  ├─ key = ① || ②；params = { ...①.params, ...item.errorParams }
  ├─ $t(key) 取模板 → 按 {占位符} 自行插值 → 渲染
  ├─ 取不到模板 → 回落 ① 的 message（原文透传，仅当 ① 判为短自然语言）
  └─ 都没有 → genericFailure
```

`story2video-notifications.js` 的 `resolveMessageKey` 内，compose 预检模式的判定顺序：

```
... SCENE_AI_VIDEO_GENERATE_FAILED_PATTERN
→ COMPOSE_INPUT_SIZE_EXCEEDED（errorCode 直连 || 原文模式）     ← 新增，必须早于下面两条
→ COMPOSE_SCENE_MEDIA_UNREADABLE（同上）
→ COMPOSE_SCENE_AUDIO_UNREADABLE（同上）
→ fallbackKey
```

且整体早于 `COMPOSE_STAGE_PATTERN`（`notification-error-patterns.js` 内定义，供 `compose_timeout` 用）与「短自然语言直出」分支求值。

### 3.3 数据校验

| 校验项 | 规则 | 不满足时的行为 | 守护者 |
| --- | --- | --- | --- |
| 错误码三侧一致 | `COMPOSE_ERROR_CODES` 值集合 == `COMPOSE_ERROR_KEY_MAP` 键集合 | 门禁 rc=1，点名缺失/陈旧条目 | `check-compose-error-codes.js` |
| locale 文案成对存在 | 每个映射值在 `zh.js` 与 `en.js` 均存在且为字符串 | 门禁 rc=1，点名缺失文件 | 同上 + `check-locale-sync.js` |
| 占位符可提供 | 新增码的文案 `{xxx}` 能在主进程 `messageParams` 找到 | 门禁 rc=1，点名占位符 | 同上（`PARAM_COVERAGE_CODES` 白名单控制范围） |
| 场景号正整数 | `messageParams.scene` 为 > 0 的整数 | 回落 locale 兜底标签 `labels.currentScene` | `normalizeParams` |
| 体积串非空 | `limitMb` / `actualMb` 为非空串 | 回落 `labels.unknownSize` | `normalizeParams` |
| 无未解析占位符 | 最终文案不含 `{scene}` / `{limitMb}` / `{actualMb}` | 测试断言失败 | `story2video-notifications.test.js` |
| `run.error` 为字符串 | `_finalizeRun` 接受字符串或结构化对象，落库时归一为字符串 | 类型分支处理，不抛错 | `pipeline-engine.test.js` |
| IPC 无 undefined | `getRunSnapshot` 输出 `errorCode`/`errorParams` 无码时为 `null` | 测试断言 `toBeNull()` | `pipeline-engine.test.js` |
| 渲染端无硬编码中文 | `apps/desktop/src` 非 locales 文件新增中文字面量 | CJK 门禁 rc=1 | `check-locale-sync.js --cjk` |

---

## 4. 提示文字全表（zh / en 成对）

### 4.1 新增文案

| key | zh | en |
| --- | --- | --- |
| `compose_input_size_exceeded` | 本次要合成的素材总体积已达 {actualMb}，超过 {limitMb} 上限。请减少场景数量、压缩图片或旁白音频后重新启动生成；若使用了背景音乐，可暂时关闭或更换体积更小的音频。 | The media for this composition totals {actualMb}, which exceeds the {limitMb} limit. Use fewer scenes, compress the images or narration audio, then start generation again. If background music is enabled, try disabling it or use a smaller audio file. |
| `compose_scene_media_unreadable` | 第 {scene} 个场景的画面素材已失效或不可读取。请重新生成该场景的图片或视频素材后再从断点继续。 | The visual material for scene {scene} is no longer available or cannot be read. Regenerate that scene image or video, then resume from the breakpoint. |
| `compose_scene_audio_unreadable` | 第 {scene} 个场景的旁白音频已失效或不可读取。请重新生成该场景的语音后再从断点继续。 | The narration audio for scene {scene} is no longer available or cannot be read. Regenerate that scene voice, then resume from the breakpoint. |
| `compose_audio_duration_exceeded` | 旁白音频总时长超过 {limit} 上限。请缩短文案或减少场景后重新启动生成。 | The total narration audio duration exceeds the {limit} limit. Shorten the script or use fewer scenes, then start generation again. |
| `compose_ffmpeg_not_found` | 未找到视频合成组件，暂时无法生成视频。请重启应用；若仍未解决，请重新安装应用。 | The video composition component could not be found, so videos cannot be generated right now. Restart the app; if it still fails, reinstall the app. |
| `compose_invalid_asset_manifest` | 合成素材清单不完整，暂时无法生成视频。请从断点继续重新生成；若持续出现，请重新启动生成。 | The composition asset list is incomplete, so videos cannot be generated right now. Resume from the breakpoint to regenerate; if this continues, start generation again. |

### 4.2 新增兜底标签（`labels`）

| key | zh | en | 用途 |
| --- | --- | --- | --- |
| `labels.currentScene` | 该场景 | this scene | 主进程未给场景号时 |
| `labels.unknownSize` | 允许上限 | the allowed size | 主进程未给体积时 |

### 4.3 既有文案（不改）

`compose_duration_exceeded`（`{limitMinutes}`）、`compose_segment_duration_exceeded`、`compose_timeout`、`compose_failed` 等——`{limitMinutes}` 由 `normalizeParams` 从原文/参数二次推导，**不改用 `{limit}`**（会破坏既有渲染与测试）。

---

## 5. 显示项与交互逻辑

### 5.1 历史记录失败卡片（`CreateViewHistory.vue`）

| 显示项 | 数据源 | 渲染规则 |
| --- | --- | --- |
| 失败环节 | `item.pausedStage \|\| failedStage(item)` | `localizedStage()` 本地化阶段名 |
| 失败原因 | `formatError(item)` | 见 §3.2 优先级；`data-testid="history-failure-reason"` |
| 内容政策提示条 | `policyResumeHintFor(item)` | 仅内容政策类失败显示（`CONTENT_POLICY_ERROR_PATTERN`） |
| 恢复按钮 | `isResumeBlocked(item)` | 由 `RESUME_BLOCKING_ERROR_PATTERN` 判定，**不因文案改造改变** |

**交互约束**：失败原因改造**不得**改变任务生命周期与恢复门控。`RESUME_BLOCKING_ERROR_PATTERN` 读 `item.error`（字符串），与 `errorCode` 无关。

### 5.2 通知/弹窗路径

- `formatStory2VideoNotification({ errorCode, error, errorParams })` → `{ messageKey, message, codePointCount }`
- `resolveStory2VideoNotification({ errorCode, errorParams })` → `{ key, params, message }`（弹窗路径，先 resolve 入态再渲染）

两条路径都识别稳定码，**双次归一化幂等**（既有约束，本次新增分支不破坏）。

### 5.3 阶段失败事件（Backlot / 日志）

- `stage:fail` / `pipeline:fail` 事件的 `error` 字段为 **message 字符串**（不变），日志额外带 `errorCode=`（新增，便于检索）。
- `MUST NOT` 在事件载荷里塞整个结构化对象（会序列化成 `[object Object]`）。

---

## 6. 端到端流程

```
用户启动 story2video-compose 流水线
  → split → scene_context → optimize → select_video_scenes → generate_assets
  → compose 预检
      ├─ 通过 → 正常合成
      └─ 失败（如输入总量 780MB > 上限 512MB）
          → composeFailure('COMPOSE_INPUT_SIZE_EXCEEDED', <诊断原文>, {limitMb:'512MB', actualMb:'780MB', scene:12})
          → service-bus 原样返回
          → stage-executor 上抛 { success:false, error, errorCode, messageParams }
          → pipeline-engine._finalizeRun 落 run.error / run.errorCode / run.errorParams
          → run-state-store 快照持久化（version 1）
          → emit pipeline:fail（error 为 message 字符串，日志带 errorCode）
  → 前端轮询 getRunSnapshot 拿到 errorCode/errorParams
  → 历史记录卡片渲染
      → formatPipelineError(item.error) 命中 compose_input_size_exceeded（存量通道）
      → COMPOSE_ERROR_KEY_MAP['COMPOSE_INPUT_SIZE_EXCEEDED']（稳定码通道）
      → $t('story2video.compose_input_size_exceeded') 取模板
      → 插值 {actualMb}=780MB, {limitMb}=512MB
      → 显示：「本次要合成的素材总体积已达 780MB，超过 512MB 上限。请减少场景数量、压缩图片或旁白音频后重新启动生成；若使用了背景音乐，可暂时关闭或更换体积更小的音频。」
```

---

## 7. 回归保护测试

| 文件 | 新增用例 | 模式 | 锁什么 |
| --- | --- | --- | --- |
| `electron/services/story2video-compose-engine.test.js` | `预检失败稳定错误码契约` ×5 | 单元 | 错误码 + messageParams 形态；体积串带单位 |
| `electron/tests/pipeline-engine.test.js` | `stage 失败稳定错误码上抛` ×3 | 单元 | 带码落库 / 无码不写 / 字符串 error 旧调用方 |
| `src/story2video/story2video-notifications.test.js` | `compose 预检失败稳定错误码归一化` ×5 | 单元 | errorCode 直连 + 存量原文 + 英文界面 + 弹窗路径 |
| `src/utils/pipeline-error-formatter.test.js` | `compose 预检失败` ×4 | 单元 | 规则命中 + 体积提取 + 中文形态 + 英文界面 |
| `src/views/CreateViewHistory.test.js` | ×2 | 组件 | 卡片不显英文/不显 key/体积可见；存量数据同样归一化 |
| `scripts/check-compose-error-codes.test.js` | ×7（基线 + 6 变异） | 门禁自测 | 三侧一致的机械判据真能抓 |

**变异反证结果**（`check-compose-error-codes.js`，6 道全部 CAUGHT）：

| 变异 | 结果 |
| --- | --- |
| M1 删渲染端映射条目 | CAUGHT（点名错误码） |
| M2 删 zh locale 文案 | CAUGHT（点名缺失文件） |
| M3 改文案占位符为主进程不提供的名字 | CAUGHT（点名占位符） |
| M4 删主进程错误码常量 | CAUGHT（报陈旧映射条目） |
| M5 删 en locale 文案（zh 仍在） | CAUGHT（保证成对） |
| M6 清空整个映射表 | CAUGHT（报未登记） |

> ⚠️ 过程教训：第一轮用 PowerShell `-replace` 做变异，`{scene}` 被写成 `\{scene\}`，**变异已应用但门禁 PASS**——假阴性。改用 Node 脚本做变异后 M3 立刻 CAUGHT。测试里的变异必须断言「变异确实改变了文件内容」（`mutate()` 内的 `notStrictEqual`）。

---

## 8. 验收标准

| # | 验收项 | 判据 |
| --- | --- | --- |
| A1 | 新产生的 compose 输入超限失败，历史卡片显示中文自然语言 | 含「512MB」「780MB」与操作建议；不含 `Input media exceeds`、`total size limit`、`story2video.compose_*` |
| A2 | 英文界面显示英文文案 | 同样含体积数字，不含英文技术原文 |
| A3 | 存量历史记录（只有英文 error）归一化 | 不显示英文原文，不显示 i18n key |
| A4 | 参数缺失不渲染空占位符 | 文案不含 `{scene}` / `{limitMb}` / `{actualMb}` |
| A5 | `run.error` 字符串契约不变 | 恢复门控 / 阶段摘要 / 历史读取零回归 |
| A6 | 旧快照（无 errorCode）不抛错 | `getRunSnapshot` 输出 `null` |
| A7 | 门禁机械拦截漏改 | 6 道变异全部 rc=1 |
| A8 | locale 成对 | `check-locale-sync.js --pair-base/--cjk/--keys` 三项 PASS |
| A9 | 无新增硬编码中文 | CJK 基线不增长 |
| A10 | 相关测试全绿 | compose-engine / pipeline-engine / stage-executor / run-state-store / notifications / formatter / CreateViewHistory |

---

## 9. 风险与限制

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `_finalizeRun` 现接受对象，旧调用方传字符串 | 潜在类型混淆 | 类型分支 + 回归测试（§7） |
| `getRunSnapshot` 新增字段 | IPC 消费方解析 | additive，前端忽略未知字段 |
| 映射表与主进程常量漂移 | 渲染成 i18n key 原文 | `check-compose-error-codes.js` 机械拦截（6 变异验证） |
| compose 执行阶段英文 message 未全覆盖 | 那类失败显示「视频合成失败 + 建议」 | 既有文案已可操作；列为后续 change |
| 存量记录不带 errorCode | 走原文通道 | 已由测试锁定行为与稳定码通道一致 |

---

## 10. 后续 change（不在本次范围）

1. **compose 执行阶段 errorCode 化**：`ffmpeg did not produce output` / `Narration concat failed` / `BGM mix failed` 等 20+ 处，按「用户可采取的动作」分类补码。
2. **主进程英文 message 的 CJK 门禁扩展**：当前 `--cjk` 不扫 `apps/desktop/electron`。可增加「主进程 `message:` 字段英文句子扫描」棘轮（基线式，先吸收存量再拦新增）。
3. **错误码目录文档化**：把 `COMPOSE_ERROR_CODES` 与其它模块错误码收敛到一份 `01-docs/ERROR-CODES.md`，作为新增码的第一入口。

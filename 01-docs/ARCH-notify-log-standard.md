# 通知/错误文案统一标准 + 日志关联 — 技术方案（PRD + 架构设计）

> **状态**: 待评审（PRD 待 CEO 签字）
> **日期**: 2026-08-29
> **作者**: PROJECT-003 架构组
> **涉及模块**: `apps/desktop/src`（renderer）、`apps/desktop/electron`（main）
> **配套流程**: 本方案走「先文档再代码」；实现阶段经 openspec 建 change，运行时改动在隔离 worktree 上进行

---

## 一、背景与问题（Context）

桌面应用的所有提示、警告、错误信息文本，当前**不是一套统一机制**，存在三类问题：

### 问题 1：文案碎片化（硬编码散落）

大量用户可见文案以中文字面量形式直接硬编码在 renderer composable 里，未走 i18n、无稳定 key、无日志：

| 文件 | 硬编码示例（grep 实证） | 数量级 |
|------|------------------------|:---:|
| `composables/useBatchPublish.js` | `ElMessage.warning('批量文章中有账号已失效…')`、`ElMessage.success('批量发布完成：…')` | 10+ |
| `composables/usePublishFlow.js` | `ElMessage.warning('网络已断开，任务已缓存')`、`ElMessage.info('当前没有可取消的任务')` | 10+ |
| `composables/usePublishDrafts.js` | `ElMessage.error('草稿保存失败')` | 5+ |
| `composables/useLoginGate.js` | `ElMessage.warning('登录未完成，操作已取消')` | 2 |
| `composables/useProviderCrud.js` | `ElMessage.error('加载失败')`、`ElMessage.success('已删除')` | 10+ |
| `composables/useFilmEngineering.js` | `ElMessage.warning('请先选择拍摄镜头')` 等 | 15+ |
| `composables/useModelProviderCrud.js` / `useVideoClone.js` | 混合：部分走 `formatUserError`，部分硬编码 | 混合 |

这些文案存在既有 i18n 系统的另一侧（`locales/zh.js`/`en.js`）形成**双轨制**：走 i18n 的（如 `useFilmEngineering` 部分）可本地化，硬编码的（如 `useBatchPublish` 大部分）只有中文、且未来无法加 en 翻译。

### 问题 2：格式化模块重复、规则漂移

renderer 侧已有三个错误→文案的格式化模块，职责重叠、正则重复：

| 模块 | 处理对象 | 问题 |
|------|---------|------|
| `src/utils/user-facing-error.js` | IPC 错误 `{code, errorCode, message}` → `formatUserError()` | 30+ `USER_ERROR_CODES`、数值码映射、`PATTERN_RULES` |
| `src/story2video/story2video-notifications.js` | pipeline/通知错误 → `formatStory2VideoNotification()` | ~80 个 `STORY2VIDEO_NOTIFICATION_KEYS`、30+ 归一化正则，**与下一行重叠** |
| `src/utils/pipeline-error-formatter.js` | stage 自由文本错误 → locale key | 含 `quota_exceeded`/`needs_user_input`/`compose_timeout`/`compose_duration_exceeded` 等，**与 story2video-notifications 正则重复** |

同一类错误（如 `quota_exceeded`、`rate_limited`）在 `pipeline-error-formatter.js` 和 `story2video-notifications.js` 各维护一套正则，**两边同步改，否则分类漂移**。

### 问题 3：通知与日志完全隔离

- 用户看到的 UI 通知（`ElMessage`/`ElMessageBox`）**不产生任何日志**。用户报"弹出错误 X"时，无法在 `app-*.log` 里按任何稳定标识检索到对应技术栈。
- 主进程 `logger.js` 只由主进程/服务调用；renderer 无日志通道，日志与 UI 通知之间**没有关联键**。
- 现有 `show-notification` IPC（`electron/ipc-handlers/misc.js`）主进程向窗口发 `notification` 事件，但 **renderer 侧无任何监听器消费**（grep 证实 `src/` 无 `'notification'` 事件订阅），是一条半成品通道。

### 根因

缺少**一个统一的「通知事件」契约**：文案（用户看到的）、错误分类（机器码/正则）、日志（技术细节）三者各自为政，没有共享的 `messageKey` 作为关联纽带。

---

## 二、目标（Goals）与验收标准

### 2.1 目标

**G1. 统一文案契约**：全应用一套稳定 `messageKey` 枚举 + 一套共享错误归一化规则表，消除三个格式化模块之间的正则重复。

**G2. 统一通知入口**：所有 UI 通知（提示/警告/成功/错误）经统一 `notify()` 通道发出，禁止组件直接 `import { ElMessage }` 弹提示。

**G3. 文案单一事实源**：所有用户可见文案写入 `locales/{zh,en}.js`（成对），存量硬编码中文逐步清零。

**G4. 通知↔日志关联**：每个通知携带 `{ messageKey, level, module, params }`，主进程写入结构化日志行，使"用户看到的"与"日志记录的"通过 `messageKey` 可互查；同时守住「用户文案 ≠ 技术日志」边界，敏感信息双向脱敏。

### 2.2 非目标（明确不做）

- ❌ 不把三个格式化模块合并成一个巨型单文件（`story2video-notifications.js` 已成熟，保留命名空间隔离）。
- ❌ 不把技术细节（原始错误、堆栈、通道名）暴露进用户可见文案（现有模块已守此边界，继续强化）。
- ❌ 不为日志直接复用用户文案原文（避免日志被本地化/非 ASCII 噪音污染，日志侧记录 key + params + 技术信息）。
- ❌ 本方案不涉及 ops-center / API 服务端日志（桌面端先行，服务端契约后续单独评估）。

### 2.3 验收标准（可验证）

| # | 验收项 | 验证方式 |
|---|--------|---------|
| A1 | 新建/修改的用户可见文案全部写入 locales（zh/en 成对），渲染端非 locales 文件无新增中文字面量 | CI Gate 7（`check-locale-sync.js`）持续拦截 |
| A2 | `src/` 中所有 UI 通知统一经 `notify()` 通道；`ElMessage`/`ElMessageBox` 仅允许出现在通知通道封装内部 | lint 规则 + grep 巡检（迁移完成后 `src/` 直接 import ElMessage 归零） |
| A3 | 每条经 `notify()` 的通知产生一条含 `messageKey` 的结构化日志行，可按 `messageKey` 精确检索 | 集成测试断言日志文件内容 |
| A4 | 三个格式化模块共用同一归一化规则表；语义重叠模式收敛为单一规则，逐模式行为回归断言通过（**注**：经 CCG 评审修正——原"重复正则归零/grep 去重"表述不可达，改为"语义重叠收敛 + 行为回归"） | 静态检查 + 单元测试 |
| A5 | 敏感信息不泄漏：用户文案不含原始 secret/技术文本；日志侧经 `redactText` + `TECHNICAL_TEXT_PATTERNS` 双重脱敏。**脱敏覆盖清单**：Bearer/apiKey/sk-/JWT（既有）+ 裸高熵 token + IP:端口 + 自定义凭据片段。新增测试场景：「白名单字段值含 secret」「params 含嵌套对象」「params 含 `\n`」「context 字段含 IP:端口」四类，断言日志无 secret、用户文案无技术文本、无换行注入 | 现有 `story2video-notifications` 与 `logger` 脱敏测试持续通过 + 新增场景 |
| A6 | 既有测试全通过（基线 1830 passed），新增契约测试补齐 | `npm run test` 门禁 |

---

## 三、技术方案（架构设计）

### 3.1 总体架构：五层

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5  渲染层 (Renderer UI)                                │
│  ElMessage / ElMessageBox / 弹窗 —— 只消费，不直接 import     │
├─────────────────────────────────────────────────────────────┤
│  Layer 4  通知通道 (Notify Channel)  ← 新增核心               │
│  notify({ messageKey, level, module, params, error? })       │
│    ├─ 解析文案：messageKey → locales 模板（i18n）             │
│    ├─ 渲染：ElMessage / ElMessageBox                         │
│    └─ 上报：IPC notify:log → 主进程结构化日志                 │
├─────────────────────────────────────────────────────────────┤
│  Layer 3  格式化 (Formatter)                                  │
│  user-facing-error.js（IPC 错误）│ story2video-notifications.js│
│  pipeline-error-formatter.js（stage 文本）—— 统一调用规则表    │
├─────────────────────────────────────────────────────────────┤
│  Layer 2  契约 (Contract)  ← 新增共享基础                     │
│  messageKey 枚举 + 错误归一化规则表（单一事实源）              │
├─────────────────────────────────────────────────────────────┤
│  Layer 1  文案 (i18n Copy) + 日志 (Logger)                    │
│  locales/{zh,en}.js（单一事实源）│ main logger.js（脱敏滚动）  │
└─────────────────────────────────────────────────────────────┘
```

**关键设计决定**：`messageKey` 是贯穿 Layer 2→5 的**唯一关联键**——用户看到的文案、错误分类结果、日志记录行，三者共用同一个 key。

### 3.2 Layer 2 契约层（新增）

新建 `apps/desktop/src/utils/message-contract.js`（renderer 侧，错误归一化需在 renderer 做，因为格式化发生在 renderer）：

```js
// 目标结构（示意）
export const MESSAGE_KEYS = Object.freeze({
  // 保留既有命名空间前缀，避免一次性大改名破坏现有调用
  'userErrors': USER_ERROR_CODES,            // 从 user-facing-error.js 收敛
  'story2video.*': STORY2VIDEO_NOTIFICATION_KEYS, // 引用现有常量
  // 新增通用域（publish.* / account.* / collection.* / batch.*）渐进补充
})

// 共享归一化规则表：{ key, patterns[] }，三个 formatter 统一从此读取
export const ERROR_NORMALIZE_RULES = [ /* 收敛 pipeline-error-formatter + story2video-notifications 重复正则 */ ]
```

**收敛方式**（不破坏现有代码）：
1. **共享规则表语义（C1 修复）**：经 CCG 评审确认，`pipeline-error-formatter.js` 与 `story2video-notifications.js` 的正则是**语义重叠而非字面重复**（字面量不同、覆盖范围不同、各带 `extract()` 提取逻辑）。因此共享表采用「**每类错误一条规范正则**」的真收敛策略：对语义相同的错误（`quota_exceeded`、`rate_limited`、`compose_timeout`、`compose_duration_exceeded`、`needs_user_input` 等）收敛为单一规范正则，**接受行为变更**，并逐模式做行为回归断言；各模块独有的业务模式（`story2video` 的 `VOICE_INVALID`、scene 系列）保留在各自命名空间，不进共享表。**不承诺"字面重复归零"**（客观上不存在字面重复）。
2. `user-facing-error.js` 的 `PATTERN_RULES` 保持独立（面向 IPC `{code, errorCode, message}` 结构），但**与共享表共用同一模式常量源**，避免"同类错误两处正则"。
3. 各模块保留自己独有的业务模式（如 `story2video` 的 `VOICE_INVALID`、scene 系列），不强制全量合并。
4. **errorCategory（M1 修复）**：契约层引入独立于文案 key 的稳定 `errorCategory`（如 `quota_exceeded`），作为**跨模块关联键**。同一语义错误在不同命名空间（`userErrors.*` vs `story2video.*`）的多个 messageKey 映射到同一 `errorCategory`，日志行同时记录 `messageKey`（文案定位）与 `errorCategory`（跨模块检索），解决"唯一关联键"名不副实的问题。

### 3.3 Layer 4 通知通道（新增）

新建 `apps/desktop/src/composables/useNotify.js`（或 `src/utils/notify.js`，视调用形态定）：

```js
// 目标接口（示意）
notify({
  messageKey,        // 稳定 key（必填，关联日志的唯一键）
  level,             // 'info' | 'success' | 'warning' | 'error' | 'confirm'
  module,            // 归属模块，如 'batchPublish' | 'publishFlow'
  params,            // 模板插值参数（白名单，见 3.4）
  error,             // 可选：原始错误对象/文本（只进日志，不进用户文案）
  fallback,          // 可选：未匹配时的兜底文案 key
  confirmOptions,    // level==='confirm' 时 ElMessageBox 配置
})
```

**行为**：
1. 解析：`messageKey` → 规则表确认已知 → locales 模板插值出用户文案（复用 `user-facing-error`/`story2video-notifications` 的解析逻辑，经 `resolveMessageKey` 兜底）。
2. 渲染：非 confirm → `ElMessage[level]`；confirm → `ElMessageBox.confirm`。
3. 上报：调用新增 IPC `notify:log`（见 3.5），把 `{ messageKey, level, module, params(白名单), error?(脱敏) }` 发给主进程记日志。
4. **渲染失败或 IPC 失败不得影响主流程**（沿用 `usePublishFlow` 里 `notifyFailure` 的"通知失败不应覆盖发布结果"原则）。

**迁移规则**：组件/composable 中所有 `ElMessage.*` 与 `ElMessageBox` 调用替换为 `notify()`；`ElMessage` 只保留在通知通道封装内部。

**纯函数核心（m5 修复）**：契约层先定义**纯函数核心** `notifyCore({ messageKey, level, module, params, error })`（不依赖 Vue 上下文，负责解析文案 + 组装日志 payload），`useNotify.js` composable 仅作薄封装（注入 `i18n.global` 与渲染）。这样非组件上下文（纯工具函数）也能调用 `notifyCore`。

**renderer 全局错误钩子（M3 修复）**：Phase 1 增加 renderer 全局错误捕获，覆盖崩溃/未捕获异常场景：
- `window.onerror` + `window.addEventListener('unhandledrejection')` + Vue `app.config.errorHandler`
- 统一转发 `notify:log`（level=error，messageKey 用 `renderer.uncaught_error` 通用 key，error 原文脱敏入日志）
- 目的：用户报"界面闪退/白屏"时，日志仍能记录，不依赖 `notify()` 被显式调用。

### 3.4 日志关联设计（G4 核心）

**原则：同一事件两个视图，不互相污染。**

| 视图 | 内容 | 去向 | 脱敏 |
|------|------|------|------|
| 用户文案（User Copy） | locales 模板插值结果，自然语言、可操作 | `ElMessage`/`ElMessageBox` | 不含原始错误、不含 key/参数中的 secret |
| 技术日志（Log Payload） | `messageKey` + level + module + **白名单 params** + `error`（原始文本/堆栈） | 主进程 `app-*.log` | `logger.redactText`（复用现有 Bearer/apiKey/sk-/JWT 脱敏） |

**params 白名单机制（C2/C3 修复：双层防线）**：
- **第一层（renderer 字段名白名单）**：每个 `messageKey` 声明可日志化参数白名单（复用 `story2video-notifications.normalizeParams` 已有的"丢弃未授权技术字段"思路），未被白名单允许的字段只进用户文案渲染、**不进日志**。
- **第二层（主进程值级 deny-list，强制）**：主进程 `notify:log` handler 对每个 params 字段值**不信任 renderer 已脱敏**，做值级校验：
  - **类型约束**：白名单字段只接受 `string | number | boolean`，拒绝嵌套 object/array 直接落盘（数组类展平为字符串并逐项脱敏）。
  - **二次脱敏**：每个字段值再跑 `logger.redactText` + `TECHNICAL_TEXT_PATTERNS`（IP:端口/通道名/错误码）+ 高熵 token 正则 + 长度截断。
  - **换行消毒**：所有落盘字段统一经 `JSON.stringify` 进 meta 段，禁止拼进 message 字符串，杜绝 log injection（`\n`/`\r`/`\0` → 可见转义）。
- **用户文案侧拦截（C3）**：插值前对 params 值跑 `TECHNICAL_TEXT_PATTERNS`（复用 `user-facing-error.js`），命中即回退兜底文案，防止技术文本/secret 进用户可见文案。

**日志行格式**（主进程）：

```
[2026-08-29T10:00:00.000Z] [NOTIFY] [batchPublish] [story2video.quota_exceeded] {"errorCategory":"quota_exceeded","count":2,"max":2} 技术原文已脱敏…
```

- `NOTIFY` 标记便于统一过滤；`messageKey` + `errorCategory` 可 `grep` 精确检索；结构化 meta 便于解析（`module` 仅在前缀，meta 不重复）。
- 日志行由主进程 logger 写（`logger.notify()` 新增方法，复用滚动/保留/脱敏既有能力），`error` 字段复用 `safeMeta` 的 8000 截断。
- **级别映射表（M9）**：`success→INFO`、`info→INFO`、`warning→WARN`、`error→ERROR`、`confirm→INFO 或可选不记`；高频成功类通知（批量进度）做节流/聚合（10s 窗口同 key 合并计数）。

### 3.5 主进程 IPC（新增 `notify:log`）

`electron/ipc-handlers/misc.js`（或新建 `notify.js` handler）：

```js
ipcMain.handle('notify:log', (event, payload) => {
  // C2 修复：主进程侧强制校验（不信任 renderer）
  // 1. sender 校验：按 QM-2 校验 event.senderFrame 的 file:// canonical 边界，拒绝非 dist 内来源
  // 2. messageKey 服务端白名单：仅接受契约层已知 key，未知 key 静默 drop + 计数
  // 3. level 白名单：仅 {info, warn, error}，拒绝任意字符串（防 level 注入日志前缀）
  // 4. params 按该 key 的 schema 复验：只落白名单字段 + 值级 deny-list（类型/二次脱敏/换行消毒）
  // 5. 速率限制：每窗口/每 key 计数，超限降级为聚合计数日志
  // 6. 所有落盘字段统一 JSON.stringify 进 meta 段，禁止拼进 message 字符串
  // 7. payload.error 经 logger.redactText + TECHINICAL_TEXT_PATTERNS 脱敏后才可落盘
  // 返回 { code: 0 }，失败静默（日志失败不得影响 renderer 主流程）
})
```

**对既有 `show-notification` 通道的处理（决策 D2）**：**并入**统一通知通道，不保留独立双通道。Phase 1 明确清理清单：
- `ipc-handlers/misc.js` 的 `show-notification` handler 删除（职责并入 `notify:log`）。
- `preload/system.js` 的 `onNotification` 保留（主进程主动推送仍走 `notification` 事件），但 `showNotification`（renderer 主动调用）删除。
- `access-control.js` / `license-access-control.js` 的通道白名单同步更新；`preload.test.js` 断言同步。

**keyword-spike 日志归属（M2 修复）**：主进程在 `phase3-services.js` **源头直接写结构化日志**（`logger.warn('keywordMonitor', ...)` 带 messageKey + errorCategory），再发事件给 renderer 仅做 UI 渲染；renderer 的 `notify()` 对"来自主进程推送"的通知（payload 标记来源）**不重复上报**，避免双写。补 renderer ready 握手或事件缓冲，避免 renderer 未就绪时事件丢失。

### 3.6 方案对比（架构师评审备查）

| 维度 | 方案 A：保持现状 | 方案 B：单一巨型模块 | 方案 C（**采纳**）：契约+通道分层 |
|------|:---:|:---:|:---:|
| 重复正则清理 | ❌ 不处理 | ✅ 完全合并 | ✅ 共享规则表收敛重复 |
| 硬编码清零 | ❌ | ✅ | ✅（渐进迁移） |
| 日志关联 | ❌ 无 | 部分（需自建） | ✅ 内置 `notify:log` |
| 对成熟模块的侵入 | 无 | 🔴 高（合并 80-key 模块） | 🟢 低（保留命名空间） |
| 迁移风险 | 无 | 🔴 高（一次大改） | 🟢 中（按模块分批） |
| 可维护性 | 差 | 差（巨型文件） | ✅ 分层清晰 |

**结论**：方案 C。理由：契约层解决"重复/漂移"，通道层解决"入口统一 + 日志关联"，文案层保持既有 i18n 单一事实源；对已成熟的 `story2video-notifications.js` 零侵入，存量迁移可分批、每批可独立验证。

---

## 四、迁移计划（分 4 阶段，每阶段可独立验证）

> 实现走 openspec 建 change；运行时改动（`apps/desktop/src`、`apps/desktop/electron`）一律在隔离 worktree 进行。

### Phase 0：契约层落地（中风险，需逐模式回归）
- [ ] 新建 `src/utils/message-contract.js`：`MESSAGE_KEYS`（引用现有枚举）+ `ERROR_NORMALIZE_RULES` 共享规则表 + `errorCategory` 映射
- [ ] 语义重叠模式（`quota_exceeded`/`rate_limited`/`compose_timeout`/`compose_duration_exceeded`/`needs_user_input` 等）收敛为单一规范正则，**接受行为变更**
- [ ] 单元测试：共享规则表逐模式行为回归断言（合并前 vs 合并后）
- 验收：语义重叠模式收敛 + 逐模式回归通过；既有测试全通过

### Phase 1：通知通道 + 日志关联（核心样板）
- [ ] 新建 `notifyCore` 纯函数核心 + `useNotify.js` composable 薄封装
- [ ] 新建主进程 `notify:log` IPC（含 C2 主进程侧校验：sender/level/白名单复验/换行消毒/速率限制）+ `logger.notify()` 结构化行
- [ ] **renderer 全局错误钩子（M3）**：`window.onerror` + `unhandledrejection` + Vue `errorHandler` → `notify:log`
- [ ] **keyword-spike 日志归属（M2）**：`phase3-services.js` 源头写结构化日志 + renderer 不重复上报 + ready 握手
- [ ] **试点模块**：`useBatchPublish.js` 全量迁移（ElMessage + 进度列表硬编码中文一并入 locales）
- [ ] 集成测试：`notify()` → 日志文件出现 `messageKey` 行；脱敏生效；渲染失败不影响主流程；换行注入被拦截
- 验收：A3、A5 达成；试点模块 ElMessage 归零 + 进度文案入 locales

### Phase 2：存量批量迁移（按模块分批）
- [ ] 依次迁移：`usePublishFlow` → `useProviderCrud` → `useModelProviderCrud` → `useLoginGate` → `usePublishDrafts` → `useVideoClone` → `useFilmEngineering` → `useOpsCenterSync` → 视图层（`Accounts`/`Collection`/`Publish`/`Monitor`/`Intelligence` 等）
- [ ] 每批：文案进 locales（zh/en 成对）、`notify()` 替换、测试同步更新断言
- [ ] **非 toast 文案（M5/M6）**：进度列表/内联状态等非通知用户可见文案，走 locales + 组件内 i18n 渲染（不经 `notify()`），纳入 A1/A2 覆盖
- 验收：A1、A2 逐步达成，每批 CI 绿

### Phase 3：CI / lint 强化（防回退）
- [ ] lint 规则：`src/` 非通道封装文件禁止 `import { ElMessage }`/直接 `ElMessage.*('字面量')`
- [ ] CI 基线扫描扩展：存量中文字面量清零进度纳入检查
- 验收：A2 由"人工巡检"升级为"机器强制"

### Phase 4：文档与收尾
- [ ] 更新 `AGENTS.md` QM-2 增加「通知必须经 `notify()` + 必须可日志检索」检查项
- [ ] 更新 `01-docs/i18n-glossary.md` 产品名词增量
- [ ] 全量回归 + 视觉回归（QM-4）

---

## 五、测试策略（TDD 前置）

| 测试 | 文件 | 覆盖 |
|------|------|------|
| 契约层单元 | `src/utils/message-contract.test.js` | 共享规则表匹配、key 唯一性、重复正则校验 |
| 通道单元 | `src/composables/useNotify.test.js` | key→文案解析、level 映射、confirm 分支、params 白名单、失败静默 |
| IPC 集成 | `electron/ipc-handlers/notify.test.js` | `notify:log` 白名单校验、脱敏落盘、未知 key 处理 |
| 日志关联集成 | `electron/services/logger.notify.test.js` | 结构化行格式、按 messageKey 检索、滚动保留兼容 |
| 试点模块回归 | `useBatchPublish.test.js` | 迁移后断言一致（文案不变） |
| 既有回归 | 全量 `npm run test` | 基线 1830 passed 不倒退 |

---

## 六、风险与应对

| 风险 | 等级 | 应对 |
|------|:---:|------|
| 迁移过程文案措辞被改动（仅改调用不改语义） | 🟡 | 迁移时断言 `formatUserError`/既有文案输出不变；测试比对 |
| `messageKey` 命名空间冲突 | 🟡 | 契约层做 key 唯一性校验测试 |
| 日志量增大（每条通知一行） | 🟢 | `NOTIFY` 行走 WARN/INFO，可 `LOG_LEVEL` 控制；复用既有滚动机制；高频成功类通知节流/聚合（M9） |
| 误把 secret 写进 params 白名单 | 🔴 | **双层防线（C2/C3 修复）**：renderer 字段名白名单 + 主进程值级 deny-list/二次脱敏/类型约束；落盘统一 JSON.stringify 进 meta 段；`logger.redactText` + `TECHNICAL_TEXT_PATTERNS` 双检测；A5 回归 |
| `notify:log` 被滥用（伪造/注入/洪泛） | 🔴 | **C2 修复**：messageKey/level/module 服务端白名单 + sender 校验 + 换行消毒 + 速率限制 |
| 与既有 `show-notification` 通道混淆 | 🟡 | 决策 D2 已定案并入统一通道；Phase 1 明确清理清单（misc.js handler、preload onNotification、access-control 白名单） |

---

## 七、决策记录（已定案）

> 以下决策经 2026-08-29 评审确认，作为实现依据。

### 决策 D1：通知通道采用 composable 形态 ✅

**结论**：`useNotify.js`（composable）。

**理由**：
- 多数调用点位于 composable 内（`useBatchPublish`/`usePublishFlow`/`useProviderCrud` 等），composable 形态可直接复用 Vue 响应式上下文与 `i18n.global`。
- 视图层 `.vue` 也可调用（composable 不限于 composable 内使用）。
- 与项目既有 `useLoginGate`/`useFilmEngineering` 等 composable 命名习惯一致。
- 若未来需要非组件上下文（如纯工具函数）调用，可再暴露一个薄封装 `notify()` 普通函数，内部复用同一实现（**实现阶段评估**，不阻塞本决策）。

### 决策 D2：`show-notification` 通道收敛并入统一通知通道 ✅

**结论**：**并入**统一通知通道，不保留独立双通道。

**事实依据**（grep 实证）：
- `preload/system.js:97` 暴露了 `onNotification`（监听 `notification` 事件），但 **renderer `src/` 无任何消费方**（grep 仅命中测试文件的 `onBatchProgress`，无 `onNotification` 订阅）。
- 主进程两处发送 `notification` 事件：`ipc-handlers/misc.js:36`（`show-notification` IPC）与 `bootstrap/phase3-services.js:122`（keyword-spike 告警）。
- 即 `show-notification` 目前是**半成品死通道**：主进程发、renderer 无人收。

**并入方案**：
- 统一通知通道 `notify()` 同时承担「UI 渲染 + 日志上报」；主进程侧需要主动推送（如 keyword-spike）的场景，改为**复用同一 `messageKey` 契约**：主进程发送 `{ messageKey, level, module, params }`，renderer 的 `onNotification` 订阅方收到后调用 `notify()` 渲染 + 上报日志。
- `show-notification` IPC（renderer 主动调用）与 `notify:log`（日志上报）职责合并：renderer 的 `notify()` 内部统一走 `notify:log`，不再单独调 `show-notification`。
- keyword-spike 等主进程主动推送：`phase3-services.js` 改为发 `{ messageKey: 'monitor.keywordSpike', level: 'warning', module: 'keywordMonitor', params: { keyword, current, previous, ratio } }`，renderer 订阅后经 `notify()` 渲染。
- **收益**：消除死通道；主进程主动推送与 renderer 主动通知共用同一 `messageKey` 契约与日志关联，避免"两套通知两套日志"。

### 决策 D3：主进程侧通知

**结论**：本方案以 renderer 为先。主进程主动推送（keyword-spike 等）通过「发 `messageKey` 事件 → renderer `notify()` 渲染」实现，主进程不直接弹 UI。主进程侧若需独立系统通知（如托盘），后续单独评估，不阻塞本方案。

### 决策 D4：`messageKey` 命名

**结论**：**不重命名**既有 `story2video.*` key（避免破坏性改动），新 key 按命名空间渐进新增。契约层做 key 唯一性校验测试防冲突。

---

## 八、评审清单（供 CTO/架构评审）

- [ ] G1-G4 目标是否覆盖用户诉求（"整体数量/统一机制/与日志关联"）
- [ ] 分层是否保持"最简单方案"原则（不引入数据库/第三方服务）
- [ ] 对成熟模块 `story2video-notifications.js` 是否零侵入
- [ ] 日志关联是否守住"用户文案 ≠ 技术日志"边界
- [ ] 迁移是否分批可验证、每批可回滚
- [ ] 验收标准 A1-A6 是否可自动化验证

---

## 九、CCG 评审结论（2026-08-29）

> 本方案经 CCG 双模型交叉审查（架构视角 + 安全/可观测性视角），完整报告见 `.ccg/tasks/notify-log-standard-review/review.md`。

### 评审结果

- **总体**：方案方向正确、结构清晰，对成熟模块"零侵入"承诺与 `show-notification` 死通道判定均与代码事实吻合。**但存在 3 个 CRITICAL 与多个 MAJOR，必须修复后才能进入实现。**
- **架构 Completeness**：7/10
- **安全达标度**：未达标（存在必须修复项）

### 必须修复项（进入实现前的硬门槛）

| # | 级别 | 问题 | 修复要求 |
|---|:---:|------|---------|
| C1 | 🔴 | G1/A4 核心前提误判：三模块正则是"语义重叠"而非"字面重复"，"重复正则归零"验收不可达 | 重定义 A4 为"语义重叠模式收敛为单一规则 + 逐模式行为回归断言"；明确共享表是"真收敛"还是"规则注册表"，二选一写清 |
| C2 | 🔴 | `notify:log` 主进程侧无 params 白名单复验/换行消毒/sender 校验，"双重防线"名不副实 | 主进程 handler 内：messageKey 服务端白名单 + params 按 key schema 复验；落盘字段统一 JSON.stringify 进 meta 段；QM-2 sender 校验；level 白名单；速率限制；补换行注入回归测试 |
| C3 | 🔴 | params 白名单嵌套绕过 + 主进程无独立 deny-list 兜底 | 白名单双层化（renderer 字段名白名单 + 主进程值级 deny-list）；params 值类型约束（拒绝嵌套 object/array）；用户文案插值前跑 `TECHNICAL_TEXT_PATTERNS` |
| M2 | 🟠 | keyword-spike 日志闭环依赖 renderer 存活 + 未就绪时序 | 主进程源头直接写结构化日志，renderer 只做 UI 渲染且不重复上报；补 ready 握手/缓冲 |
| M3 | 🟠 | renderer 崩溃/未捕获异常无日志通道 | Phase 1 增加 renderer 全局错误钩子（onerror/unhandledrejection/Vue errorHandler）→ notify:log |
| M5/M6 | 🟠 | 非 toast 用户可见文案（进度列表/内联状态）未纳入范围，试点"硬编码清零"不完整 | 显式界定"通知"与"非通知用户可见文案"两类处理路径；修正试点验收口径 |

### 其余 MAJOR（建议 Phase 0/1 内一并解决）

- **M1**：`messageKey` 唯一关联键名不副实（同一错误多 key）→ 引入独立 `errorCategory` 作跨模块关联键，日志行同时记录两者。
- **M4**：`logger.redactText` 覆盖不全（裸 API Key/IP:端口）→ 落盘前追加 `TECHNICAL_TEXT_PATTERNS` 或新增高熵 token/IP 正则。
- **M7**：G4"用户↔日志互查"实际单向 → 错误详情暴露 messageKey / 生成 key↔text 对照表。
- **M9**：`success`/`confirm` 无对应 logger 级别 + 批量日志洪泛 → 明确级别映射表，高频成功类通知节流/聚合。

### MINOR（合并去重）

`logger.notify()` 方法形态待明确；日志行 module 重复；Phase 0 应标"中风险"；`monitor.keywordSpike` 需 zh/en 成对文案；契约层先定义纯函数核心；多窗口/主窗口最小化兜底；error 字段长度上限；keyword-spike 无窗口降级策略。

### 后续动作

**C1-C3 与关键 MAJOR 的修复要求已并入正文**（§3.2 契约层、§3.3 通知通道、§3.4 日志关联、§3.5 IPC、§四 迁移计划、§2.3 验收标准），本文档即实现依据。下一步：经 openspec 建 change，运行时改动（`apps/desktop/src`、`apps/desktop/electron`）在隔离 worktree 进行。

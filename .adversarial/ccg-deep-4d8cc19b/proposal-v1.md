# 变更提案（自动生成，待对抗评审）

- base: `origin/main`
- head: `4d8cc19be44595b79b0eaa3af3854ab67d725bdc`
- 采集模式: `diff`
- 变更规模: 2590 行

## 变更内容

```diff
diff --git a/.ccg/reviews/c6b4709cd9e9f4ef6e2d9171e32c00a30327e6d0.json b/.ccg/reviews/c6b4709cd9e9f4ef6e2d9171e32c00a30327e6d0.json
new file mode 100644
index 000000000..be605b807
--- /dev/null
+++ b/.ccg/reviews/c6b4709cd9e9f4ef6e2d9171e32c00a30327e6d0.json
@@ -0,0 +1,23 @@
+{
+  "sha": "c6b4709cd9e9f4ef6e2d9171e32c00a30327e6d0",
+  "layer": "diff",
+  "mode": "dual",
+  "reason": "变更 1047 行 > 200 行阈值（对齐 §12.6 Red Team）",
+  "stats": {
+    "changedLines": 1047,
+    "fileCount": 32,
+    "codeFileCount": 23,
+    "sensitivePathHits": [],
+    "plannedPathHits": [],
+    "sensitiveContentHits": 0
+  },
+  "stagedDiffHash": "ee3276d3fc16c07951aab3dcf7146f3ee2ed8d3b727219899d45889218df9e6a",
+  "decidedAt": "2026-10-13T03:10:19.943Z",
+  "decidedBy": "ccg-review-decider",
+  "deepReview": {
+    "required": true,
+    "status": "pending",
+    "performedBy": null,
+    "findings": null
+  }
+}
\ No newline at end of file
diff --git a/.quality-gates.md b/.quality-gates.md
index a50208f3e..35a04a6bf 100644
--- a/.quality-gates.md
+++ b/.quality-gates.md
@@ -10869,3 +10869,18 @@ T22 头部与清单不一致仍 unparsable / T23 单数形态 affected 臂判绿
 - 执行记录：openspec/records/ui-home-restyle.md
 
 | 远程同步 | PASS |
+
+---
+
+## 本次执行记录：风控挂起误判修复（fix-risk-hold-false-positive，2026-10-13）【混合 PR】
+- 判定：`node scripts/classify-docs-only.js --base=origin/main` → false（含 `packages/api-publish-engine/**`、`packages/shared-utils/**`、`apps/desktop/electron/**`、`apps/desktop/src/**` 运行时代码改动）→ 完整质量节拍
+- 隔离：worktree `D:\Data\projects\mp-worktrees\mp-fix-risk-hold-false-positive`（D 盘）＋裸分支 `fix-risk-hold-false-positive`；`pre-code-edit-guard.ps1` exit 0；`verify-worktree-deps.js` OK
+- 根因：①传输层 `throw new Error(result.error)` 丢弃适配器已算出的 `risk_blocked`/风控码族 ⇒ 上层只能用错误文本猜关键词；②词表无边界且不分强弱（裸 `601`/`10000015`/`risk`/`frequent`/`verify`/`验证`）⇒ 7 类普通失败被判风控；③`accountId` 缺失降级为平台级 ⇒ 一次误判冻结整平台
+- 保留门禁：TDD ✅（引擎 379 passed/40 files、shared-utils 844 passed/10 skipped、桌面受影响 6 文件 171 passed）| 变异反证 ✅（`task-queue` 结构化赋值改 no-op ⇒ 2 红；还原复绿——反证的是锁本身）| ESLint exit 0 ✅ | locale 成对/键存在/CJK 基线 ✅ | 颜色字面量/CSS 变量/vue-style/scoped-root/字号 ✅ | 品牌残留/规格 Purpose/CHANGELOG 增长 ✅ | openspec validate ✅ | 行数门禁 ✅ | 行尾与编码 ✅
+- QM-1 打包 ✅ rc=0（`build:win`，renderer 21.14s + `Multi-Publish.Setup.0.2.0.exe`）；**从解包产物实跑判定取证**：`status code 601` → `suspends=false`、`B站风控(601)` → `strength=strong`
+- 过程中自我纠错：初版把 `attachRiskSignals` 写在受管文件 `publisher-router.js` 顶破台账容差，`check-max-lines.js` 判红（`LEDGER_GREW … 膨胀 209 行（容差 200）`）⇒ 移回风控模块，该文件改动 33 → 14 行，复跑 PASS
+- 受限项（如实记录）：本机无真实风控会话 ⇒「真实风控命中 → 挂起 → 横幅 → 人工恢复」端到端真机回归**未做**、横幅视觉未在真机截到（仅源级契约锁 8 例）；QM-6 正式 CCG 双模型外部评审本轮**未执行**
+- 备注（刻意未修）：`publisher-router.js` 后端轨回退文案为历史编码损坏串，另案处理；`publisher-router.js` 台账已用到 818/829，仅剩 11 行余量
+- 执行记录：openspec/records/fix-risk-hold-false-positive.md
+
+| 远程同步 | PENDING |
diff --git a/01-docs/PRD-RISK-HOLD-MISJUDGE-FIX-2026-10-13.md b/01-docs/PRD-RISK-HOLD-MISJUDGE-FIX-2026-10-13.md
new file mode 100644
index 000000000..260ac580d
--- /dev/null
+++ b/01-docs/PRD-RISK-HOLD-MISJUDGE-FIX-2026-10-13.md
@@ -0,0 +1,573 @@
+# PRD：风控挂起误判修复（fix-risk-hold-false-positive，2026-10-13）
+
+> 关联 change：`openspec/changes/fix-risk-hold-false-positive/`
+> 关联执行记录：`openspec/records/fix-risk-hold-false-positive.md`
+> 分支：`fix-risk-hold-false-positive`
+
+---
+
+## 1. 背景
+
+### 1.1 用户可见现象
+
+账号管理页出现横幅（原文，zh 真值）：
+
+```
+检测到风控，「微信公众号」等 1 个发布目标已自动暂停后续发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页手动恢复。
+```
+
+同一条文案还会以 warning toast 形式弹出。用户在平台侧**并没有**触发任何验证，横幅却声称「检测到风控」，且该平台的后续发布被真的挡住，必须逐条手动点「恢复发布」。
+
+### 1.2 触发链路（修复前）
+
+```
+发布任务失败（taskQueue 抛错）
+  → task.error = e.message                        (shared-utils/task-queue.js)
+  → phase4-events 的 task:failed 处理器
+      if (isRiskBlocked(task.error)                (apps/desktop/electron/services/publish-risk.js)
+          && !isRiskSuspendedMessage(task.error))
+        → riskSuspender.suspend(platform, accountId)
+        → 广播 publish:risk-suspended → 渲染层 useRiskStore → RiskSuspendedBanner
+```
+
+其中 `isRiskBlocked` 的实现是一条**无边界裸子串正则**：
+
+```js
+/风控|risk|滑块|601|10000015|frequent|频繁|verify|验证|安全验证|操作频繁|captcha|canvas illegal|账号存在风险/i
+```
+
+### 1.3 根因（两条，互为放大镜）
+
+**根因 A：判定只有「错误文本关键词」这一条路，结构化信号被丢在半路。**
+
+各发布链其实**已经算出**了结构化的风控结论：
+
+| 位置 | 已有信号 | 是否传到上层 |
+|---|---|---|
+| 抖音视频/图文链 | `risk_blocked: true`（`x-tt-verify-passport-decision` / `status_code===110`） | 否 |
+| B站视频链 | `code: 601` / `BILI_RISK_601` | 否 |
+| 百家号图文链 | `code: 10000015` | 否 |
+| 快手视频链 | `risk_blocked: true`（提交返回非 JSON 验证页） | 否 |
+| 小红书 DOM 轨 | `XHS_RISK_BLOCKED` | 否 |
+
+但传输层一律 `throw new Error(result.error)`：
+
+- `packages/api-publish-engine/src/index.js` 的 `publishViaApi`
+- `apps/desktop/electron/services/publisher-router.js` 的 `ApiPublisher` / `RpaPublisher` / `BackendPublisher`
+
+`Error` 上只留下 `message`，`code` 与 `risk_blocked` 被丢弃。上层拿不到结构化结论，**只能**退回「拿错误文本猜关键词」，而关键词匹配正是误判来源。
+
+**根因 B：词表无边界，且不分强弱。**
+
+`601`、`10000015`、`risk`、`frequent`、`verify`、`验证` 全部是无边界子串匹配。实测误判面（附录 A 为完整取证）：
+
+| 普通失败文案 | 命中原因 | 修复前后果 |
+|---|---|---|
+| `Request failed with status code 601` | 裸数字 `601` | 冻结该账号 / 平台 |
+| `publish id 6019 not found` | 裸数字 `601`（子串） | 同上 |
+| `gateway timeout ts=1601846521` | 裸数字 `601`（子串） | 同上 |
+| `errno 100000159: bad request` | 裸数字 `10000015`（子串） | 同上 |
+| `infrequent login detected` | `frequent`（子串） | 同上 |
+| `low-risk content flagged` | `risk`（英文普通词） | 同上 |
+| `身份验证失败` / `请先完成实名验证` | `验证`（中文普通词） | 同上 |
+
+**放大器：`accountId` 缺失时自动降级为平台级挂起。** `phase4-events` 取 `task.article?.accountId || null`，而 `risk-suspender-store` 的键语义是「`accountId` 为 `null` ⇒ 平台级挂起，覆盖该平台**所有**账号」。于是「一次误判 + 没带账号」= 整平台停摆。
+
+### 1.4 为什么这条必须修（代价不对称）
+
+误判的代价不是「少发一篇」：
+
+1. 用户被引导去平台创作者中心「手动发布一篇内容完成验证」——**而那里根本不会弹验证**（因为并没有风控）；
+2. 用户做完回来点「恢复发布」，账号才解冻；期间该平台所有发布都零请求被拦（`RiskSuspendedError`，`noRetry`）；
+3. 挂起态经 store 键 `publish.riskSuspended` **持久化、重启存活、无自动过期**，用户不点就永远挂着；
+4. 若降级成平台级，**同平台其他账号一并遭殃**（用户会认为「另一个号也被封了」）。
+
+这与仓内既有纪律一致：小红书 DOM 轨早已把裸「滑块」「验证码」从词表删掉并留下「误判比漏判更有害」的注释；本次是把同一条纪律落到桌面侧与引擎侧。
+
+---
+
+## 2. 目标与非目标
+
+### 2.1 目标
+
+| 编号 | 目标 | 可验证判据 |
+|---|---|---|
+| G1 | 结构化风控信号优先于文本 | 结构化 `risk_blocked` / 风控码族命中即判 strong，且**文本完全不参与** |
+| G2 | 文本词表加边界、分强弱 | 附录 A 全部 7 类误判样例 `suspends === false`；附录 B 全部真风控样例 `suspends === true` |
+| G3 | 弱信号不挂起 | `strength === 'weak'` ⇒ `suspends === false`（不变量由单一真源给出） |
+| G4 | `accountId` 缺失不再造成整平台误冻 | 弱信号 + 无账号 ⇒ 零挂起；强信号 + 无账号 ⇒ 仍平台级（真实风控不放松） |
+| G5 | 横幅显示项能说清「哪一个、什么粒度、什么时候、凭什么」 | 4 个显示项：平台/账号名、粒度标签、检测时间、判定依据 |
+| G6 | 词表单一真源，杜绝两侧漂移 | 桌面与引擎 require 同一个 `risk-signals.js` 模块 |
+
+### 2.2 非目标
+
+- **不引入任何自动恢复 / 自动换号**。合规红线不变：风控即停，恢复只能人工确认。
+- **不改变「弱信号仍然停报不降级」的路由语义**。弱信号在 API 轨命中后依旧不回落 DOM（安全侧：不换路），只是不再冻结账号、不再弹风控提示。
+- **不修改`参考产品`取证得来的强特征串**（`canvas illegal`、`账号存在风险`），仅调整其所在档位与边界。
+- **不处理历史遗留的编码损坏文本**（如 `publisher-router.js` 里回退文案的乱码），另案。
+
+---
+
+## 3. 术语与数据模型
+
+### 3.1 判定结果 `RiskVerdict`
+
+单一真源 `packages/api-publish-engine/src/publish/core/risk-signals.js` 导出：
+
+```js
+/**
+ * @typedef {{
+ *   hit: boolean,                     // 是否命中任何风控信号（强弱并集）
+ *   strength: 'strong'|'weak'|null,   // 分档
+ *   signal: string,                   // 封闭词表记号，可安全持久化/跨进程/展示
+ *   suspends: boolean                 // 是否允许挂起 ⇔ (hit && strength === 'strong')
+ * }} RiskVerdict
+ */
+```
+
+### 3.2 `signal` 记号词表（封闭，长度 ≤ 64）
+
+| 记号形态 | 含义 | 示例 |
+|---|---|---|
+| `flag` | 调用方显式声明 `risk_blocked` | `flag` |
+| `code:<code>` | 平台风控码族 | `code:601`、`code:BILI_RISK_601`、`code:10000015` |
+| `strong:<词>` | 强信号词表命中 | `strong:风控`、`strong:安全验证` |
+| `weak:<词>` | 弱信号词表命中 | `weak:验证`、`weak:601` |
+
+**`signal` 不得是原始错误全文**：该字段会被持久化到 store 并跨进程广播到渲染层，平台回包原文可能含会话片段。因此只收封闭词表的记号，并在 `risk-suspender.js` 里截断到 64 字符（有回归锁）。
+
+### 3.3 挂起记录 `SuspensionRecord`
+
+```js
+{
+  platform: string,              // 必填，空则 suspend 抛错
+  accountId: string|null,        // null ⇒ 平台级（覆盖该平台所有账号）
+  reason: string,                // 'risk_blocked' | 'cleared' | ...
+  at: number,                    // 毫秒时间戳（clock() 注入）
+  signal?: string,               // 可选；旧记录无此字段
+  strength?: 'strong'|'weak'     // 可选；旧记录无此字段
+}
+```
+
+**键语义**（`platform::accountId`，`accountId==null` 记作 `*`）：
+
+| 挂起记录 | 查询 `isSuspended('wechat_mp','acc-A')` | 查询 `isSuspended('wechat_mp', null)` |
+|---|---|---|
+| `wechat_mp::*`（平台级） | `true` | `true` |
+| `wechat_mp::acc-A`（账号级） | `true` | `false` |
+| `wechat_mp::acc-B`（账号级） | `false` | `false` |
+
+### 3.4 判定档位定义
+
+**强信号（`suspends: true`）** —— 平台风控专属措辞/码族，无语义歧义：
+
+| 记号 | 说明 |
+|---|---|
+| `风控` | 中文风控专属词 |
+| `滑块` | 滑块验证（真实风控独有） |
+| `安全验证` | 平台安全验证弹层 |
+| `验证弹层` | 弹层形态描述 |
+| `操作频繁` | 平台限流/风控专属措辞 |
+| `captcha` | 英文验证码 |
+| `canvas illegal` | 参考产品 4.13.19 -110 码族取证串（抖音/西瓜） |
+| `账号存在风险` | 参考产品风控提示原文 |
+| `risk control` | 英文风控专属短语 |
+| `risk_blocked` / `riskBlocked` / `RISK_BLOCKED` | 风控标志的字面形态 |
+| `BILI_RISK` | B站风控码名前缀 |
+| `验证失败(110)` | 抖音 `status_code===110` 的文案形态 |
+| `10000015`（数字边界） | 百家号风控码 |
+| **结构化 `flag`** | 调用方显式声明 |
+| **结构化 `code` ∈ {`BILI_RISK_601`, `RISK_BLOCKED`, `601`, `10000015`, `-1e7`}** | 平台风控码族 |
+
+**弱信号（`suspends: false`）** —— 宽泛词，可能出现在普通错误里：
+
+| 记号 | 为什么只算弱 |
+|---|---|
+| `验证` | `身份验证失败`、`请先完成实名验证` 都会命中 |
+| `频繁` | `请求过于频繁，请稍后重试` 是限流不是账号风控 |
+| `risk`（标识符边界） | `low-risk content flagged` 会命中 |
+| `frequent`（标识符边界） | 英文子串风险 |
+| `verify`（标识符边界） | 英文普通动词 |
+| `601`（数字边界） | HTTP 状态码 / ID / 时间戳片段 |
+
+**边界规则：**
+
+- 数字记号用数字边界 `(?<!\d)…(?!\d)`：`1601`、`6019`、`1601846521`、`100000159` 一律**不**命中。
+- 英文记号用标识符边界 `(?<![A-Za-z0-9])…(?![A-Za-z0-9])`：下划线算边界（故 `BILI_RISK_601` 能命中），字母数字不算（故 `derisk`、`infrequent`、`verified` 不命中）。
+
+**排除规则：** 文本含 `risk_suspended`（守卫自身标记）⇒ 判定为 `hit: false`。这是自触发防线；桌面侧另有 `isRiskSuspendedMessage` 双保险。
+
+---
+
+## 4. 数据校验
+
+### 4.1 判定入口 `classifyRisk(input)` 的入参校验
+
+| 入参 | 合法域 | 非法处理 |
+|---|---|---|
+| `input.error` | `string` | 非字符串（`null`/`undefined`/`object`/`number`/`array`/`boolean`）⇒ 按空串，不抛错 |
+| `input.code` | `string` 或 `number` | 其它类型 ⇒ 不参与码族匹配 |
+| `input.riskBlocked` / `input.risk_blocked` | `=== true` 严格比较 | `'true'`、`1` 等真值**不**算（避免把字符串配置当标志） |
+| `input` 整体 | 可省略 | `classifyRisk()` / `classifyRisk({})` ⇒ 全 `false`/`null`/`''` |
+
+空文本（`''`）与纯空白按「无信号」处理，返回 `NOT_HIT`。
+
+### 4.2 挂起入参校验（`risk-suspender.suspend`）
+
+| 字段 | 规则 | 非法处理 |
+|---|---|---|
+| `platform` | 非空字符串 | 空/缺失 ⇒ **抛错**（`risk-suspender: suspend requires platform`） |
+| `accountId` | `string` / `null` / `undefined` | `null`/`undefined` 统一归一为 `null` ⇒ 平台级 |
+| `signal` | 非空 `string` | 非字符串或空 ⇒ 字段**不写入** |
+| `signal` 长度 | ≤ 64 | 超长截断 |
+| `strength` | 严格 `'strong'` 或 `'weak'` | 其它值（如 `'bogus'`）⇒ 字段**不写入**（避免 UI 把任意字符串当依据展示） |
+| `at` | `number` | 缺失 ⇒ 取注入 `clock()` |
+
+### 4.3 渲染层清单校验（`risk-suspended-tracker.normalize`）
+
+| 字段 | 规则 | 非法处理 |
+|---|---|---|
+| 数组来源 | `Array` / `{suspended:[…]}` / `{code,data:[…]}` 三形态 | 其它 ⇒ 空清单 |
+| 单条记录 | 必须有非空 `platform: string` | 无 `platform` 的记录被**过滤**（含 `null`、裸字符串） |
+| `accountId` | `== null` ⇒ `null` | 原样 |
+| `reason` | `string` | 非字符串 ⇒ `''` |
+| `at` | `number` | `null` ⇒ `null` |
+| `signal` | `string` | 非字符串 ⇒ `''` |
+| `strength` | 严格 `'strong'`/`'weak'` | 其它 ⇒ `null`，UI 据此**不渲染**判定依据（不猜） |
+
+### 4.4 IPC 入参校验（`publishRisk.resume` / `publishRisk.isSuspended`）
+
+| 字段 | 规则 | 非法处理 |
+|---|---|---|
+| `platform` | `/^[a-zA-Z0-9_-]+$/` | ⇒ `{code: VALIDATION_ERROR, message: 'platform 必须为合法平台标识'}` |
+| `accountId` | `null` 或同平台格式 | ⇒ `{code: VALIDATION_ERROR, message: 'accountId 格式无效'}` |
+| `riskSuspender` 未注入 | — | ⇒ `{code: REQUEST_ERROR, message: '风控挂起服务未初始化'}` |
+
+---
+
+## 5. 流程
+
+### 5.1 判定与挂起流程（修复后）
+
+```
+task:failed(task)
+  │
+  ├─ ① 组装判定入参
+  │     error       = task.error                      (string)
+  │     code        = task.errorCode                  ← 新增：传输层搬运
+  │     riskBlocked = task.riskBlocked === true       ← 新增：传输层搬运
+  │
+  ├─ ② classifyRisk(...)   ← 结构化优先，文本兜底，分强弱
+  │     结构化 flag        → { hit, strong, 'flag',      suspends:true  }
+  │     code ∈ 风控码族     → { hit, strong, 'code:…',    suspends:true  }
+  │     文本含强信号词      → { hit, strong, 'strong:…',  suspends:true  }
+  │     文本仅含弱信号词    → { hit, weak,   'weak:…',    suspends:false }
+  │     文本含 risk_suspended→ { hit:false }             (自触发防线)
+  │     无信号              → { hit:false }
+  │
+  ├─ ③ 分支
+  │     suspends === true  && !isRiskSuspendedMessage(task.error)
+  │        ├─ accountId = task.article.accountId || task.accountId || null   ← 账号优先
+  │        ├─ riskSuspender.suspend(platform, accountId, { reason, error, signal, strength })
+  │        ├─ 广播 publish:risk-suspended { suspended: 全量清单 }
+  │        └─ 发送 publish:risk-hold { platform, accountId, taskId, error, signal, strength }
+  │
+  │     hit === true 但 suspends === false（弱信号 / 自身拦截消息）
+  │        └─ 仅结构化日志 weak-signal-not-suspended（不挂起、不广播、不提示）
+  │
+  │     hit === false
+  │        └─ 无事发生（失败仍照常进进度条与发布历史）
+  │
+  └─ ④ 主窗口不存在（win 销毁）⇒ 整段跳过（挂起仍需窗口才能广播；崩溃恢复靠水合）
+```
+
+**为什么弱信号不发 `publish:risk-hold`**：该 IPC 的唯一消费端会弹「检测到风控」toast。弱信号命中率高（`身份验证失败` 这类日常失败都会命中），发出去等于把「风控」这个标签贴到普通失败上——**提示本身也是一次误报**。失败原因仍可通过进度条（`stage: '✗ 发布失败: …'`）与发布历史（`status: 'failed'` + `error` 原文）看到，用户看到的是平台原文而不是我们贴错的标签。
+
+### 5.2 派发前置守卫（不变）
+
+```
+bootstrap.setExecutor(task)
+  ├─ signal.aborted?                          → throw '任务已取消'
+  ├─ riskSuspender.isSuspended(platform, taskAccountId)?
+  │     → throw RiskSuspendedError  (code='risk_suspended', noRetry=true)
+  │       ⇒ taskQueue 直接判 failed，不重试、createPublisher 零调用、零请求
+  └─ 正常发布
+```
+
+`accountId` 取 `task.article?.accountId`；`null` 时命中平台级挂起记录。
+
+### 5.3 恢复流程（不变，人工确认）
+
+```
+用户点「恢复发布」
+  → riskStore.resume(platform, accountId)
+      → tracker.resume
+          ├─ confirm({platform, accountId})  ← ElMessageBox 人工确认（缺省 false ⇒ 不恢复）
+          │     取消 ⇒ { ok:false, reason:'cancelled' } 静默保持挂起
+          └─ IPC publishRisk.resume
+                 ├─ 校验 platform / accountId
+                 ├─ riskSuspender.resume(platform, accountId)
+                 ├─ 广播 publish:risk-suspended { suspended: 全量清单 }
+                 └─ { code:0, data:{ changed, suspended } }
+  → 成功 notifySuccess('publish.riskHold.resumed')
+  → 失败 notifyError('publish.riskHold.resumeFailed', { message })
+```
+
+**不提供任何自动恢复路径**：`risk-suspender` 无计时器、无 TTL、无自动换号。
+
+### 5.4 持久化与水合
+
+```
+suspend() → inner.suspend() → persist() → store.setSetting('publish.riskSuspended', listSuspended())
+任意读取（isSuspended / listSuspended / resume）→ hydrate()（幂等，首次从 store 回填）
+  └─ 回填字段：platform / accountId / reason / at / signal / strength
+     读失败 ⇒ 按空集（fail-open on read，不阻断发布）
+     写失败 ⇒ 仅告警（fail-soft）
+```
+
+**升级兼容**：旧记录无 `signal`/`strength`，水合后字段为 `undefined`，UI 据此**不渲染**「判定依据」标签（不猜、不兜底成「平台风控拦截」）。
+
+---
+
+## 6. 功能逻辑
+
+### 6.1 结构化优先（G1）
+
+判定顺序固定为「标志 → 码族 → 文本」，**前两者命中时文本完全不参与**。这保证：
+
+- 适配器/引擎已经算准的结论不再被错误文本推翻；
+- 即使平台返回的文案措辞变化（例如本地化成英文或改词），只要它同时置了 `risk_blocked` 或风控码，判定仍然正确；
+- 文本兜底只服务「只拿到一段 error 字符串」的降级路径（如 RPA 轨只回传文案）。
+
+### 6.2 强弱分档（G2/G3）
+
+- **强信号允许挂起**：这些措辞/码在实测中只出现在真实风控。
+- **弱信号不允许挂起**：这些词在普通失败里高频出现。
+- 不变量 `suspends ⇔ (hit && strength === 'strong')` **由单一真源给出**，调用方（桌面 `phase4-events`、引擎 `publish-mode-runner`）只读 `suspends`，不得自行推导（否则又是一个漂移点）。
+
+**召回影响评估**：仓内全部真实风控来源（附录 B）收紧后**仍全部落在强档**，包括：
+- 抖音 110 的文案形态已显式收入强档（`验证失败(110)`），其结构化 `risk_blocked` 亦在强档；
+- B站 601 由 `风控` + `滑块验证` + 码族三重覆盖；
+- 快手/百家号/小红书由 `风控` 覆盖。
+
+唯一由强档转为弱档的是**合成夹具** `抖音安全 verify 拦截`（仅出现在测试里，非生产文案）；其路由语义（停报不降级）由并集判据 `isRiskText` 保持不变。
+
+### 6.3 粒度决策（G4）
+
+| 信号档位 | `accountId` | 决策 | 理由 |
+|---|---|---|---|
+| strong | 有 | 账号级挂起 | 精确打击，不牵连同平台其他账号 |
+| strong | 无 | **平台级挂起**（覆盖全平台） | 真实风控下宁可多拦；账号未知时用户会逐个账号重试，风险更大 |
+| weak | 有 | **不挂起** | 误判代价 > 漏判代价 |
+| weak | 无 | **不挂起** | 同上，且平台级误冻代价更高 |
+| 无命中 | — | 不挂起 | — |
+
+`accountId` 解析改为 `task.article?.accountId || task.accountId || null`（此前只有 `task.article?.accountId`）。`task.accountId` 是 `task-queue.add()` 的归一字段（`task.accountId ?? task.article?.accountId ?? null`），因此这次兜底把「批量发布只勾平台、不勾账号」以外的场景都收成账号级，减少了「误升平台级」的概率。
+
+### 6.4 单一真源（G6）
+
+修复前存在**两份**各自演化的词表：
+
+| 位置 | 修复前内容 |
+|---|---|
+| `packages/api-publish-engine/src/publish/core/publish-mode-runner.js` | `/风控\|risk\|滑块\|601\|10000015\|frequent\|频繁\|verify\|验证\|canvas illegal\|账号存在风险/i` |
+| `apps/desktop/electron/services/publish-risk.js` | `/风控\|risk\|滑块\|601\|10000015\|frequent\|频繁\|verify\|验证\|安全验证\|操作频繁\|captcha\|canvas illegal\|账号存在风险/i` |
+
+两者注释都写着「保持同义」，实际已漂移（桌面多 3 个词）。现在两处都 require `risk-signals.js`，桌面侧仅保留兼容签名 `isRiskBlocked`。
+
+**接口分工：**
+
+| 导出 | 语义 | 用途 |
+|---|---|---|
+| `classifyRisk(input)` | 完整判定（四字段） | 挂起决策（读 `suspends`） |
+| `isRiskText(text)` / `isRiskBlocked(text)` | 强弱并集「像不像风控」 | 路由判据（API 轨命中即停报不降级） |
+| `RISK_ANY_RE` / `RISK_STRONG_RE` / `RISK_WEAK_RE` | 裸词表 | 边界断言、诊断 |
+| `RISK_CODES` | 风控码族 `Set` | 码族判定与诊断 |
+
+---
+
+## 7. 交互逻辑
+
+### 7.1 触发时机
+
+| 事件 | 交互 |
+|---|---|
+| 发布失败且判定 `suspends === true` | （1）账号页横幅出现/刷新；（2）warning toast `publish.riskHold.suspended`（由 `main.js` 的 `useRiskStore.start({notify})` 在挂起清单非空时弹出）；（3）`risk-hold-notifier` 另弹 `publish.riskHold.body` |
+| 发布失败但仅弱信号命中 | **无任何提示**；失败原因仍在进度条与发布历史 |
+| 进入账号页 | 横幅按权威清单渲染（`start()` 会 `refresh()` 拉取一次，重启后依旧可见） |
+| 挂起清单被广播（挂起/恢复） | 清单整体替换（非增量），横幅随之增加/移除条目 |
+| 发布页选择器 | 账号/平台显示 `publish.riskHold.badge`（`⚠ 风控挂起`）徽标，hover title 给 `guidance`/`guidanceAllAccounts` |
+
+### 7.2 挂起清单为空
+
+横幅 `v-if="items.length"` 整块不渲染——不得出现空壳横幅。
+
+### 7.3 恢复交互
+
+1. 点「恢复发布」→ 该条按钮进入 disabled（`busyKeys` 按 `platform::accountId` 去重，防连点）。
+2. 弹人工确认 `publish.riskHold.resumeConfirm`。
+3. 取消 ⇒ 静默、状态不变（`{ok:false, reason:'cancelled'}`），按钮恢复可点。
+4. 确认成功 ⇒ `notifySuccess('publish.riskHold.resumed')`，清单经广播刷新，条目消失。
+5. 主进程返回非零 ⇒ `notifyError('publish.riskHold.resumeFailed', {message})`，条目保留。
+
+### 7.4 无障碍
+
+横幅容器 `role="status"` + `aria-live="polite"`；粒度标签 `role="status"`（原实现保留）；徽标 `role="status"`。
+
+---
+
+## 8. 显示项
+
+### 8.1 横幅（`RiskSuspendedBanner.vue`）
+
+| 显示项 | 数据来源 | 渲染条件 | 文案 key |
+|---|---|---|---|
+| 标题（通用） | `items.length`、`items[0].platform` | 清单**非全部**为平台级 | `publish.riskHold.suspended` |
+| 标题（全平台级） | 同上 | 清单**全部** `accountId == null` | `publish.riskHold.suspendedAllAccounts` |
+| 平台名 | `platform` → `platformStore.getLabel()` | 每条 | 平台标签（i18n 数据源） |
+| 粒度标签 | `accountId == null` | 平台级条目 | `publish.riskHold.scopeAllAccounts` |
+| 账号名 | `accountId` | 账号级条目 | 原样显示（不翻译） |
+| 检测时间 | `at`（毫秒）→ `HH:mm` | `at` 为合法正数 | `publish.riskHold.detectedAt` |
+| 判定依据 | `strength` | `'strong'` / `'weak'`；**无值时整项不渲染** | `evidenceStrong` / `evidenceWeak` |
+| 恢复按钮 | — | 每条 | `publish.riskHold.resume` |
+
+**时间格式**：本地时区 `HH:mm`（两位数补零）。`at` 缺失 / 非数字 / `<= 0` / `NaN` ⇒ 返回空串 ⇒ 该显示项不渲染（不显示 `Invalid Date`）。
+
+### 8.2 发布页选择器（`PublishTargetSelector.vue`，未改动）
+
+| 显示项 | 条件 |
+|---|---|
+| 平台级徽标 | 该平台存在 `accountId == null` 的挂起记录 |
+| 账号级徽标 | 该账号命中（平台级覆盖该平台所有账号） |
+| hover title | 平台级 ⇒ `guidanceAllAccounts`；账号级 ⇒ `guidance` |
+
+### 8.3 判定依据标签的语义边界
+
+- `evidenceStrong` = 「判定依据：平台风控拦截」——结构化标志 / 风控码族 / 强信号词。
+- `evidenceWeak` = 「判定依据：疑似风控信号（弱）」——弱信号。**当前不会出现在横幅上**（弱信号不挂起）；保留用于历史记录与后续策略调整，且 UI 不把无值猜成强档。
+
+---
+
+## 9. 提示文字（zh / en 全量表）
+
+`apps/desktop/src/locales/publish/{zh,en}.js` 的 `riskHold` 命名空间：
+
+| key | zh | en | 变更 |
+|---|---|---|---|
+| `suspended` | 检测到风控，「{platform}」等 {count} 个发布目标已自动暂停后续发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页手动恢复。 | Risk control detected. {count} publish target(s) including "{platform}" have been paused automatically. Go to the platform creator center, publish one post manually and pass the verification, then resume from the Accounts page. | 不变 |
+| `suspendedAllAccounts` | 检测到风控，「{platform}」该平台全部账号已自动暂停后续发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页手动恢复。 | Risk control detected. All accounts for "{platform}" have been paused automatically. Go to the platform creator center, publish one post manually and pass the verification, then resume from the Accounts page. | **新增** |
+| `scopeAllAccounts` | 全平台账号 | All accounts | **新增** |
+| `detectedAt` | 检测于 {time} | Detected at {time} | **新增** |
+| `evidenceStrong` | 判定依据：平台风控拦截 | Reason: platform risk control | **新增** |
+| `evidenceWeak` | 判定依据：疑似风控信号（弱） | Reason: possible risk signal (weak) | **新增** |
+| `guidanceAllAccounts` | 该平台全部账号因平台风控已暂停发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。 | Publishing is paused for all accounts of this platform due to platform risk control. Go to the platform creator center, publish one post manually and pass the verification (a verification prompt will appear during publishing), then lift the hold on the Accounts page. | **新增** |
+| `guidance` | 该账号因平台风控已暂停发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。 | Publishing is paused for this account due to platform risk control. … | 不变 |
+| `badge` | ⚠ 风控挂起 | ⚠ Risk hold | 不变 |
+| `body` | 检测到「{platform}」发布触发风控。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。 | Risk control detected while publishing to "{platform}". … | 不变 |
+| `resume` | 恢复发布 | Resume publishing | 不变 |
+| `resumeConfirm` | 确认恢复「{platform}」的发布？请确保已在该平台创作者中心完成验证（手动发布一篇内容并通过验证），否则会再次触发风控暂停。 | Resume publishing to "{platform}"? … | 不变 |
+| `resumed` | 已恢复「{platform}」的发布 | Resumed publishing to "{platform}" | 不变 |
+| `resumeFailed` | 恢复发布失败：{message} | Failed to resume publishing: {message} | 不变 |
+
+**约束**：
+
+- zh/en **必须成对**（CI Gate 7 `check-locale-sync.js` 拦截）。
+- 渲染端 `src/` **非 locales** 文件不得新增中文字符串字面量（CI 基线扫描拦截）——`RiskSuspendedBanner.vue` 的所有中文只允许出现在注释里。
+- 新增 key 后必须同步 `--keys` 基线快照。
+
+**日志文案（非用户可见，结构化字段）**：
+
+| 日志点 | 级别 | 字段 |
+|---|---|---|
+| `RiskSuspender.weak-signal-not-suspended` | WARN | `platform`、`accountId`（缺省 `(none)`）、`signal`、`strength`、`selfGuarded` |
+| `RiskSuspender.suspend-failed` | WARN | `error` |
+| `publish-mode.risk signal weak → stop without suspend` | WARN | `platform`、`mode`、`accountId`、`outcome`、`signal`、`strength` |
+
+---
+
+## 10. 边界与失败模式
+
+| 场景 | 期望行为 |
+|---|---|
+| `task.error` 非字符串（`undefined`） | `classifyRisk` 返回 `NOT_HIT`，不挂起、不抛 |
+| `task.error` 为空、`riskBlocked=true` | 结构化优先 ⇒ 挂起（不看文本） |
+| 主窗口已销毁 | 跳过整个风控段（不挂起、不广播） |
+| `riskSuspender` 未接线 | 不挂起；强信号仍发 `publish:risk-hold`（向后兼容，既有测试锁定） |
+| `suspend()` 抛错 | `try/catch` 捕获并记 `suspend-failed` WARN，不影响失败主流程 |
+| store 读失败 | 按空集水合（fail-open），不阻断发布 |
+| store 写失败 | 仅 WARN，内存态仍可用 |
+| 持久化记录为脏数据（无 `platform`） | 跳过该条，其余照常恢复 |
+| `strength` 为非法值 | 不写入记录；渲染层归一为 `null` ⇒ 不显示依据 |
+| 同一窗口内重复挂起同键 | 幂等：更新记录、不重复通知 |
+| `resume` 未命中 | `changed: false`，不报错 |
+| 弱信号 + 无账号 | 零挂起、零提示（G4 核心场景） |
+| 自身拦截消息（`risk_suspended`） | `hit: false`，不二次挂起（自触发防线） |
+
+---
+
+## 11. 验收标准
+
+| 编号 | 验收项 | 判据 |
+|---|---|---|
+| AC-1 | 附录 A 的 7 类普通失败**不再挂起** | `classifyRisk(...).suspends === false`；phase4 测试断言零 `publish:risk-suspended`、零 `publish:risk-hold` |
+| AC-2 | 附录 B 的真风控**仍然挂起** | `strength === 'strong'` 且 `suspends === true`；phase4 断言 `suspend` 被调用 |
+| AC-3 | 结构化信号优先 | `{ riskBlocked:true, error:'网络超时' }` ⇒ 挂起且 `signal === 'flag'` |
+| AC-4 | 弱信号不挂起 | 不变量测试：`suspends ⇔ (hit && strength==='strong')` 对全部样本成立 |
+| AC-5 | `accountId` 缺失时弱信号零挂起、强信号仍平台级 | phase4 测试 `t4`（弱，`suspend` 未调用）与 `t5`（强，`accountId === null`） |
+| AC-6 | 结构化信号真的从传输层落到了 task | task-queue 集成测试：抛错携带 `code`/`riskBlocked` ⇒ `task.errorCode`/`task.riskBlocked` 正确（并做过变异反证：改成 no-op 立红 2 例） |
+| AC-7 | 横幅 4 个显示项接线存在 | `RiskSuspendedBanner.source.test.js` 8 例 |
+| AC-8 | `signal`/`strength` 跨持久化与跨进程不丢 | 引擎 `risk-suspender` 测试 + 桌面 store 水合测试 + tracker `normalize` 测试 |
+| AC-9 | zh/en 成对且渲染层无裸中文 | Gate 7 locale 同步 + CJK 基线 |
+| AC-10 | 单一真源 | 桌面测试断言 `classifyRisk === engine.classifyRisk`（同一函数引用） |
+
+---
+
+## 12. 影响面与回归
+
+| 层 | 文件 | 变更性质 |
+|---|---|---|
+| 引擎（单一真源） | `packages/api-publish-engine/src/publish/core/risk-signals.js` | **新增** |
+| 引擎 | `packages/api-publish-engine/src/publish/core/publish-mode-runner.js` | 词表收敛 + 挂起加强弱闸门 |
+| 引擎 | `packages/api-publish-engine/src/publish/core/risk-suspender.js` | 记录增加 `signal`/`strength`（可选、截断、白名单校验） |
+| 引擎 | `packages/api-publish-engine/src/index.js` | `publishViaApi` 抛错保留 `code`/`risk_blocked`/`loginExpired` |
+| 桌面主进程 | `apps/desktop/electron/services/publish-risk.js` | 收敛为真源包装 + 兼容签名 |
+| 桌面主进程 | `apps/desktop/electron/services/publisher-router.js` | 新增 `attachRiskSignals`，三个发布器抛错时搬运 |
+| 桌面主进程 | `apps/desktop/electron/services/risk-suspender-store.js` | 水合透传 `signal`/`strength` |
+| 桌面主进程 | `apps/desktop/electron/bootstrap/phase4-events.js` | 判定三原则落地 |
+| 共享 | `packages/shared-utils/src/task-queue.js` | 失败时把 `code`/`riskBlocked` 落到 task |
+| 渲染层 | `apps/desktop/src/services/risk-suspended-tracker.js` | `normalize` 保留 `signal`/`strength` |
+| 渲染层 | `apps/desktop/src/features/accounts/components/RiskSuspendedBanner.vue` | 三个新显示项 + 标题分流 |
+| 文案 | `apps/desktop/src/locales/publish/{zh,en}.js` | 5 个新 key（成对） |
+| 测试 | 见第 11 节 | 新增/扩展 8 个测试文件 |
+
+**QM-1**：改 `apps/desktop/electron/**` ⇒ 需本地打包验证。
+**不涉及**：`platforms.yaml`、IPC 通道契约、`preload` 键数、数据库 schema。
+
+---
+
+## 附录 A：误判取证表（修复前会挂起，修复后不挂起）
+
+| # | 错误文本 | 修复前命中原因 | 修复后 | 现实对应 |
+|---|---|---|---|---|
+| A1 | `Request failed with status code 601` | 裸数字 `601` | `weak:601`，不挂起 | 代理/网关返回非标准状态码 |
+| A2 | `publish id 6019 not found` | 裸数字 `601` 子串 | 不命中（数字边界） | 作品 ID 含 601 |
+| A3 | `gateway timeout ts=1601846521` | 裸数字 `601` 子串 | 不命中（数字边界） | 时间戳含 601 |
+| A4 | `errno 100000159: bad request` | 裸数字 `10000015` 子串 | 不命中（数字边界） | 错误码邻居 |
+| A5 | `infrequent login detected` | `frequent` 子串 | 不命中（标识符边界） | 英文错误里的单词片段 |
+| A6 | `low-risk content flagged` | `risk` 英文普通词 | `weak:risk`，不挂起 | 平台内容分级提示 |
+| A7 | `身份验证失败` / `请先完成实名验证` | `验证` 中文普通词 | `weak:验证`，不挂起 | 登录/实名校验失败 |
+
+> 取证方法：把发布链路上 674 个源文件的「像错误文案」字符串字面量全量喂给判定函数，剔除自身含风控特征的条目后逐条人工核对（见 `openspec/records/fix-risk-hold-false-positive.md` 的取证小节）。
+
+## 附录 B：真实风控来源表（修复后仍挂起）
+
+| 平台 | 触发条件 | 错误文案 | 判定路径 |
+|---|---|---|---|
+| 抖音 | `x-tt-verify-passport-decision` 响应头 | 抖音触发安全验证，请在创作者中心手动完成验证后重试（不自动换号） | 结构化 `risk_blocked:true` + `安全验证` |
+| 抖音 | `status_code === 110` | 抖音验证失败(110)，请手动完成验证后重试 | 结构化 `risk_blocked:true` + `验证失败(110)` |
+| B站 | `code === 601` | B站风控(601)：请先在创作者中心完成滑块验证后重试 | 码族 `code:601` + `风控` + `滑块` |
+| 快手 | 提交返回验证页/非 JSON | 快手返回验证页/非 JSON 应答，疑似风控拦截，请在创作者中心手动确认后再试（不自动验证、不换号） | 结构化 + `风控` |
+| 百家号 | `errno === 10000015` | 百家号风控拦截：…请完成验证 | 码族 `code:10000015` + `风控` |
+| 小红书 | DOM 检出风控/验证弹层 | 检测到风控/验证弹层，已停止 | `风控` + `验证弹层`（`XHS_RISK_BLOCKED`） |
+| 参考产品取证 | -110 码族 | `canvas illegal` / `Canvas Illegal: …` | 强档词 |
+| 参考产品取证 | 风控提示原文 | 官方检测到您的账号存在风险，请先前往创作者中心发布作品 | `账号存在风险` |
diff --git a/01-docs/learnings.md b/01-docs/learnings.md
index ca42f7704..88965b6b8 100644
--- a/01-docs/learnings.md
+++ b/01-docs/learnings.md
@@ -17859,3 +17859,17 @@ CCG 的 `HARDCODED_SECRET` 规则是「关键词 + `[:=]` + 引号内 8 字符
 1. **`node -e` 的 `require('./x')` 不相对 cwd**：CI 日志 `Cannot find module './scripts/gate9-classify.js'`，require stack 是 `D:\a\mulpub\mulpub\[eval]` —— Node 把 `-e` 的 `./` 相对 **eval 脚本**解析。本机 cwd 恰是仓库根所以没暴露。**凡在 workflow 里用 `node -e` require 仓库文件，必须 `path.join(process.cwd(), ...)`**。
 2. **`github.event.pull_request.changed_files` 是整数计数，不是文件清单**：实测该字段 = 13（与 `git diff --name-only` 的文件数一致），`toJSON()` 后得到 `"13"`，分类器把「13」当成一个假文件名 → 落 fail-closed 桌面端全量，分流等于没生效。正确做法是用 git 自己算：`git diff --name-only $(git merge-base origin/main HEAD) HEAD`。
 3. **`.gitignore` 的 `scripts/*.js` 会静默吞掉门禁本体**：三次 CI 红同一个根因——判据模块没入库（`*.test.js` 后缀不同逃过忽略，被测模块没有），CI 上 MODULE_NOT_FOUND 而本机全绿。修法按仓内先例加 `!scripts/xxx.js` 反选放行。**更深教训：本机全绿/CI 全红时，先查「文件真的入库了吗」，再查逻辑**——我连续误判了两次（先修 node -e 路径、再修 changed_files 语义），都是真实问题但都不是那三次红的根因。
+
+## 风控挂起误判修复的六条可复用教训（fix-risk-hold-false-positive，2026-10-13）
+
+1. **「判定不准」先查「上层拿到的输入是不是被降维了」，别急着加词表**：本次根因不是词表写得不好，而是各发布链**已经算出**了结构化结论（`risk_blocked` 标志、B 站 `code:601`、百家号 `code:10000015`），却在 `throw new Error(result.error)` 处被压成一段 `message` 丢掉，逼上层用关键词猜。结构是：**结构化信号被丢（真因）→ 只能文本匹配（缺陷形态）→ 裸子串误判（症状）**。只加边界是治症状；把 `code`/`riskBlocked` 搬到 `Error` 上再落到 `task` 才是治因。检查清单：凡「用文本判断一个本该有结构化的东西」，先追它的结构化信号在哪一层丢的。
+2. **词表的误判面在「输入域」上，静态扫描仓内字面量扫不出来**：我扫了 674 个发布链文件确认仓内 0 个纯误判字符串——一度以为词表没问题。但真实误判面来自**平台/网关/HTTP 客户端**的返回文案（`Request failed with status code 601`、`publish id 6019 not found`、`gateway timeout ts=1601846521`、`errno 100000159`）。教训：验证一张「匹配外部文本」的词表，样本必须从输入域构造（把 HTTP 状态码/ID/时间戳/错误码邻居喂进去），扫仓库只能证明「我们自己写的文案不打架」。
+3. **弱信号「不挂起但仍提示」是二次误报**：一度设计了「弱信号发独立文案（疑似风控信号，已跳过暂停）」。想清楚后否决——该提示对用户**不可行动**（既不用去创作者中心，也不需要做任何事），而 `身份验证失败` 这类日常失败每次都命中弱档 ⇒ 等于把「风控」标签贴到普通失败上。**「风控」这个词本身就是结论**，不该拿它标注不确定的东西。弱信号最终只进结构化日志。
+4. **跨包/跨层的单元测试可能对「搬运缺失」完全免疫（假绿形态）**：`phase4-events.test.js` 的风控用例是**直接往 task 对象塞 `errorCode`/`riskBlocked`** 的——如果 `task-queue` 根本没把这两个字段从 `Error` 搬过来，这些用例**照样全绿**，而生产路径的结构化优先从未生效。补锁方式：在 `task-queue` 侧写一条「executor 抛带 `code`/`riskBlocked` 的 Error ⇒ `task:failed` 的 task 上字段正确」，并做变异反证。**元规则：当 A 层测试需要「手工构造 B 层的输出」时，B 层到 A 层的搬运必须有独立锁。**
+5. **`check-max-lines` 的 growthAllowance 是被共享的预算，受管文件里放辅助函数会顶破台账**：本次初版把 `attachRiskSignals`（28 行）写在 `publisher-router.js`，该文件已用到 804/829（登记值 629 + 容差 200）⇒ `LEDGER_GREW … 膨胀 209 行` 判红。正解不是「申请扩容差」而是**把函数放进语义归属的模块**（风控辅助 → `publish-risk.js`），受管文件只剩 1 行 import + 3 个调用点。附带发现：该文件余量此后仅 11 行，任何增量都应先考虑拆分。
+6. **同一「远程同步」欠账在两套载体上是两套登记机制，且必须四处同次改完**：`.quality-gates.md` 的 PENDING 行走 `scripts/gate-record-debt-ledger.json`（键 = 标题原文，含【混合 PR】后缀）；`openspec/records/<slug>.md` 里的 PENDING 行走 **frontmatter 三字段** `sync_status` / `sync_reason` / `sync_backfill_owner`。我第一版把两处都当 ledger 处理，被 `check-gate-record-debt.js` 点名 `L0 [PENDING] …（缺登记字段）`。回填时两处 + ledger 删除必须同一次提交。
+
+### 本次顺带确认的两条工程细节
+
+- **本仓 `text=auto`：编辑工具写出的 CRLF 会让行数虚涨、行尾对账两口径不一致**。处置脚本化：用 Node 把本 PR 触及文件统一 `\r\n → \n`（并剥 BOM），再 `git ls-files --eol` 复核 `w/lf`。**不要用 `Measure-Object -Line` 估行数**，一律以 `check-max-lines.js` 或 `split('\n').length` 为准。
+- **引擎测试分「vitest 组」与「direct 组」，新增测试文件必须登记**：`packages/api-publish-engine/scripts/run-tests.js` 的 `VITEST_FILES` 是白名单，不在其中的文件走 `node <file>` 直跑。新写的 vitest 风格用例（用 `describe`/`it`）不登记就报 `ReferenceError: describe is not defined`——**不是代码错，是登记缺失**。
diff --git a/CHANGELOG.md b/CHANGELOG.md
index a1eed7471..c5f109b88 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,3 +1,59 @@
+# [未发布] fix(publish): 风控挂起的误判——判定只看关键词，把 HTTP 601 当成了风控（fix-risk-hold-false-positive）
+
+## 背景
+
+账号管理页弹出「检测到风控，「微信公众号」等 1 个发布目标已自动暂停后续发布……」，但用户在平台侧**并没有**触发任何验证，
+而该平台的后续发布被真的挡住，必须逐条手动恢复。挂起态还会持久化、重启存活、无自动过期。
+
+根因两条，互为放大镜：
+
+1. **结构化风控信号被丢在半路**。各链其实都已算出结构化结论（抖音 `risk_blocked` 标志、B站 `code:601`、
+   百家号 `code:10000015`、快手 `risk_blocked`、小红书 `XHS_RISK_BLOCKED`），但传输层一律
+   `throw new Error(result.error)`（引擎 `publishViaApi` 与桌面 `publisher-router.js` 三个发布器），
+   `Error` 上只剩 `message` ⇒ 上层**只能**用错误文本猜关键词。
+2. **词表无边界且不分强弱**。`/风控|risk|滑块|601|10000015|frequent|频繁|verify|验证|…/i` 是裸子串匹配，
+   实测把 7 类普通失败判成风控：`status code 601`、`publish id 6019`、`ts=1601846521`、`errno 100000159`、
+   `infrequent login`、`low-risk content`、`身份验证失败`。
+
+**放大器**：`accountId` 缺失时自动降级为平台级挂起（覆盖该平台**所有**账号）⇒ 「一次误判 + 没带账号」= 整平台停摆。
+误判的代价不是「少发一篇」，而是把用户引向「去创作者中心手动发一篇完成验证」——**而那里根本不会弹验证**。
+
+## 改动
+
+- **新增判定单一真源** `packages/api-publish-engine/src/publish/core/risk-signals.js`：
+  判定顺序固定为**结构化标志 → 平台风控码族 → 文本兜底**（前两级命中时文本完全不参与）；
+  文本词表**分强弱**——强档（风控/滑块/安全验证/验证弹层/操作频繁/captcha/canvas illegal/账号存在风险/
+  risk control/BILI_RISK/`验证失败(110)`/`10000015`）允许挂起，弱档（裸 验证/频繁/risk/frequent/verify/601）
+  **只记录不挂起也不提示**；数字用 `(?<!\d)…(?!\d)`、英文词用标识符边界（`_` 算边界，故 `BILI_RISK_601` 仍命中、
+  `derisk`/`infrequent`/`verified` 不再命中）；排除自身守卫标记 `risk_suspended`。
+  **`suspends ⇔ (hit && strength==='strong')` 作为不变量由本模块给出**，调用方不得自行推导。
+- **收敛两处已漂移的 `RISK_RE`**：引擎 `publish-mode-runner.js` 与桌面 `publish-risk.js` 改为 require
+  同一模块（桌面保留兼容签名 `isRiskBlocked`）。此前两份注释都写「保持同义」，正文已漂移 3 个词。
+- **打通结构化信号搬运**：引擎 `publishViaApi`、桌面 `attachRiskSignals`（三个发布器）在抛错时保留
+  `code`/`riskBlocked`/`loginExpired`；`task-queue` 失败时落到 `task.errorCode`（缺省 `null`）与
+  `task.riskBlocked`（缺省 `false`，不留 `undefined`）。
+- **挂起决策加三原则**：结构化优先；弱信号不挂起也不弹「检测到风控」（提示本身也是一次误报），仅留结构化日志
+  `weak-signal-not-suspended`；`accountId` 解析加任务级字段兜底，减少误升平台级。强信号 + 无账号仍按平台级（不放松）。
+- **挂起记录携带判定依据**：`signal`（封闭词表记号，≤64 字符）+ `strength`（白名单校验），**不落原始错误文本**；
+  桌面 store 水合与渲染层 `normalize` 一并透传，旧记录不伪造依据。
+- **横幅新增显示项**：粒度标签（全平台账号 / 单账号）、检测时间（`HH:mm`）、判定依据（strong/weak，无值时不渲染）；
+  标题在全部为平台级时分流到新文案。i18n 新增 6 个 key（zh/en 成对）。
+
+## 验证
+
+- 新增判定回归锁 **45 例**（含附录 A 的 7 类误判面与附录 B 的 8 条真实风控来源，逐条正反对照）。
+- 引擎全量 **379 passed / 40 files**；`shared-utils` 全量 **844 passed / 10 skipped**；桌面受影响 6 文件 **171 passed**。
+- **变异反证**：把 `task-queue` 的结构化字段赋值改成 no-op ⇒ `Tests 2 failed | 35 passed` 立红；还原后复绿。
+  反证的是**锁本身**（实现改 no-op 必须立红），不是只证「业务改动变红」。
+- **QM-1 打包 rc=0**，并从解包产物实跑判定取证：`status code 601` → `suspends=false`；`B站风控(601)` → `strength=strong`。
+- 过程中的一处自我纠错：初版把 `attachRiskSignals` 写在 `publisher-router.js`，顶破该受管文件的台账容差被
+  `check-max-lines.js` 判红（`LEDGER_GREW … 膨胀 209 行（容差 200）`）；移回风控模块后该文件改动 33 → 14 行，复跑 PASS。
+
+## 未闭合（如实记录）
+
+- 本机无真实风控会话，「真实风控命中 → 挂起 → 横幅 → 人工恢复」**端到端真机回归未做**，横幅视觉未在真机截到（仅源级契约锁）。
+- `publisher-router.js` 的后端轨回退文案是历史编码损坏串（`'鍙戝竷澶辫触'`），本 PR **刻意未顺手修**，应另开一次性编码治理。
+
 # [未发布] fix(ci): 桌面分片从来没分过文件——裸 "--" 吃掉了七个 vitest 旗标（desktop-shard-flag）
 
 ## 背景
diff --git a/apps/desktop/electron/bootstrap/phase4-events.js b/apps/desktop/electron/bootstrap/phase4-events.js
index 75f4ccfc2..9375d0a89 100644
--- a/apps/desktop/electron/bootstrap/phase4-events.js
+++ b/apps/desktop/electron/bootstrap/phase4-events.js
@@ -12,7 +12,9 @@
  * 验收标准 BUGFIX-PLAN Bug-1: phase 文件 ≤ 80 行
  */
 const log = require('../services/logger')
-const { isRiskBlocked } = require('../services/publish-risk')
+// fix-risk-hold-false-positive：风控判定统一走 classifyRisk（结构化优先 + 强弱分档），
+// 「是否挂起」的判据是 verdict.suspends（仅强信号），不再用裸词表 isRiskBlocked 直接挂起。
+const { classifyRisk } = require('../services/publish-risk')
 const { isRiskSuspendedMessage } = require('../services/risk-suspender-store')
 const { createPublishProgressEmitter } = require('../services/publish-progress-events')
 const { safeHttpUrl } = require('@multi-publish/shared-utils/src/safe-http-url')
@@ -233,17 +235,57 @@ function wireTaskQueueEvents({ taskQueue, history, publishMonitor, publishImpact
     }
     const win = getMainWin()
     if (win && !win.isDestroyed()) {
-      if (isRiskBlocked(task.error) && !isRiskSuspendedMessage(task.error)) {
-        const accountId = (task.article && task.article.accountId) || null
-        // §5 enforcement：风控命中 → 平台/账号即时挂起（resume 仅显式），并广播全量挂起清单供前端刷新
+      // fix-risk-hold-false-positive（P0-1 / P0-2 / P1-3）——风控判定三原则：
+      //   ① 结构化信号优先：传输层已在 task 上落 errorCode / riskBlocked（publisher-router
+      //      与引擎 publishViaApi 把适配器算出的 risk_blocked 标志与风控码族搬了过来），
+      //      文本词表只作兜底。此前只有 task.error 一段文本可判，逼出关键词匹配式的误判。
+      //   ② 强弱分档：**只有 strong 才挂起、才提示**。弱信号（裸 验证/risk/frequent/verify/601）
+      //      在实测中会把 `身份验证失败`、`status code 601`、`infrequent`、`id 6019` 误判成风控；
+      //      挂起的代价是该账号（无账号时是整个平台）被冻结到用户人工解封，而「风控」提示本身
+      //      也是一次误报打扰 —— 弱信号因此只留结构化日志，既不挂起也不弹「检测到风控」。
+      //      失败本身仍照常出现在进度条与发布历史里（本函数上方已 emit / addRecord），
+      //      用户看到的是平台原文，而不是被我们贴错的风控标签。
+      //   ③ 账号优先：accountId 取 article 再兜任务级归一字段（task-queue add() 已归一），
+      //      尽量避免因 article 缺账号而降级成「整平台冻结」。
+      const riskVerdict = classifyRisk({
+        error: task.error,
+        code: task.errorCode,
+        riskBlocked: task.riskBlocked === true,
+      })
+      if (riskVerdict.suspends && !isRiskSuspendedMessage(task.error)) {
+        const accountId = (task.article && task.article.accountId) || task.accountId || null
+        // §5 enforcement：强信号命中 → 平台/账号即时挂起（resume 仅显式），并广播全量清单供前端刷新
         if (riskSuspender) {
           try {
-            riskSuspender.suspend(task.platform, accountId, { reason: 'risk_blocked', error: task.error })
+            riskSuspender.suspend(task.platform, accountId, {
+              reason: 'risk_blocked',
+              error: task.error,
+              signal: riskVerdict.signal,
+              strength: riskVerdict.strength,
+            })
             win.webContents.send('publish:risk-suspended', { suspended: riskSuspender.listSuspended() })
           } catch (e) { log.notify('RiskSuspender', 'suspend-failed', { level: 'WARN', error: String(e.message) }) }
         }
         win.webContents.send('publish:risk-hold', {
-          platform: task.platform, accountId, taskId: task.id, error: task.error,
+          platform: task.platform,
+          accountId,
+          taskId: task.id,
+          error: task.error,
+          signal: riskVerdict.signal,
+          strength: riskVerdict.strength,
+        })
+      } else if (riskVerdict.hit) {
+        // 弱信号（或本守卫自身的拦截消息）：不挂起、不提示，只留可追溯的结构化日志。
+        // 「未挂起」这个决定本身必须可观测，否则事后无法回答「为什么这次没暂停」。
+        log.notify('RiskSuspender', 'weak-signal-not-suspended', {
+          level: 'WARN',
+          params: {
+            platform: task.platform,
+            accountId: ((task.article && task.article.accountId) || task.accountId) || '(none)',
+            signal: riskVerdict.signal,
+            strength: riskVerdict.strength,
+            selfGuarded: isRiskSuspendedMessage(task.error),
+          },
         })
       }
     }
diff --git a/apps/desktop/electron/bootstrap/phase4-events.test.js b/apps/desktop/electron/bootstrap/phase4-events.test.js
index a60584316..d03ff290d 100644
--- a/apps/desktop/electron/bootstrap/phase4-events.test.js
+++ b/apps/desktop/electron/bootstrap/phase4-events.test.js
@@ -716,4 +716,133 @@ describe('phase4-events — 发布记录封面字段', () => {
   })
 })
 
+// ─────────────────────────────────────────────────────────────────────────────
+// fix-risk-hold-false-positive 回归锁：风控挂起判定三原则
+//   ① 结构化信号优先（task.errorCode / task.riskBlocked 胜过文本）
+//   ② 强弱分档：只有强信号才挂起 + 才提示（弱信号零打扰）
+//   ③ accountId 优先账号级，避免误降级成整平台冻结
+// ─────────────────────────────────────────────────────────────────────────────
+describe('phase4-events — 风控挂起判定（fix-risk-hold-false-positive）', () => {
+  function harness (task) {
+    const taskQueue = new EventEmitter()
+    const send = vi.fn()
+    const win = { isDestroyed: () => false, webContents: { send } }
+    const riskSuspender = { suspend: vi.fn(), listSuspended: vi.fn(() => []) }
+    wireTaskQueueEvents({
+      taskQueue,
+      history: { addRecord: vi.fn() },
+      publishMonitor: { createMonitorTask: vi.fn() },
+      publishImpactTracker: { scheduleImpactTracking: vi.fn() },
+      getMainWin: () => win,
+      riskSuspender,
+    })
+    taskQueue.emit('task:failed', task)
+    return { send, riskSuspender }
+  }
+  const callsOf = (send, channel) => send.mock.calls.filter((c) => c[0] === channel)
+
+  it('强信号 + 账号 → 挂起该账号；suspend 携带 signal/strength；hold 携带判定依据', () => {
+    const { send, riskSuspender } = harness({
+      id: 't1', platform: 'douyin', article: { accountId: 'acc-1' },
+      error: '抖音触发安全验证，请手动完成验证后重试',
+    })
+    expect(riskSuspender.suspend).toHaveBeenCalledTimes(1)
+    const [, acc, info] = riskSuspender.suspend.mock.calls[0]
+    expect(acc).toBe('acc-1')
+    expect(info.strength).toBe('strong')
+    expect(typeof info.signal).toBe('string')
+    expect(info.signal.length).toBeGreaterThan(0)
+    const hold = callsOf(send, 'publish:risk-hold')[0][1]
+    expect(hold).toMatchObject({ platform: 'douyin', accountId: 'acc-1', taskId: 't1', strength: 'strong' })
+    expect(callsOf(send, 'publish:risk-suspended')).toHaveLength(1)
+  })
+
+  it('P0-2 误判面：HTTP 601 这类普通失败既不挂起、也不弹风控提示', () => {
+    const { send, riskSuspender } = harness({
+      id: 't2', platform: 'bilibili', article: { accountId: 'a' },
+      error: 'Request failed with status code 601',
+    })
+    expect(riskSuspender.suspend).not.toHaveBeenCalled()
+    expect(callsOf(send, 'publish:risk-suspended')).toHaveLength(0)
+    expect(callsOf(send, 'publish:risk-hold')).toHaveLength(0)
+  })
+
+  it('P0-2 误判面：身份验证失败（弱信号）零打扰', () => {
+    const { send, riskSuspender } = harness({
+      id: 't3', platform: 'wechat_mp', article: { accountId: 'a' },
+      error: '身份验证失败，请重新登录',
+    })
+    expect(riskSuspender.suspend).not.toHaveBeenCalled()
+    expect(callsOf(send, 'publish:risk-hold')).toHaveLength(0)
+    expect(callsOf(send, 'publish:risk-suspended')).toHaveLength(0)
+  })
+
+  it('P0-2 误判面：id 6019 / infrequent 均零打扰', () => {
+    for (const error of ['publish id 6019 not found', 'infrequent login detected']) {
+      const { send, riskSuspender } = harness({ id: 'x', platform: 'zhihu', article: { accountId: 'a' }, error })
+      expect(riskSuspender.suspend, error).not.toHaveBeenCalled()
+      expect(callsOf(send, 'publish:risk-hold'), error).toHaveLength(0)
+    }
+  })
+
+  it('P1-3 弱信号 + 无账号 → 不降级成平台级挂起（避免误伤同平台其他账号）', () => {
+    const { riskSuspender } = harness({
+      id: 't4', platform: 'wechat_mp', article: {}, error: '请先完成实名验证',
+    })
+    expect(riskSuspender.suspend).not.toHaveBeenCalled()
+  })
+
+  it('强信号 + 无账号 → 仍按平台级挂起（真实风控的既有安全语义不放松）', () => {
+    const { riskSuspender } = harness({
+      id: 't5', platform: 'wechat_mp', article: {}, error: '账号存在风险，请前往创作者中心发布作品',
+    })
+    expect(riskSuspender.suspend).toHaveBeenCalledTimes(1)
+    expect(riskSuspender.suspend.mock.calls[0][1]).toBeNull()
+  })
+
+  it('P0-1 结构化优先：文本无害但 task.riskBlocked=true → 仍挂起（signal=flag）', () => {
+    const { riskSuspender } = harness({
+      id: 't6', platform: 'douyin', article: { accountId: 'a' },
+      error: '后端返回未知错误', riskBlocked: true,
+    })
+    expect(riskSuspender.suspend).toHaveBeenCalledTimes(1)
+    expect(riskSuspender.suspend.mock.calls[0][2].signal).toBe('flag')
+  })
+
+  it('P0-1 结构化码族优先：task.errorCode=BILI_RISK_601 → 挂起', () => {
+    const { riskSuspender } = harness({
+      id: 't7', platform: 'bilibili', article: { accountId: 'a' },
+      error: '平台拒绝了本次请求', errorCode: 'BILI_RISK_601',
+    })
+    expect(riskSuspender.suspend).toHaveBeenCalledTimes(1)
+    expect(riskSuspender.suspend.mock.calls[0][2].signal).toBe('code:BILI_RISK_601')
+  })
+
+  it('P0-1 普通错误码不挂起：errorCode=500 + 无害文本 → 零挂起', () => {
+    const { send, riskSuspender } = harness({
+      id: 't8', platform: 'wechat_mp', article: { accountId: 'a' },
+      error: '服务异常请稍后重试', errorCode: 500,
+    })
+    expect(riskSuspender.suspend).not.toHaveBeenCalled()
+    expect(callsOf(send, 'publish:risk-hold')).toHaveLength(0)
+  })
+
+  it('accountId 兜底：article 无账号但任务级归一字段有 → 账号级挂起（不误升平台级）', () => {
+    const { riskSuspender } = harness({
+      id: 't9', platform: 'douyin', article: {}, accountId: 'acc-task', error: '触发风控，请稍后再试',
+    })
+    expect(riskSuspender.suspend.mock.calls[0][1]).toBe('acc-task')
+  })
+
+  it('executor 拦截产生的 risk_suspended 仍不二次挂起、不提示（自触发防线不回归）', () => {
+    const { send, riskSuspender } = harness({
+      id: 't10', platform: 'weixin', article: {},
+      error: new RiskSuspendedError('weixin', 'acc1').message,
+    })
+    expect(riskSuspender.suspend).not.toHaveBeenCalled()
+    expect(callsOf(send, 'publish:risk-hold')).toHaveLength(0)
+    expect(callsOf(send, 'publish:risk-suspended')).toHaveLength(0)
+  })
+})
+
 
diff --git a/apps/desktop/electron/services/publish-risk.js b/apps/desktop/electron/services/publish-risk.js
index 8d37d6c91..9d3d74cde 100644
--- a/apps/desktop/electron/services/publish-risk.js
+++ b/apps/desktop/electron/services/publish-risk.js
@@ -2,24 +2,71 @@
 /**
  * publish-risk.js — 桌面侧风控命中判定（W1 §5.4 生产端）
  *
- * 从发布失败的错误文本识别 risk_blocked（风控命中），与引擎 publish-mode-runner 的 RISK_RE 词表保持同义。
- * 纯函数、零依赖、可测；命中后由 phase4-events 发 publish:risk-hold IPC，供渲染层通知中心与后续挂起守卫消费。
+ * 命中后由 phase4-events 决定「通知 / 挂起」，供渲染层通知中心与派发前置守卫消费。
  * 合规红线：风控即停、绝不自动换号绕过——本模块只做识别，不含任何自动恢复逻辑。
  *
  * 2026-10-08 P0-2 词表增强（参考产品 4.13.19 逆向取证）：补 canvas illegal
- * （抖音/西瓜风控特征串，参考产品 -110 码族的触发条件之一）与「账号存在风险」
- * （参考产品风控提示原文）。只加特征明确、无误伤面的串；宽泛词（如「服务异常」）
- * 会把普通服务端错误误判成风控，刻意不加。
+ * （抖音/西瓜风控特征串）与「账号存在风险」（参考产品风控提示原文）。
+ *
+ * 2026-10-13 fix-risk-hold-false-positive：**词表与判定逻辑整体收敛到引擎单一真源**
+ * `@multi-publish/api-publish-engine/src/publish/core/risk-signals`。
+ * 收敛前本文件与引擎 `publish-mode-runner.js` 各有一份 `RISK_RE`，注释都写「保持同义」，
+ * 实际内容已漂移（本文件多 安全验证/操作频繁/captcha）——同一个错误文本在两处能得到不同结论。
+ * 现在两处 require 同一模块；本文件只保留桌面侧的历史调用签名。
+ *
+ * ⚠️ 调用约定（本次修复的要点）：**不要用 isRiskBlocked 决定「是否挂起」**。
+ * 它回答的是「像不像风控」（强弱并集）；「能不能挂起」的判据是
+ * `classifyRisk(...).suspends` —— 弱信号（裸 验证/risk/frequent/verify/601）一律不挂起，
+ * 因为实测这些词会把 `身份验证失败`、`status code 601`、`infrequent`、`id 6019`
+ * 这类普通失败误判成风控，而挂起的代价是把账号（无账号时是整个平台）冻结到人工解封。
  */
-const RISK_RE = /风控|risk|滑块|601|10000015|frequent|频繁|verify|验证|安全验证|操作频繁|captcha|canvas illegal|账号存在风险/i
+const {
+  classifyRisk,
+  isRiskText,
+  RISK_ANY_RE,
+  RISK_STRONG_RE,
+  RISK_WEAK_RE,
+  RISK_CODES,
+} = require('@multi-publish/api-publish-engine/src/publish/core/risk-signals')
 
 /**
+ * 兼容签名：错误文本是否命中风控词表（**强弱并集**）。
  * @param {unknown} errorMessage - 发布失败的错误文本（task.error）
- * @returns {boolean} true 表示疑似风控命中，应挂起该平台并通知
+ * @returns {boolean} true 表示疑似风控命中
  */
 function isRiskBlocked (errorMessage) {
-  if (typeof errorMessage !== 'string' || !errorMessage) return false
-  return RISK_RE.test(errorMessage)
+  return isRiskText(errorMessage)
 }
 
-module.exports = { isRiskBlocked }
+/**
+ * 把发布结果里的**结构化风控信号**搬到抛出的 Error 上（fix-risk-hold-false-positive P0-1）。
+ *
+ * 为什么必须搬运：适配器/引擎链已经算出了 `risk_blocked` 标志与风控码族（BILI_RISK_601、
+ * 10000015、-1e7），但历史实现一律 `throw new Error(result.error)` —— 结构化信息丢在半路，
+ * 上层的风控判定只剩「拿错误文本做关键词匹配」这一条路，而关键词匹配正是误判的来源
+ * （`status code 601`、`id 6019`、`infrequent`、`身份验证失败` 都会被裸词表命中）。
+ * 搬运后判定可以用「结构化优先、文本兜底」，误判面大幅收窄。
+ *
+ * 不改变 message、不吞错误：调用方随后照常 throw 同一个对象。
+ * @param {Error} err
+ * @param {object} [result] 发布结果对象
+ * @returns {Error} 同一个 err（便于链式书写）
+ */
+function attachRiskSignals (err, result) {
+  if (!err || !result) return err
+  if (result.code !== undefined && result.code !== null) err.code = result.code
+  if (result.riskBlocked === true || result.risk_blocked === true) err.riskBlocked = true
+  if (result.loginExpired === true || result.login_expired === true) err.loginExpired = true
+  return err
+}
+
+module.exports = {
+  isRiskBlocked,
+  classifyRisk,
+  isRiskText,
+  attachRiskSignals,
+  RISK_ANY_RE,
+  RISK_STRONG_RE,
+  RISK_WEAK_RE,
+  RISK_CODES,
+}
diff --git a/apps/desktop/electron/services/publish-risk.test.js b/apps/desktop/electron/services/publish-risk.test.js
index f107ebc75..f62363d45 100644
--- a/apps/desktop/electron/services/publish-risk.test.js
+++ b/apps/desktop/electron/services/publish-risk.test.js
@@ -1,7 +1,7 @@
 // @vitest-environment node
-const { isRiskBlocked } = require('./publish-risk')
+const { isRiskBlocked, classifyRisk, isRiskText } = require('./publish-risk')
 
-describe('publish-risk.isRiskBlocked', () => {
+describe('publish-risk.isRiskBlocked（兼容签名 = 强弱并集「像不像风控」）', () => {
   it('识别常见风控信号为命中', () => {
     const hits = ['触发风控，请稍后再试', 'risk control detected', '需要滑块验证', 'captcha required', '操作频繁，请 60 分钟后再试', 'code 10000015 verify', '安全验证未通过']
     for (const m of hits) expect(isRiskBlocked(m)).toBe(true)
@@ -25,3 +25,61 @@ describe('publish-risk.isRiskBlocked', () => {
     expect(isRiskBlocked({})).toBe(false)
   })
 })
+
+describe('publish-risk — fix-risk-hold-false-positive 误判面回归', () => {
+  // 旧裸子串词表会把这七类普通失败判成风控并**挂起**；现在必须连挂起资格都没有。
+  const MUST_NOT_SUSPEND = [
+    ['HTTP 601', 'Request failed with status code 601'],
+    ['ID 含 601', 'publish id 6019 not found'],
+    ['时间戳含 601', 'gateway timeout ts=1601846521'],
+    ['风控码邻居', 'errno 100000159: bad request'],
+    ['英文子串', 'infrequent login detected'],
+    ['英文普通词', 'low-risk content flagged'],
+    ['普通验证', '身份验证失败'],
+  ]
+
+  for (const [label, msg] of MUST_NOT_SUSPEND) {
+    it(label + ' ⇒ suspends=false（不得挂起）: ' + msg, () => {
+      expect(classifyRisk({ error: msg }).suspends).toBe(false)
+    })
+  }
+
+  it('守卫自身标记不构成平台信号（自触发防线仍在）', () => {
+    const v = classifyRisk({ error: 'publish blocked: risk_suspended for weixin/acc1' })
+    expect(v.hit).toBe(false)
+    expect(v.suspends).toBe(false)
+    expect(isRiskBlocked('publish blocked: risk_suspended for weixin/acc1')).toBe(false)
+  })
+
+  it('真风控仍为 strong 且允许挂起（收紧不损召回）', () => {
+    const strong = [
+      '抖音触发安全验证，请在创作者中心手动完成验证后重试（不自动换号）',
+      '抖音验证失败(110)，请手动完成验证后重试',
+      'B站风控(601)：请先在创作者中心完成滑块验证后重试',
+      '快手返回验证页/非 JSON 应答，疑似风控拦截',
+      '百家号风控拦截：您所在网络环境异常，请完成验证',
+      '检测到风控/验证弹层，已停止',
+      'canvas illegal',
+      '账号存在风险',
+    ]
+    for (const m of strong) {
+      const v = classifyRisk({ error: m })
+      expect(v.strength, m).toBe('strong')
+      expect(v.suspends, m).toBe(true)
+    }
+  })
+
+  it('结构化信号优先：无文本也判定 strong', () => {
+    expect(classifyRisk({ riskBlocked: true }).suspends).toBe(true)
+    expect(classifyRisk({ risk_blocked: true }).suspends).toBe(true)
+    expect(classifyRisk({ code: 10000015 }).suspends).toBe(true)
+    expect(classifyRisk({ code: 'BILI_RISK_601' }).suspends).toBe(true)
+    expect(classifyRisk({ code: 500, error: 'server error' }).suspends).toBe(false)
+  })
+
+  it('单一真源：桌面侧与引擎侧共用同一判定（此处断言导入的是引擎模块）', () => {
+    const engine = require('@multi-publish/api-publish-engine/src/publish/core/risk-signals')
+    expect(classifyRisk).toBe(engine.classifyRisk)
+    expect(isRiskText).toBe(engine.isRiskText)
+  })
+})
diff --git a/apps/desktop/electron/services/publisher-router.js b/apps/desktop/electron/services/publisher-router.js
index 79f15f273..06142655b 100644
--- a/apps/desktop/electron/services/publisher-router.js
+++ b/apps/desktop/electron/services/publisher-router.js
@@ -16,6 +16,9 @@ const { execFile } = require('child_process')
 const logger = require('./logger')
 // publish-frequency-policy-v2 P0-1：把「可确证未送出」的登录态族失败打标，供队列回滚间隔窗口
 const { markDefinitelyNotSent } = require('./publish-not-submitted')
+// fix-risk-hold-false-positive P0-1：抛错时把适配器已算出的结构化风控信号（code / risk_blocked）
+// 搬到 Error 上，使上层判定可以「结构化优先、文本兜底」而不是靠错误文本猜关键词。
+const { attachRiskSignals } = require('./publish-risk')
 const PlatformConfig = require('@multi-publish/shared-utils/src/platform-config')
 const { isPlatformCookieDomain } = require('@multi-publish/shared-utils/src/platform-definitions')
 const { RichTextProcessor } = require('@multi-publish/api-publish-engine/src/rich-text-processor')
@@ -594,6 +597,9 @@ class RpaVmPublisher {
       // 词表是封闭的（services/publish-not-submitted.js），未命中一律按已提交处理（保守侧）。
       const rpaErr = new Error(result.error || 'RPA 发布失败')
       markDefinitelyNotSent(rpaErr, result.error)
+      // P0-1：RPA 轨也会回传结构化风控信号（如微信/知乎轨的 code），一并搬运，
+      // 否则上层只能靠文本关键词猜 —— 猜错的代价是冻结账号。
+      attachRiskSignals(rpaErr, result)
       throw rpaErr
     } finally {
       signal?.removeEventListener('abort', onAbort)
@@ -677,7 +683,9 @@ class ApiPublisher {
       // 走到这里说明已经过了一次完整的网络往返（publishViaApi 已返回），请求是**发出去过的**；
       // 平台响应里出现「登录失效」这类文本恰恰证明请求到达了平台。把它判成「未送出」会让
       // 已提交窗口被误回滚 ⇒ 早于窗口的重复发布（危险侧）。凭证缺失在更早处已无条件打标。
-      throw new Error((result && result.error) || 'API 发布失败')
+      // fix-risk-hold-false-positive P0-1：搬运结构化风控信号（引擎 publishViaApi 抛错时
+      // 已带上；此处兜住「返回非 success 但不抛」的形态），供上层「结构化优先」判定。
+      throw attachRiskSignals(new Error((result && result.error) || 'API 发布失败'), result)
     }
     const postId = typeof result.publishId === 'string' && result.publishId.trim() ? result.publishId.trim() : ''
     if (!postId) throw new Error('发布结果缺少平台作品 ID')
@@ -722,7 +730,9 @@ class BackendPublisher {
       error: String(backendError),
       params: { platform },
     })
-    throw new Error(backendError)
+    // P0-1：后端轨同样搬运结构化信号（code 取信封码，风控标志取 data 层），
+    // 使上层判定不必退回文本匹配。
+    throw attachRiskSignals(new Error(backendError), Object.assign({ code: result.code }, result.data || {}))
   }
 }
 
diff --git a/apps/desktop/electron/services/risk-suspender-store.js b/apps/desktop/electron/services/risk-suspender-store.js
index d12110ffd..3a3446503 100644
--- a/apps/desktop/electron/services/risk-suspender-store.js
+++ b/apps/desktop/electron/services/risk-suspender-store.js
@@ -85,10 +85,14 @@ function createDesktopRiskSuspender (deps = {}) {
     raw.forEach(function (rec) {
       if (!rec || typeof rec.platform !== 'string' || !rec.platform) return
       try {
-        // 直接回填内层（不经包装方法，避免水合过程反向触发持久化）
+        // 直接回填内层（不经包装方法，避免水合过程反向触发持久化）。
+        // fix-risk-hold-false-positive：signal/strength 必须一起回填，否则重启后横幅
+        // 丢失「判定依据」显示项（记录里存了、水合时丢掉，属静默信息损失）。
         inner.suspend(rec.platform, rec.accountId, {
           reason: typeof rec.reason === 'string' ? rec.reason : 'risk_blocked',
           at: rec.at,
+          signal: typeof rec.signal === 'string' ? rec.signal : undefined,
+          strength: rec.strength === 'strong' || rec.strength === 'weak' ? rec.strength : undefined,
         })
       } catch (_) { /* 单条非法记录跳过 */ }
     })
diff --git a/apps/desktop/electron/services/risk-suspender-store.test.js b/apps/desktop/electron/services/risk-suspender-store.test.js
index 2b08a5ec1..911e4dbfc 100644
--- a/apps/desktop/electron/services/risk-suspender-store.test.js
+++ b/apps/desktop/electron/services/risk-suspender-store.test.js
@@ -50,6 +50,26 @@ describe('risk-suspender-store.createDesktopRiskSuspender', () => {
     expect(s2.listSuspended().length).toBe(2)
   })
 
+  it('fix-risk-hold-false-positive：signal/strength 随水合恢复（否则重启后横幅丢失判定依据）', () => {
+    const store = makeStore()
+    const s1 = createDesktopRiskSuspender({ store })
+    s1.suspend('weixin', 'acc1', { reason: 'risk_blocked', signal: 'strong:风控', strength: 'strong' })
+    expect(store.data[SETTING_KEY][0]).toMatchObject({ signal: 'strong:风控', strength: 'strong' })
+
+    const s2 = createDesktopRiskSuspender({ store })
+    expect(s2.listSuspended()[0]).toMatchObject({ signal: 'strong:风控', strength: 'strong' })
+  })
+
+  it('升级前的老记录（无 signal/strength）水合后不伪造判定依据', () => {
+    const store = makeStore()
+    store.data[SETTING_KEY] = [{ platform: 'wechat_mp', accountId: 'old', reason: 'risk_blocked', at: 1 }]
+    const s = createDesktopRiskSuspender({ store })
+    const rec = s.listSuspended()[0]
+    expect(rec.platform).toBe('wechat_mp')
+    expect(rec.signal).toBe(undefined)
+    expect(rec.strength).toBe(undefined)
+  })
+
   it('resume 后持久化同步更新；clear 清空并落盘', () => {
     const store = makeStore()
     const s = createDesktopRiskSuspender({ store })
diff --git a/apps/desktop/src/features/accounts/components/RiskSuspendedBanner.source.test.js b/apps/desktop/src/features/accounts/components/RiskSuspendedBanner.source.test.js
index 3d9e9ea7d..7fa906bba 100644
--- a/apps/desktop/src/features/accounts/components/RiskSuspendedBanner.source.test.js
+++ b/apps/desktop/src/features/accounts/components/RiskSuspendedBanner.source.test.js
@@ -2,6 +2,11 @@
 /**
  * RiskSuspendedBanner 源级契约（与 accounts-grid.source.test.js 同风格）：
  * 锁定消费端接线 —— 从 useRiskStore 取清单、恢复走 store.resume、文案走 i18n key（禁止硬编码中文）。
+ *
+ * fix-risk-hold-false-positive（P1-4）追加三个显示项的接线锁：
+ *   粒度（scopeAllAccounts）、检测时间（detectedAt）、判定依据（evidenceStrong/Weak），
+ *   以及平台级挂起时的标题分流（suspendedAllAccounts）。
+ * 这些断言是「显示项存在」的锁；文案真值本身由 locales 的 zh/en 成对与 Gate 7 保证。
  */
 const fs = require('fs')
 const path = require('path')
@@ -19,16 +24,49 @@ describe('RiskSuspendedBanner.vue 契约', () => {
   })
 
   it('展示/反馈文案一律走 publish.riskHold.* i18n key，不硬编码中文', () => {
-    expect(src).toMatch(/t\('publish\.riskHold\.suspended'/)
+    expect(src).toMatch(/'publish\.riskHold\.suspended'/)
+    expect(src).toMatch(/'publish\.riskHold\.suspendedAllAccounts'/)
     expect(src).toMatch(/t\('publish\.riskHold\.resume'\)/)
     expect(src).toMatch(/'publish\.riskHold\.resumed'/)
     expect(src).toMatch(/'publish\.riskHold\.resumeFailed'/)
     // 模板/脚本主体不含裸中文字符串字面量（i18n-content-sync）
-    const withoutComments = src.split(String.fromCharCode(10)).filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join(String.fromCharCode(10))
+    const withoutComments = src.split(String.fromCharCode(10)).filter((l) => !/^\s*(\/\/|\/\*|\*|<!--)/.test(l)).join(String.fromCharCode(10))
     expect(/['"`][^'"`\n]*[\u4e00-\u9fa5][^'"`\n]*['"`]/.test(withoutComments)).toBe(false)
   })
 
   it('仅在存在挂起项时渲染（v-if items.length）', () => {
     expect(src).toMatch(/v-if="items\.length"/)
   })
+
+  it('P1-4 粒度显示项：平台级挂起（accountId==null）显示「全平台账号」标签', () => {
+    expect(src).toMatch(/v-if="it\.accountId == null"/)
+    expect(src).toMatch(/'publish\.riskHold\.scopeAllAccounts'/)
+    expect(src).toMatch(/data-testid="risk-suspended-scope-all"/)
+  })
+
+  it('P1-4 标题分流：全部为平台级时用 suspendedAllAccounts，否则用 suspended', () => {
+    expect(src).toMatch(/allPlatformScope/)
+    expect(src).toMatch(/suspendedAllAccounts' : 'publish\.riskHold\.suspended'/)
+  })
+
+  it('P1-4 时间显示项：走 detectedAt + formatTime，且非法时间不渲染', () => {
+    expect(src).toMatch(/'publish\.riskHold\.detectedAt'/)
+    expect(src).toMatch(/v-if="formatTime\(it\.at\)"/)
+    expect(src).toMatch(/data-testid="risk-suspended-at"/)
+    // 非法/缺失时间必须返回空串（模板据此不渲染），不得抛错或显示 Invalid Date
+    expect(src).toMatch(/Number\.isFinite\(n\)/)
+    expect(src).toMatch(/Number\.isNaN\(d\.getTime\(\)\)/)
+  })
+
+  it('P1-4 判定依据显示项：strong/weak 两档 i18n；无 strength 的老记录不渲染（不猜结论）', () => {
+    expect(src).toMatch(/'publish\.riskHold\.evidenceStrong'/)
+    expect(src).toMatch(/'publish\.riskHold\.evidenceWeak'/)
+    expect(src).toMatch(/if \(!it \|\| !it\.strength\) return ''/)
+    expect(src).toMatch(/v-if="evidenceKey\(it\)"/)
+    expect(src).toMatch(/data-testid="risk-suspended-evidence"/)
+  })
+
+  it('P1-4 平台级提示：scope 标签 title 走 guidanceAllAccounts（而非单账号 guidance）', () => {
+    expect(src).toMatch(/'publish\.riskHold\.guidanceAllAccounts'/)
+  })
 })
diff --git a/apps/desktop/src/features/accounts/components/RiskSuspendedBanner.vue b/apps/desktop/src/features/accounts/components/RiskSuspendedBanner.vue
index b0e94a123..056c3bc28 100644
--- a/apps/desktop/src/features/accounts/components/RiskSuspendedBanner.vue
+++ b/apps/desktop/src/features/accounts/components/RiskSuspendedBanner.vue
@@ -8,7 +8,7 @@
   >
     <div class="risk-suspended-header">
       <span class="risk-suspended-title">
-        {{ t('publish.riskHold.suspended', { count: items.length, platform: platformLabel(items[0].platform) }) }}
+        {{ headerText }}
       </span>
     </div>
     <ul class="risk-suspended-list">
@@ -19,7 +19,30 @@
         data-testid="risk-suspended-item"
       >
         <span class="risk-suspended-tag">{{ platformLabel(it.platform) }}</span>
-        <span v-if="it.accountId" class="risk-suspended-account">{{ it.accountId }}</span>
+        <!-- 粒度显示项（fix-risk-hold-false-positive P1-4）：
+             平台级挂起（accountId==null）覆盖该平台全部账号，必须与账号级区分，
+             否则用户会以为只影响一个账号、解封一个后发现其他账号仍不可用。 -->
+        <span
+          v-if="it.accountId == null"
+          class="risk-suspended-scope"
+          data-testid="risk-suspended-scope-all"
+          :title="t('publish.riskHold.guidanceAllAccounts')"
+        >{{ t('publish.riskHold.scopeAllAccounts') }}</span>
+        <span v-else class="risk-suspended-account">{{ it.accountId }}</span>
+        <!-- 时间显示项：挂起是持久态（重启存活、无自动过期），必须让用户看到「什么时候挂的」 -->
+        <span
+          v-if="formatTime(it.at)"
+          class="risk-suspended-at"
+          data-testid="risk-suspended-at"
+        >{{ t('publish.riskHold.detectedAt', { time: formatTime(it.at) }) }}</span>
+        <!-- 判定依据显示项：来自主进程的封闭词表记号（strong/weak）。
+             老记录可能没有 strength（升级前持久化）—— 此时**不显示**依据标签，
+             不猜、也不兜底成「平台风控拦截」。 -->
+        <span
+          v-if="evidenceKey(it)"
+          class="risk-suspended-evidence"
+          data-testid="risk-suspended-evidence"
+        >{{ t(evidenceKey(it)) }}</span>
         <button
           type="button"
           class="risk-suspended-resume"
@@ -39,6 +62,9 @@
  * 风控挂起横幅（W1 §5 enforcement 消费端 · 账号列表锚点）
  * 订阅 useRiskStore 权威挂起清单，逐条展示并提供「恢复发布」入口。
  * 合规红线：恢复必须经人工确认（tracker.confirm），绝不自动恢复 / 自动换号。
+ *
+ * fix-risk-hold-false-positive（P1-4）新增三个显示项：粒度（全平台/单账号）、检测时间、判定依据。
+ * 文案一律走 i18n（zh/en 成对，CI Gate 7）；本文件不得出现中文字面量。
  */
 import { computed, ref } from 'vue'
 import { useI18n } from 'vue-i18n'
@@ -54,6 +80,17 @@ const busyKeys = ref(new Set())
 
 const items = computed(() => (Array.isArray(riskStore.suspended) ? riskStore.suspended : []))
 
+// 条目全部是平台级挂起时，标题换成「该平台全部账号」的说法；
+// 混合清单（既有平台级又有账号级）沿用通用说法，条目上的粒度标签负责区分。
+const allPlatformScope = computed(() =>
+  items.value.length > 0 && items.value.every((it) => it && it.accountId == null),
+)
+const headerText = computed(() => {
+  const first = items.value[0] || {}
+  const params = { count: items.value.length, platform: platformLabel(first.platform) }
+  return t(allPlatformScope.value ? 'publish.riskHold.suspendedAllAccounts' : 'publish.riskHold.suspended', params)
+})
+
 function keyOf(it) {
   return it.platform + '::' + (it.accountId == null ? '*' : it.accountId)
 }
@@ -61,6 +98,23 @@ function platformLabel(p) {
   return platformStore.getLabel(p) || p
 }
 
+/** 判定依据的 i18n key；无 strength（升级前的老记录）⇒ 返回空串，模板据此不渲染。 */
+function evidenceKey(it) {
+  if (!it || !it.strength) return ''
+  return it.strength === 'strong' ? 'publish.riskHold.evidenceStrong' : 'publish.riskHold.evidenceWeak'
+}
+
+/** 挂起时刻 → 本地短时间（HH:mm）；非法/缺失时间返回空串（模板据此不渲染）。 */
+function formatTime(at) {
+  const n = Number(at)
+  if (!Number.isFinite(n) || n <= 0) return ''
+  const d = new Date(n)
+  if (Number.isNaN(d.getTime())) return ''
+  const hh = String(d.getHours()).padStart(2, '0')
+  const mm = String(d.getMinutes()).padStart(2, '0')
+  return hh + ':' + mm
+}
+
 // 恢复：交给 riskStore.resume（内部弹人工确认框）。取消则静默保持挂起。
 async function onResume(it) {
   const k = keyOf(it)
@@ -123,6 +177,19 @@ async function onResume(it) {
   font-size: var(--font-size-xs);
   color: var(--el-text-color-secondary, #909399);
 }
+.risk-suspended-scope {
+  font-size: var(--font-size-xs);
+  padding: 0 6px;
+  border-radius: 4px;
+  color: var(--el-color-danger, #f56c6c);
+  background: var(--el-color-danger-light-9, #fef0f0);
+  border: 1px solid var(--el-color-danger-light-8, #fde2e2);
+}
+.risk-suspended-at,
+.risk-suspended-evidence {
+  font-size: var(--font-size-xs);
+  color: var(--el-text-color-secondary, #909399);
+}
 .risk-suspended-resume {
   font-size: var(--font-size-xs);
   padding: 2px 10px;
diff --git a/apps/desktop/src/locales/publish/en.js b/apps/desktop/src/locales/publish/en.js
index 3a7d90bdd..5fb381572 100644
--- a/apps/desktop/src/locales/publish/en.js
+++ b/apps/desktop/src/locales/publish/en.js
@@ -24,6 +24,7 @@ export default {
     riskHold: {
 
       suspended: 'Risk control detected. {count} publish target(s) including "{platform}" have been paused automatically. Go to the platform creator center, publish one post manually and pass the verification, then resume from the Accounts page.',
+      suspendedAllAccounts: 'Risk control detected. All accounts for "{platform}" have been paused automatically. Go to the platform creator center, publish one post manually and pass the verification, then resume from the Accounts page.',
       resumeConfirm: 'Resume publishing to "{platform}"? Make sure you have completed verification in the platform creator center (publish one post manually and pass the verification), otherwise it will pause again.',
       resumed: 'Resumed publishing to "{platform}"',
       resumeFailed: 'Failed to resume publishing: {message}',
@@ -31,5 +32,10 @@ export default {
       body: 'Risk control detected while publishing to "{platform}". Go to the platform creator center, publish one post manually and pass the verification, then lift the hold on the Accounts page.',
       badge: '⚠ Risk hold',
       guidance: 'Publishing is paused for this account due to platform risk control. Go to the platform creator center, publish one post manually and pass the verification (a verification prompt will appear during publishing), then lift the hold on the Accounts page.',
+      guidanceAllAccounts: 'Publishing is paused for all accounts of this platform due to platform risk control. Go to the platform creator center, publish one post manually and pass the verification (a verification prompt will appear during publishing), then lift the hold on the Accounts page.',
+      scopeAllAccounts: 'All accounts',
+      detectedAt: 'Detected at {time}',
+      evidenceStrong: 'Reason: platform risk control',
+      evidenceWeak: 'Reason: possible risk signal (weak)',
     },
   }
diff --git a/apps/desktop/src/locales/publish/zh.js b/apps/desktop/src/locales/publish/zh.js
index 0702d6c8c..8aeda2a73 100644
--- a/apps/desktop/src/locales/publish/zh.js
+++ b/apps/desktop/src/locales/publish/zh.js
@@ -24,6 +24,7 @@ export default {
     riskHold: {
 
       suspended: '检测到风控，「{platform}」等 {count} 个发布目标已自动暂停后续发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页手动恢复。',
+      suspendedAllAccounts: '检测到风控，「{platform}」该平台全部账号已自动暂停后续发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页手动恢复。',
       resumeConfirm: '确认恢复「{platform}」的发布？请确保已在该平台创作者中心完成验证（手动发布一篇内容并通过验证），否则会再次触发风控暂停。',
       resumed: '已恢复「{platform}」的发布',
       resumeFailed: '恢复发布失败：{message}',
@@ -31,5 +32,10 @@ export default {
       body: '检测到「{platform}」发布触发风控。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。',
       badge: '⚠ 风控挂起',
       guidance: '该账号因平台风控已暂停发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。',
+      guidanceAllAccounts: '该平台全部账号因平台风控已暂停发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。',
+      scopeAllAccounts: '全平台账号',
+      detectedAt: '检测于 {time}',
+      evidenceStrong: '判定依据：平台风控拦截',
+      evidenceWeak: '判定依据：疑似风控信号（弱）',
     },
   }
diff --git a/apps/desktop/src/services/risk-suspended-tracker.js b/apps/desktop/src/services/risk-suspended-tracker.js
index 539109245..9bb6442fe 100644
--- a/apps/desktop/src/services/risk-suspended-tracker.js
+++ b/apps/desktop/src/services/risk-suspended-tracker.js
@@ -31,7 +31,7 @@ export function createRiskSuspendedTracker(deps) {
   // onChange：清单任何变更（含清空）都回调，供响应式镜像（与仅做 UI 提示的 notify 解耦）。
   const onChange = typeof deps.onChange === 'function' ? deps.onChange : null
 
-  /** @type {Array<{platform: string, accountId: (string|null), reason: string, at: (number|null)}>} */
+  /** @type {Array<{platform: string, accountId: (string|null), reason: string, at: (number|null), signal: string, strength: (string|null)}>} */
   let suspended = []
   let unsubscribe = null
 
@@ -48,6 +48,10 @@ export function createRiskSuspendedTracker(deps) {
         accountId: x.accountId == null ? null : x.accountId,
         reason: typeof x.reason === 'string' ? x.reason : '',
         at: x.at == null ? null : x.at,
+        // fix-risk-hold-false-positive（P1-4）：signal/strength 是横幅「判定依据」显示项的来源。
+        // 若在此丢弃，主进程存了也没用 —— 属静默信息损失（与 risk-suspender-store 的 hydrate 同因）。
+        signal: typeof x.signal === 'string' ? x.signal : '',
+        strength: x.strength === 'strong' || x.strength === 'weak' ? x.strength : null,
       }))
   }
 
diff --git a/apps/desktop/src/services/risk-suspended-tracker.test.js b/apps/desktop/src/services/risk-suspended-tracker.test.js
index 965695cf3..084a15532 100644
--- a/apps/desktop/src/services/risk-suspended-tracker.test.js
+++ b/apps/desktop/src/services/risk-suspended-tracker.test.js
@@ -23,11 +23,28 @@ describe('createRiskSuspendedTracker', () => {
     const notify = vi.fn()
     const t = createRiskSuspendedTracker({ onRiskSuspended, notify })
     const out = t.handle({ suspended: [{ platform: 'weixin', accountId: 'a1', reason: 'risk_blocked' }] })
-    expect(out).toEqual([{ platform: 'weixin', accountId: 'a1', reason: 'risk_blocked', at: null }])
+    expect(out).toEqual([{ platform: 'weixin', accountId: 'a1', reason: 'risk_blocked', at: null, signal: '', strength: null }])
     expect(t.list()).toHaveLength(1)
     expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'suspended', count: 1 }))
   })
 
+  it('P1-4 规整保留 signal/strength（横幅「判定依据」显示项的数据来源）', () => {
+    const { onRiskSuspended } = fakeSubscribe()
+    const t = createRiskSuspendedTracker({ onRiskSuspended, notify: vi.fn() })
+    const out = t.handle({
+      suspended: [
+        { platform: 'weixin', accountId: 'a1', reason: 'risk_blocked', at: 123, signal: 'strong:风控', strength: 'strong' },
+        // 非法 strength 归一为 null（不得把任意字符串透给 UI 当依据）
+        { platform: 'douyin', accountId: null, strength: 'bogus' },
+        // 升级前的老记录：无 signal/strength → 空值，UI 据此不渲染依据标签
+        { platform: 'zhihu', accountId: 'z1' },
+      ],
+    })
+    expect(out[0]).toMatchObject({ signal: 'strong:风控', strength: 'strong' })
+    expect(out[1]).toMatchObject({ signal: '', strength: null })
+    expect(out[2]).toMatchObject({ signal: '', strength: null })
+  })
+
   it('空清单广播替换后不触发 suspended 提示', () => {
     const { onRiskSuspended } = fakeSubscribe()
     const notify = vi.fn()
@@ -43,7 +60,7 @@ describe('createRiskSuspendedTracker', () => {
     const { onRiskSuspended } = fakeSubscribe()
     const t = createRiskSuspendedTracker({ onRiskSuspended, notify: vi.fn() })
     const out = t.handle({ suspended: [{ platform: 'weixin' }, { accountId: 'x' }, null, 'str'] })
-    expect(out).toEqual([{ platform: 'weixin', accountId: null, reason: '', at: null }])
+    expect(out).toEqual([{ platform: 'weixin', accountId: null, reason: '', at: null, signal: '', strength: null }])
   })
 
   it('isSuspended：平台级覆盖所有账号，细粒度仅命中该账号', () => {
diff --git a/openspec/changes/fix-risk-hold-false-positive/design.md b/openspec/changes/fix-risk-hold-false-positive/design.md
new file mode 100644
index 000000000..906740c86
--- /dev/null
+++ b/openspec/changes/fix-risk-hold-false-positive/design.md
@@ -0,0 +1,92 @@
+# Design — fix-risk-hold-false-positive
+
+## 1. 决策记录
+
+### D1：判定顺序 = 结构化标志 → 码族 → 文本（而非「文本优先，结构化兜底」）
+
+**选它**：结构化信息是发布链**已经算出来**的结论（适配器读了响应头/状态码），文本是人类可读的副产品。让副产品覆盖结论，等于用最不可靠的输入决策最贵的动作（冻结账号）。
+
+**否决的备选**：`文本命中即挂起，结构化只用于补充诊断`。这正是修复前的实际行为，也是本次误判的直接成因。
+
+**代价**：需要打通 `Error` → `task` 的信号搬运（7 处接线）。**接受**：不搬就等于「结构化优先」只是一句注释。
+
+### D2：文本词表分强弱，弱信号**既不挂起也不提示**（而不是「弱信号挂起但提示弱」）
+
+**选它**：`publish:risk-hold` IPC 的唯一消费端会弹「检测到风控」toast。弱信号命中率高（`身份验证失败` 这类日常失败都会命中），发出去等于把「风控」标签贴到普通失败上——**提示本身也是一次误报**。
+
+**否决的备选 A**：`弱信号走独立文案（如「疑似风控信号，已跳过自动暂停」）`。否决理由：这类提示对用户**不可行动**（他既不用去创作者中心，也不需要做任何事），只在每次登录失效时增加噪音。失败原因仍可在进度条与发布历史看到平台原文。
+
+**否决的备选 B**：`弱信号挂起账号级（只不挂平台级）`。否决理由：`身份验证失败` 会冻结账号，用户仍要人工解封——误判代价没有实质下降。
+
+**风险**：真实风控若只用「验证」措辞且**不带结构化标志**，会被漏掉。缓解：附录 B 逐条核对了仓内全部真实风控来源，全部落在强档；抖音只带裸「验证」的那条文案（`验证失败(110)`）已显式收入强档。
+
+### D3：数字与英文词加边界，但**下划线算边界**
+
+**选它**：`(?<![A-Za-z0-9])risk(?![A-Za-z0-9])` 让 `BILI_RISK_601` 命中而 `derisk` 不命中。若用 `\brisk\b`，`_` 是词字符 ⇒ `BILI_RISK_601` / `risk_suspended` **反而匹配不上**，会破坏既有能力。
+
+**代价**：`risk_suspended` 会被弱档命中 ⇒ 另加显式排除（见 D4）。
+
+### D4：`risk_suspended` 的排除放在判定函数，而非裸正则
+
+**选它**：裸正则只表达「词表里有这个词」，语义判定（「这是不是平台信号」）在函数里。桌面侧另有 `isRiskSuspendedMessage` 双保险，两层职责清晰。已加锁钉住这个分工（测试断言 `RISK_ANY_RE` 命中而 `isRiskText` 不命中）。
+
+### D5：`601` 留在弱档而不是删除
+
+**选它**：真实 B站风控文案含「风控」「滑块验证」（强档已覆盖），码族路径也覆盖 `code:601`；裸 `601` 与 HTTP 状态码/ID/时间戳无法区分 ⇒ 留在弱档保留「像风控」语义（路由仍停报不降级），但不挂起。
+
+**否决**：直接删掉 `601`。理由：会使 `outcomeOfResult` 对只带文本 `601` 的历史夹具失去风控语义，且丢掉了「可能是风控」这一信息。
+
+### D6：`accountId` 解析加 `task.accountId` 兜底
+
+**选它**：`task-queue.add()` 已把账号归一为任务级字段（`task.accountId ?? task.article?.accountId ?? null`），而 `phase4-events` 此前只读 `task.article.accountId`。补上兜底能减少「误升平台级」这一放大器的触发概率。
+
+**保留**：强信号 + 无账号仍是平台级挂起（真实风控下宁可多拦）。
+
+### D7：判定依据只存**封闭词表记号**，不存原始错误文本
+
+**选它**：`signal`/`strength` 要持久化到 store 并跨进程广播到渲染层，平台回包原文可能含会话片段。记号码表 + 64 字符截断，既满足「用户能看到凭什么挂起」，又不把平台原文落盘。
+
+**代价**：用户看不到具体是哪条错误。**接受**：发布历史里已有 `error` 原文（`status:'failed'` + `error`），需要时从那里查。
+
+### D8：新建 `risk-hold-guard` 能力规格，而不是塞进既有能力
+
+**选它**：`openspec/specs/` 里没有任何一份规格描述过「什么信号可以挂起、挂到什么粒度」。既有实现散落在 W1 各切片文档与代码注释里 —— 这个缺口正是本次误判能长期存活的土壤。
+
+## 2. 数据流
+
+```
+适配器/链                     结构化结论（risk_blocked / code）
+   │
+   ▼
+publishViaApi / publisher-router     attachRiskSignals(err, result)
+   │  Error{message, code, riskBlocked}
+   ▼
+task-queue  catch                    task.error / task.errorCode / task.riskBlocked
+   │
+   ▼
+phase4-events  task:failed           classifyRisk({error, code, riskBlocked})
+   │                                   → {hit, strength, signal, suspends}
+   ├─ suspends ──► riskSuspender.suspend(platform, accountId, {reason, error, signal, strength})
+   │                  → persist('publish.riskSuspended')   [signal 截断 64、strength 白名单]
+   │                  → 广播 publish:risk-suspended
+   │                       → tracker.normalize（保留 signal/strength）
+   │                            → useRiskStore.suspended
+   │                                 → RiskSuspendedBanner（4 个显示项）
+   └─ 非 suspends ─► 仅 WARN 日志 weak-signal-not-suspended
+```
+
+## 3. 风险与回退
+
+| 风险 | 影响 | 缓解 | 回退 |
+|---|---|---|---|
+| 真实风控只用弱措辞且无结构化标志 | 漏挂起，账号继续撞风控 | 附录 B 逐条核对，全部真实来源在强档；抖音 110 文案已显式收入强档 | 把该措辞从弱档移入强档（单点改动） |
+| 结构化信号搬运在某条链上漏接线 | 该链退回文本判定 | task-queue 集成测试 + task 上字段缺省值锁；phase4 直接读 task 字段 | 修对应发布器的 `attachRiskSignals` 调用 |
+| `signal` 落盘引入敏感信息 | 隐私 | 只存封闭词表记号 + 64 字符截断 + 白名单校验；原始 `error` 不入记录 | 清空 store 键 `publish.riskSuspended` |
+| 弱档收紧后用户不再收到风控提示 | 用户不知道去验证 | 强档仍弹 `body`/`suspended` 两个 toast + 横幅 | 调 `RISK_WEAK_RE` |
+| 旧记录无 `strength` 导致横幅少一行 | 显示项缺失 | 明确「不猜」，仅少一个标签；时间与粒度照常显示 | 无（有意行为） |
+
+## 4. 未闭环 / 遗留
+
+- **真机端到端验收**：本机无可用公众号/抖音等风控触发会话，**「真实风控命中 → 挂起 → 横幅 → 人工恢复」全链真机回归未做**。本次验收边界为单元 + 集成层（含变异反证）。
+- **`publisher-router.js` 回退文案的编码损坏**（`'鍙戝竷澶辫触'`）本次**刻意未修**（属另一议题，避免无关 churn），已在 record 中登记。
+- **弱信号的可观测性**：弱信号只进日志，设置页/诊断页暂无可视化入口；如需排查「为什么这次没暂停」，需查日志。
diff --git a/openspec/changes/fix-risk-hold-false-positive/proposal.md b/openspec/changes/fix-risk-hold-false-positive/proposal.md
new file mode 100644
index 000000000..2499b7197
--- /dev/null
+++ b/openspec/changes/fix-risk-hold-false-positive/proposal.md
@@ -0,0 +1,52 @@
+# fix-risk-hold-false-positive：风控挂起误判修复（结构化优先 + 强弱分档 + 粒度收敛）
+
+## Why
+
+用户报障：账号管理页出现「检测到风控，「微信公众号」等 1 个发布目标已自动暂停后续发布…」，但在平台侧并没有任何验证弹层，且该平台后续发布被真的挡住，必须逐条手动恢复。
+
+根因两条，互为放大镜：
+
+1. **结构化风控信号被丢在半路**。各链其实已经算出结构化结论（抖音 `risk_blocked` 标志、B站 `code:601`、百家号 `code:10000015`、快手 `risk_blocked`、小红书 `XHS_RISK_BLOCKED`），但传输层一律 `throw new Error(result.error)`（`api-publish-engine/src/index.js` 的 `publishViaApi`、桌面 `publisher-router.js` 的三个发布器），`Error` 上只剩 `message`。上层因此**只能**用错误文本猜关键词。
+
+2. **词表无边界且不分强弱**。`/风控|risk|滑块|601|10000015|frequent|频繁|verify|验证|…/i` 是裸子串匹配，实测把 7 类普通失败判成风控（`status code 601`、`id 6019`、`ts=1601846521`、`errno 100000159`、`infrequent login`、`low-risk content`、`身份验证失败`）。
+
+**放大器**：`accountId` 缺失时自动降级为平台级挂起（覆盖该平台**所有**账号），而 `phase4-events` 只从 `task.article?.accountId` 取账号 —— 「一次误判 + 没带账号」= 整平台停摆。
+
+**为什么必须修（代价不对称）**：误判把用户引向「去创作者中心手动发一篇完成验证」——那里根本不会弹验证；挂起态持久化、重启存活、无自动过期；期间该平台所有发布零请求被拦（`RiskSuspendedError` + `noRetry`）。这与仓内既有纪律一致（小红书 DOM 轨早已删掉裸「滑块/验证码」并留下「误判比漏判更有害」注释）。
+
+## What Changes
+
+- **新增单一真源** `packages/api-publish-engine/src/publish/core/risk-signals.js`：
+  - `classifyRisk({error, code, riskBlocked, risk_blocked})` → `{hit, strength, signal, suspends}`；
+  - 判定顺序 **结构化标志 → 平台风控码族 → 文本兜底**；
+  - 文本词表**分强弱**：强档（风控/滑块/安全验证/验证弹层/操作频繁/captcha/canvas illegal/账号存在风险/risk control/BILI_RISK/`验证失败(110)`/`10000015`）允许挂起；弱档（裸 验证/频繁/risk/frequent/verify/601）只提示不挂起；
+  - **加边界**：数字用 `(?<!\d)…(?!\d)`，英文词用标识符边界（`_` 算边界）；
+  - 排除自身守卫标记 `risk_suspended`；
+  - `suspends ⇔ (hit && strength==='strong')` 作为不变量由本模块给出，调用方不得自行推导。
+- **收敛两处已漂移的 `RISK_RE`**：`publish-mode-runner.js` 与桌面 `publish-risk.js` 改为 require 同一模块（桌面保留兼容签名 `isRiskBlocked`）。
+- **打通结构化信号搬运**：`api-publish-engine/src/index.js`、桌面 `publisher-router.js`（新增 `attachRiskSignals`）在抛错时保留 `code`/`riskBlocked`/`loginExpired`；`shared-utils/task-queue.js` 失败时把它们落到 `task.errorCode` / `task.riskBlocked`。
+- **挂起决策加三原则**（`phase4-events.js`）：结构化优先、弱信号不挂起也不提示（只留结构化日志）、`accountId` 改为 `article.accountId || task.accountId || null` 以免误升平台级。引擎 `publish-mode-runner.js` 的挂起点同样加强弱闸门。
+- **挂起记录携带判定依据**：`risk-suspender.js` 的 rec 增加 `signal`（封闭词表记号，≤64 字符）与 `strength`（白名单校验）；桌面 store 水合与渲染层 `normalize` 一并透传。
+- **横幅新增三个显示项**：粒度标签（全平台账号 / 单账号）、检测时间（`HH:mm`）、判定依据（strong/weak，无值时不渲染）；标题在全平台级时分流到 `suspendedAllAccounts`。
+- **i18n 新增 5 个 key**（zh/en 成对）：`suspendedAllAccounts`、`scopeAllAccounts`、`detectedAt`、`evidenceStrong`、`evidenceWeak`、`guidanceAllAccounts`。
+- **测试**：新增 `risk-signals.test.js`（45 例）、桌面 `publish-risk.test.js` 扩展（15 例）、`phase4-events.test.js` 新增 11 例、`task-queue.test.js` 新增 3 例（含变异反证）。
+
+## Impact
+
+- **Affected specs**：新增能力 `risk-hold-guard`（见 `specs/risk-hold-guard/spec.md`）
+- **Affected code**：
+  - `packages/api-publish-engine/src/publish/core/risk-signals.js`（新）
+  - `packages/api-publish-engine/src/publish/core/publish-mode-runner.js`
+  - `packages/api-publish-engine/src/publish/core/risk-suspender.js`
+  - `packages/api-publish-engine/src/index.js`
+  - `packages/shared-utils/src/task-queue.js`
+  - `apps/desktop/electron/services/publish-risk.js`
+  - `apps/desktop/electron/services/publisher-router.js`
+  - `apps/desktop/electron/services/risk-suspender-store.js`
+  - `apps/desktop/electron/bootstrap/phase4-events.js`
+  - `apps/desktop/src/services/risk-suspended-tracker.js`
+  - `apps/desktop/src/features/accounts/components/RiskSuspendedBanner.vue`
+  - `apps/desktop/src/locales/publish/{zh,en}.js`
+- **不涉及**：`platforms.yaml`、IPC 通道契约、preload 键数、数据库 schema、任何自动恢复/自动换号逻辑（合规红线不变）
+- **QM-1**：改 `apps/desktop/electron/**` ⇒ 需本地打包验证
+- **风险与回退**：见 design.md「风险与回退」
diff --git a/openspec/changes/fix-risk-hold-false-positive/specs/risk-hold-guard/spec.md b/openspec/changes/fix-risk-hold-false-positive/specs/risk-hold-guard/spec.md
new file mode 100644
index 000000000..87ec39d76
--- /dev/null
+++ b/openspec/changes/fix-risk-hold-false-positive/specs/risk-hold-guard/spec.md
@@ -0,0 +1,145 @@
+# Delta Spec: risk-hold-guard
+
+> 能力来源：本次 change 新建。既有实现散落在 `api-publish-engine` 的 W1 §5 切片与桌面 enforcement 切片，
+> 但**从没有一份规格**把「什么信号可以挂起、挂到什么粒度、界面凭什么展示」写成可验收的契约 ——
+> 本次误判正是这个缺口的下游后果。
+
+## ADDED Requirements
+
+### Requirement: 风控判定必须结构化优先
+
+风控判定 SHALL 按固定顺序取值：**① 调用方显式 `risk_blocked` 标志 → ② 平台风控码族 → ③ 错误文本词表**。前两级命中时，错误文本 MUST NOT 参与判定（不得因文案措辞差异推翻已确定的结构化结论）。
+
+判定结果 SHALL 为四字段对象 `{hit, strength, signal, suspends}`；`signal` SHALL 取自封闭词表记号（`flag` / `code:<码>` / `strong:<词>` / `weak:<词>`），MUST NOT 是原始错误全文。
+
+#### Scenario: 文本无害但结构化标志命中
+
+- **WHEN** 发布结果的错误文本是「网络超时」但适配器已置 `risk_blocked: true`
+- **THEN** 判定为 `{hit:true, strength:'strong', signal:'flag', suspends:true}`，文本不参与
+
+#### Scenario: 平台风控码族命中
+
+- **WHEN** 结果携带 `code` 为 `BILI_RISK_601` / `601` / `10000015` / `-1e7` / `RISK_BLOCKED` 之一
+- **THEN** 判定为 `strength:'strong'` 且 `suspends:true`，`signal` 形如 `code:<码>`
+
+#### Scenario: 非风控码不构成信号
+
+- **WHEN** 结果携带 `code: 500` 且错误文本为「服务异常请稍后重试」
+- **THEN** 判定为 `hit:false`、`suspends:false`
+
+### Requirement: 文本词表必须加边界并分强弱
+
+文本兜底词表 SHALL 分两档：**强信号**（平台风控专属措辞，允许挂起）与**弱信号**（宽泛词，只提示不挂起）。数字记号 SHALL 使用数字边界 `(?<!\d)…(?!\d)`；英文记号 SHALL 使用标识符边界 `(?<![A-Za-z0-9])…(?![A-Za-z0-9])`（下划线算边界，故 `BILI_RISK_601` 可命中，而 `derisk` / `infrequent` / `verified` 不命中）。
+
+**强信号** SHALL 至少覆盖：`风控`、`滑块`、`安全验证`、`验证弹层`、`操作频繁`、`captcha`、`canvas illegal`、`账号存在风险`、`risk control`、`risk_blocked`、`riskBlocked`、`RISK_BLOCKED`、`BILI_RISK`、`验证失败(110)`、`10000015`（带数字边界）。
+
+**弱信号** SHALL 至少覆盖：`验证`、`频繁`、`risk`、`frequent`、`verify`、`601`（后四者带边界）。
+
+判定 MUST 排除自身守卫标记 `risk_suspended`（自触发防线）。
+
+#### Scenario: 误判面回归（修复前会挂起、修复后不得挂起）
+
+- **WHEN** 错误文本为以下任一：`Request failed with status code 601`、`publish id 6019 not found`、`gateway timeout ts=1601846521`、`errno 100000159: bad request`、`infrequent login detected`、`low-risk content flagged`、`身份验证失败`
+- **THEN** `suspends === false`（其中 A2–A5 连 `hit` 都为 false，A1/A6/A7 为 `weak`）
+
+#### Scenario: 真风控召回不回归
+
+- **WHEN** 错误文本为抖音 `抖音触发安全验证…` / `抖音验证失败(110)…`、B站 `B站风控(601)…`、快手 `快手返回验证页…疑似风控拦截…`、百家号 `百家号风控拦截…`、小红书 `检测到风控/验证弹层，已停止`、`canvas illegal`、`账号存在风险` 之一
+- **THEN** `strength === 'strong'` 且 `suspends === true`
+
+### Requirement: suspends 不变量由单一真源给出
+
+`risk-signals` SHALL 导出不变量 `suspends ⇔ (hit && strength === 'strong')`。所有消费方（桌面 `phase4-events`、引擎 `publish-mode-runner`）MUST 读取 `suspends` 决定是否挂起，**MUST NOT** 自行由 `hit` 或词表推导。
+
+#### Scenario: 弱信号永不挂起
+
+- **WHEN** 任意判定结果的 `strength === 'weak'`
+- **THEN** 其 `suspends` 恒为 `false`
+
+### Requirement: 词表为单一真源，禁止双份漂移
+
+风控词表与判定逻辑 SHALL 只存在于 `packages/api-publish-engine/src/publish/core/risk-signals.js`。桌面 `apps/desktop/electron/services/publish-risk.js` SHALL 复用该模块（可保留兼容签名），MUST NOT 再维护第二份词表。需要「像不像风控」的并集判据 SHALL 使用 `isRiskText` / `RISK_ANY_RE`，与「是否允许挂起」区分开。
+
+#### Scenario: 两侧同一函数引用
+
+- **WHEN** 桌面侧导入 `classifyRisk`
+- **THEN** 它与引擎 `risk-signals` 导出的 `classifyRisk` 是同一个函数引用（不是复制实现）
+
+#### Scenario: 路由与挂起是两件事
+
+- **WHEN** 错误文本仅命中弱信号（如 `抖音安全 verify 拦截`）
+- **THEN** 路由判据 `isRiskText` 为 `true`（API 轨命中仍停报不降级），而 `suspends` 为 `false`（不挂起账号）
+
+### Requirement: 挂起粒度与账号解析
+
+挂起决策 SHALL 遵循：**强信号 + 有账号 ⇒ 账号级**；**强信号 + 无账号 ⇒ 平台级**（覆盖该平台所有账号）；**弱信号或未命中 ⇒ 不挂起（任意账号维度）**。
+
+账号解析 SHALL 优先 `task.article.accountId`，其次任务级归一字段 `task.accountId`，两者皆空才是 `null`。
+
+#### Scenario: 弱信号 + 无账号不降级平台级
+
+- **WHEN** 任务无任何账号字段，错误文本为「请先完成实名验证」（弱信号）
+- **THEN** 零挂起、零 `publish:risk-suspended` 广播、零 `publish:risk-hold` IPC
+
+#### Scenario: 强信号 + 无账号仍平台级
+
+- **WHEN** 任务无任何账号字段，错误文本为「账号存在风险，请前往创作者中心发布作品」
+- **THEN** 挂起键为 `platform::*`（覆盖全平台）
+
+#### Scenario: 任务级账号兜底避免误升平台级
+
+- **WHEN** `task.article` 无 `accountId` 但 `task.accountId` 为 `acc-task`，文本为强信号
+- **THEN** 挂起键为 `platform::acc-task`（账号级），不是平台级
+
+### Requirement: 结构化风控信号必须跨传输层保全
+
+发布链计算出的 `code` 与 `risk_blocked` 标志 SHALL 随错误一路传到风控判定点：引擎 `publishViaApi` 与桌面三个发布器抛错时 SHALL 把 `code`/`riskBlocked`/`loginExpired` 挂到 `Error` 上；`task-queue` 捕获时 SHALL 落到 `task.errorCode` / `task.riskBlocked`（`errorCode` 缺省为 `null`，`riskBlocked` 缺省为 `false`，MUST NOT 留 `undefined`）。`risk_blocked` 下划线形态 SHALL 同样被识别。
+
+#### Scenario: 结构化信号到达判定点
+
+- **WHEN** 执行器抛出的 `Error` 携带 `code='BILI_RISK_601'` 与 `riskBlocked=true`
+- **THEN** `task:failed` 的 task 上 `errorCode === 'BILI_RISK_601'` 且 `riskBlocked === true`，后续判定走结构化优先路径
+
+### Requirement: 挂起记录携带可展示的判定依据
+
+挂起记录 SHALL 在 `{platform, accountId, reason, at}` 之外可选携带 `signal`（非空字符串，SHALL 截断至 ≤64 字符）与 `strength`（SHALL 仅接受 `'strong'` / `'weak'`，其它值 MUST NOT 写入）。记录 MUST NOT 携带原始错误全文。
+
+`signal`/`strength` SHALL 在持久化、水合与渲染层归一三处均不丢失。升级前无这两个字段的旧记录 SHALL 保持缺失（UI 据此不渲染依据项，MUST NOT 猜测或兜底成强档）。
+
+#### Scenario: 重启后依据不丢
+
+- **WHEN** 以 `{signal:'strong:风控', strength:'strong'}` 挂起后，用新实例重新水合同一 store
+- **THEN** 恢复出的记录仍含 `signal:'strong:风控'` 与 `strength:'strong'`
+
+#### Scenario: 非法 strength 不落库
+
+- **WHEN** 以 `strength:'bogus'` 调用 `suspend`
+- **THEN** 记录中不含 `strength` 字段（渲染层据此不显示依据）
+
+#### Scenario: 旧记录不伪造依据
+
+- **WHEN** store 中是升级前的 `{platform, accountId, reason, at}`
+- **THEN** 水合后 `signal`/`strength` 为 `undefined`，横幅不渲染判定依据项
+
+### Requirement: 风控横幅的显示项与粒度表达
+
+账号页风控横幅 SHALL 逐条展示：平台名、**粒度标签**（`accountId == null` ⇒ 「全平台账号」，否则显示账号）、**检测时间**（`at` 合法时按本地 `HH:mm`）、**判定依据**（`strength` 存在时显示 strong/weak 对应文案，缺失时不渲染该显示项）、恢复按钮。
+
+标题 SHALL 分流：清单**全部**为平台级挂起时用 `publish.riskHold.suspendedAllAccounts`，否则用 `publish.riskHold.suspended`。清单为空时 SHALL 整块不渲染。
+
+恢复 SHALL 经人工确认（`confirm` 缺省拒绝），MUST NOT 存在自动恢复/自动换号路径。
+
+#### Scenario: 平台级与账号级可区分
+
+- **WHEN** 挂起清单含一条 `accountId == null` 与一条 `accountId == 'acc-1'` 的记录
+- **THEN** 前者渲染「全平台账号」粒度标签（title 为 `guidanceAllAccounts`），后者渲染账号名；标题用通用文案
+
+#### Scenario: 时间与依据缺省时不渲染
+
+- **WHEN** 记录 `at` 非法或缺失、且无 `strength`
+- **THEN** 时间与判定依据两个显示项都不渲染（不得出现 `Invalid Date` 或猜测的结论）
+
+#### Scenario: 恢复必须人工确认
+
+- **WHEN** 用户点击「恢复发布」但在确认框中取消
+- **THEN** 返回 `{ok:false, reason:'cancelled'}`，挂起态不变、无任何 IPC 调用
diff --git a/openspec/changes/fix-risk-hold-false-positive/tasks.md b/openspec/changes/fix-risk-hold-false-positive/tasks.md
new file mode 100644
index 000000000..f57e71c50
--- /dev/null
+++ b/openspec/changes/fix-risk-hold-false-positive/tasks.md
@@ -0,0 +1,75 @@
+# Tasks — fix-risk-hold-false-positive
+
+> 真机边界：本机无可用公众号/抖音等**真实风控触发会话**，「真实风控命中 → 挂起 → 横幅 → 人工恢复」全链真机回归**未做**（见 design.md §4）。本次验收边界为单元 + 集成层，含变异反证。
+
+## 1. 复现与根因取证（QM-5 ①）
+
+- [x] 读码取证：判定只吃文本 —— `phase4-events.js` 只拿到 `task.error`（旧 L236 `isRiskBlocked(task.error)`）
+- [x] 读码取证：结构化信号被丢弃 —— `api-publish-engine/src/index.js` 旧 L95 与 `publisher-router.js` 三个发布器均 `throw new Error(result.error)`
+- [x] 读码取证：词表无边界 —— 旧 `RISK_RE` 含裸 `601` / `10000015` / `risk` / `frequent` / `verify` / `验证`
+- [x] 实测取证 A1–A7：7 类普通失败文案在旧词表下全部命中（附录 A）
+- [x] 实测取证：`accountId` 缺失 ⇒ `isSuspended` 对该平台全部账号为真（一次无账号失败冻结整平台）
+- [x] 实测取证：全仓发布链 674 文件扫描，确认误判面来自**外部平台/网关错误文本**而非仓内字面量
+- [x] 读码取证：两处 `RISK_RE` 已漂移（桌面多 `安全验证|操作频繁|captcha`，注释仍写「保持同义」）
+- [ ] 真机复现：用运行中的应用触发一次真实风控并观察横幅（无会话，**PENDING**）
+
+## 2. 契约层（先测试后实现）
+
+- [x] `packages/api-publish-engine/test/risk-signals.test.js`：45 例（结构化优先 / 误判面 / 真风控召回 / suspends 不变量 / 边界与并集）
+- [x] 登记 `risk-signals.test.js` 进 `scripts/run-tests.js` 的 `VITEST_FILES`（引擎 direct 组无 `describe` 全局，不登记即 `ReferenceError`）
+- [x] `apps/desktop/electron/services/publish-risk.test.js`：扩到 15 例（兼容签名 + 误判面 + 结构化优先 + 单一真源同引用断言）
+- [x] `packages/api-publish-engine/src/publish/core/risk-signals.js`：`classifyRisk` / `isRiskText` / 三个正则 / `RISK_CODES`
+
+## 3. 接线（结构化信号搬运链路）
+
+- [x] 引擎 `src/index.js`：`publishViaApi` 抛错保留 `code` / `riskBlocked` / `loginExpired`
+- [x] 桌面 `publisher-router.js`：新增 `attachRiskSignals`，接入 `RpaPublisher` / `ApiPublisher` / `BackendPublisher`
+- [x] `shared-utils/task-queue.js`：失败时落 `task.errorCode`（缺省 `null`）/ `task.riskBlocked`（缺省 `false`）
+- [x] 桌面 `phase4-events.js`：判定改 `classifyRisk({error, code, riskBlocked})`，按 `suspends` 分流
+
+## 4. 判定与粒度（P0-2 / P1-3）
+
+- [x] 两处 `RISK_RE` 收敛为单一真源（`publish-mode-runner.js` 与 `publish-risk.js` 均 require `risk-signals`）
+- [x] `publish-mode-runner.js` 挂起点加强弱闸门（弱信号停报但**不挂起**，另记 WARN）
+- [x] `phase4-events.js`：弱信号不挂起、不广播、不发 IPC，仅结构化日志 `weak-signal-not-suspended`
+- [x] `accountId` 解析加 `task.accountId` 兜底；弱信号 + 无账号零挂起；强信号 + 无账号仍平台级
+
+## 5. 记录与显示项（P1-4）
+
+- [x] `risk-suspender.js`：rec 增加 `signal`（≤64 截断）与 `strength`（白名单）；不落原始错误文本
+- [x] 桌面 `risk-suspender-store.js`：水合透传 `signal`/`strength`（旧记录不伪造）
+- [x] 渲染层 `risk-suspended-tracker.js`：`normalize` 保留 `signal`/`strength`（非法值归一 `null`）
+- [x] `RiskSuspendedBanner.vue`：粒度标签 / 检测时间 / 判定依据三个显示项 + 标题分流
+- [x] `publish/{zh,en}.js`：5 个新 key 成对（`suspendedAllAccounts` / `scopeAllAccounts` / `detectedAt` / `evidenceStrong` / `evidenceWeak` / `guidanceAllAccounts`）
+
+## 6. 变异反证（已实跑）
+
+- [x] M1 `task-queue` 的两个赋值改成 no-op ⇒ `Tests 2 failed | 35 passed (37)`（新增 3 例中 2 例立红）
+- [x] 恢复后 ⇒ `Tests 37 passed (37)`
+- [x] 反证纪律：只证「业务改动变红」不算，必须证「把锁本身改成 no-op 立红」—— M1 即此，已确认
+
+## 7. 测试执行记录（实测数字）
+
+| 范围 | 命令 | 结果 |
+|---|---|---|
+| 引擎全量 | `cd packages/api-publish-engine && node scripts/run-tests.js` | 379 passed / 40 files + direct 组全通过 |
+| shared-utils 全量 | `cd packages/shared-utils && pnpm run test` | 844 passed / 10 skipped / 41 files |
+| 桌面受影响 6 文件 | `cd apps/desktop && pnpm exec vitest run <6 files>` | 171 passed |
+
+## 8. 文档与证据
+
+- [x] `01-docs/PRD-RISK-HOLD-MISJUDGE-FIX-2026-10-13.md`（数据校验 / 流程 / 功能逻辑 / 交互 / 显示项 / 提示文字 / 边界 / 验收 + 附录 A、B）
+- [x] `openspec/changes/fix-risk-hold-false-positive/`（proposal / design / specs / tasks）
+- [x] `openspec/records/fix-risk-hold-false-positive.md`
+- [x] `CHANGELOG.md`
+- [x] `.quality-gates.md` 本次执行记录
+- [x] 三类记忆：内置 `01-docs/learnings.md`、外部 `~/.gstack/projects/multi-publish/learnings.jsonl`、EverOS `~/.everos/multi-publish/learnings-2026-10-13-*.md`
+
+## 9. 门禁
+
+- [x] `pre-code-edit-guard.ps1` exit 0（隔离 worktree）
+- [x] eslint（`apps/desktop` `pnpm run lint`）
+- [x] locale 成对 + CJK 基线（Gate 7）
+- [x] QM-1 本地打包
+- [x] QM-2 代码审查必检项
+- [ ] 远程同步（PR 合并后回填）
diff --git a/openspec/records/fix-risk-hold-false-positive.md b/openspec/records/fix-risk-hold-false-positive.md
new file mode 100644
index 000000000..bf4492d46
--- /dev/null
+++ b/openspec/records/fix-risk-hold-false-positive.md
@@ -0,0 +1,49 @@
+---
+record: fix-risk-hold-false-positive
+task: 风控挂起误判修复——结构化信号优先 + 词表加边界并分强弱 + 挂起粒度收敛 + 横幅显示项
+date: 2026-10-13
+sync_reason: 本 PR 尚未合并，无法取证 merge SHA；合并后由后续 docs 回填 PR 把「远程同步」行由 PENDING 改写为 PASS + merge SHA，并删除本三字段
+sync_backfill_owner: fix-risk-hold-false-positive 会话（或后续 docs 回填 PR）
+---
+
+## 本次执行记录：风控挂起误判修复（fix-risk-hold-false-positive，2026-10-13）【混合 PR】
+
+- **变更类型**：运行时代码（`packages/api-publish-engine/**`、`packages/shared-utils/**`、`apps/desktop/electron/**`、`apps/desktop/src/**`）+ 文档 ⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-fix-risk-hold-false-positive`（D 盘，非 C 盘），裸分支 `fix-risk-hold-false-positive`（基线 `origin/main`）。
+- **本 PR 不是 docs-only**：含运行时代码，`classify-docs-only.js` → false ⇒ 完整质量节拍。
+- **共享根保持 main clean**：任务全程只在 worktree 落盘；`pre-code-edit-guard.ps1` exit 0；写保护 `Session Isolation Write Guard` = Running。
+- **受管行数文件**：本次初版改动把 `apps/desktop/electron/services/publisher-router.js` 顶破台账容差被 `check-max-lines.js` 判红（`LEDGER_GREW … 629 膨胀 209 行（容差 200）`）。处置：把 `attachRiskSignals` 从该文件移回风控模块 `publish-risk.js`（同时更内聚），该文件改动从 33 行降到 14 行，复跑 PASS。
+
+| 门禁 | 状态 | Fresh 证据 |
+|------|------|-----------|
+| 变更类型与隔离 | PASS | worktree `mp-fix-risk-hold-false-positive`（D 盘）+ 裸分支 `fix-risk-hold-false-positive`；`verify-worktree-deps.js` OK（11 消费方 / 9 workspace 包解析到本 worktree）；`pre-code-edit-guard.ps1` exit 0 |
+| 第一性原因（QM-5 ①） | PASS | ①读码：`api-publish-engine/src/index.js` 的 `publishViaApi` 与 `publisher-router.js` 三个发布器一律 `throw new Error(result.error)`，把适配器**已算出**的 `risk_blocked` 标志与风控码族（`BILI_RISK_601`/`10000015`/`-1e7`）丢在半路 ⇒ 上层只剩「拿错误文本猜关键词」这一条路；②读码：两处 `RISK_RE` 均为**无边界裸子串**（`601`/`10000015`/`risk`/`frequent`/`verify`/`验证`），且桌面与引擎两份已漂移（桌面多 `安全验证|操作频繁|captcha`，注释仍写「保持同义」）；③放大器：`accountId` 缺失时 `risk-suspender` 键退化为 `platform::*` = 平台级，覆盖该平台**所有**账号 |
+| 逃逸分析（QM-5 ②） | PASS | 逃逸链四层：**单元层**——`publish-risk.test.js` 只有 4 例且全部是「命中/未命中」的宽样例，**没有任何边界样例**（`1601`/`6019`/`100000159`/`infrequent` 从未被测）；**集成层**——`phase4-events.test.js` 的 5 个风控用例里 4 个用 `触发风控` 这类必然强命中的文案，**唯一那条「非命中」用的是 `平台 Cookie 缺失（账号未登录）`**（不含任何词表词），等于没测「含词表词但非风控」的中间地带；**跨包层**——`task-queue` 丢结构化字段这件事**没有任何测试断言 task 上该有 `code`**，而 phase4 的用例是**直接往 task 塞字段**的（搬运缺失时它照样全绿，典型假绿形状）；**审查层**——两份 `RISK_RE` 的注释都写「与桌面侧保持同义」，审查时读注释即通过，无人比对两份正文 |
+| 修复 + 回归保护（QM-5 ④） | PASS | 新增单一真源 `risk-signals.js`（结构化优先 + 强弱分档 + 边界）；打通 `Error → task` 信号搬运（引擎 `publishViaApi` + 桌面 `attachRiskSignals` + `task-queue`）；桌面/引擎挂起点加强弱闸门与账号兜底；挂起记录携带 `signal`/`strength`；横幅新增 4 个显示项。新增/扩展 8 个测试文件：`risk-signals.test.js`(45) + `publish-risk.test.js`(15) + `phase4-events.test.js`(46，新增 11) + `task-queue.test.js`(37，新增 3) + `risk-suspender.test.js`(引擎，新增 1) + `risk-suspender-store.test.js`(18，新增 2) + `risk-suspended-tracker.test.js`(新增 1) + `RiskSuspendedBanner.source.test.js`(8) |
+| 防止再次发生（QM-5 ⑤） | PASS | ①**不变量进单一真源**：`suspends ⇔ (hit && strength==='strong')` 由 `risk-signals` 给出，调用方不得自行推导（有恒等式测试锁）；②**误判面清单进仓库**：附录 A 的 7 类文案成为常驻回归锁（`FALSE_POSITIVES` 数组），任何未来加词都要过这 7 条；③**跨包搬运有独立锁**：task-queue 断言 `errorCode`/`riskBlocked` 落到 task（并做过变异反证）；④**旧记录不伪造依据**：无 `strength` 时 UI 不渲染依据项，且有测试锁；⑤新能力规格 `openspec/changes/.../specs/risk-hold-guard/spec.md` 把「什么信号可挂起、挂到什么粒度」写成可验收契约 |
+| 行尾与 diff 对账 | PASS | 本 PR 触及的 17 个既有文件工作副本统一规范为 LF（UTF-8 无 BOM），`git ls-files --eol` 复核 `w/lf`；`check-text-encoding-integrity.js` PASS（无新增 U+FFFD） |
+| 新增文件行数门禁 | PASS | `node .github/scripts/check-max-lines.js` → `✅ 无新增超大文件，挂账清单与现实一致`（初版曾判红，见上「受管行数文件」） |
+| ESLint | PASS | `cd apps/desktop && pnpm run lint`（`eslint electron/ src/ --quiet`）**exit 0** |
+| 相关域测试 | PASS | 引擎全量 `node scripts/run-tests.js` → **379 passed / 40 files**（含新增 `risk-signals` 45 例）+ direct 组全通过；`shared-utils` 全量 → **844 passed / 10 skipped / 41 files**；桌面 6 个受影响文件 → **171 passed** |
+| 变异反证 | PASS | `task-queue` 的两个赋值改成 no-op ⇒ `Tests 2 failed \| 35 passed (37)`（新增 3 例中 2 例立红，其中 1 例因默认值恰好相等未红属预期）；按字节还原后 ⇒ `Tests 37 passed (37)`。**反证的是锁本身**（把实现改成 no-op 必须立红），不是只证「业务改动变红」 |
+| locale 成对 / 键存在 / CJK 基线（Gate 7） | PASS | `check-locale-sync.js --keys` → 2013 个使用中 key 均存在；`--cjk` → 基线 1374 / 当前 1224 无新增硬编码；`--pair-base origin/main` → PASS（`publish/zh.js` 与 `publish/en.js` 成对变更 5 个新 key） |
+| 前端一致性 / 样式 / 颜色 / 字号 | PASS | `check-color-literals.js`（129/129）· `check-css-var-defined.js`（0/64）· `check-vue-style-parse.js`（216 vue）· `check-scoped-root.js`（163 scoped）· `check-font-size-scale.js`（35/790）全部 PASS |
+| 品牌残留 / 规格 Purpose / CHANGELOG | PASS | `check-no-brand-residue.js`（8499 tracked 文件）PASS；`check-spec-purpose.js`（153 主规格）违规 0；`check-changelog-growth.js` PASS |
+| openspec 校验 | PASS | `openspec validate fix-risk-hold-false-positive` → `Change 'fix-risk-hold-false-positive' is valid` |
+| QM-1 打包 | PASS | `cd apps/desktop && pnpm run build:win` → **rc=0**（renderer built in 21.14s；`dist-electron\Multi-Publish.Setup.0.2.0.exe` 生成）。产物验证：asar 清单含 `\node_modules\@multi-publish\api-publish-engine\src\publish\core\risk-signals.js`（新模块）、`publish-mode-runner.js`、`risk-suspender.js`、`\electron\services\publish-risk.js`、`risk-suspender-store.js`；**从解包产物实跑判定**：`classifyRisk({error:'Request failed with status code 601'}).suspends === false`、`classifyRisk({error:'B站风控(601)：请完成滑块验证'}).strength === 'strong'` ⇒ 修复确实进了交付产物 |
+| QM-4 视觉 | N/A（受限项） | `RiskSuspendedBanner.vue` 有模板 + scoped 样式改动，但**横幅只在存在挂起记录时渲染**，本机无可用风控会话 ⇒ 无法在真实应用里截到该横幅。已改用源级契约测试（8 例）锁显示项接线；未录视觉基线，如实记为受限项 |
+| QM-6 CCG 双模型外部评审 | 部分 | 本轮未执行正式 CCG 双模型外部评审，如实记录。已做的替代取证：附录 A 的 7 类误判样例与附录 B 的 8 条真实风控来源**逐条人工核对**（含把全仓发布链 674 文件的可疑字符串字面量全量喂给判定函数再逐条复核） |
+| 远程同步 | PENDING | 见下方回填说明 |
+
+### 真机边界（不假装已闭合）
+
+本机**无可用公众号/抖音等真实风控触发会话**，「真实风控命中 → 挂起 → 横幅 → 人工恢复」的**端到端真机回归未做**。本次验收边界为单元 + 集成层，外加「从打包产物实跑判定」这一条靠近交付端的证据。横幅的视觉呈现（4 个显示项实际排版）同样未在真机截到，仅由源级契约锁保证接线存在。
+
+### 已知遗留（本 PR 刻意未修）
+
+- `publisher-router.js` 后端轨失败回退文案是编码损坏串（`'鍙戝竷澶辫触'`，GBK 误读形态）。本次**刻意未顺手修**（属另一议题，避免无关 churn）；同一文件另有大量同类乱码注释，应另开一次性编码治理。
+- 弱信号目前只进结构化日志（`RiskSuspender.weak-signal-not-suspended`），设置页/诊断页**无可视化入口**：「为什么这次没暂停」需查日志。
+- `check-max-lines.js` 台账里 `publisher-router.js` 已用到 818/829，**仅剩 11 行余量**；后续对该文件的任何增量都应先考虑拆分。
+
+### 远程同步回填说明
+
+本 PR 合并后由后续 docs 回填 PR 完成：`.quality-gates.md` 与本文的「远程同步」行由 `PENDING` 改写为 `PASS` + merge SHA，并在**同一次提交**内删除 `scripts/gate-record-debt-ledger.json` 中按本记录标题登记的条目。
diff --git a/packages/api-publish-engine/scripts/run-tests.js b/packages/api-publish-engine/scripts/run-tests.js
index d54582c60..8ae3e6628 100644
--- a/packages/api-publish-engine/scripts/run-tests.js
+++ b/packages/api-publish-engine/scripts/run-tests.js
@@ -31,6 +31,7 @@ const VITEST_FILES = new Set([
   'publish-governance.test.js',
   'publish-mode-runner.test.js',
   'publish-mode-config.test.js',
+  'risk-signals.test.js',
   'risk-suspender.test.js',
   'publish-service.test.js',
   'signer.test.js',
diff --git a/packages/api-publish-engine/src/index.js b/packages/api-publish-engine/src/index.js
index d7a25d533..d5ca3a172 100644
--- a/packages/api-publish-engine/src/index.js
+++ b/packages/api-publish-engine/src/index.js
@@ -92,7 +92,17 @@ async function publishViaApi(platform, taskData, cookie, opts) {
     throw new Error("API adapter has no publish entrypoint for platform: " + platform);
   }
 
-  if (!result || !result.success) throw new Error((result && result.error) || "API publish failed for " + platform);
+  if (!result || !result.success) {
+    // fix-risk-hold-false-positive（P0-1）：此处原先只 `throw new Error(result.error)`，
+    // 把适配器已经算出来的**结构化风控信号**（`risk_blocked` 标志与风控码族）丢在半路，
+    // 逼得上层的风控判定只能拿错误文本做关键词匹配 —— 而文本匹配正是误判的来源。
+    // 现在把 code / risk_blocked 挂到 Error 上，让结构化信号能一路走到桌面侧判定。
+    var err = new Error((result && result.error) || "API publish failed for " + platform);
+    if (result && result.code !== undefined && result.code !== null) err.code = result.code;
+    if (result && (result.riskBlocked === true || result.risk_blocked === true)) err.riskBlocked = true;
+    if (result && result.loginExpired === true) err.loginExpired = true;
+    throw err;
+  }
   return result;
 }
 
diff --git a/packages/api-publish-engine/src/publish/core/publish-mode-runner.js b/packages/api-publish-engine/src/publish/core/publish-mode-runner.js
index eadf4274c..529d68908 100644
--- a/packages/api-publish-engine/src/publish/core/publish-mode-runner.js
+++ b/packages/api-publish-engine/src/publish/core/publish-mode-runner.js
@@ -12,10 +12,11 @@
  * 严格遵循三态总闸 + 风控即停语义，是 §5 服务层的事实路由。
  */
 const { decideRoute, normalizeMode, ROUTES, REASON } = require('./publish-mode')
+// 2026-10-13 fix-risk-hold-false-positive：风控词表与判定收敛到单一真源 risk-signals.js。
+// 此前本文件与桌面 publish-risk.js 各持一份 RISK_RE（注释都写「保持同义」但内容已漂移），
+// 现在两处 require 同一模块，杜绝「同一文本两处结论不同」。
+const { classifyRisk, isRiskText } = require('./risk-signals')
 
-// 2026-10-08 P0-2 词表增强（参考产品 4.13.19 逆向取证）：canvas illegal（抖音/西瓜风控特征）
-// 与「账号存在风险」（参考产品风控提示原文）；与桌面侧 publish-risk.js RISK_RE 保持同义。
-const RISK_RE = /风控|risk|滑块|601|10000015|frequent|频繁|verify|验证|canvas illegal|账号存在风险/i
 const LOGIN_RE = /登录|未登录|登陆|cookie.*(expired|失效|过期)|login|session|auth.*(fail|expired)|未授权/i
 const UNSUPPORTED_RE = /unsupported|not.?supported|暂不支持|无.?api|no.?api/i
 
@@ -29,7 +30,9 @@ function outcomeOfResult (res) {
   const code = res.code != null ? res.code : (res.result && res.result.code)
   if (code === 'BILI_RISK_601' || code === 10000015 || code === -1e7) return 'risk_blocked'
   const msg = String(res.error || res.errMsg || res.message || '')
-  if (RISK_RE.test(msg)) return 'risk_blocked'
+  // 路由判据用**并集**（强弱都算「像风控」）：命中即停报不降级，不换路。
+  // 注意这与「是否挂起」是两件事——挂起另由 classifyRisk(...).suspends 决定（仅强信号）。
+  if (isRiskText(msg)) return 'risk_blocked'
   if (LOGIN_RE.test(msg)) return 'login_expired'
   if (UNSUPPORTED_RE.test(msg)) return 'unsupported'
   return 'transient_error'
@@ -129,11 +132,31 @@ function createPublishWithMode (deps = {}) {
     }
 
     if (d.route === ROUTES.stop) { // 风控/登录/api-only 失败：停报，不降级
-      if (outcome === 'risk_blocked' && riskSuspender && typeof riskSuspender.suspend === 'function') {
-        riskSuspender.suspend(platform, accountId, { reason: REASON.riskBlocked, error: apiRes && apiRes.error })
+      // 挂起闸门（fix-risk-hold-false-positive）：**只有强信号才挂起**。
+      // 弱信号（裸 验证/risk/frequent/verify/601）仍按风控停报不降级（安全侧：不换路），
+      // 但不冻结账号——实测这类词会把 `身份验证失败`、`status code 601`、`infrequent`
+      // 误判成风控，而挂起的代价是用户必须人工去平台解封。
+      // 不变量由 risk-signals 单一真源给出，调用方不得自行推导。
+      const riskVerdict = classifyRisk({
+        error: apiRes && apiRes.error,
+        code: apiRes && apiRes.code,
+        riskBlocked: !!(apiRes && (apiRes.riskBlocked || apiRes.risk_blocked)),
+      })
+      if (outcome === 'risk_blocked' && !riskVerdict.suspends) {
+        logger.warn('publish-mode', 'risk signal weak → stop without suspend', {
+          platform, mode, accountId, outcome, signal: riskVerdict.signal, strength: riskVerdict.strength,
+        })
+      }
+      if (outcome === 'risk_blocked' && riskVerdict.suspends && riskSuspender && typeof riskSuspender.suspend === 'function') {
+        riskSuspender.suspend(platform, accountId, {
+          reason: REASON.riskBlocked,
+          error: apiRes && apiRes.error,
+          signal: riskVerdict.signal,
+          strength: riskVerdict.strength,
+        })
       }
       logger.error('publish-mode', 'stopped (no degrade)', { platform, mode, accountId, outcome, reasonCode: d.reasonCode, error: apiRes && apiRes.error })
-      return Object.assign(base, { track: 'api', success: false, reasonCode: d.reasonCode, stopped: true, error: apiRes && apiRes.error, code: apiRes && apiRes.code, apiAttempt })
+      return Object.assign(base, { track: 'api', success: false, reasonCode: d.reasonCode, stopped: true, error: apiRes && apiRes.error, code: apiRes && apiRes.code, apiAttempt, riskVerdict })
     }
 
     // d.degrade → 回落 DOM（api-then-dom + transient/unsupported）
diff --git a/packages/api-publish-engine/src/publish/core/risk-signals.js b/packages/api-publish-engine/src/publish/core/risk-signals.js
new file mode 100644
index 000000000..1278c9ad1
--- /dev/null
+++ b/packages/api-publish-engine/src/publish/core/risk-signals.js
@@ -0,0 +1,160 @@
+'use strict'
+/**
+ * risk-signals.js — 风控信号单一真源（fix-risk-hold-false-positive，2026-10-13）
+ *
+ * 为什么要有这个模块：本仓此前存在**两份**各自演化的风控词表 ——
+ * 引擎 `publish-mode-runner.js` 的 `RISK_RE` 与桌面 `publish-risk.js` 的 `RISK_RE`。
+ * 两者注释都写着「保持同义」，实际内容已经漂移（桌面多 安全验证/操作频繁/captcha）。
+ * 两份词表意味着「同一个错误文本，在引擎与桌面可能得到不同结论」，且每次加词都要改两处。
+ * 现在收敛为一份，两边都 require 本模块。
+ *
+ * ── 为什么要分「强/弱」两档（本次修复的核心）──────────────────────────────
+ * 旧实现是一条裸子串正则，`601` / `risk` / `frequent` / `验证` 都无边界匹配。
+ * 实测误判面（fix-risk-hold-false-positive 取证，见 PRD 附录 A）：
+ *   · `Request failed with status code 601` → 命中（HTTP 状态码）
+ *   · `publish id 6019 not found`          → 命中（ID 含 601）
+ *   · `gateway timeout ts=1601846521`      → 命中（时间戳含 601）
+ *   · `errno 100000159: bad request`       → 命中（风控码的邻居）
+ *   · `infrequent login detected`          → 命中（英文子串）
+ *   · `low-risk content flagged`           → 命中（英文普通词）
+ *   · `身份验证失败` / `请先完成实名验证`      → 命中（普通「验证」）
+ * 而这些误判的后果不是「少发一篇」，是把该账号（accountId 缺失时是该平台**所有**账号）
+ * 冻结到用户手动去平台创作者中心走一遍验证为止 —— 误判代价远高于漏判。
+ *
+ * 分档判据（与仓内既有纪律一致，见 publish-not-submitted.js 的封闭词表注释、
+ * 以及 PRD-XHS-DOM-RPA-HARDENING 的「误判比漏判更有害」）：
+ *   · STRONG = 平台风控**专属**措辞/码族，无语义歧义 → `suspends: true`，允许挂起
+ *   · WEAK   = 宽泛词，可能出现在普通错误里        → `suspends: false`，只提示不挂起
+ * **「弱信号不挂起」这个不变量由本模块给出（`suspends` 字段），调用方不得自行推导**，
+ * 否则又是一个「两处各自解释」的漂移点。
+ *
+ * 实测「真风控」样例全部落在 STRONG（风控/安全验证/滑块/操作频繁/captcha/canvas illegal/
+ * 账号存在风险/risk control/risk_blocked 标志/601·10000015 码族），因此收紧不损召回。
+ *
+ * 合规红线：本模块只做识别，无任何自动恢复/自动换号逻辑。
+ */
+
+/** 结构化风控码族（平台自报，无歧义）—— 命中即 strong。 */
+const RISK_CODES = new Set([
+  'BILI_RISK_601',
+  'RISK_BLOCKED',
+  601,
+  10000015,
+  -1e7,
+])
+
+/** 我们的守卫自身产生的标记：它不是平台信号，必须排除（否则会自触发再挂起）。 */
+const SUSPENDED_MARKER_RE = /risk_suspended/i
+
+/**
+ * 强信号：平台风控专属措辞，无语义歧义。
+ * 英文词一律加「标识符边界」（`_` 也算边界，故 `BILI_RISK_601` 能命中）；
+ * 数字码加「数字边界」，杜绝 `1601` / `6019` 这类子串命中。
+ */
+const RISK_STRONG_RE = new RegExp([
+  '风控',
+  '滑块',
+  '安全验证',
+  '验证弹层',
+  '操作频繁',
+  'captcha',
+  'canvas illegal',
+  '账号存在风险',
+  'risk control',
+  'risk_blocked',
+  'riskBlocked',
+  'RISK_BLOCKED',
+  'BILI_RISK',
+  // 抖音 status_code===110 的**文案形态**。为什么单独收：真实链路由适配器显式置
+  // `risk_blocked: true`（结构化 strong）覆盖；但该文案可能在错误被重新包装/截断后
+  // 只剩文本（如 RPA 轨回传），此时 `验证失败(110)` 是平台专属、无歧义的形态，
+  // 而裸「验证」属弱档不挂起 —— 不收会漏掉这一类真风控。
+  '验证失败\\(110\\)',
+  '(?<!\\d)10000015(?!\\d)',
+].join('|'), 'i')
+
+/**
+ * 弱信号：宽泛词，可能出现在普通错误里 —— 只提示、不挂起。
+ * `601` 刻意留在弱档：真实 B站风控文案含「风控」「滑块验证」（强档已覆盖），
+ * 而裸 `601` 与 HTTP 状态码/ID/时间戳无法区分。
+ */
+const RISK_WEAK_RE = new RegExp([
+  '验证',
+  '频繁',
+  '(?<![A-Za-z0-9])risk(?![A-Za-z0-9])',
+  '(?<![A-Za-z0-9])frequent(?![A-Za-z0-9])',
+  '(?<![A-Za-z0-9])verify(?![A-Za-z0-9])',
+  '(?<!\\d)601(?!\\d)',
+].join('|'), 'i')
+
+/** 并集：任何一档命中。供「停报不降级」这类只问「像不像风控」的路由判据使用。 */
+const RISK_ANY_RE = new RegExp(RISK_STRONG_RE.source + '|' + RISK_WEAK_RE.source, 'i')
+
+/**
+ * @typedef {{hit: boolean, strength: ('strong'|'weak'|null), signal: string, suspends: boolean}} RiskVerdict
+ * signal 是**封闭词表**里的稳定记号（安全、可持久化、可展示），不是原始错误文本：
+ *   'flag'         —— 调用方显式声明 risk_blocked
+ *   'code:<code>'  —— 平台风控码族
+ *   'strong:<词>'  —— 强信号词表命中
+ *   'weak:<词>'    —— 弱信号词表命中
+ */
+
+const NOT_HIT = Object.freeze({ hit: false, strength: null, signal: '', suspends: false })
+
+/** 取正则第一条命中的原始子串（词表是封闭的，故该子串可安全外传）。 */
+function firstMatch (re, text) {
+  const m = re.exec(text)
+  return m ? m[0] : ''
+}
+
+/**
+ * 风控判定（结构化信号优先，文本兜底，分强弱并给出 suspends 不变量）。
+ * @param {{error?: unknown, code?: unknown, riskBlocked?: unknown, risk_blocked?: unknown}} [input]
+ * @returns {RiskVerdict}
+ */
+function classifyRisk (input) {
+  const src = input || {}
+
+  // ① 结构化信号优先：调用方显式声明 → 直接 strong，完全不依赖文本
+  if (src.riskBlocked === true || src.risk_blocked === true) {
+    return { hit: true, strength: 'strong', signal: 'flag', suspends: true }
+  }
+  // ② 平台风控码族（数字码与字符串枚举两形态都收）
+  const code = src.code
+  if (code != null && RISK_CODES.has(typeof code === 'string' ? code : Number(code))) {
+    return { hit: true, strength: 'strong', signal: 'code:' + String(code), suspends: true }
+  }
+
+  // ③ 文本兜底
+  const text = typeof src.error === 'string' ? src.error : ''
+  if (!text) return Object.assign({}, NOT_HIT)
+  // 守卫自身标记不是平台信号（自触发防线；桌面侧另有 isRiskSuspendedMessage 双保险）
+  if (SUSPENDED_MARKER_RE.test(text)) return Object.assign({}, NOT_HIT)
+
+  const strong = firstMatch(RISK_STRONG_RE, text)
+  if (strong) return { hit: true, strength: 'strong', signal: 'strong:' + strong, suspends: true }
+  const weak = firstMatch(RISK_WEAK_RE, text)
+  if (weak) return { hit: true, strength: 'weak', signal: 'weak:' + weak, suspends: false }
+  return Object.assign({}, NOT_HIT)
+}
+
+/**
+ * 文本是否像风控（并集，不分强弱）。
+ * 用途：只需回答「像不像风控」的路由判据（如 API 轨命中即停报不降级）。
+ * @param {unknown} text
+ * @returns {boolean}
+ */
+function isRiskText (text) {
+  if (typeof text !== 'string' || !text) return false
+  if (SUSPENDED_MARKER_RE.test(text)) return false
+  return RISK_ANY_RE.test(text)
+}
+
+module.exports = {
+  RISK_CODES,
+  RISK_STRONG_RE,
+  RISK_WEAK_RE,
+  RISK_ANY_RE,
+  classifyRisk,
+  isRiskText,
+}
diff --git a/packages/api-publish-engine/src/publish/core/risk-suspender.js b/packages/api-publish-engine/src/publish/core/risk-suspender.js
index 2e3c64ad5..21fd44f62 100644
--- a/packages/api-publish-engine/src/publish/core/risk-suspender.js
+++ b/packages/api-publish-engine/src/publish/core/risk-suspender.js
@@ -37,6 +37,11 @@ function createRiskSuspender (deps = {}) {
       reason: info.reason || 'risk_blocked',
       at: info.at != null ? info.at : clock(),
     }
+    // fix-risk-hold-false-positive：记录判定依据，供横幅展示「为什么被挂起」。
+    // **只收封闭词表的稳定记号，不收原始错误文本** —— rec 会被持久化到 store 并广播到
+    // 渲染层，平台回包原文可能含会话片段，不适合落盘/跨进程传递。
+    if (typeof info.signal === 'string' && info.signal) rec.signal = info.signal.slice(0, 64)
+    if (info.strength === 'strong' || info.strength === 'weak') rec.strength = info.strength
     const already = suspended.has(key)
     suspended.set(key, rec)
     if (!already) emit('suspend', rec)
diff --git a/packages/api-publish-engine/test/risk-signals.test.js b/packages/api-publish-engine/test/risk-signals.test.js
new file mode 100644
index 000000000..6b02a7fb8
--- /dev/null
+++ b/packages/api-publish-engine/test/risk-signals.test.js
@@ -0,0 +1,250 @@
+// fix-risk-hold-false-positive 回归锁：风控信号单一真源的强/弱分档与边界
+//
+// 本文件是本次「误判修复」的主回归锁。三组断言各自对应一个真实缺陷：
+//   ① 误判面（旧裸子串词表命中、必须不再命中）
+//   ② 真风控召回（收紧后必须仍然命中且为 strong）
+//   ③ suspends 不变量（弱信号永不挂起 —— 由单一真源给出，调用方不得自行推导）
+const {
+  classifyRisk,
+  isRiskText,
+  RISK_STRONG_RE,
+  RISK_WEAK_RE,
+  RISK_ANY_RE,
+} = require('../src/publish/core/risk-signals')
+
+describe('risk-signals.classifyRisk — 结构化信号优先', () => {
+  it('显式 riskBlocked / risk_blocked 声明 → strong + suspends，完全不看文本', () => {
+    for (const flag of [{ riskBlocked: true }, { risk_blocked: true }]) {
+      const v = classifyRisk(Object.assign({ error: '完全无关的普通错误' }, flag))
+      expect(v.hit).toBe(true)
+      expect(v.strength).toBe('strong')
+      expect(v.signal).toBe('flag')
+      expect(v.suspends).toBe(true)
+    }
+  })
+
+  it('平台风控码族（BILI_RISK_601 / 601 / 10000015 / -1e7）→ strong，即便文本无关', () => {
+    for (const code of ['BILI_RISK_601', 601, 10000015, -1e7, 'RISK_BLOCKED']) {
+      const v = classifyRisk({ code, error: 'upstream returned 500' })
+      expect(v.hit).toBe(true)
+      expect(v.strength).toBe('strong')
+      expect(v.suspends).toBe(true)
+      expect(v.signal).toContain('code:')
+    }
+  })
+
+  it('结构化信号优先于文本：显式 flag 不会被"文本看着无害"推翻', () => {
+    const v = classifyRisk({ riskBlocked: true, error: '网络超时' })
+    expect(v.strength).toBe('strong')
+    expect(v.suspends).toBe(true)
+  })
+})
+
+describe('risk-signals.classifyRisk — ① 误判面回归（旧词表命中、现在必须不挂起）', () => {
+  // 每一条都来自实测取证：旧 RISK_RE 会命中并把账号/平台冻结
+  const FALSE_POSITIVES = [
+    ['HTTP 状态码 601', 'Request failed with status code 601'],
+    ['ID 含 601', 'publish id 6019 not found'],
+    ['时间戳含 601', 'gateway timeout ts=1601846521'],
+    ['风控码的邻居', 'errno 100000159: bad request'],
+    ['英文子串 infrequent', 'infrequent login detected'],
+    ['英文普通词 low-risk', 'low-risk content flagged'],
+    ['英文前缀 derisk', 'derisk pipeline unavailable'],
+    ['英文 verified', 'verified badge missing'],
+    ['普通「验证」', '身份验证失败'],
+    ['普通「验证」', '请先完成实名验证'],
+    ['普通「频繁」', '请求过于频繁，请稍后重试'],
+  ]
+
+  for (const [label, msg] of FALSE_POSITIVES) {
+    it(label + ' ⇒ 不挂起（suspends=false）: ' + msg, () => {
+      const v = classifyRisk({ error: msg })
+      expect(v.suspends).toBe(false)
+    })
+  }
+
+  it('以上误判样例即使判为 hit，其 strength 也只能是 weak（不是 strong）', () => {
+    for (const [, msg] of FALSE_POSITIVES) {
+      const v = classifyRisk({ error: msg })
+      if (v.hit) expect(v.strength).toBe('weak')
+    }
+  })
+
+  it('普通发布失败应当完全不命中（hit=false）', () => {
+    const plain = [
+      '平台 Cookie 缺失（账号 acc-1 未登录或凭证不可用）',
+      '缺少视频文件路径',
+      '网络超时',
+      '服务异常请稍后重试',
+      'publish btn not found',
+      'element not found in iframe',
+      'No file input found (JS fallback)',
+      'File not found: D:/x.mp4',
+      'API publish failed for wechat_mp',
+      'No API adapter for platform: xiaohongshu',
+      'timeout of 20000ms exceeded',
+      'ECONNRESET',
+      '',
+    ]
+    for (const m of plain) {
+      const v = classifyRisk({ error: m })
+      expect(v.hit, m).toBe(false)
+      expect(v.suspends, m).toBe(false)
+    }
+  })
+
+  it('守卫自身标记 risk_suspended 不构成平台信号（自触发防线）', () => {
+    for (const m of ['publish blocked: risk_suspended for weixin/acc1', 'risk_suspended']) {
+      const v = classifyRisk({ error: m })
+      expect(v.hit, m).toBe(false)
+      expect(v.suspends, m).toBe(false)
+    }
+  })
+
+  it('非字符串输入安全返回 not-hit', () => {
+    for (const bad of [null, undefined, {}, 601, [], true]) {
+      const v = classifyRisk({ error: bad })
+      expect(v.hit).toBe(false)
+      expect(v.suspends).toBe(false)
+    }
+    expect(classifyRisk().hit).toBe(false)
+    expect(classifyRisk({}).hit).toBe(false)
+  })
+})
+
+describe('risk-signals.classifyRisk — ② 真风控召回（收紧后必须仍为 strong）', () => {
+  // 覆盖仓内全部真实风控来源：抖音 / B站 / 快手 / 百家号 / 小红书 / 参考产品取证词
+  const REAL_RISK = [
+    ['抖音 x-tt-verify', '抖音触发安全验证，请在创作者中心手动完成验证后重试（不自动换号）'],
+    ['抖音 110', '抖音验证失败(110)，请手动完成验证后重试'],
+    ['B站 601', 'B站风控(601)：请先在创作者中心完成滑块验证后重试'],
+    ['快手验证页', '快手返回验证页/非 JSON 应答，疑似风控拦截，请在创作者中心手动确认后再试（不自动验证、不换号）'],
+    ['百家号 10000015', '百家号风控拦截：您所在网络环境异常，请完成验证（30天内注册的百家号作者弹码），请先在浏览器中登录百家号完成验证'],
+    ['小红书弹层', '检测到风控/验证弹层，已停止'],
+    ['参考产品 canvas illegal', 'canvas illegal'],
+    ['参考产品 canvas illegal 变体', 'Canvas Illegal: 请先到创作者中心发布一篇内容'],
+    ['参考产品 账号存在风险', '官方检测到您的账号存在风险，请先前往创作者中心发布作品'],
+    ['英文 risk control', 'risk control detected'],
+    ['操作频繁', '操作频繁，请 60 分钟后再试'],
+    ['滑块', '需要滑块验证'],
+    ['captcha', 'captcha required'],
+    ['安全验证', '安全验证未通过'],
+    ['码族文本', 'code 10000015 verify'],
+    ['规范化 B 站码名', 'BILI_RISK_601'],
+  ]
+
+  for (const [label, msg] of REAL_RISK) {
+    it(label + ' ⇒ strong + suspends', () => {
+      const v = classifyRisk({ error: msg })
+      expect(v.hit, msg).toBe(true)
+      expect(v.strength, msg).toBe('strong')
+      expect(v.suspends, msg).toBe(true)
+      expect(v.signal).not.toBe('')
+    })
+  }
+
+  it('「抖音安全 verify 拦截」是弱信号（hit 但 weak）：路由仍按风控停报，挂起需更强证据', () => {
+    // 该文案是 douyin-risk.test.js 的合成夹具，不是生产文案（生产为「触发安全验证」/「验证失败(110)」，
+    // 两者都在强档）。裸 verify 与 confirmed/verify 类普通英文错误无法区分 ⇒ 只提示不挂起。
+    const v = classifyRisk({ error: '抖音安全 verify 拦截' })
+    expect(v.hit).toBe(true)
+    expect(v.strength).toBe('weak')
+    expect(v.suspends).toBe(false)
+    // 但「像不像风控」的并集判据必须仍然为真，否则引擎会把它降级到 DOM（契约见 douyin-risk.test.js）
+    expect(isRiskText('抖音安全 verify 拦截')).toBe(true)
+  })
+
+  it('signal 是封闭词表记号（可安全持久化），不含原始错误全文', () => {
+    const long = 'B站风控(601)：请先在创作者中心完成滑块验证后重试' + 'x'.repeat(500)
+    const v = classifyRisk({ error: long })
+    expect(v.signal.length).toBeLessThan(40)
+    expect(v.signal).not.toContain('x'.repeat(50))
+  })
+})
+
+describe('risk-signals — ③ suspends 不变量（弱信号永不挂起）', () => {
+  it('任何 strength=weak 的判定，suspends 必须为 false', () => {
+    const weakCases = [
+      '身份验证失败',
+      '请先完成实名验证',
+      'Request failed with status code 601',
+      'low-risk content flagged',
+      '请先完成实名验证后重试',
+    ]
+    for (const m of weakCases) {
+      const v = classifyRisk({ error: m })
+      expect(v.hit, m).toBe(true)
+      expect(v.strength, m).toBe('weak')
+      expect(v.suspends, m).toBe(false)
+    }
+  })
+
+  it('infrequent login detected 连 hit 都不是（标识符边界挡住了英文子串）', () => {
+    const v = classifyRisk({ error: 'infrequent login detected' })
+    expect(v.hit).toBe(false)
+    expect(v.suspends).toBe(false)
+  })
+
+  it('verified / verification 也不算命中（verify 的词形边界）', () => {
+    for (const m of ['verified badge missing', 'verification email sent']) {
+      const v = classifyRisk({ error: m })
+      expect(v.hit, m).toBe(false)
+    }
+  })
+
+  it('不变量恒等式：suspends ⇔ (hit && strength === "strong")', () => {
+    const samples = [
+      { error: '触发风控' },
+      { error: '身份验证失败' },
+      { error: '网络超时' },
+      { riskBlocked: true, error: 'x' },
+      { code: 601, error: 'x' },
+      {},
+    ]
+    for (const s of samples) {
+      const v = classifyRisk(s)
+      expect(v.suspends).toBe(Boolean(v.hit && v.strength === 'strong'))
+    }
+  })
+})
+
+describe('risk-signals — 边界与并集判据', () => {
+  it('数字边界：601 / 10000015 不做子串命中', () => {
+    expect(RISK_ANY_RE.test('1601')).toBe(false)
+    expect(RISK_ANY_RE.test('6019')).toBe(false)
+    expect(RISK_ANY_RE.test('1601846521')).toBe(false)
+    expect(RISK_ANY_RE.test('100000159')).toBe(false)
+    expect(RISK_ANY_RE.test('code 601')).toBe(true)
+    expect(RISK_ANY_RE.test('errno 10000015')).toBe(true)
+  })
+
+  it('标识符边界：下划线算边界（BILI_RISK_601 可命中），字母数字不算', () => {
+    expect(RISK_ANY_RE.test('BILI_RISK_601')).toBe(true)
+    expect(RISK_WEAK_RE.test('derisk')).toBe(false)
+    expect(RISK_WEAK_RE.test('infrequent')).toBe(false)
+    expect(RISK_WEAK_RE.test('verified')).toBe(false)
+    expect(RISK_WEAK_RE.test('low-risk')).toBe(true)
+  })
+
+  it('守卫标记的排除发生在判定层而非裸词表：RISK_ANY_RE 是纯并集，classifyRisk/isRiskText 才排除', () => {
+    // 裸正则只表达「词表里有这个词」；「这是不是平台信号」的语义判定在函数里。
+    // 这条锁钉住分工，避免有人把排除逻辑删掉后以为裸正则还在兜底。
+    expect(RISK_ANY_RE.test('risk_suspended')).toBe(true)
+    expect(isRiskText('risk_suspended')).toBe(false)
+    expect(classifyRisk({ error: 'risk_suspended' }).hit).toBe(false)
+  })
+
+  it('isRiskText 是并集判据：强弱都算「像风控」，但排除守卫标记', () => {
+    expect(isRiskText('触发风控')).toBe(true)
+    expect(isRiskText('身份验证失败')).toBe(true)   // weak 也算「像」
+    expect(isRiskText('网络超时')).toBe(false)
+    expect(isRiskText('publish blocked: risk_suspended for a/b')).toBe(false)
+    expect(isRiskText(null)).toBe(false)
+    expect(isRiskText(601)).toBe(false)
+  })
+
+  it('并集正则 = 强 ∪ 弱（两者命中集合被覆盖）', () => {
+    expect(RISK_ANY_RE.source).toContain(RISK_STRONG_RE.source)
+    expect(RISK_ANY_RE.source).toContain(RISK_WEAK_RE.source)
+  })
+})
diff --git a/packages/api-publish-engine/test/risk-suspender.test.js b/packages/api-publish-engine/test/risk-suspender.test.js
index 0f016140c..911dea3ef 100644
--- a/packages/api-publish-engine/test/risk-suspender.test.js
+++ b/packages/api-publish-engine/test/risk-suspender.test.js
@@ -33,6 +33,23 @@ describe('risk-suspender (§5.4)', function () {
     expect(rs.isSuspended('bilibili', 'acc2')).toBe(true)
   })
 
+  test('fix-risk-hold-false-positive：记录携带 signal/strength（横幅「判定依据」来源），且只收封闭词表记号', function () {
+    const rs = createRiskSuspender({ clock: () => 1 })
+    const rec = rs.suspend('bilibili', 'acc1', { reason: 'risk_blocked', signal: 'strong:风控', strength: 'strong' })
+    expect(rec.signal).toBe('strong:风控')
+    expect(rec.strength).toBe('strong')
+    expect(rs.listSuspended()[0].signal).toBe('strong:风控')
+
+    // 非法 strength 不得落库（UI 只认 strong/weak，其它值会让「判定依据」显示成错的那一档）
+    const rec2 = rs.suspend('douyin', 'acc2', { strength: 'bogus', signal: 123 })
+    expect(rec2.strength).toBe(undefined)
+    expect(rec2.signal).toBe(undefined)
+
+    // signal 截断到 64 字符（持久化 + 跨进程广播，不允许无界增长）
+    const long = rs.suspend('zhihu', 'acc3', { signal: 'x'.repeat(200) })
+    expect(long.signal.length).toBe(64)
+  })
+
   test('账号级挂起只命中对应账号', function () {
     const rs = createRiskSuspender()
     rs.suspend('bilibili', 'acc1')
diff --git a/packages/shared-utils/src/task-queue.js b/packages/shared-utils/src/task-queue.js
index 22b416a09..e30093b8d 100755
--- a/packages/shared-utils/src/task-queue.js
+++ b/packages/shared-utils/src/task-queue.js
@@ -638,6 +638,12 @@ class TaskQueue extends EventEmitter {
     } catch (e) {
       if (task.cancelRequested || task.status === 'cancelled') return
       task.error = e.message
+      // fix-risk-hold-false-positive（P0-1）：把抛错方携带的**结构化风控信号**落到任务上。
+      // 此前只留 task.error 一段文本，下游风控判定被迫做关键词匹配 —— 而关键词匹配正是
+      // 误判来源（`status code 601` / `id 6019` / `infrequent` 都会被裸词表命中）。
+      // 传输层（publisher-router / 引擎 publishViaApi）已在 Error 上挂好 code 与 riskBlocked。
+      task.errorCode = e && e.code !== undefined ? e.code : null
+      task.riskBlocked = !!(e && (e.riskBlocked === true || e.risk_blocked === true))
 
       // ── P0-1：未提交失败回滚窗口 ──
       // 判据是**提交阶段**而非错误类型：从未发起平台写尝试（submitAttempted=false），
diff --git a/packages/shared-utils/tests/task-queue.test.js b/packages/shared-utils/tests/task-queue.test.js
index 948d7b9f0..8735fb1e0 100755
--- a/packages/shared-utils/tests/task-queue.test.js
+++ b/packages/shared-utils/tests/task-queue.test.js
@@ -611,3 +611,55 @@ describe('TaskQueue 通道调度（publish-throughput-optimization B 方案）',
   })
 })
 
+// ─────────────────────────────────────────────────────────────────────────────
+// fix-risk-hold-false-positive（P0-1）：结构化风控信号必须从抛出的 Error 落到 task 上。
+// 为什么这条锁非有不可：桌面侧 phase4-events 的风控判定读的是 task.errorCode / task.riskBlocked。
+// 如果这里不搬运，判定会静默退回文本关键词匹配 —— 而 phase4 的单元测试是直接往 task 上塞
+// 这两个字段的，**搬运缺失时它照样全绿**（典型的假绿形状）。
+// ─────────────────────────────────────────────────────────────────────────────
+describe('TaskQueue — 结构化风控信号落到 task（fix-risk-hold-false-positive P0-1）', () => {
+  it('executor 抛带 code/riskBlocked 的 Error → task:failed 的 task 携带 errorCode/riskBlocked', async () => {
+    const queue = new TaskQueue({ defaultRetry: 0 })
+    const failed = new Promise(resolve => queue.once('task:failed', resolve))
+    queue.setExecutor(async () => {
+      const err = new Error('抖音触发安全验证，请手动完成验证后重试')
+      err.code = 'BILI_RISK_601'
+      err.riskBlocked = true
+      throw err
+    })
+    queue.add({ platform: 'douyin', article: { title: 'T', accountId: 'acc-1' }, accountId: 'acc-1' })
+
+    const task = await failed
+    expect(task.error).toBe('抖音触发安全验证，请手动完成验证后重试')
+    expect(task.errorCode).toBe('BILI_RISK_601')
+    expect(task.riskBlocked).toBe(true)
+  })
+
+  it('普通失败的 errorCode 归一为 null、riskBlocked 为 false（不得留 undefined 这种「看起来判过」的残迹）', async () => {
+    const queue = new TaskQueue({ defaultRetry: 0 })
+    const failed = new Promise(resolve => queue.once('task:failed', resolve))
+    queue.setExecutor(async () => { throw new Error('网络超时') })
+    queue.add({ platform: 'douyin', article: { title: 'T', accountId: 'acc-1' }, accountId: 'acc-1' })
+
+    const task = await failed
+    expect(task.errorCode).toBeNull()
+    expect(task.riskBlocked).toBe(false)
+  })
+
+  it('risk_blocked 下划线形态同样被识别', async () => {
+    const queue = new TaskQueue({ defaultRetry: 0 })
+    const failed = new Promise(resolve => queue.once('task:failed', resolve))
+    queue.setExecutor(async () => {
+      const err = new Error('风控拦截')
+      err.code = 10000015
+      err.risk_blocked = true
+      throw err
+    })
+    queue.add({ platform: 'baijiahao', article: { title: 'T', accountId: 'acc-9' }, accountId: 'acc-9' })
+
+    const task = await failed
+    expect(task.errorCode).toBe(10000015)
+    expect(task.riskBlocked).toBe(true)
+  })
+})
+
diff --git a/scripts/gate-record-debt-ledger.json b/scripts/gate-record-debt-ledger.json
index 14d70637f..637723dd1 100644
--- a/scripts/gate-record-debt-ledger.json
+++ b/scripts/gate-record-debt-ledger.json
@@ -49,5 +49,6 @@
     "status": "PENDING",
     "line": 5
   },
-  "本次执行记录：钩子安装器回归锁（hook-installer-test，2026-10-12）【混合 PR】": "本 PR（hook-installer-test）的远程同步待合并后由后续 docs PR 回填并删除本条登记项"
+  "本次执行记录：钩子安装器回归锁（hook-installer-test，2026-10-12）【混合 PR】": "本 PR（hook-installer-test）的远程同步待合并后由后续 docs PR 回填并删除本条登记项",
+  "本次执行记录：风控挂起误判修复（fix-risk-hold-false-positive，2026-10-13）【混合 PR】": "本 PR（fix-risk-hold-false-positive）的远程同步待合并后由后续 docs 回填 PR 改写为 PASS + merge SHA，并在同一次提交内删除本条登记项"
 }

```

> 这是机械生成的变更提案，不代表任何设计意图。评审方请只针对上述内容挑刺。
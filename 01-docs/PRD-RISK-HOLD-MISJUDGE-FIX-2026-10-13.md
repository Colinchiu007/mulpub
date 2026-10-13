# PRD：风控挂起误判修复（fix-risk-hold-false-positive，2026-10-13）

> 关联 change：`openspec/changes/fix-risk-hold-false-positive/`
> 关联执行记录：`openspec/records/fix-risk-hold-false-positive.md`
> 分支：`fix-risk-hold-false-positive`

---

## 1. 背景

### 1.1 用户可见现象

账号管理页出现横幅（原文，zh 真值）：

```
检测到风控，「微信公众号」等 1 个发布目标已自动暂停后续发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页手动恢复。
```

同一条文案还会以 warning toast 形式弹出。用户在平台侧**并没有**触发任何验证，横幅却声称「检测到风控」，且该平台的后续发布被真的挡住，必须逐条手动点「恢复发布」。

### 1.2 触发链路（修复前）

```
发布任务失败（taskQueue 抛错）
  → task.error = e.message                        (shared-utils/task-queue.js)
  → phase4-events 的 task:failed 处理器
      if (isRiskBlocked(task.error)                (apps/desktop/electron/services/publish-risk.js)
          && !isRiskSuspendedMessage(task.error))
        → riskSuspender.suspend(platform, accountId)
        → 广播 publish:risk-suspended → 渲染层 useRiskStore → RiskSuspendedBanner
```

其中 `isRiskBlocked` 的实现是一条**无边界裸子串正则**：

```js
/风控|risk|滑块|601|10000015|frequent|频繁|verify|验证|安全验证|操作频繁|captcha|canvas illegal|账号存在风险/i
```

### 1.3 根因（两条，互为放大镜）

**根因 A：判定只有「错误文本关键词」这一条路，结构化信号被丢在半路。**

各发布链其实**已经算出**了结构化的风控结论：

| 位置 | 已有信号 | 是否传到上层 |
|---|---|---|
| 抖音视频/图文链 | `risk_blocked: true`（`x-tt-verify-passport-decision` / `status_code===110`） | 否 |
| B站视频链 | `code: 601` / `BILI_RISK_601` | 否 |
| 百家号图文链 | `code: 10000015` | 否 |
| 快手视频链 | `risk_blocked: true`（提交返回非 JSON 验证页） | 否 |
| 小红书 DOM 轨 | `XHS_RISK_BLOCKED` | 否 |

但传输层一律 `throw new Error(result.error)`：

- `packages/api-publish-engine/src/index.js` 的 `publishViaApi`
- `apps/desktop/electron/services/publisher-router.js` 的 `ApiPublisher` / `RpaPublisher` / `BackendPublisher`

`Error` 上只留下 `message`，`code` 与 `risk_blocked` 被丢弃。上层拿不到结构化结论，**只能**退回「拿错误文本猜关键词」，而关键词匹配正是误判来源。

**根因 B：词表无边界，且不分强弱。**

`601`、`10000015`、`risk`、`frequent`、`verify`、`验证` 全部是无边界子串匹配。实测误判面（附录 A 为完整取证）：

| 普通失败文案 | 命中原因 | 修复前后果 |
|---|---|---|
| `Request failed with status code 601` | 裸数字 `601` | 冻结该账号 / 平台 |
| `publish id 6019 not found` | 裸数字 `601`（子串） | 同上 |
| `gateway timeout ts=1601846521` | 裸数字 `601`（子串） | 同上 |
| `errno 100000159: bad request` | 裸数字 `10000015`（子串） | 同上 |
| `infrequent login detected` | `frequent`（子串） | 同上 |
| `low-risk content flagged` | `risk`（英文普通词） | 同上 |
| `身份验证失败` / `请先完成实名验证` | `验证`（中文普通词） | 同上 |

**放大器：`accountId` 缺失时自动降级为平台级挂起。** `phase4-events` 取 `task.article?.accountId || null`，而 `risk-suspender-store` 的键语义是「`accountId` 为 `null` ⇒ 平台级挂起，覆盖该平台**所有**账号」。于是「一次误判 + 没带账号」= 整平台停摆。

### 1.4 为什么这条必须修（代价不对称）

误判的代价不是「少发一篇」：

1. 用户被引导去平台创作者中心「手动发布一篇内容完成验证」——**而那里根本不会弹验证**（因为并没有风控）；
2. 用户做完回来点「恢复发布」，账号才解冻；期间该平台所有发布都零请求被拦（`RiskSuspendedError`，`noRetry`）；
3. 挂起态经 store 键 `publish.riskSuspended` **持久化、重启存活、无自动过期**，用户不点就永远挂着；
4. 若降级成平台级，**同平台其他账号一并遭殃**（用户会认为「另一个号也被封了」）。

这与仓内既有纪律一致：小红书 DOM 轨早已把裸「滑块」「验证码」从词表删掉并留下「误判比漏判更有害」的注释；本次是把同一条纪律落到桌面侧与引擎侧。

---

## 2. 目标与非目标

### 2.1 目标

| 编号 | 目标 | 可验证判据 |
|---|---|---|
| G1 | 结构化风控信号优先于文本 | 结构化 `risk_blocked` / 风控码族命中即判 strong，且**文本完全不参与** |
| G2 | 文本词表加边界、分强弱 | 附录 A 全部 7 类误判样例 `suspends === false`；附录 B 全部真风控样例 `suspends === true` |
| G3 | 弱信号不挂起 | `strength === 'weak'` ⇒ `suspends === false`（不变量由单一真源给出） |
| G4 | `accountId` 缺失不再造成整平台误冻 | 弱信号 + 无账号 ⇒ 零挂起；强信号 + 无账号 ⇒ 仍平台级（真实风控不放松） |
| G5 | 横幅显示项能说清「哪一个、什么粒度、什么时候、凭什么」 | 4 个显示项：平台/账号名、粒度标签、检测时间、判定依据 |
| G6 | 词表单一真源，杜绝两侧漂移 | 桌面与引擎 require 同一个 `risk-signals.js` 模块 |

### 2.2 非目标

- **不引入任何自动恢复 / 自动换号**。合规红线不变：风控即停，恢复只能人工确认。
- **不改变「弱信号仍然停报不降级」的路由语义**。弱信号在 API 轨命中后依旧不回落 DOM（安全侧：不换路），只是不再冻结账号、不再弹风控提示。
- **不修改`参考产品`取证得来的强特征串**（`canvas illegal`、`账号存在风险`），仅调整其所在档位与边界。
- **不处理历史遗留的编码损坏文本**（如 `publisher-router.js` 里回退文案的乱码），另案。

---

## 3. 术语与数据模型

### 3.1 判定结果 `RiskVerdict`

单一真源 `packages/api-publish-engine/src/publish/core/risk-signals.js` 导出：

```js
/**
 * @typedef {{
 *   hit: boolean,                     // 是否命中任何风控信号（强弱并集）
 *   strength: 'strong'|'weak'|null,   // 分档
 *   signal: string,                   // 封闭词表记号，可安全持久化/跨进程/展示
 *   suspends: boolean                 // 是否允许挂起 ⇔ (hit && strength === 'strong')
 * }} RiskVerdict
 */
```

### 3.2 `signal` 记号词表（封闭，长度 ≤ 64）

| 记号形态 | 含义 | 示例 |
|---|---|---|
| `flag` | 调用方显式声明 `risk_blocked` | `flag` |
| `code:<code>` | 平台风控码族 | `code:601`、`code:BILI_RISK_601`、`code:10000015` |
| `strong:<词>` | 强信号词表命中 | `strong:风控`、`strong:安全验证` |
| `weak:<词>` | 弱信号词表命中 | `weak:验证`、`weak:601` |

**`signal` 不得是原始错误全文**：该字段会被持久化到 store 并跨进程广播到渲染层，平台回包原文可能含会话片段。因此只收封闭词表的记号，并在 `risk-suspender.js` 里截断到 64 字符（有回归锁）。

### 3.3 挂起记录 `SuspensionRecord`

```js
{
  platform: string,              // 必填，空则 suspend 抛错
  accountId: string|null,        // null ⇒ 平台级（覆盖该平台所有账号）
  reason: string,                // 'risk_blocked' | 'cleared' | ...
  at: number,                    // 毫秒时间戳（clock() 注入）
  signal?: string,               // 可选；旧记录无此字段
  strength?: 'strong'|'weak'     // 可选；旧记录无此字段
}
```

**键语义**（`platform::accountId`，`accountId==null` 记作 `*`）：

| 挂起记录 | 查询 `isSuspended('wechat_mp','acc-A')` | 查询 `isSuspended('wechat_mp', null)` |
|---|---|---|
| `wechat_mp::*`（平台级） | `true` | `true` |
| `wechat_mp::acc-A`（账号级） | `true` | `false` |
| `wechat_mp::acc-B`（账号级） | `false` | `false` |

### 3.4 判定档位定义

**强信号（`suspends: true`）** —— 平台风控专属措辞/码族，无语义歧义：

| 记号 | 说明 |
|---|---|
| `风控` | 中文风控专属词 |
| `滑块` | 滑块验证（真实风控独有） |
| `安全验证` | 平台安全验证弹层 |
| `验证弹层` | 弹层形态描述 |
| `操作频繁` | 平台限流/风控专属措辞 |
| `captcha` | 英文验证码 |
| `canvas illegal` | 参考产品 4.13.19 -110 码族取证串（抖音/西瓜） |
| `账号存在风险` | 参考产品风控提示原文 |
| `risk control` | 英文风控专属短语 |
| `risk_blocked` / `riskBlocked` / `RISK_BLOCKED` | 风控标志的字面形态 |
| `BILI_RISK` | B站风控码名前缀 |
| `验证失败(110)` | 抖音 `status_code===110` 的文案形态 |
| `10000015`（数字边界） | 百家号风控码 |
| **结构化 `flag`** | 调用方显式声明 |
| **结构化 `code` ∈ {`BILI_RISK_601`, `RISK_BLOCKED`, `601`, `10000015`, `-1e7`}** | 平台风控码族 |

**弱信号（`suspends: false`）** —— 宽泛词，可能出现在普通错误里：

| 记号 | 为什么只算弱 |
|---|---|
| `验证` | `身份验证失败`、`请先完成实名验证` 都会命中 |
| `频繁` | `请求过于频繁，请稍后重试` 是限流不是账号风控 |
| `risk`（标识符边界） | `low-risk content flagged` 会命中 |
| `frequent`（标识符边界） | 英文子串风险 |
| `verify`（标识符边界） | 英文普通动词 |
| `601`（数字边界） | HTTP 状态码 / ID / 时间戳片段 |

**边界规则：**

- 数字记号用数字边界 `(?<!\d)…(?!\d)`：`1601`、`6019`、`1601846521`、`100000159` 一律**不**命中。
- 英文记号用标识符边界 `(?<![A-Za-z0-9])…(?![A-Za-z0-9])`：下划线算边界（故 `BILI_RISK_601` 能命中），字母数字不算（故 `derisk`、`infrequent`、`verified` 不命中）。

**排除规则：** 文本含 `risk_suspended`（守卫自身标记）⇒ 判定为 `hit: false`。这是自触发防线；桌面侧另有 `isRiskSuspendedMessage` 双保险。

---

## 4. 数据校验

### 4.1 判定入口 `classifyRisk(input)` 的入参校验

| 入参 | 合法域 | 非法处理 |
|---|---|---|
| `input.error` | `string` | 非字符串（`null`/`undefined`/`object`/`number`/`array`/`boolean`）⇒ 按空串，不抛错 |
| `input.code` | `string` 或 `number` | 其它类型 ⇒ 不参与码族匹配 |
| `input.riskBlocked` / `input.risk_blocked` | `=== true` 严格比较 | `'true'`、`1` 等真值**不**算（避免把字符串配置当标志） |
| `input` 整体 | 可省略 | `classifyRisk()` / `classifyRisk({})` ⇒ 全 `false`/`null`/`''` |

空文本（`''`）与纯空白按「无信号」处理，返回 `NOT_HIT`。

### 4.2 挂起入参校验（`risk-suspender.suspend`）

| 字段 | 规则 | 非法处理 |
|---|---|---|
| `platform` | 非空字符串 | 空/缺失 ⇒ **抛错**（`risk-suspender: suspend requires platform`） |
| `accountId` | `string` / `null` / `undefined` | `null`/`undefined` 统一归一为 `null` ⇒ 平台级 |
| `signal` | 非空 `string` | 非字符串或空 ⇒ 字段**不写入** |
| `signal` 长度 | ≤ 64 | 超长截断 |
| `strength` | 严格 `'strong'` 或 `'weak'` | 其它值（如 `'bogus'`）⇒ 字段**不写入**（避免 UI 把任意字符串当依据展示） |
| `at` | `number` | 缺失 ⇒ 取注入 `clock()` |

### 4.3 渲染层清单校验（`risk-suspended-tracker.normalize`）

| 字段 | 规则 | 非法处理 |
|---|---|---|
| 数组来源 | `Array` / `{suspended:[…]}` / `{code,data:[…]}` 三形态 | 其它 ⇒ 空清单 |
| 单条记录 | 必须有非空 `platform: string` | 无 `platform` 的记录被**过滤**（含 `null`、裸字符串） |
| `accountId` | `== null` ⇒ `null` | 原样 |
| `reason` | `string` | 非字符串 ⇒ `''` |
| `at` | `number` | `null` ⇒ `null` |
| `signal` | `string` | 非字符串 ⇒ `''` |
| `strength` | 严格 `'strong'`/`'weak'` | 其它 ⇒ `null`，UI 据此**不渲染**判定依据（不猜） |

### 4.4 IPC 入参校验（`publishRisk.resume` / `publishRisk.isSuspended`）

| 字段 | 规则 | 非法处理 |
|---|---|---|
| `platform` | `/^[a-zA-Z0-9_-]+$/` | ⇒ `{code: VALIDATION_ERROR, message: 'platform 必须为合法平台标识'}` |
| `accountId` | `null` 或同平台格式 | ⇒ `{code: VALIDATION_ERROR, message: 'accountId 格式无效'}` |
| `riskSuspender` 未注入 | — | ⇒ `{code: REQUEST_ERROR, message: '风控挂起服务未初始化'}` |

---

## 5. 流程

### 5.1 判定与挂起流程（修复后）

```
task:failed(task)
  │
  ├─ ① 组装判定入参
  │     error       = task.error                      (string)
  │     code        = task.errorCode                  ← 新增：传输层搬运
  │     riskBlocked = task.riskBlocked === true       ← 新增：传输层搬运
  │
  ├─ ② classifyRisk(...)   ← 结构化优先，文本兜底，分强弱
  │     结构化 flag        → { hit, strong, 'flag',      suspends:true  }
  │     code ∈ 风控码族     → { hit, strong, 'code:…',    suspends:true  }
  │     文本含强信号词      → { hit, strong, 'strong:…',  suspends:true  }
  │     文本仅含弱信号词    → { hit, weak,   'weak:…',    suspends:false }
  │     文本含 risk_suspended→ { hit:false }             (自触发防线)
  │     无信号              → { hit:false }
  │
  ├─ ③ 分支
  │     suspends === true  && !isRiskSuspendedMessage(task.error)
  │        ├─ accountId = task.article.accountId || task.accountId || null   ← 账号优先
  │        ├─ riskSuspender.suspend(platform, accountId, { reason, error, signal, strength })
  │        ├─ 广播 publish:risk-suspended { suspended: 全量清单 }
  │        └─ 发送 publish:risk-hold { platform, accountId, taskId, error, signal, strength }
  │
  │     hit === true 但 suspends === false（弱信号 / 自身拦截消息）
  │        └─ 仅结构化日志 weak-signal-not-suspended（不挂起、不广播、不提示）
  │
  │     hit === false
  │        └─ 无事发生（失败仍照常进进度条与发布历史）
  │
  └─ ④ 主窗口不存在（win 销毁）⇒ 整段跳过（挂起仍需窗口才能广播；崩溃恢复靠水合）
```

**为什么弱信号不发 `publish:risk-hold`**：该 IPC 的唯一消费端会弹「检测到风控」toast。弱信号命中率高（`身份验证失败` 这类日常失败都会命中），发出去等于把「风控」这个标签贴到普通失败上——**提示本身也是一次误报**。失败原因仍可通过进度条（`stage: '✗ 发布失败: …'`）与发布历史（`status: 'failed'` + `error` 原文）看到，用户看到的是平台原文而不是我们贴错的标签。

### 5.2 派发前置守卫（不变）

```
bootstrap.setExecutor(task)
  ├─ signal.aborted?                          → throw '任务已取消'
  ├─ riskSuspender.isSuspended(platform, taskAccountId)?
  │     → throw RiskSuspendedError  (code='risk_suspended', noRetry=true)
  │       ⇒ taskQueue 直接判 failed，不重试、createPublisher 零调用、零请求
  └─ 正常发布
```

`accountId` 取 `task.article?.accountId`；`null` 时命中平台级挂起记录。

### 5.3 恢复流程（不变，人工确认）

```
用户点「恢复发布」
  → riskStore.resume(platform, accountId)
      → tracker.resume
          ├─ confirm({platform, accountId})  ← ElMessageBox 人工确认（缺省 false ⇒ 不恢复）
          │     取消 ⇒ { ok:false, reason:'cancelled' } 静默保持挂起
          └─ IPC publishRisk.resume
                 ├─ 校验 platform / accountId
                 ├─ riskSuspender.resume(platform, accountId)
                 ├─ 广播 publish:risk-suspended { suspended: 全量清单 }
                 └─ { code:0, data:{ changed, suspended } }
  → 成功 notifySuccess('publish.riskHold.resumed')
  → 失败 notifyError('publish.riskHold.resumeFailed', { message })
```

**不提供任何自动恢复路径**：`risk-suspender` 无计时器、无 TTL、无自动换号。

### 5.4 持久化与水合

```
suspend() → inner.suspend() → persist() → store.setSetting('publish.riskSuspended', listSuspended())
任意读取（isSuspended / listSuspended / resume）→ hydrate()（幂等，首次从 store 回填）
  └─ 回填字段：platform / accountId / reason / at / signal / strength
     读失败 ⇒ 按空集（fail-open on read，不阻断发布）
     写失败 ⇒ 仅告警（fail-soft）
```

**升级兼容**：旧记录无 `signal`/`strength`，水合后字段为 `undefined`，UI 据此**不渲染**「判定依据」标签（不猜、不兜底成「平台风控拦截」）。

---

## 6. 功能逻辑

### 6.1 结构化优先（G1）

判定顺序固定为「标志 → 码族 → 文本」，**前两者命中时文本完全不参与**。这保证：

- 适配器/引擎已经算准的结论不再被错误文本推翻；
- 即使平台返回的文案措辞变化（例如本地化成英文或改词），只要它同时置了 `risk_blocked` 或风控码，判定仍然正确；
- 文本兜底只服务「只拿到一段 error 字符串」的降级路径（如 RPA 轨只回传文案）。

### 6.2 强弱分档（G2/G3）

- **强信号允许挂起**：这些措辞/码在实测中只出现在真实风控。
- **弱信号不允许挂起**：这些词在普通失败里高频出现。
- 不变量 `suspends ⇔ (hit && strength === 'strong')` **由单一真源给出**，调用方（桌面 `phase4-events`、引擎 `publish-mode-runner`）只读 `suspends`，不得自行推导（否则又是一个漂移点）。

**召回影响评估**：仓内全部真实风控来源（附录 B）收紧后**仍全部落在强档**，包括：
- 抖音 110 的文案形态已显式收入强档（`验证失败(110)`），其结构化 `risk_blocked` 亦在强档；
- B站 601 由 `风控` + `滑块验证` + 码族三重覆盖；
- 快手/百家号/小红书由 `风控` 覆盖。

唯一由强档转为弱档的是**合成夹具** `抖音安全 verify 拦截`（仅出现在测试里，非生产文案）；其路由语义（停报不降级）由并集判据 `isRiskText` 保持不变。

### 6.3 粒度决策（G4）

| 信号档位 | `accountId` | 决策 | 理由 |
|---|---|---|---|
| strong | 有 | 账号级挂起 | 精确打击，不牵连同平台其他账号 |
| strong | 无 | **平台级挂起**（覆盖全平台） | 真实风控下宁可多拦；账号未知时用户会逐个账号重试，风险更大 |
| weak | 有 | **不挂起** | 误判代价 > 漏判代价 |
| weak | 无 | **不挂起** | 同上，且平台级误冻代价更高 |
| 无命中 | — | 不挂起 | — |

`accountId` 解析改为 `task.article?.accountId || task.accountId || null`（此前只有 `task.article?.accountId`）。`task.accountId` 是 `task-queue.add()` 的归一字段（`task.accountId ?? task.article?.accountId ?? null`），因此这次兜底把「批量发布只勾平台、不勾账号」以外的场景都收成账号级，减少了「误升平台级」的概率。

### 6.4 单一真源（G6）

修复前存在**两份**各自演化的词表：

| 位置 | 修复前内容 |
|---|---|
| `packages/api-publish-engine/src/publish/core/publish-mode-runner.js` | `/风控\|risk\|滑块\|601\|10000015\|frequent\|频繁\|verify\|验证\|canvas illegal\|账号存在风险/i` |
| `apps/desktop/electron/services/publish-risk.js` | `/风控\|risk\|滑块\|601\|10000015\|frequent\|频繁\|verify\|验证\|安全验证\|操作频繁\|captcha\|canvas illegal\|账号存在风险/i` |

两者注释都写着「保持同义」，实际已漂移（桌面多 3 个词）。现在两处都 require `risk-signals.js`，桌面侧仅保留兼容签名 `isRiskBlocked`。

**接口分工：**

| 导出 | 语义 | 用途 |
|---|---|---|
| `classifyRisk(input)` | 完整判定（四字段） | 挂起决策（读 `suspends`） |
| `isRiskText(text)` / `isRiskBlocked(text)` | 强弱并集「像不像风控」 | 路由判据（API 轨命中即停报不降级） |
| `RISK_ANY_RE` / `RISK_STRONG_RE` / `RISK_WEAK_RE` | 裸词表 | 边界断言、诊断 |
| `RISK_CODES` | 风控码族 `Set` | 码族判定与诊断 |

---

## 7. 交互逻辑

### 7.1 触发时机

| 事件 | 交互 |
|---|---|
| 发布失败且判定 `suspends === true` | （1）账号页横幅出现/刷新；（2）warning toast `publish.riskHold.suspended`（由 `main.js` 的 `useRiskStore.start({notify})` 在挂起清单非空时弹出）；（3）`risk-hold-notifier` 另弹 `publish.riskHold.body` |
| 发布失败但仅弱信号命中 | **无任何提示**；失败原因仍在进度条与发布历史 |
| 进入账号页 | 横幅按权威清单渲染（`start()` 会 `refresh()` 拉取一次，重启后依旧可见） |
| 挂起清单被广播（挂起/恢复） | 清单整体替换（非增量），横幅随之增加/移除条目 |
| 发布页选择器 | 账号/平台显示 `publish.riskHold.badge`（`⚠ 风控挂起`）徽标，hover title 给 `guidance`/`guidanceAllAccounts` |

### 7.2 挂起清单为空

横幅 `v-if="items.length"` 整块不渲染——不得出现空壳横幅。

### 7.3 恢复交互

1. 点「恢复发布」→ 该条按钮进入 disabled（`busyKeys` 按 `platform::accountId` 去重，防连点）。
2. 弹人工确认 `publish.riskHold.resumeConfirm`。
3. 取消 ⇒ 静默、状态不变（`{ok:false, reason:'cancelled'}`），按钮恢复可点。
4. 确认成功 ⇒ `notifySuccess('publish.riskHold.resumed')`，清单经广播刷新，条目消失。
5. 主进程返回非零 ⇒ `notifyError('publish.riskHold.resumeFailed', {message})`，条目保留。

### 7.4 无障碍

横幅容器 `role="status"` + `aria-live="polite"`；粒度标签 `role="status"`（原实现保留）；徽标 `role="status"`。

---

## 8. 显示项

### 8.1 横幅（`RiskSuspendedBanner.vue`）

| 显示项 | 数据来源 | 渲染条件 | 文案 key |
|---|---|---|---|
| 标题（通用） | `items.length`、`items[0].platform` | 清单**非全部**为平台级 | `publish.riskHold.suspended` |
| 标题（全平台级） | 同上 | 清单**全部** `accountId == null` | `publish.riskHold.suspendedAllAccounts` |
| 平台名 | `platform` → `platformStore.getLabel()` | 每条 | 平台标签（i18n 数据源） |
| 粒度标签 | `accountId == null` | 平台级条目 | `publish.riskHold.scopeAllAccounts` |
| 账号名 | `accountId` | 账号级条目 | 原样显示（不翻译） |
| 检测时间 | `at`（毫秒）→ `HH:mm` | `at` 为合法正数 | `publish.riskHold.detectedAt` |
| 判定依据 | `strength` | `'strong'` / `'weak'`；**无值时整项不渲染** | `evidenceStrong` / `evidenceWeak` |
| 恢复按钮 | — | 每条 | `publish.riskHold.resume` |

**时间格式**：本地时区 `HH:mm`（两位数补零）。`at` 缺失 / 非数字 / `<= 0` / `NaN` ⇒ 返回空串 ⇒ 该显示项不渲染（不显示 `Invalid Date`）。

### 8.2 发布页选择器（`PublishTargetSelector.vue`，未改动）

| 显示项 | 条件 |
|---|---|
| 平台级徽标 | 该平台存在 `accountId == null` 的挂起记录 |
| 账号级徽标 | 该账号命中（平台级覆盖该平台所有账号） |
| hover title | 平台级 ⇒ `guidanceAllAccounts`；账号级 ⇒ `guidance` |

### 8.3 判定依据标签的语义边界

- `evidenceStrong` = 「判定依据：平台风控拦截」——结构化标志 / 风控码族 / 强信号词。
- `evidenceWeak` = 「判定依据：疑似风控信号（弱）」——弱信号。**当前不会出现在横幅上**（弱信号不挂起）；保留用于历史记录与后续策略调整，且 UI 不把无值猜成强档。

---

## 9. 提示文字（zh / en 全量表）

`apps/desktop/src/locales/publish/{zh,en}.js` 的 `riskHold` 命名空间：

| key | zh | en | 变更 |
|---|---|---|---|
| `suspended` | 检测到风控，「{platform}」等 {count} 个发布目标已自动暂停后续发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页手动恢复。 | Risk control detected. {count} publish target(s) including "{platform}" have been paused automatically. Go to the platform creator center, publish one post manually and pass the verification, then resume from the Accounts page. | 不变 |
| `suspendedAllAccounts` | 检测到风控，「{platform}」该平台全部账号已自动暂停后续发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页手动恢复。 | Risk control detected. All accounts for "{platform}" have been paused automatically. Go to the platform creator center, publish one post manually and pass the verification, then resume from the Accounts page. | **新增** |
| `scopeAllAccounts` | 全平台账号 | All accounts | **新增** |
| `detectedAt` | 检测于 {time} | Detected at {time} | **新增** |
| `evidenceStrong` | 判定依据：平台风控拦截 | Reason: platform risk control | **新增** |
| `evidenceWeak` | 判定依据：疑似风控信号（弱） | Reason: possible risk signal (weak) | **新增** |
| `guidanceAllAccounts` | 该平台全部账号因平台风控已暂停发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。 | Publishing is paused for all accounts of this platform due to platform risk control. Go to the platform creator center, publish one post manually and pass the verification (a verification prompt will appear during publishing), then lift the hold on the Accounts page. | **新增** |
| `guidance` | 该账号因平台风控已暂停发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。 | Publishing is paused for this account due to platform risk control. … | 不变 |
| `badge` | ⚠ 风控挂起 | ⚠ Risk hold | 不变 |
| `body` | 检测到「{platform}」发布触发风控。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。 | Risk control detected while publishing to "{platform}". … | 不变 |
| `resume` | 恢复发布 | Resume publishing | 不变 |
| `resumeConfirm` | 确认恢复「{platform}」的发布？请确保已在该平台创作者中心完成验证（手动发布一篇内容并通过验证），否则会再次触发风控暂停。 | Resume publishing to "{platform}"? … | 不变 |
| `resumed` | 已恢复「{platform}」的发布 | Resumed publishing to "{platform}" | 不变 |
| `resumeFailed` | 恢复发布失败：{message} | Failed to resume publishing: {message} | 不变 |

**约束**：

- zh/en **必须成对**（CI Gate 7 `check-locale-sync.js` 拦截）。
- 渲染端 `src/` **非 locales** 文件不得新增中文字符串字面量（CI 基线扫描拦截）——`RiskSuspendedBanner.vue` 的所有中文只允许出现在注释里。
- 新增 key 后必须同步 `--keys` 基线快照。

**日志文案（非用户可见，结构化字段）**：

| 日志点 | 级别 | 字段 |
|---|---|---|
| `RiskSuspender.weak-signal-not-suspended` | WARN | `platform`、`accountId`（缺省 `(none)`）、`signal`、`strength`、`selfGuarded` |
| `RiskSuspender.suspend-failed` | WARN | `error` |
| `publish-mode.risk signal weak → stop without suspend` | WARN | `platform`、`mode`、`accountId`、`outcome`、`signal`、`strength` |

---

## 10. 边界与失败模式

| 场景 | 期望行为 |
|---|---|
| `task.error` 非字符串（`undefined`） | `classifyRisk` 返回 `NOT_HIT`，不挂起、不抛 |
| `task.error` 为空、`riskBlocked=true` | 结构化优先 ⇒ 挂起（不看文本） |
| 主窗口已销毁 | 跳过整个风控段（不挂起、不广播） |
| `riskSuspender` 未接线 | 不挂起；强信号仍发 `publish:risk-hold`（向后兼容，既有测试锁定） |
| `suspend()` 抛错 | `try/catch` 捕获并记 `suspend-failed` WARN，不影响失败主流程 |
| store 读失败 | 按空集水合（fail-open），不阻断发布 |
| store 写失败 | 仅 WARN，内存态仍可用 |
| 持久化记录为脏数据（无 `platform`） | 跳过该条，其余照常恢复 |
| `strength` 为非法值 | 不写入记录；渲染层归一为 `null` ⇒ 不显示依据 |
| 同一窗口内重复挂起同键 | 幂等：更新记录、不重复通知 |
| `resume` 未命中 | `changed: false`，不报错 |
| 弱信号 + 无账号 | 零挂起、零提示（G4 核心场景） |
| 自身拦截消息（`risk_suspended`） | `hit: false`，不二次挂起（自触发防线） |

---

## 11. 验收标准

| 编号 | 验收项 | 判据 |
|---|---|---|
| AC-1 | 附录 A 的 7 类普通失败**不再挂起** | `classifyRisk(...).suspends === false`；phase4 测试断言零 `publish:risk-suspended`、零 `publish:risk-hold` |
| AC-2 | 附录 B 的真风控**仍然挂起** | `strength === 'strong'` 且 `suspends === true`；phase4 断言 `suspend` 被调用 |
| AC-3 | 结构化信号优先 | `{ riskBlocked:true, error:'网络超时' }` ⇒ 挂起且 `signal === 'flag'` |
| AC-4 | 弱信号不挂起 | 不变量测试：`suspends ⇔ (hit && strength==='strong')` 对全部样本成立 |
| AC-5 | `accountId` 缺失时弱信号零挂起、强信号仍平台级 | phase4 测试 `t4`（弱，`suspend` 未调用）与 `t5`（强，`accountId === null`） |
| AC-6 | 结构化信号真的从传输层落到了 task | task-queue 集成测试：抛错携带 `code`/`riskBlocked` ⇒ `task.errorCode`/`task.riskBlocked` 正确（并做过变异反证：改成 no-op 立红 2 例） |
| AC-7 | 横幅 4 个显示项接线存在 | `RiskSuspendedBanner.source.test.js` 8 例 |
| AC-8 | `signal`/`strength` 跨持久化与跨进程不丢 | 引擎 `risk-suspender` 测试 + 桌面 store 水合测试 + tracker `normalize` 测试 |
| AC-9 | zh/en 成对且渲染层无裸中文 | Gate 7 locale 同步 + CJK 基线 |
| AC-10 | 单一真源 | 桌面测试断言 `classifyRisk === engine.classifyRisk`（同一函数引用） |

---

## 12. 影响面与回归

| 层 | 文件 | 变更性质 |
|---|---|---|
| 引擎（单一真源） | `packages/api-publish-engine/src/publish/core/risk-signals.js` | **新增** |
| 引擎 | `packages/api-publish-engine/src/publish/core/publish-mode-runner.js` | 词表收敛 + 挂起加强弱闸门 |
| 引擎 | `packages/api-publish-engine/src/publish/core/risk-suspender.js` | 记录增加 `signal`/`strength`（可选、截断、白名单校验） |
| 引擎 | `packages/api-publish-engine/src/index.js` | `publishViaApi` 抛错保留 `code`/`risk_blocked`/`loginExpired` |
| 桌面主进程 | `apps/desktop/electron/services/publish-risk.js` | 收敛为真源包装 + 兼容签名 |
| 桌面主进程 | `apps/desktop/electron/services/publisher-router.js` | 新增 `attachRiskSignals`，三个发布器抛错时搬运 |
| 桌面主进程 | `apps/desktop/electron/services/risk-suspender-store.js` | 水合透传 `signal`/`strength` |
| 桌面主进程 | `apps/desktop/electron/bootstrap/phase4-events.js` | 判定三原则落地 |
| 共享 | `packages/shared-utils/src/task-queue.js` | 失败时把 `code`/`riskBlocked` 落到 task |
| 渲染层 | `apps/desktop/src/services/risk-suspended-tracker.js` | `normalize` 保留 `signal`/`strength` |
| 渲染层 | `apps/desktop/src/features/accounts/components/RiskSuspendedBanner.vue` | 三个新显示项 + 标题分流 |
| 文案 | `apps/desktop/src/locales/publish/{zh,en}.js` | 5 个新 key（成对） |
| 测试 | 见第 11 节 | 新增/扩展 8 个测试文件 |

**QM-1**：改 `apps/desktop/electron/**` ⇒ 需本地打包验证。
**不涉及**：`platforms.yaml`、IPC 通道契约、`preload` 键数、数据库 schema。

---

## 附录 A：误判取证表（修复前会挂起，修复后不挂起）

| # | 错误文本 | 修复前命中原因 | 修复后 | 现实对应 |
|---|---|---|---|---|
| A1 | `Request failed with status code 601` | 裸数字 `601` | `weak:601`，不挂起 | 代理/网关返回非标准状态码 |
| A2 | `publish id 6019 not found` | 裸数字 `601` 子串 | 不命中（数字边界） | 作品 ID 含 601 |
| A3 | `gateway timeout ts=1601846521` | 裸数字 `601` 子串 | 不命中（数字边界） | 时间戳含 601 |
| A4 | `errno 100000159: bad request` | 裸数字 `10000015` 子串 | 不命中（数字边界） | 错误码邻居 |
| A5 | `infrequent login detected` | `frequent` 子串 | 不命中（标识符边界） | 英文错误里的单词片段 |
| A6 | `low-risk content flagged` | `risk` 英文普通词 | `weak:risk`，不挂起 | 平台内容分级提示 |
| A7 | `身份验证失败` / `请先完成实名验证` | `验证` 中文普通词 | `weak:验证`，不挂起 | 登录/实名校验失败 |

> 取证方法：把发布链路上 674 个源文件的「像错误文案」字符串字面量全量喂给判定函数，剔除自身含风控特征的条目后逐条人工核对（见 `openspec/records/fix-risk-hold-false-positive.md` 的取证小节）。

## 附录 B：真实风控来源表（修复后仍挂起）

| 平台 | 触发条件 | 错误文案 | 判定路径 |
|---|---|---|---|
| 抖音 | `x-tt-verify-passport-decision` 响应头 | 抖音触发安全验证，请在创作者中心手动完成验证后重试（不自动换号） | 结构化 `risk_blocked:true` + `安全验证` |
| 抖音 | `status_code === 110` | 抖音验证失败(110)，请手动完成验证后重试 | 结构化 `risk_blocked:true` + `验证失败(110)` |
| B站 | `code === 601` | B站风控(601)：请先在创作者中心完成滑块验证后重试 | 码族 `code:601` + `风控` + `滑块` |
| 快手 | 提交返回验证页/非 JSON | 快手返回验证页/非 JSON 应答，疑似风控拦截，请在创作者中心手动确认后再试（不自动验证、不换号） | 结构化 + `风控` |
| 百家号 | `errno === 10000015` | 百家号风控拦截：…请完成验证 | 码族 `code:10000015` + `风控` |
| 小红书 | DOM 检出风控/验证弹层 | 检测到风控/验证弹层，已停止 | `风控` + `验证弹层`（`XHS_RISK_BLOCKED`） |
| 参考产品取证 | -110 码族 | `canvas illegal` / `Canvas Illegal: …` | 强档词 |
| 参考产品取证 | 风控提示原文 | 官方检测到您的账号存在风险，请先前往创作者中心发布作品 | `账号存在风险` |

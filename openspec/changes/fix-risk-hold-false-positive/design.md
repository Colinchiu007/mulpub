# Design — fix-risk-hold-false-positive

## 1. 决策记录

### D1：判定顺序 = 结构化标志 → 码族 → 文本（而非「文本优先，结构化兜底」）

**选它**：结构化信息是发布链**已经算出来**的结论（适配器读了响应头/状态码），文本是人类可读的副产品。让副产品覆盖结论，等于用最不可靠的输入决策最贵的动作（冻结账号）。

**否决的备选**：`文本命中即挂起，结构化只用于补充诊断`。这正是修复前的实际行为，也是本次误判的直接成因。

**代价**：需要打通 `Error` → `task` 的信号搬运（7 处接线）。**接受**：不搬就等于「结构化优先」只是一句注释。

### D2：文本词表分强弱，弱信号**既不挂起也不提示**（而不是「弱信号挂起但提示弱」）

**选它**：`publish:risk-hold` IPC 的唯一消费端会弹「检测到风控」toast。弱信号命中率高（`身份验证失败` 这类日常失败都会命中），发出去等于把「风控」标签贴到普通失败上——**提示本身也是一次误报**。

**否决的备选 A**：`弱信号走独立文案（如「疑似风控信号，已跳过自动暂停」）`。否决理由：这类提示对用户**不可行动**（他既不用去创作者中心，也不需要做任何事），只在每次登录失效时增加噪音。失败原因仍可在进度条与发布历史看到平台原文。

**否决的备选 B**：`弱信号挂起账号级（只不挂平台级）`。否决理由：`身份验证失败` 会冻结账号，用户仍要人工解封——误判代价没有实质下降。

**风险**：真实风控若只用「验证」措辞且**不带结构化标志**，会被漏掉。缓解：附录 B 逐条核对了仓内全部真实风控来源，全部落在强档；抖音只带裸「验证」的那条文案（`验证失败(110)`）已显式收入强档。

### D3：数字与英文词加边界，但**下划线算边界**

**选它**：`(?<![A-Za-z0-9])risk(?![A-Za-z0-9])` 让 `BILI_RISK_601` 命中而 `derisk` 不命中。若用 `\brisk\b`，`_` 是词字符 ⇒ `BILI_RISK_601` / `risk_suspended` **反而匹配不上**，会破坏既有能力。

**代价**：`risk_suspended` 会被弱档命中 ⇒ 另加显式排除（见 D4）。

### D4：`risk_suspended` 的排除放在判定函数，而非裸正则

**选它**：裸正则只表达「词表里有这个词」，语义判定（「这是不是平台信号」）在函数里。桌面侧另有 `isRiskSuspendedMessage` 双保险，两层职责清晰。已加锁钉住这个分工（测试断言 `RISK_ANY_RE` 命中而 `isRiskText` 不命中）。

### D5：`601` 留在弱档而不是删除

**选它**：真实 B站风控文案含「风控」「滑块验证」（强档已覆盖），码族路径也覆盖 `code:601`；裸 `601` 与 HTTP 状态码/ID/时间戳无法区分 ⇒ 留在弱档保留「像风控」语义（路由仍停报不降级），但不挂起。

**否决**：直接删掉 `601`。理由：会使 `outcomeOfResult` 对只带文本 `601` 的历史夹具失去风控语义，且丢掉了「可能是风控」这一信息。

### D6：`accountId` 解析加 `task.accountId` 兜底

**选它**：`task-queue.add()` 已把账号归一为任务级字段（`task.accountId ?? task.article?.accountId ?? null`），而 `phase4-events` 此前只读 `task.article.accountId`。补上兜底能减少「误升平台级」这一放大器的触发概率。

**保留**：强信号 + 无账号仍是平台级挂起（真实风控下宁可多拦）。

### D7：判定依据只存**封闭词表记号**，不存原始错误文本

**选它**：`signal`/`strength` 要持久化到 store 并跨进程广播到渲染层，平台回包原文可能含会话片段。记号码表 + 64 字符截断，既满足「用户能看到凭什么挂起」，又不把平台原文落盘。

**代价**：用户看不到具体是哪条错误。**接受**：发布历史里已有 `error` 原文（`status:'failed'` + `error`），需要时从那里查。

### D8：新建 `risk-hold-guard` 能力规格，而不是塞进既有能力

**选它**：`openspec/specs/` 里没有任何一份规格描述过「什么信号可以挂起、挂到什么粒度」。既有实现散落在 W1 各切片文档与代码注释里 —— 这个缺口正是本次误判能长期存活的土壤。

## 2. 数据流

```
适配器/链                     结构化结论（risk_blocked / code）
   │
   ▼
publishViaApi / publisher-router     attachRiskSignals(err, result)
   │  Error{message, code, riskBlocked}
   ▼
task-queue  catch                    task.error / task.errorCode / task.riskBlocked
   │
   ▼
phase4-events  task:failed           classifyRisk({error, code, riskBlocked})
   │                                   → {hit, strength, signal, suspends}
   ├─ suspends ──► riskSuspender.suspend(platform, accountId, {reason, error, signal, strength})
   │                  → persist('publish.riskSuspended')   [signal 截断 64、strength 白名单]
   │                  → 广播 publish:risk-suspended
   │                       → tracker.normalize（保留 signal/strength）
   │                            → useRiskStore.suspended
   │                                 → RiskSuspendedBanner（4 个显示项）
   └─ 非 suspends ─► 仅 WARN 日志 weak-signal-not-suspended
```

## 3. 风险与回退

| 风险 | 影响 | 缓解 | 回退 |
|---|---|---|---|
| 真实风控只用弱措辞且无结构化标志 | 漏挂起，账号继续撞风控 | 附录 B 逐条核对，全部真实来源在强档；抖音 110 文案已显式收入强档 | 把该措辞从弱档移入强档（单点改动） |
| 结构化信号搬运在某条链上漏接线 | 该链退回文本判定 | task-queue 集成测试 + task 上字段缺省值锁；phase4 直接读 task 字段 | 修对应发布器的 `attachRiskSignals` 调用 |
| `signal` 落盘引入敏感信息 | 隐私 | 只存封闭词表记号 + 64 字符截断 + 白名单校验；原始 `error` 不入记录 | 清空 store 键 `publish.riskSuspended` |
| 弱档收紧后用户不再收到风控提示 | 用户不知道去验证 | 强档仍弹 `body`/`suspended` 两个 toast + 横幅 | 调 `RISK_WEAK_RE` |
| 旧记录无 `strength` 导致横幅少一行 | 显示项缺失 | 明确「不猜」，仅少一个标签；时间与粒度照常显示 | 无（有意行为） |

## 4. 未闭环 / 遗留

- **真机端到端验收**：本机无可用公众号/抖音等风控触发会话，**「真实风控命中 → 挂起 → 横幅 → 人工恢复」全链真机回归未做**。本次验收边界为单元 + 集成层（含变异反证）。
- **`publisher-router.js` 回退文案的编码损坏**（`'鍙戝竷澶辫触'`）本次**刻意未修**（属另一议题，避免无关 churn），已在 record 中登记。
- **弱信号的可观测性**：弱信号只进日志，设置页/诊断页暂无可视化入口；如需排查「为什么这次没暂停」，需查日志。

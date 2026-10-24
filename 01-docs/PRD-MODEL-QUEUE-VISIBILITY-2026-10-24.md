# PRD：模型调用排队可见性（本地限流器排队提示）

- **文档编号**：PRD-MODEL-QUEUE-VISIBILITY-2026-10-24
- **状态**：已实现（随 PR 落地）
- **日期**：2026-10-24
- **关联执行记录**：`openspec/records/model-queue-visibility.md`
- **关联方案（服务端集中闸门，尚未实施）**：`01-docs/PRD-MODEL-GATE-SERVER-SIDE-2026-10-24.md`（本文是其「客户端可独立交付」的前半段）

---

## 1. 背景与问题

桌面端调用模型服务商 API 时，受**本地限流器**（`apps/desktop/electron/services/api-usage-governor.js`）约束：

| 机制 | 行为 | 等待上限 |
|---|---|---|
| 并发信号量 | 同一 provider 同时在途请求数超过 `maxConcurrent` ⇒ 后续请求排队 | 30s（`MAX_QUEUE_WAIT_MS`）|
| RPM 时间槽 | 每 60 秒按 `rpm` 划出时间槽，请求预约下一个槽位 | 180s（`MAX_PACE_WAIT_MS`）|
| 429 冷却 | 服务商返回 429 ⇒ 冷却期（`cooldownMs`，LLM 默认 30s）| 45s（`MAX_COOLDOWN_WAIT_MS`）|

**问题**：这三种等待期间，**界面完全没有反馈**。用户看到的是"卡住了"，
30~45 秒后突然弹出一条「操作过于频繁，已被服务商限流」。
用户无法区分这三种情况，也无从判断"还要等多久"。

**已确认的事实**（本文所有结论均已回源码核实，见 §9 证据索引）：

1. 排队期间**没有任何进度事件**发往渲染层 ⇒ 用户只看到静止的进度条。
2. 限流器内部**已有**排队与等待量数据（`_state` 的 `waiters` 与 `nextSlotAt`），
   但**没有对外暴露**，也没有任何消费方。
3. 「排在第几位（全局）」在当前形态下**算不出来**：限流器是**单机进程内**的，
   只知道自己这台机器上的等待者 ⇒ 全局位次需要服务端集中准入（另一条线）。

---

## 2. 目标与非目标

### 2.1 目标

| # | 目标 | 可验证口径 |
|---|---|---|
| G1 | 排队期间用户能看到**明确的状态提示**（不再是"卡住了"）| 排队时界面出现提示条；排队结束提示消失 |
| G2 | 能告知**还要等多久**（能算出精确值时）| RPM 槽排队 ⇒ 显示精确 ETA |
| G3 | 排队等待**有界且可预期**（不给无限等待的错觉）| 超上限的等待直接判失败，不进"无限排队" |
| G4 | 提示**不骗人**：算不出时间就不显示时间 | 并发槽排队只报数量，不报时间 |
| G5 | 零新增 preload API、零新增依赖、零外部网络调用 | 门禁与依赖审计无新增 |

### 2.2 非目标（本期明确不做）

| # | 不做的事 | 原因 |
|---|---|---|
| N1 | **不显示"排在第几位（全局）"** | 单机限流器没有全局视野；给了就是假数据 |
| N2 | **不做服务端集中准入闸门** | 依赖"平台代持 Key"的接线，属另一条线（见关联 PRD）|
| N3 | **不改限流行为**（不调 rpm、不调并发、不改退避）| 本期只做**可见性**，不改变调度语义 |
| N4 | **不改各阶段执行器**（story2video 等）| 那些文件在「点名还账、零容差」名单内，改动成本远大于收益 |

---

## 3. 用户旅程与状态机

### 3.1 一次模型调用的完整状态

```
用户点击「生成」
   │
   ├─ 阶段进入 running
   │
   ├─ 发起模型调用 → 限流器准入
   │     ├─ 有空闲槽位 + 下一个时间槽已到   → 立即执行（无排队）
   │     ├─ 并发槽被占满                    → 【排队中】等待者 N 个 ⇒ 只报数量
   │     └─ 时间槽未到                       → 【排队中】有精确 ETA
   │
   ├─ 等待（可能 0 ~ 45 秒）
   │     ├─ 界面持续显示排队提示（阶段进度区）
   │     └─ 提示随位次/ETA 变化而更新
   │
   ├─ 拿到槽位 → 真正发起厂商调用
   │     ├─ 成功 → 阶段继续
   │     └─ 厂商 429 → 冷却 + 退避重试（最多 3 次尝试，LLM 类）
   │           └─ 仍失败 → 失败提示（含「已自动重试 N 次」）
   │
   └─ 等待结束（无论成败）→ 排队提示消失
```

### 3.2 提示的出现与消失

| 时机 | 行为 |
|---|---|
| 进入排队 | 提示条出现（阶段进度区，粘性头部内）|
| 排队中（位次/ETA 变化）| 提示内容更新 |
| 排队结束（拿到槽位 / 失败 / 取消）| 提示条**立即消失**（快照里 `queue.entries` 变空）|
| 界面无排队但快照里 `queue` 字段缺失 | 视为无排队，不显示（不报错、不空框）|

---

## 4. 数据契约

### 4.1 主进程产出：`queue` 快照

**产出位置**：`apps/desktop/electron/services/governor-queue-snapshot.js`（纯函数，独立单测）

**结构**：

```ts
type QueueSnapshot = {
  totalQueued: number                 // 所有桶上正在等待的请求总数
  entries: Array<{
    key: string                       // 限流器状态键原样透出（`providerId:type:model`），**不做拆分**
    queued: number                    // 该桶上正在等待的请求数
    etaMs: number | null              // 还要等多久；算不出时为 null
    etaConfidence: 'low' | 'high'     // ETA 可信度
    reason: 'concurrency' | 'rpm'     // 排队原因
  }>
}
```

**字段语义与校验**：

| 字段 | 语义 | 校验规则 | 非法时 |
|---|---|---|---|
| `totalQueued` | 所有桶等待者之和 | 整数 ≥ 0 | 忽略该条目后重算 |
| `key` | 限流器状态键 | 原样字符串 | 不做解析（`providerId` 可能含 `:`，拆分有歧义）|
| `queued` | 并发槽等待者数 | 整数 ≥ 0 | 非数组 `waiters` ⇒ 记 0 |
| `etaMs` | 距离下一个可用时间槽的毫秒数 | 有限数 ≥ 0 | 非数 ⇒ 不显示 ETA |
| `etaConfidence` | ETA 可信度 | `low`（未知）/ `high`（预约制精确值）| — |
| `reason` | 排队原因 | `concurrency`（并发槽）/ `rpm`（时间槽）| 其它值按 `rpm` 处理但不给 ETA |

### 4.2 两条传播路径

| 路径 | 载体 | 频率 | 用途 |
|---|---|---|---|
| 推送 | `pipeline:update`（既有通道，附带 `queue` 字段）| 事件驱动（500ms 合并窗口）| **实时**更新 |
| 轮询 | `pipeline:getRunContext` 响应（附带 `queue` 字段）| 3s（既有轮询）| 兜底（推送丢失时）|

⚠️ **两条路径都必须"总是带 `queue` 字段"**（无排队时 `entries` 为空数组），
否则渲染层会沿用上一次的 `queue` ⇒ **排队结束后提示不消失**（这是本设计明确防的一个坑）。

### 4.3 渲染层消费

**判定模块**：`apps/desktop/src/domain/queue-hint.js`（纯函数，不依赖 i18n，可单测）

```ts
type QueueHint =
  | { kind: 'waiting', count: number }   // 并发槽排队：只报数量
  | { kind: 'eta', etaMs: number }       // RPM 槽排队：报精确 ETA
  | null                                // 无排队 ⇒ 不显示
```

**判定规则**：

| 输入 | 输出 | 理由 |
|---|---|---|
| `queue` 为空 / `entries` 为空 | `null` | 无排队 |
| `entries[0].reason === 'concurrency'` | `{kind:'waiting', count}` | **不报时间**：真实等待 = 前面几个槽释放 + 自己的时间槽，而槽释放时间不可知 |
| `entries[0].reason === 'rpm'` 且 `etaMs >= 1000` | `{kind:'eta', etaMs}` | 时间槽是预约制 ⇒ 等待量是**精确值**，不是估计 |
| `entries[0].reason === 'rpm'` 且 `etaMs < 1000` | `null` | 不到 1 秒用户几乎察觉不到，提示反而是噪音 |
| 任何畸形输入 | `null` | 宁可不显示，不可显示错 |

**取哪一条**：`entries[0]`。快照在主进程侧已排序（**并发排队优先**，其次 ETA 升序）⇒
最紧急的那条永远在第一位。

---

## 5. 功能逻辑

### 5.1 ETA 是怎么算出来的（精确值，不是估计）

限流器的 `_pace()` 里：

```js
const base = Math.max(now, st.nextSlotAt || now)   // 预约下一个时间槽
st.nextSlotAt = base + intervalMs                    // 推进
const waitMs = base - now                            // 本次调用的等待量
```

⇒ **本次调用的真实等待量恰好等于 `nextSlotAt - now`** ⇒ 直接读 `nextSlotAt` 即可，
**不需要任何统计或估算**（不需要历史耗时、不需要 P50、不需要猜）。

⚠️ `nextSlotAt` 可能已过期（很久没有调用）⇒ 此时 `nextSlotAt <= now` ⇒ 不显示排队（正确：这次不用等）。

### 5.2 两种排队原因的差别

| 原因 | 现象 | 能否给出时间 | 提示形态 |
|---|---|---|---|
| `concurrency` | 同一 provider 在途请求数已满 | ❌ 不可知（等前面的人释放）| 「排队中，当前有 N 个请求在等待」|
| `rpm` | 当前速率下时间槽还没到 | ✅ 精确 | 「排队中，预计还要 X 才能开始」|

### 5.3 排序

```
并发排队（reason=concurrency）优先 —— 更严重、用户更没准备
其次按 etaMs 升序 —— 最急的排前面
```

### 5.4 与既有错误处理的边界

| 情形 | 既有行为 | 本期是否改动 |
|---|---|---|
| 排队超时（>30s / >180s）| 抛 `ProviderError(RATE_LIMITED)`，文案「排队等待超时，请稍后重试。」| ❌ 不改 |
| 冷却超上限（>45s）| 抛 `RATE_LIMITED`，文案含剩余秒数 | ❌ 不改 |
| 厂商 429 | 冷却 + 退避重试（LLM 类最多 3 次尝试）| ❌ 不改 |

⇒ 本期**只增加"排队中的可见性"**，不改变任何调度与失败语义。

---

## 6. 交互逻辑

### 6.1 显示位置

**阶段进度区的粘性头部内**，紧跟进度条/摘要之后（用户视线集中处，且随阶段列表滚动保持可见）。

| 项 | 值 |
|---|---|
| 组件 | `apps/desktop/src/views/video-creation/StageProgress.vue` |
| 容器 | `.stages-sticky-header` 内，与 `.progress-summary` 同级 |
| 语义标签 | `role="status"`（屏幕阅读器礼貌播报）|
| 测试选择器 | `[data-testid="<prefix>-queue-hint"]`（prefix 默认 `story2video`）|

### 6.2 显示项

| 显示项 | 有/无 | 来源 |
|---|---|---|
| 提示图标（⏳）| 有 | 模板内固定 |
| 提示文案 | 有 | 见 §6.3 |
| 排队数量 | **仅 `waiting` 形态** | `hint.count` |
| 剩余时间 | **仅 `eta` 形态** | `hint.etaMs` → 复用既有 `formatDuration()`（"X 分 Y 秒" / "Y 秒"）|
| 进度百分比 | 无（阶段进度条已表达）| — |
| 可点击操作 | **无** | 排队不可被用户手动干预（取消走既有的取消流程）|

### 6.3 提示文字（完整文案表）

| 场景 | locale 键 | 中文 | 英文 |
|---|---|---|---|
| 时间槽排队（有精确 ETA）| `stageProgress.modelQueueEta` | 排队中，预计还要 12 秒才能开始 | Queued — about 12 seconds before it can start |
| 并发槽排队（只报数量）| `stageProgress.modelQueueWaiting` | 排队中，当前有 3 个请求在等待 | Queued — 3 request(s) waiting |

> ⚠️ 文案里**不出现**「排在第 N 位」：单机限流器算不出全局位次（§2.2 N1）。
> ⚠️ 文案里**不出现**「已被平台限流」：限流发生在**模型服务商**侧，
> 且平台侧此时并没有闸门 ⇒ 说"平台限流"会误导用户去检查平台。

### 6.4 交互细则

| 细则 | 规则 |
|---|---|
| 出现 | 首次检测到 `entries` 非空即出现 |
| 更新 | 位次/ETA 变化时更新（推送实时、轮询兜底 3s）|
| 消失 | `entries` 变空即消失（不等下一轮渲染）|
| 重复 | 同一条提示不叠加、不堆叠 |
| 无障碍 | `role="status"` ⇒ 变化时礼貌播报；不抢焦点 |
| 国际化 | zh/en **成对维护**（`check-locale-sync` 门禁）|

---

## 7. 边界与失败模式

| # | 边界/失败 | 处理 | 用户看到 |
|---|---|---|---|
| B1 | 限流器未初始化 / 无 governor | 快照字段缺失 | 无提示（不报错、不空框）|
| B2 | `waiters` 不是数组 | 记 0 | 无排队提示或仅 ETA 形态 |
| B3 | `nextSlotAt` 非数或已过期 | 不显示 ETA | 无提示 |
| B4 | `entries[0]` 为 null / 非对象 | 视为无排队 | 无提示 |
| B5 | `etaMs < 1000` | 不提示 | 无提示 |
| B6 | 并发排队（算不出时间）| 只报数量 | 「当前有 N 个请求在等待」|
| B7 | 排队结束后残留 | 快照总是带 `queue` 字段 ⇒ 不会残留 | 提示消失 |
| B8 | 推送丢失 | 3s 轮询兜底 | 最多延迟 3s |
| B9 | 排队超过上限（30s/180s/45s）| 既有失败路径，不变 | 既有失败文案 |

---

## 8. 验收判据

> 判据落在**本质属性**上（"能观测到排队"而不是"接口返回 200"），
> 且不接受恒真断言。

| ID | 判据 | 判据形态 |
|---|---|---|
| A1 | 限流器在排队时产出的快照里 `entries` 非空，且 `etaMs` 等于 `_pace` 计算出的 `waitMs` | 单元测试（快照模块）|
| A2 | 快照在"无排队"时 `entries` 为空数组（**不是**缺字段）| 单元测试 |
| A3 | 两种排队原因分别产出 `waiting` / `eta` 两种提示形态 | 单元测试（queue-hint 模块）|
| A4 | 并发排队**不产出** ETA 字段 | 单元测试（反断言）|
| A5 | 畸形输入一律判为"无排队"，不抛异常 | 单元测试（不变式）|
| A6 | 断言**有牙齿**：故意把 ETA 阈值改成 0 / 把 kind 判定反了 ⇒ 对应用例必须红 | 变异验证（已执行，见执行记录）|
| A7 | 提示在排队结束（`entries` 变空）后消失 | 渲染层行为（人工验收 + 既有阶段进度测试不回归）|
| A8 | zh/en 文案成对 | `check-locale-sync` 门禁 |
| A9 | 改动不触发「点名还账、零容差」门禁 | `check-max-lines` 门禁（本次余量见执行记录）|

---

## 9. 证据索引

| 结论 | 证据 |
|---|---|
| 排队期间无任何进度反馈 | `apps/desktop/electron/services/api-usage-governor.js` 的 `_pace` / `_acquireSlot` 只 `sleep`，无对外事件 |
| 三个等待上限 | `apps/desktop/electron/services/governor-constants.js:14-16`（30s / 180s / 45s）|
| `waitMs = nextSlotAt - now`（精确 ETA 的来源）| `api-usage-governor.js` 的 `_pace` |
| 排队数据已存在但无消费方 | `api-usage-governor.js` 的 `getStatus()`（返回 `queued` / `nextSlotAt`）|
| 阶段进度的字段级校验是 fail-closed | `apps/desktop/electron/services/stage-executor.js` 的 `normalizeStageProgress`（`messageKey` 必须以 `stageProgress.` 开头；`detail` 为严格结构）|
| 进度事件的单调守卫 | `apps/desktop/electron/services/pipeline-engine.js` 的 `onProgress` 包装（`percent` 低于上次即丢弃）|
| 阶段归一化保留未知字段 | `apps/desktop/src/views/video-creation/create-view-module-utils.js` 的 `normalizePipelineStatusSnapshot`（`{...snapshot}` 展开）|
| 排队文案不得承诺全局位次 | 限流器是进程内状态（`api-usage-governor.js` 的 `this._state`），无跨进程视野 |

---

## 10. 未纳入范围与后续

| # | 项 | 归属 |
|---|---|---|
| F1 | **服务端集中准入闸门 + 全局位次 + 跨用户 ETA** | 关联 PRD（依赖"平台代持 Key"的接线）|
| F2 | **厂商 `Retry-After` 响应头透传**（今天 46 个 adapter 调用点全部丢弃响应头 ⇒ 冷却期永远是写死的 30s/60s）| 独立小 PR（与本 PR 无耦合）|
| F3 | **catalog 下发的 `rate_per_minute` 改成厂商真实配额**（今天下发的是乐观默认值）| 独立小 PR（与本 PR 无耦合）|
| F4 | 阶段执行器（story2video 等）的直调路径接入排队提示 | 需要动「点名还账、零容差」文件 ⇒ 需单独评估 |

---

## 11. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-24 | v1 | 初版，随「模型调用排队可见性」PR 落地 |

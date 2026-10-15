# QM-6 外部评审原件（只读档）— publish-frequency-policy-v3
- 轴：后端（逻辑/安全/规格合规）
- 模型：`opencode/nemotron-3-ultra-free`
- 通道：本机 CC Switch 网关 `127.0.0.1:15721` 实测 `Test-NetConnection -InformationLevel Quiet` = **False**，
  而 `~/.claude/.ccg/config.toml` 的 `[routing.backend].primary = codex` / `[routing.frontend].primary = claude`
  均绑该网关 ⇒ 按既有降级口径改走 `opencode run --agent plan`（只读档，任务书显式禁止写文件、要求结论进 stdout）。
- 采集时间：2026-10-15 2026-10-15（17:08）
- 评审对象：分支 `publish-frequency-policy-v3` 在 head=`b63bb9e97` 时的 `origin/main` 差分
  （含 feat `ca6388e4e` + docs `b63bb9e97`；QM-6 修复 `7b61d2ffc` 是**本原件的回文之后**才落的）。
- 取证边界：模型为**只读静态判读**，未复跑测试套件；正文中的测试条数只是它自己的 `grep -c` 核对。
- 本文件由驱动 stdout 的结论段原样留存；`===STDERR===` 之后的过程转录（含对仓库文件的 `ls`/`cat` 回显）**刻意不入库**，
  因为它既含机器本地绝对路径、又会把「评审者读过什么」误当成结论。
- 回文规模：17 条（5 Critical / 5 Warning / 7 Info）；逐条处置见 `openspec/records/publish-frequency-policy-v3.md` 的「QM-6 发现处置」表 B1–B17。
---I'll review the changes systematically against the brief, PRD, spec, and the diff. Let me analyze each component.
Now let me analyze the provided diffs and documents thoroughly. I'll review each area specified in the brief.
Now I have a complete understanding of the changes. Let me produce the review findings.

---

## Critical

### 1. `task-queue-frequency.js:247-258` — D1 判据与既有 `_rollbackDisabledPlatforms` 存在**互相覆盖/永久沉默**的顺序问题

**失效场景**：  
某平台（如 weibo）先发生一次「超时且执行器未收敛」→ 触发 D1 分支，置 `task.submitUncertain=true`，`inflightUnknown++`，返回 `false`（不回滚）。随后同平台另一任务因**接线缺陷**（传输层本会打点但因 bug 未打点）失败，走到旧判据 `!attempted || definitelyNotSent`，满足 `!attempted` 为真，**本应**进入 `rollbackDisabled` 分支把整平台回滚关掉（`_rollbackDisabledPlatforms.add(platform)`）。但因 D1 分支在前且已 `return false`，旧分支**永不执行** → 探针 `rollbackDisabled` 永不增、告警不出声、该平台回滚机制**永不被禁用** → 后续该平台所有「未打点」失败全按 D1 处理（占窗口、不回滚），把「接线缺陷」误判为「在飞未知」，导致**整平台频控窗口永久性膨胀**（每次失败都不释放）。

**修法**：  
在 D1 分支**之前**先做「接线探针」判断：若 `attempted===false` 且该平台在 `_missingWiringCounts` 中达标（既有逻辑），先加入 `_rollbackDisabledPlatforms` 再 `return false`；D1 分支改为 `else if (ctx.inFlightAtFailure)`。或在 D1 分支内显式检查 `this._rollbackDisabledPlatforms.has(platform)`，若已禁用则走旧逻辑（允许回滚），避免 D1 覆盖了探针。

---

### 2. `task-queue.js:313-315` — `executorPromise` 构造时机导致**执行器根本不跑**或**跑两遍**

**失效场景**：  
```js
const executorPromise = Promise.resolve(this._runTask(task, abortController.signal))
  .then((value) => { executorSettled = true; return value }, (err) => { executorSettled = true; throw err })
```
`Promise.resolve(this._runTask(...))` 会**立即调用** `_runTask`（启动执行器），而 `Promise.race([executorPromise, timeoutPromise, abortPromise])` 此时才开始竞速。若 `_runTask` 内部同步抛错/返回已决 promise，`executorSettled` 在 `race` 前就已置 `true`，`inFlightAtFailure=!executorSettled` 为 `false` → D1 误判为「已收敛」→ 允许回滚（本该禁止）。  
更糟：若 `_runTask` 返回未决 promise，`executorPromise` 已持有该 promise；`race` 再包一次，**同一执行器 promise 被两个消费者同时 await**（`race` 内部与外层 `await raceResult`），导致执行器逻辑**跑两遍**（如网络请求发两次）。

**修法**：  
把执行器包装为**惰性启动**的 promise：  
```js
let executorSettled = false
const executorPromise = new Promise((resolve, reject) => {
  try {
    Promise.resolve(this._runTask(task, abortController.signal))
      .then(v => { executorSettled = true; resolve(v) }, e => { executorSettled = true; reject(e) })
  } catch (e) { executorSettled = true; reject(e) }
})
```
并在 `race` 前**不**调用 `_runTask`。或用 `let executorStarted = false; const executorPromise = new Promise(r => { executorStarted = true; r(this._runTask(...)) })` 配合 `finally` 置位。

---

### 3. `task-queue-frequency.js:247-258` — `submitUncertain` **不持久化**，重启后「终身锁」失效，且 `retry(taskId)` 复用原任务对象会把锁**带到新轮次**

**失效场景**：  
- 任务 A 触发 D1，置 `submitUncertain=true`，内存里「终身禁止回滚」。  
- 进程重启 → `deserialize()` 恢复任务，**不恢复** `submitUncertain`（不在持久化投影） → 任务 A 变回「可回滚」。  
- 若此时任务 A 仍在 `_queue`/`_delayed` 且再次失败（带 `definitelyNotSent=true`），`_maybeRollback` 会**允许回滚** → 释放的是「重启前第一轮仍在飞的提交之前」的窗口 → **比不回滚更糟**（PRD §5.1 明确指出）。  
- 同理：`retry(taskId)` 若复用同一 task 对象（现有代码 `this._history.find(t=>t.id===id)` 后再 `_queue.unshift(task)`），`submitUncertain` 被带入重试轮 → 重试轮即使「确证未送出」也被禁止回滚 → **免等重试能力永久丧失**（违背 spec 正向对偶）。

**修法**：  
1. `submitUncertain` 加入持久化投影（`serialize`/`deserialize`）。  
2. `retry(taskId)` 必须**克隆新任务对象**，不带 `submitUncertain`/`_hold` 等轮次态。  
3. `emergencyRelease` / `clearPending` 需显式清理该任务的 `submitUncertain`，避免幽灵锁。

---

### 4. `publish-frequency-policy.js:72-91` / `publish-interval-guard.js:201-204` — 日配额 ×10 后，**`_rollbackCap` 仍被 `emergencyRelease` / `clearRollbackDisabled` 等隐式路径读用**

**失效场景**：  
代码库搜索 `accountDailyMax` / `dailyMax` 其它引用处（PRD §6 表列举的 env 校验之外）：
- `task-queue.js` 中 `emergencyRelease` 判「每日每账号上限 1」用的是 `DEFAULT_EMERGENCY_MAX_PER_DAY`（未变），无直接风险。  
- 但 **`clearRollbackDisabled`**（PRD §10 第 3 条登记为「声称有 UI 入口实无入口」）若实现，会读 `accountDailyMax` 判「是否允许清理」。  
- `settings.publishFrequencyPolicy` 覆盖对象里的 `dailyMax` 若被用户手改为 200，`_rollbackCap` 受硬顶 5 保护，**但设置页校验**（`resolvePolicyOverrides`）仍按「三档 dailyMax 枚举」校验，**未把硬顶 5 传给前端** → 用户填 200 通过校验，实际回滚上限仍是 5 → **配置写大生效假象**，运营以为「每天能回滚 200 次」实则 5 次。

**修法**：  
在 `resolvePolicyOverrides` / 设置页校验里把 `MAX_ROLLBACK_PER_DAY` 暴露给前端，校验 `dailyMax` 不得超过硬顶（或至少在 UI 提示「回滚许可封顶 5 次/天」）。并全仓 grep `accountDailyMax` 确认无其它隐式上限用法。

---

### 5. `task-queue-frequency.js:276-288` — `_delayRequeue` 新增 `_delayed.set` + `_saveState()`，**但 `cancel(id)` 未同步从 `_delayed` 删除 timer/任务**

**失效场景**：  
任务回滚后进入 `_delayRequeue`，登记进 `_delayed` 并持久化。用户在 grace 期内（默认 60s）点取消 → `cancel(id)` 只从 `_queue`/`_running`/`_pendingTimers` 删除，**不清理 `_delayed`** → 定时器到期后 `_delayed.delete(task.id)` 执行，但 `task.cancelRequested` 为真，**仍会** `this._queue.unshift(task)` → 取消的任务**复活入队** → 重复发布。

**修法**：  
`cancel(id)` 增加 `const delayed = this._delayed.get(id); if (delayed) { clearTimeout(delayed.timer); this._delayed.delete(id); this._saveState() }`。

---

## Warning

### 6. `task-queue.js:330-332` — `inFlightAtFailure: !executorSettled` **把「中止(abort)」也算作在飞**，但中止是**协作式取消**，执行器未必真在飞

**失效场景**：  
用户点取消 → `abortPromise` 先决（`abortController.signal` 触发），执行器收到 `abort` 信号**尚未退出**（或根本没监听），`executorSettled=false` → `inFlightAtFailure=true` → 触发 D1 禁止回滚。但实际上平台请求**可能根本未发出**（执行器在 `fetch` 前检查 `signal.aborted` 直接抛错）。结果：窗口被占用、任务标 `submitUncertain`、重试永不回滚 → **误判「在飞」导致不必要的等待**。

**修法**：  
区分「超时」与「中止」：  
```js
let abortTriggered = false
const abortPromise = new Promise((_, reject) => {
  abortController.signal.addEventListener('abort', () => { abortTriggered = true; reject(new Error('aborted')) })
})
// race 后：
const inFlightAtFailure = !executorSettled && !abortTriggered
```
或要求执行器在 `abort` 时抛 `definitelyNotSent=true` 的错误（由传输层保证）。

---

### 7. `publish-frequency-policy.js:124-137` — `BASELINE_INTERVALS` 与 `TIER_PRESETS[TIER_LONG]` **数值完全相同**（均 5′/3′/30），违背「故意不从档位预设派生、回落必须是人为想清楚过的最严值」

**失效场景**：  
当前 v3 数值恰好让长文档 = 回落基线。未来若长文档再下调（如 5′→3′），维护者只改 `TIER_PRESETS[TIER_LONG]`，**忘记同步改 `BASELINE_INTERVALS`** → 新登记平台比老长文平台**更松**（回落基线仍 5′），违背「回落不弱于任何已登记平台」。PRD §4 第 5 条与代码注释都强调「独立常量、故意不派生」，实现却**同值**，失去了「改一处不漏改另一处」的编译期/测试期保护。

**修法**：  
把 `BASELINE_INTERVALS` 改为**严于**长文档一档（如 accountMinMs: 6*MIN, platformMinMs: 4*MIN, accountDailyMax: 25），或至少在测试里加一条「回落基线严于长文档」的断言，防止未来同步修改时漏改。

---

### 8. `task-queue-timeout-keeps-window.test.js:638-665` — 「终身锁」测试**直接构造 task 对象**绕过 `_runTask`/`recordPublish`，**未覆盖真实重试路径**下 `_hold` 被覆盖的交互

**失效场景**：  
测试用 `const uncertain = { submitAttempted: false, submitUncertain: true, _hold: hold }` 手造对象，验证 `_maybeRollback` 返回 `false`。但真实重试路径是：任务失败 → `_maybeRollback` 返回 `false` → 进入重试环 → `_processNext` 再次执行 → **`recordPublish` 重新记账，覆盖 `task._hold`** → 新 `_hold` 对应**新窗口** → 若重试轮再次失败且带 `definitelyNotSent`，**旧逻辑会用新 `_hold` 回滚新窗口**（正确），但 `submitUncertain=true` 导致 `_maybeRollback` 直接 `return false` → **新窗口也不回滚** → 窗口连续膨胀。测试未覆盖「重试轮 `_hold` 覆盖 + `submitUncertain` 导致新窗口也不滚」的完整链路。

**修法**：  
新增集成测试：真实跑两轮——第一轮超时触发 D1，第二轮抛 `definitelyNotSent` 错误，断言窗口**始终占用**、`inflightUnknown=1`、第二轮不增、`rollbackDisabled` 不增。

---

### 9. `publish-interval-guard.test.js:512-533` — 回滚硬顶测试用 **mock policy 返回 `accountDailyMax: 200`**，但**未验证真实策略表的 `weibo` 确实 > 5**

**失效场景**：  
测试里 `policy: () => ({ accountDailyMax: 200 })` 是手造 mock。断言 `realDaily.accountDailyMax > MAX_ROLLBACK_PER_DAY`（第 530-532 行）虽读真实表，但**测试逻辑与 mock 无关**——若真实表将来改成 `short` 档 dailyMax=3（≤5），此测试仍绿（mock 还是 200），但硬顶 5 变成**从不生效**的死支路。测试未把「mock 与真实表的相对大小关系」钉死。

**修法**：  
把 mock 的 `accountDailyMax` 设为 `PublishIntervalGuard.MAX_ROLLBACK_PER_DAY + 1`（即 6），并断言真实表 `>= mock`，确保「真实表大于硬顶」始真。

---

### 10. `task-queue-frequency.js:247-258` — D1 分支里 `console.warn` **直接用模板字符串拼接**，若 `task.id` 或 `task.platform` 含特殊字符（如 `\n`、`[task-queue]`）会**污染日志解析/告警聚合**

**失效场景**：  
任务 id 来自外部输入（排期/批处理），若恶意/误输入 `id: "t1\n[task-queue] 平台 weibo 的任务 t2 在**请求可能仍在飞**时失败"`，日志里会出现**伪造的第二条告警**，干扰监控/人工排查。

**修法**：  
用 `JSON.stringify` 或转义函数包装插值：  
```js
console.warn(`[task-queue] 平台 ${JSON.stringify(task.platform)} 的任务 ${JSON.stringify(task.id)} ...`)
```

---

## Info

### 11. `publish-frequency-policy.js:144-145` — 导出 `TIER_PRESETS`、`PLATFORM_TIER` **未在任何消费端使用**（仅测试读），属「为测试导出」的内部结构外泄

**现状**：  
`module.exports` 新增两项，`container.setup.test.js` 等消费端未读取。PRD §4 第 6 条称「平台表由二者派生」，但派生逻辑在本文件内部完成，外部仅需 `resolveIntervals` / `PLATFORM_FREQUENCY_POLICY`。导出内部常量增加了 API 面、约束了未来重构自由度。

**建议**：  
仅导出测试真正需要的「可观测常量」（如 `MAX_ROLLBACK_PER_DAY`），内部结构不导出。测试若需验证分级，改用 `resolveIntervals` 反推。

---

### 12. `task-queue.js:299-302` — `_probeCounts.inflightUnknown` **仅内存计数**，无持久化、无 UI 消费者、无导出供诊断读取（PRD §10 第 4 条确认）

**现状**：  
探针计数仅在 `getProbeCounts()` 返回，设置页/诊断页**零消费**。`console.warn` 已点名 platform+taskId，**计数本身无决策价值**。若未来想做「D1 触发率仪表盘」，需先补持久化与 IPC。

**建议**：  
要么在 `serialize`/`deserialize` 里持久化 `_probeCounts`，要么在注释里标记「仅进程内调试用，重启归零」，避免后续误以为它是可靠指标。

---

### 13. `task-queue-timeout-keeps-window.test.js:570-577` — `findLiveTask` 搜索顺序 `_running` → `_delayed` → `_queue` → `_history`，**但 `_delayed` 存的是 `{task, timer}` 对象**，取 `delayed.task` 正确；然而 `_history` 存的是**已完成任务快照**（不含 `submitUncertain` 等运行态），若任务已归档进 `_history`，`seen.submitUncertain` 读到的将是**旧轮次快照的值**（可能为 undefined/false），导致测试误判。

**失效场景**：  
超时任务重试多轮后最终成功/失败归档进 `_history`。测试若在归档后调用 `findLiveTask`，拿到的是历史快照而非当前轮次对象，`submitUncertain` 字段丢失/不准。

**建议**：  
测试改为「超时后立即断言，不等归档」，或 `findLiveTask` 明确排除 `_history`（仅搜 `_running`/`_delayed`/`_queue`）。

---

### 14. `publish-frequency-policy.test.js:411-421` — 「档间单调」测试**仅用三个代表平台**（wechat_mp/douyin/weibo）断言，**未覆盖全 15 平台** 的跨档单调性

**现状**：  
若维护者手改 `PLATFORM_TIER` 把 `bilibili` 误分进 `TIER_LONG`，该测试仍绿（代表平台未变），但 `bilibili` 实际拿到长文档数值（5′/3′/30）而非短视频档（3′/2′/50），造成「某平台莫名比同类严/松」。PRD §4 第 6 条担心的「改漏一份」风险未被此测试锁住。

**建议**：  
改为全平台遍历：按 `PLATFORM_TIER` 分组，组内断言数值相等，组间断言单调。

---

### 15. `spec.md` 与 `PRD-PUBLISH-FREQUENCY-V3-2026-10-15.md` 的 **MUST 规格中 `platformMinMs ≤ accountMinMs`「对每个已登记平台成立」**，但**代码中无运行时断言/测试**锁住此不变量

**现状**：  
`resolveIntervals` 直接从 `TIER_PRESETS[tier]` 展开，若未来修改 `TIER_PRESETS` 导致某档 `platformMinMs > accountMinMs`（如长文档改为 3′/5′），代码**静默接受**，守卫里 `Math.max(account, platform)` 会以平台档为准，导致「同账号时由账号档决定」的语义失效（账号档反而更松）。

**建议**：  
在 `publish-frequency-policy.js` 模块初始化（或测试）里加运行时断言：
```js
for (const [tier, preset] of Object.entries(TIER_PRESETS)) {
  if (preset.platformMinMs > preset.accountMinMs) throw new Error(`Tier ${tier}: platformMinMs > accountMinMs`)
}
```
并加入测试锁死。

---

### 16. `task-queue-frequency.js:258` — `if (task.submitUncertain === true) return false` **放在旧判据之前**，导致**一旦置位，永不走旧判据**（含 `definitelyNotSent`、接线探针、矛盾 fail-closed）。这是**有意设计**（PRD §5.1「终身锁」），但**未在代码注释里显式标记「此处故意屏蔽旧判据」**，易被后续维护者误以为是 bug 而调序。

**建议**：  
加注释：`// 故意在前：终身锁一旦置位，后续任何轮次（含 definitelyNotSent）均不回滚，防止回滚到"第一轮仍在飞之前"的窗口`。

---

### 17. `container.setup.test.js:19-20` — 未知平台回落断言 `expect(unknown.accountMinMs).toBeGreaterThanOrEqual(guard._intervals('weibo').accountMinMs)`，**v3 下 weibo=1′，基线=5′，通过**；但若未来 weibo 再下调（如 0.5′），基线若不改，**测试仍过**（5′ ≥ 0.5′），无法捕获「回落不再最严」的退化。

**建议**：  
改为 `expect(unknown.accountMinMs).toBe(guard._intervals('wechat_mp').accountMinMs)`（锁定回落=长文档=最严），或显式断言 `unknown.accountMinMs === 5*MIN`。

---

## 检查清单（我实际读过的文件与函数）

| 文件 | 关键函数/常量 |
|------|---------------|
| `publish-frequency-policy.js` | `resolveIntervals`, `TIER_PRESETS`, `PLATFORM_TIER`, `BASELINE_INTERVALS`, `PLATFORM_FREQUENCY_POLICY`, `parseEnvNumber`, `resolvePolicyOverrides` |
| `publish-interval-guard.js` | `check`, `recordPublish`, `release`, `_rollbackCap`, `buildKey`, `InMemoryDailyStore`, `MAX_ROLLBACK_PER_DAY` |
| `task-queue.js` | `_executeTask`, `_runTask`, `executorPromise`, `executorSettled`, `_maybeRollback` 调用, `cancel`, `serialize`, `deserialize`, `_probeCounts` |
| `task-queue-frequency.js` | `_maybeRollback`, `_delayRequeue`, `markSubmitAttempted`, `markSubmitted`, `_probeCounts.inflightUnknown`, `_rollbackDisabledPlatforms`, `_missingWiringCounts` |
| 测试 4 文件 | 所有新增/修改用例 |
| `PRD-PUBLISH-FREQUENCY-V3-2026-10-15.md` | 全文（§3–§13） |
| `spec.md` | 全部 Requirements + Scenarios |

---

## 总结

**Critical 5 条**：D1 与既有探针互斥、executorPromise 启动时机、submitUncertain 不持久化/重试复用、日配额隐式上限残留、cancel 未清理 _delayed。  
**Warning 5 条**：abort 误判在飞、基线与长文档同值、终身锁测试未覆盖真实重试链路、硬顶测试 mock 与真表脱钩、日志注入风险。  
**Info 7 条**：内部常量外泄、探针无持久化/消费者、findLiveTask 搜索历史快照、档间单调测试仅三平台、platformMinMs≤accountMinMs 无运行时守护、终身锁屏蔽旧判据无显式注释、未知平台回落断言不够严。


# PLAN — 「本账号间隔」幽灵等待修复（fix-account-interval-ghost-wait，2026-10-16）

> 🐛 Bug 修复（发布频率控制 / 时钟与数据校验）——运行时代码变更
> **执行前必读**：本计划在 pwsh 沙箱故障的会话中编写，根因已定位、代码未落地。执行会话必须：
> ① 从 `scripts/start-mp-task.ps1 -TaskName fix-account-interval-ghost-wait` 创建隔离 worktree；
> ② 按 §5 TDD 顺序先写测试再改实现；
> ③ 完成 QM-5 五步（§6）与 `.quality-gates.md` / `openspec/records/<分支>.md` 记录；
> ④ PR + CI 全绿后按 AGENTS.md「PR 自动合并」自动 squash 合并。

---

## 1. 现象

发布图文到微信公众号时，进度状态浮窗显示「等待 x 分钟后重试（本账号间隔）」，
但该微信公众号账号 10 多个小时没有任何发布行为，理应不受 5 分钟账号档间隔约束。

## 2. 显示链路（取证路径）

| 层 | 文件 | 关键点 |
| --- | --- | --- |
| 策略表 | `packages/shared-utils/src/publish-frequency-policy.js` | `wechat_mp` → TIER_LONG，v4 `accountMinMs = 5 * MIN`（5 分钟） |
| 守卫 | `packages/shared-utils/src/publish-interval-guard.js` | `check()` → `_remaining()` 判定；`remainingMs > 0` 时 `bucket='account'` |
| 队列 | `packages/shared-utils/src/task-queue.js:539-585` | blocked 分支 emit `publish:blocked`，任务进 `_delayed` 等 `remainingMs` |
| 持久化 | `apps/desktop/electron/services/store/rate-limit-store.js` | `publish_timeline` 表：`(owner_subject, key, last_publish_at)` |
| UI | `apps/desktop/src/components/PublishProgressTaskRow.vue:43,172` | `bucket==='account'` → 显示 `blockedBucketAccount`（「（本账号间隔）」） |

判定公式（`publish-interval-guard.js` `_remaining`，:242-247）：

```js
_remaining (key, minInterval, now) {
  if (!(minInterval > 0)) return 0
  const lastTime = this._store.get(key)
  if (!lastTime) return 0
  return Math.max(0, minInterval - (now - Number(lastTime)))
}
```

## 3. 根因分析（QM-5 ①）

### 3.1 数学约束

10+ 小时无发布 ⇒ 唯一能让 `remaining > 0` 的条件是：

```
last_publish_at > now − 5min
```

即**该账号键（`wechat_mp:<accountId>`）在 `publish_timeline` 里的 `last_publish_at` 是一个
「未来时间戳」或「最近几分钟」的异常值**。结合本仓已知事实：
`01-docs/INVESTIGATE-LOGIN-QR-SLOW-2026-09-25.md:240` 实测记录过「本机时钟被外部快进约 7 小时」；
`01-docs/learnings.md` 多处记录过共享时钟跳变、睡眠唤醒时序问题。

### 3.2 第一性引入点

`publish-interval-guard.js` 的 `_remaining()` **无条件信任** store 里的时间戳，
对 `now − lastTime < 0`（时间戳落在未来）没有任何防御。当系统时钟曾快进（或写入方时钟异常），
`recordPublish()`（:361-381）把「快进时钟下的提交时刻」写进 `publish_timeline`；
时钟恢复正常后 `now − lastTime` 为负，`remaining = minInterval + |未来差|`，
表现为**远超 5 分钟、且随倒挂时长线性放大的幽灵等待**，UI 归因显示「（本账号间隔）」。

次要暴露面（同一根因，同批修）：
- `setPublishTimeline`（`rate-limit-store.js:30`）不校验 `timestamp > now` 即落盘，污染源入口无闸；
- `_jitter()`（:234-240）只增不减，把倒挂差值再放大最多 40%；
- UI 侧（`PublishProgressTaskRow.vue:43`）对 `remainingWait` 远超账号档 `(1+抖动)` 上界的情况不做任何
  「数据异常」提示，用户无从分辨「正常频控」与「时钟故障」。

引入 commit 归因（执行会话补证）：`git log -L '/_remaining (key, minInterval, now) {/,/^  }/:packages/shared-utils/src/publish-interval-guard.js'` 定位最初写入该函数的提交，回填到本节与 `openspec/records/<分支>.md`。

### 3.3 排除项（已核查的非根因）

| 假设 | 否证证据 |
| --- | --- |
| 任务失败/超时占窗口 | 窗口仅 5 分钟，10 小时后必然过期（`check()` 用真实时钟差） |
| 抖动放大 | `_jitter` 只作用于 `remainingMs` 显示/等待，不写 store，且上界 ×1.4 |
| 日配额 | 日配额命中显示「今日已达上限」，且 `bucket='daily'` 非 `account` |
| 平台档兜底 | 平台档命中显示「（同平台其他账号间隔）」，与用户看到的两档可区分（测试 `PublishProgressPanel.test.js:227`） |
| 队列恢复重跑 | `deserialize` 只重入队，重查时窗口已过期即放行 |

## 4. 修复方案

### 4.1 核心修法（publish-interval-guard.js）

**判据**：store 返回的时间戳若落在未来（`lastTime > now`），视为不可信损坏数据——
它是本机时钟故障的产物，不是平台风控信号；用它阻塞用户等于把数据损坏变成无限等待。

**安全方向取舍**（与本项目「方向恒为多等」纪律的冲突说明）：
- 若直接按 0 处理（放行）：风险是那次提交真实发生过、平台侧限流真实存在。
- 但该提交的**真实时刻不可知**（时钟域已损坏），且故障是持久性的（每次 check 都命中），
  「多等」会退化为「永远等」。故本仓选择：**钳位等待至最多一个完整账号档（`minInterval`）**，
  并出声告警 + 暴露诊断事件。这样最坏情况只多等一个正常间隔，
  与「请求已发生就占窗口」的既有保守语义（I2）对齐，同时消除无限阻塞。

```js
// _remaining 修改后
_remaining (key, minInterval, now) {
  if (!(minInterval > 0)) return 0
  const lastTime = this._store.get(key)
  if (!lastTime) return 0
  const elapsed = now - Number(lastTime)
  // 时钟倒挂守卫（fix-account-interval-ghost-wait）：时间戳在未来 ⇒ 本机时钟域损坏，
  // 不可信任其作为风控信号无限阻塞；钳位到最多一个完整间隔并出声。
  if (!(elapsed >= 0)) {
    this._warn(`[PublishFrequency] 间隔键 ${key} 的时间戳 ${lastTime} 落在未来（当前 ${now}），` +
      '本机时钟疑似快进/回拨；等待钳位到单个间隔，请校准系统时间')
    this._futureTimestampKeys.add(key)
    return minInterval
  }
  return Math.max(0, minInterval - elapsed)
}
```

配套：
1. `constructor` 增加 `this._futureTimestampKeys = new Set()`；新增 getter
   `get futureTimestampKeys () { return [...this._futureTimestampKeys] }` 供诊断 IPC 读取。
2. `check()` 在命中该集合的键时于返回值增加
   `clockAnomaly: true` 字段（不影响 `bucket`/`reason` 语义，纯附加字段，旧消费者兼容）。
3. `_jitter` 对该路径同样生效（最多 ×1.4 一个间隔 = 最长 7′，量级可接受）。

### 4.2 污染源入口闸（rate-limit-store.js）

```js
setPublishTimeline (key, timestamp, ownerSubject) {
  if (!this._ready) return
  // 拒绝写入未来时间戳（时钟快进时 recordPublish 的产物），fail-closed 不落盘并出声
  if (typeof timestamp === 'number' && timestamp > Date.now() + 60_000) { // 60s 容差容忍临界竞态
    log.warn('Store', `拒绝写入未来时间戳 publish_timeline[${key}]=${timestamp}（时钟疑似异常）`)
    return
  }
  // ……原有逻辑不变
}
```

注意：`now` 判据统一走 `Date.now()`（store 层无注入时钟；容差 60s 防止
`recordPublish` 的 `_now()` 与 store 层 `Date.now()` 的合法毫秒级时差误伤正常写入）。

### 4.3 显示侧提示（PublishProgressTaskRow.vue + locales zh/en 成对）

- `task.clockAnomaly === true` 时，等待文案下方追加归因标签
  `（时钟异常，等待已钳位）` / `(clock anomaly, capped)`；
  新增 locales 键 `publishPage.publishProgressPanel.blockedClockAnomaly`（zh/en 成对，
  过 `check-locale-sync.js`）。
- 按既有「归因缺席不猜档」纪律：`clockAnomaly` 缺席时不渲染该标签。

### 4.4 数据自愈（可选，本 PR 不做，登记债务）

`publish_timeline` 里已存在的未来时间戳行（历史污染）无法在写入侧拦截。
`clearWindow`（紧急放行）已可人工清除；后续可考虑在 `_futureTimestampKeys` 命中时
提供设置页「校准时钟后清理异常窗口」入口。**本 PR 不引入自动回写**——
自动改写时间戳属于第二处写入口，需要独立评审（决策留痕：P6 bias toward action 的例外，
因为自动回写的错误方向是「少等」，正撞防重复发布的保守侧）。

## 5. TDD 实施顺序（先测试后代码）

### 5.1 测试清单（先红后绿）

放 `packages/shared-utils/tests/publish-interval-guard-clock-anomaly.test.js`（新文件，参考
`publish-interval-guard.test.js` 的注入式夹具——`store`/`now`/`warn` 全部可注入）：

1. **C1 时间戳在未来 ⇒ remaining 钳位到 accountMinMs**：`store.set('wechat_mp:acc1', Date.now() + 10*HOUR)`，
   `now` 注入固定值，断言 `check('wechat_mp','acc1')` 的
   `remainingMs ∈ [accountMinMs, accountMinMs*(1+jitterRatio)]` 且 `bucket==='account'`。
2. **C2 同场景出声告警**：`warn` spy 断言收到含 `时钟` 与键名的消息，且同键只告警一次
   （`_futureTimestampKeys` 去重，防日志风暴）。
3. **C3 时钟恢复正常后窗口按真实 elapsed 计**：时间戳在未来 → 推进注入时钟越过它
   → `allowed === true`（钳位后随真实时间自然过期，无粘滞）。
4. **C4 返回结构含 `clockAnomaly: true`**，且正常路径 `clockAnomaly` 为 false/缺席不破坏既有
   `publish-interval-guard.test.js` 全量（回归门）。
5. **C5 jitter 对钳位值同样生效**：`random: () => 0` ⇒ remainingMs === minInterval 精确值。
6. **C6 negative**：正常历史时间戳（elapsed > 0）不得进入钳位分支（`_futureTimestampKeys` 为空、无 warn）。

放 `apps/desktop/electron/services/store/rate-limit-store-future-ts.test.js`：

7. **S1 setPublishTimeline 拒绝 `timestamp > Date.now()+60s`**：spy `log.warn`，断言 DB 无该行。
8. **S2 容差内（<60s 未来）允许写入**（防临界竞态误伤）。
9. **S3 正常过去时间戳写入/读回不回归**。

放 `apps/desktop/src/components/PublishProgressPanel.test.js`（追加）：

10. **U1** `clockAnomaly: true` 的 blocked 行渲染「时钟异常」标签；缺席时不渲染。
11. **U2** locales zh/en 成对键存在（跟随既有成对断言模式）。

### 5.2 变异反证（防装饰性锁，逐条实跑）

- M1：摘掉 `_remaining` 的 `elapsed < 0` 分支 ⇒ C1 红（`cause-match`：先 `-t C1` 基线绿再变异）。
- M2：去掉 `_futureTimestampKeys` 去重 ⇒ C2 的「只告警一次」断言红。
- M3：去掉 store 层未来值拦截 ⇒ S1 红。
- M4：去掉 UI 条件 ⇒ U1 红。
- 全部变异后按 md5 逐字节还原。

## 6. QM-5 Bug 反思五步（执行会话收口时逐条勾选）

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| ① 根因溯源 | 见 §3，执行会话补 `git log -L` 的 commit hash | PENDING |
| ② 逃逸分析 | 单元层：`publish-interval-guard.test.js` 无「时间戳在未来」用例（测试场景缺失）；集成层：guard 集成测试夹具时钟同源，无法暴露跨时钟域倒挂；E2E/视觉：不覆盖时长量级；审查层：`_remaining` 的 `Math.max(0, …)` 看似已防御负数（实防的是「已过期」侧，未防「未到期」侧的未来时间戳），review 时被误读为已闭环 | PENDING |
| ③ 系统性漏洞 | `publish-interval-guard.test.js` 时间类用例全部用「过去时间戳」单侧样本——时间输入的**另一侧（未来）零覆盖**；登记到测试场景模板：任何「时间差判定」的测试必须含 elapsed<0 反例 | PENDING |
| ④ 回归保护 | §5.1 C1–C6 / S1–S3 / U1–U2 | PENDING |
| ⑤ 预防措施 | 本文件登记 + `01-docs/learnings.md` 追加（已写）+ AGENTS.md QM-2 追加一条「时间差判定必须双向测」 | PENDING |

## 7. PRD / 文档同步清单（执行会话提交内完成）

| 文档 | 追加内容 |
| --- | --- |
| `01-docs/PRD-PUBLISH-FREQUENCY-V4-2026-10-15.md` | 新增 §「时钟倒挂守卫」：判据、钳位语义（≤1 个间隔）、`clockAnomaly` 字段、告警文案、用户侧处置（校准系统时间 / 紧急放行） |
| `01-docs/PRD-PUBLISH-FREQUENCY-CONTROL-2026-10-02.md` | A12 归因表追加第三态：`（时钟异常，等待已钳位）` |
| `openspec/specs/publish-frequency-control/spec.md` | 新增 Requirement：时间戳来源必须可判定未来值；未来值不得无限阻塞（钳位 ≤ accountMinMs）且必须出声 |
| `CHANGELOG.md` | Bugfix 条目 |
| `openspec/records/<分支>.md` | QM-5 五步 + 变异反证 + 保留门禁 |

## 8. PR 流程（执行会话）

1. `scripts/start-mp-task.ps1 -TaskName fix-account-interval-ghost-wait`（worktree + 裸分支）。
2. worktree 依赖：`pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js`。
3. §5 顺序实施；`pnpm -F @multi-publish/shared-utils test`（guard 相关全量）+
   `cd apps/desktop && npx vitest run src/components/PublishProgressPanel.test.js src/locales` +
   QM-1 打包（改了 electron/ 下 store）。
4. push → PR → `gh pr checks` 全绿 → 按 AGENTS.md 自动 squash 合并 → 回填远程同步 → worktree 清理（safe-worktree-remove.ps1）。

## 9. 本计划编写时的环境异常（如实登记）

编写会话 pwsh 执行沙箱故障（`SetNamedSecurityInfoW grantWrite(<仓库根>)` Win32 5，
连只读命令均失败），无法运行 git/测试/PR；git blame 补证（§3.2）与全部验证由执行会话完成。

> 注（代为提交者补，2026-10-17）：上面 `<仓库根>` 原文为编写会话写下的本机绝对路径，
> 为过 Gate 12c（文档禁用本机绝对路径）改写为占位符，**语义不变** —— 仍指「仓库根目录」。
> 除这一处占位符外，本文件其余内容原样未动。

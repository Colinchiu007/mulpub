# Design — publish-frequency-policy-v2

> 逐条回应两轮跨家族对抗评审的结论见 `.adversarial/ccg-plan-plan-publish-frequency-policy-v2-review-brief/rebuttal-v1.md` / `rebuttal-v2.md`。
> 实现的详细规格（校验表 / 文案表 / 测试矩阵）见 `01-docs/PRD-PUBLISH-FREQUENCY-POLICY-V2-2026-10-10.md`。

## 0. 一句话设计

把「提交前乐观记账」拆成**可回滚的占位**与**不可回滚的提交**两个阶段，用**阶段判据**（而非错误类型）决定能否回滚；在此之上补**日配额**维度与**只增不减的抖动**；数值下调并让平台档回到「有依据、成本可接受」的位置。

## 1. 三个待解问题的第一性分析

### 1.1 为什么不能靠错误类型判「未提交」（评审 Critical i1/i6）

原设计（调查报告 P0-1）打算把「登录失效 / 风控挂起 / 参数校验」等错误类型列入白名单。两轮评审都指出两个独立缺陷：

1. **获益方自标**：执行器同时是「抛错方」与「免等重试的获益方」。仅凭执行器自己设的 `notSubmitted` 布尔位，误标或伪造即可绕开全部门禁。
2. **同一错误类型的阶段歧义**：「登录失效」可能发生在**提交之前**（未发出任何平台请求），也可能发生在**提交之后**（平台已受理、返回 401）。按类型判必然误判其中一侧。

**结论**：判据必须是**阶段**，不是类型。阶段由**实际发出平台请求的那一层**打点，而不是由抛错的那一层声明。

### 1.2 为什么日配额被拒的任务不会「丢 hold」（评审 Critical v1-i1）

配额判定发生在 `recordPublish()` **之前**；被拒的任务**从未占用任何窗口**。因此不存在「跨日等待期间窗口被占、重启后 hold 丢失」的问题——`hold` 只在**已记账**之后才存在，而配额分支走不到记账。这直接消掉了评审担心的持久化需求，也消掉了 proposer 修订版里那条凭空新增的 `hold_until` 列。

但同时暴露出**原设计的真缺陷**：原方案写「ms 超过 2³¹−1 则不设定时器，等下次 `_processNext`」，而 `_processNext` 会立即再次取到同一任务 ⇒ **紧循环**。这一条比评审指出的更严重，已在 rebuttal-v1 中承认为设计缺陷并修正（见 §4.3）。

### 1.3 为什么抖动必须只增不减

抖动若双向（`1±ratio`），则存在 `rand` 使等待**短于**最小间隔 ⇒ 抖动成为绕过门禁的通道。故 `wait = remaining × (1 + ratio × rand)`，`rand ∈ [0,1)`，**只增不减**；`ratio = 0` 严格退化为 v1 行为（保证可回归）。

## 2. 数据模型

### 2.1 新增表 `publish_daily_count`

```sql
CREATE TABLE IF NOT EXISTS publish_daily_count (
  owner_subject  TEXT NOT NULL,
  key            TEXT NOT NULL,   -- 'platform:accountId' | 'platform:*'
  day_key        TEXT NOT NULL,   -- 'YYYY-MM-DD'（本机运营日）
  count          INTEGER NOT NULL DEFAULT 0,  -- 已实际提交到平台的次数
  rollback_count INTEGER NOT NULL DEFAULT 0,  -- 回滚（放行）尝试次数，只增不减
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (owner_subject, key, day_key)
);
CREATE INDEX IF NOT EXISTS idx_daily_owner_key ON publish_daily_count(owner_subject, key);
```

**为什么新表而不是扩展 `publish_timeline`**：后者的实际列是 `last_publish_at TEXT`（`store-schema.js:79-84`），被守卫做算术强转，且 `store-owner-isolation.test.js:364` 把读回钉成字符串 `'100'`。改成 JSON 会污染「最后一次提交时间」的消费者与既有断言。新表是纯增量。

**为什么两个计数器**：
- `count` = **已实际提交到平台**的次数（平台负载的代理量）⇒ 未提交的回滚要**幂等回补**。
- `rollback_count` = **回滚尝试**次数（滥用面的代理量）⇒ **只增不减**，用于防风上限。
- 与「不做成功才记账」不冲突：计的是**提交**，不是**成功**；已提交后的失败仍计入。

### 2.2 `publish_timeline` 语义不变

键仍为 `platform:accountId` / `platform:*`，值仍为最后一次**提交**时间戳（ms）。本变更不改其形状、不加列、不做数据迁移。

### 2.3 本机运营日（self-imposed accounting day）

- `day_key` = 本机时区自然日 `YYYY-MM-DD`，由注入的 `today()` 产出（默认实现用 `toLocaleDateString('sv-SE')`，天然 ISO 格式，避免手写补零）。
- **不与平台日界做换算，也不声称等价**：日配额是本工具的**自我约束**，不是平台规则（上游 PRD §2 明写「不声称符合平台官方规定」）。若按平台时区计日，同一运营者会面对多个不同的「今天」，配额不可解释、不可预期。
- 跨日边界必须有测试：TZ 注入 + `23:59:59 → 00:00:01` 两个 `day_key` 独立计数。
- **不提供** `MP_PUBLISH_QUOTA_TZ`：避免引入第二个时区真源。

## 3. 策略表 v2

| 组（`tier`） | 平台 | 账号档 | 平台档 | 日配额 |
|---|---|---|---|---|
| `long` | wechat_mp, zhihu, baijiahao, toutiao | 20 分钟（原 60） | 2 分钟（原 5） | 3 条/天 |
| `clip` | douyin, kuaishou, tencent_video, xiaohongshu, bilibili, youtube, tiktok, instagram, facebook | 10 分钟（原 30） | 2 分钟（原 3） | 5 条/天 |
| `short` | weibo, twitter | 3 分钟（原 10） | 2 分钟（原 1） | 20 条/天 |
| 未登记回落 | 任意未知 | 20 分钟 | 2 分钟 | 3 条/天 |

- `tier` 是**新增字段但非新增分类器**：日配额分档直接读策略表里既有的分组条目，与账号档/平台档同源同表 ⇒ 不会出现两套分类漂移。
- 未登记平台回落时**出声一次**（按平台记忆，进程内 Set 去重）。

## 4. 守卫 v2 与队列 v2

### 4.1 守卫 API

```js
new PublishIntervalGuard({
  policy,       // (platform) => { accountMinMs, platformMinMs, accountDailyMax, tier }
  store,        // { get(key), set(key, value) }                       —— 提交时间（不变）
  dailyStore,   // { getDay(key, dayKey), incrDay(key, dayKey, field), decrDay(key, dayKey, field) }
  now,          // () => number                                        —— 不变
  today,        // () => 'YYYY-MM-DD'                                  —— 新增
  random,       // () => [0,1)                                         —— 新增（可注入）
  jitterRatio,  // number                                              —— 新增，默认 0.4
})
```

### 4.2 `check()` 返回形状

```js
{
  allowed, remainingMs,                      // remainingMs 已含抖动
  bucket: 'account' | 'platform' | 'daily' | null,
  reason: null | 'interval' | 'daily_quota',
  daily: { used, max, dayKey } | null,
}
```

判定顺序：① 账号档 remaining；② 平台档 remaining（默认开 2 分钟）；③ 日配额（独立否决项）。①② 取更大者；③ 为独立否决。同时命中时 `bucket` 取 `daily`（更强的约束，且用户可行动性不同：间隔是等待，配额是改期）。

### 4.3 队列：`_quotaBlocked` 与跨日定时器（修正 Critical v1-i1）

- 新增 `_quotaBlocked: Set<taskId>`；`_processNext` **必须跳过**其中任务（防紧循环）。
- 配额被拒 → `status='pending'`、加入 `_quotaBlocked`、发 `publish:blocked`（`reason='daily_quota'`）、设定时器到**次日 00:00:05** 并 `unref()`；到点移出集合、入队头、`_processNext()`。
- **溢出分支删除**：次日上界 24h = 86 400 000 ms，定时器上限 2³¹−1 = 2 147 483 647 ms ≈ 24.85 天 ⇒ 数学上不可能溢出。原设计的溢出分支是无意义复杂度且引入紧循环。
- 重启恢复：配额被拒任务以 `pending` 持久化（既有 `serialize()` 覆盖），恢复后重新判定、重新武装。**无需 `hold` 持久化**（§1.2）。
- 通道释放：配额分支与间隔分支一样在 `try/finally` 之前 `return`，必须**显式释放通道**（与既有 `publish:blocked` 分支同因，行为锁已有先例）。

### 4.4 记账与回滚（P0-1 核心）

```
hold = guard.recordPublish(platform, accountId)   // 返回 { at, accountPrev, platformPrev }
task._hold = hold                                  // 必须保存
...
catch (e):
  canRollback = task.submittedAt === null          // ← 阶段判据（唯一权威）
                && e.notSubmitted === true         // ← 佐证位；不一致即 fail-closed
  if (canRollback) guard.release(platform, accountId, hold)
  else             /* 占窗口，不变 */
```

`release(platform, accountId, hold)`：

1. `store.get(key) === hold.at` 才回滚该键（乐观并发；否则不动 —— **绝不回滚他人窗口**），并按 `hold.*Prev` 恢复或置 null；
2. `decrDay(accountKey, today, 'count')`（配额回补，幂等，下限 0）；
3. `incrDay(accountKey, today, 'rollback_count')`（只增）。

**防风（回应评审 Critical v2-i1）**：
- 回滚后**最小退避** `max(RELEASE_GRACE_MS, 10s)` —— 不允许 0 等待；
- 每账号每日回滚上限 `max(2, dailyMax)`，超出 ⇒ **占窗口 + warn**；
- 三条独立约束（阶段判据 / 佐证位一致 / 防风上限）任一不成立即 fail-closed。

### 4.5 传输层打点与「成功路径自证」不变量（回应评审 Critical v2-i1）

- 新增 `context.markSubmitted()`：由**真正发出平台写操作的那一层**（`rpa-view-manager` / `publisher-router`）在首次平台写操作前调用一次。队列把结果写到 `task.submittedAt`。
- **不变量 I4**：任何**成功**的发布若 `task.submittedAt === null` ⇒ `log.error` + 计数。
  - 作用：把「某传输层漏接线」从**静默风险**变成**第一次成功就暴露的主动告警**。这条把评审的担忧反转为可自检的探针。

### 4.6 重试放行（P0-2）

- 自动重试（`task-queue.js:587-597`）与手动重试（`:240-262`）同走 `add() → _executeTask → check()`，P0-1 落地后自然受益，无额外分支。
- `task.lastAttemptNotSubmitted === true` 且 `now - lastAttemptAt >= max(RELEASE_GRACE_MS, 10s)` 时放行一次，并发 `publish:released` 事件（可观测，经既有投影链到进度面板）。

## 5. 装配（桌面端）

```js
container.register("publishIntervalGuard", (c) => {
  const s = c.get("store");
  const ov = resolvePolicyOverrides(s);           // store 设置 + env，逐字段校验，任一非法整体丢弃
  return new PublishIntervalGuard({
    policy: (platform) => resolvePublishIntervals(platform, { overrides: ov, warn: logger.warn }),
    store: { get: (k) => s.getPublishTimeline(k), set: (k, v) => s.setPublishTimeline(k, v) },
    dailyStore: {
      getDay:  (k, d)       => s.getPublishDailyCount(k, d),
      incrDay: (k, d, f)    => s.incrPublishDailyCount(k, d, f),
      decrDay: (k, d, f)    => s.decrPublishDailyCount(k, d, f),
    },
    jitterRatio: ov.jitterRatio,
  });
});
```

**装配锁（3 条）**
1. `taskQueue._publishIntervalGuard === container.get('publishIntervalGuard')`（既有，保留）；
2. 守卫的 `dailyStore` 三个方法均为函数（**摘掉日配额注入即红**）；
3. 行为锁：`dailyStore` 返回 `used = max` 时，`check()` 给出 `bucket === 'daily'`。

## 6. 存储层

- `store-schema.js`：`TABLE_NAMES` / `OWNER_TABLE_SCHEMA_SQL` / `OWNER_INDEX_SQL` / `SCHEMA_SQL` / `OWNER_TABLE_COLUMNS` / `OWNER_TABLE_KEY_COLUMNS` / `OWNER_COLUMN_DEFAULTS` 七处同步登记（owner 隔离重建路径要求逐项齐备，缺一即 `needsOwnerTableRebuild` 判定异常）。
- 新 mixin `store/publish-daily-store.js`：`getPublishDailyCount` / `incrPublishDailyCount` / `decrPublishDailyCount`，owner 解析与 `rate-limit-store.js` 同源（`_resolveOwnerSubject`，无 owner 即 no-op 返回 null/0）。
- 计数读回一律 `Number.parseInt(String(v), 10)`，非有限 → 0 **并出声**（既有库出现过 TEXT 亲和带回 `.0` 的先例）。
- 紧急放行审计：追加式 JSONL（`publish-emergency-audit.jsonl`，逐行 append，UI 无编辑入口），沿用 `publish-history.js` 的 JSONL 落盘范式。

## 7. 显式偏离声明（对上游调查报告 P1-1）

调查报告建议「跨账号平台档**默认关**」。本变更**改为默认开 2 分钟**，理由：

- 两轮跨家族评审各自独立指出「默认关会削弱同平台多账号（机构号矩阵）的共档保护」；
- 成本有界：1 账号/平台时该档**完全惰性**（账号档 3–20 分钟恒严于 2 分钟）；
- 它保留的是本项目唯一一条**设备/IP 邻域**保护（上游 PRD 明确不做设备级串行）；
- 相对 v1 的 3–5 分钟，2 分钟已把该档的代价降到原来的 40–67%。

代价与适用场景写入 PRD 与设置页提示。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 阶段打点漏接线 ⇒ 未提交失败被当成已提交（多等，方向安全） | 不变量 I4：成功路径自证 + 计数告警 |
| 阶段打点被绕过 ⇒ 已提交却判为未提交（危险侧） | 佐证位必须一致才回滚；防风上限；三条锁 + 变异反证 |
| 回滚风暴 | 最小退避 10s + 每账号每日回滚上限 + 只增的回滚计数 |
| 抖动 + 下调叠加导致吞吐显著下降 | 设置页显示实际间隔区间与日配额；PRD 写明量级；抖动可关 |
| 新增表破坏 owner 隔离重建 | 七处注册表同步登记 + `store-schema.test.js` + `store-owner-isolation.test.js` 全量 |
| 紧急放行成为新的绕过口 | 每日上限 1 次 + 两次间隔 ≥10 分钟 + 追加式审计 + 设置页可见 |

## 9. 兼容与存量

- `publish_timeline` 存量行不动；新表 `CREATE TABLE IF NOT EXISTS`，无历史数据 ⇒ 计数从 0 起（当天即受配额约束）。
- 新数值在**每轮 `check()`** 时读取 ⇒ 即时生效，无入队时快照，无需迁移；入队时旧值、执行时新值按新值判定（补用例）。
- `MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS` 的默认值由「策略表 5/3/1」变为「策略表 2」；显式设置该变量仍可覆盖，`0` = 关闭。
- 既有两条测试的语义**必须改写**（非放宽）：「同平台换号被平台档拦截」→「默认 2 分钟拦截 / 显式 0 不拦截」两侧断言；「无 accountId 仍受平台档约束」→ 保留并补「显式关闭后仅受账号档与日配额约束」。

## 10. 对抗评审后的修订（run C 采纳项）

> 全部落在 **fail-closed 方向**，未引入新的 Critical/High；逐条回应见 `rebuttal-v4.md`，三次运行的汇总见 `.adversarial/ccg-plan-plan-publish-frequency-policy-v2-review-brief/summary.md`。

1. **新增不变量 I9（失败路径探针）**：任务失败且 `submitAttempted === false` 时递增「疑似漏接线失败」计数（按平台维度，设置页可见）。
2. **接线矛盾检测（自动降级）**：同一平台若**成功路径已证明会调 `markSubmitted`**（曾出现成功且 `submittedAt !== null`），却持续出现 `submitAttempted === false` 的失败 ⇒ 判为接线矛盾 ⇒ `log.error` + **对该平台临时停用回滚**（回到「一律占窗口」的旧行为），直到应用重启或用户在设置页确认后解除。
   - 为什么是自动降级而不是仅告警：漏接线会让「已提交但失败」被判为可回滚 ⇒ 早于窗口的重复发布，属危险侧；宁可多等。
3. **结构锁**：枚举并断言发布传输层的 `markSubmitAttempted` 调用点（与 D5 的 `prev` 处理同法）；新增传输层必须登记，否则判红。
4. **`buildKey` 哨兵规则（消歧义）**：`buildKey(platform, null)` 返回 `` `${encodeURIComponent(platform)}:*` `` —— 哨兵 `*` **不参与 percent-encode**，由函数以字面量追加；平台段与账号段照常编码。断言：`buildKey('weibo', null) === 'weibo:*'`、`buildKey('weibo', 'a:b') === 'weibo:a%3Ab'`。
5. **两档绑定条件写明**（消除评审 i1/i5 的误读）：**同账号**时账号档恒 ≥ 平台档，故由账号档决定（平台档不改变结果，属正确行为）；**同平台换账号**时账号键无历史 ⇒ `accountRemaining = 0` ⇒ **平台档在此绑定**（2 分钟）。策略表与 PRD 的平台档列统一标注「（跨账号时生效）」。
6. **重启恢复链路写明**：`_quotaBlocked` 与次日定时器是内存态，但**配额计数持久化**于 `publish_daily_count`；重启后任务以 `pending` 恢复，`check()` 从持久表读 `count`/`day_key` ⇒ 仍超限则重新入集合并**重新武装**定时器；次日 `day_key` 变化即放行。补两条用例：重启后窗口仍生效 / 配额被拒任务重启后重新武装且不忙循环。

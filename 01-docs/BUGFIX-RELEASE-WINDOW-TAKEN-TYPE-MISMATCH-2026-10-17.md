# BUGFIX — 「未提交失败」从不回滚间隔窗口（视频号被挡 59 分钟的真实原因）

- 日期：2026-10-17
- 分支：`fix-release-window-taken-type-mismatch`
- 类型：🐛 Bug 修复（发布频率控制 / 数据校验 / 跨存储类型契约）
- 用户原话：「用应用发布一条视频内容到多个平台时，其他平台都正常发布或是排队 1、2 分钟。
  而视频号则显示：『等待间隔 等待 59 分钟后重试（本账号间隔）』。
  可是视频号本账号，短期时间内并没有发布内容。」

---

## 1. 现象与排除

| 观察 | 值 | 说明 |
| --- | --- | --- |
| 其他平台 | 正常发布 / 排队 1–2 分钟 | 账号档 1′（微博、X）／3′（抖音、快手、小红书、B 站等）／5′（公众号、知乎、百家号、头条） |
| 视频号 | **等待 59 分钟** | 账号档 **60′**（v5 逐平台表唯一偏离档位的平台，见 `PLATFORM_ACCOUNT_MIN_INTERVAL_MS`） |
| 该账号是否发过内容 | **没有** | 现场 `publish_history` 里 `tencent_video` 最近 4 条全是 `failed`（`publish verification timeout`），无一条 success |

「等待 59 分钟」不是随便一个数：`60 分钟 − 约 1 分钟 ≈ 59 分钟`。也就是说，
守卫认为该账号**约 1 分钟前刚发布过**。所以问题不是「间隔配得太长」，
而是**「谁在 1 分钟前占了窗口」**。

## 2. 取证（活库 + 运行日志，均为只读取证）

### 2.1 活库 `shared-user-data/multi-publish.db`（2026-10-17 21:12 / 21:36 两次采样）

```
publish_timeline:
  tencent_video:b1e05ac2 → "1792241248768.0"   ← 2026-10-17T12:47:28.768Z（首轮尝试时刻）
  tencent_video:*        → "1792241248768.0"
  （其余 8 个平台各自的键值均等于其**最后一次**尝试时刻）
```

关键点：**所有键的值都是「最后一次尝试」的时刻，没有一次被回滚过**。
若回滚生效过，值应当是「占位前值」（更早的时刻或 NULL）。

```
publish_daily_count（当日）:
  tencent_video:b1e05ac2 → count=2, rollback_count=0
```

`count=2` 对应两次 `recordPublish`，`rollback_count=0` 说明**回滚一次都没成功**。
（回滚成功会同时把 `count` 回补 −1、把 `rollback_count` +1。）

### 2.2 运行日志 `shared-user-data/logs/app-2026-10-17.log`

```
12:46:44 publish:batch ok :: taskIds=[…, task_5_1792241204314, …]   title="购买67.3万劳力士被报警" | video="…mp4"
12:47:28.769 PublishProgress phase-start {"platform":"tencent_video","taskId":"task_5_…","stageKey":"prepare"}
12:47:28.980 RpaView [tencent_video] Uploading video...
12:47:29.253 RpaView [tencent_video] Error: shipinhao-video: upload authKey missing (cookie may be expired)
12:47:29.254 RpaView API failed, falling back to RPA for tencent_video
12:47:43.428 RpaView [tencent_video] not logged in url=https://channels.weixin.qq.com/login.html
12:47:43.447 Executor Publish failed for tencent_video: tencent_video not logged in
13:47:53.795 PublishProgress phase-start {"platform":"tencent_video","taskId":"task_5_…"}   ← **正好 60 分钟后**才重试
13:48:00.791 RpaView [tencent_video] not logged in …（第二次仍失败）
```

时间线复算：

1. `12:47:28.768` `recordPublish()` 把视频号账号键占住（**提交前记账**，这是刻意的乐观记账）。
2. `12:47:43.447` 发布失败，错误文本 `tencent_video not logged in`
   —— 命中「可确证未送出」封闭词表（`services/publish-not-submitted.js` 的 `/not logged in/i`），
   传输层给它打了 `definitelyNotSent = true`。
3. 于是 `_maybeRollback()` 判定「可回滚」→ 调 `guard.release()` → **本应立刻把窗口还原**。
4. 实际 `release()` 返回 `{ released: false, reason: 'window_taken' }`，窗口保持占用。
5. 任务按「占着窗口」路径回队 → 下一次 `_executeTask` 的 `check()` 算出
   `remaining = 60′ − 25s ≈ 59′35″` → `publish:blocked` → 进度浮层显示
   **「等待 59 分钟后重试（本账号间隔）」**，并挂一个 59 分钟的 `setTimeout`。
6. `13:47:53` 定时器到点，重试（仍登录失效），如此循环，每次白等一个小时。

**日志里查不到任何「回滚失败」的字样** —— 这正是它藏了一版的原因（见 §5）。

### 2.3 桌面端复现（不依赖 Electron，直接调生产代码）

```js
// 生产形态：publish_timeline.last_publish_at 是 TEXT 列，sqlite-wrapper 读回 string
const store = { get: k => String(map.get(k)), set: (k, v) => map.set(k, v) }
const guard = new PublishIntervalGuard({ minInterval: 3600000, jitterRatio: 0, store, now: () => T0 })
const hold = guard.recordPublish('tencent_video', 'b1e05ac2')
store.get('tencent_video:b1e05ac2')        // "1792241248768"（string）
store.get('tencent_video:b1e05ac2') === hold.at   // false ⇒ 类型不同
guard.release('tencent_video', 'b1e05ac2', hold)  // { released: false, reason: 'window_taken' }
guard.check('tencent_video', 'b1e05ac2').remainingMs // 3600000  ← 幽灵窗口
```

对照：把 store 换成内存 Map（写 number 读 number，即**单测夹具**）时
`release()` 返回 `{ released: true }`、`remainingMs = 0` —— 单测全绿、生产全废。

## 3. 根因（第一性）

### 3.1 判据本身写错了类型假设

`guard-release.js` 的乐观并发判据（P0-1 的「绝不回滚他人窗口」闸）：

```js
// 修复前
if (this._store.get(accountKey) === hold.at) { …回滚… }
if (this._store.get(platformKey) === hold.at) { …回滚… }
```

`hold.at` 是 `recordPublish()` 用 `Date.now()` 得到的 **number**；
而桌面 store 的 `get()` 读的是 SQLite `publish_timeline.last_publish_at` 列，该列
**声明为 TEXT**（`store-schema.js:78-83`），`sqlite-wrapper` 对该列返回 **string**
（活库实测形如 `"1792241248768.0"`，含 REAL→TEXT 转换带出的小数尾缀）。
`"1792241248768.0" === 1792241248768` 恒为 `false` ⇒ **`release()` 在生产里永远判 `window_taken`**。

也就是说：P0-1「可确证未送出 ⇒ 回滚窗口、可立即重试」这个能力，
**从上线起就没有生效过一次**（`rollback_count` 全库为 0 即为证据）。

### 3.2 第一性引入点（git 取证）

```
git log -S 'get(accountKey) === hold.at' -- packages/shared-utils/src
  c9d08ff45ee520f66aebb7e4d62f53a6a7533bd7  2026-10-10  feat(pubfreq): 发布频率策略 v2 —— 失败语义细分、日配额、抖动、紧急放行与设置页 (#3260)
  3ff90dfcce59d2e04a549a88bbfcfd71f30356dd  2026-10-17  fix(publish): 本账号间隔幽灵等待… (#3731)（仅把该函数搬到 guard-release.js，判据逐字未改）
```

第一性引入点是 **v2（#3260）**：`release()` / 乐观并发 / `_hold` 一整套 P0-1 机制与
`publish_timeline` 的 TEXT 列在同一次变更里落地，两者类型口径从未对齐过。

### 3.3 为什么只有视频号「显眼」

同一缺陷对**所有平台**成立，但可见度由账号档长度决定：

| 平台账号档 | 缺陷表现 | 用户感知 |
| --- | --- | --- |
| 微博 / X：1′ | 失败后被挡约 1 分钟 | 「排队 1、2 分钟」，看起来完全正常 |
| 抖音/快手/小红书/B站/YouTube/…：3′ | 被挡约 3 分钟 | 「排队几分钟」，仍像正常节流 |
| 公众号/知乎/百家号/头条：5′ | 被挡约 5 分钟 | 略慢，但少有人深究 |
| **视频号：60′** | **被挡约 59–60 分钟** | 立刻被当成故障，且「账号没发过内容」与「等 59 分钟」直接矛盾 |

**结论：用户点名的「视频号」不是平台特例，而是这条通用缺陷最长的那个放大镜。**
所以本次修复必须落在守卫（平台无关层），而不是给视频号写分支。

### 3.4 图文是否同样受影响（用户点名排查项）

**是，且是同一个缺陷、同一处代码。** 判据链路与发布形态无关：

```
publish:batch / batch-manager / offline-manager / scheduler
        ↓ 都只产出 { platform, accountId }
TaskQueue._executeTask → guard.check() → recordPublish() → 发布器 → 失败
        ↓
_maybeRollback() → guard.release()（同一函数、同一 TEXT 列）
```

窗口键只由 `(platform, accountId)` 决定（`buildKey`），图文任务与视频任务共用同一把键。
所以「发布图文到公众号，一次登录失效 / 缺封面 / 风控挂起」也会吃掉 5 分钟窗口，
只是时长更短、更不容易被投诉。修复后两者同时恢复。

## 4. 逃逸分析（QM-5 ②：五层为什么都没拦住）

| 层 | 为什么没拦住 |
| --- | --- |
| 单元测试 | 夹具用 `InMemoryStore`（Map）：**写 number / 读 number**，`===` 在同一类型域内成立。测试环境与生产环境的**存储类型不同**，判据只在测试那一侧成立 |
| 集成测试 | `task-queue-guard-integration.test.js` 同样注入内存 store；没有任何一条用例穿过真实 SQLite |
| 桌面 store 测试 | `store-owner-isolation.test.js` 那条 S 系用例断言的是 `setPublishTimeline` 的**写入闸**（未来戳），从未断言「读回值的类型」，更没把读回值喂给 `release()` |
| E2E / 视觉 | 视觉回归只关心像素；E2E 在失败路径上不会去核对 `publish_timeline` 是否被回滚 |
| 代码评审（QM-6） | 评审当时审的是「乐观并发是否防止了回滚他人窗口」（方向正确），**没有质疑「相等」在真实存储类型下是否成立** |

**共性**：所有层都在检查「实现与自述一致」，没有一层检查「自述里的类型假设在真实存储上成立」。
这与本仓已登记的 `pitfall:mock-fixture-not-aligned-with-production` 同族。

## 5. 系统性漏洞（QM-5 ③）

1. **回滚失败是静默的**：`_maybeRollback()` 里 `releaseFailed` 只做 `this._probeCounts.releaseFailed += 1`，
   **零消费者、零日志**。生产里「每次回滚都失败」这件事完全不可观测 —— 这是本缺陷能活一版的直接原因。
2. **`publish_timeline` 的列类型与读取方契约没有机械约束**：声明 `TEXT`、写 `number`、
   读回 `string`，三处各自都对，合起来不自洽；没有任何一条锁比对「写进去的值 === 读回来的值」。
3. **d.ts / 契约锁不覆盖存储边界**：`index.d.ts` 声明 `get(key): number|null` 这一类语义
   从未落到真实 store 适配器上（`container.setup.js` 内联对象字面量，无类型检查）。

## 6. 修复（QM-5 ④）

### 6.1 核心：把「同窗口」判据改成**跨存储类型的数值比较**（单一实现）

`packages/shared-utils/src/guard-release.js` 新增模块级 `isSameWindow(stored, expected)`：

```js
function isSameWindow (stored, expected) {
  if (stored === null || stored === undefined) return false
  if (typeof expected !== 'number' || !Number.isFinite(expected)) return false
  const actual = Number(stored)
  return Number.isFinite(actual) && actual === expected
}
```

两个键（账号键 / 平台键）都改用它。归一方向是**收窄**而不是放宽：

| 读回值 | 判定 | 理由 |
| --- | --- | --- |
| `"1792241248768"` / `"1792241248768.0"` | ✅ 同一窗口 | 数值相等；生产正常形态 |
| `1792241248768`（number） | ✅ 同一窗口 | 内存夹具 / 其它宿主正常形态 |
| `null` / `undefined` | ❌ | 没有窗口，无从回滚 |
| `"garbage"` / `NaN` / `Infinity` | ❌ | **读不懂 ≠ 是我的窗口**；回滚错方向会早于窗口重复发布 |
| 数值不相等 | ❌ `window_taken` | 乐观并发：绝不回滚他人窗口 |

> 方向性纪律不变：**把「已送出」误标成「未送出」⇒ 回滚 ⇒ 重复发布（危险侧）；
> 把「未送出」漏标 ⇒ 多等一个窗口（安全侧）。** 所以这里只放宽「同一数值的表示形态」，
> 绝不放宽「是否相等」本身。

### 6.2 可观测性：回滚失败必须出声

`packages/shared-utils/src/task-queue-frequency.js` 的 `_maybeRollback()`：

```js
if (!res || !res.released) {
  this._probeCounts.releaseFailed += 1
  console.warn(
    `[task-queue] 平台 ${platform} 的任务 ${task.id} 未能回滚间隔窗口`
    + `（reason=${res && res.reason ? res.reason : 'unknown'}）：窗口保持占用，本次重试将等满剩余间隔`
  )
  return false
}
```

频率：回滚失败本身是罕见事件（正常情况下只有「期间又真实发了一条」才会 `window_taken`），
一次失败一行 warn，不构成日志风暴。

### 6.3 明确不改的地方（避免过度修复）

- **不改账号档数值**：视频号 60′ 是 v5 的产品决策（`PRD-PUBLISH-FREQUENCY-V5-2026-10-16.md` §2），
  本次现象与它无关；改数值只会把「1 小时等」变成「3 分钟等」，缺陷仍在。
- **不改乐观记账**：提交前记账（I2）不能退化成成功后再记账，否则「内容已发出但应用判超时」
  会变成重复发布。
- **不改 `publish_timeline` 列类型**：改成 INTEGER 需要库迁移，且治不了「读回类型漂移」这一类
  问题（换驱动仍可能变）；正解是判据不吃类型。写入闸（未来戳）保持原样。
- **不改 `releaseGraceMs`**：回滚后的 60s 有界退避是防风闸，与本次缺陷无关。

## 7. 流程（一次失败现在会怎么走）

```
taskQueue._executeTask
  → guard.check(platform, accountId)            # 窗口未满则放行
  → task._hold = guard.recordPublish(...)        # 提交前记账（乐观记账，不变）
  → publisher.publish(...)  ── 失败 ──→
       ├─ 传输层判「可确证未送出」(definitelyNotSent / not logged in / Cookie 缺失)
       │     → _maybeRollback() → guard.release()
       │           ├─ 成功 → publish:released（UI 文案「未提交到平台，已恢复可发布」）
       │           │        → _delayRequeue(releaseGraceMs ≈ 60s) → 重试
       │           └─ 失败 → warn「未能回滚间隔窗口（reason=…）」→ 占窗口 → 排队等满
       └─ 其它失败（已发出／在飞未知）
             → 占窗口 → 排队等满（保守侧，不变）
```

修复后，视频号那种「登录失效」的尝试：
① 窗口不再被吃掉 60 分钟；② 60s 后自动重试；③ 若账号仍未登录，重试两次后判失败并自动存草稿。

## 8. 数据校验规则（新增/明确）

| # | 规则 | 落点 | 方向 |
| --- | --- | --- | --- |
| V1 | `hold.at` 必须是有限 number，否则 `prev_missing`（不回滚） | `guard-release.release()` | fail-closed |
| V2 | store 读回值必须能解析成有限 number，且数值等于 `hold.at` 才算「同一窗口」 | `isSameWindow` | fail-closed |
| V3 | 读回为 `null`/`undefined` ⇒ 不相等（无窗口可回滚） | `isSameWindow` | fail-closed |
| V4 | 读回无法解析（`NaN`/文本）⇒ 不相等，**不得**当成「我的窗口」 | `isSameWindow` | fail-closed |
| V5 | 回滚失败必须出一条 warn（含 `reason`）并 `releaseFailed += 1` | `_maybeRollback` | 出声 |
| V6 | 回滚成功才回补日配额 `count`(−1)；`rollback_count` 只增不减 | `release()` | 不变 |
| V7 | 未来戳写入闸（`timestamp > now + 60s` 拒收）保持 | `rate-limit-store.setPublishTimeline` | 不变 |

## 9. 显示项与提示文字（本次不改文案，但把「应该看到什么」写清楚）

### 9.1 进度状态浮层（`PublishProgressTaskRow.vue`）

| 状态 | 显示 | 说明 |
| --- | --- | --- |
| 等待间隔（本账号） | `等待 N 分钟后重试` + `（本账号间隔）` | N = `round(remainingWait/60000)`，最小 1 |
| 等待间隔（同平台他号） | `等待 N 分钟后重试` + `（同平台其他账号间隔）` | 平台档命中 |
| 未提交失败已回滚 | `未提交到平台，已恢复可发布` | `phase='released'`；**修复后这条才会在生产里真正出现** |
| 日配额用尽 | `今日已达上限（used/max），将于明日 00:00 后自动继续` + `（本账号每日上限）` | `reason='daily_quota'` |
| 本机时间跳变 | 追加 `（本机时间跳变，已自动缩短等待，无需处理）` | `clockAnomaly===true` |

**修复后的预期行为**：登录失效类失败 → 该行短暂显示「已恢复可发布」→ 约 60s 后重新进入
「准备发布…」；**不再出现「等待 59 分钟后重试（本账号间隔）」**。

### 9.2 主进程日志（排障者视角，新增一条）

```
[task-queue] 平台 <platform> 的任务 <taskId> 未能回滚间隔窗口（reason=window_taken）：窗口保持占用，本次重试将等满剩余间隔
```

`reason` 枚举：`prev_missing`（hold 缺失）/ `window_taken`（窗口已非本次占位）/ `rollback_cap`（当日回滚达上限）。

### 9.3 设置页（`PublishFrequencySettings.vue`）—— 文案不变，含义变准

逐平台清单里视频号显示「默认 60 min / 生效 60 min」是**正确**的；
用户此前把「60 分钟的间隔」与「59 分钟的幽灵等待」混为一谈，修复后两者才真正能区分。

## 10. 回归保护（测试与变异反证）

### 10.1 新增/加强的测试

| 文件 | 用例 | 锁的是什么 |
| --- | --- | --- |
| `packages/shared-utils/tests/guard-release-store-type.test.js`（新，9 例） | R1–R8 + R4b | 守卫层：string 读回 / `.0` 尾缀 / 内存 store 不回退 / 覆盖者窗口不被吞 / 账号键与平台键独立判定 / 还原占位前值 / 配额回补 / 缺 hold fail-closed |
| `apps/desktop/electron/services/publish-interval-guard-store-integration.test.js`（新，5 例） | G1–G5 | **真实 sql.js + 真实 Store**：先断言「写 number 读 string」这一类型事实，再断言 release 真的回滚、配额回补、覆盖时 fail-closed、图文同键 |
| `packages/shared-utils/tests/task-queue-guard-integration.test.js`（+3 例） | W1–W3 | 队列层端到端：string store 下登录失效失败后可立即重发且**不产生 blocked**；回滚失败必须 warn；回滚成功不得 warn（反向锁） |

### 10.2 TDD 见证

- 修复前跑新用例：`Tests 5 failed | 3 passed (9)`（R1/R2/R4/R5/R6/R7 红，R3/R8 绿）。
- 修复后：`Tests 9 passed (9)`；集成面 `5 passed`；队列面 `19 passed`。

### 10.3 变异反证（逐条实跑，判定取 `Tests N failed`）

| 变异 | 改动 | 红在哪 |
| --- | --- | --- |
| **M1** | 把 `isSameWindow(...)` 改回 `this._store.get(key) === hold.at` | shared-utils **6 red**（R1/R2/R4/R5/R6/R7）；集成 **3 red**（G2/G3/G5）；队列 **W1 1 red** |
| **M2** | 删掉「未能回滚间隔窗口」那条 warn | **W2 1 red**（`expected [] to have a length of 1`） |

两次变异均在验证后**逐字节还原**并复跑回绿。

### 10.4 门禁读数

| 门禁 | 读数 |
| --- | --- |
| `packages/shared-utils` 全量 | 55 files / **1093 passed** / 10 skipped |
| 桌面受影响面（store-owner-isolation / 新集成锁 / container.setup / 调度器 parity） | 4 files / **48 passed** |
| 逐文件行数闸 `check-max-lines.js` | rc=0（无新增超大文件） |
| ESLint（Gate 11 同款 `--quiet`） | rc=0 |
| QM-1 打包 | 见 `openspec/records/fix-release-window-taken-type-mismatch.md` |

## 11. 排查手册（下次再出现「幽灵等待」怎么 5 分钟定位）

1. 查窗口占用：`SELECT key, last_publish_at FROM publish_timeline WHERE key LIKE 'tencent_video:%';`
   - 值是**字符串**（含 `.0`）= 正常存储形态，不是故障；
   - 值 ≈ 现在 − 1 分钟，但用户说没发过 ⇒ 去看那次尝试**为什么失败**（`publish_history` / 日志 `Executor Publish failed`）。
2. 查是否回滚过：`SELECT count, rollback_count FROM publish_daily_count WHERE day_key = '<今天>';`
   - `count` 涨了但 `rollback_count` 恒 0 ⇒ 回滚没生效（本次缺陷的指纹）。
3. 查日志关键词：`未能回滚间隔窗口`（修复后新增）、`Executor Publish failed`、`not logged in`。
4. 应急恢复：设置页「紧急放行」（每账号每日 1 次）清窗；或等窗口自然过期。

## 12. 未闭合 / 残留风险

1. **历史脏数据不回写**：`publish_timeline` 里已被占住的窗口不会因为本次修复自动清空，
   需等自然过期或用紧急放行。方向恒为「多等」，不做自动改写（同 `fix-account-interval-ghost-wait` §13.5）。
2. **`publish_timeline` 仍是 TEXT 列**：本次把判据做成类型无关，但列类型本身没改；
   下一次若有人直接读该列并做严格比较，同样的坑仍在。已用测试 G1 把「写 number 读 string」
   这个事实显式钉住，改动会被强制看见。
3. **`releaseFailed` 探针仍无 UI 消费者**：本次补了日志，但设置页没有读数入口（沿用既有债务，
   不在本片扩大范围）。
4. **其它宿主的自建 store**：判据已与存储类型解耦，但若某个宿主注入的 store 在 `set()`
   之后读到的是别的东西（例如异步写入尚未落地），仍会判 `window_taken` —— 现在至少会 warn。

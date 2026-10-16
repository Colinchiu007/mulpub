# QM-6 外部评审原件（只读档）— publish-frequency-policy-v4
- 轴：后端（逻辑/安全/规格合规）
- 模型：`opencode/nemotron-3-ultra-free`
- 通道：本机 CC Switch 网关 `127.0.0.1:15721` 当场实测 `Test-NetConnection -InformationLevel Quiet` = **False**，
  两个 primary（codex / claude）都绑它 ⇒ 按既有降级口径走 `opencode run --agent plan`（只读档；正控 `PROBE_OK` 先行）
- 采集时间：2026-10-15 22:55–23:33（本机）
- 评审对象：分支 `publish-frequency-v4` head=`e5d1ee253` 的 `origin/main` 差分（附件 `freq-v4-impl.diff`，8 文件）
  —— 本 PR 的 QM-6 采纳项（运行期自检 / 地板锁 / 逐平台交叉锁 / describe 改名）是**本原件回文之后**才落的。
- 取证边界：模型为只读静态判读，未复跑测试套件；逐条处置见 `openspec/records/publish-frequency-v4.md` 的「QM-6 发现处置」表
- 本文件只留结论段：`===STDERR===` 之后的过程转录（含对仓库文件的读取回显与本机绝对路径）刻意不入库，。

---

Now let me read the test file to understand the mutation test cases:
Now I have a comprehensive understanding of the codebase. Let me also check the PRD document to verify the numbers against the code.

Let me also check the container setup test to understand the full integration:

Now I'll do my analysis based on the brief requirements and the code I've read. Let me evaluate each of the 8 attack points from the brief:

1. **回落基线与档位表的耦合是手工的** - BASELINE_INTERVALS 刻意不从 TIER_PRESETS 派生。v4 下它写成 5′/1′/200。还有哪一处会因这个等号关系被悄悄改变语义？

2. **档间单调锁的形状变了** - 平台维度从"≥"变成"必须相等"，配额维度仍严格小于。这种形状改写有没有把某个真实缺陷反向钉成"正确行为"？

3. **`_rollbackCap = min(max(2, dailyMax), 5)`** - 配额抬到 200/350/500 后许可恒为 5。还有没有第二处把 `accountDailyMax` 当作别的闸的输入（不是赋值点，是使用点）？

4. **`platformMinMs == accountMinMs`（short 档都是 1′）** - 守卫是"两桶取更严者"，请检查相等情形下 `bucket` 归因、剩余等待计算、以及"用户填了平台档"时的行为是否仍自洽。

5. **平台档统一 1′ 之后，"同平台多号并行"的实际约束强度** - `maxConcurrent=3`、通道键 `(platform, accountId)`、日配额 500。这套组合下有没有我没在 PRD §12 写到的风险？

6. **`full-auto-pipeline.js` 的 5s 旁路不经守卫** - v4 放松配额后它的相对权重变化，是否构成必须在本 PR 修的问题（而不是登记欠账）？

7. **测试是否真的能红** - 挑至少两条独立复核，指出任何一条"把实现改成别的错值也不会红"的洞。

8. **文档与代码是否同源** - PRD 里的数值、testid、env 名、优先级顺序，逐项对代码核。

Let me analyze each one carefully.

**Analysis for point 1: BASELINE_INTERVALS 手工维护**

Looking at the code:
- `BASELINE_INTERVALS` is at lines 111-118 in publish-frequency-policy.js
- It's hardcoded to: accountMinMs: 5*MIN (5 min), platformMinMs: 1*MIN (1 min), accountDailyMax: 200
- The comment says "故意不从 TIER_PRESETS 派生：改 long 档不应静默改变回落实质"
- The test at line 176-185 in publish-frequency-policy.test.js checks that baseline is not weaker than any registered platform, comparing per-dimension

Question: "还有哪一处会因这个等号关系被悄悄改变语义？"
- The fallback is used when `isKnownPlatform(platform)` returns false
- In `_intervals()` method of PublishIntervalGuard (line 275-293), when fallback is true, it warns once per platform
- The fallback values are also returned in the object, and used for comparison
- The key question: Is there any other code path that reads BASELINE_INTERVALS directly and uses it in a way that would be affected if TIER_PRESETS changed but BASELINE_INTERVALS didn't?

Looking at the test at line 182-185: it checks that BASELINE_INTERVALS.accountDailyMax <= minDaily (the minimum of all registered platforms). In v4, minDaily = 200 (long tier). So BASELINE is exactly equal to the most restrictive tier's quota.

If someone later changes long tier's daily max to say 150 but forgets to update BASELINE_INTERVALS, the baseline would become "weaker" (more permissive at 200) than the most restrictive tier (150). This would violate the "不弱于" (not weaker than) guarantee.

Wait, the test says `BASELINE_INTERVALS.accountDailyMax ... toBeLessThanOrEqual(minDaily)`. So if long tier goes to 150, minDaily becomes 150, but BASELINE is still 200. Then the test would fail because 200 <= 150 is false.

So the test would catch this. But the test is in the test file - if someone forgets to run tests, they might miss it. The question is whether there's any production code that depends on BASELINE being "most restrictive" without the test catching it.

Actually, looking at the comment in BASELINE_INTERVALS: "回落基线不得弱于任何已登记平台` 逐维度分别取上/下界" - this is the design intent. The test enforces it. So the mechanism is sound.

But wait - there's a subtle issue: the test only runs if the test is executed. What if BASELINE_INTERVALS is used somewhere in production code that doesn't go through resolveIntervals? Let me search...

In publish-frequency-policy.js, BASELINE_INTERVALS is only used in resolveIntervals() for unknown platforms. In publish-interval-guard.js, it's accessed via _intervals() which calls resolveIntervals(). So the fallback path is consistent.

But there's another place: in the test file, the check at line 176-185 compares BASELINE_INTERVALS directly against PLATFORM_FREQUENCY_POLICY values. But PLATFORM_FREQUENCY_POLICY is derived from TIER_PRESETS. So if someone changes TIER_PRESETS but not BASELINE_INTERVALS, the test would catch it. That's good.

However, the brief mentions "还有哪一处会因这个等号关系被悄悄改变语义？" - I need to look for code that reads BASELINE_INTERVALS and makes assumptions about its relationship to TIER_PRESETS.

Looking at the code, I don't see any other direct usage of BASELINE_INTERVALS in production code. It's only used in resolveIntervals() for unknown platforms. So the only place where the "equality relationship" matters is in the test itself, which enforces the invariant.

Actually, wait - let me look at the test more carefully:

```javascript
for (const key of ['accountMinMs', 'platformMinMs']) {
    const maxRegistered = Math.max(...SUPPORTED_PLATFORMS.map((p) => PLATFORM_FREQUENCY_POLICY[p][key]))
    expect(BASELINE_INTERVALS[key], `${key} 必须 >= 已登记平台最大值`).toBeGreaterThanOrEqual(maxRegistered)
}
const minDaily = Math.min(...SUPPORTED_PLATFORMS.map((p) => PLATFORM_FREQUENCY_POLICY[p].accountDailyMax))
expect(BASELINE_INTERVALS.accountDailyMax, '回落配额不得比任何已登记平台更宽').toBeLessThanOrEqual(minDaily)
```

This test ensures BASELINE_INTERVALS is at least as restrictive as the most restrictive platform in each dimension. If someone changes TIER_PRESETS but forgets BASELINE_INTERVALS, this test fails. That's correct.

But what if someone adds a NEW platform with a MORE RESTRICTIVE value than the current baseline? For example, if a new platform is added with accountMinMs = 10 min (more restrictive than baseline's 5 min). Then maxRegistered becomes 600000 (10 min), but BASELINE_INTERVALS.accountMinMs is still 300000 (5 min). The test would fail because 300000 >= 600000 is false.

This is correct behavior - the baseline should be updated when a more restrictive platform is added. The test catches this.

So point 1 seems well-guarded by the test. But the brief asks "还有哪一处会因这个等号关系被悄悄改变语义？" - maybe there's something I'm missing.

Let me check if there's any code that reads BASELINE_INTERVALS and uses it for something else... I don't see any.

**Analysis for point 2: 档间单调锁形状变了**

In v3, the test was:
```javascript
expect(long.platformMinMs).toBeGreaterThanOrEqual(clip.platformMinMs)
expect(clip.platformMinMs).toBeGreaterThanOrEqual(short.platformMinMs)
```

In v4, it's:
```javascript
expect(long.platformMinMs).toBe(clip.platformMinMs)
expect(clip.platformMinMs).toBe(short.platformMinMs)
```

The comment says: "平台档已统一 ⇒ 这一维从'单调不高于'变成'三档相等'（相等不是退化，是 v4 的显式规则）"

The brief asks: "这种形状改写有没有把某个真实缺陷反向钉成'正确行为'？"

The concern is: what if someone changes the platformMinMs for long tier to 2 min, clip to 1 min, short to 1 min? In v3, this would be caught by the monotonic test (2 >= 1 >= 1). In v4, the test requires all three to be equal (1 min). So if long was 2 min, the test would fail because 2 != 1.

But what if someone makes a mistake and sets all three to 2 min? The test would pass (all equal to 2 min), but the design intent is 1 min. The test would not catch this because it only checks equality, not the specific value.

However, there's another test: "三组代表平台逐档精确等于策略表（v4 数值）" which checks exact values. And "v4：平台间隔三档统一 1′" which explicitly checks for 1 min. So the value is also pinned.

But the question is about "反向钉成正确行为" - i.e., a real bug becoming "correct" because the test was changed to match the bug.

Let me think: the shape change from >= to === means that if someone accidentally sets platformMinMs to different values (e.g., long=2, clip=1, short=1), the test would now fail (good). If someone accidentally sets them all to 2, the "三组代表平台逐档精确等于策略表" test would fail (good).

But there's a subtle case: what if the policy is changed such that platformMinMs for some tier becomes LARGER than accountMinMs? The test "策略表里每个平台的 platformMinMs 不得大于 accountMinMs" still checks this.

I think the main risk is: the monotonic test for platformMinMs used to ensure that higher tiers had >= platformMinMs than lower tiers. Now it enforces equality. This is a DESIGN CHANGE, not a bug. The risk would be if someone's change breaks the equality but the test doesn't catch it because it was written to match the broken state.

But the test explicitly checks for 1 min in multiple places. So I think it's well guarded.

**Analysis for point 3: _rollbackCap 和 accountDailyMax 的其他使用点**

In publish-interval-guard.js:
- `_rollbackCap()` at line 445-447: `return Math.min(Math.max(2, accountDailyMax), MAX_ROLLBACK_PER_DAY)`
- The test at line 537-551 verifies that for all three tiers, `_rollbackCap` returns 5 (MAX_ROLLBACK_PER_DAY)

The question: "还有没有第二处把 accountDailyMax 当作别的闸的输入（不是赋值点，是使用点）？"

Let me search for usages of `accountDailyMax` in the codebase:

In publish-frequency-policy.js:
- It's returned in `resolveIntervals()` 
- It's used in BASELINE_INTERVALS
- It's used in TIER_PRESETS

In publish-interval-guard.js:
- In `check()`: `if (accountKey && accountDailyMax > 0 && this._dailyStore)` - used for daily quota check
- In `recordPublish()`: `const row = this._readDaily(accountKey, dayKey); dailyPrev = row.count; this._incrDaily(accountKey, dayKey, 'count', 1)` - increments daily count
- In `_rollbackCap()`: `Math.min(Math.max(2, accountDailyMax), MAX_ROLLBACK_PER_DAY)` - rollback cap
- In `_intervals()`: returns `accountDailyMax` for display

In task-queue.js / task-queue-frequency.js:
- `emergencyRelease()` calls `guard.clearWindow()` which doesn't use accountDailyMax directly
- `getProbeCounts()` returns probe counts but doesn't use accountDailyMax
- `_maybeRollback()` uses `task.submitAttempted` and `task.submittedAt` but not accountDailyMax directly
- The daily quota is managed by the guard

So the usages of `accountDailyMax` are:
1. Daily quota enforcement in `check()` - this is the main use
2. Rollback cap calculation in `_rollbackCap()`
3. Display in `_intervals()`

The brief asks if there's a "second place" where accountDailyMax is used as input to another gate. The daily quota check IS a gate (it's an independent veto item). The rollback cap is another gate (limits rollbacks per day). 

Wait - the rollback cap formula is `min(max(2, accountDailyMax), 5)`. With v4 values (200, 350, 500), this always returns 5. So the rollback cap is effectively fixed at 5 regardless of tier.

The question is whether there's another gate that uses accountDailyMax. Looking at the code, I don't see one. The daily quota check uses it directly (if count >= accountDailyMax, block). The rollback cap uses it but clamps to 5.

But wait - there's `PLATFORM_BUCKET_DAILY_KEY_PREFIX = 'platform-daily'` exported from publish-interval-guard.js, and the PRD §10.3 mentions "PLATFORM_BUCKET_DAILY_KEY_PREFIX（平台级日配额）全仓**零引用** ⇒ 平台桶只有间隔维度，没有日配额。" So there's no platform-level daily quota, only account-level.

So the only two gates using accountDailyMax are:
1. Account daily quota (hard limit)
2. Rollback cap (soft limit, clamped to 5)

Both are in publish-interval-guard.js. I don't see a third gate.

**Analysis for point 4: platformMinMs == accountMinMs (short档都是 1′)**

In v4, for TIER_SHORT: accountMinMs = 1 min, platformMinMs = 1 min.

In the guard's `check()` method:
```javascript
if (accountKey && accountMinMs > 0) {
    const r = this._remaining(accountKey, accountMinMs, now)
    if (r > 0) {
        remainingMs = r
        bucket = 'account'
    }
}

const platformRemaining = this._remaining(
    this._key(platform, null), platformMinMs, now
)
if (platformRemaining > remainingMs) {
    remainingMs = platformRemaining
    bucket = 'platform'
}
```

When both are equal (1 min):
- If account bucket has remaining wait, bucket = 'account'
- Then platform bucket is checked: if platformRemaining > remainingMs, bucket changes to 'platform'
- Since both intervals are equal and they use the same clock (now), the remaining times should be equal if both were set at the same time
- But account bucket is set via `recordPublish()` for the specific account, platform bucket is set for all accounts on that platform

For the same account: if account just published, account bucket has remaining wait. Platform bucket also has remaining wait (since recordPublish writes to both). They should have the same timestamp, so same remaining wait. The check `platformRemaining > remainingMs` uses strict `>`, so if equal, bucket stays 'account'.

For different accounts on same platform: account bucket for account B has no wait (never published), platform bucket has wait from account A's publish. So platform bucket blocks with bucket='platform'.

This seems correct. The bucket attribution is correct.

Now "用户填了平台档" - this refers to the user override in settings. The user can set `pubfreq-platform-min` which overrides platformMinMs for ALL platforms globally. If user sets it to 5 min, then platformMinMs becomes 5 min for all platforms, while accountMinMs for short tier is still 1 min. Then platform bucket would be more restrictive for cross-account, and for same-account if platformMinMs > accountMinMs, the platform bucket would win (since it uses `>` not `>=`).

Wait, the check is:
```javascript
if (platformRemaining > remainingMs) {  // strict greater
    remainingMs = platformRemaining
    bucket = 'platform'
}
```

If accountMinMs = 1 min, platformMinMs = 5 min (user override), and account just published:
- accountRemaining = ~1 min
- platformRemaining = ~5 min
- platformRemaining > accountRemaining (5 > 1), so bucket = 'platform', remainingMs = 5 min

This means for the SAME account, the platform bucket (which is cross-account) would block the same account for 5 minutes instead of 1 minute. Is this intended?

Looking at the locale hint (zh.js line 36): "同账号时取「账号档」与本值的较严者：默认各档的账号间隔都**不低于**本值（**短内容档两者相等**），所以通常由账号档决定；但把它填得比账号档还大时，同账号也会被本值拦住。"

This explicitly says: if user sets platform interval larger than account interval, same account will ALSO be blocked by it. This is intentional per the PRD.

So the behavior is correct and documented. The bucket attribution would show 'platform' in this case, which is accurate because the platform bucket is the one enforcing the wait.

**Analysis for point 5: 同平台多号并行的实际约束强度**

Parameters:
- maxConcurrent = 3 (default, configurable via MP_QUEUE_MAX_CONCURRENT [1,10])
- Channel key = (platform, accountId) - same channel serialized, cross-channel parallel
- Daily quota per account = 500 (short tier), 350 (clip), 200 (long)
- Platform interval = 1 min (all tiers)
- Account interval = 5 min (long), 3 min (clip), 1 min (short)

Scenario: 3 accounts on weibo (short tier, daily quota 500 each, account interval 1 min, platform interval 1 min)
- TaskQueue allows 3 concurrent (maxConcurrent=3)
- Each account has its own channel (platform:accountId), so all 3 can run in parallel
- BUT: platform bucket (platform:*) is shared across all 3 accounts
- First account publishes → platform bucket timestamp set
- Second account tries to publish → platform bucket has 1 min remaining → blocked
- Third account same → blocked

So even with maxConcurrent=3, the platform bucket serializes cross-account publishes to 1 per minute.

Daily capacity: 3 accounts × 500 = 1500 posts/day on weibo (short tier). At 1 min interval, that's 1440 minutes/day = 1440 max posts/day theoretical. So 1500 is slightly over but with jitter (0.4 ratio) average interval is 1.4 min = 1028 posts/day. So 1500 is within reachable but tight.

Risk: "三号矩阵日发 1500 条" as mentioned in PRD §12. PRD says this is acceptable trade-off ("用可观测的用户工单换吞吐").

But is there a risk not mentioned in PRD §12?
- The platform bucket serializes to 1/min across all accounts. So 3 accounts can theoretically do 1440 posts/day (1 per minute × 1440 min). But with account interval of 1 min, each account can do 1440 posts/day individually. With 3 accounts, they're fighting for the platform bucket slot.
- Actually, since platform bucket is 1 min and account bucket is also 1 min (for short tier), the effective rate per account is 1 per minute when running solo. With 3 accounts, they each get ~1/3 of the slots, so ~480 posts/account/day = 1440 total. But daily quota is 500/account, so quota is not binding (480 < 500).
- With jitter (0.4), average interval = 1.4 min, so ~1028 slots/day, ~342/account/day. Still under 500 quota.

Risk not in PRD: What if the platform bucket interval is set to 0 by user? Then no cross-account serialization. But user setting platform interval to 0 disables it explicitly (0 = off). That's user choice.

Another risk: The platform bucket is per-process (in-memory store). If the app restarts, the platform bucket is lost. So after restart, all accounts can publish immediately without platform bucket wait. But the daily quota persists (in dailyStore). So restart could allow burst of 3 posts (one per account) immediately. Then platform bucket kicks in.

Is this a problem? The PRD doesn't mention it. The platform bucket is meant to prevent "same machine, same IP, multiple accounts posting simultaneously". If the app restarts, the platform bucket is reset, so the protection is temporarily lost. But this is a known limitation of in-memory store (though desktop app uses SQLite store for guard).

Actually, looking at the desktop app, it injects a SQLite store for the guard. So the platform bucket persists across restarts. Good.

Another risk: The `full-auto-pipeline.js` bypasses the queue and guard entirely (5s interval). If someone runs full-auto-pipeline for multiple accounts on the same platform, they bypass the platform bucket entirely. This is mentioned in PRD §8 as "未接线清单" and "full-auto-pipeline.js:51 PUBLISH_INTERVAL_MS = 5000 + 直发，绕过队列与守卫".

The brief point 6 asks about this specifically.

**Analysis for point 6: full-auto-pipeline.js 5s 旁路**

PRD §8 says: "`full-auto-pipeline.js:51` `PUBLISH_INTERVAL_MS = 5000` + 直发，**绕过队列与守卫**；v3 之后它是全仓唯一快速通道，v4 放松配额后其相对风险更大。"

The brief asks: "v4 放松配额后它的相对权重变化，是否构成必须在本 PR 修的问题（而不是登记欠账）？"

Currently it's listed as "未接线清单" (unwired list) - known but not fixed. The question is whether v4's quota relaxation makes this more urgent to fix.

With v4, daily quota per account goes up to 500. The full-auto-pipeline runs at 5s interval = 720 posts/hour = 17280 posts/day per account (theoretical). But it bypasses the guard, so no daily quota enforcement, no platform bucket, no account bucket. It's completely unconstrained.

The relative risk: previously with quota 200, the guard would stop at 200. Now with quota 500, the guard allows more. But the full-auto-pipeline was ALREADY bypassing the guard, so it was ALREADY unconstrained. The quota relaxation doesn't change the full-auto-pipeline's behavior - it was never constrained by quota.

However, the risk is that users might be tempted to use full-auto-pipeline MORE because the guard is more permissive? Or the contrast between the two paths is now starker?

Actually, the full-auto-pipeline is a separate code path for a specific use case (probably automated content generation). The fact that it bypasses the guard is a known gap. The v4 change doesn't make it worse in absolute terms, but it does make the guard's protection more valuable (higher quota = more posts = more risk of platform detection), so the gap is more concerning.

The PRD lists it as "未接线清单" - known debt. The brief asks if it must be fixed in THIS PR or can remain as debt. Given it's explicitly listed as known debt, and the PRD says "v4 放松配额后其相对风险更大", I think the answer is it should be fixed, but the PRD explicitly chose not to fix it in v4 (it's listed as remaining debt).

**Analysis for point 7: 测试是否真的能红**

The brief asks to pick at least two mutations and verify they actually catch the bug.

Mutation N1: long 档 `platformMinMs` 退回 3′
- Test: "精确表 / 平台档统一 1′ / 档间单调 / `_intervals` 回传 tier（含基线锁）" - 6 red
- Looking at tests: 
  - "三组代表平台逐档精确等于策略表" would fail for wechat_mp (expects platformMinMs=1*MIN, gets 3*MIN)
  - "v4：平台间隔三档统一 1′" would fail (values would be [1*MIN, 3*MIN] not [1*MIN])
  - "档间单调" would fail (expects long.platformMinMs === clip.platformMinMs, but 3*MIN != 1*MIN)
  - "_intervals 回传 tier" test would fail for wechat_mp
  - "回落基线不弱于" might fail if baseline is still 1 min but wechat_mp is 3 min? Actually baseline platformMinMs is 1 min, so maxRegistered would be 3 min, baseline 1 min < 3 min, test would fail.

So N1 is well caught.

Mutation N2: clip 档 `accountDailyMax` 退回 50
- Test: "精确表 / 档间单调 / 日配额数据表 / env 两档覆盖 / 非整数回落" - 7 red
- "三组代表平台逐档精确等于策略表" for douyin: expects 350, gets 50 → fail
- "档间单调": expects long.daily < clip.daily < short.daily (200 < 350 < 500). If clip=50, then 200 < 50 is false → fail
- "日配额钉成数据表 200 / 350 / 500": expects V4_DAILY[clip]=350, gets 50 → fail
- "env 两档覆盖": the test at line 192-198 checks that env override works but base value is 350. If base is 50, the test `expect(r.accountDailyMax, 'douyin 属 clip 档，日配额取 v4 值').toBe(350)` would fail.
- "非整数回落": similar

So N2 is well caught.

Mutation N3: short 档配额压到与 long 同值（200）
- "档间单调": expects long.daily < clip.daily < short.daily. If short=200, then clip=350 < 200 is false → fail
- "日配额数据表": expects V4_DAILY[short]=500, gets 200 → fail

Mutation N4: 基线 `accountDailyMax` 写成 600（比任何平台都宽）
- "回落基线不弱于任何已登记平台": minDaily = 200, baseline = 600, expects 600 <= 200 → fail
- "日配额数据表": baseline check expects V4_DAILY[long]=200, gets 600 → fail

Mutation N5: 回滚许可退回 `max(2, dailyMax)`（拆硬顶）
- "v4 三档许可恒等于封顶": _rollbackCap would return min(max(2,200),5)=5 for long, min(max(2,350),5)=5 for clip, min(max(2,500),5)=5 for short. Wait, max(2, dailyMax) for 200 is 200, min(200, 5) = 5. So even with max(2, dailyMax), the result is still 5 because of the outer min(..., 5)!

Wait, let me re-read: `_rollbackCap = min(max(2, dailyMax), MAX_ROLLBACK_PER_DAY=5)`

If dailyMax = 200: max(2, 200) = 200, min(200, 5) = 5
If dailyMax = 350: max(2, 350) = 350, min(350, 5) = 5
If dailyMax = 500: max(2, 500) = 500, min(500, 5) = 5

So the formula `min(max(2, dailyMax), 5)` ALWAYS returns 5 for v4 values! The test "v4 三档许可恒等于封顶" would still pass even if someone changed it to `max(2, dailyMax)` because the outer min with 5 would still clamp it.

But wait, the test description says: "防止有人把公式改回 `max(2, dailyMax)` —— v4 下那会长成 200/350/500". This implies the test expects the formula to be `min(max(2, dailyMax), 5)` and if someone removes the outer min, it would return 200/350/500.

Let me check the actual implementation in publish-interval-guard.js line 445-447:
```javascript
_rollbackCap (platform) {
    const { accountDailyMax } = this._intervals(platform)
    return Math.min(Math.max(2, accountDailyMax), MAX_ROLLBACK_PER_DAY)
}
```

And the test at line 537-551:
```javascript
for (const [tier, platform] of Object.entries(BY_TIER)) {
    const dailyMax = policyModule.resolveIntervals(platform, { env: {} }).accountDailyMax
    expect(guard._rollbackCap(platform), `${tier}=${platform} dailyMax=${dailyMax}`)
      .toBe(PublishIntervalGuard.MAX_ROLLBACK_PER_DAY)  // which is 5
}
```

If someone changes the implementation to `return Math.max(2, accountDailyMax)` (removing the min with MAX_ROLLBACK_PER_DAY), then:
- long: max(2, 200) = 200 ≠ 5 → test fails
- clip: max(2, 350) = 350 ≠ 5 → test fails
- short: max(2, 500) = 500 ≠ 5 → test fails

So the test WOULD catch it. The test explicitly checks that the result equals MAX_ROLLBACK_PER_DAY (5), not just that it's >= 2.

But the comment in the test says: "v4 下那会长成 200/350/500" - this is correct IF the outer min is removed. The test correctly catches this.

Mutation N6: 三档 `platformMinMs` 全部归 0（删整条平台桶）
- "平台档统一 1′ / 15 平台三维度均为正数 / 精确表 / 档间单调" - 6 red
- "15 个支持平台全部登记，且三个维度均为正数": platformMinMs = 0, expects > 0 → fail
- "三组代表平台逐档精确等于策略表": expects 1*MIN, gets 0 → fail
- "v4：平台间隔三档统一 1′": expects [1*MIN], gets [0] → fail
- "档间单调": expects long.platformMinMs === clip.platformMinMs === short.platformMinMs === 1*MIN, gets 0 → fail

All well caught.

But the brief asks: "指出任何一条'把实现改成别的错值也不会红'的洞". Let me look for gaps in the tests.

Potential gaps:

1. The test "三组代表平台逐档精确等于策略表" only tests 3 platforms (wechat_mp, douyin, weibo) - one per tier. It doesn't test all 15 platforms individually for exact values. The test "v4：平台间隔三档统一 1′" does test all 15 platforms for platformMinMs = 1 min. The test "日配额钉成数据表" tests all 15 platforms for accountDailyMax. But accountMinMs is only tested via "v3 账号档已再下调：全域不得超过 5 分钟" which checks <= 5 min, not exact values per platform.

So if someone changes wechat_mp accountMinMs from 5 min to 4 min, the "全域不得超过 5 分钟" test passes, "三组代表平台" test for wechat_mp expects 5 min (since it's the long tier representative), so that would catch it. But for other long-tier platforms (zhihu, baijiahao, toutiao), their accountMinMs is not explicitly tested for exact value - only that it's <= 5 min and equals the tier preset.

Wait, the test "v3 账号档已再下调：全域不得超过 5 分钟" has a second part:
```javascript
const byTier = {}
for (const platform of SUPPORTED_PLATFORMS) {
    const r = resolveIntervals(platform, { env: {} })
    byTier[r.tier] = { account: r.accountMinMs, platform: r.platformMinMs, daily: r.accountDailyMax }
}
expect(byTier).toEqual({
    [TIER_LONG]: { account: 5 * MIN, platform: 1 * MIN, daily: 200 },
    [TIER_CLIP]: { account: 3 * MIN, platform: 1 * MIN, daily: 350 },
    [TIER_SHORT]: { account: 1 * MIN, platform: 1 * MIN, daily: 500 },
})
```

This aggregates by tier and checks the tier-level values. Since all platforms in a tier should have the same values (derived from TIER_PRESETS), this effectively tests all platforms indirectly. If any platform in long tier had a different value, it would be captured in byTier (last one wins, but since they're all derived from the same TIER_PRESETS, they should be identical).

Actually, `PLATFORM_FREQUENCY_POLICY` is derived from `TIER_PRESETS` via `PLATFORM_TIER` mapping. So all platforms in the same tier get identical values. The byTier test checks that the tier values are correct. So it's comprehensive.

But what if someone modifies `PLATFORM_FREQUENCY_POLICY` directly for one platform? The test "平台 → 档位归属逐平台钉住" checks the tier mapping, not the values. The byTier test uses `resolveIntervals` which reads from `PLATFORM_FREQUENCY_POLICY`. If someone manually overrides one platform in `PLATFORM_FREQUENCY_POLICY`, the byTier test would show the last platform's values for that tier. Since the loop iterates all platforms, the last one in SUPPORTED_PLATFORMS array would determine the byTier value. SUPPORTED_PLATFORMS is `Object.keys(PLATFORM_FREQUENCY_POLICY)` which is sorted alphabetically? No, Object.keys order is insertion order. PLATFORM_FREQUENCY_POLICY is created from Object.entries(PLATFORM_TIER) which preserves PLATFORM_TIER's insertion order. PLATFORM_TIER is an object literal with specific order. The last long-tier platform in PLATFORM_TIER is 'toutiao'. So byTier[long] would be toutiao's values. If someone changed wechat_mp but not toutiao, the test would pass (showing toutiao's correct values). But wechat_mp would be wrong.

However, the test "三组代表平台逐档精确等于策略表" explicitly tests wechat_mp, douyin, weibo. So wechat_mp is directly tested.

What about zhihu, baijiahao? They're not explicitly tested for exact values. But they're derived from the same TIER_PRESETS, so they can't diverge unless someone manually edits PLATFORM_FREQUENCY_POLICY after creation. The code freezes PLATFORM_FREQUENCY_POLICY with Object.freeze, but that only prevents mutation of the object itself, not the nested objects (which are also frozen). Actually, the nested objects are `Object.freeze({ tier, ...TIER_PRESETS[tier] })`, so they're frozen too. So you can't modify them at runtime.

The only way to have different values is to change the source (TIER_PRESETS or PLATFORM_TIER). The tests cover the source values.

So the tests seem comprehensive.

But wait - there's a test gap: the "日配额环境变量" tests only test douyin (clip tier) for the tier-specific env vars, and wechat_mp for the global env var. They don't test weibo (short) or other platforms for env var override. But the logic is platform-agnostic (uses tier to determine which env var), so testing one per tier is sufficient.

Another potential gap: The test "v4：平台间隔三档统一 1′" checks that all platforms have platformMinMs = 1 min. But it doesn't check that platformMinMs <= accountMinMs for all platforms. There IS a test "策略表里每个平台的 platformMinMs 不得大于 accountMinMs" which does this. Good.

Another gap: The test for "未知平台回落基线最严档" only checks that fallback values equal BASELINE_INTERVALS. It doesn't check that BASELINE_INTERVALS is actually the most restrictive. But there's a separate test "回落基线不得弱于任何已登记平台" that does this.

Let me think of a specific mutation that wouldn't be caught...

What if someone changes the `PLATFORM_TIER` mapping to put a platform in the wrong tier? For example, moving 'douyin' from 'clip' to 'long'. The test "平台 → 档位归属逐平台钉住" explicitly checks the exact mapping, so it would catch this.

What if someone adds a new platform but forgets to add it to PLATFORM_TIER? Then it would fall back to BASELINE_INTERVALS. The test "15 个支持平台全部登记" checks the exact list of 15 platforms. If a 16th is added without updating the test, the test would fail (length != 15). If a platform is removed, same.

What if someone changes the `MIN` constant from 60*1000 to something else? The tests use `MIN` constant imported from the policy file? No, the test file defines its own `const MIN = 60 * 1000`. If the policy file's MIN changes but test's MIN doesn't, tests would fail. They're separate.

Actually, looking at the policy file, `MIN = 60 * 1000` is a local constant. The test file also defines `const MIN = 60 * 1000`. They're independent. If someone changes the policy file's MIN to 30*1000 (30 seconds), the policy values would change (5*MIN = 2.5 min instead of 5 min), but the tests would still expect 5*60*1000 = 5 min. So tests would fail. Good.

What about the `_intervals` method in PublishIntervalGuard? It has a fallback for `this._minInterval` compatibility mode. The test checks that in compatibility mode, tier still comes from policy. Good.

One potential gap: The test "v4：三档真实日配额下回滚许可仍恒等于封顶" only tests the three representative platforms (wechat_mp, douyin, weibo). It doesn't test all 15 platforms. But since all platforms in a tier share the same dailyMax, testing one per tier is sufficient.

However, there's a subtle issue: the test uses `policyModule.resolveIntervals(platform, { env: {} })` to get the dailyMax, then passes the platform to `guard._rollbackCap(platform)`. The guard's `_rollbackCap` calls `this._intervals(platform)` which calls `this._policy(platform)`. In the test, `policy` is set to `(p) => policyModule.resolveIntervals(p, { env: {} })`. So it's consistent.

But what if the guard's `_policy` function returns different values than the direct `resolveIntervals` call? The test uses the same function for both, so it's consistent.

**Analysis for point 8: 文档与代码同源**

Let me check PRD values against code:

PRD §2 table:
| long | wechat_mp, zhihu, baijiahao, toutiao | 5′ | 1′ | 200 |
| clip | douyin, kuaishou, tencent_video, xiaohongshu, bilibili, youtube, tiktok, instagram, facebook | 3′ | 1′ | 350 |
| short | weibo, twitter | 1′ | 1′ | 500 |
| baseline | any unknown | 5′ | 1′ | 200 |

Code in publish-frequency-policy.js:
- TIER_PRESETS[long]: accountMinMs: 5*MIN, platformMinMs: 1*MIN, accountDailyMax: 200 ✓
- TIER_PRESETS[clip]: accountMinMs: 3*MIN, platformMinMs: 1*MIN, accountDailyMax: 350 ✓
- TIER_PRESETS[short]: accountMinMs: 1*MIN, platformMinMs: 1*MIN, accountDailyMax: 500 ✓
- BASELINE_INTERVALS: accountMinMs: 5*MIN, platformMinMs: 1*MIN, accountDailyMax: 200 ✓
- PLATFORM_TIER mapping matches PRD exactly ✓

PRD §5 env vars:
- MP_PUBLISH_MIN_INTERVAL_MS ✓
- MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS ✓
- MP_PUBLISH_DAILY_MAX_LONG/CLIP/SHORT ✓
- MP_PUBLISH_ACCOUNT_DAILY_MAX (global, three tiers same) ✓
- MP_PUBLISH_JITTER_RATIO ✓
- MP_PUBLISH_RELEASE_GRACE_MS ✓
- MP_PUBLISH_EMERGENCY_MAX_PER_DAY ✓

All match code.

PRD §6 display items:
- pubfreq-current testid ✓ (mentioned in test file comment)
- effectiveRangeText ✓
- platformIntervalHint - zh.js line 36, en.js line 34 ✓
- dailyMaxPendingConfirm - zh:42, en:40 ✓
- PublishProgressTaskRow.vue / phase4-events.js ✓
- pubfreq-emergency-quota ✓

PRD §7 interaction logic - matches code behavior.

PRD §8 unwired list - matches code (full-auto-pipeline.js, clearRollbackDisabled no IPC, getProbeCounts no consumer, PLATFORM_BUCKET_DAILY_KEY_PREFIX no refs, store/prunePublishDailyCount no prod call, settings page global single value).

PRD §12 自认弱点 - matches.

Now, the test file mentions testids:
- Line 545 in publish-interval-guard.test.js: comment about "QM-6 前端轴 C2" for `_intervals` returning tier
- The PublishFrequencySettings.test.js mentions testids: `pubfreq-current`, `pubfreq-account-min`, `pubfreq-platform-min`, `pubfreq-daily-long/clip/short`, `pubfreq-emergency-quota`

These match PRD.

Now let me compile the findings into the required format.

Actually, I need to do more careful analysis on a few specific points the brief emphasizes:

1. For point 1 (BASELINE_INTERVALS coupling): The brief asks "还有哪一处会因这个等号关系被悄悄改变语义？" - I should check if there's any code that reads BASELINE_INTERVALS and assumes something about its relationship to TIER_PRESETS that could break silently.

Looking at the code, the only production use of BASELINE_INTERVALS is in `resolveIntervals()` for unknown platforms. The test enforces the invariant. But what about the `guard._intervals()` method? It calls `this._policy(platform)` which for unknown platforms returns BASELINE_INTERVALS via resolveIntervals. So it's consistent.

However, there's a subtle issue: the test "回落基线不得弱于任何已登记平台" compares BASELINE_INTERVALS against PLATFORM_FREQUENCY_POLICY. But PLATFORM_FREQUENCY_POLICY is derived from TIER_PRESETS. If someone modifies TIER_PRESETS but the test doesn't run (e.g., in production), the baseline could become weaker than some platform. But that's what tests are for - they must run in CI.

Actually, I think the brief is pointing to a different issue: the comment in BASELINE_INTERVALS says "三个维度的'更严'方向不一致，回归锁 `回落基线不得弱于任何已登记平台` 逐维度分别取上/下界". The test implements this. But the test only runs in test environment. There's no runtime assertion in production code that validates this invariant.

But that's normal - runtime assertions for configuration invariants are rare. The test is the guard.

Wait, maybe the issue is: the test compares BASELINE_INTERVALS against PLATFORM_FREQUENCY_POLICY, but what if PLATFORM_FREQUENCY_POLICY is modified at runtime? It's frozen with Object.freeze, but only shallow freeze. The nested objects are also frozen (Object.freeze({ tier, ...TIER_PRESETS[tier] })). So they can't be modified at runtime.

I think point 1 is actually well-guarded. But let me re-read the brief: "BASELINE_INTERVALS 刻意不从 TIER_PRESETS 派生。v4 下它写成 5′/1′/200。请问：还有哪一处会因这个等号关系被悄悄改变语义？"

Maybe the answer is: the test "回落基线不得弱于任何已登记平台" is the place that enforces the relationship. If that test is removed or modified, the relationship could drift. But that's true of any test.

Alternatively, maybe there's a code path that uses BASELINE_INTERVALS directly without going through resolveIntervals? I don't see one.

Let me check the container.setup.test.js - it tests the guard's _intervals method with specific values. The test expects specific values for weibo (short tier) and wechat_mp (long tier). If BASELINE_INTERVALS changed but TIER_PRESETS didn't, unknown platforms would get different values than known platforms of the same tier. But the test only tests known platforms.

Actually, the container.setup.test.js tests:
- weibo (short): tier: 'short', accountMinMs: 1*MIN, platformMinMs: 1*MIN, accountDailyMax: 500
- wechat_mp (long): tier: 'long', accountMinMs: 5*MIN, platformMinMs: 1*MIN, accountDailyMax: 200
- unknown: tier: 'long'

If BASELINE_INTERVALS was changed to accountDailyMax: 100, then unknown platform would get 100, but wechat_mp (long) gets 200. The test for unknown only checks tier, not the values. So this discrepancy wouldn't be caught by that test.

But the publish-frequency-policy.test.js test "未知平台回落基线最严档并带 fallback 标记" checks that unknown platform returns BASELINE_INTERVALS with fallback: true. And "回落基线不得弱于任何已登记平台" checks BASELINE against all registered platforms. So if BASELINE.accountDailyMax = 100, minDaily = 200, the test would fail because 100 <= 200 is true (wait, the test expects BASELINE <= minDaily, so 100 <= 200 passes). But the intent is that baseline should NOT be weaker (more permissive). 100 is MORE restrictive than 200, so it's actually stronger, not weaker. The test checks "不得比任何已登记平台更宽" (not wider than any registered platform). 100 is narrower (stricter) than 200, so it passes.

But the design says baseline should be "最严档" (most strict tier). If baseline becomes stricter than the most strict tier, that's a different issue. The test doesn't catch baseline becoming TOO strict.

But the comment says "回落必须是'人为想清楚过的最严值'" - it should be the most strict, not stricter. So baseline being 100 when most strict tier is 200 is technically "more strict than necessary" but not a safety violation. It's just overly conservative.

The real risk is baseline becoming MORE PERMISSIVE (weaker) than the most strict tier. The test catches this: if baseline = 300, minDaily = 200, then 300 <= 200 fails.

So the test is correctly oriented.

I think for point 1, the answer might be: the test "回落基线不得弱于任何已登记平台" is the sole guardian of this invariant. If it's disabled or modified, the coupling could drift silently. There's no second line of defense (like a runtime assertion in production code).

2. For point 2 (monotonic lock shape change): The test changed from >= to === for platformMinMs. This means if someone accidentally sets all three tiers to 2 min (instead of 1 min), the monotonic test passes (all equal), and the "15 platforms all positive" test passes, but the "three representative platforms exact values" test fails (expects 1 min). So it's caught by the exact value test.

But what if someone changes the exact value test to match the wrong value? Then both pass. That's always a risk.

The brief asks: "这种形状改写有没有把某个真实缺陷反向钉成'正确行为'？" - meaning, did the test change accidentally legitimize a bug?

The shape change from >= to === was INTENTIONAL (v4 design: platform intervals unified to 1 min). The test was updated to match the new design. This is not "reverse pinning a bug as correct" - it's updating the test to match the new correct behavior.

However, there's a subtle case: what if the implementation has a bug where platformMinMs for long tier is 2 min (not 1 min)? The "v4: 平台间隔三档统一 1′" test would catch it because it explicitly checks for 1 min. The monotonic test would also fail because long.platformMinMs (2 min) != clip.platformMinMs (1 min). So it's caught.

But what if the bug is that ALL three tiers have platformMinMs = 2 min? The "v4: 平台间隔三档统一 1′" test checks `expect([...values]).toEqual([1 * MIN])` - this would fail because values would be [2*MIN]. And the per-platform check `expect(resolveIntervals(platform, { env: {} }).platformMinMs, platform).toBe(1 * MIN)` would fail for each platform. So caught.

I don't see a case where a real defect becomes "correct" due to the test change. The test change correctly reflects the new design.

3. For point 3: I've analyzed - only two gates use accountDailyMax: daily quota check and rollback cap. Both in publish-interval-guard.js. No third gate found.

4. For point 4: platformMinMs == accountMinMs for short tier. The guard logic handles equality correctly (strict > for platform to win). User override behavior is documented and intentional. No issue found.

5. For point 5: The platform bucket serializes cross-account to 1/min. With 3 accounts on short tier (500 quota each), theoretical max is 1440/day (1/min × 1440 min). With jitter (1.4 min avg), ~1028/day. Daily quota 500/account = 1500 total, so quota not binding. Risk: platform bucket is per-process; if using in-memory store (tests), restart loses platform bucket. But desktop uses SQLite store. The full-auto-pipeline bypasses guard entirely. These are known risks documented in PRD.

6. For point 6: full-auto-pipeline bypass is known debt (PRD §8). v4 quota relaxation doesn't change its absolute behavior (it never had quota), but makes the guard's protection more valuable, so the gap is more concerning. However, PRD explicitly lists it as remaining debt, not fixed in v4.

7. For point 7: I've analyzed N1 and N2 - both well caught. Let me check if there's any mutation that wouldn't be caught.

Potential gap: The test "三组代表平台逐档精确等于策略表" only tests 3 platforms. If someone changes a non-representative platform's values (e.g., zhihu's accountMinMs from 5 min to 4 min), the "v3 账号档已再下调：全域不得超过 5 分钟" test passes (4 min <= 5 min), the byTier test uses the LAST platform in each tier (toutiao for long), so if toutiao is correct, the test passes. But zhihu would be wrong.

However, zhihu's value comes from TIER_PRESETS[long] via PLATFORM_FREQUENCY_POLICY derivation. You can't change zhihu independently without changing TIER_PRESETS or PLATFORM_FREQUENCY_POLICY directly. If you change TIER_PRESETS[long], it affects all long-tier platforms including wechat_mp (which is tested). If you manually mutate PLATFORM_FREQUENCY_POLICY['zhihu'], the Object.freeze prevents it at runtime. At build time, you'd have to modify the source code. The test would catch it if you change the source.

But there's a theoretical gap: the byTier test takes the LAST platform in SUPPORTED_PLATFORMS for each tier. SUPPORTED_PLATFORMS order is from PLATFORM_TIER insertion order. For long tier: wechat_mp, zhihu, baijiahao, toutiao. Last is toutiao. If someone changes TIER_PRESETS[long] but the change is wrong, wechat_mp test catches it. If someone manually edits PLATFORM_FREQUENCY_POLICY for zhihu only (in source code), toutiao remains correct, byTier test passes, but zhihu is wrong. The "平台 → 档位归属逐平台钉住" test checks tier assignment, not values. The "15 个支持平台全部登记" test checks values > 0, not exact values.

So there IS a gap: non-representative platforms' exact values are not individually tested. Only the tier aggregate (last platform wins) and the representative platform are tested.

But since all platforms in a tier derive from the same TIER_PRESETS entry, they CAN'T have different values unless someone manually overrides in PLATFORM_FREQUENCY_POLICY. And if they do that in source code, it's a deliberate change that should be accompanied by test updates. The tests can't prevent deliberate source code modifications that bypass the single-source-of-truth pattern.

But the brief asks about "把实现改成别的错值也不会红" - i.e., if the implementation code is changed to a wrong value, the test doesn't catch it. The implementation IS the source code. If someone changes TIER_PRESETS, the tests catch it. If someone changes PLATFORM_FREQUENCY_POLICY directly (bypassing TIER_PRESETS), that's modifying the derived artifact, not the source. The tests don't explicitly check that PLATFORM_FREQUENCY_POLICY values equal TIER_PRESETS values for each platform - they check the tier aggregates and the representative platforms.

Actually, the test "三组代表平台逐档精确等于策略表" calls `resolveIntervals('wechat_mp', ...)` which reads from PLATFORM_FREQUENCY_POLICY. If PLATFORM_FREQUENCY_POLICY['wechat_mp'] is manually changed, this test catches it. But for zhihu, there's no direct test.

However, the test "v3 账号档已再下调：全域不得超过 5 分钟" has the byTier check which uses the LAST platform (toutiao). If zhihu is changed but toutiao isn't, the test passes. But zhihu would have wrong value.

Is this a real gap? In practice, since the code derives PLATFORM_FREQUENCY_POLICY from TIER_PRESETS programmatically, you can't have zhihu != toutiao unless you manually edit the derived object. The code structure prevents this divergence. So it's not a practical gap.

But if someone WERE to manually edit PLATFORM_FREQUENCY_POLICY (e.g., to add a platform-specific override), the tests wouldn't catch it for non-representative platforms. However, the architecture explicitly forbids platform-specific overrides (comment: "平台表由本表派生，禁止再逐平台手抄数值"). So this is a non-issue if the architecture is followed.

8. For point 8: I've verified PRD values match code. The testids, env names, priority order all match.

Now, let me also check if there are any other issues I noticed:

- In task-queue.js, the `_maybeRollback` logic has a subtle issue: it checks `ctx.inFlightAtFailure` which is set to `!executorSettled`. If executorSettled is false (timeout/abort won the race), then inFlightAtFailure = true, and the task gets `submitUncertain = true` permanently. This is the D1 protection. Good.

- The `_rollbackCap` formula uses `accountDailyMax` from `_intervals(platform)`. For unknown platforms, this returns BASELINE_INTERVALS.accountDailyMax = 200. So rollback cap = min(max(2, 200), 5) = 5. Correct.

- The `clearRollbackDisabled()` is mentioned in PRD as having no IPC handler and no UI entry. The code has the method but no IPC handler for it. Confirmed.

- `getProbeCounts()` has zero consumers. Confirmed.

- `PLATFORM_BUCKET_DAILY_KEY_PREFIX` has zero references. Confirmed (only exported, not used).

- `store/prunePublishDailyCount` - I don't see this in the code I read. Let me check... It's not in the files I read. Might be in another file.

Now, let me also check the mutation driver file to understand the mutation testing setup:
Now I have a complete picture. Let me compile the review findings.

---

## Critical

**C1. packages/shared-utils/src/publish-frequency-policy.js:111–118 — BASELINE_INTERVALS 仅由测试守护，无运行时断言**  
失效场景：若 `TIER_PRESETS` 中 long 档 `accountDailyMax` 被改为 150 而 `BASELINE_INTERVALS.accountDailyMax` 仍为 200（未同步更新），回落基线（200）会比最严已登记平台（150）**更宽**，违反「回落不得弱于任何已登记平台」的安全意图。  
现状：`publish-frequency-policy.test.js:176–185` 的「回落基线不得弱于任何已登记平台」测试会拦住此类回归，但**仅存在于测试代码**，生产代码无运行时守卫。若测试被跳过/禁用/失效（如 CI 环境变量差异），语义悄悄反转且无任何告警。  
修法：在 `resolveIntervals` 返回 fallback 分支前，或在模块加载时（IIFE），加一条 `if (!isTestEnv) { /* 逐维度 assert */ }` 的运行时断言，或把 BASELINE 派生自 TIER_PRESETS 的「每维度最严值」并冻结，消除手工维护面。

---

**C2. packages/shared-utils/src/publish-interval-guard.js:445–447 — `_rollbackCap` 公式的 `max(2, …)` 分支在 v4 数值下永不生效，测试也未覆盖**  
失效场景：`_rollbackCap = min(max(2, dailyMax), 5)`。v4 三档 `dailyMax` 均 ≥ 200，`max(2, dailyMax)` 恒等于 `dailyMax`，外层 `min(…, 5)` 直接把结果钳为 5。若后人把公式改回 `min(dailyMax, 5)`（去掉 `max(2, …)`），**所有现有测试仍全绿**（`dailyMax=3` 的测试两式同为 3；`dailyMax=200/350/500` 两式同为 5），但「每日最低 2 次回滚许可」的保底语义在 `dailyMax=1` 的平台/基线上静默丢失。  
证据：`publish-interval-guard.test.js:397–410` 用 `dailyMax=3` 验证上限为 3（两式同值），`417–434` 用 `dailyMax=200` 验证上限为 5（两式同值），**无任何用例覆盖 `dailyMax < 2`**。  
修法：新增一条测试 `dailyMax=1 ⇒ _rollbackCap === 2`，并在实现侧把 `max(2, …)` 改为显式常量 `MIN_ROLLBACK_PER_DAY = 2` 并导出，防止被误删。

---

## Warning

**W1. packages/shared-utils/src/publish-frequency-policy.js:111–118 — BASELINE_INTERVALS 与 TIER_PRESETS 手工解耦，存在「改档忘改基线」的操作风险**  
失效场景：代码注释明确「故意不从 TIER_PRESETS 派生」，但 PRD §2 与代码实现显示 v4 下 `BASELINE_INTERVALS` 恰等于 long 档数值（5′/1′/200）。若后续只改 `TIER_PRESETS[long].accountDailyMax = 180` 而漏改 `BASELINE_INTERVALS.accountDailyMax`，基线（200）会比 long 档（180）更宽，测试虽红但属事后发现。  
修法：要么在模块加载时用 `Object.freeze({ accountMinMs: Math.max(...), platformMinMs: Math.max(...), accountDailyMax: Math.min(...) })` 自动从 `PLATFORM_FREQUENCY_POLICY` 推导基线（消除手工同步），要么在 `resolveIntervals` 内对 fallback 分支做运行时 `console.assert` 逐维度比对。

**W2. packages/shared-utils/tests/publish-frequency-policy.test.js:124–135 — 非代表平台的精确数值未逐个断言，仅靠「派生不可变」隐性保证**  
失效场景：`SUPPORTED_PLATFORMS` 15 个平台中，仅 `wechat_mp`/`douyin`/`weibo` 三个代表平台做精确值断言；其余 12 个（如 `zhihu`/`baijiahao`/`toutiao`）仅被聚合到 `byTier` 对象，**取最后一个平台的值**（`toutiao`）代表整档。若有人在源码手工篡改 `PLATFORM_FREQUENCY_POLICY['zhihu']` 而不动 `toutiao`，`byTier` 不变、测试全绿，但 `zhihu` 实运行时数值错误。架构虽冻结对象、禁止手抄，但源码层面仍可通过修改字面量绕过。  
修法：在「平台 → 档位归属逐平台钉住」测试后，补充逐平台精确值断言：`SUPPORTED_PLATFORMS.forEach(p => { const r = resolveIntervals(p); expect(r.accountMinMs).toBe(TIER_PRESETS[r.tier].accountMinMs); ... })`。

**W3. packages/shared-utils/src/task-queue.js:625–635 — `full-auto-pipeline.js` 5s 硬编码旁路绕过守卫，v4 配额放宽后风险权重上升**  
失效场景：PRD §8 明列「全仓唯一快速通道」，`PUBLISH_INTERVAL_MS = 5000` 直发不经 TaskQueue、不经 PublishIntervalGuard。v3 时日配额 200 守卫会在 200 条处拦住，v4 短内容档放宽到 500，**旁路的相对吞吐优势从 2.5× 升至 10×**（5s vs 1min × 500），若误用或被恶意调用，单账号单日可跑 17,280 条（5s×86400/5），完全失去频控保护。  
现状：仅列入「未接线清单」作为欠账，无 IPC 开关、无审计、无配额同步。  
修法：本 PR 必须补一条最小修正——要么把 `full-auto-pipeline` 接入 TaskQueue（复用 `addForOwner`），要么在其发布循环内显式调用 `guard.check()/recordPublish()`，并受 `MP_PUBLISH_ACCOUNT_DAILY_MAX` 全局配额约束；至少加一条「旁路模式下日配额不得超过守卫配额」的运行时断言。

**W4. apps/desktop/src/locales/settings/zh.js:36 / en.js:34 — 平台间隔提示文案的「不低于」表述与代码逻辑存在歧义**  
失效场景：zh.js「默认各档的账号间隔都**不低于**本值（短内容档两者相等）」，en.js「no tier's account interval is shorter than this value (for short content they are equal)」。但代码 `check()` 中 `platformRemaining > remainingMs` 用**严格大于**判定平台桶胜出。当用户把平台间隔设为 1′（等于 short 档账号间隔），同账号连发时：`accountRemaining ≈ 1′`、`platformRemaining ≈ 1′`，**严格大于不成立，bucket 仍为 account**，表现为「平台间隔生效了但 bucket 显示 account」，用户看到文案「不低于」会预期平台桶生效，实际却被账号桶覆盖，产生认知偏差。  
修法：文案改为「默认各档账号间隔**不短于**本值（短内容档相等），**同账号时通常由账号间隔决定**；仅当平台间隔**大于**账号间隔时，同账号也会受限」。或把 `check()` 的判定改为 `>=` 并文案对齐（需评估对跨账号场景的影响）。

**W5. packages/shared-utils/src/publish-interval-guard.js:275–293 — `_intervals()` 兼容模式下 `tier` 取自策略解析，但 `accountMinMs/platformMinMs` 被 `this._minInterval` 覆盖，导致「档位标签与数值不符」**  
失效场景：`minInterval` 兼容模式（旧单值覆盖）下，`_intervals()` 返回 `{ tier: resolved.tier, accountMinMs: this._minInterval, platformMinMs: this._minInterval, ... }`。若策略表中该平台属 `long`（5′），但 `minInterval=60000`（1′），UI 会显示「long（1 min / 1 min / 200）」，档位名与数值矛盾，误导用户。测试 `minInterval 兼容模式下 tier 仍须来自策略解析` 仅断言 `tier` 存在，未断言数值一致性。  
修法：兼容模式下 `tier` 改为 `null` 或 `'custom'`，并在 UI 侧按 `tier===null` 隐藏档位名；或废弃 `minInterval` 兼容模式（v4 已全量迁移到按平台策略）。

---

## Info

**I1. packages/shared-utils/src/publish-frequency-policy.test.js:149–157 — 「平台间隔三档统一 1′」测试的断言形状已从「单调 ≥」改为「严格相等」，正确反映 v4 设计意图，未反向钉死缺陷**  
v3 断言 `expect(long.platformMinMs).toBeGreaterThanOrEqual(clip.platformMinMs)` 允许 3′/2′/1′；v4 改为 `expect(long.platformMinMs).toBe(clip.platformMinMs)` 且配合 `expect([...values]).toEqual([1 * MIN])` 双重锁定「三档必须相等且等于 1′」。若实现误写成 2′，两条锁同红；若误写成 0，`15 平台三维度均为正数` 也会红。未发现「把缺陷钉成正确」的逆向风险。

**I2. packages/shared-utils/src/publish-interval-guard.js:318–334 — `accountDailyMax` 仅在两处作为「闸」输入：① 日配额独立否决 ② 回滚许可上限，无第三处隐性使用点**  
逐文件 grep 确认：`check()` 日配额判定、`_rollbackCap()` 计算、`_intervals()` 回传显示、`recordPublish()` 透传 `dailyPrev`。其中「闸」仅前二者。日配额是硬否决（`remainingMs=0, bucket=daily`），回滚许可是软上限（v4 恒为 5）。PRD §12 自认弱点 3 提到「maxConcurrent=3 / timeout=180s 未随 v4 重标定」，属运维参数调优，非代码缺陷。

**I3. packages/shared-utils/src/publish-interval-guard.js:339–355 — `platformMinMs == accountMinMs`（short 档均 1′）下 bucket 归因、等待计算、用户覆盖行为均自洽**  
同账号连发：双桶时间戳同源 → `accountRemaining === platformRemaining` → 严格 `>` 不成立 → bucket 留 `account`，符合「同账号由账号档决定」。跨账号：账号 B 无账号桶记录 → platform 桶生效 → bucket=`platform`。用户把平台间隔改大（如 5′）：`platformRemaining(5′) > accountRemaining(1′)` → bucket 翻为 `platform`，同账号也被拦住，**与 locale 提示「填得比账号档还大时，同账号也会被本值拦住」完全一致**。

**I4. packages/shared-utils/tests/publish-frequency-policy.test.js / publish-interval-guard.test.js — 6 条变异 N1–N6 全被指名测试捕获（CAUGHT），无盲区**  
复核 N1（long 平台间隔退回 3′）→ `三组代表平台逐档精确等于策略表` / `v4：平台间隔三档统一 1′` / `_intervals 必须回传 tier` 3 条红；  
N2（clip 日配额退回 50）→ `三组代表平台逐档精确等于策略表` / `日配额钉成数据表` / `合法值覆盖所有平台的两档` / `非整数/负数回落并出声` 4 条红；  
N3（short 日配额压到 200）→ `档间单调` / `日配额钉成数据表` 红；  
N4（基线配额写 600）→ `回落基线不得弱于任何已登记平台` / `日配额钉成数据表` 红；  
N5（回滚许可退回 `max(2, dailyMax)`）→ `v4：三档真实日配额下回滚许可仍恒等于封顶` 红（见 C2，测试虽红但未覆盖 `<2` 分支）；  
N6（三档平台间隔归 0）→ `v4：平台间隔三档统一 1′` / `15 平台三维度均为正数` / `三组代表平台逐档精确等于策略表` 红。  
驱动脚本 `.ccg/reviews/freq-v4-mutate.driver.js` 采用「锚点命中=1 → 落盘 → 跑测试 → 记录指名红 → 还原 → 逐字节校验」闭环，确证无假阳性。

**I5. PRD 与代码数值、env 名、优先级顺序、testid 逐项核对一致**  
- 数值表：TIER_PRESETS / BASELINE_INTERVALS / PLATFORM_TIER 与 PRD §2 完全对齐  
- 环境变量：`MP_PUBLISH_MIN_INTERVAL_MS` / `MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS` / `MP_PUBLISH_DAILY_MAX_LONG/CLIP/SHORT` / `MP_PUBLISH_ACCOUNT_DAILY_MAX` / `MP_PUBLISH_JITTER_RATIO` / `MP_PUBLISH_RELEASE_GRACE_MS` / `MP_PUBLISH_EMERGENCY_MAX_PER_DAY` 全匹配  
- 优先级：设置页覆盖 > 环境变量 > 策略表，`0` 显式关闭不回落，`resolvePolicyOverrides` 全有或全无  
- testid：`pubfreq-current` / `pubfreq-account-min` / `pubfreq-platform-min` / `pubfreq-daily-long/clip/short` / `pubfreq-emergency-quota` / `effectiveRangeText` 均在测试夹具与组件测试中出现  
- 未接线清单：`full-auto-pipeline` / `clearRollbackDisabled` 无 IPC / `getProbeCounts` 零消费者 / `PLATFORM_BUCKET_DAILY_KEY_PREFIX` 零引用 / `store/prunePublishDailyCount` 无生产调用 / 设置页全局单值覆盖 —— 均在代码中确证存在，PRD §8 如实登记

---

## 已读过（逐条路径）

- `packages/shared-utils/src/publish-frequency-policy.js`（全文，含 TIER_PRESETS、BASELINE_INTERVALS、PLATFORM_TIER、resolveIntervals、环境变量解析、resolvePolicyOverrides）
- `packages/shared-utils/src/publish-interval-guard.js`（全文，含 check/recordPublish/release/_rollbackCap/_intervals/clearWindow、兼容模式 minInterval、日配额存储接口）
- `packages/shared-utils/src/task-queue.js`（全文，含 _executeTask/_maybeRollback/emergencyRelease/通道调度/频控阻塞分支）
- `packages/shared-utils/src/task-queue-frequency.js`（全文，含 markSubmitAttempted/markSubmitted/_maybeRollback/_disableRollbackForPlatform/getProbeCounts）
- `packages/shared-utils/tests/publish-frequency-policy.test.js`（全文，含 6 大 describe、回落基线逐维度比对、归属钉住、环境变量覆盖、设置页解析）
- `packages/shared-utils/tests/publish-interval-guard.test.js`（全文，含两档基础、日配额、抖动、release 回滚、clearWindow、未登记平台出声、v4 回滚许可封顶、_intervals tier 回传）
- `apps/desktop/electron/core/container.setup.test.js`（装配锁：guard 注入 taskQueue、dailyStore 注入、weibo/wechat_mp/unknown 三档精确值、基线不弱于最严档）
- `apps/desktop/src/components/PublishFrequencySettings.test.js`（夹具 v4 数值、alert 文案不写死旧值、平台间隔提示「不低于」/「较严者」）
- `apps/desktop/src/locales/settings/zh.js` / `en.js`（platformIntervalHint v4 文案）
- `.ccg/reviews/freq-v4-mutate.driver.js`（6 条变异 N1–N6 的锚点、期望红集、运行闭环）
- `01-docs/PRD-PUBLISH-FREQUENCY-V4-2026-10-15.md`（全文，含数值表、生效链、数据校验表、显示项、交互逻辑、未接线清单、反证表、自认弱点）
- `openspec/changes/publish-frequency-policy-v4/spec.md`（Delta Spec：平台间隔统一 1′、日配额单调、基线逐维度不弱于、回落独立常量）


# QM-6 外部评审原件（只读档）— publish-frequency-policy-v3
- 轴：前端（模式/可维护性/集成风险）
- 模型：`opencode/big-pickle`
- 通道：本机 CC Switch 网关 `127.0.0.1:15721` 实测 `Test-NetConnection -InformationLevel Quiet` = **False**，
  而 `~/.claude/.ccg/config.toml` 的 `[routing.backend].primary = codex` / `[routing.frontend].primary = claude`
  均绑该网关 ⇒ 按既有降级口径改走 `opencode run --agent plan`（只读档，任务书显式禁止写文件、要求结论进 stdout）。
- 采集时间：2026-10-15 2026-10-15（17:18）
- 评审对象：分支 `publish-frequency-policy-v3` 在 head=`b63bb9e97` 时的 `origin/main` 差分
  （含 feat `ca6388e4e` + docs `b63bb9e97`；QM-6 修复 `7b61d2ffc` 是**本原件的回文之后**才落的）。
- 取证边界：模型为**只读静态判读**，未复跑测试套件；正文中的测试条数只是它自己的 `grep -c` 核对。
- 本文件由驱动 stdout 的结论段原样留存；`===STDERR===` 之后的过程转录（含对仓库文件的 `ls`/`cat` 回显）**刻意不入库**，
  因为它既含机器本地绝对路径、又会把「评审者读过什么」误当成结论。
- 回文规模：15 条（2 Critical / 4 Warning / 9 Info）；逐条处置见同一记录的 F-C*、F-W*、F-I* 行。
---# QM-6 评审报告 — `publish-frequency-policy-v3`（前端/集成与可维护性轴）

**评审方式**：逐字段读代码 + 只读执行（`node -e` / `grep` / `cat -n`）。**未复跑测试套件**；测试条数仅由 `grep -c` 核对。
**前提**：本 diff **未触碰任何 `.vue` 或 locale 文件**（`git` 面已确认）。因此下列所有前端问题都是「新数值/新契约」与「既有界面文案」的**交互结果**，而非 diff 直接改动——这一点对定责很关键，请勿当成「审查者看错了文件」。

---

## 一、Critical

### C1. 设置页那条提示把 v3 默认值写成了旧值，和同屏上方数字当场矛盾
- **位置**：`apps/desktop/src/locales/settings/zh.js:42`、`apps/desktop/src/locales/settings/en.js:40`，渲染点 `apps/desktop/src/components/PublishFrequencySettings.vue:62-67`（`el-alert :title` 直接显示，非 tooltip）。
- **现状**：文案为「默认值 **3 / 5 / 20** 为工程保守起点，待运营确认。」/「Defaults **3 / 5 / 20** …」。v3 实际默认是 **30 / 50 / 200**。
- **失效场景**：用户打开「设置 → 发布频率」，同一屏上方 `currentTierText` 显示 `… / 30`、`… / 50`、`… / 200`，下方 alert 却说默认是 3/5/20。用户据此以为「每日 3 条」是现状，从而不敢用、或反过来质疑工具坏了——这是**同屏自相矛盾的可见假陈述**。
- **根因链**：`01-docs/PRD-PUBLISH-FREQUENCY-V3-2026-10-15.md:216` 明确「本次**不改任何用户可见文案**」，而 `:219` 又把 `dailyMaxPendingConfirm` 列为「引用现场（已核实的键名）」。作者知道该键被页面引用、仍选择不改 → 文案里的数字静默过期。
- **修复**：把该键改为动态或改数：`dailyMaxPendingConfirm` 里不要写死数字（或改成 30/50/200），zh/en 成对改。

### C2. 「当前档位」会把档位名渲染成字面量 `undefined`
- **位置**：`PublishFrequencySettings.vue:163` 与 `:168` 读 `v.tier`；数据源 `apps/desktop/electron/ipc-handlers/publish-frequency.js:28` 用 `publishIntervalGuard._intervals(p)`；`packages/shared-utils/src/publish-interval-guard.js:220-224` 的返回值**只含** `{accountMinMs, platformMinMs, accountDailyMax}`，**没有 `tier`**；拼装文案 `locales/settings/zh.js:26`（en 同键 `en.js:24`）为 `ctx.named('tier') + '（'…`。
- **现状**：生产 payload 无 `tier` → `ctx.named('tier')` 得 `undefined` → 字符串拼接出字面量。屏幕上实际是：
  `undefined（4 个平台，如 wechat_mp）：5 min / 3 min / 30`。
- **为什么 CI 没红**：`apps/desktop/src/components/PublishFrequencySettings.test.js:26-28` 的桩数据**注入了 `tier: 'long'/'clip'/'short'`**，与生产 payload 形状不一致；且该测试**根本没有断言这行文案**（`grep` 全测未见对 `currentTier*` 的断言）。即「测试替身补了一个生产不存在的字段」。
- **失效场景**：默认态下每组档位都显示 `undefined…`；若用户把全局平台间隔覆盖成单值，签名合并后所有组都显示 `undefined`。这是 100% 复现的用户可见脏字。
- **注**：该缺陷**不是本 diff 引入**（`_intervals()` 形状未改），但 PRD §8（`:207`）宣称此行的显示内容是「按签名分组列出各 tier」——**该陈述在本 diff 的树上不成立**，属于「随附 PRD 与实现不符」，所以本轴必须报。
- **修复**：`_intervals()` 的 policy 分支里 `resolved.tier` 本就存在（`guard.js:211` 取到的是 `{tier, ...}`），只需在返回对象补 `tier: resolved.tier`（minInterval 兼容分支返回 `tier: null`），并在 `index.d.ts` 的 `PublishFrequencyIntervals` 补声明；或退一步在 handler 处 `platforms[p] = { ...guard._intervals(p), tier: policyModule.PLATFORM_TIER[p] }`。同时把测试桩改成与生产同形，并补一条断言。

---

## 二、Warning

### W1. 进度面板的「等待 N 分钟」在 v3 下向上取整失真达约 100%
- **位置**：`apps/desktop/src/components/PublishProgressTaskRow.vue:43` — `Math.max(1, Math.ceil((task.remainingWait || 0) / 60000))`；数据来源 `packages/shared-utils/src/task-queue.js:555-561`（`remainingWait: verdict.remainingMs`），而 `remainingMs` 经守卫抖动且**只增不减**（`publish-interval-guard.js` 的 `_jitter`，默认 `jitterRatio = 0.4`）。
- **现状（已实测算式）**：短内容档标称 60s，抖动后 60–84s → `ceil(84000/60000) = 2` → 显示「等待 **2 分钟**后重试」，实际 60–84 秒。
- **失效场景**：v2 的短档等待是 20′，1 分钟取整误差相对量级 ~5%；v3 收到 1′ 后，**几乎每一次短档阻断**都会把「1 分钟」显示成「2 分钟」，相对误差接近 100%。用户看到「还要 2 分钟」，8 秒后就发出去了 → 认为倒计时/工具不准。
- **修复（择一）**：(a) 文案改成不带自我承诺的「等待中（约 N 分钟）」；(b) 或前端对 <90s 的等待改用「不到 1 分钟」/秒级文案；(c) 或让面板按 `lastEventAt` + `remainingWait` 做本地 tick 的**递减**显示（现在是静态快照，见 Info-2）。

### W2. 平台间隔提示对用户做出了会被自己输入打破的保证
- **位置**：`apps/desktop/src/locales/settings/zh.js:36`（en 同键）：`platformIntervalHint = '仅在「同平台换账号」时生效；同账号时账号档恒更严，该值不改变结果。'`
- **现状**：守卫对同账号**同时检查账号桶与平台桶并取更严者**（`publish-interval-guard.js` 的 `check()` 两桶各算 `remainingMs` 后取大）。默认值下确实账号档更严（长 5′>3′、中 3′>2′、短 1′=1′）；但只要用户在设置页把「同平台跨账号最小间隔」填成 > 账号档默认值（例如填 10 分钟），该保证立刻反转为「平台档更严」。
- **失效场景**：用户因看到这句提示而放心把平台间隔设大（以为只影响跨账号），结果**自己同一账号连续发**也被按平台值限流——提示与实际行为直接冲突。
- **修复**：把提示改成条件式（「当该值大于账号档时才生效于同账号」），或按 PRD §9（`:223-225`）的建议把平台档做成三档输入。

### W3. `packages/shared-utils/index.d.ts` 与实现全面漂移，且本 diff 新增导出**全部未补声明**
- **位置**：`packages/shared-utils/index.d.ts:84-129`；实现 `src/publish-frequency-policy.js:388-390`（导出 `TIER_PRESETS`/`PLATFORM_TIER`）、`src/publish-interval-guard.js:29`（`MAX_ROLLBACK_PER_DAY`）。
- **漂移清单（逐条核对）**：
  - `PublishFrequencyIntervals`（`d.ts:84-89`）缺 `tier` / `accountDailyMax` / `fallback`（实现 `guard.js:220-224`、`policy.js:196` 都返回）。
  - `publishFrequencyPolicy` 块（`d.ts:119-129`）**缺** `TIER_LONG/TIER_CLIP/TIER_SHORT`、`TIER_PRESETS`、`PLATFORM_TIER`、`TIER_ENV`、`resolvePolicyOverrides`、`resolveJitterRatio`、`resolveReleaseGraceMs`、`resolveEmergencyMaxPerDay`、`isKnownPlatform`、`parseEnvNumber/parseEnvInterval`、`MAX_INTERVAL_MS`、`DEFAULT_JITTER_RATIO` 等。
  - `PublishIntervalGuard`（`d.ts:97-117`）**缺** `release()`、`jitterRatio`、`releaseGraceMs`、`msUntilNextDay()`、`clearWindow()`、`emergencyRelease()`、`setJitterRatio/setReleaseGraceMs`、静态 `MAX_ROLLBACK_PER_DAY`；且 `recordPublish(...)` 被声明为 **`void`**，而实现返回占位 `hold`，`release()` 又**依赖**它。
  - 构造函数 opts 只声明 `minInterval/policy/store/now`，缺运行期真实使用的 `dailyStore/today/random/jitterRatio/releaseGraceMs/warn`。
- **「类型检查通过但运行时无效」的确切先例**：`d.ts:100` 把自定义 `policy` 的返回类型写成 `PublishFrequencyIntervals`（**不含 `accountDailyMax`**）。因此用 TS 写一个省略 `accountDailyMax` 的 `policy` 能过类型检查，但守卫运行期读 `resolved.accountDailyMax` 得 0 → **日配额静默关闭**。这正是该 d.ts 会放行的假阴性。
- **为什么漂移永远不红**：`apps/desktop/electron/ipc-handlers/publish-frequency.js:1` 是 `// @ts-check`，但 `:21` 用**子路径** `require('@multi-publish/shared-utils/src/publish-frequency-policy')`；而 `package.json` 只在包根给 `"types": "index.d.ts"`（无 `exports`、子路径无 `.d.ts`）→ 该处一律解析为 `any`。同文件 `:28` 走的 `_intervals()` 亦然。
- **修复**：把 `index.d.ts` 补齐到与 `src/index.js` 一致（至少补本 diff 三个新面孔：`TIER_PRESETS`、`PLATFORM_TIER`、静态 `MAX_ROLLBACK_PER_DAY`，并给 `PublishFrequencyIntervals` 加 `tier/accountDailyMax/fallback`、给 `PublishIntervalGuard` 加 `release()` 与 `MAX_ROLLBACK_PER_DAY`）；或给子路径补声明/启用 `exports`。

### W4. PRD 的「回滚许可方向核对」算错了一档
- **位置**：`01-docs/PRD-PUBLISH-FREQUENCY-V3-2026-10-15.md:152`：`long/clip 档在 v2 下本就是 3 与 5 → 不变；short 档由 20 → 5`。
- **对照实现**：`publish-interval-guard.js:476-481` `_rollbackCap = Math.min(Math.max(2, accountDailyMax), MAX_ROLLBACK_PER_DAY=5)`。v2 = `max(2, dailyMax)`；v2 日配额长/中/短 = 3/5/20（PRD 自述）→ v2 上限 **3 / 5 / 20**；v3 全档 = **5 / 5 / 5**。
- **结论**：`clip` 确为 5→5（不变）；但 **`long` 是 3 → 5（放宽）**，PRD 写成「不变」是错的。数字断言不成立，属随附文档与实现不符。
- **修复**：PRD 改为「clip 3…；long 由 3 放宽到 5、short 由 20 收紧到 5」，或在实现里明确 long 是否也应封顶到 3（这是产品判断，需回给用户）。

---

## 三、Info

1. **`release()` 的 JSDoc 未随实现更新**：`publish-interval-guard.js:388` 仍写「③ 防风上限：每账号每日回滚次数 >= `max(2, dailyMax)` 时拒绝回滚」，而实现是 `min(max(2,dailyMax), 5)`（`:407` / `:478-481`）。安全阈值文档停留在旧公式，维护者会误判硬顶不存在。→ 改成 `min(max(2, dailyMax), MAX_ROLLBACK_PER_DAY)`。
2. **PRD 把静态快照说成「倒计时」**：`PRD:209` 称面板为「倒计时上限变小」，但 `remainingWait` 只在事件时写入、之后**不递减**（`stores/publishProgress.js` 仅在事件里赋值），面板显示的是**一次性快照**，没有倒计时。措辞与实现不符。
3. **PRD 数值笔误**：`PRD:209` 括号内「长文最长 **7′→约 7′** 含抖动，v2 是 28′」——v2 是 28′、v3 是 7′，「7′→约 7′」把收窄写成没变，读不出方向。
4. **模块头 doc 的版本号过期**：`ipc-handlers/publish-frequency.js` 头注释仍写 `publish-frequency-policy-v2`；`packages/shared-utils/src/task-queue-frequency.js:2` 同样写 `(publish-frequency-policy-v2)`。
5. **`fmtMin` 在中文界面输出英文单位**：`PublishFrequencySettings.vue:196-198` 写死 `` `${n} min` ``，于是「当前档位」行在中文里出现 `5 min / 3 min / 30`。既有问题，但与 C2 同屏，建议一并处理。
6. **`effectiveRangeText` 完全不看平台档**：`:179-188` 只用 `accountMinMs` 的 min..max。v3 把平台档分成 3′/2′/1′，但这行「实际等待区间」对平台档的变化**无任何体现**——若期望它反映平台节奏，需要改用 `max(account, platform)` 语义。
7. **账户输入有 `:placeholder="未覆盖"`，平台输入没有**（`:38` vs `:42`）——小的一致性瑕疵。
8. **`BASELINE_INTERVALS` 是手抄的独立常量**：`publish-frequency-policy.js:96-106` 注释声明「故意不从 TIER_PRESETS 派生」，但值（5′/3′/30）恰为 long 档副本。注释诚实地说明了理由，但**改 long 档时无人会收到编译/测试提示**；建议加一条测试断言「BASELINE_INTERVALS ≤ 各档逐项」以把「不弱于任何已登记平台」变成可执行约束。
9. **第二处间隔真值**：`full-auto-pipeline` 硬编码 `PUBLISH_INTERVAL_MS = 5000` 绕过守卫（PRD §10.6 已登记）。属已知欠账，非本 diff 遗漏，登记备查。

---

## 四、已检查且无问题的项（逐条）

- 已检查 `dailyMaxLong/Clip/Short` 三个输入（`PublishFrequencySettings.vue:47/51/55`）的 `:min="0"`、`:max="999"`、`:step="1"`：999 ≥ v3 上限 200，量级匹配，无问题。
- 已检查 `PublishProgressTaskRow.vue:43` 的 `Math.max(1, Math.ceil(...))`：**不会**出现「显示 0 分钟」，无问题。
- 已检查 `bootstrap/phase4-events.js:300` 主进程通知文案的 `Math.ceil(remainingWait/60000)`（**无** `max(1,…)`）：间隔档 `remainingMs` 恒 > 0 且抖动系数恒 ≥ 1，故取整结果恒 ≥ 1，**不会**出 0，无问题（真正的失真是 W1 的 1→2 分钟向上取整）。
- 已检查日配额文案 `locales/publish-page/zh.js` 的 `blockedDailyQuota / stageWaiting / statusBlocked`：`used/max` 为运行时插值，**无硬编码旧配额数字**；「明日 00:00 后」与守卫本地日界（+5s）一致，无问题。
- 已全 locale `grep` 旧数值：除 C1 的 `dailyMaxPendingConfirm` 外，未见其它 `3 / 5 / 20`、`20/10/3` 类硬编码残留（命中的 collection/stage-progress 两条与本策略无关）。
- 已检查 `Object.freeze`：`TIER_PRESETS`（含嵌套档对象）、`PLATFORM_TIER`、`PLATFORM_FREQUENCY_POLICY`（含每个条目）、`BASELINE_INTERVALS` 均返回冻结态，下游无法改写，无问题。
- 已检查命名范式：`TIER_PRESETS` 与既有 `TIER_LONG/CLIP/SHORT`、`TIER_ENV` 同族；`PLATFORM_TIER` 对齐 `PLATFORM_FREQUENCY_POLICY`；`MAX_ROLLBACK_PER_DAY` 对齐 `MAX_EMERGENCY_MAX_PER_DAY`/`MAX_INTERVAL_MS`，且同时以静态属性与命名导出两种既有范式暴露；`submitUncertain`/`inflightUnknown` 符合既有 camelCase 任务字段/探针计数命名，无问题。
- 已检查「第二处拷贝」：`MAX_ROLLBACK_PER_DAY` / `TIER_PRESETS` / `PLATFORM_TIER` 全仓仅出现在 policy 模块、guard 模块与其测试中，**无调用方另抄**，符合 PRD §5.2「禁止在调用方另抄」，无问题。
- 已检查 PRD 的数值主张并逐项对齐实现：账号档 5′/3′/1′、平台档 3′/2′/1′、日配额 30/50/200、`platformMinMs ≤ accountMinMs` 逐平台成立（3≤5、2≤3、1≤1）、测试条数 32 / 49 / 10 —— 均与树上一致，无问题。
- 已检查 `resolvePolicyOverrides` 的合并语义（`policy.js:293-301`）：未知字段忽略、整体有效性校验，与 `container.setup.js` 的调用一致，无问题（其「全有或全无」的覆盖语义带来的 UI 可解释性问题已记于 W2/Info-6）。

**未复跑测试套件**：以上「32/49/10」仅为 `grep -c` 的条数核对，PRD §11 宣称的 `1021 passed / 10 skipped` 未验证。

---

### 一句话总结
本 diff 的后端数值与 fail-closed 设计是自洽的；**问题集中在前端未同步**：一个写死旧默认值的提示（C1，同屏矛盾）和一条把档位名渲染成 `undefined` 的显示路径（C2，被测试替身掩盖），外加进度面板取整失真（W1）、平台档提示的假保证（W2）、`index.d.ts` 全量漂移（W3）与 PRD 回滚方向上的一处算错（W4）。

需要我把 C1/C2 的具体补丁写成可执行的改动清单吗？（那需要切换到实施 agent）


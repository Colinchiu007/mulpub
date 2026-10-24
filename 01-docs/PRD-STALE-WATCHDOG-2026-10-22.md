# PRD：发布进度的「无更新」可见化与可退出（ux-audit-stale-watchdog，2026-10-22）

关联：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 1.8 / audit-15；
规格：`openspec/changes/ux-audit-stale-watchdog/specs/desktop-ui-consistency/spec.md`；
执行记录：`openspec/records/ux-audit-stale-watchdog.md`；
反证：`scripts/stale-watchdog-contract-mutate.js`。

## 1. 问题（现场取证，非推演）

`src/stores/publishProgress.js` 在四处写 `task.lastEventAt = Date.now()`
（`:104` 初值、`:166` 终态吸收分支、`:173` 正常事件、`:213` 批量兜底），
**全仓零读取** —— 当场 `git grep -na lastEventAt apps/desktop/src apps/desktop/electron` 复核，
除 store 自身与测试夹具里的构造数据外没有任何消费方。

同时 `PublishProgressPanel.vue` 的关闭按钮是：

```html
:disabled="store.hasRunning"
:title="store.hasRunning ? t('…closeDisabledHint') : t('…close')"
```

而 `hasRunning` 是 `sessions.value.some((s) => s.status === 'running')`，
`status` 只能被 `TERMINAL_PHASES` 事件解除（`_recomputeSessionStatus`）。

两条合起来的用户后果：RPA 窗口挂死、主进程任务被杀而没发出终态事件时——

1. 头部徽标一直转圈显示「进行中」，用户无法区分「慢」与「卡」；
2. 底部「发布后台进行中，请勿关闭应用」常驻；
3. **关闭按钮永久灰**，用户唯一能点的是「取消全部」，而取消走的也是同一条可能已挂死的链路；
4. 只能重启应用排障。

这与本仓多处 learnings 记录的「用重启排障」是同一形态：不是功能坏了，是**没有退出通道**。

## 2. 目标 / 非目标

目标：让已经写好的 `lastEventAt` 有读者，把"卡住"变成**可见**且**可退出**的中性状态。

非目标（刻意不做，理由见 §7）：不做自动取消、不自动判失败、不改进度汇总口径、
不动 22 个未接 `useBatchPollGuard` 的轮询点。

## 3. 数据校验与不变量

| # | 不变量 | 为什么是这条而不是别的 |
| --- | --- | --- |
| I1 | 陈旧判定是**只读派生**：不改 `phase`、不写持久化、不触发取消/重试 | 「没有新事件」不是失败的证据。把它映射成 `failed` 会让一次 IPC 投递抖动变成用户可见红态，并污染发布历史；本仓对状态改写的既有口径是「只被正/负证据改写」（登录态那条同源） |
| I2 | 阈值 `STALL_AFTER_MS = 180000`（3 分钟）取**单一实现**，判据与文案共用 | 反证 S1 证明：阈值改成 `Infinity` 时必须有红。组件里再算一份时间差就是把同一个决策抄成两份真源 |
| I3 | 锚点回落链 `lastEventAt ?? startedAt ?? session.createdAt` | 非终态任务没有 `lastEventAt` 的唯一来源是"登记了但一个事件都没来"——那**正是**需要看门狗的那一种。若因"没有锚"而永不陈旧，看门狗对最坏情形失灵 |
| I4 | 判定两侧**同域**取 `Date.now()`，不读事件带来的主进程 `timestamp` | 跨时钟域比较是本仓抓过的引信形态（`check-clock-shift-oracle` 一族）；主进程时间戳与渲染端墙钟不同源 |
| I5 | 终态任务（`success/failed/cancelled`）一律不参与陈旧判定 | 否则已完成的历史条目会被贴上「无更新」，读起来像"出事了" |
| I6 | tick **惰性且单实例**：有非终态任务才活着，清空即停 | 常驻 15 s 定时器让每条路由都付它用不到的唤醒成本；重复注册是 `autoUpdater` 那条回归的同型 |
| I7 | 读数**只准**取 `nowTs.value`，不得改成当场 `Date.now()` | `computed` 的缓存只在 `nowTs` 被写时才失效。读一个"缓存外"的时钟看着更准（"永不过期"），实际第一次求值后就冻结 ⇒ 表现为"永远不陈旧"。这一格本轮真实写错过又改回，反证 S6 钉住 |
| I8 | 对外那一面必须是 `reactive(publicApi)`，不得退回普通对象 | 模板里 `stall.hasStalledRunning` **只有**在 reactive 对象上才自动解包 ref。普通对象交出 `ComputedRef` 时模板拿到的是 ref 对象本身 ⇒ 恒为真值，徽标永远显示"无更新"、转圈永远不停，且不报错。反证 S10 钉住 |
| I9 | 派生层落在 `src/stores/publishProgressStall.js`，宿主 store 只提供 `TERMINAL_PHASES` | 两条独立的理由：① `publishProgress.js` 本来 496 行，任何"往 store 里加一层"都会把它推过 `check-debt-budget.js` 的 ≥500 行熔断（本轮现场读数 `FILES_OVER_500: 96 > baseline 95`）；正解是搬出去（先例：同目录 `publishProgressSessionMerge.js`），**不是把基线调大**。② 这一层的唯一目的是让面板重新渲染，定时器归面板所属更正确。终态集合仍由 store 的 `PHASE_ENUM` 派生，模块 `import` 它，不抄第二份 |

| I10 | `blocked` / `captcha` 这类**按设计就不会产生进度事件**的相位不参与陈旧判定，但仍是 live | QM-6 第二轮 i3。给等验证码的人贴「无更新」与本层口径 I1 冲突（那里的静默是预期，不是证据缺失）；而它们仍是「没跑完」，所以必须继续禁着关闭按钮 |
| I11 | 关闭按钮的**两条判据必须同链**：`hasLiveTasks`（存在性）与 `hasStalledRunning`（是否全陈旧）都取任务 `phase` 链，`handleClose` 的可见性条件同样取 `!hasLiveTasks` | QM-6 第二轮 i4。混用 `session.status` 链时，「status=running 而任务全终态」这一错位会得到「按钮可点、点了不收起」——正是本批要消灭的形态换了个入口 |
| I12 | `beginStallClock()` 在没有非终态任务时 MUST NOT 建定时器；新任务到达后由宿主用同一入口叫回 | QM-6 第二轮 i2。自泊只省掉"之后的唤醒"，省不掉"每次启动/每次挂载白起一次 15s 定时器"，而 spec 的「无运行中任务 ⇒ tick MUST 已停止」要求的是后者 |

派生 API（`usePublishProgressStall(store)` 的返回面，按 **store 实例** WeakMap 缓存，唯一实现）：

- `stalledTaskIds: string[]` —— 当前无更新的任务 id 列表（按会话登记顺序）；
- `hasStalledRunning: boolean` —— **存在**非终态任务且**全部**非终态任务都无更新；
- `maxStallMinutes: number` —— 无更新任务里最长的分钟数（向下取整）；
- `taskStallMinutes(taskId): number` —— 单任务分钟数，未陈旧/终态一律返回 0；
- `beginStallClock()` / `endStallClock()` —— 时钟生命周期，由**面板**在挂载/卸载时调用。
  Panel 与 Session 各调一次 `usePublishProgressStall(store)` 拿到的是**同一个** tracker
  （同一份墙钟、同一个定时器）；模块级单例会让定时器跨 store 实例泄漏，故用 WeakMap。

## 4. 显示项（逐项，含色档）

| 位置 | 条件 | 显示 | 不显示 |
| --- | --- | --- | --- |
| 头部徽标 | `hasRunning && !hasStalledRunning` | 转圈图标 + 「进行中」（`sessionRunning`），类 `ppp__badge--running`（主色） | — |
| 头部徽标 | `hasStalledRunning`（文案取 `maxStallMinutes`，因此措辞是「最久 N 分钟」——见 §10 i6） | **不转圈** + 「{N} 分钟无更新」（`stallBadge`），类 `ppp__badge--stalled`（`--color-text-muted` / `--color-bg-inset` 中性档） | 不改 `phase` 语义色；不用 `--color-danger-*` |
| 任务行状态列 | 该任务 `taskStallMinutes > 0` | 原状态词后追加「（{N} 分钟无更新）」（`stallSuffix`） | 未陈旧的行不追加；终态行不追加 |
| 关闭按钮 `title` | `hasLiveTasks && hasStalledRunning` | 「任务已 {N} 分钟无更新，可关闭面板（不会取消任务）」（`closeStalledHint`） | — |
| 关闭按钮 `title` | `hasRunning && !hasStalledRunning` | 既有「发布进行中，可先最小化到后台」（`closeDisabledHint`，语义未改） | — |
| 底部警示条 / 胶囊提示 | 不变 | 本批未改（`hintRunning` 仍由 footer 承载） | — |

文案三条一律走 `t()`，zh/en 成对写入 `src/locales/publish-page/{zh,en}.js`
（`stallBadge` / `stallSuffix` / `closeStalledHint`），渲染端非 locales 文件零新增中文字面量。

## 5. 交互逻辑

1. **关闭按钮的解锁条件**：`hasRunning && !hasStalledRunning`。
   部分陈旧（还有任务在动）⇒ 仍禁用——收起面板会丢掉正在给你的可见性；
   全部无更新 ⇒ 解禁。
2. **关闭 ≠ 取消**：`handleClose()` 只做两件事——`clearFinished()`（既有语义，清已完成会话）
   与在「会话已空 **或** 全部无更新」时置 `panelVisible = false`。
   它不调 `cancelTask`、不动 `sessions`、不改任务态；再点胶囊展开仍是原状态。
3. ⚠️ 第 2 条里「或全部无更新」是本批补的，**不是**顺手加的：原实现只在 `sessions.length === 0`
   时收起，而无更新的会话仍是 `running`、`clearFinished()` 只清 `status==='done'` 的会话，
   于是光把按钮改成可点会得到「按钮能点了、点了没反应」——把本批要修的不可退出
   换了个位置重演一遍。反证 S7 就是打这一格的。
4. **部分陈旧永不解禁 —— 这是裁决，不是随手实现**（QM-6 i9）：只要还有任何一个非终态任务在 3 分钟内产生过事件，关闭按钮就保持禁用。理由：收起面板会遮蔽那个仍在动任务的唯一可见信号，而「有兄弟任务卡住」不构成把它一起藏掉的理由。代价如实写明——若某任务以小于阈值的间隔持续产生事件，陈旧的兄弟任务永远等不到「全部无更新」，用户此刻的出口是最小化到胶囊。把禁用态 title 增强成「2 个任务已无更新，尚有 N 个在动」需要改既有 `closeDisabledHint` 的语义并加参数，属另批，本批不顺手做。
5. **恢复会话（`queue:status` 领养）启动当下不判陈旧**（QM-6 i5 的裁决）：领养路径用 `_createSession` 新建会话，`createdAt` 取的是**本次运行**的墙钟，且该路径从不携带上一轮运行的 `lastEventAt`/`startedAt` ⇒ 首帧 idle≈0，不会「开机即显示 N 分钟无更新」。同时回落链不得因此失灵：这次运行若真的从此一个事件都没来，4 分钟后必须进陈旧集合。两条都有用例。
6. **不自动收敛**：`usePublishProgressAutoCollapse` 的口径未改（它只在全部终态后收敛），
   无更新态不会被"自动收起"偷偷处理掉——用户必须自己决定收起还是看着。

## 6. 验收标准

| # | 判据 | 载体 |
| --- | --- | --- |
| V1 | 无事件满 3 分钟 ⇒ 进陈旧集合、`hasStalledRunning`、分钟数 = 3 | `publishProgress.stale.test.js` |
| V2 | 差 1 毫秒不判（`>=` 那一侧钉住） | 同上（反证 S5） |
| V3 | 迟到任意事件 ⇒ 锚点刷新、陈旧解除、分钟数归零 | 同上 |
| V4 | 陈旧不改 `phase`、不改 `aggregate.failed`（且**先读派生值再断 phase**） | 同上（反证 S2） |
| V5 | 终态任务不参与；混合态不解禁 | 同上（1.5/1.6） |
| V6 | `begin` 后恰好 1 个 tick；有非终态任务不得停；全终态后一个 tick 内自泊；重复 `begin` 不叠加；`end` 交还句柄 | 同上（反证 S3/S4） |
| V7 | 读数不得绕过 `nowTs`（否则缓存冻结） | 同上（反证 S6） |
| V8 | 关闭按钮两半各一条（部分陈旧禁 / 全陈旧解禁）+ title 含分钟数 | `PublishProgressPanel.test.js`（反证 S7） |
| V9 | 解禁后点关闭 ⇒ `panelVisible === false` 且 `sessions` 未被丢弃、未碰取消/重试 | 同上（反证 S8） |
| V10 | 任务行按真实分钟数追加后缀，未陈旧行不追加 | 同上（反证 S9） |
| V11 | 徽标在无更新时停掉转圈且用中性类；`publicApi` 必须是 reactive（否则模板拿到 ComputedRef） | 同上（反证 S10） |
| V12 | 面板挂载 ⇒ 起一个 `STALL_TICK_MS` 定时器；卸载 ⇒ `clearInterval` 同一句柄 | `PublishProgressPanel.test.js`（spy `setInterval`/`clearInterval`，句柄取 `mock.results[i].value`） |
| V13 | 同一 store 实例两次 `usePublishProgressStall` 返回同一对象；取用本身不起定时器 | `publishProgress.stale.test.js` |
| V14 | locales zh/en 成对；`src/` 非 locales 零新增中文字面量 | Gate 7 / CJK 基线扫描（实测 1124 < 基线 1330） |

面板测试**不再摆派生存根**：`storeStateRaw` 里没有 `hasStalledRunning` / `taskStallMinutes`
这类键，输入只有 `sessions[].tasks[].lastEventAt`，面板看到的一切由真 tracker 算出来。
被 mock 的 store 模块用 `vi.importActual` 把真 `TERMINAL_PHASES` 带出来 —— 终态口径若在夹具里
另抄一份，集合漂移时面板测试会照样绿（AGENTS「契约夹具不得替对方剥壳」的同型）。

7. **头部徽标只认两种状态**（QM-6 第二轮 i8 的裁决）：`hasStalledRunning` 为真才切中性档；
   混合态（部分卡住 + 部分在动）头部继续转圈，卡住的那条由行级后缀单独说话。
   刻意不做第三种「部分任务无更新」的头部文案：头部只回答「这批还有东西在动吗」，
   引入第三态会让人误以为整批都停了。由面板用例钉住该语义。

## 7. 明确不做（写明，不静默吞掉）

1. **无更新 ⇒ 自动取消 / 自动判失败**：需要主进程侧的任务存活判据（谁在跑、卡在哪个环节），
   渲染层单方面判定会造成"用户以为失败了但其实平台已发布"的假结论。属另批。
2. **audit-14 的进度口径**（`aggregate.done` 只数终态 ⇒ 单篇 3 分钟里进度条恒定 0%）：
   另一条 M 成本，本批不顺手改，否则「无更新」与「0%」两种信号会被混成一个结论。
3. **22 个未接 `useBatchPollGuard` 的轮询点**：阶段 5.4 死观测字段门禁的前置。
   审计文档写明「5.4 不得早于 1.8」——本批落地后，`lastEventAt` 才第一次有读者，
   那条门禁上线时才不会当场把本字段判红。
4. **阈值不做用户配置**：3 分钟是产品判断，没有配置面就没有第二份真源；
   要改只能改常量，且改前先回答「用户能在 3 分钟内区分慢与卡吗」。

## 8. 本轮落地时抓到的四处自错（按实况记，不删）

1. **`watch` 恒不触发**：最初把 tick 的启停挂在 `watch(() => 有没有非终态任务, …)` 上，
   看起来是最省的做法。实测**一次回调都没执行**——本 store 的会话对象是 push 进 `ref([])`
   后按**原始引用**继续改的（`_createSession` 返回 raw session，`_ensureTask`/事件处理都直接改 raw），
   Vue 的响应式追踪看不见这些写入。症状正是「接了线但不执行」的装饰性门禁，
   而且它不会报错，只会让 §6 的 V6 恒红（我在实现当场看到 `活跃 tick 数 = 0` 才发现）。
   **最终形态不是"换个更巧的 watch"**，而是把启停交给宿主组件显式调
   `beginStallClock()` / `endStallClock()`，并在 tick 内部自泊 ——
   依赖"追踪到那些追踪不到的写入"本身就是错的前提。
2. **`handleClose` 被写出两份**：加新实现时没注意到文件里已有一个同名函数声明，
   而**函数声明后者覆盖前者**——我新写的那份变成死代码。是「解禁了但点了没反应」这一格
   自己的测试把它抓出来的（V9 当场红）。已删旧实现，只留一份。
3. **"读数取当场 `Date.now()`" 这个更聪明的写法把两条用例钉成永久不陈旧**：
   我先觉得 `computed` 里读缓存的 `nowTs` 会留下过期时钟，于是改成
   `Math.max(nowTs.value, Date.now())`。结果 `advanceTimersByTime(3*MIN)` 之后
   `stalledTaskIds` 仍是 `[]` —— `computed` 的缓存**只被响应式写入失效**，
   读一个缓存外的时钟既不会让它重算、也不会让渲染重跑，等于把"永不过期"写成了"永不更新"。
   改回 `nowTs.value` 后由 tick 负责失效，并在 `begin()` 起表时补一次盖章
   （面板"卸载→再挂载"后 `nowTs` 停在上一次 tick，不补会让首帧把「已经 4 分钟没动」读成 0 分钟）。
   这一格由反证 S6 长期钉住，防止下次"顺手优化"重演。
4. **`publicApi` 退回普通对象 ⇒ 模板拿到 `ComputedRef`，恒为真值**：
   测试里表现为 `expected [] to include 't-1'` 之外更糟的形态——`Boolean(ComputedRef)` 是
   `true`，于是"无更新"徽标永亮、转圈永不停、关闭按钮永久解禁，且不抛错。
   解包只发生在 reactive 对象上。由反证 S10 钉住（退回普通对象时 10 条红，含 2 条指名）。

## 10. QM-6 第一轮外部评审逐条处置（批判产物 10 条）

| # | 严重度 | 裁决 | 处置与证据 |
| --- | --- | --- | --- |
| i1 | Critical | 采纳并修 | `taskStallMinutes` 把「这个会话没有这个 taskId」误当「这个任务不陈旧」直接 `return 0`。本 store 支持多会话（`MAX_SESSIONS=5`），落在第 2+ 会话的任务永远读出 0 分钟。改为 `continue` 逐会话找，命中且终态才 `return 0`；新增两条用例（双会话必须各出自己的分钟数 / 未知 id 与终态都返回 0），并由反证 **S11** 把 `continue` 退回 `return 0` —— 只有那条多会话用例变红。原 9 条 store 级用例**全部只用一个会话**，这条路径零覆盖，属"测试把缺陷钉成契约"的前置形态。 |
| i2 | Warning | 采纳并补锁 | 「新事件即解除」此前只在 store 级 computed 上被证明。补一条真 tracker + 真挂载的面板用例：徽标先亮 → 喂新事件 → 断言不再出现「分钟无更新」字样、类回到 `ppp__badge--running`、转圈回来。写这条时先按「徽标元素消失」断言，当场红 —— 徽标是同一元素换类换文案，不是 `v-if` 拆掉。 |
| i3 | Warning | 采纳（缩到可证的那格） | 关闭按钮同时读两条派生链（`hasRunning` 由 `session.status`、`hasStalledRunning` 由任务 `phase`），这条不变量原先无证据。新增用例把两侧同时钉住：刚登记（还没有事件）⇒ `hasRunning` 真；陈旧 ⇒ 两链都真；全终态 ⇒ 两链都假。评审推测的 `queued/paused` 使 `status !== running` 那一具体形态**在实现里没找到**（`init` 领养写的是 `phase`，`status` 一律由 `_recomputeSessionStatus` 产出），故不按其建议扩成状态矩阵，只锁这条同缘不变量 —— 拒绝一半也要写明拒绝的那一半缺什么证据。 |
| i4 | Warning | 采纳并修 | 命中「断言没测它声称的那一侧」：`advanceTimersByTime(3*MIN - 1)` 后最后一格 tick 落在 165000，实际比较 165000 vs 180000，从未触碰 179999。改为推进到 179999 后用**公共出口**（`endStallClock` + `beginStallClock`，后者起表时重新盖章 `nowTs`）精确钉一次断言不陈旧，再推 1ms 钉第二次断言进集合。不开测试专用通道。 |
| i5 | Warning | 前提驳回 + 补锁 | 「adopted 会话带上一轮运行的墙钟 ⇒ 开机即陈旧」不成立：领养走 `_createSession`，`createdAt` 是本次运行的 `Date.now()`，且该路径从不写 `lastEventAt`/`startedAt`。但这条提问暴露了真实缺口（原先零测试），所以处置是驳回前提**并**补一条锁：恢复会话启动当下不陈旧、4 分钟后必须进陈旧集合。 |
| i6 | Info | 本批不做，写明量级 | 三次全扫合并成一份 `taskId → stallMinutes` 的 map computed 结构上更好，但会改掉 `taskStallMinutes` 的读法并牵动两个模板与三条反证锚点，属另一条 M 成本。现状上界如实写：会话 ≤5，每会话任务数 = 一次发布的条数；「惰性」省的是无任务时段的常驻唤醒，本批要的是那条。 |
| i7 | Info | 采纳并修 | 三处文档漂移按代码收敛：locale 键 `closeStalledHint`（proposal 原写 `closeWhenStalledHint`）、locales 实际是连字符目录 `src/locales/publish-page/`、timer 作用域由「模块级」更正为「按 store 实例 WeakMap + 面板宿主生命周期」。 |
| i8 | Info | 采纳并修 | 用例间残留的 fake interval 靠「每条用例只看自己的 `liveTimers` 集合」恰好不炸，是隐性泄漏。`afterEach` 现在对 begin 过的 tracker 逐个 `endStallClock()`（必须发生在还原 `globalThis` **之前**，否则 `clearInterval` 已换成真的那个、fake 句柄删不掉），并加一条「用例结束时活跃 tick 为 0」的卫生断言。 |
| i9 | Info | 落成裁决 | 「部分陈旧永不解禁」写进 §5 第 4 条与显示项表，含代价与用户此刻的出口；禁用态 title 带陈旧计数需改既有键语义 + 加参数，属另批。 |
| i10 | Info | 采纳并删 | `isTaskStalled` 全仓零消费方（任务行用 `taskStallMinutes`、徽标用 `hasStalledRunning`、面板用 `maxStallMinutes`），而本批立项理由恰恰是「`lastEventAt` 不能再是死观测字段」。已从 publicApi 摘除并删掉本文档那一行；不保留「为 5.4 预留」的注释 —— 那正是无人认领的死出口。 |

引擎把 i1/i3/i5 标成高危域（`domains: ["auth"]`）要求外部复核。**该标签是启发式误判**：本次改动集内没有 auth/凭证/登录态路径（`git diff --name-only` 全是 `apps/desktop/src/stores|components|locales`、`scripts/` 与文档）。但判据不因"归因错了"而免跑，所以仍按外部评审路径收口（第二轮针对外置后的最终 diff 跑真外部模型）。

## 9. 落点为什么不在 store 里（债务熔断的现场读数）

第一版把这层直接写进 `apps/desktop/src/stores/publishProgress.js`，本机 `pnpm run` 无关，
是 **CI 的 `QG Changes`** 把它抓出来的：`scripts/lib/git-domain.test.js` 子用例 ⑩ 报
`FILES_OVER_500: 96 > baseline 95`，指向 `check-debt-budget.js` 的「≥500 行文件数不增」。
store 本来 496 行，判据是 `lines >= 500` ⇒ **只留 3 行余量**，
两轮抽干（先抽 `taskStallMinutes` 等函数、再抽 computed）后仍停在 500/501。
处置口径按 AGENTS「计数/比例型门禁」条：**搬代码，不动基线**（调大基线 = 把熔断改成装饰）。
最终落点 `publishProgressStall.js`，store 相对 `origin/main` 只多一个 `export` 关键字，
`filesOver500` 回到 95。同目录 `publishProgressSessionMerge.js` 是先例（同一条门禁逼出来的）。

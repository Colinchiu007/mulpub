# PRD：发布频率声明面的收编与删除（publish-frequency-unwired-surfaces）

日期：2026-10-16　依据 change：`openspec/changes/publish-frequency-unwired-surfaces/`
承接：`01-docs/PRD-PUBLISH-FREQUENCY-V4-2026-10-15.md` §8「未接线清单」——那份清单把四条"声明了没人接"
的面如实登记下来，本片是**逐条定夺**，不是再登记一次。

## 1. 一句话

一份登记着的死接口比没有这个接口更危险：它读起来像"能力已存在，只差接线"，下一个会话就会**依赖**它，
或照它的形状再抄一份。所以每条只有三种下场，且必须写清是哪一种：**删掉**、**接上**、**如实改写成"它现在是什么"**。

## 2. 四条面的定夺（含取证，不写"经查"）

| 面 | 实测取证 | 定夺 | 落地后行为 |
|---|---|---|---|
| `task-queue-frequency.js` 的 `clearRollbackDisabled(platform)` | 全仓 `git grep`：定义 1 处、docblock 列举 1 处、**唯一调用点是它自己的测试**；无 IPC handler、无 UI 组件、无设置页项 | **删除**（不接 UI） | 停用某平台"未提交失败回滚"后，唯一出路是重启进程（该集合是实例态）。告警文案改为「重启进程后自动解除（本进程内不可撤销 —— 设置页没有该入口，也不提供手动解除）」 |
| `publish-interval-guard.js` 导出的 `PLATFORM_BUCKET_DAILY_KEY_PREFIX = 'platform-daily'` | 全仓仅 1 处命中＝它自己的导出行；日计数写入点在 `if (accountKey)` 分支内 ⇒ 该前缀从未被产出 | **删除** | 平台桶只有间隔维度（这是事实，不是缺失）。新增锁：导出面不得再出现该常量，且守卫产出的日键只能是 `platform:{accountId|*}` 形态 |
| `store/publish-daily-store.js` 的 `prunePublishDailyCount(todayKey, owner)` | 实现完整（保留窗口 `RETAIN_DAYS = 7`）+ 一处测试调用；**无生产调用点** ⇒ `publish_daily_count` 只增不减 | **接上**（启动期维护） | `phase1-context.js` 在上下文构建时调用一次 `prunePublishDailyCountAllOwners(guard.today())`；先例是同文件 signalCollector 的「启动时执行一次 30 天清理（C2 修复：cleanup 需要有生产调用点）」 |
| `task-queue-frequency.js` 的 `getProbeCounts()` | 消费者只有 3 处测试（`inflightUnknown` / `rollbackDisabledPlatforms` / `missingWiring`） | **改写措辞 + 留工单**（不在本片造 UI） | 文档从"待接线"改为"观测面，当前消费者是测试"。给它做设置页展示属 v2 tasks 3.4 未完成的半片，要文案表 + i18n 成对 + 视觉面，是功能开发 |

`full-auto-pipeline` 的 5s 直发旁路与"设置页全局单值覆盖抹平分档"两条**本片不动**，仍留在 v4 PRD §8。

## 3. 顺带修掉的合法域不对称（QM-6 前端轴 I-1 的落地）

同一个量的合法域此前有**四份**：env 无上界、设置页覆盖 `accountDailyMax` 无上界、
`dailyMax[tier]` 只判 `>= 0`、渲染层输入框硬编码 `:max="999"`（间隔那两处同理硬编码 `:max="10080"`）。

现在：`publish-frequency-policy.js` 新增 `MAX_DAILY_QUOTA = 5000` 单点持有，
`getPolicy` 下发 `dailyMaxUpperBound` 与 `intervalMaxMinutes`，设置页五处 `:max` 绑定下发值。

| 路径 | 越界处理 | 为什么两边不一样 |
|---|---|---|
| 环境变量 | **钳位到上界 + 一条点名上界的 warn** | 沿用 `MAX_INTERVAL_MS` 先例：env 是运维面，写错要"能用但看得见"，静默作废会让服务起不来 |
| 设置页覆盖（全局与分档） | **整体丢弃并回报**，文案含 `[0,5000]` | 覆盖的既有语义是 all-or-nothing（半生效不可解释，v4 评审 i3 同因） |
| 设置页输入框 | `:max` 绑定下发值；载荷缺字段时取 `undefined`（不设上界） | 权威拒绝在主进程 validator；UI 不许回落到一个自造数字——那正是"第二份真值"的起点 |

取值口径：5000 = v4 最大档 500 的 10 倍余量。约束：**上界必须严格大于最大默认值**
（写成"刚好等于"时，下一次上调默认值会撞上界并被静默钳位），且渲染层 MUST NOT 出现该数字的字面量。

## 4. 日键的两条口径（这条最容易做错）

1. **写入侧与裁剪侧同源**：裁剪用的"今天"必须取 `publishIntervalGuard.today()`。
   启动侧重算一次本地日期 = 第二套口径，差一天的表现是"昨天的行今天被删"或"该删的一行没删"，两处都不报错。
2. **形状对 ≠ 日期存在**：`'2026-13-40'` 过得了 `/^\d{4}-\d{2}-\d{2}$/`，但
   `Date.UTC(2026, 12, 40)` 归一化滚到 **2027-02** ⇒ cutoff 落在所有历史行之后 ⇒ **整表被裁光**
   （症状是所有人当天都能重发）。所以 `isValidDayKey` 必须做 round-trip（解析后重新格式化等于输入），
   两个 prune 入口共用这一个谓词。

## 5. owner 隔离：结果同形不等于做法相同

启动维护按 owner **逐个**删（每条 DELETE 都带 `owner_subject = ?`）。为什么还要专门锁语句：
"逐 owner 删"与"一条不带 owner 的 `DELETE WHERE day_key < ?`"在**最终删了哪些行**上可以完全同形，
只断言结果的测试对后者永远绿。判据因此拦在做法层——拦截 `db.prepare()`，断言裁剪期间
每条 DELETE 都带 owner 谓词、首参是非空 owner、每个 owner 各一条（变异 U7 正是改成跨 owner 那一版）。

## 6. 显示项与提示文字（本片全部改动）

| 位置 | 文案/显示 | 变化 | 落点 |
|---|---|---|---|
| 队列告警（`console.error`） | 「已对平台 X 停用『未提交失败回滚』（原因）：宁可多等一个窗口，也不冒早于窗口重复发布的风险。**重启进程后自动解除（本进程内不可撤销 —— 设置页没有该入口，也不提供手动解除）**」 | 去掉假承诺 | `task-queue-frequency.js`；文案被两条锁钉住（含 `重启`、禁 `设置页确认后解除`） |
| 启动日志 | `PublishDailyCount startup-prune owners=N removed=M basis=measured\|invalid_input\|not_ready\|unproven` | 新增 | `phase1-context.js`；`basis` 让"没有行"与"没测到"可区分（不得把没测印成 0） |
| 启动日志 | `startup-prune-skipped`（WARN，带 `hasStore` / `hasGuardToday`） | 新增 | 接不上必须出声，否则将来谁把这条维护摘掉，现场是静默的 |
| 设置页 日配额三输入框 | `:max` 由 999 改为下发的上界 | 改 | `PublishFrequencySettings.vue`；`:max="999"` 在代码行里 0 命中（注释里保留为动因说明，锁只扫代码行） |
| 设置页 账号/平台间隔输入框 | `:max` 由 10080 改为下发的 `intervalMaxMinutes` | 改 | 同上 |

无新增用户可见文案 ⇒ 不涉及 locales 成对（Gate 7 无新增键）；像素门禁对 `:max` 这类属性**结构性失明**，
故判据走组件断言（把夹具界值故意写成与真源不同的 4321/3210，否则"UI 真的用下发值"测不出来）。

## 7. 反证表（U1–U11，驱动 `.ccg/reviews/freq-unwired-mutate.driver.js`，已实跑）

| 变异 | 被禁形态 | 点名的锁 |
|---|---|---|
| U1 | env 日配额解析退回"无上界" | 「env 超上界 ⇒ 钳位」 |
| U2 | 覆盖全局 `accountDailyMax` 上界退回 undefined | 「覆盖两条路径共用同一上界」 |
| U3 | `dailyMax[tier]` 上界条件摘掉 | 同一条用例的另一半（两条各测一个入口） |
| U4 | 把死常量导出加回来 | 「守卫导出里不存在 PLATFORM_BUCKET_DAILY_KEY_PREFIX」 |
| U5 | 把 `clearRollbackDisabled` 加回来 | 【探针 I4】（`typeof … === 'undefined'`） |
| U6 | 告警文案退回「重启或用户在设置页确认后解除」 | 【探针 I4】的文案锁 |
| U7 | DELETE 改成跨 owner | 「每条 DELETE 必须带 owner_subject 谓词」+ 既有"只删本 owner"用例 |
| U8 | 日键校验退回"只看形状"（区间判断与 round-trip 同时摘掉） | 「形状对但日历不存在的日期必须拒绝」 |
| U9 | 启动期裁剪调用摘掉 | 「启动期裁剪日计数表：必须调用一次且日键取自守卫 today()」 |
| U10 | IPC 下发值改成硬编码 999 | 「getPolicy 必须把合法域上界一并下发」 |
| U11 | 组件 `:max` 退回硬编码 999 | 「合法域上界必须来自 IPC 下发：模板里不得留第二份数字」 |

驱动自身修过三处（都写进文件头注释，防下次重犯）：① vitest 全绿时不打印 `N failed`，
解析器把 rc=0 读成 `null` ⇒ 误判 CONTROL_NOT_GREEN；② U7 首版用跨行锚点，工作副本 `w/crlf`
永不命中 ⇒ 报 ANCHOR_NOT_FOUND（不是锁失灵）；③ U8 首版只改 round-trip 一行、区间校验仍挡着
⇒ MISSED 是**变异没取到被禁形态本身**。

## 8. 回退路径

- 上界太紧（运营确实需要 > 5000）：只改 `MAX_DAILY_QUOTA` 一处；UI 与 env 同时跟着动，
  不需要改任何测试（锁的是"下发 == 真源"，不是数字）。
- 启动裁剪误删：`RETAIN_DAYS` 只影响窗口宽度；若怀疑日键口径漂移，看启动日志
  `basis=` 与 `owners=/removed=` 首跑读数（`removed` 异常大 = 日键算错的第一现场）。
- 删掉的接口如需复活：`clearRollbackDisabled` 的复活必须**同时**给出真实入口（IPC + UI + 审计），
  且要先解决"用户凭什么能推翻机械探针"——那是一次独立的产品决策，不是恢复一行代码。

## 9. 未闭合（不假装已闭合）

- `getProbeCounts` 仍无生产消费者（本片只把话说准）。UI 消费属 v2 tasks 3.4 剩余半片。
- `full-auto-pipeline` 5s 直发旁路未收编。
- 设置页账号/平台间隔仍是全局单值覆盖，一填即抹平分档。
- 裁剪只在启动时跑一次：长驻进程跨月不会自动裁剪（`publish_daily_count` 行数量级很小，
  增长上界是"账号数 × 天数"，故本片不加定时器；如实记下这个取舍）。
- `basis='unproven'`（包装层查询失败）这条分支只有单元锁，没有真实 sqlite 故障注入。

## 10. 首轮 CI 红与本片自引入的三处缺陷（归属 / 谁抓到的 / 修法）

本片的主题是「声明了没人接的面必须逐条定夺」。首轮 CI 与复核抓到**三处正是本片自己造出来的同类问题**，
逐条如实登记，不写成"顺手优化"。

| # | 缺陷 | 谁抓到的 | 为什么四层测试没抓到 | 修法 |
|---|---|---|---|---|
| D1 | `notify(..., {level, hasStore, hasGuardToday})` 的诊断值被 **logger 静默丢弃**（只抬 `errorCategory/level/params/error` 四个顶层键），实测落盘 `PublishDailyCount startup-prune-skipped {}` | 复核时直接调**真** `logger.notify` 打印一行 | `__registerMock('../services/logger',{notify: vi.fn()})` 对任何入参形状照单接受 ⇒ 「参数形状错 ⇒ 内容永久不可见」这一类对 mock 结构性免疫 | 读数改挂 `meta.params`；行为锁从"打了这个键"升级为 `hit[2].params` **逐字段相等**；夹具补成与真实存储返回逐字同形（补 `basis`，原先不返 ⇒ 把 `unproven` 兜底当主路径测） |
| D2 | 新增 3 个 notify 键**未登记**进可观测性契约 ⇒ `QG Desktop Shards 1/2`、`QG Coverage`（949 passed / 1 failed）双红 | **CI 本身**（`observability-messagekey.test.js` 是真有两颗牙的门禁：键必须含 `-` 且已登记，末尾断言「登记键总数 === 调用点总数」，**双向**） | 该锁在 `apps/desktop` 全量里，本地定向跑没带上它 ⇒ 消费者并集口径要按「被改模块的测试消费者」取，不是按 diff 里出现的测试文件取 | 三条键登记；同时把成功路径从裸标签 `log.info('PublishDailyCount', \`startup-prune …\`)` 换成 `notify(...,'startup-prune')` —— 原先只是**侥幸**躲过 `LEGACY_RE`（它要求第二参是引号字面量，模板字面量不在射程），属绕过而非合规 |
| D3 | 删了实现没删声明：`index.d.ts` 残留 `static PLATFORM_BUCKET_DAILY_KEY_PREFIX: string;` | 反向差集探针（第一版探针报 `PHANTOM: (none)` 是**假结论**：锚点写成 `declare class …` 而真实形态是 `export class …` ⇒ `indexOf=-1` ⇒ 块为 `null` ⇒ 差集恒空） | 既有声明契约锁只锁「实现 → d.ts」一个方向；且 `ipc-handlers/publish-frequency.js` 走**子路径** require、类型恒 `any` ⇒ TS 检查永远不会问 | 删幽灵行；补两条**反向锁**（守卫 `static` 成员、策略块 depth-2 方法名必须存在于实现面），各带解析规模下界 + 锚点缺失即抛错（不许返回 null） |

### 10.1 新增两把锁的取证

| 判据 | 形态 | 实测 |
|---|---|---|
| 反向声明锁 ×2 | d.ts 声明名 ⇒ 实现面必须存在 | 未变异：`frequency-declaration-contract.test.js` **8 passed**；把幽灵声明加回 `index.d.ts`（在 `$TMP`（系统临时目录）的**隔离副本**里跑，未触碰被评审工作树）⇒ **恰好 1 条变红**，红名即 `反向：d.ts 声明的守卫静态成员…` |
| notify meta 顶层键结构锁 | `phase1-context.js` 里 `notify(...)` 的 meta 字面量顶层键必须 ∈ 白名单 | 算法 A/B（`/`按花括号深度扫描`/`）：合规形态 ⇒ 违例 0；被禁形态（D1 的真实写法）⇒ 违例 1 且点名 `hasGuardToday`。规模下界：调用点数 3 > 0 |

两处**如实记录的判据局限**，不得含糊：① 结构锁只认 `key:` 形态，**简写属性**（`{ level, hasStore }`）在 depth 0 上是裸标识符，判据看不见 ⇒ 那种形态要靠行为锁兜；② 反向声明锁的解析器对"策略块里缩进两格的方法名"敏感，若 `index.d.ts` 整体改排版（例如 4 格缩进），解析数会退化 ⇒ 用 `names.length >= 5/6` 的下界当场变红，而不是静默合规。

### 10.2 本机读数与 CI 结论相反的一例（不改文档、不改账本）

`check-doc-abs-paths.js` 本机 PR 模式报 `learnings.md 35 > 基线 34`、`PRD-V4 L4 1 > 基线 0`。取证：① 本 PR 在 learnings.md 的新增行里绝对路径 **0 条**，+1 来自当天退役 worktree 后磁盘状态变化；② CI 的 `QG Changes` 现场（run 38861838047 / job 116845649734 / step Gate 12c）打印 `本机无盘符 ⇒ 逐文件计数比较未执行（仅核对陈旧登记与账本放宽）；无从判定 1093 条`。**结论**：逐文件计数在 runner 上不参与判定，故不改写历史路径、不跑 `--write-baseline`（那正是该门禁要拦的"用自己的红喂账本"形状）。workflow 自己的注释同向：「全量扫描会命中 100+ 处历史引用（已删除的临时 worktree、CI runner 路径等），那些不是缺陷，逐条修好等于篡改历史」。

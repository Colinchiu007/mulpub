# PRD：发布频率策略 v4（publish-frequency-policy-v4）

- 日期：2026-10-15
- 分支：`publish-frequency-v4`（隔离 worktree `D:\Data\projects\mp-worktrees\mp-publish-frequency-v4`）
- 上游：v1（固定 60/30/10 分钟）→ v2（20/10/3 + 日配额 3/5/20 + 平台档统一 2′）→ v3（5/3/1 + 平台档按级 3/2/1 + 日配额 30/50/200 + D1 + 回滚硬顶）→ **v4**
- 数值唯一落点：`packages/shared-utils/src/publish-frequency-policy.js`

## 1. 这次为什么动

v3 把节奏收紧到"分钟级"后，运营侧的真实约束不在账号间隔，而在两处：

1. **日配额**：长文档 30 条/日在矩阵化运营（同平台多号）下先撞墙，而撞墙后系统只是"排队到明天"，用户体感是"发不出去也不知道为什么"。
2. **平台档分级**：v3 的 3′/2′/1′ 分级在单号场景**永不生效**（账号档恒 ≥ 平台档），只在同平台多号并行时起作用；分级带来的收益无法用本地任何指标验证，却让用户在设置页看到三个不同的数而无从判断该填哪个。

用户口径：**间隔可再缩短；日配额"最低 200、最高给到 500"；平台间隔不必分级但要留着**。

## 2. 数值（v4 的唯一真源）

| 档位 | 覆盖平台 | `accountMinMs` | `platformMinMs` | `accountDailyMax` |
|---|---|---|---|---|
| `long` 长文 | wechat_mp, zhihu, baijiahao, toutiao | **5′** | **1′** | **200** |
| `clip` 短视频/图文社区 | douyin, kuaishou, tencent_video, xiaohongshu, bilibili, youtube, tiktok, instagram, facebook | **3′** | **1′** | **350** |
| `short` 短内容 | weibo, twitter | **1′** | **1′** | **500** |
| 未登记平台回落 `BASELINE_INTERVALS` | 任意未知串（`fallback: true` 并出声） | 5′ | 1′ | 200 |

- v3 → v4 的变化只有两项：`platformMinMs` 三级归一为 **1′**；`accountDailyMax` 30/50/200 → **200/350/500**。账号档间隔一字未动。
- `350` 是按"档间单调"推导的中间值（用户给了 200 下界与 500 上界，未指定中间档）。改它只需改这一处。
- `BASELINE_INTERVALS` **继续是独立常量**，不从 `TIER_PRESETS` 派生。理由：回落必须是"人为想清楚过的最严值"，不能跟着改档静默漂移。

## 3. 为什么"平台间隔"留着而不是删掉（决定与代价）

`platformMinMs` 用键 `platform:*` 记账，与账号档 `platform:accountId` 取**更严**者。因此：

- **同账号**：v4 下 `accountMinMs ≥ platformMinMs` 恒成立（long 5′/clip 3′/short 1′ 都 ≥ 1′）⇒ 平台档不改变结果，除"同 short 档两者相等"。
- **同平台不同账号**：这是平台档**唯一真正起作用**的场景，也是它存在的理由。本应用是单机桌面应用，多号共享同一个出口 IP 与同一份设备指纹；平台侧把"多号同时发"识别为矩阵行为的后果是限流/连坐掉登录，而**这类后果在本地没有任何可观测信号**（没有回调、没有错误码，只有几天后"莫名登不上"）。
- 因此本 PR 明确**不删整条**，并把这条决定做成锁：变异 **N6**＝"三档 `platformMinMs` 归 0"必须让 `v4：平台间隔三档统一 1′`、`15 个支持平台全部登记，且三个维度均为正数` 两条同时变红（已实测 CAUGHT）。

代价如实写：统一 1′ 后，同平台三号并发的最小错开从 v3 的 2–3′ 降到 1′。若日后出现"多号并行被判矩阵"的现场证据，收紧的对象应该是这一档，而不是账号档。

## 4. 生效链（时序）

```
渲染层 定时/立即发布表单
  └─ IPC publish:wechat / publish:batch / queue:add
       └─ TaskQueue.add(task{platform, article.accountId})
            └─ 通道键 (platform, accountId)：同键 FIFO 串行，跨键并行（maxConcurrent 默认 3，MP_QUEUE_MAX_CONCURRENT ∈ [1,10]）
                 └─ 执行前 PublishIntervalGuard.check(platform, accountId)
                      ├─ 账号档桶 platform:accountId → 剩余等待
                      ├─ 平台档桶 platform:*         → 剩余等待
                      ├─ 日配额桶（当日 count vs accountDailyMax）
                      └─ 取更严者：blocked ⇒ 发 publish:blocked{remainingWait, bucket} ⇒ 退避重排（不消耗 retriesLeft）
                 └─ 通过 ⇒ 提交前记账 recordPublish()（间隔 + 日计数同时写）
                      └─ 执行器运行
                           ├─ 成功 ⇒ 记账保留
                           └─ 失败/超时/中止 ⇒ _maybeRollback
                                ├─ 执行器未收敛（inFlightAtFailure）⇒ 置 task.submitUncertain，**不回滚**
                                ├─ 该任务终身已 submitUncertain ⇒ **不回滚**
                                └─ 确证未送出 ⇒ 回滚窗口 + 日计数回补，受 _rollbackCap = min(max(2, dailyMax), 5) 限
```

## 5. 数据校验与覆盖入口（逐项）

| 入口 | 范围 | 非法/越界行为 | 备注 |
|---|---|---|---|
| 设置页 账号间隔 `pubfreq-account-min` | `0 – 10080` 分钟 | 非整数被 el-input-number 拦在 UI | 覆盖**所有平台**（全局单值），填了就把三档抹平 |
| 设置页 平台间隔 `pubfreq-platform-min` | `0 – 10080` 分钟 | 同上 | 同上；填得比账号档大时**同账号也会被拦**（文案已如实说明） |
| 设置页 日配额 三档 `pubfreq-daily-long/clip/short` | `0 – 999` 条 | 同上 | v4 最大 500 ≤ 999 ✓；**代码侧无 999 上界**，env 可超出 UI 上界 |
| `MP_PUBLISH_MIN_INTERVAL_MS` / `MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS` | 毫秒，`0` = 显式关闭该档 | 负数/非数/空白 ⇒ 回落策略表**并出声**；>7 天 ⇒ 钳位并出声 | 兼容 v1 单档语义 |
| `MP_PUBLISH_DAILY_MAX_LONG/CLIP/SHORT` | 整数条，`0` = 关闭该档配额 | 非整数/负数 ⇒ 回落本档**并出声** | 逐档独立 |
| `MP_PUBLISH_ACCOUNT_DAILY_MAX` | 整数条 | 同上 | **优先级最高**，设了即三档同值（会抹平分档） |
| `MP_PUBLISH_JITTER_RATIO` | `[0,1)`，默认 0.4 | ≥1/负/非数/空白 ⇒ 回落默认并出声 | 抖动只增不减 |
| `MP_PUBLISH_RELEASE_GRACE_MS` | 默认 60s，下界 10s | 低于下界 ⇒ 钳位并出声 | 防"回滚即零等待"的重试风暴 |
| `MP_PUBLISH_EMERGENCY_MAX_PER_DAY` | 默认 1，上界 10 | 越界钳位并出声 | 紧急放行每日每账号额度 |
| 覆盖合并 | 任一字段非法 ⇒ **整个覆盖对象作废**并出声 | 不做半生效 | `resolvePolicyOverrides` |

`0` 的语义在三处一致：**显式关闭该维度**，不是"回落默认"。这是 v2 就定下的口径，改它必须先改测试。

## 6. 显示项与提示文字（v4 实况）

| 位置 | testid / locale 键 | v4 显示 |
|---|---|---|
| 设置 → 发布频率 → 当前口径 | `pubfreq-current` | 按"生效值签名"分组，每档一行：档位名（`tier`）+ 平台数 + `账号′/平台′/日配额` 三项。v4 下三行平台项都是 `1 min` |
| 实际等待区间 | `effectiveRangeText` | 取各档 `accountMinMs` 的 min..max（**不看平台档**，已知缺口 F-I6，登记不做） |
| 平台间隔提示 | `settings.publishFrequency.platformIntervalHint`（zh:36 / en:34） | v4 改写：「同账号时取「账号档」与本值的较严者：默认各档的账号间隔都**不低于**本值（**短内容档两者相等**），所以通常由账号档决定；但把它填得比账号档还大时，同账号也会被本值拦住。」 |
| 日配额提示 | `dailyMaxPendingConfirm`（zh:42 / en:40） | 指回动态读数，不写死数字（v3 的 C1 修复保持） |
| 发布进度面板 / 主进程通知 | `PublishProgressTaskRow.vue` / `bootstrap/phase4-events.js` | 「还需等待 N 分钟」= `max(1, round(remainingWait/60000))`，两处各自有锁 |
| 紧急放行额度 | `pubfreq-emergency-quota` | 无 IPC 时显示 `—`（v3 既有） |

`fmtMin` 在中文界面输出英文单位（`5 min`）是已知缺口 **F-I5**，本片不做（属独立 UI 片）。

## 7. 交互逻辑要点（不改，但写清以防被误读）

1. **记账在提交之前**：成功、失败、超时都占窗口。"失败就白等"由 `_maybeRollback` 的"确证未送出"分支处理，而不是靠打点声明。
2. **阻塞不是失败**：`publish:blocked` 后任务回 `pending` 并退避重排；退避期间任务在 `getStatus()` 可见（`_delayed` 登记，v3 修的可观测性）且**可取消**。
3. **等待不消耗重试次数**。
4. 频控推迟必须**同步释放通道**（否则"等 1 分钟"会占死同通道，把保护变成雪崩）。

## 8. 未接线清单（v4 复核后仍在）

> **2026-10-16 状态更新**：下面带 ~~删除线~~/「已定夺」标记的四条，由 change
> `publish-frequency-unwired-surfaces` 逐条定夺完毕（两条删除、一条接上、一条改写措辞），
> 逐条取证与落地后行为见 `01-docs/PRD-PUBLISH-FREQUENCY-UNWIRED-2026-10-16.md` §2/§3。
> 保留原文是因为这一节的标题就是"v4 复核后仍在"——它记录的是 v4 时点的事实，不改写历史。

- `full-auto-pipeline.js:51` `PUBLISH_INTERVAL_MS = 5000` + 直发，**绕过队列与守卫**；v3 之后它是全仓唯一快速通道，v4 放松配额后其相对风险更大。
- ~~`clearRollbackDisabled()` 日志承诺"用户在设置页确认后解除"，**无 IPC handler、无 UI 入口**。~~
  ⇒ 已定夺：**接口删除**，文案改为只承诺"重启进程后自动解除"。给它接 UI 等于把"推翻机械探针"的权力
  交给人手，而它换来的好处只是"少等一个窗口"——方向不对称，故不做（UNWIRED PRD §2 决策 1）。
- `getProbeCounts()`（含 `inflightUnknown`）**零消费者**；注释已如实写"进程内、重启归零"。
  ⇒ 已定夺：措辞改为"观测面，当前消费者是测试"，UI 展示另片（属 v2 tasks 3.4 未完成的半片）。
- ~~`PLATFORM_BUCKET_DAILY_KEY_PREFIX`（平台级日配额）全仓**零引用** ⇒ 平台桶只有间隔维度，没有日配额。~~
  ⇒ 已定夺：**常量删除**（从未被任何代码路径产出），并加锁：守卫产出的日键只能是 `platform:{accountId|*}` 形态。
- ~~`store/prunePublishDailyCount` 只有定义 + 一处测试调用，**无生产调用点** ⇒ 日计数不自动回收，跨日靠键自然失效。~~
  ⇒ 已定夺：**接上**——`phase1-context.js` 启动期调用 `prunePublishDailyCountAllOwners(guard.today())`，
  按 owner 逐个删、日键与写入方同源、破坏性日键（`2026-13-40` 那类）被拒绝。
  残留：只在启动时跑一次，长驻进程跨月不自动裁（行数量级为"账号数 × 天数"，故不加定时器）。
- 设置页"平台间隔/账号间隔"是**全局单值**覆盖，一填就抹平 v2–v4 的分档语义（正解是改分档输入，未做）。
- **上界不对称**（QM-6 前端轴 I-1，v2 起既有、非本片引入）：日配额输入框 `:max="999"`，而 env 侧 `MP_PUBLISH_DAILY_MAX_*` **无 999 上界** ⇒ 若运营把 env 配成 5000，策略页回显 5000，但用户一旦触碰该输入框就被 `el-input-number` 钳到 999，等于"看见一个自己改不回去的值"。v4 把最大档位抬到 500 后这一格更贴近但仍未越界。正解是抬高 UI 上界或在回显超界时出声标注"env 覆盖，编辑将被钳位"——属表单校验语义变更，单独一片做（不在数值 PR 里顺手改）。
  ⇒ 已按"单点持有 + 下发"定夺：`MAX_DAILY_QUOTA = 5000` 住策略模块，env 越界钳位并出声、
  设置页覆盖越界整体丢弃、UI 的 `:max` 绑定 `getPolicy` 下发值（渲染层不再持有数字）。
  注意当时给的"正解"里"回显超界时出声标注"那一支**没做**——上界抬到 5000 后该状态已不可达
  （env 侧也被同一上界钳位，回显不可能超过 UI 上界），所以不需要那条提示；这是钳位方案顺带消掉的需求。
- **旁路的相对权重上升**（QM-6 后端轴 W3）：`full-auto-pipeline` 的 5s 直发不经守卫。v3 时它相对"1′ 账号档 + 200 配额"是 2.5× 优势，v4 后（short 档配额 500、平台档 1′）相对优势量级上升。评审给的"单日 17,280 条"上界**不成立**——该流水线的循环都 bounded（`for (i < items.length)`、`maxWaitMs` 有界等待），不是无界自旋，产出量受"给了它多少条内容"限制；但"不经守卫"这一条仍必须在收编那片里解决（接进 `TaskQueue` 或在发布循环内显式 `check()/recordPublish()`），本片只登记不做。

## 9. 反证表（变异必须变红，逐条实跑）

驱动：`.ccg/reviews/freq-v4-mutate.driver.js`（路径由 `__dirname` 推导，仓库内任何人可直接跑）。
判据：`FORCE_COLOR=0` + `NO_COLOR=1` 剥 ANSI、`failedCount` 三值判定（0 / >0 / null＝探针自盲）、
未变异正控必须全绿才继续、每条还原后 `Buffer.equals` 逐字节校验、收尾再对全部被触文件比一次指纹。
最后一跑现场：**PRISTINE 全绿 → 11/11 CAUGHT → `FINAL_RESTORE_MATCH=true`**。

| # | 把实现改成"规则明文禁止的那个形态" | 指名的锁 | 实得红数 |
|---|---|---|---|
| N1 | long 档 `platformMinMs` 退回 3′ | 精确表 / 平台档统一 1′ / `_intervals` 回传 tier 等 | 7 |
| N2 | clip 档 `accountDailyMax` 退回 50 | 精确表 / 日配额数据表 / env 两档覆盖 / 非整数回落 等 | 8 |
| N3 | short 档配额压到与 long 同值 200 | 精确表 / 档间单调 / 日配额数据表 | 4 |
| N4 | 基线配额写成 600（比任何平台都宽） | 回落基线不弱于任何平台 / 日配额数据表 | 3 |
| N5 | 回滚许可退回 `max(2, dailyMax)`（拆硬顶） | v4 三档许可恒等于封顶 / v3 防风上限硬顶 | 2 |
| N6 | 三档 `platformMinMs` 全部归 0（删整条平台桶） | 平台档统一 1′ / 15 平台三维度均为正数 等 | 6 |
| N7 | 拆掉许可地板：`min(dailyMax, 5)` | 仅「回滚许可的地板 2 必须被真实测到」（QM-6 C2 新增锁） | 1 |
| N8 | 摘掉模块加载时的 `checkBaselineStrength()` 调用 | 仅「回落基线强度运行期自检」里的结构断言（QM-6 C1 新增锁） | 1 |
| N9a | 归属错档：`zhihu` 挪进 clip（标签变、档位数值不变） | 仅「平台 → 档位归属逐平台钉住」 | 1 |
| N9b | 派生被局部篡改：`zhihu` 取 clip 预设但 `tier` 仍写 long | 仅「逐平台数值必须等于其档位代表平台的数值」+ 日配额数据表（归属锁保持绿） | 2 |
| N10 | 新增导出忘记在 `index.d.ts` 声明 | 仅「策略模块的每一个公开导出都必须在 d.ts 里声明」 | 1 |

**N9a 与 N9b 是两类不同的错，各由一条锁咬**：归属错档只有归属锁看得见；派生被局部篡改只有
逐平台数值交叉锁看得见（这条是 QM-6 后端轴 W2 采纳后新增的，因为此前 15 个平台里只有 3 个
被精确断言、其余仅进"按档聚合取最后一个"的 `byTier`）。第一版我把两者写成同一条期望，
驱动据此报 MISSED —— **错的是我的期望清单，不是锁**；改正后两条红集互不相同，才算各自有牙。

**这些锁抓不到什么**（写下来，免得下个会话当已覆盖）：N1–N10 全是数值/形状/接线类判据。
它们测不到"某个平台该归哪档"这个产品决定本身（那是 `PLATFORM_TIER` 的语义，只能靠 §2 的表 + 运营确认）；
测不到 `full-auto-pipeline` 这条不经守卫的旁路（§8）；也测不到"配额该给多少"的运营判断。
另外 N8 只证明**加载调用还在源码里**（结构断言），不证明它在真实进程里跑过——
运行期出声要等基线真被写坏时才可见，这一格如实留为边界。

## 10. 回退路径

1. 数值回退：改 `TIER_PRESETS` 一行即可（`platformMinMs` 三处 + `accountDailyMax` 三处），随后按 §9 重跑驱动。
2. 运行期临时覆盖而不发版：`MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS=180000`（把平台档拉回 3′）+ 三个 `MP_PUBLISH_DAILY_MAX_*`。注意全局项 `MP_PUBLISH_ACCOUNT_DAILY_MAX` 一旦设置就**三档同值**，用它回退等于放弃分档。
3. 完全停用频率守卫：清空 DI 注入（`container.setup.js` 的 `publishIntervalGuard`），等价 v1 前行为 —— **不建议**，那会同时去掉 D1 保护。

## 11. 重测 / 收紧触发条件（写死，避免"以后再说"）

- 任一平台出现**同日多号发布后掉登录**的现场工单 ⇒ 收紧 `platformMinMs`（先回 2′/3′），并复核 `full-auto-pipeline` 是否同时命中。
- `publish_daily_count` 出现某档长期贴顶（≥ 上限 90% 且用户未主动加号）⇒ 说明配额不是约束，节奏才是；不要继续抬配额。
- 出现"重试后重复发布"的任一线上证据 ⇒ 立刻回看 D1（`submitUncertain` 命中率 via `getProbeCounts().inflightUnknown`，注意该面**目前零消费者**，要先把读数接出来）。
- 平台官方频次规则若被确证（当前**不声称符合任何官方规则**）⇒ 以官方规则为准重写本表，并在 §1 标注来源。

## 12. 自认弱点

1. 数值仍是**工程默认**，无平台侧证据。
2. 统一 1′ 让"三号矩阵日发 1500 条"成为可能（3×500），这种量级下平台侧关联概率上升，本 PR 的立场是"用可观测的用户工单换吞吐"，而不是"用更保守的值预防一个看不见的事件"。
3. `clip` 档混装短视频与图文社区两类形态，v4 未拆。
4. `maxConcurrent=3` / `timeout=180s` 未随 v4 重标定；窗口期长任务在 1′ 节奏下更容易触发 D1 的"不回滚"分支（表现为同账号下一条至少等到窗口结束）。

## 13. 时钟倒挂守卫（fix-account-interval-ghost-wait，2026-10-16 追加）

### 13.1 判据

`_remaining()` 读到的 store 时间戳若满足 `now − lastTime < 0`（落在未来）⇒ 判定**本机时钟域损坏**
（快进/回拨期间 `recordPublish` 落盘的产物），该时间戳不可作为风控信号。

### 13.2 语义

- **钳位**：命中键的等待固定为 `accountMinMs × (1 + jitterRatio × random)`，即最多一个完整账号档
  （长文档标称 5′、含 0.4 抖动最长 7′）——与 I2「请求已发生就占窗口」保守语义对齐，
  消除「倒挂多久就等多久」的无限阻塞。
- **自愈**：非粘滞。时钟恢复后下一次 check 按 `elapsed ≥ 0` 正常判定，`clockAnomaly` 随之回落。
- **出声**：同键首次命中告警一次（去重防日志风暴），键记入 `guard.futureTimestampKeys`（诊断 getter）。
- **写入闸**：`setPublishTimeline` 拒绝 `timestamp > Date.now() + 60_000` 落盘并告警
  （60s 容差容忍守卫注入时钟与 store 层 `Date.now()` 的毫秒级时差）。

### 13.3 显示项与提示文字

- `check()` 返回值附加 `clockAnomaly: boolean`（契约进 `index.d.ts`）。
- blocked 行在原「等待 N 分钟后重试 + 归因标签」之下，命中时追加
  `（本机时间跳变，已自动缩短等待，无需处理）` /
  `(local clock jump — wait shortened automatically, no action needed)`
  （zh/en 成对键 `blockedClockAnomaly`）；`clockAnomaly` 缺席/为假一律不渲染（沿用「归因缺席不猜档」纪律）。
- **文案纪律（fix-clock-anomaly-copy，2026-10-17）**：用户可见文案里
  ① 不得把成因写成「异常」——那是故障词，会让用户以为要自己去修；
  ② 不得出现内部术语「钳位」；
  ③ **必须显式写「无需处理」**——本情形的正确用户动作就是「什么都不做」。
  三条由 `PublishProgressPanel.test.js` 的 U1 用例逐条断言（含两条 `not.toContain` 反向断言）。
- 主进程告警（**给排障者，不是给用户的动作指令**）：
  `[PublishFrequency] 间隔键 <key> 的时间戳 <ts> 落在未来（当前 <now>），本机时钟疑似快进/回拨；等待已钳位到单个间隔（用户无需操作）。排障：校时仅对「本机时间落后」有效，若该记录是快进期间写入的未来值，需等真实时间越过它或用紧急放行`

### 13.4 处置（按角色分层，fix-clock-anomaly-copy 重写）

**为什么重写**：原处置把「校准系统时间」写成第 ① 条根因处置，但该动作**只对两种成因中的一种有效**，
写成用户步骤会把用户引到一个对自己情形无效的动作上。

| 角色 | 处置 |
| --- | --- |
| **用户** | **无需任何动作**。等待已钳位到 ≤1 个账号档（5′ × 1.4 ≈ 7′ 上限），到点自动放行。界面标签自解释「无需处理」 |
| **排障者** | 先分情形再看动作，见 13.4.1 |

#### 13.4.1 两种成因的判别与对应动作

判据：库里该键的时间戳 `T` 与本机当前时间 `N`（均 ms）。两种成因在守卫里**同形**（都是 `N − T < 0`），必须靠「`T` 是过去的真实时间吗」区分：

| 情形 | 成因 | 校时有效？ | 正解 |
| --- | --- | --- | --- |
| **① 未来戳** | 时钟**快进**期间 `recordPublish` 落盘，`T > 真实时间` | ❌ **无效**（校时后 `N` = 真实时间，仍 `< T`） | 等真实时间越过 `T`，或设置页「紧急放行」（每账号每日 1 次）清窗 |
| **② 本机时间落后** | `T` 本身是过去值，但 `N` 被回拨到 `T` 之前 | ✅ 立刻生效（`N` 跳回真实时间即越过 `T`） | 校时（`设置 → 时间和语言 → 立即同步`），一劳永逸 |

判别方法：`T` 与「已知的真实发布时间」比对。若 `T` 恰好是某个真实发布时刻 ⇒ 情形 ②；若 `T` 比真实发布时刻还靠后（或根本对不上任何真实发布）⇒ 情形 ①。
日志里 `<ts>` 与 `<now>` 的原值即可支撑这个比对（两数之差就是倒挂时长）。

**残留风险（不假装已闭合）**：`clockAnomaly` 只报「发生了倒挂」，不区分 ① / ② —— 守卫没有可信的第三方时间源，
不去猜。区分责任落在排障者，判别方法如上。

### 13.5 登记债务（本修复不做）

`publish_timeline` 中已落盘的未来时间戳**历史行**不做自动回写清理——自动改写时间戳属第二写入口，
且其错误方向是「少等」，正撞防重复发布的保守侧；需独立评审。当前可用紧急放行人工清除。

---

## 14. 回滚窗口的窗口归属判据（fix-release-window-taken-type-mismatch，2026-10-17 追加）

> 现场：一次视频发布，其他平台正常发布或排队 1–2 分钟，**视频号显示「等待 59 分钟后重试（本账号间隔）」**，
> 而该视频号账号短期并未发布过任何内容。
> 结论：**不是**间隔数值问题（视频号 60′ 是 v5 产品决策，§2 已登记），**也不是**时钟倒挂（那是 §13），
> 而是「可确证未送出的失败应当回滚窗口」这件事**从未生效**。

### 14.1 判据（为什么用数值比较）

`release()` 的乐观并发判据原本是 `store.get(key) === hold.at`。两侧类型在生产里不同：

| 侧 | 类型 | 来源 |
| --- | --- | --- |
| `hold.at` | `number` | `recordPublish()` 的 `Date.now()` |
| `store.get(key)` | **`string`** | SQLite `publish_timeline.last_publish_at` 列声明 **TEXT**，读回形如 `"1792241248768.0"` |

严格相等恒为 `false` ⇒ `release()` 永远返回 `window_taken` ⇒ 窗口永不回滚。
现行为**单一判据** `isSameWindow(stored, expected)`：

```
stored 为 null/undefined            → false（没有窗口可回滚）
expected 非有限 number              → false
Number(stored) 非有限（NaN/文本）    → false
Number(stored) === expected         → true（同一窗口）
其余                                 → false
```

**方向恒为收窄**：只接受「同数值的不同表示形态」。理由与 §13 同源——
把「已送出」误判成「未送出」会回滚出**早于窗口的重复发布**（危险侧），
漏判只是多等一个窗口（安全侧）。

### 14.2 数据校验（V1–V7）

| # | 规则 | 落点 | 方向 |
| --- | --- | --- | --- |
| V1 | `hold.at` 必须是有限 number，否则 `prev_missing`（不回滚） | `release()` | fail-closed |
| V2 | 读回值必须能解析成有限 number 且数值等于 `hold.at` 才算「同一窗口」 | `isSameWindow` | fail-closed |
| V3 | 读回为 `null` / `undefined` ⇒ 不相等 | `isSameWindow` | fail-closed |
| V4 | 读回无法解析（`NaN` / 文本）⇒ 不相等，**不得**当成「我的窗口」 | `isSameWindow` | fail-closed |
| V5 | 回滚失败必须 warn（含 `reason`）且 `releaseFailed += 1` | `_maybeRollback` | 出声 |
| V6 | 回滚成功才回补日配额 `count`(−1)；`rollback_count` 只增不减 | `release()` | 不变 |
| V7 | 未来戳写入闸（`timestamp > now + 60s` 拒收）保持 | `setPublishTimeline` | 不变 |

### 14.3 流程（一次失败现在会怎么走）

```
check() 放行 → recordPublish() 占位（乐观记账，不变） → publisher.publish() 失败
  ├─ 可确证未送出（not logged in / Cookie 缺失 / 风控挂起）
  │    → release() ├─ 成功 → publish:released → _delayRequeue(releaseGraceMs≈60s) → 重试
  │                └─ 失败 → warn「未能回滚间隔窗口（reason=…）」→ 占窗口 → 排队等满
  └─ 其它失败（已发出 / 在飞未知） → 占窗口 → 排队等满（保守侧，不变）
```

修复前：视频号一次登录失效 ⇒ 占满 60′ ⇒ 重试按 59′ 排期 ⇒ 每小时白试一次。
修复后：⇒ 回滚 ⇒ 60s 后重试 ⇒ 重试两次仍失败则判 failed（视频号另有自动存草稿兜底）。

### 14.4 显示项与提示文字（不改文案，明确「应该看到什么」）

| 场景 | 用户可见文案 | 备注 |
| --- | --- | --- |
| 回滚成功 | `未提交到平台，已恢复可发布` | `phase='released'`；**修复后这条才会在生产里真正出现** |
| 回滚失败 | 无新文案（沿用 `等待 N 分钟后重试` + `（本账号间隔）`） | 主进程 warn 落日志，属排障者视角 |
| 主进程日志（新增） | `[task-queue] 平台 <p> 的任务 <id> 未能回滚间隔窗口（reason=window_taken）：窗口保持占用，本次重试将等满剩余间隔` | `reason` ∈ `prev_missing` / `window_taken` / `rollback_cap` |

### 14.5 与 §4「生效链」的关系

§4 的时序一字未改；本节只纠正第 ⑤ 步「失败回滚」的**判据实现**，不新增写入口、
不改变记账时机、不改变窗口占用语义（「请求已发生」仍占窗口）。

### 14.6 登记债务（本修复不做）

1. `publish_timeline` 仍是 **TEXT** 列。本次把判据做成类型无关，列类型没动——
   任何「直接读该列并做严格比较」的新代码都会重犯。已由集成锁把「写 number / 读 string」
   这个事实钉住（`publish-interval-guard-store-integration.test.js` G1）。
2. `releaseFailed` 仍无 UI 读数入口（现在有日志，不可自助查）。
3. 历史脏窗口（已被占住且未过期的行）不自动清空，需等自然过期或用紧急放行。


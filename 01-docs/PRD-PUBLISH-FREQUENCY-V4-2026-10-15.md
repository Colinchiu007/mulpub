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

- `full-auto-pipeline.js:51` `PUBLISH_INTERVAL_MS = 5000` + 直发，**绕过队列与守卫**；v3 之后它是全仓唯一快速通道，v4 放松配额后其相对风险更大。
- `clearRollbackDisabled()` 日志承诺"用户在设置页确认后解除"，**无 IPC handler、无 UI 入口**。
- `getProbeCounts()`（含 `inflightUnknown`）**零消费者**；注释已如实写"进程内、重启归零"。
- `PLATFORM_BUCKET_DAILY_KEY_PREFIX`（平台级日配额）全仓**零引用** ⇒ 平台桶只有间隔维度，没有日配额。
- `store/prunePublishDailyCount` 只有定义 + 一处测试调用，**无生产调用点** ⇒ 日计数不自动回收，跨日靠键自然失效。
- 设置页"平台间隔/账号间隔"是**全局单值**覆盖，一填就抹平 v2–v4 的分档语义（正解是改分档输入，未做）。
- **上界不对称**（QM-6 前端轴 I-1，v2 起既有、非本片引入）：日配额输入框 `:max="999"`，而 env 侧 `MP_PUBLISH_DAILY_MAX_*` **无 999 上界** ⇒ 若运营把 env 配成 5000，策略页回显 5000，但用户一旦触碰该输入框就被 `el-input-number` 钳到 999，等于"看见一个自己改不回去的值"。v4 把最大档位抬到 500 后这一格更贴近但仍未越界。正解是抬高 UI 上界或在回显超界时出声标注"env 覆盖，编辑将被钳位"——属表单校验语义变更，单独一片做（不在数值 PR 里顺手改）。
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

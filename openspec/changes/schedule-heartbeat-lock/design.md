# Design: schedule-heartbeat-lock

## 1. 判据的形状：量的是"上一次真的跑过没有"，不是"有没有报错"

```
输入   now(ms) ┐
       workflows: [{file,name,crons:[…]}]   ← 复用 loadWorkflows（本 change 给它加 crons 位）
       runsOf(name) → {ok, runs:[{createdAt,status,conclusion}], error}  ← 注入式采集
判定   每个带 schedule 的作业：
         period = 由 cron 推（daily|weekly|monthly|不可判定）
         last   = 该作业最近一条 status=completed 且 event=schedule 的 run
         阈值   = period + slack(默认 8h，可 env 覆盖)
       新鲜(last 存在且 now-last <= 阈值)      → OK
       迟到(now-last > 阈值)                    → LATE
       从没跑过(采集成功但零条 completed schedule run) → NEVER_RAN
       取不到数(采集抛错/JSON 解析不动/非数组)  → SCANNER_FAULT
退出码 0=全 OK / 1=有 LATE|NEVER_RAN / 2=有 SCANNER_FAULT
```

三档退出码**不得合并**：`1` 是"作业没按时跑"（运维事实），`2` 是"我不知道"（工具事实）。
把 2 并进 1 会让下一次修判据的人以为"那天真的没跑"，这正是本仓定性的"把工具的失明读成结论"。

## 2. cron → 周期：只认三种能确定的形状，其余一律不可判定

| cron 形状（5 位） | 周期 | 说明 |
| --- | --- | --- |
| `m h * * *` | daily 86400s | dom=mon=dow 均 `*` |
| `m h * * d` | weekly 604800s | dom/mon `*`，dow 非 `*` |
| `m h D * *` | monthly 31×86400s | dow `*`，dom 是数字 |
| 其它（mon 非 `*`、 dom 含 `,`/`*/n`、字段数≠5） | **null ⇒ SCANNER_FAULT** | 不猜 |

为什么 monthly 用 31 天而不是 30：阈值宁松不漏报——2 月作业时"周期"实际是 28–31 天，
按 30 算会在 2 月的短周期上假红（漂移 +8h 也不够抵一天的误差）。宁可按最长月算。

多行 `on.schedule:`（一条作业多个 cron）时取**最短周期**：任何一条按时跑过就算有心跳。

## 3. 阈值口径：`period + slack`，slack 默认 8h

出处（§4 命令可重跑）：实测 4 条作业里最大相邻间隔 = 周期 ×1.04，最大"实际落点 − cron 声明小时" = **5.68h**
（GitHub 排队把起跑时刻推后；这不是抖动而是常态）。所以：

- `slack = 8h` 覆盖实测最大漂移 5.68h，余量 2.32h；样本数下界要求 `n ≥ 3`，否则按未证实出声；
- 换算成判据的"安全倍数"：daily 阈值 32h = 1.33×周期，weekly 176h = 1.05×周期（**注意 weekly 的余量只有 4.7%**）
  ⇒ 每周作业对漂移最敏感，这正是把 slack 做成可 env 覆盖（`MP_SCHEDULE_HEARTBEAT_SLACK_HOURS`）的理由；
  非法值（非数字/≤0）回落默认并 `console.warn` 出声，不静默（对齐 publish-frequency-policy / task-queue 的 env 纪律）。
- **不做"×2"**：×2 会把"漏一次日报"的发现时间推到第三天，而实测最大间隔只有 1.04×周期，
  等于拿一个宽松得没有信息量的阈值去换"永不假红"的错觉。真出现连续假红再按实测抬 slack，不预先放宽。

## 4. 出处必须可重跑（不是写进注释的死数）

```
node scripts/check-schedule-heartbeat.js --explain   # 打印每条作业的周期估算与阈值
gh api "repos/Colinchiu007/mulpub/actions/workflows/<file>/runs?event=schedule&per_page=20" \
  --jq '[.workflow_runs[]|select(.status=="completed")|.created_at]'   # 自己算间隔
```

判据本体导出 `HEARTBEAT_PROVENANCE = { maxIntervalRatio: 1.04, maxDriftHours: 5.68, samplesPerWorkflow: {...}, measuredAt: '2026-10-23', slackHours: 8, remeasure: '<上面那条命令>' }`，
并有一条用例断言 `阈值 >= maxIntervalRatio × 最大周期 + 余量`（即"预算必须 ≥ 实测最大值 ×安全系数"），
这样下次有人改 slack 会被问"实测支撑还在吗"。样本数低于下界时该用例仍要求 provenance 明写样本量。

## 5. 与 `schedule-failure-watch` 的复用与互相咬住

- `scripts/check-schedule-failure-watch.js` 的 `loadWorkflows` **加** 一个 `crons: [ '23 3 * * *' ]` 字段
  （现在只有 `hasCron` 布尔）。理由：周期必须从被描述物自己推；本判据再写一份"哪个文件有哪些 cron"的枚举，
  就是上一刀要消灭的那个形状。**只做增量**，`scheduled/hasCron/runList` 语义不变，13 条既有用例照旧必须绿。
- 新作业 `schedule-heartbeat.yml` 自己带 `on.schedule:` ⇒ 必须进 `ci-failure-handler.yml` 名单，
  否则 `Gate 2b13` 当场红。这条不是巧合，是本 change 的接线证据：**心跳锁由覆盖面锁守住**。
- 反向也成立：本 change 的判据把"零样本/取不到数"都判非零，所以覆盖面锁那份名单漂了而心跳作业被误删时，
  心跳自己也会因为"名单里少了它 ⇒ handler 不再报警"以外的路径显形。

## 6. 落点与预算

| 面 | 选择 | 理由 |
| --- | --- | --- |
| 判据在哪跑 | 新建 `.github/workflows/schedule-heartbeat.yml`，`schedule` 每日 + `workflow_dispatch` | 它是"看 cron 有没有兑现"的作业，不能挂在 PR 关键路径上（PR 侧读不到稳定的 schedule 历史，且会把基础设施健康耦合进合并） |
| 不进 required check | 是（非 required） | 与 `clock-shift-oracle` 的接线分档同口径：常驻判据每次 PR 跑"便宜的那半"，完整两趟/全量跑在 schedule 上 |
| runner | `ubuntu-latest` + `gh`（runner 自带） | API 采集走 `gh api`，凭 `GITHUB_TOKEN`（`actions: read`）；不落任何密钥 |
| 测试预算 | 纯函数 + 假时钟 + 注入采集，**零出站** | 本仓 `network-egress-guard` 会拦真实出站；任何"在测试里打 GitHub"的写法当场 `[TEST-NETWORK-BLOCKED]` |
| 超时 | workflow `timeout-minutes: 10`，单作业采集 20s 上限 | 采集挂死必须是"取不到数"档（SCANNER_FAULT），不是静默跳过 |

## 7. 明确不做

- 不引 cron 解析库、不做 `queued` 超时判据、不改 `Gate 2b13` 的不变量语义、不把结果写进热写面台账（见 proposal「不在范围」）。

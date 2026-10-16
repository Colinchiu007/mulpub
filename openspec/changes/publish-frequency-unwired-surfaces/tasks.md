# 任务：发布频率声明面收编与删除

## 1. TDD 先红（每条都在实现前实测过失败）

- [x] 1.1 日配额上界：`MAX_DAILY_QUOTA` 缺失 ⇒ `publish-frequency-policy.test.js` 新增 5 条**实测 5 红 / 36 绿**
      （导出、env 越界钳位+出声、恰好等于上界不钳位、0 仍表关闭、覆盖两条路径共用上界且文案含合法域）
- [x] 1.2 死常量：`publish-interval-guard.test.js` 新增「守卫导出里不存在 PLATFORM_BUCKET_DAILY_KEY_PREFIX」
      ⇒ 实现前**实测 1 红 / 54 绿**；同批新增"日计数只写账号键"的行为锁（该条实现前后都绿，
      它是防"将来产出 platform-daily 键"的护栏，不是本片的红）
- [x] 1.3 `clearRollbackDisabled` 与假承诺：`task-queue-guard-integration.test.js` 的【探针 I4】改写
      ⇒ 实现前**实测 1 红 / 15 绿**；新增"重启语义（新实例恢复可回滚）"与两条文案锁
      （含 `重启`、禁 `设置页确认后解除`）
- [x] 1.4 启动期裁剪：`store-owner-isolation.test.js` 3 条 + `phase1-context.test.js` 3 条
      ⇒ 实现前**实测 4 红 / 34 绿**（含 SQL 形状锁与破坏性日键两条新发明的判据面）
- [x] 1.5 上界下发与 UI 绑定：`ipc-handlers/publish.test.js` 1 条 + `PublishFrequencySettings.test.js` 1 条
      ⇒ 后者实现前红（模板仍含 `:max="999"`），并把夹具的界值故意写成与真源不同的 4321/3210，
      否则"UI 真的用下发值"测不出来

## 2. 实现

- [x] 2.1 `publish-frequency-policy.js`：`MAX_DAILY_QUOTA = 5000` 单点定义，env 钳位、
      覆盖两路径（`accountDailyMax` / `dailyMax[tier]`）拒绝越界；错误文案带出合法域
- [x] 2.2 `publish-interval-guard.js`：删除 `PLATFORM_BUCKET_DAILY_KEY_PREFIX` 导出 + 留一句为什么删
      （压缩到 4 行注释：该文件 499 行、门禁按 `split('\n')` 计到 500 ⇒ 多写一行就 `NEW_OVER_LIMIT`，
      实测被门禁当场拦下一次）
- [x] 2.3 `task-queue-frequency.js`：删除 `clearRollbackDisabled`，告警文案改为只有"重启进程后自动解除"，
      并删掉 docblock 里对该接口的列举
- [x] 2.4 `publish-daily-store.js`：`prunePublishDailyCountAllOwners(todayKey)` 按 owner 逐个删，
      返回 `{owners, removed, basis}`；`isValidDayKey` 做形状 + **日历 round-trip** 双校验，
      两个 prune 入口共用
- [x] 2.5 `bootstrap/phase1-context.js`：启动期调用一次，日键取 `publishIntervalGuard.today()`；
      抛错 → WARN `startup-prune-failed`，接不上 → WARN `startup-prune-skipped`（静默跳过即无痕）
- [x] 2.6 `ipc-handlers/publish-frequency.js`：`getPolicy` 下发 `dailyMaxUpperBound` /
      `intervalMaxMinutes`，值直接引用策略模块常量（不复制数字）
- [x] 2.7 `PublishFrequencySettings.vue`：五处 `:max` 改绑 `bounds.*`；`index.d.ts` 补 `MAX_DAILY_QUOTA`
      声明（枚举式契约锁自动覆盖新导出）

## 3. 反证与验证

- [x] 3.1 变异驱动 `.ccg/reviews/freq-unwired-mutate.driver.js`：**U1–U11 全部 CAUGHT**、
      `FINAL_RESTORE_MATCH=true`、控制对照 7 个测试文件全绿后起跑
      （驱动自身修过两处：① vitest 全绿时不打印 `N failed` ⇒ 解析器曾把 rc=0 读成 `null` 而误判
      CONTROL_NOT_GREEN；② U7 首版用跨行锚点在 `w/crlf` 的工作副本上永不命中，报 ANCHOR_NOT_FOUND；
      U8 首版只改 round-trip 一行、区间校验仍挡着 ⇒ 那是 MISSED 而不是锁失灵——反证必须取被禁形态本身）
- [x] 3.2 `packages/shared-utils` 全量 **51 文件 / 1054 passed / 10 skipped**；
      apps/desktop 消费者并集（含 ipc/bootstrap/store/组件）**11 文件 / 367 passed**
- [x] 3.3 顺手修掉一条既有 flaky：`publish-interval-guard.test.js` 的抖动用例抽 200 次真实
      `Math.random` 却断言上界**严格小于** `base×1.4`，而同文件另一条用例自己承认
      `mk(0.999999) === 70000` ⇒ 该 `<` 从来不是实现的不变量，全量跑里 ≈1%/轮 间歇红。
      改为注入 `random` 的确定性扫描并把两个边界**精确**断言（归属：非本片引入，实测未改动树上
      单跑 55 全绿、重跑全量 1054 全绿，红的那次只在合并全量里出现过一次）
- [x] 3.4 逐文件行数门禁 `.github/scripts/check-max-lines.js` rc=0（超限 97 == 挂账 97）
- [x] 3.5 QM-1 打包（触 `apps/desktop/electron/`，必跑：build:vue + electron-builder --dir +
      asar 产物内容判据 + 启动三层判据）—— 实测 `pnpm run build:dir` rc=0、asar `entries=15015`、
      产物内容判据 6/6 命中（含"死常量导出 0 命中"两条反向判据）、启动 12 秒存活且 **stderr 0 字节**、
      electron/Multi-Publish 进程计数 0→0、默认 `%APPDATA%\Multi-Publish` 前后均不存在
- [x] 3.7 首轮 CI 红归因并修复（`QG Desktop Shards 1/2` + `QG Coverage` 双红，同一根因）：
      ① 3 个新增 notify 键未登记进 `observability-messagekey` 契约；② 诊断值写在 `notify` 的 meta
      顶层被 logger 静默丢弃（实测落盘 `{}`）；③ 成功路径用裸标签 `log.info`，只是侥幸躲过
      `LEGACY_RE`。三条口径与修法见 PRD §10 表；复跑 `shared-utils` 51 文件 / 1056 passed，
      `apps/desktop` 关键 5 文件 / 144 passed，消费者并集 12 文件 / 378 passed
- [x] 3.8 删幽灵声明 + 补**反向**声明锁：`index.d.ts` 里 `static PLATFORM_BUCKET_DAILY_KEY_PREFIX`
      随实现一起删除；`frequency-declaration-contract.test.js` 新增两条"d.ts ⇒ 实现面"差集锁
      （各带解析规模下界）。反证：隔离副本里把幽灵加回 ⇒ 恰好 1 条变红（未变异 8 passed）
- [ ] 3.6 QM-6 双模型外部评审与逐条处置（替代通道，评审原件入库）
      —— **未跑成（保持未勾，不得因"本地测试全绿"而勾掉）**：CC Switch `:15721` 实测 CLOSED；
      `opencode run --agent plan` 宽任务书双轴 65 分钟零产物（已 TaskStop，确认无悬挂子进程）；
      追加窄任务书单轴重试（240s 驱动内硬超时）`stdoutBytes=0 stderrBytes=0`。
      判据与三条通道的现场见执行记录「QM-6」行；合并决定因此交回人工，不以自审替代。

## 4. 文档与收口

- [x] 4.1 PRD v4 §8 未接线清单改写：两条改为"已删除"、一条改为"已接线（启动期）"、
      `getProbeCounts` 改为"观测面，当前消费者是测试"并留工单；§5 数据校验表补日配额合法域一行
      （本片另加 `01-docs/PRD-PUBLISH-FREQUENCY-UNWIRED-2026-10-16.md` §10 自引入缺陷登记）
- [x] 4.2 `openspec/records/publish-frequency-unwired-surfaces.md`（新载体，frontmatter 登记欠账）
- [x] 4.3 CHANGELOG 置顶 + `01-docs/learnings.md`（"结果同形不等于做法相同"与"反证取被禁形态"两节，
      并在首轮 CI 红后追加第 4/5/6 条：mock 替对方接受错形状、可观测性契约的双向总数锁、声明面幽灵）
- [ ] 4.4 PR + CI 全绿 + 自动合并 + 远程同步回填销账；worktree 按 R1–R7 退役
- [x] 4.5 用户追加要求：**现行机制参考文档** `01-docs/ARCH-PUBLISH-FREQUENCY-AND-QUEUE-2026-10-16.md`
      （组件地图 / 数值表 / 合法域 / 守卫判定顺序 / 队列四条纪律 / 回滚资格矩阵 / 紧急放行四道闸 /
      持久化与投影 / 显示项与文案纪律 / 活例外 / 必跑锁表 / 排障手册 / 版本沿革）。
      逐条取自当场读码，纠正两处原要写错的口径（`exhausted` 而非 `quota`；投影只带 `startedAt` 的证据链）

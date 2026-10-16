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
- [ ] 3.5 QM-1 打包（触 `apps/desktop/electron/`，必跑：build:vue + electron-builder --dir +
      asar 产物内容判据 + 启动三层判据）
- [ ] 3.6 QM-6 双模型外部评审与逐条处置（替代通道，评审原件入库）

## 4. 文档与收口

- [ ] 4.1 PRD v4 §8 未接线清单改写：两条改为"已删除"、一条改为"已接线（启动期）"、
      `getProbeCounts` 改为"观测面，当前消费者是测试"并留工单；§5 数据校验表补日配额合法域一行
- [ ] 4.2 `openspec/records/publish-frequency-unwired-surfaces.md`（新载体，frontmatter 登记欠账）
- [ ] 4.3 CHANGELOG 置顶 + `01-docs/learnings.md`（"结果同形不等于做法相同"与"反证取被禁形态"两节）
- [ ] 4.4 PR + CI 全绿 + 自动合并 + 远程同步回填销账；worktree 按 R1–R7 退役

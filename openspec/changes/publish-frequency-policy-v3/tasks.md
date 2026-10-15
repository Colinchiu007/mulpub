# Tasks: publish-frequency-policy-v3

> 顺序 A → B → C：每阶段先在**测试**里红、再实现到绿。详细规格（校验表 / 显示项 / 变异清单）
> 见 `01-docs/PRD-PUBLISH-FREQUENCY-V3-2026-10-15.md`。

## 0. 前置

- [x] 0.1 隔离 worktree（`D:\Data\projects\mp-worktrees\mp-publish-frequency-policy-v3`，非 C 盘）
      + 裸分支 `publish-frequency-policy-v3`，起点 `b7a0b34d1` = 当时 `origin/main`
- [x] 0.2 依赖就绪：`pnpm install --frozen-lockfile` + `ensure-electron.js` +
      `verify-worktree-deps.js`（11 项消费方全部解析到本 worktree）
- [x] 0.3 现状机制全量读取并定位缺陷 D1–D8（含 `publish-interval-guard.js` 三桶、
      `task-queue.js` 通道与 race、`task-queue-frequency.js` 回滚判据、装配点 `container.setup.js`、
      传输层打点 `bootstrap.js:138-146`）

## 1. 阶段 A — 数值（红→绿）

- [x] 1.1 `publish-frequency-policy.test.js` 先红：逐 tier 精确表（5′/3′/30、3′/2′/50、1′/1′/200）、
      平台档分级集合 `{1′,2′,3′}`、档间单调、"日配额恰为 v2 的 10 倍"数据表 —— **实测 10 条红**
- [x] 1.2 `container.setup.test.js` 的装配锁按 v3 精确值改断言（经真实容器取 `publishIntervalGuard`，
      不是 mock 策略）
- [x] 1.3 实现：`TIER_PRESETS` + `PLATFORM_TIER` 派生 `PLATFORM_FREQUENCY_POLICY`；
      `BASELINE_INTERVALS` 独立常量同步下调一档；模块头写 v3 变更与自认弱点
- [x] 1.4 `platformMinMs ≤ accountMinMs` 与"档间单调"两条不变量成立（既有锁 + 新锁）

## 2. 阶段 B — D1 与两处耦合（红→绿）

- [x] 2.1 新回归锁 `tests/task-queue-timeout-keeps-window.test.js` 先红（**实测 8 条红**）：
      4 条 D1 行为锁（窗口保持占用 / 同通道第二条不被放行 / `submitUncertain` + `inflightUnknown`
      / 终身锁）+ 4 条正向对偶 + cancel 不变量 + 退避可观测性
- [x] 2.2 实现 `_executeTask`：`executorPromise` 在 try **之前**构造并携带 `executorSettled`，
      catch 以 `{ inFlightAtFailure: !executorSettled }` 传入判据
- [x] 2.3 实现 `_maybeRollback`：在飞未知 ⇒ 置位、计数、单次 warn、拒绝回滚；已置位者终身拒绝
- [x] 2.4 实现 `_delayRequeue`：登记 `_delayed` 并 `_saveState()`（修观测面丢失）
- [x] 2.5 实现回滚许可封顶：`_rollbackCap = min(max(2, dailyMax), MAX_ROLLBACK_PER_DAY=5)`，
      常量经 `PublishIntervalGuard` 导出；新增守卫锁含"真表读数 > 封顶"的活性前置
- [x] 2.6 探针计数 `inflightUnknown` 进 `_probeCounts` 初值（随 `getProbeCounts()` 展开自动可读）

## 3. 阶段 C — 验证与反证

- [x] 3.1 `packages/shared-utils` 全量：**1021 passed / 10 skipped（49 文件）**
- [x] 3.2 消费者并集全跑（`git grep` 对 4 个被改模块名求并集，得 9 个 desktop 测试文件）：
      **291 passed / 0 failed**
- [x] 3.3 变异反证 M1–M11 **实跑**：11/11 CAUGHT、红集互不相同、还原后逐字节相同
      （驱动首轮因未剥 ANSI 出现"rc=1 而 red=0"的探针失明，已改为 `PROBE_BLIND` 独立档位 +
      未变异正控；M7/M10 的期望写错已按实测纠正并如实记录，见 PRD §11）
- [x] 3.4 QM-1：`build:vue` rc=0 + `electron-builder --win --dir` rc=0；asar 内 v3 特征 12/12 命中、
      v2 残留 0 命中；打包 exe 启动 8s 存活、stderr 0 字节（三层判据第③层），
      且 `%APPDATA%\Multi-Publish` 启动前后均不存在（userData 隔离到系统临时目录）
- [x] 3.5 QM-6 双模型外部评审与逐条处置（替代通道：后端 17 条 / 前端 15 条；**处置表 27 行覆盖双轴 32 条**
      —— 采纳 17 行 / 拒绝 9 行（其中 B3、B5 是"拒绝原主张但采纳其派生锁"）/ 登记不认领 1 行（覆盖 4 条非本 diff 引入的 Info）；
      前端 Info #8 与后端 B7 命中同一处，合并在 B7 行处置。评审原件入库 `.ccg/reviews/freq-v3-review-backend.md` /
      `.ccg/reviews/freq-v3-review-frontend.md`（只留结论段），逐条依据可在那两份里复核，不必采信转述；
      处置引入的修复由变异 M12–M20 反证，M1–M20 全 CAUGHT）
- [ ] 3.6 PR + CI 全绿 + 自动合并 + 远程同步回填与销账

## 4. 文档与规格同步

- [x] 4.1 `01-docs/PRD-PUBLISH-FREQUENCY-V3-2026-10-15.md`（含数据校验表、时序、显示项与提示文字、
      未接线清单、反证表、回退路径、重测触发条件）
- [x] 4.2 `openspec/changes/publish-frequency-policy-v3/`（proposal / design / tasks / 增量规格）
- [x] 4.3 主干规格 `openspec/specs/publish-frequency-control/spec.md`：改掉一句**已被 v2 自身违反**
      的旧陈述（「任务失败、超时或被中止 MUST NOT 回滚该记账」—— v2 的 P0-1 回滚是它的例外，
      但主干从未同步），改写为"失败本身不构成回滚理由 + 唯一例外需确证未送出且不得由获益方声明"，
      并新增两条 Scenario（在飞未知不得回滚 / 确证未送出仍须照常回滚）。
      **刻意不把 v3 全部新增 MUST 写进主干**：v2 的 change 尚未归档（`openspec/changes/publish-frequency-policy-v2`
      仍在），主干规格只 6 条 Requirement 且不含日配额/抖动/回滚许可 —— 在归档前把 v3 条款塞进主干
      会让主干同时缺 v2 与多 v3，比滞后更难读。v3 的新增条款住在本次的增量规格里
- [ ] 4.4 `AGENTS.md` / `01-docs/learnings.md` / `CHANGELOG.md` / `.quality-gates.md` /
      `openspec/records/publish-frequency-policy-v3.md` + ledger 登记

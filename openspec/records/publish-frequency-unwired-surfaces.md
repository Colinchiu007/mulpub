---
record: publish-frequency-unwired-surfaces
task: 发布频率四个「声明了没人接」面逐条定夺（删 2 / 接 1 / 改写措辞 1）+ 日配额合法域单点化 + 修一条破坏性日键校验与一条既有 flaky
date: 2026-10-16
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由后续 docs-only 回填 PR 写 PASS + merge SHA 并删除本三字段
sync_backfill_owner: 下一个会话（按 #3672 的冻结口径：只改本记录这一行 + 删 sync_*，不回写 .quality-gates.md 与 ledger）
---

## 本次执行记录：发布频率声明面定夺（publish-frequency-unwired-surfaces，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🏗️ 运行时代码变更（`packages/shared-utils` + `apps/desktop/electron` + 渲染层）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-publish-frequency-unwired-surfaces`、裸分支 `publish-frequency-unwired-surfaces`，入口 `scripts/start-mp-task.ps1`；判据取产物：`git worktree list` 命中 1 条、`git rev-parse --abbrev-ref HEAD` = 分支名、起点 `HEAD == origin/main`（`c3ef51208`）、`git status --porcelain` 起算 0 行。依赖就绪由 `node scripts/verify-worktree-deps.js` 实测：`消费方解析通过 11 项 … OK`（打包/测试证据前必须跑，AGENTS 明文）。共享根全程 main + clean（仅 2 个他人会话的 untracked 文档，未触碰） |
| 第一性原因（QM-5 ①） | PASS | 不是"数值选错"，也不是"死代码有点脏"，而是**登记本身会变成依赖**：v4 把四条面如实登进 PRD §8 之后，其中两条仍在使用者看不见的地方**承诺不存在的能力**——`clearRollbackDisabled` 的告警写「重启或用户在设置页确认后解除」（实测无 IPC、无 UI、无调用点），而它给的权力是"重新允许一个探针判定接线未证实的平台回滚窗口"，正是 D1 花两代去掉的风险。另两条是「实现正确 + 单测全绿 + 无生产调用点」的装饰性链路（`prunePublishDailyCount` 致日计数表只增不减；`PLATFORM_BUCKET_DAILY_KEY_PREFIX` 从未被任何路径产出）。第三条独立成因：**同一个量的合法域被抄成四份**（env 无上界 / 覆盖全局无上界 / `dailyMax[tier]` 只判 >=0 / UI `:max="999"`），抄写没有任何一处会因另一处改动而变红 |
| 逃逸分析（QM-5 ②） | PASS | ①**单元层**：`prunePublishDailyCount` 有自己的单测且断言准确（含"只删本 owner"），逃逸点是**没有装配锁** —— 全仓没有任何测试断言"生产路径调用过它"，与 v2 那次"日配额逻辑有单测但装配漏注入 dailyStore"同型。②**结果 vs 做法层**：我第一版为"逐 owner 删"写的用例只断言最终删了哪些行 + `owners/removed` 计数，把 SQL 改成跨 owner 一把删**照样绿**（首次调用删光三行，计数仍是 3/3）⇒ 结果同形的做法必须锁语句本身。③**审查层**：`getProbeCounts` 被 PRD 写成"待接线"，读起来像已欠一件事，实际它的作用域就是测试观测面 —— 登记的措辞会把"没有消费者"洗成"即将有消费者"。④**门禁层**：`:max="999"` 在渲染层是字面量，主进程 env 侧没有对应界，两处的任何一侧改动都不会让另一侧变红（`check-renderer-cjs-boundary` 反而**保证**了渲染层不能 import 真源，所以只能靠下发） |
| 修复 + 回归保护（QM-5 ④） | PASS | 删除 `clearRollbackDisabled` 与 `PLATFORM_BUCKET_DAILY_KEY_PREFIX`；告警文案改为「重启进程后自动解除（本进程内不可撤销 —— 设置页没有该入口，也不提供手动解除）」。新增 `prunePublishDailyCountAllOwners(todayKey)`（按 owner 逐个删、返回 `{owners,removed,basis}`）并接进 `phase1-context.js` 启动期，日键取 `publishIntervalGuard.today()`；新增 `isValidDayKey`（形状 + 日历 round-trip）修掉 `'2026-13-40'` 经 `Date.UTC` 滚到 2027-02 ⇒ **整表被裁光**的破坏性输入。`MAX_DAILY_QUOTA = 5000` 单点持有，env 越界钳位+出声、覆盖两路径越界整体丢弃且文案含 `[0,5000]`、`getPolicy` 下发 `dailyMaxUpperBound`/`intervalMaxMinutes`、设置页五处 `:max` 绑下发值。回归锁共 13 条：策略 5 + 守卫 2 + 队列 I4 改写（含重启语义与两条文案锁）+ store 4（含 SQL 形状锁与 basis 三档）+ bootstrap 3（调用一次/抛错留痕/接不上出声）+ IPC 1 + 组件 1（夹具界值故意写成与真源不同的 4321/3210）。规模：`packages/shared-utils` 全量 **51 文件 / 1054 passed / 10 skipped**；apps/desktop 消费者并集 **11 文件 / 367 passed** |
| 防止再次发生（QM-5 ⑤） | PASS | ①增量规格挂在**主干 capability** `publish-frequency-control` 上（不新造带版本号的 capability —— 那正是 v3/v4 条款"只活在 change 目录里"的成因），两条 ADDED 写成可判据合同：「派生表必须有生产调用点的保留窗口维护」+「不得保留没有调用点却承诺了能力的接口」。②MODIFIED「间隔维度与策略单一真源」把"三维度 + 合法域单点 + 渲染层不得持有数字"钉进同一 Requirement，并修正主干那句**已过期**的「按平台返回两档」（v2 起就有第三维）。③变异驱动入库 `.ccg/reviews/freq-unwired-mutate.driver.js`（U1–U11 可复跑，含"反证必须取被禁形态"的两处现场修正）。④`01-docs/learnings.md` 置顶一节：结果同形≠做法相同 / 反证取半个形态＝没取 / 动因注释会把自己写进判据射程。⑤PRD v4 §8 逐条补"已定夺"状态并**保留 v4 时点原文**（那节记的是当时的事实） |
| 行尾与 diff 对账 | PASS | 动手前当场测 `i/lf w/crlf attr/text=auto`（`CHANGELOG.md` / `01-docs/learnings.md` / `tasks.md` / `PublishFrequencySettings.vue` 同源）。置顶插入脚本**不碰既有字节**，新增行跟随该文件已有行尾（`\r\n`），自证：`body_untouched=true`、`CR_delta` 恰等于新增行数（14 / 13）、`loneCR=0`、`NUL=0`；两口径 `numstat` 逐文件相同且都是**纯新增**（`CHANGELOG 14/0`、`learnings 13/0`）。字节账目：CHANGELOG `2585886(blob)+21488(既有 CR)=2607374` 前、`2613059` 后 ⇒ 新块 5671 字节。⚠️ 一次自我误报已纠：脚本按 `readFileSync().length`（UTF-16 字符数）打过"字节数变小 40%"的告警，实为量纲混用 —— 判"编码是否被改写"要拿 **Buffer.length** 与 blob+CR 的算术对账，不是拿字符串长度 |
| 接线棘轮 | PASS | 本片不新增 `*.test.js` 文件（新用例全部落在已被 vitest 按 workspace 收集 / 已被 workflow 点名的既有文件里：`packages/shared-utils/tests/**`、`src/__tests__/**`、`apps/desktop/electron/{services,bootstrap,ipc-handlers}/**`、`src/components/**`），入库的 `.ccg/reviews/freq-unwired-mutate.driver.js` 不是测试文件名形态。实测 `node scripts/check-unwired-tests.js` rc=0。新代码落点 `electron/bootstrap/phase1-context.js` 由 `phase1-context.test.js` 的行为锁覆盖（该文件在 `vitest.config.js` include 白名单内，实测 41 passed） |
| QM-1 打包 / QM-4 视觉 | PASS / N/A | QM-1（触 `apps/desktop/electron/` ⇒ 必跑）：`rm -rf dist-electron` + `pnpm run build:dir` rc=0（两条 `file source doesn't exist`＝`dist/fonts`、`.playwright-browsers`，与既有记录同形态、非本次引入）。**产物内容判据**经 `@electron/asar` 的 `extractFile` 直读，`entries=15015` 过规模下界，**6/6 命中**：策略三处上界引用（定义 + env 钳位 + 覆盖拒绝）、`publish-interval-guard.js` 内 `module.exports.PLATFORM_BUCKET_DAILY_KEY_PREFIX` **0 命中**、`task-queue-frequency.js` 内 `clearRollbackDisabled (platform)` 与「设置页确认后解除」**0 命中**且新文案在场、store 的 `prunePublishDailyCountAllOwners`/`isValidDayKey`/`'unproven'` 在场、IPC 两字段引用 `policyModule.*`（非字面量）、`electron/bootstrap/phase1-context.js` 是**独立文件未被打包成 bundle**（实测产物里就是这个路径，三个判据串直接命中）。启动第③层：打包 exe 12 秒**存活**、**stderr 0 字节**（stdout 22888 字节是应用自身日志，不进判据）、四类红线 0 命中、`electron` 与 `Multi-Publish` 进程计数**前后均 0**（无残留），`%APPDATA%\Multi-Publish` 启动前后均不存在（userData 隔离到 `D:\tmp\qm1-unwired-profile`）。两处判据自纠（都写进判据本体）：①asar 的"不应存在"字面量被我抄进了解释注释 ⇒ 判据按代码形态收窄为 `module.exports.X`；②组件结构锁被 `.vue` 的动因注释撞红 ⇒ 只扫非注释行。QM-4 视觉 N/A：变更集不含 `.css/.less/.scss` 与基线 PNG，`.vue` 只改五处 `:max` 属性绑定（像素门禁对该类属性**双向失明**，故判据走组件断言 + 结构锁） |
| QM-6 CCG 双模型外部评审 | （见下节） | 本机 CC Switch `127.0.0.1:15721` 以 `node:net.connect` 当场实测 **CLOSED**（`Test-NetConnection` 按既有口径不用），`~/.claude/.ccg/config.toml` 未读到 `[routing.*].primary` ⇒ 按既有降级口径走 `opencode run --agent plan` 只读档双轴，评审对象钉本分支实现 diff（见「QM-6 发现处置」）。**通道跑不成时如实登记"未跑成"并交回人工，不以自审冒充双模型** |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin publish-frequency-unwired-surfaces` 返回 0 行证远端分支已删；回填时删除上方三个 `sync_*` 字段。按 #3672 冻结口径：**不回写 `.quality-gates.md`、不动 ledger** |

### QM-6 发现处置

（评审原件：`.ccg/reviews/freq-unwired-review-backend.md` / `-frontend.md`，逐条先在当前树重放取证再处置。）

### 遗留（不假装已闭合）

- `getProbeCounts()` 仍无生产消费者 —— 本片只把话说准（"观测面，当前消费者是测试"）。设置页展示属 v2 tasks 3.4 未完成的半片，另片。
- `full-auto-pipeline` 的 5s 直发旁路仍不经守卫（v4 放松配额后相对权重更大）；设置页账号/平台间隔仍是全局单值覆盖。
- 裁剪只在启动时跑一次：长驻进程跨月不会自动裁。取舍依据是行数量级（账号数 × 天数）与"加定时器就多一处生命周期要管"，如实记下而不是假装已完备。
- `basis='unproven'`（包装层查询失败）只有单元锁，没有真实 sqlite 故障注入 —— `sqlite-wrapper` 的 `all()` 出错时"log.error + 回吐非数组"这一行为是我读源码得到的，未实测。
- 启动期裁剪依赖 `container.get('publishIntervalGuard')` 在 phase1 可解析。生产侧该注册确实存在（`container.setup.js` 的 `container.register("publishIntervalGuard", …)`），但"phase1 时机取它是否会触发副作用"没有独立锁；若将来构造顺序变化，现场表现是 `startup-prune-skipped` WARN（不是静默），这是本片留给排障的唯一钩子。

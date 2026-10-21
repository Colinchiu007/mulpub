---
record: ux-audit-progress-watchdog
task: UX 审计阶段 1.8 —— 把 publishProgress 的 lastEventAt 死观测字段接成「无更新」看门狗，并解禁被卡死的面板关闭入口
date: 2026-10-21
---

## 本次执行记录：发布进度无更新看门狗（ux-audit-progress-watchdog，2026-10-21）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/**`）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-progress-watchdog`、裸分支 `ux-audit-progress-watchdog`（`git rev-parse --abbrev-ref HEAD` 实证，起点 `8da929484` = 当时 origin/main）；依赖 `pnpm install --frozen-lockfile` + `ensure-electron` + `verify-worktree-deps` 全通过 |
| 第一性原因（QM-5 ①） | ✅ | 不是"缺计时器"而是**有一条已写入、无读者的观测**：`publishProgress.js:104` 声明 `lastEventAt`，`:166/:173/:213` 三处写入，而 `git grep lastEventAt origin/main -- apps/desktop/src` 排除该 store 后只剩 4 处测试夹具 ⇒ **生产读者 0**。面板可用性判据 `PublishProgressPanel.vue:36` 只看 `store.hasRunning`，因此"主进程沉默"在界面上没有任何出口 |
| 逃逸分析（QM-5 ②） | ✅ | ①单测层：该字段从来没有行为用例（只有夹具造值）；②断言层：既有面板测试断的是"运行中 ⇒ × 禁用"，这条断言把当时的错误实现**钉成了契约**，所以永不红；③审查层：字段"写成功了、看起来在用"，肉眼读 store 察觉不到没有读者 —— 这正是阶段 5.4「死观测字段」门禁要机械化的形状 |
| 系统性漏洞（QM-5 ③） | ✅ | 测试场景缺失 + 断言反向固化：没有任何一层问过"这个字段被谁读" |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `src/utils/publish-progress-staleness.js`（判据单点，R1–R10）+ `src/composables/usePublishProgressStaleness.js`（组件侧计时器，15s 采样只在有运行任务时存在）+ 面板徽标/× 三态/胶囊提示 + locales zh·en 成对。实跑：`src/utils/publish-progress-staleness.test.js` `Tests 28 passed`、`src/components/PublishProgressPanel.test.js` `Tests 49 passed`（本 PR 新增 17 条）、`src/stores/publishProgress.test.js` 合计三文件 `115 passed` |
| 防止再次发生（QM-5 ⑤） | ✅ | ①「同一份会话数据只改 `lastEventAt` 就能翻转徽标」这条锁把"字段有读者"变成可证伪断言，而不是注释；②阈值单点结构锁：组合式/面板/store 三处**代码行**不得出现 `180000`（注释域排除）；③"不做 env 旋钮"的决定由锁钉住（判据本体代码行不得出现 `process.env`），理由（Vite 把 `process.env` 打成空对象桩、实测 src 下只有被静态替换的 `NODE_ENV` 能成立）写进 PRD §2 与 design D4；④审计 §12 的顺序约束「5.4 不得早于 1.8」由此满足，5.4 上线基线不必为 `lastEventAt` 开后门 |
| 变异反证 | ✅ | `node scripts/publish-staleness-contract-mutate.js` 现 **17 条**，一次干净跑 `[SUMMARY] 共 17 条：CAUGHT=17 其余=0`（rc=0），红集逐条与该变异的语义自洽（M12「陈旧点 × 不收起」只红在"证据不得消失"那条；M17「兜底误写成参与全局 max」红 11 条）。过程中三条**探针自身**的问题被逐条纠正：M4 首版注入产出不可编译源码 ⇒ `PROBE_BLIND`；M3/M4/M5 锚点随 i2 重构漂移 ⇒ `ANCHOR_NOT_FOUND`；**M3 首跑 `MISSED`** 的真因是判别用例遍历被测集合本身（集合缩水=少跑一轮），改成测试侧字面量成员清单 + 闭合断言后红 2 条。驱动护栏也按 i3 改造：注入→跑→还原整段进 try，还原进 `finally`，还原失败 `exit 4`，探针抛错单列一档。还原证据不由驱动自证：驱动外 `grep -c` 独立回读四处被改文件，各命中 1 |
| 夹具前提自证 | ✅ | 定时器类用例先断言 `getTimerCount() === 1` 再断言停表后为 0。本轮实测反例：完成自动收敛的 `setTimeout` 会混进同一张表，使"停表"读数不可归因（表现为 `expected 1 to be less than 1`），故把夹具调成"对自动收敛不合格"（`aggregate.failed>0`）并在注释里写明这是夹具前提 |
| QM-1 打包 | N/A | 未触碰 `apps/desktop/electron/**` 与 `packages/rpa-engine/**`；变更全在渲染层（`src/**`），打包链不受影响 |
| QM-4 视觉 | 未执行（如实记） | 本 PR 改了 `.vue` 与样式（新增徽标 + tooltip），属像素判定域变更。**没有跑 `test:visual:pixel`**：面板只在有真实/伪造发布进度时才渲染，像素基线夹具里没有"进度面板可见"的视图，因此当前像素门禁对本变更结构性失明（审计 §视觉基线域已登记同类）。已用替代证据覆盖：颜色只走既有 token 且浅暗两档对比按 WCAG 公式现算（14.36:1 / 13.79:1）、徽标不可聚焦不动 tabindex 基线、样式块除注释外无十六进制字面量。真机视觉验证留作遗留（§11.6 审计文档同条） |
| 行尾与 diff 对账 | ✅ | 提交前跑 `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径对账（本仓 `PublishProgressPanel.vue` 等既有文件是 `i/lf w/crlf`，新建文件为 LF；见下方读数） |
| 内容门禁 | ✅ | `node scripts/check-doc-abs-paths.js`（新 PRD 与记录不得写本机绝对路径）；`node scripts/check-no-brand-residue.js`；locale 成对（Gate 7 域）—— 均在提交前实测 |
| 静态门禁 | ✅ | CI 同款聚合命令 `pnpm exec eslint electron/ src/ --quiet` rc=0（**刻意不用"只 lint 我改的文件"**：#4197 的解析错误只有聚合跑才暴露） |
| QM-6 CCG 双模型外部评审 | 第一轮已处置，**闭合未达成** | `ccg-review-decider` 判 `DUAL`（893 行 / 9 源文件，产物 `.ccg/reviews/fdaf5daf8….json`）；第一轮 critic=claude 返回 9 条、5 条进裁决，**5 条全部 upheld 并已修**（处置表见 §五，理由见 design D7，反证随之从 14 条扩到 17 条）。**但闭合判据没有达成**：引擎走的是自扮演出口（`adjudicatedBy=self_play`、权重 0.6），且 i3/i4 带 `highRiskDomains`，按规则高危域争议必须外部复核 —— 本行如实记「未闭合」，不改写产物状态、不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，不手写状态词、不再开回填 PR |

## 遗留（不假装已闭合）

1. **主进程侧未取证**：「无事件」不等于「任务已停」。本 PR 的措辞因此只陈述观测事实
   （「已 N 分钟无更新」），不说"发布已中断"。停滞后的真状态探测/自愈属独立变更。
2. **单任务级停滞被全局口径吃掉**（判据 R3 的代价，design D1 有取舍理由）：A 卡 10 分钟而
   B 每 10 秒一动时不徽标。
3. **真机视觉未验证**：只有 jsdom 行为锁 + token 对比计算，没有浏览器现场截图（QM-4 对本面板
   结构性失明，见上表）。
4. **footer 的「请勿关闭应用」刻意不改**：它约束"别退出整个应用"，与"这条发布是否还在出事件"
   是两个命题；下一个会话不要当"漏改"顺手收敛（PRD §3.4）。
5. `scripts/publish-staleness-contract-mutate.js` 目前**只手动跑**，尚未接进 CI（与已有的
   三份 contract-mutate 驱动同批欠账，见任务 #23）。

## learnings

- **「写了但没人读」的字段不会自己报错，它只会让界面永远停在同一个状态**。判据不是"字段存在吗"，
  而是"从它反查消费者"：`git grep <字段> origin/main -- <生产目录> | grep -v '\.test\.js'` 计数为 0
  就是死观测。修它的正确形状不是"补个计时器"，而是**给这条观测接一个出口 + 一条"只改这个变量就能
  翻转渲染"的锁**，否则下一个会话还会写出同样没人读的字段。
- **既有断言可能把当时的错误实现钉成契约**：`运行中 ⇒ × 禁用` 这条用例是"正确"的，直到发现
  "运行中且 3 分钟无事件"这一格本该可点。看到一条把限制条件写成断言的用例，要问"这条限制
  是不是产品契约，还是只是实现现状"。
- **把 `disabled` 翻掉之前先算"点了会怎样"**：`clearFinished()` 不清运行中会话 ⇒ × 会变成
  看得见点不动的死按钮；而"丢弃会话"会让迟到事件变成看不见的孤儿。两个方向都是坏修法，
  正解是换一个语义（收起）并把 tooltip 文案同步换成"收起"，否则图标（×）与动作不符。
- **计数型断言必须自带"现场只有我要测的那一个"的正控**：`getTimerCount()` 是全局的，
  兄弟逻辑（自动收敛）的计时器会把它顶成"看起来没停表"。先断言 ==1 再断言 ==0，
  否则红的是探针而不是被测。
- **结构锁要排除注释域，且"不做什么"的决定也要有锁**：本轮两条锁都被自己的说明注释打红过
  （注释里如实写了 `process.env` 与对比用的十六进制值）。判据只扫代码行；而"故意不加 env 旋钮"
  这种决定如果只写在文档里，下一个会话会当成遗漏补上——所以把它写成一条会红的锁。

## CHANGELOG 条目

- **发布进度面板新增「无更新」看门狗（阶段 1.8）**：任务连续 3 分钟没有任何进度事件时，
  面板标题区显示「已 N 分钟无更新」，最小化胶囊的提示同步替换；此时关闭按钮解禁，
  点击的含义是**收起面板**（先清已完成会话、再收进胶囊），运行中的会话保留、可一键回展开，
  迟到的成功/失败事件仍会落回同一会话。此前 `task.lastEventAt` 已被 store 写入三处却没有任何
  生产代码读取它，导致任务卡住时面板永远显示「进行中」、关闭按钮永远禁用。
  判据单一实现 `src/utils/publish-progress-staleness.js`，采样计时器归组件所有（15 秒），
  store 仍是纯状态。阈值刻意不做环境变量覆盖（渲染层没有可用的 env 通道）。
  文案 zh/en 成对新增 `staleBadge` / `staleCloseHint`。

## 五、QM-6 第一轮评审处置（critic=claude，fingerprint 8704be7834fb91ab）

判定 `DUAL`（893 行 / 9 个源文件）。评审返回 9 条问题、5 条进入裁决，其中 2 条带
`highRiskDomains`（i3→crypto 指驱动写盘、i4→auth 指类型假设）。**逐条对当前 HEAD 重放**后再裁决：

| # | 主张（摘述） | 裁决 | 依据（现场取证，不是"看起来没问题"） | 处置 |
|---|---|---|---|---|
| i1 | running 会话推不出任务锚点（`tasks` 空 / 全终态未移 done）时 `stale` 恒 false，× 仍被永久钉死，与本 PR 目标同形，且遗留清单未列 | **upheld** | 读代码 + 可达性核对：`registerSession` 允许只带 `batchId` 登记 ⇒ 空 `tasks` 的 running 会话**确实可达** | 判据加 R5b「逐会话退回 `createdAt`」；4 条新用例；误形（全局参与 max）由 M17 常驻守住（实测红 11 条） |
| i2 | `TERMINAL_PHASES` 被抄成第二份，注释自称同语义但无机制保证 | **upheld** | 结构对照：阈值有结构锁、终态集合没有 —— 同一个 PR 里对自己警告过的病没防 | 提到中立模块 `src/utils/publish-phases.js`，两侧 import；store 派生式不变；补结构锁 + 判别式行为锁（M3/M16 各红一次） |
| i3 | 反证驱动的「注入→跑→还原」整段在 `try` 之外，异常会把源码留在变异态且 md5 核对不执行 | **upheld** | 读驱动自身：`try/catch` 只包住纯内存的 `mutate()` | 还原移入 `finally`；探针自身抛错单列 `PROBE_BLIND`（与 `MISSED` 分档）；还原失败 `exit 4` |
| i4 | R4 依赖 `session.createdAt` 是数字，diff 内无证据；若非数字则"从未收到事件"这一格退化成无结论 | **upheld** | 生产者核对：`_createSession` 用 `Date.now()`，假设**成立但从未被断言** —— 成立≠有证据 | 补从**真 store** 出发的取证用例（断 `Number.isFinite` + 端到端判陈旧 + 「读者在链路上」），PRD §6b 输入契约表整表落地 |
| i7 | 胶囊的分钟数是否会自己更新没有证据（依赖最小化时组件仍挂载、interval 不销毁） | **upheld** | 该前提我写过但没测；组件根未卸载为真，但"为真"需要一条用例 | 新增假时钟用例：最小化态断 `getTimerCount()===1`、推进 7 分钟后胶囊从「已 3 分钟」走到「已 10 分钟」；同一格由 M9/M10 两条变异守住 |

**为什么没有一条被驳回**：这五条都不是"实现错了"，而是**证据缺失**（i4/i7）、
**射程逃逸**（i1）、**自我违反的单一真源纪律**（i2）、**工具护栏虚标**（i3）。
外部视角在这一批上的价值恰好在这类地方 —— 自审时我把"读代码看到写者用了 `Date.now()`"
当成了证据，而它只是我的记忆。

## 六、反证总数变化

驱动从 14 条扩到 **17 条**（新增 M15 摘掉逐会话兜底、M16 判据自带第二份终态清单、
M17 把兜底误写成全局参与 max）；M3/M4/M5 三条锚点随 i2 的重构改到新位置后重跑，
仍逐条 CAUGHT。三条变异各自的红集见下表（不写下标取名，按驱动自带的 label 汇总）：

```
M15 CAUGHT  摘掉 running 会话兜底          red=5
M16 CAUGHT  判据自带第二份终态清单          red=1（结构锁）
M17 CAUGHT  兜底误写成全局参与 max          red=11（徽标/时间路径/胶囊全线红）
```

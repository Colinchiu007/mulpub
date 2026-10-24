---
record: debt-baseline-increase-lock
task: UX 审计实施方案待办 #11 —— 给 debt-baseline.json 加一条"调大必须留下机器可查证据"的机械锁（点名指标 / 接受漂移 / 点名被推迟的清理 / 上限等于实测）
date: 2026-10-19
---

## 本次执行记录：债务基线调大锁（debt-baseline-increase-lock，2026-10-19）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 新增判据本体 + 测试 + `.github/workflows/quality-gate.yml` 接线 + `.gitignore` negation ⇒ 混合 PR，不走 docs-only 快速通道 ⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-debt-baseline-increase-lock`、裸分支 `debt-baseline-increase-lock`（`scripts/start-mp-task.ps1 -TaskName debt-baseline-increase-lock` 创建，判据取 `git worktree list` + `rev-parse --abbrev-ref HEAD` 实证，不取 rc） |
| 判定 | `classify-docs-only` docs-only=false | 改动集含 `.github/workflows/` 与 `scripts/` 工具脚本本体（**本 PR 不改 `CI_IGNORED_PATHS` 白名单，也不改分支保护规则**） |
| 依赖就绪 | ✅ | `pnpm install --frozen-lockfile` → `node scripts/ensure-electron.js`（v43.7.7 就绪）→ `node scripts/verify-worktree-deps.js` OK（11 项解析、9 个 workspace 全指向本 worktree） |
| 需求来源（不是临场发明） | ✅ | 判据的**要求清单**逐字来自 PR #4012 的执行记录《随本次 re-sync 一起开的跟进项》第 2 条：「正解不是禁掉调大，而是要求调大时点名是哪条真实清理没做」，并点名可抄先例 `check-doc-abs-paths.js` 的 `judgeLedgerDrift`。本实现是那条登记的落地，不是新写的规范 |
| 为什么不禁掉调大 | ✅ 设计判断 | 主干上他人已合并的增长需要如实记账（#4012 的正当性就是这条）。把正当路径焊死的后果不是"没人再调大"，而是逼出 `--no-verify` 或拆单绕过 —— 本仓把它记作"装饰性门禁"的反面教材：**禁令必须配正向对偶**。因此本锁的合规分支（上限=实测 + 记录齐）被专门写成一条必须绿的端到端用例 |
| 第一性原因（QM-5 ①） | ✅ | 不是某次改错，而是**这条判据从未存在**。`check-debt-budget.js --update` 的语义是"重算即接受"，它只回答"当前树是否超过上限"，从不问"上限本身这次被谁、为什么改宽了"。基线数值与实测之间也没有等式约束，所以"改宽一点以防以后红"在机械上完全免费；历史上每次调大只留下一句散文理由，而散文不是判据 —— 下一个会话可以写也可以不写。 |
| 逃逸分析（QM-5 ②） | ✅ | 逐层：① 单元测试层 —— `check-debt-budget.test.js` 15 条测的是"current 大于 baseline 必须红"，其夹具**自己构造 baseline**、根本不读那份受管文件的变化，因此对"仓库里的账本被改宽"结构性免疫；② 门禁层 —— 债务熔断检查按"当前值 vs 上限"判定，上限被抬高只会更绿，永远不会红；③ 审查层 —— AGENTS「门禁断言随实现迁移同步」管断言漂移，而 `judgeLedgerDrift` 那把"账本只能缩小"的锁只服务 `doc-abs-paths` 一本账，两本账不共用判据；④ 流程层 —— `--update` 到 commit 之间没有任何东西要求声明"我调大了哪条"。归类：测试场景缺失 + 审查盲区，不是某条测试写坏。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `scripts/check-debt-baseline-change.test.js` **30 例全绿**：键分类（数值才算上限，字符串/数组是元数据）/ 增减平三态 + 凭空新键按"从 0 调大"fail closed / R1–R3 各自独立负例（每条只拆自己那一维，避免红集不可归因）/ CRLF 记录仍能匹配 / R4 三个方向（多留余量、压不到现实、等于实测）/ R4 无读数按未证实 / R5 换最大值文件绕开上涨 + 两条正当形态不得被拦 / 端到端 10 条（正当 PASS、+1 行即 SLACK、缺漂移声明、缺记录、凭空新指标、未触及基线、只改元数据、base 不可解析=rc2、未知旗标=rc2、`--base=` 空=advisory）/ 三条接线锁（changes 作业点名执行、env 由 classify 产出注入且命令真消费、不得挂到会被 docs-only 短路的 static-gates）/ 一份测量实现锁（必须复用 `collectMetrics`，不得自带 `countFilesByMinLines` 或 `readdirSync`） |
| 防止再次发生（QM-5 ⑤） | ✅ | 三件具体落地：① 判据本体接进 `quality-gate.yml` 的 Gate 2c7（changes 作业，不被 docs-only 短路），退出码三档不混用；② 把"记账"从散文变成等式 —— R4 要求调大后的上限**等于当场实测**，"多留余量"在机械上不可执行，这是本锁与所有纸面声明的唯一区别；③ 反向对偶 —— 同批必须有一条"合规形态必须绿"的用例（上限=实测且记录齐 ⇒ exit 0），否则正当的 re-sync 路径会被新锁焊死，后果是逼出 `--no-verify`。另登记：若将来升级成"净调大必须有净清理对偶"，须先给出主干历史调大记录的净清理占比实测再单开 PR，不得直接改宽本判据。 |
| 变异反证（九道全部 CAUGHT） | ✅ | **MU-A…MU-I 全部 CAUGHT，且红集互不相同**，`RESTORED_OK=true`（驱动脚本以 md5 比对还原）：MU-A 给 R4 留 500 行"保守余量" ⇒ 只红端到端那条"上限只多留 1 行"（**这正是余量豁免的形状**：单测用 641 行余量，两种slack 差 500 都抓不到，只有 e2e 的 +1 能区分 —— 合规/违规两侧只差那 1 的 A/B 对偶在这里显形）；MU-B R1 恒成立 ⇒ 红 R1；MU-C R2 不检查 ⇒ 红 R2 纯函数 + e2e 两条；MU-D R3 不检查 ⇒ 红 R3；MU-E "没有记录 = 没有要求" ⇒ 红 RECORD_MISSING 纯函数 + e2e；MU-F R5 关掉 ⇒ 红 PATH_SWAPPED；MU-G 无读数静默放行 ⇒ 红 MEASURE_UNAVAILABLE 纯函数 + e2e；MU-H 未触及也判定 ⇒ 红 NOT_TOUCHED（把无关 PR 一起拦下）；MU-I 未知旗标被吞 ⇒ 红"未知旗标"用例 |
| 现场读数 | ✅ | `node scripts/check-debt-baseline-change.js --base=origin/main --head=HEAD` ⇒ `NOT_TOUCHED files=0 exit=0`（本 PR 不改基线数值，只加锁；这条读数同时证明"未触及"分支不会被误判成违规） |
| 门禁（CCG / QM-6） | 未执行 | pre-commit 打印 `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁`；本机无可用外部评审通道 ⇒ 如实记未执行，不伪造 PASS。`ccg-review-decider` 亦未产生 `mode=dual` 产物 ⇒ 无深度审查欠账可闭环 |
| 行尾对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐文件一致（workflow 29/0、gitignore 2/0）。workflow 与 .gitignore 工作副本均为**纯 CRLF**（插入前后 `crlf==lf` 双校验，插入驱动在行尾被打乱时直接抛错），blob 侧由 `* text=auto` 归一成 LF |
| QM-2 代码必检项 | ✅ | ① 无新增同步 CPU 阻塞原语（判据只在 CI 里跑，且复用既有 `collectMetrics`）；② 无新增全局组件/顶层 CSS；③ 唯一新增 `require('./check-debt-baseline')` 是同目录仓内模块，changes 作业无 Install deps 的约束由既有 `check-debt-budget.test.js` 在同作业先例证明可满足；④ 未改 preload / IPC；⑤ 无 `v-html`；⑥ 渲染端零改动 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 `.vue`/样式/locale。本 PR 不改运行行为：改的是一个**只在 CI 里执行**的判据与它的接线 |
| 品牌残留 / 受管文档绝对路径 | ✅ | `node scripts/check-no-brand-residue.js` 与 `node scripts/check-doc-abs-paths.js` 都在**持有本内容的这个 worktree** 内跑（不是别的干净 worktree），记录里的 worktree 路径一律写 `<仓库父目录>/mp-worktrees/...` 占位 |
| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导；预写 `PASS` 会被 `prematureClaims` 判红 |

- 保留门禁：docs-only=false 完整节拍 | 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件 | 远程同步 PR #（合并后由门禁推导）

## 判据规格（给下一个会话的维护契约）

**输入**：`--base=<ref>`（默认 `origin/main`，空串=非 PR ⇒ advisory exit 0）、`--head=<ref>`（默认 HEAD）、`--head-branch=<name>`（CI 必须由 `github.event.pull_request.head.ref` 注入；detached HEAD 下自读只会得到字面量 `HEAD`）、`--repo=<根>`、`--git-config-global=<文件>`（测试注入中性 git 档，缺省原样继承宿主配置）、`--json`。

**取证链**：`merge-base(base, head)` → `diff --name-only` → 命中 `scripts/debt-baseline.json` 才继续。`base` 侧基线用 `git cat-file -e` 判存在（**只看 rc，不看 stdout** —— 该命令成功时什么都不打印；rc=1 与 rc=128 分属"该 rev 没有这个路径"与"ref 不可解析"两档，混为一谈会把取证失败读成"首次新建基线"）。

**三条退出码不得混用**：0 合规/未触及/非 PR；1 发现违规；2 判据自身故障（merge-base 取不到、blob 读不到、基线 JSON 解析不了、未知旗标）。

**四条硬要求**：R1 记录点名每个被调大的键；R2 记录含「接受漂移」；R3 记录含「跟进」或「后续」；R4 调大后的上限**必须等于当场实测**（`collectMetrics` 复用同一份实现，禁止第二份数行数逻辑）。R5：`maxFilePath` 变了而 `maxFileLines` 没降 ⇒ 红。

**为什么"实测"取的是当前工作树而不是 head 提交的树**：CI 的 `changes` 作业 checkout 的是 PR 合并提交，`collectMetrics` 量的就是"这个上限将来要守的那棵树"（与 `check-debt-budget.js` 完全同一口径）。如果作者写完基线后 main 又涨了，实测会超过上限 —— 那是 R4 的 `UNDER_REALITY` 分支和 `债务熔断检查` 一起点名，正解是 re-sync 后重推，而不是把上限写成"预测值"。

## 刻意没做的事

- **没有**动 `scripts/debt-baseline.json` 的任何数值。本 PR 只加锁；把账本 re-sync 和加锁混进同一个 PR，会让"锁本身"的 A/B 失去对照组（正当那侧的用例就会由同一个改动造出来）。
- **没有**要求"调大必须与一次真实清理同 PR"（任务 #11 的原标题字面）。理由见上表"为什么不禁掉调大"：#4012 那种"记账不清理"是正当且会反复发生的形态，禁掉它只会制造绕行。R1–R3 负责让这笔账**可见**，R4 负责让它**不能虚高**。若将来要升级成"净调大必须有净清理对偶"，必须先给出 origin/main 上历史调大记录的净清理占比实测，再单开一个 PR。
- **没有**把 `circularDeps` 之类"期望恒为 0"的指标特判成禁调大 —— 它由 `check-debt-budget.js` 的 `check()` 独立守（`current.circularDeps === 0`），两份判据各有分工，不在这里重复。
- **没有**同步 `01-docs/PRD-UX-AUDIT-IMPLEMENT-2026-10-18.md`：该文件目前**只存在于 `ux-audit-impl`（PR #3898）分支**，主干上没有（`git ls-tree -r origin/main -- 01-docs | grep UX-AUDIT` 只有 `UX-AUDIT-2026-10-17.md`）。在别的分支上给它补一行，会造出一份"两条链各写一版"的并行文档。待 #3898 合并后再由后续 PR 在同一份 PRD 里把待办 #11 标成已落地。

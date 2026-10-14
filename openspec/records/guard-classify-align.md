---
record: guard-classify-align
task: 补齐共享根写保护的放行清单，并新增守卫⇄classify 两份白名单的逐项对账锁（含只可缩小的债务清单与 CI 接线）
date: 2026-10-14
# ↓ 下面三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口；合并后由后续回填 PR 在同一次提交内改写 PASS 并删除本三字段与 ledger 登记项
sync_backfill_owner: 下一个会话（按 AGENTS.md「合并后收尾清单」执行）
---

## 本次执行记录：守卫 ⇄ classify 白名单对账（guard-classify-align，2026-10-14）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🔧 工具/门禁变更 + 🐛 缺陷修复形状 ⇒ **混合 PR**（碰 `scripts/guard-shared-root-writes.ps1`、`scripts/` 新增判据与其测试、`.github/workflows/quality-gate.yml`、`.gitignore`）⇒ 不走 docs-only 通道。隔离 worktree `D:/Data/projects/mp-worktrees/mp-guard-classify-align`、裸分支 `guard-classify-align`（`git rev-parse --show-toplevel` + `--abbrev-ref HEAD` 实证），起点 `6b0e083ad` = 当时的 `origin/main`（`ahead=0 / behind=0` 当场量）。依赖就绪：`pnpm install --frozen-lockfile` + `ensure-electron`(v43.7.7) + `verify-worktree-deps` OK。**讽刺之处必须写明**：上一片（#3586）正是因为本条缺陷无法在共享根就地改 `.gitignore` 才改道 worktree，本片修的就是那条缺陷本身。 |
| 第一性原因（QM-5 ①） | PASS | 不是"某个清单忘了加一项"，而是**同一个问题由两份手写清单分别回答、没有任何东西比较过它们**：`classify-docs-only.js:33-53` 的 `CI_IGNORED_PATHS` 决定"什么算 docs-only、可就地编辑"，`guard-shared-root-writes.ps1:76-77` 的 `$allowedTop`/`$allowedRootFiles` 决定"什么允许落盘"。守卫的放行判据只有 gitignore 一条外路（`:167` `if (-not $tracked -and (Test-GitIgnored $relative)) { return }`），所以漂移的症状不是报错而是**静默撤销**。git 溯源：`.adversarial` 的同类洞由 `2b5db77b8`（PR #3272，"共享主目录写保护放行 .adversarial，对齐 classify docs 白名单"）修过一次，**当时补了条目没建对账**，所以本次换个文件复发——第一性原因是"缺比较机制"，缺清单条目只是它的表现。 |
| 逃逸分析（QM-5 ②） | PASS | ①**判据层**：`check-unwired-tests.js` 只管"测试有没有接进 CI"、`check-spec-purpose.js` 只管规格用途，**没有任何判据问过这两份名单是否一致** ⇒ 分类为"门禁缺失"。②**既有锁的覆盖面**：`scripts/session-write-guard.test.ps1` 有一整组守卫行为用例，但夹具只造了 `docs/`、`.adversarial/`、`node_modules/` 三种形态——**它测的是"名单里有的东西被放行"，从不测"名单漏了"**，所以补 `.adversarial` 那次它能绿、漏 `.gitignore` 它也能绿（同一判据对两类相反结果都无感）。③**观测层**：`mp-worktree-health.ps1:106-107` 只上报 `quarantineCount`，不参与 `ok`，隔离区被同一族填满没有任何东西变红。④**告警面反向误导**：每次隔离都写 `.agent_context/write-guard-alert.json`，把"知识卡生成"报成"共享根有违规"。 |
| 系统性漏洞定位 | PASS | 具体到文件与环节：`scripts/check-unwired-tests.js` 的 `MUST_LIVE_IN_UNGATED_JOB` 已确立"门禁的数据文件进白名单 ⇒ 它的校验必须住在不被短路的 job"这条锁，但**该锁只覆盖 classify 白名单自身的进件，不覆盖"白名单与守卫清单的一致性"**。漏洞分类：门禁缺失（无判据问一致性）+ 测试质量不足（行为夹具对"漏项"结构性免疫）。 |
| 修复 + 回归保护（QM-5 ④） | PASS | ①清单补齐（**只补实测需要的**）：`$allowedTop` 增 `.quality-rhythm`/`.claude`/`.agents`，`$allowedRootFiles` 增 `.gitignore`。**不**加 `LICENSE`/`.editorconfig`——实测二者未被追踪（`git ls-files --error-unmatch` 一个 NO 一个 NO），加了就是死条目。②新判据 `scripts/check-guard-classify-alignment.js`：**匹配器从 classify 直接 import**（`CI_IGNORED_PATHS`+`matchesPattern`，见其导出行 :169），不抄第二份；守卫两份数组按**行首锚定**解析；判据谓词限定「tracked ∧ docs-only ∧ 未被覆盖」，未追踪文件天然不在判定面（`stray.md` 必须继续被隔离，放宽等于拆守卫）。③22 个根级历史 `.md` 进 `DEBT` **只可缩小**清单并逐条写原因（含"删垃圾才算修完，放宽守卫不算"的方向声明），新增未登记漂移即红、登记项不再真漂移也报陈旧。④三档退出码 0/1/2，且 `SelfFailure`（读不到 classify、解析退化、数组解析成空、`git ls-files` 空遍历）走第 2 档，**不与"发现漂移"的 1 混档**——混档等于把"门禁瞎了"读成"仓库有问题"或读成"干净"。⑤接线 `.github/workflows/quality-gate.yml` Gate 2b3，落 `changes` 作业（`.gitignore` 与根级 `*.md` 都命中 `CI_IGNORED_PATHS`，放 `static-gates` 等于自我关闭校验，同 Gate 2b2/2c3 的先例理由），`shell: bash` fail-fast，判据只用 node 内置模块（本作业无 Install deps）。⑥`.gitignore:106` 的 `scripts/*.js` 会静默吞掉两个新文件，按既有惯例补 `!` 反选并实测（新文件以 `??` 出现在 `git status` ⇒ 反选生效）。⑦行为锁：`session-write-guard.test.ps1` 增 7 条 ×2 行尾档，其中**反向锁**（未追踪根级 `.md` 仍被隔离）证明放宽没放宽过头；该文件自带的总数锁按实测 50 → **64** 更新并把算式改准（24→31 每档）。 |
| 防止再次发生（QM-5 ⑤） | PASS | ①对账锁本身即预防措施，且被**自接线锁**保护：测试解析 workflow 文本断言"判据与自身测试都在 `changes` 作业块内且该步骤 `shell: bash`"，摘掉接线当场红（M5 实测指名红）——避免"门禁自己变成装饰"。②`check-unwired-tests.js` 实测 86 个测试文件全部已接线，新测试文件不可能静默不跑。③变异反证 8 条全部**指名红**（见下行）。④AGENTS.md 未改：本片的结论是"两份清单必须有比较机制"，而比较机制现在是代码而非又一轮散文，写进 AGENTS.md 只会与锁漂移。 |
| 变异反证（8 条） | PASS | `.agent_context/mp-mutate-align.js` 驱动（一次性产物，不入库）：终态 `MUTATIONS=8 MISSED=0 WRONG_CAUSE=0 baselineGreen=true`，每轮 `restored=true`（逐字节 md5 比对）。M1 摘 `$allowedTop` 里的 `.quality-rhythm`／M2 摘 `.gitignore`／M3 删一条 DEBT／M4 凭空登记一条 DEBT（报陈旧）／M5 从 workflow 摘掉接线（只有「自接线」那条红）／M6 给 `CI_IGNORED_PATHS` 加一条守卫不知道的路径（`.gitattributes`，验 classify 侧增长的召回）／M7 让解析退化返回空清单不抛／M8 去掉行首锚点（注释里的数组被当真清单）。**三条驱动自身的坑必须留着**：M8 前两次尝试把正则字面量当转义串重写，第一次写出残缺行、第二次连开引号一起删，都导致 `SyntaxError` → 表现为文件级 LOADFAIL——**变异把文件弄坏 ≠ 锁没牙**。因此驱动新增「落盘后先 `node --check`」的变异自体检（`BROKEN_MUTATION` 档）与「`not ok` 取全名、LOADFAIL 单独记账」两条判据；另记一次同类：早期一次 `sed` 变异模式里多写了逗号后的空格，替换根本没发生，判据照绿被我差点读成"判据无牙"。 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`、renderer 源码或任何 UI 文件 ⇒ 打包与视觉回归与本变更无交集。不写"已跑"，如实写 N/A |
| QM-6 CCG 双模型外部评审 | PENDING（执行中，如实记） | 通道判定：`command -v codeagent-wrapper` PATH 未命中，回退标准安装位 `~/.claude/bin/codeagent-wrapper` **命中**；网关按 node `net.connect` 实测 `127.0.0.1:15721 = OPEN`（不用 `Test-NetConnection`，它命令自身失败会伪装成端口不通）⇒ 走 AGENTS.md 分支 (a) 真通道，不降级平台等价机制。模型名不写死：读 `~/.claude/.ccg/config.toml` 得 `[routing.backend].primary = claude`、`[routing.frontend].primary = opencode`。两路**并行**派发（同一条消息两个后台调用），后端结果必须等待。**Critical 未修不得合并**；本行的 PENDING 必须在评审回来后改写。 |
| 行尾与 diff 对账 | PASS | 逐个先量基线再动手：`scripts/guard-shared-root-writes.ps1`、`scripts/session-write-guard.test.ps1`、`.gitignore`、`.github/workflows/quality-gate.yml`、CHANGELOG、`.quality-gates.md`、ledger **全部 `i/lf w/crlf attr/text=auto`、工作副本 CRLF 均匀 bare LF=0**。`session-write-guard.test.ps1` 带 **UTF-8 BOM**（`ef bb bf`）⇒ 文件内中文注释安全（我那条「`.ps1` 一律纯 ASCII」的记忆前提是"无 BOM"），但**绝不能整份重写**（Write 会剥掉 BOM 把中文变成 GBK 陷阱），所以全部改动走 Node 逐行插入并显式断言 BOM 与行尾不丢。插入行**继承锚点行自身行尾**。`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐条同数：`.gitignore 5 0`、`quality-gate.yml 20 0`、`guard-shared-root-writes.ps1 9 2`、`session-write-guard.test.ps1`（37 增 + 后续两处就地改）、两个新文件为纯新增。`guard 9 2` 的 2 行删除就是两份数组整行替换，逐行可归因。 |
| 接线棘轮 | PASS | 新增 `scripts/check-guard-classify-alignment.test.js` **同一 PR 内**接进 `quality-gate.yml`（Gate 2b3），`check-unwired-tests.js` 实测 `检查域内测试文件 86 个 / OK`；判据本体不是测试文件、不进该棘轮扫描域，其执行凭据是 Gate 2b3 那条 `run`，并由测试里的自接线锁反向钉住。动 workflow 正文后按 ci-hardening M3 跑了同域全部既有契约锁：`.github/scripts/workflow-contract.test.js` **37 passed / 0 failed**、`.github/scripts/check-workflow-structure.js` `files=14 violations=0` rc=0（"能被 js-yaml 解析"不等于"能被 GitHub 编译"，这条判据存在的原因就是上次空 `run:` 让 main 连续红 530 次）、`scripts/check-step-failfast.js` 36 个多命令步骤全 fail-fast。 |
| 远程同步 | PENDING | 本 PR 尚未合并，merge SHA 不存在，无法取证收口。合并后由后续回填 PR 改写：`git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 取 merge SHA 与时间、`git ls-remote --heads origin guard-classify-align` 返回 0 行证远端分支已删，并**在同一次提交内**删除上方三个 `sync_*` 字段 + `.quality-gates.md` 两形态（bullet 与表格行）同改 + 删除 `scripts/gate-record-debt-ledger.json` 登记项 |

### 现场数字（全部当场重取，真源 = `node scripts/check-guard-classify-alignment.js` 的打印）

- 修复前漂移面：`tracked=9038 docsOnlyTracked=4835 uncovered=181`，按段 `.quality-rhythm/**` 156 / 根级文件 23 / `.claude/**` 1 / `.agents/**` 1。
- 修复后：`patterns=14 tracked=9039 docsOnlyTracked=4836 uncovered=22 (acknowledged=22 NEW=0 stale=0 debtList=22)` rc=0。
  （`tracked` 9038→9039 不是异常：起点 main tip 从我上一片的 `6179be13b` 前进到 `6b0e083ad`，多一个追踪文件；两个数字来自两个不同 commit，不可当同一趋势比较。）
- 22 条残留全部是根级历史 `.md` 一次性产物（`pr-body-temp.md`、`CI-FIX-*-REPORT-20260920.md`、`.quality-gates-record-*.md`、`CONTEXT.md`、`requirements.md` 等），逐条带原因。
- 守卫测试：PS 5.1 与 pwsh 7 **两档实跑均 rc=0**，总数锁 `(expect 64 checks, got 64)`、末行 `65 session write guard checks`。
- 对账套件：`node --test scripts/check-guard-classify-alignment.test.js` = **13 passed / 0 failed**。

### 遗留（不假装已闭合）

1. **22 个根级残留没删**：本片把它们登记成只可缩小的债务，没有删除——删除 tracked 文档是另一笔变更的爆炸半径（`CONTEXT.md` 疑似仍在被 domain-modeling 使用、`SKILL.md` 与 `.agents/skills` 正本重复、其余多数明显是一次性 CI 报告）。判据已保证"登记不等于永久豁免"：任何新增漂移当场红。
2. **`LICENSE` / `.editorconfig` 故意没进守卫清单**：它们在 `CI_IGNORED_PATHS` 里但实测未被追踪，判据的谓词限定 tracked ⇒ 不算漂移。若将来有人新增这两个文件，对账锁会当场点名，届时再决定 allowlist 还是忽略。
3. **根级 `*.md` 的语义差异仍然存在**：classify 侧是 `*.md` 通配，守卫侧是逐个枚举。本片刻意不把守卫改成"全部根级 .md 放行"，因为那会让 `pr-body-temp.md` 这类垃圾获得"可在共享根就地编辑"的地位；差异由对账锁兜住而不是抹平。
4. **两处小缺陷未修**（都是 `scripts/` 混合 PR，不夹带进本片）：`safe-worktree-remove.ps1:146` 在 cwd 不是 git 仓库时 `(& git rev-parse --git-common-dir 2>$null).Trim()` 对 null 点方法抛，只能靠显式 `-MainWorkspace` 绕过；`safe-delete.js` 带 `--allow-outside` 成功时仍打印「在工作区内」，文案与分支不符。
5. **desync 机械检测仍未实现**（上一片登记的遗留 3），本片没顺带做，避免一片改两件事。
6. **`.qoder/` 那一条的守卫语义现在更清楚了**：#3586 把 `/.qoder/` 加进 `.gitignore` 走的是"ignored ⇒ 守卫放行"这条外路；本片补的是"tracked ⇒ 必须进清单"这条。两条路互不覆盖，判据只管后者——这不是漏洞，但读代码的人容易以为只有一个机制。

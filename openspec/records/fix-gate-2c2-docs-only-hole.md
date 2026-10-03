---
record: fix-gate-2c2-docs-only-hole
task: 修 #2745 —— 把执行记录存在性门禁（Gate 2c2）从被 docs-only 短路的 static-gates 搬进无条件执行的 changes job，并把「进白名单的路径其门禁必须在 changes」这条前提锁从账本专用泛化为路径→命令清单；同步按分支名放宽"携带记录"判据
date: 2026-10-03
# ↓ 下面三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（合并后按 git log origin/main --grep 与 ls-remote 回填并删除本段三字段）
---

## 本次执行记录：Gate 2c2 接线位置与 docs-only 短路前提锁（fix-gate-2c2-docs-only-hole，2026-10-03）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码面（CI 配置 + 门禁脚本）⇒ 独立 worktree `D:/Data/projects/mp-worktrees/mp-fix-gate-2c2-docs-only-hole` + 裸分支 `fix-gate-2c2-docs-only-hole`，由 `scripts/start-mp-task.ps1` 创建，并以 `rev-parse --abbrev-ref HEAD` 与 `rev-list --count HEAD..origin/main = 0` 实证（起点 `ecee7649` == 当时 origin/main）；`pnpm install --frozen-lockfile` + `ensure-electron.js` + `verify-worktree-deps.js`（11 个 workspace 解析通过）。共享根保持 main clean。 |
| 第一性原因（QM-5 ①） | PASS | 不是脚本判据写坏，是**接线位置**。`check-pr-exec-record.js` 校验的输入 `openspec/records/**` 命中 `scripts/classify-docs-only.js` 白名单里的 `openspec/**`（行为实测 `isDocsOnly(['openspec/records/some-branch.md']) === true`），而该判据当时住在 `static-gates`，整个 job 被 `if: needs.changes.outputs.docs-only != 'true'` 门控 ⇒ 纯文档 PR 完全不执行它。引入点：#2717（change `enforce-gate-record-presence`）新接这一步时未套用 #2718 已确立的前提锁。 |
| 逃逸分析（QM-5 ②） | PASS | 单元层：`check-pr-exec-record.test.js` 全部测的是 `evaluate()` 的输入/输出，**没有任何一条测"这一步在 CI 上到底跑不跑"**——判据在 workflow 里的位置不在其定义域。集成层：无。审查层：#2718 当时把前提锁写成了「账本 JSON 专用」（`classify-docs-only.test.js` 里点名 `scripts/gate-record-debt-ledger.json`），于是同一形态的第二个数据文件进来时锁不覆盖。流程层：docs-only 快速通道只看"哪些 job 被跳过"，不看"被跳过的 job 里有没有校验白名单文件的门禁"。 |
| 修复 + 回归保护（QM-5 ④） | PASS | ①workflow：Gate 2c2 两条命令搬进 `changes` job，插在含非 PR 早退 `exit 0` 的 classify 步骤**之前**（push 事件 `EXEC_BASE` 为空，脚本自走"非 PR 不适用"分支，行为与旧位置等价）；`static-gates` 原处只留指针注释。②`classify-docs-only.test.js`：专用锁泛化为 `(白名单路径 → 门禁命令)` 两张项清单（账本 JSON + `openspec/**`），每项仍要求"在 changes 正文且早于早退"，清单只能扩大、退化为空白即红。③`check-pr-exec-record.test.js`：新增 4 条 #2745 结构锁（前提成立/位置唯一/门控仍在/env+advisory 仍在）+ 2 条记录语义行为锁。④`check-pr-exec-record.js`：`submitted` 增加「M 自己那篇 `openspec/records/<headBranch>.md`」，矛盾判定改用 `hasRecord = A ∥ M(own)` 同步跟上，出路文案两条改三条。 |
| 防止再次发生（QM-5 ⑤） | PASS | ①机制：`scripts/classify-docs-only.test.js` 的清单泛化成与 `CI_IGNORED_PATHS` 双向对账的表（12 项逐个给去向），下一个进白名单的数据文件不再靠人记得搬门禁 —— **它在本 PR 内就抓到第三处同型漏洞（Gate 12 品牌残留住在被短路的 static-gates，而 AGENTS.md 把它列为文档 PR 的保留门禁）**，已一并搬进 changes；②`jobsOf()` 解析自带规模下界断言（`jobs > 5`）与「锚点缺失即红」，且所有子串匹配都在"归一 LF + 剥注释"后的域里做，防"把真步骤注释掉仍算接线"的装饰性锁；③文档 `docs/gate-2c2-docs-only-wiring-hole.md` 记录症状、机制、第三处漏洞与未做的转阻断前置条件；④AGENTS.md 未改（该不变量已在 docs-only 快速通道段落写明，本次是把它泛化到测试实现并补齐违约的那一处，不是新增口径）。 |
| 反证（驱动实跑） | PASS | 评审修复前 9 条 + 修复后扩到 14 条，全部逐条实跑，要求 rc≠0 **且**预期那条测试红 **且**红因文本含预期子串（红因对上，避免"别处顺带红"被当证据）：M1 命令名改错 ⇒ RED「一处真源」；M2 用结构 apply 函数把步骤真搬回 classify 之前 ⇒ RED「必须在 classify 步骤之后」；M3 摘 `--mode=advisory` ⇒ RED；M4 `EXEC_BASE` 不取 PR base ⇒ RED；M5 摘 `--head-branch` 注入 ⇒ RED；M6 `submitted` 退回只认 A ⇒ RED；M7 放宽过头 ⇒ RED「改别人的记录不等于自己写了记录」；M8 摘保留名守卫 ⇒ RED（红因里点名 `openspec/records/_TEMPLATE.md`）；M9 `headBranch` 退回 `gitBranch` ⇒ RED「detached」；M10 把结构锁改 no-op ⇒ RED「解析出的 job 数」（证明防失明的规模下界在跑，而不是靠"没接线"分支）；M11 给 changes 加 job 级 if ⇒ RED；M12 品牌残留从 changes 摘掉 ⇒ RED「出现 0 次」；M13 把接线行注释掉 ⇒ RED「一处真源」；M14 对账表少登记一项 ⇒ RED「不再一一对应」。驱动收尾对四个文件断言与备份逐字节相同；基线（全部还原后）**47 tests / 0 failed**。两处驱动自身故障如实记录：初版 M1/M4 用带 `\n` 的多行 find，工作区 CRLF 让它匹配不到而报 `FIND_NOT_FOUND`（探针故障不是结论），改单行变异后成立；初版 M14 用"删掉整行"会让测试文件语法炸掉而红错因，改成把 pattern 改瞎。 |
| 行尾与 diff 对账 | PASS | CHANGELOG.md 实测纯 CRLF（`CRLF=63813 / LF-only=0`），两次改动都走逐行 Buffer 操作：前插块断言 `cr_after == cr_before + 行数 + 1` 且"原字节整段作后缀"；评审后的「验证」小节改写断言 **替换块之后的 4,573,435 字节逐字节相同**（`tail_bytes_identical=true`）且 LF-only 前后都是 0（禁统一行尾）。两口径对账 `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **六个文件逐项相等**（`workflow-contract.test.js 14/4`、`quality-gate.yml 42/29`、`CHANGELOG.md 21/0`、`check-pr-exec-record.js 56/11`、`check-pr-exec-record.test.js 230/0`、`classify-docs-only.test.js 75/13`）⇒ 无行尾污染。 |
| 接线棘轮 | PASS | 未新增测试文件（只在既有 `*.test.js` 内加用例），`node scripts/check-unwired-tests.js` 检查域 53 个文件全 OK；新步骤含 2 条命令且 `shell: bash`，`node scripts/check-step-failfast.js` 报「含 ≥2 条测试命令的 run 步骤：4 个 / OK」。 |
| 消费者并集 | PASS | 判据/接线被三处消费，逐个跑：①`.github/scripts/workflow-contract.test.js` —— **它确实被本 PR 改红了**（`Gate 12 必须在 Gate 11 之后`，因为 Gate 12 搬进了 changes），按 AGENTS.md「门禁断言随实现迁移同步」改写为位置契约（必须在 changes 正文、不得留在 static-gates）后 29/29 绿；②`scripts/classify-docs-only.test.js` 与 `scripts/check-pr-exec-record.test.js` 47/47 绿；③品牌残留自测 `scripts/check-no-brand-residue.test.js` 绿，实际扫描 `node scripts/check-no-brand-residue.js` 在搬进 `changes`（ubuntu、无 node_modules）前后同为 PASS（6666 个 tracked 文件），确认它零第三方依赖（只 require child_process/fs/path），可跑在没装依赖的 job 里。CI 的 eslint 只覆盖 `apps/desktop` 的 `electron/` 与 `src/`（`quality-gate.yml:302`），本次改的 JS 全在 `scripts/` 与 `.github/scripts/` ⇒ 不适用，配置文件位置已实测核对而非凭印象。 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面；改动面是 CI 配置 + 门禁脚本 + CHANGELOG/文档。 |
| QM-6 CCG 双模型外部评审 | PASS（降级通道 2/2，偏差已声明） | 规定通道不可用且已实测：`Test-NetConnection 127.0.0.1 -Port 15721 -Quiet = False`、`Get-NetTCPConnection -LocalPort 15721 -State Listen` 0 条、CC Switch 的 `app_paths.json = {}`、`codeagent-wrapper.exe` 存在于 `C:/Users/to_co/.claude/bin/` 但无可用后端 ⇒ **未启动也未改动用户的路由与凭证配置**（登记为待用户确认项）。改走替代双模型：`opencode-cli run --agent plan --model opencode/big-pickle`（逻辑/安全轴）与 `--model opencode/fledge-alpha-free`（命名/集成轴），同 harness 不同底模。两路都因 Plan 模式拒绝写 findings 文件（**rc=0 但 `.review/findings-*.md` 未落盘**）⇒ 判据改为直读各自 `===STDERR===` 之前的 stdout 段原文，不靠关键词计数。发现项 8 条，处置见下表。 |

### QM-6 发现项与处置（逐条要么修要么给理由）

| # | 来源 | 级别 | 发现 | 处置 |
|---|------|------|------|------|
| 1 | 两路独立命中 | Critical | `headBranch` 取 `git rev-parse --abbrev-ref HEAD`，PR runner 上是 detached HEAD ⇒ 恒为字面量 `"HEAD"`，"修订自己那篇记录"这条出路在 CI 上永不触发，而输出文案却把它列为合法出路；第二路补充：同一根因使 `e.branch !== headBranch` 恒真 | **已修**：新增导出 `resolveHeadBranch`（显式参数 > `GITHUB_HEAD_REF` > git，detached 一律空串不猜）；workflow 用 step 级 env 注入 `github.event.pull_request.head.ref` 并传 `--head-branch`；回归锁两条（优先级单元表 + **真 detached 夹具跑真 CLI**，禁止靠注入过锁）；反证 M5/M9 |
| 2 | 第二路 | Warning | 结构锁按子串匹配，把真实步骤注释掉、留一条同字符串注释即假绿；注释里若出现字面 `exit 0` 还会污染位置比较 | **已修**：`readWorkflowForParse` 与对账表统一"归一 LF + 剥离注释行"后再匹配，并加"改成注释必须判未接线"的行为锁；反证 M13 |
| 3 | 第二路 | Warning | `ownRecordPath` 未复用 `RECORDS_RE` 的保留名守卫，实测 `headBranch='_TEMPLATE'` + M `openspec/records/_TEMPLATE.md` 判 ok=true（改模板即满足判据） | **已修**：`candidateOwnPath && RECORDS_RE.test(candidateOwnPath)` 双条件 + 保留名锁；反证 M8 |
| 4 | 第二路 | Warning | 三条新锁没钉住 `changes` job 自身无条件执行 —— 给它加 `if: github.event_name == 'pull_request'` 后所有锁照绿，而"搬到 changes 就覆盖纯文档 PR"的承诺已失效 | **已修**：新锁断言 changes job 无 job 级 `if:` 且不得引用 docs-only 输出作门控；对账表加同一判据；反证 M11 |
| 5 | 第二路 | Warning | 「早于非 PR 早退」不换来任何覆盖差异（step 内 `exit 0` 只结束该 step 的 shell），反而让本步骤一红就使 `changes` job 在写出 `docs-only` 输出之前中止 ⇒ 判定整条消失、下游重型 job 全部跑满 | **已修**：步骤移到 classify **之后**，位置判据由 `at < earlyExit` 改为 `at > classifyAt` 并写明理由；反证 M2 用结构 apply 函数真的把步骤搬回前面 |
| 6 | 第二路 | Warning | 对账表是 opt-in：新增白名单路径而不登记时现有断言照绿，注释「不再靠人记得」高估了强制力 | **已修**：改为与 `CI_IGNORED_PATHS` 的 `deepEqual` 双向对账（12 项逐个给去向：commands 或带非空原因的 noGate）；反证 M14。**并由此逼出第三处同型漏洞**：`Gate 12 品牌残留`也住在被短路的 static-gates，而 `*.md`/`01-docs/**`/`docs/**` 全在白名单 ⇒ AGENTS.md 承诺的"文档 PR 保留门禁：品牌残留"实际一次都不执行；本 PR 一并搬入 changes，并同步迁移其消费方契约 `.github/scripts/workflow-contract.test.js` 的「Gate 12 必须在 Gate 11 之后」（改为位置契约，见「门禁断言随实现迁移同步」） |
| 7 | 第二路 | Warning | 放宽只按「文件名 == 分支名」，分支名可复用时改一行历史同名记录即满足判据 | **不修，留残余并写明**：判据只拿得到 statuses（脚本前提 1 禁止自拼 diff），要"该记录由本 PR 引入"需 `--diff-filter=A` 语义，会把 A/M 两路重新混成一个判据。风险面限于"复用旧分支名 + 只改自己那篇一行"，而这类 PR 本来就该把证据写进那篇记录。已登记进「遗留」 |
| 8 | 第一路 | Info | `hits === 1` 统计含注释的全文，将来注释里出现完整命令串会误报且失败文案读不出真因 | **随 #2 一并修**：统计域剥离注释；static-gates 的指针注释因此改写为不复写命令原文 |

| 远程同步 | PENDING | 本 PR 尚未合并，merge SHA 还不存在。合并后由后续会话取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 的 merge SHA 与时间、`git ls-remote --heads origin fix-gate-2c2-docs-only-hole` 期望 0 行（同次对 `main` 做正控），回填 PASS 并**同次删除** frontmatter 的 sync_status / sync_reason / sync_backfill_owner 三个字段（回填不删字段 = 门禁当场报「已回填却仍留登记字段」） |

### 遗留（不假装已闭合）
- **advisory → enforce 未做**，且这一步不该在本 PR 顺手做。实测窗口（origin/main first-parent 120 个提交）里 59 个纯文档 PR：9 个交 `_exempt`、5 个修订自己那篇记录、31 个只写历史载体 `.quality-gates.md`、14 个在任何记录源里都没有。转阻断的硬前置：① 那 14 个有归属清单；② `.quality-gates.md` 与 `openspec/records/` 两套载体的去留有明确结论（`check-gate-record-debt.js` 目前两源分列统计，说明旧源仍被消费）。
- `openspec/changes/enforce-gate-record-presence/` 这个在途 change 仍描述"Gate 2c2 在 static-gates"，本 PR 改了位置但没有改 change 文档（它属于在途变更的产物，归档时由该 change 的负责人收敛）。
- `changes` job timeout 5 分钟，本次给它加了约 2.5 秒的 `node --test`；若后续继续往这个 required 上游塞步骤，预算需要重新量。
- 会话临时产物 `.review/`（brief/diff/findings）不入库，PR 开出后删除；变异驱动在 `D:/tmp`，不入库。

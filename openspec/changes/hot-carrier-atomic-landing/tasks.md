## 0. 前置与归属核对（阻塞全部后续）

> **2026-10-15 让位说明（change: freeze-legacy-gate-carrier）**：本 change 的 (2) `scripts/docs-land.ps1` 与 (3) pre-commit 归属拦截 **标为不实现**，理由不是"太难"而是**对象消失**——后继 change 把 `.quality-gates.md` 与 ledger 冻结为只读存档（判据：记录块集合必须等于 `scripts/gate-carrier-freeze.json` 基线，加块/删块皆红），新 PR 不再写这两个文件，于是"窗口"不再出现在日常路径上；此时再实现 (2)(3) 只会新增"别的会话没关账、我的提交被拒"的无辜方误伤面。这正是本 change 自己写的 D7/退场条件的正向应用。
> **仍要实现的是 (1)**：常驻守卫的开窗/收窗时长读数（tasks 2.x）——它的作用从"守窗口"变成"证明确实没人再挤旧载体"，是 `freeze-legacy-gate-carrier` 判据的事后对账面，缺失即等于只有拦截没有观测。该刀拆出为 tasks 3.2（在后者仓库中跟踪）。
> 下面 2.x/3.x/4.x 各条保留为历史计划文本，不再作为待办执行；1.x 与 5.x 中被后继 change 覆盖的部分同理。

- [x] 0.1 核对 `enforce-gate-record-presence` 的当前状态与本 change 的退场耦合：实测**不触发作废**——该 change 仍在 `openspec/changes/` 未归档（`openspec/specs/quality-gate-execution-record/` 不存在），且 `scripts/gate-record-debt-ledger.json` **仍是手工写入面**（`check-gate-record-debt.js:91` 读它、`:205` 要求未收口行必须登记），最近两笔回填 PR #3634/#3638 都在改它 ⇒ 热点写面当时仍在。（后续走向见本节顶部的让位说明：写面由 `freeze-legacy-gate-carrier` 冻结，而非等 `enforce-gate-record-presence` 自己收敛。）
- [x] 0.2 与 #3582 跨源一致性门禁对账（读判据源码 + 现算场）：判据域**不重叠**——那条门禁比「同一 slug 在记录文件与旧载体两侧的收口方向」（静态、已提交态，排除回填型块、带承认清单；现场读数 配对 120 组 / 违例 0 / 承认 1），本 change 的 (1) 比「一段时间内工作树是否存在未提交热点改动」（机器态、CI 不可见）。本 change 未改那条门禁的判据。0.1 的让位说明生效后，(2)(3) 不再实现，域冲突面进一步缩小。
- [x] 0.3 `openspec validate hot-carrier-atomic-landing --strict` 通过：初稿实测 rc=0（7 条 Requirement / 20 条 Scenario）；本文件改账后重跑仍 rc=0（见执行记录）。Requirement↔Scenario 配对由 `--strict` 本身保证（每条 Requirement 至少一个 Scenario 是该 CLI 的校验项之一）。
- [ ] 0.4 核对常驻守卫的现有结构是否真能承载「开窗/收窗」：`scripts/guard-shared-root-writes.ps1` 的 `$allowedTop`(`:68`)/`$allowedRootFiles`(`:69`)、`violations.jsonl` 写入点(`:123-125`)、启动对账路径(`:247` 起)四处逐个读实现并记录「事件能否配对」；若 FileSystemWatcher 的缓冲溢出会把收窗事件丢掉，本片的判据形态要回 design D9 重裁，不得硬写

## 1. 清单单一来源（小片）

- [ ] 1.1 建 `scripts/hot-carrier-paths.json`：**只含** `.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json`。先用 `git check-ignore -v` 当场证明它自己不被 `.gitignore` 静默排除（`.json` 需实测，不得按 `scripts/*.js` 的结论类推）
- [ ] 1.2 TDD：`scripts/hot-carrier-paths.test.js` 断言（a）清单存在且**恰为两项**；（b）每项经 `require('./classify-docs-only.js')` 导出的 `matchesPattern` 命中 `CI_IGNORED_PATHS`；（c）`openspec/records` 与 `.ccg/reviews` 不在清单内；（d）`AGENTS.md` / `CHANGELOG.md` / `01-docs/learnings.md` **不在**清单内（这条是把 D4 撤三项的决定钉住，防止下个会话「顺手补全」）
- [ ] 1.3 变异反证：从 `CI_IGNORED_PATHS` 摘掉 ledger 那一行（或把 `matchesPattern` 换成字符串相等）⇒ 1.2 指名变红；清单改成空数组 ⇒ 「空清单 ≠ 无违规」那条变红

## 2. 窗口测量落到常驻守卫（形状 A 的唯一可用宿主）

- [ ] 2.1 TDD（行为，本机临时仓库）：在 `%TEMP%` 用 `git clone` 造共享根形态，触发「热点载体出现未提交已跟踪改动 → 持续 → 收窗」，断言 `violations.jsonl` 里出现**成对**的开窗/收窗记录且时长可读；另加一条「漏掉收窗事件时必须由启动对账补上」的用例
- [ ] 2.2 实现守卫侧：只在放行面里出现热点载体路径变更时记事件；超上限（`MP_HOT_CARRIER_WINDOW_MAX_MINUTES`）出声**不拦截**；非法值回落默认并告警
- [ ] 2.3 反证：把「出声」摘掉 ⇒ 用例红；把对账路径改成 no-op ⇒ 补窗那条红；把上限改成 0 ⇒ 必须立刻可观测（防止「阈值写死成永不触发」）
- [ ] 2.4 读数落文档：守卫跑一天后取真实窗口分布写进 `01-docs/learnings.md` 与本 change 归档说明；**上限值必须由该分布推出**，不得先拍一个数再解释（AGENTS.md「实测分布支撑」条目）

## 3. `docs-land.ps1`：一条命令收口（形状 A 的拦截点）

- [ ] 3.1 TDD：`scripts/docs-land.test.ps1` —— 覆盖 `git fetch origin main` **必须先于** `git reset --keep`（把 fetch 摘掉或调到后面 ⇒ 指名红）；拒绝批量 stage（`-A`/`-u` 形态不接受）；`reset --keep` 前若存在本会话声明之外的热点脏 ⇒ 中止且**不动 HEAD**
- [ ] 3.2 实现动线：重装钩子并核已装文件开头与权威源字节一致（容忍 IDE 尾部追加）→ fetch → 写 `.agent_context/pending-landings` 声明 → `git add <命名路径>` → commit → `git branch <name>` → `git reset --keep origin/main` → push → `gh pr create`。**正文一律纯 ASCII**（PS 5.1 按 GBK 解非 ASCII 会吞引号，报出全是误导性语法错），中文说明放 md
- [ ] 3.3 产物取证三条：本地分支 SHA == `git ls-remote --heads origin <branch>` 返回值；`HEAD` == **本次 fetch 后** `git ls-remote origin main` 的 SHA（**不得**写成等于本地 `origin/main`——陈旧 ref 会满足它，是空转断言）；`gh pr view --json number` 有号
- [ ] 3.4 打印窗口时长（进入 stage → PR 号到手，毫秒）与本次声明路径清单；两 shell（5.1 / pwsh 7）各跑一遍并打印走的哪条支路
- [ ] 3.5 判成败一律取产物：`$LASTEXITCODE` 与管道末段输出不得作为判据（本仓实测 `gh pr merge` 的 rc 同时出现过 0 和 1 而合并都成功）

## 4. pre-commit 的窄判据（形状 B）+ 声明层

- [ ] 4.1 TDD：`scripts/hooks/pre-commit.test.sh`（既有 12497 字节行为锁，必须同步扩展）—— 用 `git clone` 出临时工作树（禁 `git init`+`git add` 造夹具），造「本次提交命中清单 + 工作树另有未声明脏」⇒ 断言 rc≠0 且点名；再加「未跟踪文件不参与判定」负控
- [ ] 4.2 实现：分域沿用既有 `ISOLATED_WORKTREE`（`scripts/hooks/pre-commit:20-22`），禁止新造第三套判定；「本次提交内容」的取法 MUST 明确写死为 `git diff --cached --name-only`，并在注释里记下 **`--amend` 与 rebase 重放不走本钩子的新版本**（已知覆盖缺口，不假装修复）
- [ ] 4.3 声明层：`.agent_context/pending-landings` 逐行路径 + 写入时间；判据改为「脏 ∉ 本次提交 ∪ 有效声明」⇒ 拒；命中声明即放行**并打印 `allowed-by-pending-landings: <路径>`**（放行也要留痕）
- [ ] 4.4 到期：超过 `MP_PENDING_LANDINGS_MAX_AGE_MINUTES` 的声明不再豁免；非法值回落默认并告警。反证两条分离：摘掉到期判定 ⇒ 只有「过期后仍拒」那条红；摘掉留痕打印 ⇒ 只有「放行依据」那条红
- [ ] 4.5 反证：判据改成 no-op / 分域写反（把 worktree 当共享根）/ 把未跟踪也算进拒绝面 ⇒ 三档各自指名变红
- [ ] 4.6 成本实测并写进钩子注释：本仓 `git status --porcelain=v1 --untracked-files=no` 单次耗时（给样本数），确认不在高频路径；耗时不可接受则回 design D1 重裁，**不得**直接砍判据

## 5. parity 与 CI 接线

- [ ] 5.1 parity 锁：`scripts/hot-carrier-paths.test.js`（或独立 `shared-root-clean-parity.test.js`）断言钩子与 `scripts/mp-worktree-health.ps1:49` 两处出现的 status 命令串**逐字相同**；改一侧不同步另一侧 ⇒ 红。**不得**只在注释里写「与某某同口径」
- [ ] 5.2 只锁「判据源在位」的结构断言：清单存在且恰两项、钩子里那段判据的语义特征在、`docs-land.ps1` 存在、守卫里开窗记录的特征串存在。同 PR MUST 附**行为**用例（4.1/2.1），结构断言不得单独交差
- [ ] 5.3 把 1.2 / 2.1 / 3.1 / 4.1 / 5.1 显式点名进 `.github/workflows/quality-gate.yml`（`changes` job 或对应 Gate），按 `scripts/check-unwired-tests.js` 的**可执行正文**口径验证接线；接不进非提权面的 PowerShell 项进 `KNOWN_UNWIRED` 并写原因
- [ ] 5.4 改 workflow 正文后跑 `node .github/scripts/check-workflow-structure.js`（能被 js-yaml 解析 ≠ 能被 GitHub 编译），并跑 `.github/scripts/workflow-contract.test.js`
- [ ] 5.5 若实现落在 `changes` job：该处判据 MUST 只 require node 内置模块

## 6. 文档同步与 dogfood（收尾）

- [ ] 6.1 更新 `AGENTS.md`「docs-only 快速通道」与「PR 自动合并」收尾清单：把那句手工动线替换为 `docs-land.ps1`，并**照抄覆盖边界**（手工 `reset --hard` / `--amend` / rebase 重放不在覆盖内）——不得写成「已杜绝」
- [ ] 6.2 `01-docs/learnings.md` 记本缺陷族与「判据宿主选错」这条：`git reflog --date=iso --format='%gD|%gs'` 立据命令与实测计数一起写进去，让下个会话能一句话重取
- [ ] 6.3 **dogfood**：拿下一次自然发生的回填链用 `docs-land.ps1` 收（不为其造 PR），记录实测窗口时长；跑不通就如实登记未闭合，不得以「逻辑上可用」交下
- [ ] 6.4 **有效性自证（本 change 的核心风险）**：机制上线后 MUST 用 2.x 的读数回答「共享根还开过几次窗口、最长多久」；若一周内读数恒为「没有窗口」，第一解释是**探针没接上**而不是问题消失（AGENTS.md「0 命中先证明坐标是旧的」），必须先做一次人工开窗验证读数为真
- [ ] 6.5 归档三同步：`openspec archive hot-carrier-atomic-landing` + CCG task 归档 + 质量节拍复盘；并核对 `enforce-gate-record-presence` 归档时是否触发退场——触发则按其规范删本能力
- [ ] 6.6 退场判据写成两半且都可求值：清单非空 ⇒ 实现文件必须存在（**现在就红得起来**）；清单为空 ⇒ 实现文件必须不存在。并对判据本体做变异：临时 clone 里把清单改成空数组 ⇒ 退场那条指名变红，还原后按字节核对

## 对账结论

（0.2 / 0.4 完成后填写：与 #3582 跨源门禁的判据域是否重叠、守卫能否配对开/收窗事件，各以何实测为依据。）

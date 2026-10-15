## 0. 前置与归属核对（阻塞全部后续）

- [ ] 0.1 核对 `enforce-gate-record-presence` 的当前状态与本 change 的退场耦合：`git log origin/main --oneline -5 -- openspec/changes/enforce-gate-record-presence openspec/records/` 取现况，确认它是否仍在 `changes/` 未归档；若已归档且聚合热点文件已不再是写入面，本 change **立即作废**并按退场条件走空实现
- [ ] 0.2 与 #3582 跨源一致性门禁对账：读 `scripts/check-gate-record-debt.js` 的跨源比对段（现场读数：配对 113 组 / 违例 0 / 承认 1），确认本 change 判据域与其不重叠；结论写进文末「对账结论」，**禁止以「看起来不冲突」交下**
- [ ] 0.3 `openspec validate hot-carrier-atomic-landing --strict` 通过（初稿实测 rc=0），并把 Requirement↔Scenario 配对结果写进 0.1 同一次提交
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

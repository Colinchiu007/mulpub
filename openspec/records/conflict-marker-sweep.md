---
record: conflict-marker-sweep
task: 主干上 6 个文件把 git 冲突标记提交了进去且无任何判据在看这件事——补全仓棘轮锁（三档退出码 + 只能缩小的承认清单 + 接线锁盯住测试口子），并机械修掉其中可无损修的 2 个
date: 2026-10-14
---

## 本次执行记录：主干冲突标记清扫与棘轮锁（conflict-marker-sweep，2026-10-14）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🔧 CI/门禁判据变更（新增 `scripts/check-no-conflict-markers.js` + 其测试 + 接进 `.github/workflows/quality-gate.yml`）⇒ **混合 PR，不走 docs-only**。隔离：`scripts/start-mp-task.ps1 -TaskName conflict-marker-sweep -NoDeps`，worktree `mp-worktrees/mp-conflict-marker-sweep`、裸分支 `conflict-marker-sweep`，起点 `96074c90d` = 当时的 `origin/main`（`rev-list --count HEAD..origin/main` = 0 实证）。`-NoDeps` 的代价当场付了一次：`check-workflow-structure.js` / `workflow-contract.test.js` 在本区报 `Cannot find module 'js-yaml'`，改用 `NODE_PATH=D:/Data/projects/Mulpub/node_modules` 注入共享根依赖后在**本 worktree 的 workflow** 上跑通（`files=14 violations=0`、`37 pass / 0 fail`），不是拿共享根的读数交差 |
| 第一性原因（QM-5 ①） | PASS | 不是"某个 PR 忘了清标记"，而是**没有任何判据的扫描维度覆盖它**：`check-text-encoding-integrity.js` 看控制字节（NUL/孤立 CR）、`check-doc-abs-paths.js` 看绝对路径、numstat 两口径看行尾 —— 三者对"行首七个尖括号"都无感。git 侧也没有兜底：`git` 只拒绝**索引里**残留标记的合并提交（`UU` 状态），而 `git add` 掉标记文件即可提交；`stash pop` 甚至根本不进合并状态机。溯源到具体成因：4 篇 `openspec/records/*.md` 是 **`git stash pop` 的冲突被整块提交**（标签正是 `Updated upstream` / `Stashed changes`，这是 stash pop 独有的两侧命名），2 篇（`01-docs/PRD-XHS-DOM-RPA-HARDENING-2026-10-09.md`、`openspec/changes/rpa-xiaohongshu-dom-hardening/tasks.md`）是 **rebase 时只删了 `<<<<<<<` 一侧、留着 `=======` + `>>>>>>> <sha>`** |
| 逃逸分析（QM-5 ②） | PASS | ①**门禁层**：上述三类判据维度不同，全都不看标记 ⇒ 结构性免疫，不是"漏了一个用例"。②**测试层**：本仓无 `git diff --check` 门禁（AGENTS 明记它在含 NUL 的三份大文档上恒报 trailing whitespace、会被读成噪声），所以也没人试图用它。③**观测层**：标记留在**记录文件**里时，下游按行匹配状态词的判据（`check-gate-record-debt.js` 的 `ROW_RE`）只看到 hunk 里第一条 `远程同步` ——第二条互相矛盾的状态（`已执行` vs `待跑`）对它**完全隐形**，于是"红着的记录"能被读成"收口了"。④**分类**：流程缺失（无判据）+ 审查盲区（人读 diff 时把标记当"别人的在制品"放过） |
| 修复 + 回归保护（QM-5 ④） | PASS | ①新判据 `scripts/check-no-conflict-markers.js`：扫**受管文件全集**（`git ls-files -z` 而非 `git grep`，因后者会把含 NUL 的 `01-docs/PRD.md`/`learnings.md` 当二进制**静默跳过**——AGENTS「全仓关键词复扫必须带 -a」的同族），只认**行首** `<<<<<<<`/`>>>>>>>`（`^={7}$` 一律不认，见 ⑤），检测走 `latin1` 逐字节而**展示回环成 UTF-8**；退出码三档严格分开 **0 合规 / 1 发现违规 / 2 判据自身读不到**。②承认清单是**带计数基线的双向棘轮**：条目形态为 `{ markers: 实测标记行数, reason: 为什么本轮没修 }`——`实际 > markers` 即红（同一篇又犯一次不再隐身），`markers` 缺失或形态不对 ⇒ **落 2 档**而不是"降级成没有基线"，文件已无标记 / 已消失 ⇒ 陈旧红。③修掉可机械无损的 2 篇：PRD-XHS 删 133/134/735、tasks.md 删 31/32/57/58，共 **7 行纯删除、0 新增**，两口径 numstat 同数；每行删前断言确为标记行、删后断言"结果是原行序列去掉指定下标的逐字保序子集"。④回归锁 **20 条**，含三条**负控**（合法 setext 等号不命中、行中间引用不命中、已登记文件标记数**低于**基线不得拦）与五条**档位**用例（非仓库目录→2、受管文件读不到→2、CLI 用法错误→2、承认清单形态不合法→2、违规→1 且文案互斥），另有一条**索引级夹具**（往索引塞 `120000` 条目、磁盘放真目录）钉住"非普通文件被计数并出声"——用真符号链接会把锁绑到宿主特权，属"本机绿 CI 红"那一类。⑤接线锁把**位置**也当判据：调用行必须落在非 PR 早退之前、且两行相邻、顺序固定（锁在前、判据在后） |
| 防止再次发生（QM-5 ⑤） | PASS | ①判据接进 `quality-gate.yml` 的 **`changes` job**（该 job 无 job 级 `if`，不被 docs-only 短路）且放在**非 PR 早退之前**，与 `check-gate-record-debt` 同位同形制；由 `check-unwired-tests.js` 强制接线（实测域 86 个测试文件全绿）。**覆盖范围按实测写，不写"main push 同样覆盖"那种无前提的话**：push 侧有 `paths-ignore`（14 条，含 `openspec/**`、`01-docs/**`、`*.md`），纯文档 push 根本不生成 run；本判据现在兜得住，是因为**进 main 的唯一通路是 PR**（直推被 GH011 拒 + ruleset `main-ci-gate` 的 `bypass_actors` 现网回读为 `[]`），而 `pull_request` 触发**没有** paths 过滤。前提一旦变（给 ruleset 加旁路主体），这句话就失效 ⇒ 已写进「遗留」。②`.gitignore` 补 `!scripts/check-no-conflict-markers.js` —— 第 106 行 `scripts/*.js` 会把判据本体**静默忽略**（本仓第三次踩同族，前两次 #3011/#3469），判据不入库时 CI 报的是 MODULE_NOT_FOUND 而不是"这条门禁没跑"。③4 篇需要选边的记录**没有代属主会话改写**，改为登记进承认清单并逐条写明"为什么本轮不能机械修"（两侧含互相矛盾的状态格 / 跨行焊接 / 小节重复出现两次）——把"我判断不了"变成机械可见的欠账，而不是悄悄选一边。④我自己制造并当场抓到的问题见下节，不抹平 |
| 行尾与 diff 对账 | PASS | 逐文件两口径对账 `git diff --cached --numstat` 与 `git diff --cached -w --numstat` **逐行相等**（10 个文件：`quality-gate.yml`、`.gitignore`、`.quality-gates.md`、`PRD-XHS 0/3`、`CHANGELOG.md`、`tasks.md 0/4`、本记录、判据、锁、`ledger 2/1`）⇒ 删除行全部是**语义行**，无一行尾重排。删除数归因：`PRD-XHS 3` 与 `tasks.md 4` 是本轮真正删掉的冲突标记行；`ledger 1` 是就地改写它的锚点行（给上一条补尾逗号），`git diff --cached -U2` 现场可核对；其余文件删除数为 0。EOL 前置测量：`CHANGELOG.md` / `.quality-gates.md` / `ledger` 工作副本实测**纯 CRLF**（`bareLF=0`），本记录与两个新脚本是 `w/lf`（工具直写）⇒ 追加行按各自文件的实测行尾落，不做全局归一 |
| 接线棘轮 | PASS | `node scripts/check-unwired-tests.js` ⇒ **检查域内测试文件 86 个 / 全部已接线或按欠账登记**，rc=0。新锁被 workflow **显式点名**（本仓无自动收集，不点名等于没写）；接线锁另断言 CI 调用行**不得出现 `--ack-file`** —— 那是为测试夹具开承认清单注入口子，落到 CI 就是允许把棘轮关掉的后门。反证 M14/M15 直接改 workflow 正文（把两行挪到早退之后 / 调换两行顺序），各只红**一条**且红在指名的断言上 |
| QM-1 打包 / QM-4 视觉 | N/A | 变更集 10 个文件全部落在 `.github/workflows/`、`scripts/`、`openspec/`、`01-docs/`、`CHANGELOG.md`、`.quality-gates.md`、`.gitignore`；**未触** `apps/desktop/electron/` 与 `packages/rpa-engine/`，且不含任何 `.vue/.css/.less/.scss` 或基线 PNG ⇒ 打包验证与像素回归对本次运行面无对象可跑。`classify-docs-only` 必须在**提交后**取证（提交前 `HEAD==base` ⇒ 空 diff ⇒ 假 `docs-only=false files=0`，那是取证顺序问题不是判定失灵）；本 PR 含 workflow + scripts ⇒ 预期恒为 `docs-only=false`（混合 PR），重型 job 不短路 |
| QM-6 CCG 双模型外部评审 | PASS（替代通道） | 本机 CC Switch 网关实测不通：`Test-NetConnection 127.0.0.1 -Port 15721 -InformationLevel Quiet` = **False**，而 `~/.claude/.ccg/config.toml` 的 `[routing.frontend].primary = claude` / `[routing.backend].primary = codex` 两路都经该网关 ⇒ 按既有降级口径走 `opencode run --agent plan`（只读档）双轴实回：**后端 `opencode/nemotron-3-ultra-free`** 0 Critical / 0 Warning / 5 Info + 3 建议；**前端 `opencode/big-pickle`** 1 Critical + 3 Warning + 4 Info，共 8 条。两路各带一次**工作树完整性前后对账**（子进程返回前后 `git status --porcelain` 全量哈希相同）⇒ **在该运行自身窗口内**评审没有写盘（适用范围见「本轮我自己制造并当场抓到的七个问题」第 7 条：另一次被超时杀掉的实际运行在 CLI 退出后仍落了 3 个 0 字节文件——`opencode run` 连的是共享后台服务，不受 CLI 生命周期约束）。逐条处置见下节 |
| 远程同步 | PASS | 已 squash 合入 main：`git log origin/main --grep='(#3597)$' --format=%H|%cI` ⇒ `3908679a1d4913ceec0d9e176f3dc3d3ec797049` / `2026-10-14T23:43:09+08:00`；`git ls-remote --heads origin conflict-marker-sweep` 返回 0 行证远端分支已删。回填与销账发生在**同一次提交**内：删除 `scripts/gate-record-debt-ledger.json` 本条登记项与本记录 frontmatter 三个 `sync_*` 字段 |

### QM-6 发现处置（8 条，逐条先重放再决定）

口径：**评审的句子只当"主张"，不当事实**；每条先在当前 HEAD 上重放一遍，成立才处置。两轴给的行号一律自己重取（后端轴写 `check-no-conflict-markers.js:28` 处实际是 `const fs = require('node:fs')`，它的坐标取自 diff 而非文件——内容主张仍成立，坐标不可用）。

| # | 主张 | 我的重放证据 | 处置 |
|---|------|-------------|------|
| C1 Critical | 新记录缺 `\| 远程同步 \|` 行 ⇒ `check-gate-record-debt.js` 在调用我这两行**之前**就红 ⇒ 本 PR 新增的判据在自己这个 PR 上一次都没跑 | `node scripts/check-gate-record-debt.js` rc=1，且全场只点名 `conflict-marker-sweep.md —— 整块缺 远程同步 行` | **采纳**。这是「门禁接线五问」第 2 问当场失败：**判据是对的、我的记录是错的**（我漏抄了模板表格的后半段）。补齐 11 行后同一命令 rc=0 |
| W1 Warning | 注释/记录/CHANGELOG 里「main push 那一档同样覆盖」宽于判据：push 侧有 `paths-ignore` | 读 `quality-gate.yml:6-20` 实测 14 条忽略项含 `openspec/**`、`01-docs/**`、`*.md`、`.gitignore` —— **正是这 6 篇标记文件所在路径** | **采纳，但结论比评审窄**：直推 main 被 GH011 拒、ruleset `main-ci-gate` 的 `bypass_actors` 现网回读 `[]`（`gh api repos/…/rulesets/23749994` 当场取，不用缓存 ref）⇒ main 的唯一写入通路是 PR 而 PR 触发无 paths 过滤，所以**现状不是漏洞，是措辞失真**。三处措辞改为带前提的表述，前提失效条件写进「遗留」。评审建议的 `schedule:` 档**不在本 PR 做**：新增 workflow 属"改谁来守门"的面，且它兜的是"旁路被打开"这个尚不存在的前提 |
| W2 Warning | 承认清单是**文件级**的 ⇒ 已登记文件里标记变多是假绿 | 读码确认 `violations` 与 `stale` 两条判据都不看计数；夹具实测 `bad.md` 4 行标记 / 登记 2 行时**旧实现 rc=0** | **采纳**。登记形态升级为 `{ markers, reason }`，`实际 > 基线` 即红（M10 反证）；`实际 < 基线` 在 CLI **不拦**（收敛方向不该被挡，否则逼人"要么不动要么全清"），但**真实仓库自证**要求内置基线与实况 `deepStrictEqual` —— 抬高基线交差会当场红。两侧不对称是有意的，注释里写明 |
| W3 Warning | 接线锁只比 `static-gates:` 位置，验不出"在非 PR 早退之前" | 读旧断言确为 `i < wf.indexOf('\n  static-gates:')`，而早退块在两处之间 | **采纳**。新增 `iExit` 存在性断言（早退块哪天消失必须报警而不是静默通过）+ `iTest < iExit && iRun < iExit` + 两行相邻且顺序固定；M14（挪到早退之后）、M15（调换顺序）各只红一条 |
| I1 Info | 「清单只能缩小」只锁了收敛方向，扩张无基线锁 | 确认加第 5 条登记 ⇒ `offending == known` 仍成立 ⇒ 全绿 | **采纳**：`Object.keys(KNOWN).length <= 4` 上界断言，新增登记必须连这条一起改并说明为什么不能机械修 |
| I2 Info | 硬编 `hits >= 8` 会在正当销账时假红 | 确认：解掉一篇并删登记 ⇒ 8→6 ⇒ 红且文案把人往"扫描域退化"指 | **采纳**：下界从清单派生（每条登记至少 1 行标记） |
| I3 Info | 注释写"不计违规**但要出声**"、代码 `if (st && !st.isFile()) continue` 静默；且注释把稀疏检出归错支 | 读 `:78-79` 确认前半；后半也成立——稀疏检出磁盘上根本没有该文件，`lstat` 失败 ⇒ 走的是 `unreadable` 那一支 | **采纳**：`skipped` 计数并打进 `--dry-run` 与 OK 文案，注释按实测重写（"稀疏检出不在这一支"）。为它专门造了一条**不依赖宿主特权**的索引级夹具（见 QM-5 ④ 的 ⑤），否则这条锁只能靠本机建软链，会漂成"只有某些机器跑" |
| I4 Info | 裸 `--root`（漏值）⇒ `path.resolve(true)` 抛在未包 try 的地方 ⇒ 以 **rc 1**（"发现违规"档）收场 | 实测 `rc=1` 且输出首行是 `node:internal/errors:542` | **采纳**：参数装载阶段整体纳入 fail-closed ⇒ rc 2，并加一条"不得把裸栈抛给读者"的断言。**同时删掉我顺手写的两道 `typeof` 显式守卫**——它和 try 是同一件事的两道兜底，留着谁也不可证伪（本轮已在同一份文件上为 `\r` 踩过一次；M12 只红 1 条就是"单一依赖"的证据） |

### 反证（15 条，MISSED=0、UNATTRIBUTED=0，还原逐字节相同）

`M1` 把合法 setext 等号一并禁掉 → 红「负控：七个等号…」；`M2` 判据收窄到只认一种标签 → 红「行首必须被抓出点名」；
`M3` 摘掉唯一的行尾处理 → 红「无标签裸标记行在 CRLF 下必须命中」；`M4` 打印不再回环 UTF-8 → 红「中文标记行必须按 UTF-8 打印」；
`M5` `stale` 恒空（棘轮只可扩张）→ 红「承认清单只能缩小」；`M6` 无视承认清单 → 红「真实仓库自证」；
`M7` 自身故障档位改判 0 → **必须 4 条一起红**（2 档是单点出口，少于 4 反而说明某条没真测 2 档）；`M8` 摘掉 `unreadable > 0` 这一支 → 只红「受管却读不到」（与 M7 分属两维）；
`M9` 从 workflow 摘掉调用行 → 红「接线锁」；`M10` `grew` 恒空 → 红「双向棘轮：标记数超基线」；
`M11` 摘掉承认清单形态校验 → 红「形态不合法 ⇒ rc 2」；`M12` 参数阶段退回 `throw` → 红「CLI 用法错误 ⇒ rc 2」；
`M13` `skipped` 不再计数 → 红「非普通文件必须出声」；`M14` 两行挪到非 PR 早退之后 → 红「接线锁」的**该条断言**；`M15` 调换两行顺序 → 红「相邻且锁在前」。

收尾行：`MUTATIONS=15 MISSED=0 UNATTRIBUTED=0 RESTORED_BYTES_EQUAL=true`，基线未变异与还原后各 20 passed。

### 本轮我自己制造并当场抓到的七个问题（不抹平）

1. **两道冗余机制让锁一度不可证伪**：判据里 `\r` 同时存在于「字符类 `[ \t\r]`」和「检测前 `replace(/\r$/,'')`」两处，于是
   `M3`（摘掉任一单一处）**连续两轮 MISSED、0 红** —— 不是用例太弱，是**变异对象本身不承载行为**。正解不是加更多用例，而是
   **删掉一道机制**让另一道成为唯一依赖。**同一类错误本轮又犯了一次**：为 I4 写完 try 收口之后，我又顺手加了两条
   `typeof` 显式守卫——两者兜的是同一个故障面，留着 M12 就验不出 try 那一维。已删守卫（`M12` 现在只红 1 条即为证据）。
2. **驱动锚点会随被修文件一起漂移**：我把源码那行改掉之后，`M1`/`M2` 的 `from` 锚点 `hits=0` ⇒ 报 `M_ISHIT` 而不是
   假报 CAUGHT。这是驱动里"锚点必须恰好命中 1 次"这条预检第一次真正发挥作用；它也说明**变异电池必须与被测源码同轮维护**。
3. **我自己的测试断言写错三处**（不是实现错）：夹具首行是表格行、标记在第 2 行，我却断言 `:3`；负控夹具被内置承认清单
   硬编码污染（任何非本仓的域都会因"4 条登记项都不在这个仓库里"恒红，于是"干净夹具判 0"与两条负控同时失去意义），修法是
   给 `collect()`/CLI 开 `--ack-file` 注入缝并**为这个口子单独建反向锁**；以及新写的"低于基线"负控夹具我只放了 1 行标记却
   断言 `3→2` —— 判据对、期望错，当场按判据的实际输出改夹具而不是改判据。
4. **`opencode` 两路第一次报 `RC=1 / STDOUT=0 / STDERR=0` 是驱动器的假结论**，不是"评审零结论"：`opencode` 在 Windows 上是
   `.cmd` 垫片，`execFileSync` 不带 `shell` 直接 ENOENT，而我的 catch 把 `e.status` 缺省成 1、又把 `e.message` 丢了 ——
   一个**自己坏掉的探针长得就像"对方没话说"**。同时 33084 字符的 prompt 超 CreateProcess 32767 上限。修法：`shell:true` +
   `--file` 附件传任务书与 diff，argv 只留一句短指令；并先跑一条 `PROBE_OK` **正控**（30.8s 返回）证明通道可用，再谈数据。
5. **变异电池 v2 报的 `WRONG_CAUSE=4` 本身就是假归因**：`node:test` 把每条失败**打印两遍**（摘要 + 失败清单），未去重就把
   "1 条红"数成 2 条；而"连带红 ≤ N 条"这种**预算数**判据允许我把任意 collateral 事后说成预期。v3 改成①红名单去重、
   ②每条变异预先显式列出被允许的用例名前缀（`allowOthers`），超出清单即 `UNATTRIBUTED`。清单是用采集模式
   （`marker-mutate.collect.js`）**先跑一遍拿全量红名单再填**的，填的时候逐条回答"它为什么该跟着红"——
   不是把观测值抄进断言当免检牌。

6. **我把一个 JS 字符串里的 `\r` 当成了要写的字面文本，于是整份 `CHANGELOG.md` 的 blob 被改写成 CRLF**：
   补写 bullet 时正文里有一句「与本轮第一版 `\r` 双机制是同一个错」，而那句话本身是写在 **JS 字符串字面量**里的——
   那里的 `\r` 就是回车字节，不是"反斜杠加 r"两个字符。后果不是"多一个字符"这么轻：文件因此出现**孤立 CR**
   （`CR=21259` 而 `LF=21258`），git 据此判定 CRLF 转换**不安全**并**跳过归一**（`git ls-files --eol` 从 `i/lf w/crlf` 变成 `i/-text w/-text`），
   于是 `git add` 把**整份 21258 行**以 CRLF 存进 blob——`git diff --cached --numstat` 报 **21258/21247**，而 `-w` 口径只报 **11/0**。
   **这正是本记录反复强调的那条双向判据第一次真的把一次提交拦下来**：strict 与 `-w` 两个数不等 ⇒ 差额纯属行尾 ⇒ 不许提交。
   修法：定位那一个孤立 CR 的下标，换成两字符 `\r`，并断言"把它换回去必须与原串逐字相同"（改动面恰好一个字符）；
   改后 `CR==LF==21258`、`LONE_CR=0`、`ls-files --eol` 回到 `i/lf w/crlf`、numstat 回到 `11 0`。
   **口径扩展**：凡"把代码片段/转义序列写进中文正文"的脚本，载荷里的反斜杠一律先问"这一层会不会解释它"。
   这与 bash 把反引号当命令替换（同族第一落点）是同一个机制在不同层——**写文件的字符串本身就是一层解释器**；
   本次连"记录这条纪律的脚本"自己也差点再犯，所以本脚本改用 `String.fromCharCode(92)` 取反斜杠，并在收尾断言写出内容 `CR==0`。

7. **被我超时杀掉的那次 opencode 运行，在 CLI 退出之后仍然落了三个 0 字节文件**（名字是 `U+202A` 双向控制符 + `关联` / `归属` / `立项日期:` 这类表格列名）：
   `opencode run` 默认连**共享后台服务**（`--standalone` 才用私有服务），所以"我杀了 CLI"不等于"会话停了"。
   它们的 mtime 落在我杀掉的那次运行窗口内，而两路评审驱动器各自报告的 `WORKTREE_UNCHANGED=true` **并没能预示这件事**——
   那个对账只覆盖"驱动器亲眼看着的那段窗口"（before 快照 → 子进程返回 → after 快照）。
   处置：`git rm --cached` 解除暂存 ⇒ 变成未跟踪 ⇒ 交 `scripts/safe-delete.js`（先 `--dry-run` 看四道闸，实删走回收站可恢复），删后 `still_on_disk=0`。
   **因此本文 QM-6 那一行的"评审未改在制品"必须按适用范围读**：它证明的是"两路运行在其自身窗口内没有写"，
   不是"整个评审期间工作树从未被写过"。引用它的人（包括下一个我）不得把它读成后者。

### 现场读数（可一句话重取）

`node scripts/check-no-conflict-markers.js --dry-run` ⇒ `domain=9048 files_with_markers=4 marker_lines=8 violations=0 acknowledged=4 stale=0 grew=0 skipped=0`。
承认基线逐条：`batch-b-debounce-watch.md:2`、`fix-learnings-encoding-damage.md:2`、`fix-xhs-api-chain-contract.md:2`、`retire-changelog-dedup-auth.md:2`（与 `collect().byFile` 实测数逐条相等）。
本轮修复前（`96074c90d` 起点）同一条命令为 `files_with_markers=6 marker_lines=12 violations=2`。
（这些数是**活数**，随仓库变化；写进记录只作当轮证据，不得被下游当现状引用。）

### 遗留（不假装已闭合）

- 4 篇 `openspec/records/*.md` 的标记**未被清除**，只在承认清单里带理由登记：它们的两侧含互相矛盾的状态格（`QM-6 已执行` vs `待跑`）、
  跨行焊接的正文、以及在 hunk 内外各出现一次的小节 —— 删标记不等于修好，需要该记录的属主会话或人工逐篇裁决。
  基线计数只保证"不再恶化"，**不核对两侧内容是否仍然矛盾**，所以这笔欠账会一直红着直到有人真的去解。
- **「main push 同样覆盖」的前提是「main 只能经 PR 进入」**（`bypass_actors = []` 为当次实测）。若将来给 ruleset
  `main-ci-gate` 加了旁路主体，或有人恢复 classic protection 的 admin bypass，push 侧的 `paths-ignore` 会让这条判据
  对纯文档提交整个不触发 ⇒ 届时要补 `schedule:` 档，或把这两个判据单挂一条不带 paths 过滤的 workflow。
- 同一句过度措辞在**他人会话的记录里也存在**（`.quality-gates.md` 的账本门禁一节、`CHANGELOG.md` 的 #2718 那条）。
  按「不代其他会话改写其记录」的纪律我没有改它们，只改本 PR 自己的三处；如需收敛，应由那条记录的属主或一次专门的清扫。**同一形态还有第三个落点就在本判据上方 6 行**：`quality-gate.yml:64` 那句「放在非 PR 早退之前，所以 main push 那一档同样覆盖」是 #2718 落地时写的账本门禁注释，与我在 `:70-73` 写的带前提表述**在同一步骤体内相邻并存**——读那段 run 的人会先看到旧的绝对句。本 PR 未动它（不属本次改写面，且改动 workflow 正文会把回填拖进重型 CI），在此登记以免被读成"两处矛盾里有一处是新的"
- 判据只认**行首**。若哪天有人把标记缩进两格（编辑器自动缩进的常见后果），它会漏 —— 我没有把它写宽，因为
  「行首 + 后接空白/行尾」是唯一不会命中合法 Markdown 的形态；扩宽需要先构造新的负控。
- `^={7}$` 完全不管，是**刻意的**：本仓有正当用法（实测同一份 PRD-XHS 里 5 处是章节分隔）。代价是"孤立的 `=======` 残骸"
  不会被单独报警 —— 它只在同时残留 `<<<<<<<`/`>>>>>>>` 时才被抓到。此边界已写进判据注释。
- 驱动器与采集器都在仓库外的 `.tools/tmp/`（一次性巡检工具，不是被 CI 消费的资产）。若要把 15 条反证变成可重放的资产，
  就得把驱动落进 `scripts/` 并接一条门禁——那是另一件事，本轮如实记为欠账而不是假装已建立。

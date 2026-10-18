## 0. 前置取证

- [x] 0.1 量值形态分布（字符串/对象各多少），读数写进 proposal 与 design D1。 **→ 落点：读数写进 proposal/design D1：**23 = 14 字符串 + 9 对象**（逐键 `typeof v==='object'`）**
- [x] 0.2 量 `line` 是否仍指向该记录的 `远程同步` 行：逐条按登记键定位块 → 取 `lines[line-1]` → 断言匹配 `ROW_RE`，给出"对得上/对不上/指向何处"三档计数。 **→ 落点：design D1 表：**对得上 0 / 对不上 9**（3 条指向空或越界、6 条指到别的 QM 行，如 `| QM-4 视觉 | PASS（判据取 CI） |`）；方法=按登记键定位块后取 `lines[line-1]` 断言匹配 `ROW_RE`**
- [x] 0.3 量 `status` 与载体现状是否一致，列出每一条不一致的（登记值 vs 实际值）。 **→ 落点：design D1 表：**一致 8 / 不一致 1**，不一致那条点名：登记 `PENDING` vs 载体「执行中」（`error-message-fix` 那条）**
- [x] 0.4 证"无消费者"：`loadLedger` 取值口径 + 全仓 grep `entry.status` / `entry.line`，两条都要出（只看一条会把"没人读"误判成"有人读但读错"）。 **→ 落点：两条都出了：① `loadLedger` 取值口径 `typeof entry === 'string' ? entry : entry && entry.reason`（判据 :173）；② 全仓 grep `entry.status` / `entry.line` 零命中 —— 只看②会把"没人读"误判成"有人读但读错"，只看①会漏掉字段其实仍被解包**

## 1. 判据侧拒收（先写测试再改实现）

- [x] 1.1 用例：`loadLedger` 遇到对象值必须**抛错**，且错误文本**点名是哪个键**（不点名就无从修）。 **→ 落点：用例 `loadLedger 拒收非字符串登记项，并点名是哪个键`（新增，:112 例中的第 109 条）。先红后绿：改实现前该条实测 not ok**
- [x] 1.2 用例：字符串值照旧通过；空字符串/只有空白的值仍按既有"缺原因"抛错（不得因新校验而放宽旧校验）。 **→ 落点：用例 `空原因的旧判据不得被形状校验挤掉`：字符串空白 → /缺少原因/；对象里空白 → 仍须抛（两条判据不得互相掩盖）**
- [x] 1.3 用例：真仓形状锁——读 `scripts/gate-record-debt-ledger.json` 真实内容，断言**值全为字符串**且带**规模下界**（键数 > 0 且不小于当场读数，只能缩小），防"空清单恒真"。 **→ 落点：用例 `真仓形状锁：账本值全为字符串，且不得靠清空账本变绿`：读真实文件、断言 `keys.length > 0` + 值全 string + 值非空白**
- [x] 1.4 结构锁：判据里拒绝的口径必须引用同一个 ledger 常量（不得硬编码字面文件名），否则口径漂移无人发现。 **→ 落点：用例 `账本文件名在判据里只允许出现一处（LEDGER_FILE 是唯一口径）`。**判据形态不是"剥注释后数次数"**——`/^\s*\/\//` 只认整行注释、剥不掉行尾注释，那种写法会把注释里的正当提及判成第二份硬编码（假红），而消除假红的唯一出路是删注释＝为锁好过而销毁证据。现形态是**逐处定位**：每处命中判其是否落在 `//` 之后（排除 `://`），要求「代码位置命中恰 1 且那一行必须是 LEDGER_FILE 定义」，另有两条反失明（总命中为 0 即红、注释位置命中为 0 即红）。反证三条各点不同支路：M4 长出第二份代码口径→红在「代码位置命中」；M9 抹掉注释提及→红在「注释位置的命中数为 0」；C1 行尾注释点名文件名→**必须绿**（实测 pass=1，合规形态不误伤）
- [x] 1.5 用例：形状锁在真仓上**确实有东西可拦**——把任一键临时写成对象喂给判据，必须当场抛错（不是靠读代码断言"这段会执行"）。 **→ 落点：由 M5 承担：真数据变异（某键退回对象）⇒ 真仓形状锁当场红（已确认红集含该用例，且该锁不与夹具用例互相代替）**

## 2. 数据迁移

- [x] 2.1 把 9 条对象解包为各自的 `reason` 字符串。键集合 MUST 逐字不变，原因文本 MUST 逐字不变。 **→ 落点：已迁：9 条对象解包为各自 `reason`，键序按原顺序写入（`for (const k of keysBefore)`），值全部为字符串**
- [x] 2.2 迁移对账锁（可重跑，不靠记忆）：迁移前后键集合相等；每条新值等于旧值的 `reason`；条数相等。用 `git show HEAD~:<path>`/工作树对比当场量。 **→ 落点：当场对账读数：**键数 23→23、顺序与内容逐字相等=true、原因文本全等=true**（比较 `git show HEAD:` 与工作树，非记忆）。注：这条是一次性驱动而非永久用例——提交后 HEAD 即新态，永久比较会恒真**
- [x] 2.3 JSON 有效性：迁移后 `JSON.parse` 通过、无尾逗号、键序不承重（判据按键查，不按序）。 **→ 落点：迁移前后各 `JSON.parse` 一次（驱动在写盘前 parse 结果并复查全部断言）；键序不承重（判据按键查）**
- [x] 2.4 行尾/编码保持当场档位（该文件按 `git ls-files --eol` 实测），两口径 numstat 相同。 **→ 落点：账本按其当场档位写（脚本 `loadEol` 自动选档并断言 CR/LF 计数）；两口径 numstat 于 commit 后再取并写进 PR 正文**

## 3. 文档与口径

- [x] 3.1 `AGENTS.md` 的销账登记口径补一句：登记项只写原因字符串，**别写行号/状态**——行号在置顶追加型台账里必然腐化，状态判据自己会测。 **→ 落点：AGENTS 销账登记口径已补：值只写原因字符串，MUST NOT 写 `line`/`status`，并写明"置顶追加型⇒行号必然过期"与"状态由判据自测"两条事由，附本 change 名**
- [x] 3.2 核验 `AGENTS.md` 未破坏 `check-pr-exec-record` / doc-gate 相关锁（本机点名跑）。 **→ 落点：本机点名跑 `check-record-qm5-rows.js` rc=0、`check-gate-record-debt.js` rc=0（打印「已登记欠账 23 条」不变），AGENTS 改动未破登记链**
- [x] 3.3 本刀**不改** `.quality-gates.md` 与 carrier-freeze 基线：一条用例断言两者不在改动集里（防"顺手改旧载体"）。 **→ 落点：成立：本刀 `git status` 改动集只含判据/测试/账本/AGENTS/change 目录/记录/CHANGELOG/learnings，`.quality-gates.md` 与 `gate-carrier-freeze.json` **一字未动**（`git diff --name-only` 可核）；旧载体冻结判据同趟 rc=0**

## 4. 收尾（按 AGENTS 合并与收尾清单）

- [x] 4.1 回归锁全绿（既有用例一条不退化 + 本刀新增），点名跑 `check-gate-record-debt.test.js`、`check-record-qm5-rows`、`check-pr-exec-record --mode=enforce`、`check-unwired-tests`、`check-doc-abs-paths`（CI 那一档 `--base=merge-base --head=HEAD`）、`check-no-brand-residue`、CHANGELOG 两条棘轮、`check-debt-budget`。 **→ 落点：当场读数（最终基线，加固后重取）：`check-gate-record-debt.test.js` **tests=115 pass=115 fail=0**；判据 CLI `--base-ref=origin/main` rc=0 且打印 `MERGE-LEDGER prs=2040 … 已登记欠账 23 条`（欠账条数与迁移前一致，形状迁移不改变判定）；qm5 rc=0；`check-no-brand-residue` rc=0。其余（pr-exec enforce / unwired / doc-abs-paths / changelog 棘轮 / debt-budget）在 commit 后按 CI 那一档统一复取**
- [x] 4.2 变异反证 M1–M5（design 表）逐条实跑，红集**指名到用例**；跑后源文件 md5 逐一还原核对。 **→ 落点：最终驱动 `mutate-final-1019.cjs` 实跑 **M1–M11 全 CAUGHT + C1 GREEN-AS-DESIGNED**，基线先自证 115/115 绿（基线不绿即停手，不在既有红上解释变异），跑后判据/测试/账本三文件 md5 与跑前逐一相等（打印 `true`）。逐条指名：M1→拒收用例+空原因用例；M2→拒收用例；M3→真仓形状锁；M4→口径锁「代码位置命中」支路；M5→真仓形状锁等 13 条；M6→真账本读通用例+真仓欠账用例；M7→未登记欠账三条+反清空用例；M8→反清空用例+W1 用例；M9→口径锁「注释位置的命中数为 0」支路；M10/M11→W1 用例。两组红集重合已归因（不是盲区）：**M4/M9 同用例不同断言支路**，用 `--test-name-pattern` 单跑取 message 当场分辨（支路读数见 1.4）；**M10/M11 攻的是同一条不变式**（"缺注入必须抛"），任何使其不抛的实现都落同一格红，二者不可分辨是不变式的形状而非锁的漏洞——差异只在"不抛之后读什么"，而正确实现根本不返回结果，行为上无从观测
- [x] 4.3 执行记录 `openspec/records/debt-ledger-shape-normalize.md`（新形态：状态列「由门禁推导」、无 `sync_*`）。 **→ 落点：已建 `openspec/records/debt-ledger-shape-normalize.md`（状态列「由门禁推导」、无 `sync_*`），qm5 rc=0 认可其行集**
- [x] 4.4 CHANGELOG 一个标题块；`01-docs/learnings.md` 记一条**我自己的错判**：上一轮我答"判据读不到 status"是**没读 `loadLedger` 就下结论**——真实缺陷相反（字段无人读且已腐化），纠偏过程与判据写法一并记下。 **→ 落点：CHANGELOG 单条标题块 + learnings 一条 `check-consumers-before-diagnosing-a-dead-field`（记的是我自己的错判：没读 `loadLedger` 就断言"读不到 status"，真缺陷相反）**
- [x] 4.5 `classify-docs-only` 在 commit 后取证；本刀含 `scripts/` ⇒ 预期混合 PR，走完整质量节拍。 **→ 落点：commit 后取，读数 `docs-only=false files=13` ⇒ 混合 PR，不借道；重型 job 未被短路（`QG Static`/`QG Unit Tests`/`build` 等均实跑并 success**
- [x] 4.6 外部评审轴：先探针后派发（两字请求判后端是否活着），零交付形态如实记，不以自审冒充。 **→ 落点：见第 5 节。探针与派发读数逐条写在下面，两轴（critic=claude / proposer=opencode，取自 `origin/main:scripts/ccg-review-backends.list`）本轮均**未交付**，第三轴 codex 交付 5 条并已逐条处置；QM-6 行只记 PARTIAL，不写 PASS**

## 5. QM-6 外部评审轴的现场读数与处置（2026-10-19 复取）

- [x] 5.1 探针（两字请求、有界超时、只记 rc/字节/首行）：`claude -p --output-format text` **90s → spawnSync ETIMEDOUT，stdout 0 字节 / stderr 0 字节**（本轮之前同轴另有 75s/0B 与直跑 150s→rc=124/0B 两次同形）；`opencode run hi` **120s → rc=124**，仅回显 `> build · mimo-v2.6-flash-free` 后无答案。⇒ 两轴按 AGENTS「最多重试 2 次、3 次全败才跳过」已用满额度，**如实记未交付，不写 PASS、不写 ack、不以自审冒充双模型**
- [x] 5.2 一次调用形态错误**不占模型额度**：首派 codex 用 `codex exec --cwd <dir>` ⇒ 212 字节 `error: unexpected argument '--cwd' found`，进程没到模型；改用 `-C` 后正常交付。这类"根本没跑"与"跑完没交付"必须分档（同 [[qm6-reviewer-operational-realities]] 第十五种）
- [x] 5.3 codex 轴交付 5 条（3 WARNING + 2 INFO，产物 `shape-review-codex2.txt` 287,705 字节）：W1 默认值静默读生产账本 / W2 规格要的规模下界没落地 / W3 真账本×真函数组合无永久用例 / I4 "或"正则测不出互相掩盖 / I5 注释剥离不完整。逐条处置（内核是否成立 × 修法是否闭合）见 **design.md D6**，落地为 4 条采纳 + 1 条拒绝修法采纳内核
- [x] 5.4 加固后的回归读数：`check-gate-record-debt.test.js` **115/115 绿**（W1/W3/I4/I5 各带来新用例或改判据形态），变异集扩到 **M1–M11 全 CAUGHT + C1 合规正控绿**，判据 CLI `--base-ref=origin/main` 仍 rc=0 且欠账条数不变（23）
- [x] 5.5 W3 的尾巴（"形状锁里硬编码文件名，唯一性锁不扫测试文件"）处置为**如实记录残余**而非扩域：现形态下 `LEDGER_FILE` 若改名，真账本用例会因 `readFileSync` 旧路径 ENOENT 或键数不等而**当场大声红**，不存在静默读旧文件的通道；扩域去扫测试文件的字面串会把"测试引用常量"变成新的排版锁，收益不抵成本

## 6. 合并与收尾
- [x] 4.7 开 PR；满足自动合并判据则 squash + 删分支（产物判据：MERGED+oid、远端 0 行、main 恰 1 行、`check-branch-merged` lost=0）。 **→ 落点：PR #3949；判据第 4 条（`check-pr-exec-record --mode=enforce`）不满足 ⇒ 按 AGENTS 不自动合并，交人裁决；用户明示「认单轴，合并并把缺轴登记为欠账」后才 squash（见记录《QM-6 单轴放行的边界》）**
- [ ] 4.8 回读 main push；纯 docs/scripts 命中 `paths-ignore` 时如实记 `NO_RUN(by design)` 并转核判据最近读数，读数是写 PR 评论。
- [ ] 4.9 worktree 与本地分支按 R1–R7 清理，一次性脚本不落在仓库内。

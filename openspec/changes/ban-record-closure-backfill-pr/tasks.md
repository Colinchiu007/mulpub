# 任务拆分

依赖：片 0 → 片 1 → 片 2 → 片 3。片 2 完成前不得声称"禁令有执行体"。

## 0. 前置：隔离与判据可达性 —— 已完成

- [x] 0.1 worktree 就绪：`scripts/session-init.sh ban-record-closure-backfill-pr` ⇒ `mp-ban-record-closure-backfill-pr` / 裸分支同名；依赖三件套实跑（`pnpm install --frozen-lockfile` + `ensure-electron` v43.7.7 + `verify-worktree-deps` 11 个消费方解析通过）。共享根仍停在 `main`。
- [x] 0.2 并发串行确认：首次调用被 `ccg-worktree-bootstrap.lock` 拒绝（另一会话 PID 41252 的 `start-mp-task` 在跑，锁生成于 40 秒前）。**没有删锁、没有绕过**，等到锁释放后重试成功。
- [x] 0.3 违例事实取证：禁令 merge `b49510794`（03:43 +08）之后 4 笔回填 PR 的 merge 时刻逐笔核对（#3889 03:49 / #3891 04:18 / #3890 04:20 / #3884 09:15）。
- [x] 0.4 判据可行性与误报面实测：80 个 PR 样本，命中 36、非回填标题命中 0；并实测**窄判据（只动那一行）漏 2/4**，据此选定行级状态词跃迁形态。

## 1. 红测：判据形态（先写测试，测试即 D2/D3/D4 的契约）

- [ ] 1.1 未闭合 → 闭合 ⇒ 判红并点名该文件。**这是本 change 的主用例**。
- [ ] 1.2 迁移方向不红：改成 `由门禁推导` ⇒ 绿。判据 MUST NOT 拦住新机制要求的那个动作。
- [ ] 1.3 保持不动不红：diff 未触碰该行 ⇒ 不参与判定；另加一条"存量里有手写 PASS 但本 PR 没碰它 ⇒ 不红"。
- [ ] 1.4 反向跃迁不判：闭合 → 未闭合 MUST NOT 红（不是预写证据，且在派生模型下无判定力）。
- [ ] 1.5 旧载体不在扫描域：只改 `.quality-gates.md` 的历史行 + 删 ledger 键 ⇒ 不红。
- [ ] 1.6 混合 PR 点名具体篇目：同一 PR 既关旧行又新写记录 ⇒ 红集只含后者且文案给出篇名（可拆性）。
- [ ] 1.7 **配对在同一文件内**，不要求行号对齐：构造"那一行因上下文移动而落在不同行号"的夹具，断言仍红。
- [ ] 1.8 ~~`--unified=0` 的行为锁~~ **撤销**：对照实验实测「默认上下文」与「`--unified=0`」的红集与文件集逐字相同 ⇒ 该断言不可分辨，写成锁就是装饰。`--unified=0` 保留为工程选择，不设用例不设变异（design M4 同步撤销）。
- [ ] 1.9 **域正确性锁**（不是红集锁）：base 之后另有他人合入把第三篇改成闭合词时，`buildClosureDiff` 报告的**文件集** MUST 只含本 PR 触碰的那一篇。实测对照：两点式文件集 2 / 三点式 1 ⇒ **只有断言文件集才能区分两种写法**；若用例只断言红集，两点式与三点式同绿，这条锁就不成立（design D6 里原先那句"两点式会把别人的改写算进红集"已被本实验否证并改写）。
- [ ] 1.10 词表同源结构锁：新判据 MUST NOT 自带第二份 `/^(PASS|N\/A|✅|已)/`，MUST 引用既有 `CLOSED_RE`/`ROW_RE`/`normalize`。
- [ ] 1.11 扫描域复用 `listRecordFiles`：`diff 文件集 ∩ listRecordFiles 结果`，MUST NOT 由 diff 自己枚举目录、MUST NOT 用递归枚举（`_exempt/` 与 `_TEMPLATE.md` 会被吸进来）。
- [ ] 1.12 **重复行锁**（F1，Critical）：同一记录文件内 `| 远程同步 |` 行数 > 1 ⇒ 判红。**必须配双向绕过探针**：先断言"只追加第二行 PASS、首行不动"在**没有这把锁时确实静默通过**（否则这条测试只证明夹具里那几格红，真实绕道仍在），再断言有锁后必红。
- [ ] 1.13 **围栏隔离**（F2，High）：旧侧/新侧各自跟踪 ``` 围栏，围栏内的 `+`/`-` 引用行不参与配对。双向夹具：「正确迁移 + 文档引用示例行」不得误红；关掉围栏跟踪后同一夹具必须红（M10）。
- [ ] 1.14 **派生标记词边界**（F3）：`已由门禁推导` MUST 按派生标记处理（实测它命中 `CLOSED_RE` 的 `已` 前缀而不命中现 `DERIVED_MARKER_RE`）；反向负控：`已由人工回填完成` 之类 MUST NOT 被当成派生标记（放宽过头会把真手写放过去）。
- [ ] 1.15 **删除/改名档**（F4）：非 `_` 前缀记录文件被删 ⇒ 红；改名（删+增）⇒ 红；`_exempt/` 与 `_` 前缀删除 ⇒ 不红（负控样本取 main 上那 10 笔真实删除的形态，实测全部在 `_exempt/`）。
- [ ] 1.16 **bullet 侧同判**（F5）：只把 `- 保留门禁：… | 远程同步 PENDING` 改成 `PASS` 而不动表格行 ⇒ 红；MUST 复用既有 `CLOSED_DECL_RE`/`UNCLOSED_DECL_RE`。反向负控：两形态都未闭合的在飞记录不得红。
- [ ] 1.17 **取源位置锁**（D10）：`git diff` 只能存在于 `scripts/lib/pr-record-diff.js`。判据文件内出现 `execFileSync('git'` 或第二份 diff 解析即红——**既有两条锁不得为本次改动放宽**，放宽等于拆门。

## 2. 红测：不可用三档与阻断出口

- [ ] 2.1 `baseRef`/`headRef` 不可解析 ⇒ 打印 `HAND-CLOSURE-UNPROVEN(reason=…)`，本机不拦。
- [ ] 2.2 `git diff` 失败 ⇒ 同上，且原因可区分（两种不可得不得共用一个读数）。
- [ ] 2.3 diff 为空但文件集非空 ⇒ 未证实（不得读成"没有回填"）。
- [ ] 2.4 CI 档不可用 ⇒ 非零退出并点名"这条锁这一趟没测到"；另断言本机档不套用同一 rc。
- [ ] 2.5 **打印且阻断**：`hasBlocking` MUST 因红项为真。动因是本仓同型事故（Gate 7 长期"捕获退出码但不参与判定"⇒ 红了约一周无人认领）。
- [ ] 2.6 真仓下界断言：样本命中数写下界（当前实测 80 PR / 36 命中）且**只能缩小**；这条同时是"锁确实有东西可拦"的现场证据。

## 3. 实现 + 接线

- [ ] 3.0 **取源独立成模块**：`scripts/lib/pr-record-diff.js`（`buildClosureDiff` + `parseClosureTransitions`）。判据文件内 MUST NOT 出现 `execFileSync('git'` 或第二份 diff 解析——基线规格「MUST NOT 在判据内另写 git 解析」已由两条在跑的锁钉住，本次不改宽它们（design D10；opencode 轴在未交付结论的中途命中此冲突）。新模块自带"diff 取源全仓只这一处"的同源锁。
- [ ] 3.1 实现落在 `scripts/check-gate-record-debt.js`：新增 `handClosedRows` / `handClosureUnproven` / 重复行档 三个集合、进 `collect()` 返回面、进 `format()` 首行读数、进 `hasBlocking`。
- [ ] 3.2 新增旗标 `--head-ref`（默认 `HEAD`）并同步 `parseFlags` 白名单与"裸旗标必须抛错"纪律；`--base-ref` 沿用。**白名单里不得出现无人消费的旗标**（上一轮 F2 的同型）。
- [ ] 3.3 **不新增 workflow 步骤**：`check-gate-record-debt.js` 已在 `changes` job、已在非 PR 早退之前，且 checkout 已是 `fetch-depth: 0`（三点式所需 base 可得，design D11——这条是核实出来的，不是假设）。MUST 仍实测两档各取一次打印读数（PR 档与 push 档），不得以"它在同一个步骤里"代替证据。
- [ ] 3.4 红文案给出不需要绕行的正解：不动 / 改派生标记 / 回读证据落 PR 评论。

## 4. 口径同步

- [ ] 4.1 `AGENTS.md`：「不再需要回填动作」那段补执行体说明 + 复现命令（`node scripts/check-gate-record-debt.js`），并写明本条红的授权来源（用户拍板，属"改谁来守门"）。**按章节锚点改，禁止按行号**（该文件是热点载体，本轮实测其「合并后收尾清单」又被别的会话加过条目）。
- [ ] 4.2 `AGENTS.md` 收尾清单第 6 条：补"main push 回读读数落 **PR 评论**，不落仓库文件；仅当 main 真红才开 follow-up PR"。这是 D7 的机制闭合——不给出口的红会被绕。
- [ ] 4.3 `openspec/records/_TEMPLATE.md`：第 28 行那条注释补"改写成闭合词会判红"。**⛔ 第 20–23 行是 `requiredStepsFromTemplate()` 的派生来源，禁止触碰**；改完必须跑 `check-record-qm5-rows.test.js` 全量。
- [ ] 4.4 核验 `_TEMPLATE.md` 不与新判据自相矛盾：模板预填的是 `由门禁推导`，与新规则的鼓励方向一致（1.2 的用例即为模板形态）。

## 5. 验证与交付

- [x] 5.1 变异反证逐条实跑，要求红集**指名到用例**；整片 LOADFAIL、文件名、超时都不算证据。M5（两点式退回）必须红在 1.9 的**文件集**断言上——它在红集断言下不可分辨，这一格本身就是"测不出差异的形态主张不许写成锁"的现场。**实跑读数（终局 15 条：M1、M2、M3、M5–M16；M4 已撤销不补装饰）**：首轮 12 条（M1–M13，去 M4）时 CAUGHT 11 / **PASSED 1 = M2**（把 `collect(...)` 的 `closureDiff` 注入整条摘掉，104 条用例全绿——判据"人工改写"那一档在 CLI 上从此恒不测，而打印面只换成 `prs=n/a`，读起来像"这台机器取不到差量"而非"没人改写"）。**这就是本 change 要消灭的那种装饰性门禁，长在我自己身上**：处置=同 PR 补两条锁（① 接线锁内加 `HAND-CLOSURE 人工改写=\d+ 新增重复行=\d+ 记录被删=\d+` 数值档 + 反向禁 `prs=n/a`；② 端到端用例：真历史 PR #3889 的 squash `99f463121`，`--base-ref=<sha>^1 --head-ref=<sha>` 必须 rc=1、点名 `max-lines-git-domain`、且同趟 `MERGE-LEDGER prs=\d+` 照出数——防止把 rc=1 归因到别处）。复跑 M2 ⇒ CAUGHT，红 2 条指名。**红集互不相同性**：M6/M8 同红在「取源位置锁」（两条打同一格，如实记为同因，不称独立）、M7/M9 同红在「F1 重复行档」（同因）；其余 8 条红集唯一。M5 红 3 条，含 1.9 的**文件集**断言那条 ⇒ 这一格按预期可分辨。跑后三个文件 md5 与跑前逐一相等（判据 / 取源模块 / 测试文件各 RESTORED）。**第二/三跑**：补完 CLI 接线锁与端到端用例后单独复跑 M2 ⇒ CAUGHT（红 2 条指名）；随后按评审 F8 新增 M16（不剥 `-` 前缀＝整档静默漏判，红 7），按 D13 新增 M14（摘 `touched++`，红 2）与 M15（未证实档改打数字，红 1）；最终全量 15 条重跑 **15 CAUGHT / 0 PASSED**，红集互不相同性：M6/M8 同打「取源位置锁」、M7/M9 同打「F1 重复行档」（两条变异打同一格，如实记同因，不称独立），其余 11 条红集唯一；跑后三文件 md5 再次逐一相等。
- [x] 5.2 本机点名跑静态门禁（本机 pre-commit 不覆盖 CI 静态项），当场读数：`check-gate-record-debt.test.js` **108 passed / 0 fail**、`check-record-qm5-rows.test.js` 19/0、`check-pr-exec-record.test.js` 66/0、`workflow-contract.test.js` 43/0、`check-unwired-tests.js` rc=0、`check-step-failfast.js` rc=0、`check-workflow-structure.js` rc=0、`check-doc-abs-paths.js` PASS（受管文件 3960，含本篇新记录）、`check-no-brand-residue.js` PASS（10085 tracked）、`check-debt-budget.js` 五项指标全在基线内（maxFileLines 5098 < 5657、filesOver500 95 < 101）、`check-changelog-growth.js` PASS、`check-changelog-duplicate-entries.js` PASS（条目 506 / 冗余 0）。`openspec validate ban-record-closure-backfill-pr --strict` valid。
- [x] 5.1b 误报主张按**diff 形态**量，不按标题量（评审 F7：以标题为真值是本 change 立论所否证的那种自证）。对 origin/main 最近 120 笔 squash 合并逐笔跑真判据（`.tools/fp-scan.cjs`，一次性工具，收尾删除）：命中 52 笔、形态逐笔归类**全部 `PENDING → PASS`**（54 处跃迁），标题非「回填/远程同步/收口/销账」的命中 0。**正控内建**：已知回填 #3889（`99f463121`）必须「在样本内 ∧ 被 flag」，否则脚本 exit 3 判探针失明——第一版就因 `rev-parse` 尾换行没 trim 而 120 笔全 `ref-unresolvable`、"命中 0"读起来像"零误报"，是这条正控把它揪出来的。样本对 F2/F3/F4 三类形态**零信息**（120 笔里从没出现过），那三格由 1.12–1.17 的注入探针负责，不吃样本。
- [ ] 5.3 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 在 **commit 之后**取证；本 PR 含 `scripts/` 工具脚本 ⇒ 预期 `docs-only=false`（混合 PR），走完整质量节拍。
- [x] 5.4 QM-6 外部评审——**双模型未达成，如实记单轴，且本 PR 不 arm 自动合并**。后端轴 claude 五次零交付：wrapper 侧三次 `claude exited with status 1`（日志被删）、第四次把 prompt 真喂进 stdin 仍 1、第五次由 `sh scripts/deep-review.sh` 现场撞出 `spawnSync codeagent-wrapper.exe ETIMEDOUT`（产物 `mode=dual / status=error / findings=0`，脚本 rc=2）。归因走直连探针：`printf … | claude -p --output-format text` 本机 150s 不返回（rc=124、stdout 0 字节）⇒ 定性为该 CLI 此刻对本机不可用；**第一版探针写成 `claude … | head` 后读 `$?`，拿到的是 head 的 0**，差点把"没响应"读成"可用但没话"，已改成落文件再单独取 rc。前端轴 opencode 四次零交付（两次会话状态快照而非发现清单、两次被 wrapper 的 argv 转发打回 usage 错误）。替代轴 codex 交付 F1–F8 并逐条处置：F1–F5 复核确认已实现且有指名用例；F6 记进 design 残留风险 5/6；F7 把误报主张改为形态级 + 注入探针（见 5.1b）；F8 落 spec 三条解析口径 + 新用例 + 红文案归属核实指引。
- [x] 5.5 执行记录 `openspec/records/ban-record-closure-backfill-pr.md`：新形态（状态列「由门禁推导」，不填 `sync_*`）。落地后当场读数 `MERGE-LEDGER prs=2011 … byDesign=1`（这篇还没进基线 ⇒ byDesign，不红）；`check-pr-exec-record.js --mode=enforce` 与 `check-record-qm5-rows.js` 均 rc=0。
- [x] 5.6 CHANGELOG 收口（单条标题块，置顶插入，逐行保留 CRLF：CR 增量 == 插入行数 == LF 增量三计数自证）+ `01-docs/learnings.md` 四条 lesson：① 绕行面必须先证活再堵（F1 前置事实那条用例的形状）；② **所有用例都自注入依赖 ⇒ "入口有没有真注入"不可表示**（M2 首跑 PASSED 的教训，本仓第二次撞同形态）；③ 常态与失明不得同形、也不可互判故障（`触碰记录=0/N/n/a`）；④ 按形态量的探针必须内建正控 + `codeagent-wrapper` 会嗅探父 argv、prompt 含换行/引号/长度>800 时切 stdin 模式（调用方必须喂 stdin，此前三次"后端不可用"其实是 runner 少喂 stdin 的归因错误）。
- [ ] 5.7 **自指验证**：本 PR 自己的 diff MUST NOT 触碰任何记录的收口行。若触碰就会被自己的新锁判红——那是预期行为，届时如实记录"红了什么、怎么拆开的"，**不得反过来放宽判据**。
- [ ] 5.8 开 PR **已开** #3911（`mergeable=MERGEABLE`，`headRefOid=f7c5ef6f8`，15 文件 / +1373 −8）。**按 AGENTS「禁止自动合并的情形」第 1 与第 5 条停手**：`check-pr-exec-record.js --mode=enforce` 当场判红「CCG 深度审查欠账 1 条（mode=dual，status=pending→error）」，且 QM-6 后端轴缺失属待人工裁决争议 ⇒ 不 arm squash，把三条走法交人定（等 claude 恢复补跑 / 逐条点名豁免 / 授权按单轴闭包并如实记账）。CI 侧 `QG Changes` 已 pass，其 **advisory** 档不拦（`quality-gate.yml:157` 用 `--mode=advisory`），所以"CI 绿"与"enforce 绿"本轮是分开的两件事，不得拿前者当后者。
- [x] 5.8b **CI 侧读数取证**（这条是新判据真正的落地证据）：`QG Changes` 作业日志原文 `MERGE-LEDGER prs=2012 base=origin/main 归属可解析记录=468 派生收口=452 byDesign=1` + `HAND-CLOSURE 人工改写=0 新增重复行=0 记录被删=0 触碰记录=1`，`carrier_mode=visible event=pull_request`。**取源在 Linux runner 上成立**（浅克隆/无 origin/main 那档没触发，未走 `n/a`），且本 PR 自己的记录被读成"碰了 1 篇、没改写任何收口行"——5.7 的自指验证在 CI 上同样成立。
- [ ] 5.9 回读本次合并触发的 main push，按 (merge SHA, workflow) 判；无 push run 时如实记 `NO_RUN(by design)` 并转核该判据最近一次在 main 上的读数。**读数写 PR 评论**——这条本身就是新口径的第一次实践。
- [ ] 5.10 worktree 按 R1–R7 走 `scripts/safe-worktree-remove.ps1`（先 `-WhatIf`）；一次性工具先删（`node scripts/safe-delete.js`，禁止目录递归删除），删前跑 `check-branch-merged.js` 取 `lost=0` 判据。
- [ ] 5.11 归档：本 change 的 delta 写在 `quality-gate-execution-record` 侧为 **ADDED** ⇒ 归档**不触发** `openspec-integration` 的 vendored 镜像同步。**若中途改为 MODIFIED openspec-integration，则必须同 PR 同步 `.quality-rhythm/integrations/openspec/spec-contract.md` 并本机复现镜像锁**（上一轮实测：实现 PR 全绿、归档 PR 才红 Gate 2b2）。

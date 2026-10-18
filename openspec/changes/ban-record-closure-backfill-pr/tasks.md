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
- [ ] 1.8 `--unified=0` 的行为锁：MUST NOT 把邻行算进配对（夹具让相邻行含另一篇的闭合字样）。
- [ ] 1.9 **三点式（merge-base）行为锁**：base 之后另有他人合入把第三篇改成闭合 ⇒ 那一篇 MUST NOT 进红集。这是 D5 的实质证明，缺它则两点式与三点式在测试上不可分辨。
- [ ] 1.10 词表同源结构锁：新判据 MUST NOT 自带第二份 `/^(PASS|N\/A|✅|已)/`，MUST 引用既有 `CLOSED_RE`/`ROW_RE`/`normalize`。
- [ ] 1.11 扫描域复用 `listRecordFiles`：`diff 文件集 ∩ listRecordFiles 结果`，MUST NOT 由 diff 自己枚举目录、MUST NOT 用递归枚举（`_exempt/` 与 `_TEMPLATE.md` 会被吸进来）。

## 2. 红测：不可用三档与阻断出口

- [ ] 2.1 `baseRef`/`headRef` 不可解析 ⇒ 打印 `HAND-CLOSURE-UNPROVEN(reason=…)`，本机不拦。
- [ ] 2.2 `git diff` 失败 ⇒ 同上，且原因可区分（两种不可得不得共用一个读数）。
- [ ] 2.3 diff 为空但文件集非空 ⇒ 未证实（不得读成"没有回填"）。
- [ ] 2.4 CI 档不可用 ⇒ 非零退出并点名"这条锁这一趟没测到"；另断言本机档不套用同一 rc。
- [ ] 2.5 **打印且阻断**：`hasBlocking` MUST 因红项为真。动因是本仓同型事故（Gate 7 长期"捕获退出码但不参与判定"⇒ 红了约一周无人认领）。
- [ ] 2.6 真仓下界断言：样本命中数写下界（当前实测 80 PR / 36 命中）且**只能缩小**；这条同时是"锁确实有东西可拦"的现场证据。

## 3. 实现 + 接线

- [ ] 3.1 实现落在 `scripts/check-gate-record-debt.js`：新增 `handClosedRows` 集合、进 `collect()` 返回面、进 `format()` 首行读数、进 `hasBlocking`。
- [ ] 3.2 新增旗标 `--head-ref`（默认 `HEAD`）并同步 `parseFlags` 白名单与"裸旗标必须抛错"纪律；`--base-ref` 沿用。**白名单里不得出现无人消费的旗标**（上一轮 F2 的同型）。
- [ ] 3.3 不新增 workflow 步骤：`check-gate-record-debt.js` 已在 `changes` job、已在非 PR 早退之前。MUST 实测两档都真的跑到了这条判据（PR 档与 push 档各取一次打印读数），不得以"它在同一个步骤里"代替证据。
- [ ] 3.4 红文案给出不需要绕行的正解：不动 / 改派生标记 / 回读证据落 PR 评论。

## 4. 口径同步

- [ ] 4.1 `AGENTS.md`：「不再需要回填动作」那段补执行体说明 + 复现命令（`node scripts/check-gate-record-debt.js`），并写明本条红的授权来源（用户拍板，属"改谁来守门"）。**按章节锚点改，禁止按行号**（该文件是热点载体，本轮实测其「合并后收尾清单」又被别的会话加过条目）。
- [ ] 4.2 `AGENTS.md` 收尾清单第 6 条：补"main push 回读读数落 **PR 评论**，不落仓库文件；仅当 main 真红才开 follow-up PR"。这是 D7 的机制闭合——不给出口的红会被绕。
- [ ] 4.3 `openspec/records/_TEMPLATE.md`：第 28 行那条注释补"改写成闭合词会判红"。**⛔ 第 20–23 行是 `requiredStepsFromTemplate()` 的派生来源，禁止触碰**；改完必须跑 `check-record-qm5-rows.test.js` 全量。
- [ ] 4.4 核验 `_TEMPLATE.md` 不与新判据自相矛盾：模板预填的是 `由门禁推导`，与新规则的鼓励方向一致（1.2 的用例即为模板形态）。

## 5. 验证与交付

- [ ] 5.1 变异反证 M1–M8（design 声明的整组）逐条实跑，要求红集**指名到用例**；整片 LOADFAIL、文件名、超时都不算证据。M5（两点式退回）若夹具下不红，则夹具无效，必须先修夹具再谈锁。
- [ ] 5.2 本机点名跑静态门禁（本机 pre-commit 不覆盖 CI 静态项）：`check-gate-record-debt.test.js`、`check-record-qm5-rows.test.js`、`check-pr-exec-record.test.js`、`workflow-contract.test.js`、`check-unwired-tests.js`、`check-step-failfast.js`、`check-workflow-structure.js`、`check-doc-abs-paths.js`、`check-changelog-growth.js`、`check-changelog-duplicate-entries.js`。
- [ ] 5.3 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 在 **commit 之后**取证；本 PR 含 `scripts/` 工具脚本 ⇒ 预期 `docs-only=false`（混合 PR），走完整质量节拍。
- [ ] 5.4 QM-6 双模型外部评审（后端 + 前端；某轴零交付时如实记未执行并补跨家族第三轴），Critical 清零后才继续。
- [ ] 5.5 执行记录 `openspec/records/ban-record-closure-backfill-pr.md`：新形态（状态列「由门禁推导」，不填 `sync_*`）。
- [ ] 5.6 CHANGELOG 收口 + `01-docs/learnings.md` 记两条：① "禁令落地 4 小时被违 4 次"是**散文规则无执行体**的成本实测；② 窄判据漏 2/4 —— **判据形态必须由违例样本反推，不能由字面最省写法决定**。
- [ ] 5.7 **自指验证**：本 PR 自己的 diff MUST NOT 触碰任何记录的收口行。若触碰就会被自己的新锁判红——那是预期行为，届时如实记录"红了什么、怎么拆开的"，**不得反过来放宽判据**。
- [ ] 5.8 开 PR；按「PR 自动合并」判据 1–5 自查后 squash 合并（判据取产物：`state=MERGED` + `mergeCommit.oid`、远端分支 0 行、`git log` 恰 1 行；rc 不作判据）。
- [ ] 5.9 回读本次合并触发的 main push，按 (merge SHA, workflow) 判；无 push run 时如实记 `NO_RUN(by design)` 并转核该判据最近一次在 main 上的读数。**读数写 PR 评论**——这条本身就是新口径的第一次实践。
- [ ] 5.10 worktree 按 R1–R7 走 `scripts/safe-worktree-remove.ps1`（先 `-WhatIf`）；一次性工具先删（`node scripts/safe-delete.js`，禁止目录递归删除），删前跑 `check-branch-merged.js` 取 `lost=0` 判据。
- [ ] 5.11 归档：本 change 的 delta 写在 `quality-gate-execution-record` 侧为 **ADDED** ⇒ 归档**不触发** `openspec-integration` 的 vendored 镜像同步。**若中途改为 MODIFIED openspec-integration，则必须同 PR 同步 `.quality-rhythm/integrations/openspec/spec-contract.md` 并本机复现镜像锁**（上一轮实测：实现 PR 全绿、归档 PR 才红 Gate 2b2）。

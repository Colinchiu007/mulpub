---
record: audit-writeback-key-fix
task: 修 P0——审核回查结论此前一条都写不回发布历史（生产传队列 task id，被调方只按 record.id 匹配）
date: 2026-10-07
---

## 本次执行记录：审核回写关联键错配修复（audit-writeback-key-fix，2026-10-07）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（`apps/desktop/electron/services/`）⇒ 隔离 worktree `D:/Data/projects/mp-worktrees/mp-audit-writeback-key-fix`，裸分支 `audit-writeback-key-fix`，base `8a959ef68`（origin/main tip），被审 commit `5930bc6fb1ad419d80dc0887462fe05aadb35945`。共享根 `D:/Data/projects/mulpub` 保持 main clean（仅两条本会话未跟踪的 docs 草稿）。 |
| 第一性原因（QM-5 ①） | PASS | `phase4-events.js:91` 传 `task.id`（队列 id `task_<n>_<ms>`），`publish-history.js` 的 `updateRecordAudit` 只按 `record.id`（`Date.now().toString(36)+4rand`，`:86` 生成）匹配 ⇒ 两键永不相等 ⇒ 每次回写恒 `updated:false`。真机现场对（本仓运行日志）：`monitor-result {"platform":"bilibili","postId":"BV1HyHC6mExS","status":"published"}` 之后 **3 ms** 是 `audit-update-skipped {"taskId":"task_1_1791361909906"}`。 |
| 规范键的出处（不靠猜） | PASS | 仓库自己已回答两处：`PublishHistory.vue:633` 按 `record.taskId \|\| record.id` join；`phase4-events.js:107` 把队列 id 写进记录的 **`taskId`** 字段，`:151-153` 明写「关联键的语义＝发布任务 id」。只有被调方没跟上。 |
| 逃逸分析（QM-5 ②） | PASS | 单元层：`publish-history.test.js` 既有用例全部走 `updateRecordAudit(rec.id, …)` —— **生产从不使用的那条键**，所以 taskId 路径 0 覆盖。集成层：`phase4-events.test.js` 的 P0-1 夹具把被调方写成 `vi.fn(()=>({updated:true}))`，「有没有改到那条记录」在夹具下**结构性不可表示**，且 `expect(id).toBe('task-audit-1')` 把「传队列 id」钉成契约 ⇒ 两侧合谋。真机层：徽标从未出现过，被读成「B 站还没审核通过」而非「链路断了」。审查层：无。分类＝**测试质量不足（恒真夹具）+ 断言反向固化错误行为**，属 AGENTS.md「装饰性链路」第四次复发。 |
| 修复 + 回归保护（QM-5 ④） | PASS | 被调方改 **taskId 优先、id 兜底**，两侧 `String(x \|\| '')` 空值保护；参数改名 `taskOrRecordId`；`matchesOwner`／单次命中／原子写／白名单键／异常不冒泡**一字未动**；调用点不改。新增 K1–K4+K6（真实现 + **独立回读 JSONL**，K1 自带「rec.id ≠ 队列 id」前提自证，K4 自带正向对照）与 **X1 跨模块契约锁**（真 `publish-history` 注入 `wireTaskQueueEvents`，走 `task:success` → 真 `addRecord` → 监控回调 → 回读文件）。实跑：两文件 `Tests 58 passed (58)`。 |
| 变异反证（QM-5 ④ 收尾） | PASS | 五条逐个实跑，每条打印归因到的测试名，收尾断言源文件与备份**逐字节相同**（`ALL_RESTORED=true`）：N1 退回只按 `record.id`（＝原始 bug）⇒ **X1 + K1 + K3 + K4** 红（`4 failed / 54 passed (58)`）；N2 只按 taskId ⇒ K2 + 既有两条红；N3 摘 owner ⇒ K4 + 既有 owner 锁红；N4 键判据恒真 ⇒ K6 + 既有两条红；N5 删空值保护 ⇒ **仅 K6 红**（`1 failed / 57 passed (58)`）—— 补 K6 之前该变异**全绿**，即「有守卫无锁」，故 K6 不是装饰。工具层一条：名称解析最初 `split(ESC).join('')` 使 `×` 与测试名之间残留 `[31m`，`caught` 恒 `<none>`；改为完整 ANSI 序列 `/\x1b\[[0-9;]*[A-Za-z]/g` 后才有上表 —— **「解析器无匹配」不等于「零失败」**。 |
| 消费者并集 | PASS | 按 AGENTS.md 手法对 `git grep -l publish-history\|publishHistory -- '*.test.js'` 反查出的 **13 个消费者文件**整组跑：`Test Files 13 passed (13)`、`Tests 446 passed (446)`。不是只跑 diff 里出现的两个测试文件。 |
| 孪生实现核查（防"顺手收敛"） | PASS | `packages/shared-utils/src/publish-history.js` 同名，易被当成第二处同缺陷。实测 `module.exports` 只有 `addRecord/listRecords/getRecord/getStats/getHistoryPath/configurePublishHistory`，**不导出 `updateRecordAudit`** ⇒ 无重复缺陷可修，未动（`git grep updateRecordAudit` 生产侧仅 1 处，QM-6 后端轴独立复核同一结论）。 |
| 全量测试 | PASS（1 条既有红已归因） | `vitest run electron` 在**最终 head**（含评审修复的第三笔）上实跑：`Test Files 1 failed | 465 passed | 1 skipped (467)`、`Tests 1 failed | 8889 passed | 1 skipped (8891)`。唯一红＝`electron/services/feedback.test.js`（5 例中 1 例）`Error: EPERM: operation not permitted, symlink ...\feedback-test-4Ou5Nu\app-2026-08-17.log -> ...app-2026-08-16.log` —— 本机非提权环境建符号链接的**已登记已知项**（出处：`01-docs/learnings.md:223`，2026-10-03 记录「`feedback.test.js` 的 `fs.symlinkSync` 在 Windows 当前用户无「创建符号链接」权限时抛 EPERM」），与本 PR 无因果路径（本 PR 未触碰 feedback/logger 任何文件，见 `git show --numstat` 五个文件）。<br>**如实登记一次被丢弃的运行**：第一次全量跑（任务 `bdssymd9q`）与本轮三次测试文件编辑**时间重叠**，而 `fileParallelism:false` 下 vitest 是逐文件读盘 ⇒ 那一轮读的是新旧混合的树，**不作为证据**，中途停掉后在最终树上重跑得上述数字。后台通知报 "completed (exit code 0)" 而日志末行是 `FULL_RC=1` —— 判据一律读日志里的 `Tests ...` 行。 |
| QM-1 打包 | PASS（跑在 `5930bc6fb`，最终 head 差量已核） | `verify-worktree-deps.js` OK（11 项解析到本 worktree）后：`vite build` → `electron-builder --win --dir --publish never` ⇒ `BUILD_RC=0`。**第一次构建踩到已知白屏前提**：当时 `apps/desktop/dist` 不存在，builder 照样 rc=0，`asar` 内 0 个 `index.html` ⇒ 先补 `build:vue` 再重打。产物判据走 `@electron/asar` 的 `extractFile`（Windows 上键必须是**反斜杠且去前导分隔符**，正斜杠形态报 not found，读起来像「产物没这文件」）：`electron/services/publish-history.js` asar=13414 / src=13414 / **identical=true** / `hasFix=true` / `hasRename=true`；`electron/bootstrap/phase4-events.js` 15105 **identical=true**（未改动，作为对照）；`.test.js` 进 asar 计数 **0**；`dist/index.html` 与 61 个 asset chunk 均在包内。启动实测（隔离 `--user-data-dir`）：`ALIVE_AFTER_10S=True`、`CHILD_COUNT=5`（含 2 个 `python.exe` + 3 个渲染/GPU 子进程）、应用自记日志 `app-2026-10-07.log` 20878 字节且含 `[NOTIFY] window main-window-shown`（正向"renderer 真加载"断言，不只看存活）、三条禁用标记 `Failed to load platform config` / `mkdir failed` / `ENOTDIR` 计数 **0**，`spawn python ENOENT` 0（`MP_PYTHON` 已设）。<br>**为什么不必为最终 head `ff7f76b94` 重打包**：`git diff --name-only 5930bc6fb..ff7f76b94` 六个文件里，剥掉 `*.test.js` / `.ccg/` / `openspec/` / `docs/` 之后**为空** ⇒ 两个提交之间没有任何运行时文件差异；而 `.test.js` 进 asar 计数为 0，所以同一个 asar 逐字节覆盖最终 head 的运行时面。 |
| QM-4 视觉 | N/A | 零 UI 文件改动（`git show --numstat` 五个文件：1 主进程服务 + 2 测试 + CHANGELOG + PRD）。 |
| 本地门禁 | PASS | `check-no-brand-residue.js` ⇒ PASS（扫描 7173 个 tracked 文件，0 残留）；`.github/scripts/check-max-lines.js` ⇒ PASS（超限 98 = 挂账 98，无新增）；eslint 三个改动文件 ⇒ 0 问题；`check-docs-sync.sh --base=main --head=HEAD` ⇒ 通过（该脚本自己拼 `origin/$BASE`，传 `origin/main` 会 `fatal: couldn't find remote ref refs/heads/origin/main`）；`check-unwired-tests.js` ⇒ 65 个测试文件全部已接线或已登记；`check-step-failfast.js` ⇒ 6 个多测试步骤全 fail-fast；`check-changelog-growth.js` ⇒ PASS（base 350 条全在 head 351 条里）；`check-changelog-duplicate-entries.js` ⇒ 冗余 0→0、本 PR 新增副本 0。 |
| 行尾与 diff 对账 | PASS | `git diff --numstat origin/main..HEAD` 与 `--ignore-cr-at-eol --numstat` **逐文件完全相同**（39/0、68/0、16/4、116/0、127/0 ⇒ 366 insertions / 4 deletions）⇒ 无幽灵行、行尾未被统一重写。rebase 的 CHANGELOG 冲突按「两条都保留」解：`resolve-changelog.js` 逐行 `split('\n')` 不动行尾（实测新增块自身带 `\r`）、只删三行标记、解后 `MARKER_COUNT_AFTER=0` 且 `git diff origin/main -- CHANGELOG.md` = **+39/−0**。 |
| 执行记录与欠账登记 | PASS | 本文件即执行记录。**新载体的登记随文件走**：`远程同步` 行写 `PENDING` + frontmatter 的 `sync_reason` / `sync_backfill_owner` 两个字段非空，`check-gate-record-debt.js`（Gate 2c）即判 OK；**不得**再往 `scripts/gate-record-debt-ledger.json` 加键 —— 试过，当场报「陈旧登记 1 条」，因为那套 JSON 键只服务 `.quality-gates.md` 的历史标题源（本轮实测两次：加键 ⇒ 红，删键 ⇒ OK，ledger 回到 9 键且 `git diff --stat` 为空）。合并后回填 PASS + 删两个 `sync_*` 字段必须**同一次提交**。 |
| QM-6 CCG 双模型外部评审 | PASS（走替代通道，偏差如实登记） | 触发条件命中（改主进程服务 + 持久化写回）。**偏差**：`Test-NetConnection 127.0.0.1 -Port 15721 -Quiet` = **False** ⇒ 配置里两个 primary（`codex` / `claude`，均绑 CC Switch）本轮不可用；两轴改走 `opencode run`，且**选不同底模**（后端 `opencode/nemotron-3-ultra-free`、前端 `opencode/ling-3.1-flash-free`），同经一个 harness ⇒ 跨家族独立性打折。任务书与被审 diff 均落在本 worktree 内（`.ccg/qm6-*-task.md`、`.ccg/review/keyfix-runtime.diff`，245 行，绑 commit `5930bc6fb1ad419d80dc0887462fe05aadb35945`），两份 findings 入库留证：<br>**后端轴** ⇒ Critical 0 / Warning 0 / INFO。四问逐条给 `文件:行号` 判据；其行号我逐条回读核实（`:45-52` matchesOwner、`:86` id 生成、`:200-201` 入参早退、`:217-221` 匹配条件、K6 在 test `:516-518`）**全部与现状相符**。它独立确认「没有别的生产调用方」与孪生实现不导出该函数，并指出 N5 是「唯一只靠 K6 抓住」的反证 —— 与我的实测一致。<br>**前端轴** ⇒ Critical 0 / **Warning 1** / INFO 3。它核实了 X1 注入的是真模块（`PH_TEST_DATA_DIR` 只是模块自带的存储接缝，不是替身）、断言读落盘文件、`getMainWin:null` 不会绕过被测链（`publish-progress-events.js:135-136` 对 null 窗口直接 return）。处置见下节。 |
| 远程同步 | PASS | 已合并：squash 落地 `e24660047a87e9f8a2ceca8e59c5664739e87b93`（committer 2026-10-07T20:28:25+08:00）。取证 `git log origin/main --grep='(#3083)$' --format=%H|%cI` 唯一命中该 SHA 与时间；`git ls-remote --heads origin audit-writeback-key-fix` 返回 **0 行**证远端分支已删（本次合并同时删远端分支，本地分支因被本 worktree 占用而未删，属会话残留、不影响远程同步状态）。本次回填与 frontmatter 三个 `sync_*` 字段的删除发生在**同一次提交**
| 残留 | 见「遗留」 | — |

## 处置表（评审发现 → 结论）

**后端轴**：0 Critical / 0 Warning（四问均为确认）。INFO 三条（修法精准、契约锁完备、空值保护与入参早退分工不重叠）无需动作。

**前端轴**：0 Critical / 1 Warning / 3 INFO。

| 发现 | 核实 | 处置 |
| --- | --- | --- |
| **W1** `phase4-events.test.js` 新块设 `PH_TEST_DATA_DIR` 后全文件无回收；同 worker 串行跑多文件 ⇒ 泄漏给后续文件，令其把 publish-history 静默重定向到已删除目录 | **成立**。三条实测：① `vitest.config.js:11-12` 确为 `maxWorkers: 1` + `fileParallelism: false`；② 全仓 `grep -rn PH_TEST_DATA_DIR` 显示该文件只有 `:557` 一处赋值、**无任何 delete**；③ `publish-history.test.js:16` 外层 afterAll 确有 `delete`（对照存在） | **已修**：该块 `afterAll` 补 `delete process.env.PH_TEST_DATA_DIR` 并写明为什么必须回收。评审的「潜在风险而非现行故障」定性我接受 —— 现有引用点全部自设 env，所以今天没有测试因此变红；正因为今天不红，它是一颗延迟引信，修它成本一行 |
| **W1 的第二落点**（我复核时扩展）：`publish-history.test.js` 的新块被评审判为「依赖外层 afterAll 的 delete」 | **比评审说的更严重**：`grep -n "^describe(\|^});"` 实测新块是 **418–520 的独立顶层套件**，外层在 **404** 已闭合 ⇒ 外层的 `delete` **管不到它**，本 PR 新增块自身就在泄漏 | **已修**：新块自己的 `afterAll` 补 `delete`，并注释「与外层平级 ⇒ 外层回收不到」。这是「评审者的定性也要核结构」的一处现场 |
| **I1** `:349` `const [id, patch, owner]` 实际承载队列 id 却命名为 `id` | **成立**。这正是本次 P0 能被四层测试带过去的语义温床（断言本身正确，PRD §4.2 保留） | **已修**：改名 `taskIdArg` + 注释说明「叫 `id` 是温床，断言保留」 |
| **I2** `:586` 三次 `await Promise.resolve()` 对当前单 await 的 stub 足够；stub 若加 await 层级需同步加拍 | **成立且现为真**（stub 只有一个 await）。属未来脆弱点，不是当前缺陷 | **不改动**，登记在此。加 `flush()` 工具函数属过度设计（现有一个消费点） |
| **I3** Q1 确认 X1 走的是真模块 + 落盘断言；Q4 确认 `mkdtempSync` 唯一目录不跨会话污染 | 与我的实现意图一致 | 无需动作 |

修完后复跑：`publish-history.test.js` + `phase4-events.test.js` ⇒ `Tests 58 passed (58)`；eslint 两文件 0 问题。

## 遗留（不在本 PR 修，逐条给出取证）

1. ~~**真机复验未完成**~~ —— **已于 2026-10-07 晚完成**（本 PR 合并后再投一条真稿）：新稿 `BV1hhH16NEAZ`（任务 `task_1_1791381214184`）的 `auditStatus/monitorStatus/platformWorkId/auditedAt` 四字段真的落库、日志里不再有 `audit-update-skipped`、`#/publish/history` 该行徽标为「已上线」；**同账号同链路的修复前那条（`task_1_1791361909906`）仍是四字段缺席**，构成天然对照组。证据、时间线与「本轮仍不能下结论的四件事」见 `docs/audit-requery-evidence-bilibili-2026-10-07.md` §八与 PRD §6.1。过程中一处自纠：初稿把"跑的不是 main tip"写成"逐条查过均无关功能"（没量过的归因），改成了比 blob —— 链路四文件在运行树与 `origin/main` 上逐字节相同。
2. `pixel-diff-baseline-guard` 的 10s 超时预算、通用平台解析过宽（`data?.data?.list || data?.items || …`）：上一条 PR 已登记，未动。
3. `check-max-lines.js` 的 `EXCLUDE` 用 `rel.includes('test')` 子串判据 —— `publish-history.test.js` 现 522 行却因该子串豁免；这是既有豁免口径，本 PR 不改判据（改它属门禁改动，需人工过目）。

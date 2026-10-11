---
record: gate-record-status-consistency
task: 给执行记录「远程同步」的两种书写形态加同篇对账判据，并对齐存量 8 篇说谎的 bullet
date: 2026-10-10
---

## 本次执行记录：执行记录两种形态的对账判据（gate-record-status-consistency，2026-10-10）

- 变更类型与分层：改 `scripts/check-gate-record-debt.js`（门禁判据自身）+ `scripts/*.test.js` + 8 篇存量记录 + `AGENTS.md` + `CHANGELOG.md` + 新增 PRD ⇒ **混合 PR**，`classify-docs-only` 必然 `docs-only=false`，走完整质量节拍；在隔离 worktree `mp-gate-record-status-consistency`（分支 `gate-record-status-consistency`）完成，经 PR 落地。
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 编码完整性 ✅ | 文档同步 PASS（CI `文档同步检查` = pass） | 远程同步 PASS（PR #3274 已 squash 合并，main `d515fbc608855bedbcf160776d55a675bca0ca18` @ 2026-10-11T00:19:08+08:00；取证 `git log origin/main --grep='(#3274)$' --format=%H|%cI` 恰 1 行、`git ls-remote --heads origin gate-record-status-consistency` 返回 0 行；CI 上 `QG Changes`（含 Gate 2c 新判据）、`QG Visual`、`文档同步检查` 均 pass）

### QM-5 五步（本 PR 修的是「门禁看不见的那半句谎话」，不是改表面）

| 步 | 产出 |
| --- | --- |
| ① 第一性原因 | 不是"谁回填时漏改一句 bullet"，而是**同日落地的两套约定交集为空**：`efd1d40cc`（#2561，2026-09-28 08:55Z）建门禁时判据钉死为 `ROW_RE = /^\|远程同步\|/`，只认表格行；`a48820a0e`（#2581，同日 23:15+08:00）落 docs-only 快速通道时，模板把状态写成 `- 保留门禁：… \| 远程同步 PENDING` 的 bullet。两者没有任何东西做对账。`8dad3b150`（#2717）把记录载体扩为两源时沿用了同一个 `ROW_RE`，盲区被继承进新载体。 |
| ② 逃逸链 | 单元测试 ❌——`check-gate-record-debt.test.js` 的夹具 `recFile()` **只造表格行**，对 bullet 形态结构性免疫；集成/运行态 ❌——Gate 2c 跑真实仓库但判据本身看不见；视觉 —— 不适用；代码审查 ❌ 且**反向误导**（读者看见 bullet 的 PENDING 会以为这条还没收口，于是重复开一轮回填）。 |
| ③ 系统性漏洞 | `scripts/check-gate-record-debt.js:25`（`ROW_RE`）与 `readRecord()`：`status` 只从表格行第 2 列取，全文其余位置的「远程同步 + 状态」从未被读过 ⇒ 同一语义有两个书写位置、门禁只绑其中一个，另一个是**无人看守的副本**。分类：门禁缺失漏洞。 |
| ④ 修复 + 回归保护 | 新增「行已闭合 ↔ bullet 未收口」同篇对账判据（拦截）+ `statusMismatchVisible`（反向，可见）+ `legacyVisibleContradictions`（旧载体，可见）；`main()` 与测试共用 `hasBlocking(r)` 单一谓词。回归保护 43 例（T1–T12 + 既有 31 例），全部用 `collect()` 行为断言，不读源码字符串。 |
| ⑤ 预防措施 | `AGENTS.md` docs-only 模板补硬约束（两种形态同写、回填同次改写）；判据本身接在既有 `Gate 2c`（`changes` job，不被 docs-only 短路），无需新接线；CHANGELOG 收口。 |

### 判据范围由三轮实测决定（不是拍脑袋收紧）

| 判据候选 | 真仓命中 | 其中误报 | 结论 |
| --- | --- | --- | --- |
| 宽式（行内含「远程同步」与状态词即判） | 27 | 25（93%） | 否决 |
| 位置窄式（状态词紧跟「远程同步」） | 9 | 1（自指引用） | 否决 |
| 收尾式 + 显式状态词表（最终采用） | 8 | 0 | ✅ |
| 「取任意词再按 CLOSED_RE 分类」（实现第一版） | 14 | 6（全来自 `task:` frontmatter 行） | 当场被真仓自证用例抓住后回退 |

实现第一版的偏差是个有价值的现场：**表格行的第 2 列有位置保证（必是状态），bullet 没有**，所以 bullet 侧不能靠"取一个词再分类"，必须用显式词表。这条已写进源码注释与测试 T12。

### 存量处置的归属前提（外部评审 Major，成立后补做）

改他人执行记录在本仓是禁区，所以动手前先证明这 8 篇是本条工作线自己写的：创建提交依次为 #3078 / #3089 / #3092 / #3100 / #3116 / #3125 / #3128 / #3131（`git log --diff-filter=A` 逐个取证）。对照 `.quality-gates.md` 的 6 处同类矛盾来自 #3253 / #2635 / #2943 / #2948 / #3000 等他人会话 ⇒ 只可见不代改。**范围依据是归属，不是载体**；规避路径不存在，因为新 PR 的载体已被 `enforce-gate-record-presence` 固定为 `openspec/records/`。

8 篇 bullet 的 PR 号与 merge SHA 全部由脚本从各篇**自己的权威表格行**提取（不手抄），再逐个对 `origin/main` 复验：`#3078→8a959ef68 … #3131→d1535e894`，`VERIFY=OK 8/8`。

### 决策层与验证层评审

- 标准通道不可用：`sh scripts/plan-review.sh <PRD>` 报 `✗ 找不到 ccg-deep-review.js（引擎驱动）`（其 wrapper 路径在本机写死为他人用户目录），按既有替代通道直跑 `opencode run --agent plan --auto --model opencode/nemotron-3-ultra-free`，结论逐字读自该模型自己的 stdout 段。
- 1 Critical + 5 Major + 4 Minor，逐条对源码/实测核实后：**采纳 4 条**（反向改为只可见、存量必须补归属取证、范围依据改归属、验收标准里"无出处证据"改成结构断言）、**否证 4 条**（尾随空格由 `\s*$` 覆盖、两方向天然互斥、`PASS（…）` 不匹配未收口词表、frontmatter 字段名它记错了）、**转成测试 3 条**（T10 尾随空白、T11 互斥性、T12 `task:` 行形状）。完整处置表在 PRD §9.1。

### 验证层（实现 diff）本轮未完成 —— 如实登记，不谎称跑过

| 尝试 | 模型 | 结果 |
| --- | --- | --- |
| 1 | `opencode/ling-3.1-flash-free` | 300 s 超时（rc=124），`Error: Transport: The socket connection was closed unexpectedly`。被切断前它**自己独立跑了** `node --test scripts/check-gate-record-debt.test.js` 并把输出留在 transcript 里：`ℹ tests 43 / pass 43 / fail 0` —— 这是它自证的，不是它的评审结论 |
| 2 | `opencode/nemotron-3-ultra-free`（收窄任务书，只读 diff 不跑命令） | 仍 rc=124，只完成 `→ Read .qm6b/impl.diff` 一步，零结论 |

所以本 PR 的外部审查证据链是：**决策层（方案 diff）1 Critical + 5 Major + 4 Minor 已逐条处置并收敛**（上表），实现层的**模型评审缺失**，代之以本地 43 例 + 10 条变异 + 真仓自证 + 消费者并集（`check-max-lines` 27、`check-changelog-growth` 30、`check-pr-exec-record` 35 全绿）。**不得把上面这些当成双模型评审的替代来宣称 QM-6 已完成**；该轴留给下一个能跑通通道的会话或人工抽查。

### 反证（10 条变异逐个实测变红，收尾断言与备份逐字节相同）

M1 摘掉矛盾 push（3 红）｜M2 只放宽邻接（**没红——证明这条变异测不到它声称的东西，已作废并由 M9 取代**）｜M3 忽略行是否闭合（6 红，含"在飞 PR 不得红"）｜M4 从 `hasBlocking` 摘掉矛盾（1 红）｜M5 旧载体接入拦截面（2 红）｜M6 反向接入拦截面（1 红）｜M7 去掉尾随空白容忍（1 红）｜M8 去掉括注容忍（2 红）｜M9 真宽式（去 `$` 又去邻接，4 红含 T5/T6）｜M10 退化成任意词分类（4 红含 T12）。`restored_identical=true`。

### 不在本 PR 范围（已登记，不静默修）

- 旧载体 `.quality-gates.md` 的 6 处存量矛盾（他人块）。
- 213 篇历史执行记录整块缺 `远程同步` 行（既有可见项）。
- `readRecord()` 目前把 bullet 扫描域铺满全文（含 frontmatter），靠词表把误报压到 0；若要更严可改成"只扫 bullet 行"，但那会让 `已回填` 之类写法需要重新取证，本 PR 不动。

### 本地门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 判据自测 | `node --test scripts/check-gate-record-debt.test.js` | 43 pass / 0 fail |
| 真仓判定 | `node scripts/check-gate-record-debt.js` | rc=0；`远程同步行 271 条 / 执行记录 480 篇 / 已登记欠账 8 条 / 记录文件 157 篇`，矛盾 0、旧载体可见项 6 |
| 变异反证 | `node D:/…/mutate_sc.cjs` + `mutate_sc2.cjs` | 10 条逐个实测变红，还原逐字节相同 |
| 品牌残留（硬红线） | `node scripts/check-no-brand-residue.js` | 见下方提交后复跑 |
| 行尾两口径对账 | `git diff --numstat` vs `--ignore-cr-at-eol --numstat` | 逐文件相等（各文件改前 `i/lf w/crlf attr/text=auto`，脚本按 CRLF 逐行写回并断言 loneLF=0） |
| 编码完整性 | `node scripts/check-text-encoding-integrity.js` | 见下方提交后复跑 |
| 复杂度判定 | `node scripts/ccg-review-decider.js --input <PRD>` | SINGLE（92 行估算 / 无敏感命中），要求单模型深度审查 ⇒ 已走替代通道完成 |

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 远程同步 | PASS（PR #3274 已 squash 合并，main `d515fbc608855bedbcf160776d55a675bca0ca18` @ 2026-10-11T00:19:08+08:00；取证 `git log origin/main --grep='(#3274)$' --format=%H|%cI` 恰 1 行、`git ls-remote --heads origin gate-record-status-consistency` 返回 0 行；CI 上 `QG Changes`（含 Gate 2c 新判据）、`QG Visual`、`文档同步检查` 均 pass） | 本 PR 尚未合并；合并后由后续回填轮改写为 PASS 并同次删除 frontmatter 三字段与本条 bullet 的 PENDING 措辞 |

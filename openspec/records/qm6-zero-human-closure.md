---
record: qm6-zero-human-closure
task: 零人工高危面收口机制的立项（第 1 刀处置凭证 + 第 3 刀判据回归语料差分）
date: 2026-10-23
---

## 本次执行记录：零人工收口立项（qm6-zero-human-closure，2026-10-23）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯规格/文档变更（`openspec/changes/qm6-zero-human-closure/**` + 本记录），按 AGENTS 分层判据属**就地编辑 + 必须经 PR**；不进 worktree、不落运行时代码 |
| 判定 | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（提交后当场重取，files 见 PR 正文） |
| 第一性原因（QM-5 ①） | ✅ | 病根不是"评审没过"，是**四环节闭环**：高危面只认 `tier=external`（`check-pr-exec-record.js:690`）⇒ `tier` 唯一生产方是写回器且其合取要求 `performedBy==本轮 critic` ⇒ 引擎在有 Critical 时降级自扮演、写 `performedBy=self-play…` ⇒ 合取永不成立 ⇒ **评审真发现问题时高危面无任何机械出口**。现场实证：#4261 唯一失败格 `Gate 2b11`（run 39847244091），其余 required 全绿 |
| 逃逸分析（QM-5 ②） | ✅ | 现有四层闸门（CI/质量节拍/执行记录/收口矩阵）全部只问"出处是谁"，没有一层问"每条意见有没有被处置"——所以"出口为空"这件事在判据里根本不可表示。存量读数：已闭环 339 条里 `tier=self-play` 40 条、`tier` 缺席 202 条（普查工具当场取） |
| 系统性漏洞（QM-5 ③） | ✅ | 两条且互相独立：① 收口判据把"签字者身份"当充分条件；② **没有任何机械判据能区分"合理收窄"与"为过闸而放宽"**——这正是 AGENTS 把守门面清单划给人工过目的唯一原因。不补第 2 条而只拆第 1 条，等于把人工闸门转移而非消除 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 本 PR 只落**规格**（proposal / design / spec delta / tasks）。合同含 5 条 Requirement，每条约带一个"未证实/失明"档；实现片的验收与变异反证逐格登记在 `tasks.md`（M-D3a…M-D3j、M-D1a…M-D1f、示踪弹 §1 两条） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 顺序锁写进 spec 成为第 4 条 Requirement（转拦依赖探测器读数，取不到维持出声并点名 `probe-unverified`）；② 覆盖计数棘轮把"删语料"从不可见变成必报数；③ 三条"不得把失明读成结论"的档位（`unverified` / `rerun-unavailable` / `probe-unverified`）全部有独立计数与独立红文案 |
| 行尾与 diff 对账 | ✅ | 四份新文件与 `openspec/records/qm6-zero-human-closure.md` 均为 LF；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（见 PR 正文现场读数） |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` PASS（扫描 12028 个 tracked 文件） |
| 受管文档绝对路径 | ✅ | 本 change 四份文档 + 本记录**零**绝对路径（自检 `grep -naE '[A-Za-z]:[\\/]'` 空命中）。当场跑 `scripts/check-doc-abs-paths.js` 报的那 1 个文件是 `.ccg/evidence-ccg-deep-8e315f3b-multi-account/proposal-v1.md`——**并发会话留在共享根的未跟踪产物，不在本 PR 改动集内**，未触碰、未加白名单、未调账本 |
| 接线棘轮 | N/A | 本 PR 不含测试文件；实现片的接线要求写在 `tasks.md` §2.5（含 `changes` 作业零依赖与 base blob 可读两条硬前置） |
| QM-1 打包 / QM-4 视觉 | N/A | 纯文档 |
| QM-6 CCG 双模型外部评审 | ✅ 第 1 轮已跑并逐条处置 | `sh scripts/deep-review.sh`（载荷 = 本 change 已提交 diff，基点 `b9100fb0`）：critic=`claude` / proposer=`opencode`（取自 `scripts/ccg-review-backends.list`）。产物 **8 条**（2 Critical / 4 Warning / 2 Info），维度最低分 **4**；引擎收敛为 `status=self_play_pending`，写回器如实拒写（`reason=not-closed`，**未伪造 `tier`**）。逐条取证与处置表在 design §10；本 PR 因 `docs-only` 被判 `mode=single`，不产生 dual 欠账，评审价值全部落在**合同被改对的 8 处**上 |
| 第 1 轮改了什么（可核对的落点） | ✅ | i1 ⇒ 新增第三档 `rebuttal-face-absent` + 前置条件写进判据（spec 场景、design §4.2b、tasks 3.1/M-D1g）；i2 ⇒ `hits` 与 `reasons` 禁止派生 + 解耦锁（design §5.2、tasks 2.1/M-D3k）；i3 ⇒ 与**上一条运行账**对账（design §5.4b、spec 判据 5、tasks 2.3⑤/M-D3m）；i4 ⇒ `REPLAY-SCOPE` 常态打印 + 空选择集落未证实（design §7、spec 判据 7）；i5 ⇒ 录制期 `git cat-file -e` 自证、死条目不得进分母（spec 判据 6、tasks 2.2/M-D3l）；i6 ⇒ `probe:self-test` 下限从评审建议的 `≥1` 改为 **≥2 且两形态各异**（tasks 2.4b/M-D3o）；i7 ⇒ `judgment-replay-runs.json` 的 `schemaVersion` + 字段闭集（spec 第 4 条）；i8 ⇒ tasks 0.2 补"谁停、怎么退"四格 |
| 不照抄评审实现的四条（防把闸门关小） | ✅ | i1 的方向（`dangling` 是拦不是放）、i2 的约束（本设计不以文案为输入）、i3 的哈希链字面形态（链只证顺序不证内容）、i6 的 `≥1`（恒红探针也满足）。自查口径：新增四档全部是"未证实 ⇒ 不拦但必须出声且计数"，**没有一档把已有拦截改成放行** |
| 该判定产物为何保持未闭合（如实，不假装） | ⚠ 已知欠账 | 本提交因 `docs-only` 被判 **`mode=single`**，而收口矩阵**只对 `mode=dual` 生效**（`evaluateDeepReviewDebt` 对 single 直接 `continue`）⇒ 这条 `self_play_pending` 产物**不在任何拦截面上**，CI 不会因为它红。这不是本片造成的，是 AGENTS QM-6 段已登记的 8.5 那一格（"改判据本体的小改动被判 single 时，凭一条 pending 记录即可通过"）。本片把它**原样保留并点名**，不借它冒充"QM-6 已闭合" |
| 评审的裁决模板本身不在可审面 | ⚠ 已知缺口 | 引擎把待填模板写在 `.adversarial/ccg-deep-<sha>/adjudication.json`，而 `.gitignore:490` 整目录不收 ⇒ prosecution/defense/verdict 的**原始载体不进 git**。本片把结论落成 design §10 的表（受管、可 diff），不留一份只有本机知道的模板。该缺口属第 5 刀（评审证据面持久化）范围，本 change 不做 |
| 人工过目 | 需 | 本 change 改的是"什么算闭合"（#4297 的 spec 里明文留议的那第 1 条），属"谁来守门" ⇒ **不自动合并** |

| 远程同步 | 由门禁同步推导 |

- 保留门禁：判定 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #NNNN

## 交付范围声明（不是"已闭合"清单）

本 PR **只交付规格**。明确**没有**交付的东西，逐条列出来防止被后续会话读成已做：

1. **零行实现代码**。`scripts/check-pr-exec-record.js` 的 `QJ_RULES`/`hits`、语料与三个新脚本，全部在 `tasks.md` §2/§3 里待做。
2. **零人工目标没有因为本 PR 达成**。本 PR 立的是"探测器先于拆闸"这条顺序合同；
   顺序里靠后那一半（第 1 刀转拦）落地之前，高危面的人工过目**仍然存在且仍然必需**。
3. **第 4/5/6 刀刻意不做**，理由在 design §9 表内（其中第 4 刀的三个数没量到，我拒绝把未量的数写进文档当依据）。
4. **tasks 11.6 / 11.7 不在本片**。11.7 只在本 change 的 §3.4 落地后才算有出口，本 PR 不勾它。
5. **#4261 / #4148 / #4297 三片在飞**，本 change 与它们的依赖与边界写在 design §0；
   其中 #4148 的 QM-6 收口经用户 2026-10-23 裁决**保持未闭合交人工**，本 PR 不为它开后门。

## 设计期关键取舍（为什么这样切，供评审攻击）

- **为什么不直接放宽 `self_play_resolved`**：那把"外部评审过"这句话的真值改成由被评审者自述，
  是本仓定性的「装饰性门禁」最纯形态。tasks 11.7 已登记的三个候选（a)/(b)/(c）逐条否证，本 change 是第 (d) 个：
  **换判据的问句**（从"谁签字"换成"每条意见有无可重放处置"），不换出口的真值来源。
- **为什么语料存输入面而不是存结论**：存结论 ⇒ 任何文案改动全量红 ⇒ 两周内被放宽。
  可行性不是假设：`evaluate()` 入参纯数据（`:256` 注释原文）、CLI 已有 `--statuses=<json>`（`:29`）、
  `evaluateDeepReviewDebt` 的读取器是注入的（`:991`）⇒ **D3 不需要为可重放重构生产代码**。
- **为什么覆盖计数棘轮必须与超集判据并存**：超集判据只看剩下的语料，删一条"没人依赖的"对它完全隐形。
  两条判据正交：`hits` 防改判据，`coverage` 防改语料。
- **一处被仓内既有约束否证的设计**：初稿把"绿侧当场重跑"写成无条件 MUST，
  但 `changes` 作业不装依赖（AGENTS「只能 require node 内置模块」）⇒ vitest 回归锁物理上跑不了。
  改为三档并新增 `rerun-unavailable`（未证实档），已在 design §4.2 末注与 spec 场景里写明这是**改过的**，不是原样。

## 变异反证与自检的现场教训（写下来因为形状会复发）

- **自检脚本自己踩了本 change 要治的那个病**：按 basename 在仓里找实现时，
  `check-pr-exec-record.js` 被解析到 `.agent_context/worktree-archive-*/scripts/` 下的**归档副本**（330 行），
  于是把真文件（1318 行）的合法行号全报成"越界"。三个 ANCHOR-OOB 读数**是探针失明，不是文档缺陷**；
  真锚点逐条用 `grep -n` 对 `scripts/` 那份复核过。已把这条写成 design §5.6，
  因为它恰好是本 change 动机的微缩版：**探针读错对象时，读数看起来完全正常**。
- **同一条命令两个数**：产物枚数 1975（普查工具形状口径）与 1980（`git ls-tree | grep -c`）并存，差 5 枚成因未取证；
  交付时长分位数隔约 25 秒两次实测从 p90 10.11h 变 7.92h（窗口随主干前进）。
  ⇒ 两份文档里这两个数都**成对写**，并给"数字连着口径一起存"定了合同（语料 `recordedBy` 字段）。
- **一次自指**：本 change 的落点文件全部命中守门面前缀（`scripts/check-`、`scripts/ccg-review-`、`.github/workflows/`），
  所以实现片必然被自己的判据拦一次。这是判据在工作的证据；⛔ 处置不得是"写 `tier`/`closureNote` 让它不红"，
  正解写在 #4261 的执行记录里（补跑真外部评审拿 `tier=external`，或确认假阳性走非高危面出口——高危面不适用后者）。

## CHANGELOG 条目

# docs(openspec): 立项零人工高危面收口机制——把"谁签字"换成"每条意见的可重放处置"，并先造"判据变宽"的探测器

- **背景**：QM-6 收口矩阵要求高危面只认 `deepReview.tier=external` + 可核 `evidence`，而 `tier` 的唯一生产方
  要求 `performedBy` 等于本轮 critic；评审引擎在仍有 Critical 未决时降级自扮演、把 `performedBy` 写成 `self-play…`
  ⇒ **评审真发现问题的路径上，高危面没有任何机械出口**。现场实证：PR #4261 唯一失败格是 `Gate 2b11`，
  其余 required 格全绿；主干存量已闭环 339 条里 `tier=self-play` 40 条、`tier` 整段缺席 202 条（普查工具当场取，活数）。
- **两条独立病根**：① 收口判据把"签字者身份"当充分条件；② **没有任何机械判据能区分"合理收窄"与"为过闸而放宽"**
  —— 这正是 AGENTS 把守门面清单划给人工过目的唯一原因。只治 ① 不治 ②，人工闸门是被转移而非被消除。
- **方案（两刀，顺序是合同）**：第 3 刀先上——`scripts/qm6-judgment-corpus.jsonl`（只可追加的真实历史案例输入面）
  + 差分判据 `新命中集 ⊇ 旧命中集` + 覆盖计数棘轮（维度覆盖数不降 / 新维度初始 > 0 / 总条数不降，三条独立红文案）；
  第 1 刀随后——每条评审意见带封闭分档的 `resolution`（`code-fix` 红→绿双读数、`false-positive` 引用 #4297 的
  `rebuttals[]`、`deferred` 锚未勾任务行逐字内容、`unsupported`/`accepted-risk` 在高危面拦）。
- **可行性经现场核实，不是设想**：判据入口已接受全注入输入面（`evaluate()` 纯数据、CLI 已有 `--statuses=<json>`、
  产物读取器是注入参数），且两份判据 require 集合为零第三方依赖 ⇒ 重放器可以待在 CI 的 `changes` 作业里。
  **D3 不需要为可重放重构生产代码**，唯一一处生产改动是给散文 `reasons` 补一个并行结构化出口 `hits`。
- **成本实测**：近 60 笔已合并 PR 交付时长 p50 1.54h / p90 7.92h / max 17.79h（两次读数与漂移一并写入文档）；
  40 条语料重放约 5 分钟串行、可并行、可按守门面命中裁选择集。增量成本落在"改闸门那次提交"，不落在每个 PR。
- **本文只提案**：零行实现代码。第 4/5/6 刀（跨家族共识组装、严重度标尺、异常自动收紧）刻意不做并写明理由，
  其中第 4 刀的三个数没量到、拒绝写进文档当依据。#4148 的 QM-6 收口保持未闭合交人工，本片不为它开后门；
  守门面清单条目（现读 10 条）一字不改。属"改谁来守门"，不自动合并。

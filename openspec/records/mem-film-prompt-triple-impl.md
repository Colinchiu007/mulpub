---
record: mem-film-prompt-triple-impl
task: PR-2 记忆沉淀 —— 影视工程提示词三分（F-A）实现期的 7 条可复用教训
date: 2026-10-21
---

## 本次执行记录：PR-2 记忆沉淀（mem-film-prompt-triple-impl，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档（**只新增本执行记录一个文件**）⇒ 走 **docs-only 快速通道**：就地编辑（共享根，main-only 协调目录）+ PR 落地，**不进 worktree**（分层边界见 `openspec/specs/openspec-integration/spec.md`「分层分支策略」）。本 PR 不改任何运行时代码 |
| 行尾/编码对账 | ✅ | 本文件与仓内既有记录同惯例（纯 CRLF、UTF-8 无 BOM、结尾换行）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` rc=0（扫全仓 tracked 文件，无竞品名残留） |
| 文档同步检查 | ✅ | `node .github/scripts/check-locale-sync.js --keys / --cjk / --py-cjk` 三项 rc=0（本 PR 零 i18n 改动） |
| CHANGELOG 收口 | ✅ | 按 `changelog-record-carrier` 新合同，`CHANGELOG.md` 与 `01-docs/learnings.md` 的写入方**只能是**聚合器 `scripts/aggregate-changelog.js` ⇒ 本 PR 对这两个文件**零改动**；条目标题与 lessons 写在下面两个小节，由聚合器搬 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/**` 与任何 UI 文件 |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（纯文档）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（由门禁推导）

### 记忆三路的落点（本 PR 只负责仓内那一路）

| 路 | 落点 | 状态 |
|----|------|------|
| 内置记忆 | `~/.dsh/profiles/memory-film-prompt-triple-impl.md` | ✅ 已写（项目事实 / 关键决策 / 踩坑记录 三段） |
| 外部记忆（本机） | `~/.gstack/projects/Colinchiu007-Multi-Publish/learnings.jsonl` | ✅ 追加 **7 条**，206 → **213** 行，逐行 `JSON.parse` 校验 **0 坏行** |
| 外部记忆（仓内） | 本篇 `## learnings` 小节（由聚合器搬进 `01-docs/learnings.md`） | ✅ 本 PR |
| EverOS | `POST /api/v1/memory/add` → `POST /api/v1/memory/flush`（session `mp-film-prompt-triple-impl-20261021-real`，app=multi-publish / project=default / sender=me） | ✅ `add → accumulated`、`flush → **extracted**`；**回读产物核验**：`~/.everos/multi-publish/default_project/users/me/episodes/episode-2026-10-21.md`（9,043 B）与 `.atomic_facts/atomic_fact-2026-10-21.md`（34,654 B），哨兵串命中 6/8 |

> EverOS 的 API 形态踩了一格（记下来免得下次再探）：`/api/v1/memory/add` 的 `messages[].timestamp` 必须是**整数 epoch 秒**，传 ISO 字符串会 422 `unable to parse string as an integer`；`messages[].sender_id` 也是必填。错误是**逐字段**报的，一次只报一个。

## CHANGELOG 条目

# docs(memory): PR-2 影视工程提示词三分（F-A）的 7 条可复用教训（mem-film-prompt-triple-impl）

- **本次只沉淀记忆，零运行时改动**：上游 PR #4127（F-A 分镜提示词三分）已合并（`05e83ddf1`），本篇把这轮**验证层对抗评审**里最值钱的 7 条教训写成仓内可检索形态。
- **落在执行记录而不是台账**：`CHANGELOG.md` 与 `01-docs/learnings.md` 的写入方只能是聚合器 `scripts/aggregate-changelog.js`（`changelog-record-carrier` 新合同），PR 差量里动这两个文件会被热写面门禁点名（当前 advisory 档，2026-10-21 由 #4145 落地）。
- **三路记忆同批写入**：内置记忆（`~/.dsh/profiles/`）、外部记忆（本机 gstack `learnings.jsonl` + 仓内本篇）、EverOS（`add → accumulated` → `flush → extracted`，并**回读 episode 文件**核验 —— 接口返回码不算成功证据）。
- **7 条教训的性质**：自扮演裁决的机械语义（`upheld` 不是闭环）、引擎回写会**整体替换** `deepReview`、评审产物名是暂存 diff 的**内容地址**、「不要丢内容」要先看清相对**哪一份**内容、写阈值前先量资产形态、RED 证明只能回退实现前就存在的文件、同类产物的结尾换行有两套惯例。

## learnings

### lesson: 自扮演裁决的「成立」不等于「已闭环」——upheld 会写出非闭环状态

**现场**：验证层对抗评审出 7 条，我按「成立 / 驳回」逐条裁决。引擎的 `blockingFromAdjudication` 里 **verdict=upheld 即记阻断**，再按 `status = blocking.length ? "self_play_blocked" : "self_play_resolved"` 写状态 —— 而门禁的闭环白名单只有 `{cleared, needs_revision, self_play_resolved}` ⇒ **`self_play_blocked` 根本不是闭环**，欠账判据当场判红。其中 5 条（i2/i3/i4/i5/i6）明明已经**在本 PR 里修完**（判据已删、账已清、测试已改），记成 upheld 就等于永远合不拢。

**根因**：verdict 这张表的语义是「**这个问题现在还是未闭合的吗**」，而直觉会把它读成「指控是否曾经成立」。两者在「已修」这一格上分叉。

**判据**：裁决的 verdict 回答的是「现在还是未闭合的问题吗」，不是「指控是否曾经成立」。已在本 PR 修完的项要记 **dismissed**，并把真实处置（成立·已修 / 前提不成立 / 部分采纳）写进 `rationale` 与 `closureNote` —— **不许靠 verdict 藏掉结论**。另注：高危域项（`highRiskDomains` 非空）自扮演不得豁免，必须补齐 `externalReview` 三格（`performedBy` 逐字等于 `expectedExternalBackend`、`evidenceRef` 形如 `https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>`、`reviewedAt` 可解析），缺一格仍按 `high_risk_requires_external` 计阻断。

### lesson: 引擎回写是整体替换——closureNote 必须在重跑之后手写

**现场**：跑完 `sh scripts/deep-review.sh` 后记录里 `status` 已是 `self_play_resolved`，但门禁的**转变检测**（base 未闭环 → head 闭环）仍判「收口无出处」。原因是引擎的 `writeBack` 写的是 `rec.deepReview = deepReview`（**整体替换**），只带 `status / performedBy / findings / blocking / note / at`，**不带 `closureNote`**；而门禁要的是「收口有出处」= `tier=external` + 可核 evidence，**或** `closureNote` 满足 `isStructuredClosureNote`（长度 ≥20 且同时含「轮 N」与 采纳/已修/否证/驳回 类处置词）。注意 `note` 字段**不算**。

**判据**：自扮演裁决的收尾顺序固定为三步：**填裁决表 → 重跑 deep-review（复用存档 critique、零模型调用）→ 再手写 `closureNote`**。顺序反了会被下一次引擎运行冲掉（`writeBack` 每次都整体替换）。另外「哪些问题还没裁决」这件事本身要能从记录里读出来 —— 引擎给的 `note: 裁决尚未填写：N/M 条未定（i1, i2, …）` 字段就是干这个的，缺失时「没人裁决」会被当成「全部不成立」放行。

### lesson: 评审产物的文件名是暂存 diff 的内容地址——它必须与被评审的代码同提交

**现场**：pre-commit 报「范围漂移：以下改动文件不在方案声明范围内」，列出的 8 个文件是评审产物、新建模块、新测试与 change 目录文档。查下去发现：`scripts/ccg-gate.js::readDecisionRecords()` 扫的是**整个** `.ccg/reviews` 目录、只按 `decidedAt` 取最新一条 `layer=plan` 记录，**不认分支归属**。实测该目录 11 条 `layer=plan` 记录里最新的是 `be84f449a192…`（`decidedAt=2026-10-20T18:35:39Z`，75 个 `plannedFiles`，内容是 `01-docs/PRD-FILM-PROMPT-ASSETS-2026-10-20.md` 等 —— **另一个 change** 的方案）⇒ 拿它比我的文件，我的文件自然全部「不在声明范围内」。

**判据**：`.ccg/reviews/<name>.json` 的文件名 = **暂存 diff（排除 `.ccg`）的 sha256**，引擎的 `readDecision()` 与 `deep-review.sh` 都靠「把该 diff 的哈希与记录里的 `stagedDiffHash` 相等」来定位记录 ⇒ **评审元数据拆到另一笔提交，指向的 diff 里没有那些代码，引擎找不到记录、评审结论直接失联**。所以「同提交」不是混装，是**引擎寻址契约的要求**。遇到这类告警要先分清三种形态：**① 跨 change 归因缺陷**（拿的是别人的方案清单）**② 快照滞后**（自己的方案文档已同步，但记录里的 `plannedFiles` 是送审时的快照）**③ 真·范围失控**（超出本 PR 承诺的边界）—— 判据分别是「那条记录属不属于本 change」「方案文档是否已同步」「是否越界」。修归因口径属**改谁来守门**，须人工过目。

### lesson: 「不要丢内容」的评审意见，要先看清它相对**哪一份**内容

**现场**：评审 i1（Critical）指「`buildMotionPrompt` 只保留 ACTION/CHARACTER 块，未识别描述块被丢弃 ⇒ 运动提示词内容丢失」，并建议「给未识别块加 `else → motionParts`」。按建议改完实测：真实 153 模板的「运动总量 ÷ 首帧总量」由 **0.146 变成 48.7**。查下来发现前提是错的 —— `buildTemplatePrompt` 的 `allParts`（**改造前既有**的行为）只收 GEO / ACTION TIMING / AUDIO / CHARACTER ACTING / POSITIVE CONSTRAINTS 五类块标记，**散文块从来就不在首帧图提示词里** ⇒ 「运动子集不含散文」不是相对用户可见内容的丢失。塞进去反而让运动子集包含了首帧图根本没有的段落，破坏子集关系、两套口径分叉。

**判据**：评审说「丢内容」时，先定位它相对**哪一份**内容丢 —— 同一个「派生视图」相对**源视图**是子集（正常），相对**原始素材**才是缺失（但原始素材的散文本来就没进过任何提示词）。判定「派生视图是否丢内容」的正确不变量是**子集关系**（派生 ⊆ 源），不是「看起来全不全」；把不变量写成**可执行判据**（内联 mock + 真实资产双覆盖），下次同样的意见才带不偏。另注：**驳回一条意见不等于那个现象不存在** —— 本次顺手登记的既有缺口（散文正文不进拼装结果，改造前就如此）已单独写进 PRD §3.1 与执行记录，不因本条被驳回而消失。

### lesson: 写阈值前先量资产的真实形态——逐镜比例判据在真实数据上必然失败

**现场**：方案写「逐镜断言 `videoPrompt.length <= 0.6 * imagePrompt.length`」。实施时量存量 kit（153 个模板）：`AUDIO` 命中 62 条（其中 29 条真正成块），`GEO SPATIAL LAYOUT` / `ACTION TIMING` / `CHARACTER ACTING` / `POSITIVE CONSTRAINTS` 命中 **0** 条，`[CHARACTER:` 命中 0 条 ⇒ **124 个模板的运动子集与首帧图逐字相同**（比值 1.0）⇒ 逐镜固定比例**必然失败**。改取全体聚合比后又发现比值**随 beat 长度变化**（3 行剧本段落 0.207 / 单行 7 字符 0.146）⇒ 判据必须写明测量条件，否则换个输入就假红。

**判据**：任何「比值 / 比例 / 上限」类判据，先量三件事：**① 目标分布的形状**（有多少样本落在例外侧 —— 本例 124/153 逐字相同，逐镜判据先天不成立）；**② 判据的输入依赖**（本例比值依赖 beat 长度，判据不写条件就会在别的输入下假红）；**③ 例外侧的规模**（本例只有 29 条真正变短 ⇒ 这条能力在存量资产上的价值边界就是 29 条，别在文档里写成「普遍变短」）。判据从「逐镜」降到「全体聚合」不是放宽，是换成**与数据形状相称**的口径。

### lesson: RED 证明只能回退「实现前就存在」的文件——否则整个测试文件在加载期就挂

**现场**：做 RED 证明时把本 PR 的源文件整体回退到实现前，其中包含**本 PR 新建**的 `shot-prompts.js` —— 测试文件在 `require('./shot-prompts')` 就炸了，vitest 报「**0 test** / Failed Suites 1」。这**没有证明力**：文件都加载不进去，说明的是「缺依赖」，不是「断言会红」。改成只回退**实现前就存在**的 6 个源文件、新建模块留在原位 ⇒ 20 例中 **15 例变红**、5 例通过（通过的是不依赖新行为的用例 + 「首帧图逐字不变」零回归锁）—— 这才是可用的 RED 证据。

**判据**：RED 证明的读数必须是「**逐条用例**变红」，不是「整个文件加载失败」。回退时**只回退实现前就存在的文件**（新建模块留在原位，保证测试文件能加载、断言能逐条执行）。另外做回退实验必须**无条件还原并逐字节校验**（本轮用「备份 → 回退 → 跑 → 还原 → sha256 比对」四步，还原失败要比对失败更响），否则一次实验就把工作区留在半旧不新的状态。

### lesson: 同一类产物可能有不同的结尾换行惯例——它会让行尾双口径对账差 1 行

**现场**：改完评审产物后跑行尾对账（`git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径应一致），其中一个文件差 1 行。查下来是**结尾换行**：仓内 `.ccg/reviews/*.json` 有两套惯例 —— 判定器 `ccg-review-decider.js` 写的**不带**结尾换行（`JSON.stringify(record, null, 2)`）、引擎回写 `writeBack` 写的**带**（`+ "\n"`）；同一个文件多/少一个结尾换行，末行的 `\ No newline at end of file` 标记就会让两口径数出不同的增删行数。

**判据**：改「由某个工具生成」的文件前，先 `git show HEAD:<path>` 看**尾部字节**，按该文件**原有**惯例写，别用统一的 `+ "\n"`。这类差异**不是**内容变化（blob 级比对会显示 CR 计数一致），但会让「行尾对账」这类双口径判据不一致 —— **判据不一致时先怀疑口径而不是内容**，逐条 diff 两口径的差集就能定位到具体行。

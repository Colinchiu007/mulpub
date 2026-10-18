---
record: subtitle-split-quality
task: 字幕层分句短语边界感知切分 v1.3 —— 修掉无标点长块硬切的 11 处坏切（三端同构 + 跨仓）
date: 2026-10-18
---

## 本次执行记录：字幕分句短语边界 v1.3（subtitle-split-quality，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 通过 | 运行时代码：worktree `D:\Data\projects\mp-worktrees\mp-subtitle-split-quality` + 裸分支 `subtitle-split-quality`（非 C 盘）；跨仓 `smart-sentence-splitter` 独立 worktree `D:\Data\projects\mp-worktrees\sss-subtitle-phrase-boundary` + 分支 `subtitle-phrase-boundary-v1.3`（基线 `origin/main` = `313e7a5`） |
| 第一性原因（QM-5 ①） | 通过 | 不是「引擎没跑」：8002 真实 `/v1/split` 经 `normalizeServiceSplitResult` 后 `subtitleSource=smart-sentence-splitter`、`degraded=false`、14/14 场景采纳、0 回退。根因是 `isGoodCut` 三类判据（`semantic_lead`/`good_lead`/`good_tail`）覆盖不到中文动词/名词短语自然右边界，且 `wordSafeSplit` 在 `len==max(15)` 时合法窗口 `i∈[8,7]` 为空集 ⇒ 返回 -1 ⇒ `findSafeCutPosition` 只校验「安全」不校验语义 ⇒ 算术位置裸切。插桩证据见 `openspec/changes/subtitle-phrase-boundary-v1.3/diagnosis.md` §3 |
| 逃逸分析（QM-5 ②） | 通过 | 逐层输出：① 单元 —— 26 条共享向量的 `expected_blocks` 全是「已通过」的样本，**没有一条覆盖「无标点且 min+min>max」这一形态**；② 集成 —— TS `subtitle-vectors.test.ts` 与 JS `story2video-segmentation-vectors.test.js` 都只比对标量输出，没有「切点必须落在语义边界」的性质断言；③ 端到端 —— `e2e-pipeline-orchestrator.test.js` 的 5 段用户坏例只断言「不劈保护短语」，无标点硬切裸奔不在断言面内；④ 三端一致 —— `parity.test.js` 只比 TS vs JS，**Python vs TS 无任何自动比对**，故三端「一致地错」不会被任何门禁发现；⑤ 代码审查 —— 原 `findSafeCutPosition` 的注释把它描述成「安全校验」，读者看不出它同时承担了「语义切点」职责 |
| 修复 + 回归保护（QM-5 ④） | 通过 | 修复：规则表新增 `word_split.phrase_boundary`（19 对显式短语 + `min_head_relax=2`），三处接入（`lengthSplit` 累积阶段提前切分 / `isGoodCut` 第四类好切点 / `wordSafeSplit` 短语分支）。回归保护：新增 10 条 `v1.3_phrase_boundary_*` 共享向量（语义 = 「短语右边界内不得劈词」），落在 `packages/story2video-engine/tests/fixtures/subtitle_segmentation_vectors.json`，由 TS `subtitle-vectors.test.ts` / JS `story2video-segmentation-vectors.test.js` / Python `tests/unit/test_subtitle_vectors.py` 三处消费；每条的 `short_block_exceptions` 强制显式声明 `< min_chars` 块 |
| 防止再次发生（QM-5 ⑤） | 通过 | ① `01-docs/learnings.md` 新增四条 lesson（editable install 指向原仓库 / 三端一致 = 三仓四副本 / 候选为空 ≠ 候选错 / 分词器不可作硬判据）；② `openspec/specs/subtitle-split-quality/spec.md` 新增「短语边界感知切分（v1.3）」Requirement（6 个 Scenario，含三端一致与缺省向后兼容）；③ `01-docs/PRD.md` 与 `01-docs/PRD-video-creation.md` 字幕层合同补 v1.3 语义；④ 规范里显式写下「本地词边界判断不得把普通分词结果升级为跨实现的绝对词典」，本次实测 jieba vs segmentit 8/8 行不一致即为该条的实证 |
| 行尾与 diff 对账 | 通过 | mulpub：工作副本为 CRLF、`.gitattributes` 有 `* text=auto`，改动按原行尾落盘；`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径一致（删除数 0）。跨仓 `smart-sentence-splitter` 无 `.gitattributes` 且 `core.autocrlf=false`，其 `subtitle_rules.json` 工作副本为 CRLF、`subtitle_segmentation_vectors.json` 为 LF —— 已按各自原行尾写回并核验：rules `66/40`、vectors `195/0` 两口径相同（首轮曾把 vectors 从 CRLF 写成 LF 导致 1130/935 全文件替换，已修正） |
| 接线棘轮 | 不适用 | 本次零新增 `*.test.js` / `*.test.ts` 文件，只在既有测试的**数据驱动源**（共享向量 JSON）加用例；三处消费者均已在 workflow 里被点名 |
| QM-1 打包 / QM-4 视觉 | QM-1 通过 / QM-4 不适用 | 本次触 `apps/desktop/electron/services/story2video-segmentation-engine.js` ⇒ QM-1 触发。取证链：`node scripts/verify-worktree-deps.js` 11 包解析到本 worktree → `pnpm run build:vue` exit 0（42s，渲染层产物 1.40 MB main chunk）→ `electron-builder --win --dir --publish never` **exit 0**（asar 140.36 MB）→ **运行时**三层 stderr 判据 **层③ PASS**（stderr 0 字节、stdout 22247 字节、红线命中 0）+ 独立存活断言（12s 窗口内进程仍在，子进程 env 经 `scripts/lib/qm1-child-env.js` 剔除 `ELECTRON_RUN_AS_NODE`）→ asar 内 require 链验证：`node_modules/@multi-publish/story2video-engine/src/subtitle-rules.json` 读到 `pairs=19 relax=2`、`electron/services/story2video-segmentation-engine.js` 8 个导出全可加载、**在打包产物内跑真实切分得到修复后结果** `["很多人以为","这是一个简单的政治表态","是选举年为了","拉拢某些特定票仓的无奈之举"]`。⚠️ 如实记一条：**打包器自身**的 stderr 非空（`packages/remotion-composer/node_modules/@remotion/studio-server/node_modules/@babel/...` 一批 `The system cannot find the path specified`，Windows MAX_PATH 260 溢出），但 (a) `electron-builder` 退出码 0、(b) 运行时 stderr 为空、(c) 失败路径全部落在 remotion 依赖树内、与本次改动的单文件纯函数模块无 require 关系 ⇒ 判为**既有打包噪声**，不作为本次 QM-1 失败依据，也不在本 PR 顺手修（改 MAX_PATH 需要动构建配置，属独立切片）。QM-4：零 Vue/CSS/locale 改动，不触视觉 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录，不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 本行不需事后改写：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>` |

### 遗留（不假装已闭合）

- **Python vs TS 仍无 CI 自动比对**。本次三端一致靠「同一份向量文件 + 人工起 8002 跑 E2E」实证（`subtitleSource=smart-sentence-splitter`、14/14 采纳、0 回退、99 块），但这条链路默认不进 PR 门禁。要让「三端一致」从人工承诺变成机械判据，需要把 `e2e-pipeline-orchestrator.test.js` 的 8002 用例接进 CI 或加一条「Python 输出快照 ↔ TS 输出快照」的离线比对。本次不顺手做，因为起服务要装依赖、会拖长 CI 关键路径。
- **`phrase_boundary.pairs` 是显式枚举，天然有覆盖率上限**。本次 19 对来自用户文案与既有语料，未做系统性语料挖掘。表外的短语仍可能走回 MAX 兜底裸切。改善方向（未排期）：从历史文案里统计「被裸切劈开的双字词」，把高频项批量补进表；或引入「块尾必须是完整双字词右边界」的通用判据（风险：需先解决分词器不可作硬判据这一前置问题）。
- **跨仓两 PR 的合并时序**。`smart-sentence-splitter` 侧（规则表 + `subtitle_segmenter.py` + 向量副本）在独立分支 `subtitle-phrase-boundary-v1.3`，与 mulpub 侧是两个 PR。若 mulpub 先合、sidecar 后合，期间线上 8002 仍是旧规则，mulpub 侧新增的 10 条向量在 E2E 上会红（单测不受影响，因为三端各读自己仓的副本）。两 PR 需同批推进，且合并顺序要在 PR 正文里写清。
- **本次只修了「无标点长块硬切」这一族坏切**。用户反馈里若有「标点位置本身不合理」（原文缺标点/错标点导致块划分错）的形态，v1.3 不覆盖——那属于上游分句（`split_sentences`）与标点预测，不在短语边界的作用面内。

# Proposal: subtitle-phrase-boundary-v1.3

## Why

用户反馈（项目 `mvdnrqvc_b77q`，2026-10-18）：视频创作任务的字幕层分句结果不理想，存在大量不合理断句。

调查结论（取证见 `openspec/records/subtitle-split-quality-diagnosis.md`）：

1. **字幕层走的是分句引擎，不是降级方法**——实测 8002 真实 `/v1/split` 响应经 `normalizeServiceSplitResult` 质量门后，`subtitleSource = smart-sentence-splitter`、`degraded = false`、14/14 场景采纳引擎字幕、0 回退。坏切就是引擎算法本身的输出。
2. **坏切是算法缺陷，三端一致**——Python 引擎（jieba）与 TS/JS 镜像（segmentit）对同 6 个场景逐字输出相同。
3. **根因**（插桩 `wordSafeSplit` / `isGoodCut` / `lengthSplit` MAX 分支定位）：
   - `isGoodCut` 的判定面过窄：仅 `semantic_lead`（提/把/还/绝/已/依）、`good_lead`（和与及而但或把被从向对为于并且且成）、`good_tail`（的得了是就都也还要会能可将则若虽因着过地得正于…）三类算好切点。中文里大量安全切点是动词/名词短语的自然右边界（如「为了｜拉拢」「宏大｜的」「那段历史｜对今天」），三类都不命中。
   - `wordSafeSplit` 的准入条件 `i >= minHead(8)` 与尾块 `>= tailMin(8)` 双重挤压，使 11 个坏切场景里 9 个的合法窗口内**一个好切点都没有**，返回 -1。
   - 随后 `findSafeCutPosition` 在 `[1, max]` 内只校验「安全」（不劈保护短语/代理对/小数点），**不校验语义**，等于用算术位置裸切——正是规范 `subtitle-split-quality` 明确禁止的「不得用固定算术位置绕过保护合同」。
4. **分词器不可作为硬判据**——实测 jieba 与 segmentit 在同一文本上的分词跨度 8/8 行全部不一致，且 `segmenterSpans` 的贪心对齐在中文连续文本上会丢掉大量边界。若把「分词边界」升级为跨实现硬判据，会立刻破坏三端逐字一致的既有契约。

## What Changes

- **新增 `word_split.phrase_boundary` 规则段（v1.3，单源 `subtitle-rules.json`，三端同步加载）**：
  - `pairs`：显式成对短语表 `[[left, next], ...]`。块以 `left` 结尾、且紧随其后的字符命中 `next` 时构成短语右边界。用成对登记而非单侧字符集，避免把「某｜些」「票仓的｜无奈」这类假边界放进来。
  - `min_head_relax: 2`：短语边界路径允许头块放宽到 `min_chars - 2`（与既有 `tailMin` 软约束同源，规范已有先例）。
- **`lengthSplit` 新增短语边界提前切分分支**：短语右边界与标点等价，在累积阶段就兑现，不等 MAX 分支的裸切兜底（那里窗口已错过最佳切点）。
- **`isGoodCut` 与 `wordSafeSplit` 接入短语边界判定**：作为第四类好切点，排序在 `semantic_lead` / `good_lead` 之后、`good_tail` 之前。
- **共享向量新增 10 条 v1.3 用例**（`v1.3_phrase_boundary_*`），`expected_blocks` 为人工评审确认的手工真值，`short_block_exceptions` 显式声明 < min_chars 块。
- **修复效果**：11 处坏切全部修复（详见 design.md §6 前后对比表）。

## Capabilities

### Modified Capabilities

- `subtitle-split-quality`: 新增「短语边界感知切分（v1.3）」Requirement——无标点硬切时优先落在显式成对短语的右边界；头块允许放宽到 `min_chars - min_head_relax`；`min_chars` 不变量例外必须显式声明。

## Impact

- **规则表单源**：`packages/story2video-engine/src/subtitle-rules.json`（mulpub）与 `smart-sentence-splitter` 仓 `src/splitter/scene_subtitle/subtitle_rules.json` 同步（跨仓，独立 PR）。
- **TS 权威版**：`packages/story2video-engine/src/text-segmentation.ts`（`PHRASE_BOUNDARY_*` 常量、`isPhraseBoundary`、`findPhraseBoundaryPos`、`lengthSplit` 提前切分分支、`isGoodCut` / `wordSafeSplit` 接入）。
- **JS 镜像**：`apps/desktop/electron/services/story2video-segmentation-engine.js`（同构改动，逐行对齐 TS）。
- **Python sidecar**：`smart-sentence-splitter` 仓 `src/splitter/scene_subtitle/subtitle_segmenter.py`（`PHRASE_BOUNDARY_*`、`_is_phrase_boundary`、`_length_split` / `_is_good_cut` / `_word_safe_split` 接入）。
- **共享向量**：`packages/story2video-engine/tests/fixtures/subtitle_segmentation_vectors.json`（mulpub，+10 条）与 `smart-sentence-splitter` 仓 `tests/vectors/subtitle_segmentation_vectors.json`（同步副本）。
- **既有行为不变**：`no_cut_bigrams` 保护短语、引号配对、`了` 后宾语保护、小数点豁免、时间戳舍入全部保持；三端对同一份向量逐字一致。

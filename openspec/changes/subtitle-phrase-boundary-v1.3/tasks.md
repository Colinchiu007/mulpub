# Tasks: subtitle-phrase-boundary-v1.3

## 1. 规则表单源

- [x] 1.1 `packages/story2video-engine/src/subtitle-rules.json` 新增 `word_split.phrase_boundary` 段（`min_head_relax: 2` + 19 对 `pairs`）
- [x] 1.2 同步副本到 `smart-sentence-splitter` 仓 `src/splitter/scene_subtitle/subtitle_rules.json`（跨仓，独立 PR）
- [x] 1.3 去重（`["不再是","理所"]` 曾重复登记两次，已清理）

## 2. 共享向量（TDD RED）

- [x] 2.1 `packages/story2video-engine/tests/fixtures/subtitle_segmentation_vectors.json` 新增 10 条 `v1.3_phrase_boundary_*` 向量
- [x] 2.2 每条向量的 `short_block_exceptions` 显式声明 `< min_chars` 块及 reason
- [x] 2.3 同步到 `smart-sentence-splitter` 仓 `tests/vectors/subtitle_segmentation_vectors.json`
- [x] 2.4 确认 RED：TS 16 failed / JS 16 failed / Python 10 failed

## 3. TS 权威版实现

- [x] 3.1 `text-segmentation.ts` 新增 `PHRASE_BOUNDARY_PAIRS` / `PHRASE_BOUNDARY_MIN_HEAD_RELAX` / `PHRASE_BOUNDARY_MIN_HEAD` 常量与 `isPhraseBoundary` static 方法
- [x] 3.2 `lengthSplit` 新增短语边界提前切分分支（接入点 A）
- [x] 3.3 `isGoodCut` 接入短语边界（接入点 B）
- [x] 3.4 `wordSafeSplit` 新增短语分支 + 头块放宽（接入点 C）
- [x] 3.5 `pnpm --filter @multi-publish/story2video-engine test` → 219 passed

## 4. JS 镜像实现（逐行对齐 TS）

- [x] 4.1 `story2video-segmentation-engine.js` 新增 `PHRASE_BOUNDARY_PAIRS` / `PHRASE_BOUNDARY_MIN_HEAD` / `isPhraseBoundary`
- [x] 4.2 `subtitleLengthSplit` 新增提前切分分支
- [x] 4.3 `isGoodCut` / `wordSafeSplit` 接入
- [x] 4.4 `apps/desktop` 三测试文件全绿：`story2video-segmentation-vectors.test.js` + `story2video-segmentation-parity.test.js` + `story2video-segmentation.test.js` → 168 passed

## 5. Python sidecar 实现（跨仓 worktree）

- [x] 5.1 建隔离 worktree `D:/Data/projects/mp-worktrees/sss-subtitle-phrase-boundary`（分支 `subtitle-phrase-boundary-v1.3`，基线 `origin/main`）
- [x] 5.2 `subtitle_segmenter.py` 新增 `PHRASE_BOUNDARY_PAIRS` / `PHRASE_BOUNDARY_MIN_HEAD_RELAX` / `_is_phrase_boundary`
- [x] 5.3 `_length_split` / `_is_good_cut` / `_word_safe_split` 接入
- [x] 5.4 `pytest tests/` → 577 passed, 9 skipped
- [x] 5.5 **踩坑记录**：`splitter` 包是 editable install 指向原仓库，worktree 内跑测试必须 `PYTHONPATH=<worktree>/src`，否则测的是旧代码

## 6. 真实链路验证

- [x] 6.1 起 8002（worktree Python 代码）→ POST `/v1/split` → `normalizeServiceSplitResult`
- [x] 6.2 结果：`subtitleSource = smart-sentence-splitter`、`degraded = false`、14/14 场景采纳、0 回退、99 块
- [x] 6.3 11 处坏切全部修复，0 回归

## 7. 文档

- [x] 7.1 `openspec/changes/subtitle-phrase-boundary-v1.3/diagnosis.md`（根因诊断，含调用链确认与插桩证据）
- [x] 7.2 `openspec/changes/subtitle-phrase-boundary-v1.3/{proposal,design,tasks}.md`
- [x] 7.3 `openspec/specs/subtitle-split-quality/spec.md` 新增「短语边界感知切分（v1.3）」Requirement（6 Scenario）
- [x] 7.4 `01-docs/PRD.md` + `01-docs/PRD-video-creation.md` 字幕层合同补充 v1.3 语义
- [x] 7.5 `CHANGELOG.md` 追加本次变更（mulpub）；`smart-sentence-splitter` 仓 `[0.18.0]` 段落
- [x] 7.6 `01-docs/learnings.md` 追加四条 lesson（editable install 指向 / 三端一致 = 三仓四副本 / 候选为空 ≠ 候选错 / 分词器不可作硬判据）

## 8. 质量门禁

- [x] 8.1 行尾两口径对账：mulpub（`text=auto`）10 个文件两口径逐行相等；sss 仓 `subtitle_rules.json` 是 **mixed 行尾**，按原行尾分布精确插入后两口径相等（26/1）
- [x] 8.2 品牌残留 `node scripts/check-no-brand-residue.js` → PASS（10282 tracked 文件）
- [x] 8.3 QM-1 打包：`build:vue` exit 0 → `electron-builder --win --dir` exit 0（asar 140.36 MB）→ 运行时 stderr 0 字节（层③ PASS）→ 存活断言通过 → asar 内 require 链与真实切分验证通过
- [x] 8.4 QM-2 代码审查必检项（单文件纯函数模块，无新增 require、无同步阻塞原语、无 IPC 参数变更）
- [x] 8.5 `openspec/records/subtitle-split-quality.md` 执行记录（含 QM-5 五步与遗留四点）
- [ ] 8.6 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（commit 后取证 → 预期 mixed，走完整门禁）
- [ ] 8.7 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce`
- [ ] 8.8 推送 + PR + CI 通过后自动合并
- [ ] 8.9 跨仓 PR #33（`smart-sentence-splitter`）同批推进与合并

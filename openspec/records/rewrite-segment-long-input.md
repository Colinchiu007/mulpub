---
record: rewrite-segment-long-input
task: 遗留收口第二刀——>50000 长文分段改写（三级切分 + 逐段改写 + 合并后处理）+ 渲染层不再预截断 + 模型/引擎截断分型 + 分段 meta 与失败文案
date: 2026-10-20
---

## 本次执行记录：长文分段改写（rewrite-segment-long-input，2026-10-20）

> 本文件为执行记录（唯一强制载体）。状态列不手写远程同步状态词：合并后由 `scripts/lib/merge-ledger.js` 推导。
> 本刀是 change `rewrite-segment-and-finish-reason` 的第二刀（proposal 见 `openspec/changes/rewrite-segment-and-finish-reason/proposal.md`，已按五轴评审收敛）。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 隔离 worktree `mp-worktrees/mp-rewrite-segment-contract` + 裸分支 `rewrite-segment-contract`（与第一刀同分支同 worktree，第二刀为增量提交） |
| 第一性原因（QM-5 ①） | ✅ | 第一刀把 `_rewriteOnce` 抽出并让 `_validate` 只保空内容校验后，>50000 输入**无路可走**——既不再被 TOO_LONG 硬拒（守卫已移除），也没有分段实现，等于把旧限制拆掉却没装新能力。分段阈值 50000 是「渲染层可透传 / 引擎可处理」的接缝 |
| 逃逸分析（QM-5 ②） | ✅ | ① 旧 `prepareRewriteInput` 预截断使分段路径在采集页**永不可达**（第三轴评审 M1 预警，本刀修）；② 段级区间照搬 ratio 会让各段上限之和 72000 > 全篇 50000，合并必砍 22000 字（第三轴 M3 预警，本刀按份额分配）；③ 任一段失败若返回半成品，用户会把残缺稿当成品——本刀整篇失败 + 结构化段号 |
| 修复 + 回归保护（QM-5 ④） | ✅ | segment-splitter 11 例（段落/句子/硬切三级 + 无损性 + emoji 不劈）；引擎 S1-S5 五例（分段走通 / 分片 prompt / 失败段号 / 段区间份额 / 全篇副作用一次）；渲染层 8 例（模型截断横幅分型 ×3、分段 meta ×2、meta 透传 ×2、分段失败文案 ×1）；结构锁改写（`prepareRewriteInput` 不再截断 + `shouldSegmentRewrite` 判据） |
| 防止再次发生（QM-5 ⑤） | ✅ | learnings 3 条（切分层级必须含硬切兜底 / 渲染层预截断会让引擎新能力成死代码 / 段级配额必须对全篇上限求和）+ 本记录 + CHANGELOG + PRD |
| 行尾与 diff 对账 | ✅ | 提交后取证 |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → OK |
| QM-1 打包 | ✅ | `build:vue` rc=0；`electron-builder --dir` rc=0；asar 实测：`segment-splitter.js`（4480B）、`segment-rewriter.js`（5758B）、`llm-result.js`（1970B）均在包内；核心文件不再内联分段编排、已委派 `require('./segment-rewriter')`、含 `> MAX_INPUT_CHARS` 分流；切分器含硬切兜底、分段器含段级区间推导 |
| QM-2 代码必检项 | ✅ | 无同步阻塞原语（切分为纯同步字符串处理，O(n)，5 万字量级无压力）；无新增 IPC；无 v-html；无硬编码等待；串行调用不打满 governor（串行天然排队） |
| QM-4 视觉回归 | N/A（有据） | 新增两条横幅 + 一条 meta 文本均为条件渲染（仅对应字段为真时出现）；复用 `.rewrite-output-truncated-banner` 既有样式，模型截断加独立修饰类 `rewrite-model-truncated-banner` |
| QM-6 CCG 双模型外部评审 | 由 pre-commit CCG 判定 | 见提交后判定记录 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

## 设计要点（对应 proposal 各条评审意见）

### 1. 三级切分（`segment-splitter.js`，第五轴 M3）

- ① 段落边界 `\n\s*\n` 贪心合并到 `SEGMENT_SIZE = 12000` 码点；
- ② 单段仍超长 ⇒ 句子边界（中文 `。！？；…」` + 英文 `.!?`）二次切；
- ③ 仍超长（无段落无标点的英文/URL/代码/转写）⇒ **码点硬切兜底**，保证 segment 永不超上限；
- 无损性契约：每段都是原文的**连续子串**且顺序覆盖（无丢段/重复段/编造段），由测试断言；
- `chars` 字段统一按码点（`[...text].length`），emoji 代理对不劈。

`SEGMENT_SIZE = 12000` 依据（第四轴 M5）：`max_tokens 64000 ÷ 2` —— 输入 12000 字 ≈ 18K token + 输出 ≤12000 字 ≈ 18K token + prompt/知识库余量 ≈ 40K < 64K 安全线。

### 2. 分段编排（`segment-rewriter.js`，独立模块）

- 为何独立：`rewrite-engine-core.js` 已接近 `check-max-lines.js` 登记基线，且分段编排是独立能力；
- 逐段调用 `engine._rewriteOnce`（复用 prompt 构建/后处理/质量评估，**不复制**）；
- 每段 systemPrompt 注入「长文分片 i/n：仅改写本片段，不总结、不续写其他片段、保留段落边界」；
- 段结果 `\n\n` 拼接后**复用 `_postProcess`**（不新造第三条截断语义，第五轴 M4）；
- 失败：整篇失败 + `segmentIndex`/`segmentCount` 结构化字段，错误文案「第 i/n 段改写失败，前面段的进度未保留」；**不返回半成品**、不写知识库；
- 全篇级副作用（KB recordFeedback、viralScorer）由 `rewrite()` 执行**一次**（第一刀已上移），S5 用调用计数锁定。

### 3. 段级字数区间（第三轴 M3）

`deriveSegmentRange(userRange, segmentCount)`：用户显式区间 ⇒ 每段 `max = floor(全篇 max / 段数)`、`min = min(全篇 min, 每段 max)`；无显式区间 ⇒ 不注入字数指令（由后处理默认 3000 兜底）。保证**各段上限之和 ≤ 全篇上限**，杜绝「为免截断而分段、分段反而制造截断」。

### 4. 渲染层（第三轴 M1/M5、第四轴 C2）

- `prepareRewriteInput` **不再预截断**（只做空内容归一），新增 `shouldSegmentRewrite` 判据；
- 采集页：超阈值改弹 **info**「将分段改写（耗时与费用增加、其他 AI 功能可能变慢）」，删除旧的「已截取前 N 字」warning 分支与 `collection.rewriteTruncated` 键；
- 改写页：同样在 `startRewrite` 前弹分段提示；结果卡 meta 行新增「分段改写 ×N」；新增模型截断横幅（`data-testid="rewrite-model-truncated"`），文案明确「这是模型侧限制，调大字数控制不一定有效」；
- 采集页成功分支新增 `meta` 四字段透传（`outputTruncated`/`outputLength`/`modelTruncated`/`segmented`），修第三轴 M5 的静默丢弃；
- 分段失败错误码映射 `REWRITE_SEGMENT_FAILED`（带 1-based `{index}`/`{total}` 插值），zh/en 成对。

## 自测块（提交前当场跑）

```
cd packages/rewrite-engine && node ../../node_modules/vitest/vitest.mjs run
→ Test Files 16 passed / Tests 255 passed
  （segment-splitter 11 + S1-S5 五例 + 既有 239；W3 已改写为「50001 走分段」）

cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run \
  src/views/RewriteView.output-truncated.test.js src/views/Collection.rewrite-input-limit.test.js \
  src/views/RewriteView.test.js src/utils/rewrite-engine-limits.test.js src/utils/rewrite-engine-error.test.js
→ Test Files 5 passed / Tests 136 passed
cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run \
  src/views/Collection.test.js src/utils/rewrite-defaults.test.js \
  src/utils/user-facing-error.test.js src/utils/rewrite-lineage.test.js
→ Tests 274 passed（与上一组合计覆盖全部受影响面）

cd packages/python-backend && python -m pytest tests/test_aggregation.py -q
→ 51 passed（第一刀已对齐 49999/50000 边界，本刀未改 Python）

eslint（apps/desktop 13 文件）→ rc=0
check-unwired-tests → OK；locale keys → PASS（2167）；locale CJK → PASS；max-lines → ✅；brand-residue → PASS；doc-abs-paths → PASS
pnpm run build:vue → rc=0；electron-builder --dir → rc=0
asar 实测：segment-splitter/segment-rewriter/llm-result 均在包内；core 已委派
```

## 遗留（不假装已闭合）

- **段间一致性**：不做全局上下文摘要/术语表，跨段术语与人称漂移在结构上仍可能发生（UI 文案已如实提示「可能有一致性折损」）。
- **失败续跑**：任一段失败即整篇丢弃、重试全额计费（proposal §不做已登记理由：段数 ≤6、串行分钟级，状态持久化成本超过收益）。
- **模型侧截断**：合并结果不置 `modelTruncated`（单段被模型截断的归属在段内，合并后无法归属到整篇）；单次路径已可见。
- **取消机制**：`ai:rewrite` 无取消通道，长文分段期间用户只能等待。
- **Python 旁路**：`content` 无长度上限且不分段（桌面主链路已 Node 化）。

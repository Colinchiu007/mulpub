---
record: rewrite-segment-contract
task: 遗留收口第一刀——finish_reason 全链路透传（modelTruncated）+ Python 链路字数上限对齐 50000 + rewrite() 抽取 _rewriteOnce 保形重构
date: 2026-10-20
---

## 本次执行记录：契约 + 对齐 + 抽取重构（rewrite-segment-contract，2026-10-20）

> 本文件为执行记录（唯一强制载体）。状态列不手写远程同步状态词：合并后由 `scripts/lib/merge-ledger.js` 推导。
> 本刀是 change `rewrite-segment-and-finish-reason` 的第一刀；第二刀（>50000 分段改写）依赖本刀的 `_rewriteOnce` 与 llmClient 契约测试。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 隔离 worktree `mp-worktrees/mp-rewrite-segment-contract` + 裸分支 `rewrite-segment-contract`（入口 `start-mp-task.ps1`，基于 origin/main）；依赖三件套全绿 |
| 第一性原因（QM-5 ①） | ✅ | rewrite-limits-50000 放开上限后暴露三条契约尾巴：① provider `finish_reason` 在 adapter 已返回但 ai-generator→llmClient→引擎全链路只传 string，模型侧截断不可见；② Python `RewriteRequest` 字数上界仍钉 5999/6000，与 JS 引擎 50000 不一致；③ 引擎 `rewrite()` 是 160 行单体，无单次改写子方法，分段改写无可复用单元 |
| 逃逸分析（QM-5 ②） | ✅ | ① finish_reason：既有测试只 mock `chat` 返回 string（60+ 处），契约扩展点无测试；② Python：test_aggregation.py 只测 7000 越界，未测「与 JS 引擎对齐」这一跨语言契约（无跨语言锁）；③ 单体方法：219 例测试锁行为但不锁结构，抽取无红灯驱动 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 见「§自测块」：llm-result 10 例（双形态归一化 + 截断语义映射）+ L4-L10 七例（modelTruncated/EMPTY_RESULT 不漏判/LLM_ERROR 不吞）+ keyword object 三例（第二消费点不静默失效）+ Python 边界两改；保形抽取后 239 引擎 + 192 渲染层 + 51 Python 全绿（零行为变化） |
| 防止再次发生（QM-5 ⑤） | ✅ | learnings 3 条（双形态契约必须单点归一化 / 会话级状态追不上分段编排 / 放开上限要同帧 grep 旁路链路）+ 本记录 + CHANGELOG |
| 行尾与 diff 对账 | ✅ | 提交后取证（见自测块） |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → OK |
| QM-1 打包 | ✅ | `build:vue` rc=0；`electron-builder --dir` rc=0；asar 实测含 `llm-result.js` 的 `normalizeChatResult` |
| QM-2 代码必检项 | ✅ | 无同步阻塞原语、无新增 IPC、无 v-html；保形抽取的副作用边界（KB 写入/viralScorer 上移全篇级）用「调用计数 + 229 例零行为变化」锁 |
| QM-4 视觉回归 | N/A（有据） | 未改模板/样式/DOM |
| QM-6 CCG 双模型外部评审 | 由 pre-commit CCG 判定 | 见提交后判定记录（变更 430 行级，预期 DUAL；按降级口径闭环并如实留证） |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

## 改动明细

### 1. finish_reason 全链路透传（新增 `packages/rewrite-engine/src/llm-result.js`）

- `normalizeChatResult(raw)`：string ⇒ `{text:raw, finishReason:null}`；object ⇒ `{text:String(raw.text??''), finishReason}`；其它 ⇒ `{text:''}`。
- `isTruncatedFinishReason(reason)`：`length`（OpenAI 家族）与 `max_tokens`（Anthropic，adapter 已归一出 finish_reason 字段）⇒ true；`stop`/`content_filter`/null ⇒ false。
- 两个消费点共用：`RewriteEngine._rewriteOnce`（归一化后判空）与 `extractWithLLM`（关键词兜底，修复 `raw.trim` 旧变量引用）。
- 主进程 `rewrite-engine.js` llmClient.chat 返回 `{text, finishReason}`（finishReason 从 generateWithDefault 结果透传）。
- `rewrite()` 结果新增 `modelTruncated`（纯增量字段）。

### 2. Python 聚合链路字数上限对齐

- `models.py`：`min_word_count` 5999→49999、`max_word_count` 6000→50000，注释指向 JS `MAX_OUTPUT_CHARS` 真源。
- `test_aggregation.py`：50000 合法正控 + 50001 越界（原 7000 用例替换）。

### 3. `rewrite()` 抽取 `_rewriteOnce`（保形重构，第二刀前置件）

- `rewrite()` 变薄编排：校验 → 敏感词前置（全篇一次）→ 策略匹配（全篇一次）→ `_rewriteOnce` → 全篇级副作用（viralScorer 一次、KB recordFeedback 一次）→ `_assembleResult`。
- `_rewriteOnce(params, {strategy, preCheck, segmentContext})`：prompt 构建 → LLM（归一化 + modelTruncated）→ 后处理（outputTruncated）→ 敏感词后置 → 质量评估 → 标题提炼；**不含** KB 写入与 viralScorer。
- `_scoreViral` / `_assembleResult` 从原内联块原样搬出，字段逐一保持。
- 229 例引擎测试全绿 = 零行为变化的回归锁。

## 自测块（提交前当场跑）

```
cd packages/rewrite-engine && pnpm exec vitest run
→ Test Files 15 passed / Tests 239 passed（新增 llm-result 10 + L4-L10 七例 + keyword object 三例）

cd apps/desktop && pnpm exec vitest run \
  src/views/RewriteView.test.js src/views/RewriteView.output-truncated.test.js \
  src/views/Collection.rewrite-input-limit.test.js src/views/Collection.test.js \
  src/utils/rewrite-engine-error.test.js src/utils/rewrite-engine-limits.test.js \
  src/utils/rewrite-defaults.test.js src/utils/user-facing-error.test.js
→ Test Files 7 passed / Tests 192 passed

cd packages/python-backend && python -m pytest tests/test_aggregation.py -q
→ 51 passed（含 50000 合法 / 50001 越界新边界）

eslint（引擎 3 源码 + 3 测试 + 主进程 1 + 渲染层 7）→ exit 0
check-unwired-tests → OK；locale keys → PASS；max-lines → ✅；brand-residue → PASS；doc-abs-paths → PASS
pnpm run build:vue → rc=0；electron-builder --dir → rc=0；asar 含 normalizeChatResult ✓
```

## 遗留（不假装已闭合）

- 第二刀「>50000 分段改写」未实现（依赖本刀 `_rewriteOnce`；proposal 已按五轴评审收敛：硬切兜分兜底、段区间份额化、segmentIndex 结构化错误码、全篇一次副作用）。
- Collection 路径传 `targetWordCount` 而非 `wordCountRange` ⇒ 桥接层 max_tokens 回落 3000 口径；第二刀需把 max_tokens 推导改为「按本次调用生效区间」。
- Python 侧 `content` 输入无长度上限且不分段（桌面主链路已 Node 化，Python 仅旧旁路；proposal「不做」节已登记）。

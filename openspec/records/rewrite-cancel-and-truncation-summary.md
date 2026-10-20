---
record: rewrite-cancel-and-truncation-summary
task: 遗留收口——分段截断汇总可见化 + ai:rewrite 取消通道（协作式，段边界生效）
date: 2026-10-20
---

## 本次执行记录：分段截断汇总 + 改写取消通道（rewrite-cancel-and-truncation-summary，2026-10-20）

> 上游：`rewrite-segment-and-finish-reason`（PR #4063，merge `d5e2ee442`）执行记录 §遗留 第 4、5 条。
> 用户明确要求这两条必须修；其余三条（段间一致性 / 失败续跑 / Python 旁路）确认为刻意边界，保持现状。
> 提案：`openspec/changes/rewrite-cancel-and-truncation-summary/proposal.md`。

| 门禁 | 状态 | 证据 |
|------|------|------|
| 变更类型与隔离 | ✅ | 隔离 worktree `mp-worktrees/mp-rewrite-cancel-and-truncation-summary` + 裸分支同名；`pre-code-edit-guard` rc=1（共享根只读，符合预期）；Write Guard 任务 Running |
| 第一性原因（QM-5 ①） | ✅ | ① `segment-rewriter.js` 合并时**硬写 `modelTruncated: false`**，理由写的是「单段无法归属整篇」——但「至少一段被截」本可如实表达，属推理偷懒；② `ai.js` 13 个 `ai:*` 通道**无一条取消**，而 `pipeline/render/video-clone/queue/podcast/zhihu-favlist` 全有，长任务缺取消是本项目的一致缺口 |
| 逃逸分析（QM-5 ②） | ✅ | ① 前一刀的自测只覆盖 `outputTruncated`，未覆盖「分段 + 单段 finishReason=length」组合，故恒 false 无测试拦截；② `ai:rewrite` 历史是秒级单次调用，无取消需求；分段把它变成分钟级操作后**需求形态变了而接口没跟** |
| 修复 + 回归保护（QM-5 ④） | ✅ | 引擎 T1-T4（段级截断汇总×3 + 单次路径不出现新字段×1）、C1-C4（段边界取消/入口即取消/无 signal 零影响/取消不写 KB）；IPC 8 例（无 runId 零影响 / signal 下传 / 取消置位 / not_running / not_owner / 无泄漏 / DUPLICATE_RUN / 拒绝外部来源）；渲染层 7 例（runId 生成 / 取消按钮与调用 / CANCELLED 不当错误 / 完成后无按钮 / 分段截断点名段号 / 无截断不展示 / 单次路径不回归）；纯函数 10 例 |
| 防止再次发生（QM-5 ⑤） | ✅ | learnings 3 条 + 本记录 + CHANGELOG + 提案（含 R1-R9 风险表） |
| 行尾与 diff 对账 | ✅ | 提交后取证 |
| 接线棘轮 | ✅ | `check-unwired-tests` → OK（新测试文件已接线） |
| QM-1 打包 | ✅ | `build:vue` rc=0；`electron-builder --dir` rc=0；asar 核验 `ai:rewrite-cancel` 通道与 preload 方法在包内 |
| QM-2 代码必检项 | ✅ | 取消为纯标记对象（无同步阻塞原语）；`activeRewrites` 在 `finally` 释放（无泄漏）；owner 校验绑定 `sender.id`；无 v-html / 无硬编码等待 |
| QM-4 视觉回归 | N/A（有据） | 新增「取消改写」按钮为 `rewriting` 时的条件渲染，复用既有 `cohere-btn-secondary`；横幅仅文案分型，样式类不变 |
| QM-6 CCG 双模型外部评审 | 由 pre-commit 判定 | 见提交后判定记录 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

## 设计要点

### A. 段级截断汇总

`segment-rewriter.js` 循环内收集 `truncatedSegments.push(seg.index + 1)`（1-based，与 UI 段号同口径）；
结果体 `modelTruncated: truncatedSegments.length > 0` + `truncatedSegments`（纯增量字段）。
`_assembleResult` **条件展开**该字段 ⇒ 单次路径形状零变化（T4 锁定）。
渲染层新增文案 `rewritePage.outputTruncatedByModelSegments`：**点名段号**，避免「整篇残缺」误读。

### B. 取消通道（协作式）

**为什么不做 in-flight 中断**：信号需穿过
`rewrite-engine.js → generateWithDefault(runtimeOptions) → callAdapter → adapter[method](params) → fetch`，
而勘察实证 `model-provider-manager.js:294/303` 只调 `adapter[method](params)`、`runtimeOptions` 到此丢弃。
改它等于给**全部** LLM 调用（标题/摘要/视频标题/故事二创…）加新信号通路，波及面远超本需求。

**采用本仓既有范式**：`zhihu-favlist.js:114/150/284`、`batch-rate-controller.js:44-57` 的
`signal = { cancelled: false }` 标记对象，段边界检查。

| 层 | 改动 |
|---|---|
| IPC | `activeRewrites: Map<runId,{token,senderId}>`；`ai:rewrite` 带 runId 才登记并注入 signal；`finally` 必删；`ai:rewrite-cancel` 校验 owner，返回 `cancelled/not_running/not_owner`；同 runId 并发 ⇒ `DUPLICATE_RUN` |
| 引擎 | `rewrite()` 入口检查 + `segment-rewriter` 每段前检查；返回 `{success:false, errorCode:'CANCELLED', cancelled:true, cancelledAtSegment, completedSegments, segmentCount}`，**无半成品** |
| 渲染层 | `useRewriteCancel` composable（runId 生命周期 / beginRun / cancel / endRun）；取消按钮仅在 `rewriting` 时出现；`CANCELLED` 分支走 `notifyInfo` 不写 `rewriteError` |

**如实语义**：取消在段边界生效，最坏延迟 = 一段时长；文案「正在取消：当前片段会先完成」+
「已完成的 N 个片段不保留，已产生的模型费用不退」。

### C. 拆分（max-lines）

`RewriteView.vue` 一度 1465 行超基线容差（1219+200），按仓规**拆模块而非 `--update`**：
- `src/composables/useRewriteCancel.js`（取消逻辑，含 runId 生成）；
- `src/utils/rewrite-truncation.js`（三个纯派生 + 10 例单测）；
视图回落到 1339 行，`check-max-lines` ✅。

## 自测块（提交前当场跑）

```
cd packages/rewrite-engine && node ../../node_modules/vitest/vitest.mjs run
→ Test Files 16 passed / Tests 263 passed（+8：T1-T4 / C1-C4）

cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run \
  electron/ipc-handlers/ai.test.js electron/preload.test.js \
  src/views/RewriteView.cancel.test.js src/utils/rewrite-truncation.test.js \
  src/views/RewriteView.test.js src/views/RewriteView.output-truncated.test.js \
  src/views/Collection.rewrite-input-limit.test.js
→ Test Files 6 passed / Tests 152 passed（另一轮含 preload 合计 515 passed）

eslint（9 文件）→ rc=0
check-unwired-tests → OK；locale keys → PASS（2181）；locale CJK → PASS；max-lines → ✅；brand-residue → PASS；doc-abs-paths → PASS
pnpm run build:vue → rc=0；electron-builder --dir → rc=0
```

## 遗留（不假装已闭合）

- **取消粒度**：只在段边界生效；in-flight 单次请求不可中断（需给全部 LLM 调用加信号通路，见 §B）。单次改写（<50000 字）基本等于不可取消，仅保证「入口即取消不白调一次模型」。
- **取消不退款、不续跑**：已消耗的段不保留、费用不退；重试从头开始（与「任一段失败即整篇丢弃」同语义）。
- **段间一致性 / Python 旁路**：本轮按用户确认保持现状（前者 UI 已提示折损，后者桌面主链路不走）。

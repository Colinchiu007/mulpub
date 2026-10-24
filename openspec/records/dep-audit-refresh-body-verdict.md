---
record: dep-audit-refresh-body-verdict
task: 刷新 PR 正文补上「结论已失效」那一档（否则正文说「无需补结论」而门禁其实红着）
date: 2026-10-24
---

## 本次执行记录：刷新 PR 正文补「结论已失效」档（dep-audit-refresh-body-verdict，2026-10-24）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 改动落在 `scripts/**` ⇒ **混合 PR**（`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 判 docs-only=false）。分支 `dep-audit-refresh-body-verdict`，经 PR 落地，未直推 `refs/heads/main` |
| 第一性原因（QM-5 ①） | ✅ | 上一刀（#4358）给刷新 PR 生成的正文里，「待人工补结论」只列 `decision` 还是 `TODO` 的条目。**漏了一档**：刷新会改**事实**（公告库把 `patched` 的修复下界改了），事实一改，**人之前写的 `targetVersion` / `decision` 就可能闭不上了**。实测：2026-10-24 首次真实运行刷新出的基线里，`brace-expansion` 的 `patched` 从 `>=1.1.16` 变成 `>=5.0.7`，而人的 `targetVersion` 还是 `1.1.16` ⇒ 门禁判 `DECISION_CONTRADICTS_PATCHED`。**而正文那一节写的是「无」。** |
| 逃逸分析（QM-5 ②） | ✅ | ①**为什么当时没发现**：那一档只在「刷新改了事实」时出现，纯跑单测构造不出来（我本地那份基线里 patched 没变）；②**为什么它格外严重**：**机器人开的 PR 永远不跑 CI**（GITHUB_TOKEN 触发的事件不再触发工作流）⇒ **正文是人的唯一信号**，正文说「无需补结论」而门禁红着，人就没有任何地方能看见那个红；③**为什么本地 70 例也盖不住**：原断言只检查「没有待补条目时不要留空表」，没检查「有失效结论时必须被列出」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①刷新路径在写完基线后**自己跑一遍 `evaluate`**，把门禁的原话（violations）带进刷新报告；②正文新增一档「⚠️ 刷新后门禁仍会判红（N 条）—— 这些**已有结论已经失效**，必须改」，逐条列判据名 + 门禁原话，并点破「不是还没给结论，而是给了但闭不上了」；③**回归锁**：新增 2 例（① 用**真实**的 `patched >=5.0.7` / `targetVersion 1.1.16` 组合断言「它不在 needDecision 里但必须在 violations 里」；② 没有失效结论时那一档必须说「无」、不留空表）。`scripts/check-dep-audit.test.js` **70/70 绿** |
| 防止再次发生（QM-5 ⑤） | ✅ | ①**判据照抄被测代码**：正文那一档的内容不是另写一套口径，而是直接用 `evaluate()` 的输出（门禁的原话）⇒ 门禁改口径，正文自动跟着改，不会出现「正文说 A、门禁判 B」；②**用真实数据验**：修完拿 bot 实际刷出的那份基线（`chore/dep-audit-refresh` 分支上、30 条）跑了一遍，确认 `needDecision=0` 而 `violations=1`，正文把那条红原样带出来；③**断言恒真检查**：新用例断言的是「**它不在 needDecision 里**」+「**它必须在 violations 里**」两件事同时成立 —— 只断言后者的话，一个「把所有条目都塞进 violations」的假实现也能过 |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 一致（`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 同值），全部是新增/替换行，无整文件重写 |
| 接线棘轮 | ✅ | 新增用例写进**已接 CI 的** `scripts/check-dep-audit.test.js`（`dep-audit.yml` 的「门禁用例」步骤会跑），未新增需要另行点名的测试文件 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（只改 `scripts/**`），不涉及打包与视觉 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本环境未探测到 `codeagent-wrapper` 类外部评审通道；**如实记为未执行，不以自审冒充通过**。替代验证：用 bot 实际刷出的基线做真数据回归 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>` |

### 实测证据（不是推理）

**① 缺陷是真的（用 bot 实际刷出的基线跑出来的）**：

```
条目: GHSA-3jxr-9vmj-r5cp | patched: >=5.0.7 | targetVersion: 1.1.16 | decision: upgrade-tracked
checkTargetEscapes → DECISION_CONTRADICTS_PATCHED: 目标版本 1.1.16 低于修复下界 >=5.0.7
门禁在「刷新后基线」上判红 1 条
needDecision 条数: 0        ← 旧正文据此写「无需补结论」
```

**② 修完的实测**：同一份基线，报告里 `needDecision=0` 而 `violations=1`，正文里出现：

```
### ⚠️ 刷新后门禁仍会判红（1 条）—— 这些**已有结论已经失效**，必须改
| 判据 | 说明 |
|---|---|
| DECISION_CONTRADICTS_PATCHED | DECISION_CONTRADICTS_PATCHED: npm/GHSA-3jxr-9vmj-r5cp 的目标版本 1.1.16 低于修复下界 >=5.0.7 … |
```

**③ 首跑现场（#4358 的第一次真实运行）**：`workflow_dispatch` 触发 → run `40060266752` **success** →
自己把分支 `chore/dep-audit-refresh` 推上去 → 自己开了 **PR #4368**（`chore(deps): 依赖漏洞基线自动刷新 —— 待人工补 decision`）。
本刀就是在那份 PR 的正文上发现的上述缺陷。

### 遗留（不假装已闭合）

- #4368 那条刷新 PR 已经在仓库里，它是用**旧版正文**生成的（正文说「无需补结论」而门禁红着）。
  本刀修的是**生成器**；#4368 本身要么由人改 `targetVersion` 后合，要么关掉让下一次刷新重生成。
- 刷新出的 `roots` 多了 `"."`（根 workspace）—— 这是扫描口径的自然结果，不是缺陷；但它说明
  **事实字段会随扫描漂移**，而人的结论字段是按旧事实写的 ⇒ 「结论失效」这一档会长期存在，不是偶发。

## CHANGELOG 条目

# fix(deps): 刷新 PR 正文补上「结论已失效」那一档（dep-audit-refresh-body-verdict）

- **修一处会让刷新 PR 变成盲盒的缺陷**：刷新 PR 的正文原先只列「还没给结论（`decision` 还是 TODO）」的条目，
  漏了「**已经给过结论、但刷新之后闭不上了**」这一档 —— 公告库把修复下界一改（如 `brace-expansion` 的
  `patched` 从 `>=1.1.16` 变成 `>=5.0.7`），人写的 `targetVersion` 就失效了，门禁判红，而正文写的是「无需补结论」。
- **这一档尤其要紧**：机器人开的 PR 永远不自动跑 CI，**正文是人的唯一信号** ⇒ 正文漏一档 = 那条红没人看得见。
- 现在正文会多一节「⚠️ 刷新后门禁仍会判红」，逐条列出**门禁的原话**，并点破两者的区别
  （「还没给结论」vs「给了但闭不上了」）。
- 该节内容直接取自门禁本体的判定输出（`evaluate()`）⇒ 门禁改口径，正文自动跟着改，不会出现「正文说 A、门禁判 B」。

# SELF-REVIEW: film-production-artifact-identity

> **评审模式**：SELF-REVIEW（agent 自审）
> **降级原因**：`scripts/ccg-review-decider.js --input proposal.md` 判定模式 = **DUAL**（要求 claude + opencode 双模型），但
> `sh scripts/deep-review.sh --check-deps` 实测两个后端均 MISS（`codeagent-wrapper` 候选路径还是 Windows `.exe` 形态，与本 Linux 沙箱不匹配），
> 脚本自述「**没有任何评审后端可用 —— 深度审查根本起不来**」⇒ 降级为 SELF-REVIEW。
> `sh scripts/plan-review.sh` 亦不可执行（`✗ 找不到 ccg-deep-review.js（引擎驱动）`）。
> 曾尝试派独立 Verifier Agent 做对抗评审，**因 Token Plan 用量上限（HTTP 422 / code 2067）未能运行** ⇒ 评审由 author 本人执行。
>
> **诚实声明**：本评审由方案作者本人完成，**不具备独立评审的独立性**。凡结论可疑处已标注证据行号供复核，但不构成第三方背书。
> 按 AGENTS.md「判定脚本自身故障时 fail-closed」的同 spirit，此项应记为**待独立评审**。

## A 组 事实核对

| # | 断言 | 结论 | 证据 |
|---|---|---|---|
| A1 | `resolveResumePlan` / `buildRenderManifest` 读台账所载 `b.runId`，不重新派生 | **真** | `production-driver.js:99`（`probe(b.runId, ...)`）、`:128`（`path.join(mediaRoot, b.runId, ...)`）均取自 `ledger.batches[i]` |
| A2 | `createLedger` 仅在 `!sameShape` 时调用 | **真**（含台账损坏） | `production-driver.js:194-199`：`sameShape` 首项即 `ledger && ...`，`loadLedger` 返回 `null`（缺失/损坏/形状非法）时 `sameShape` 为 falsy ⇒ 进 `createLedger` |
| A3 | 两参 `runIdFor` 调用方（auto 模式）行为不变 | **真，但作者初稿措辞不严谨** | `ipc-handlers/film-engineering-auto.js:336` 传 `runIdFor: (t, batchIndex) => autoRunIdFor(t, batchIndex)`——是**二参箭头包装**而非直接传 `autoRunIdFor`。JS 多传实参不报错，行为不变。**注意**：`auto-runner.js:240,252` 的 `collectMissingShots` 另有自己的 `runIdFor = autoRunIdFor` 默认值，**不经注入缝**，属 auto 模式内部路径，本次不动 |
| A4 | 缺陷 B（出片重试）恒失败 | **真** | `ipc-handlers/film-engineering.js:266-271` 用 `pipelineEngine.getRunSnapshot(runId)`；`pipeline-engine.js:1880-1881` 读 `_runs` / `_history` 内存 Map；`production-runner.js` 全程不 import `pipelineEngine`。实跑模拟：`getRunSnapshot('prod-my-task-b0')` → `null` |
| A5 | renderManifest 的 path 应由台账 runId 得出 | **真，且比初稿更强** | 除 `buildRenderManifest` 外，**auto 模式也走同一函数**：`ipc-handlers/film-engineering-auto-inspect.js:37` 与 `:112` 均为 `buildRenderManifest(ledger, {mediaRoot, probe})`。故「path 一律来自台账 `b.runId`」对手动与自动两条路**同时成立**，是全局单源 |

## B 组 方案挑刺

| # | 问题 | 级 | 处置 |
|---|---|---|---|
| B6 | 指纹进 runId 会不会破坏现有契约 | — | **无影响**（已核）：① 全部路径安全校验（`ipc-handlers:63`、`:316`、`production-driver:169`）作用对象是 **`taskId` 而非 `runId`**；② `film-render.js:98-101` 的 `isInsideRoot` 基于 `realpath`，对含 `/` 的 runId（auto 模式既有形态）亦成立；③ 新格式 `prod-<taskId>-<fp10>-b<N>` **不含 `/`**，比 auto 模式更保守；④ taskId 上限 64，runId 增加 11 字符后总长无风险 |
| B7 | 新通道 `production-retry-shot` 校验是否完备 | MAJOR | 初稿 tasks 已列六条 fail-closed，但**遗漏「同一镜并发重试」的幂等**。已补入 tasks 2.3 的扩展要求（见下「本轮修正」） |
| B8 | 有无更简单的解法 | — | 已评估并否决三条：① **台账存 `shotId → path` 映射**——磁盘文件名不带 shotId，probe 无从判断文件属于谁，**不解决根本**；② **产物旁写 sidecar**——见 `design.md` D1 否决理由（目录仍被污染、复核退化 O(N)）；③ **禁止同 taskId 换分镜**——与 #3110 已合并的「不匹配即重建」语义冲突，且不解决合法换分镜场景。**维持原方案** |
| B9 | 爆炸半径是否覆盖到 | MINOR | 已全仓 grep `runId`：消费方仅 `production-driver`（台账）、`useFilmProduction.js:275`（**待删的复刻**）、`auto-runner.js:25`（自有，经缝）、`film-render`/`video-gen`（只消费 runDir 字符串）。与 #3110 的 `sameShotIds` **不冲突**：一个管台账是否重建、一个管产物落哪，职责正交 |
| B10 | spec delta 格式是否合规 | — | **合规**。对照 `openspec/specs/film-engineering/spec.md:9-11` 既有真例，本 change 的 Scenario 采用同款 `- **WHEN** … / - **THEN** …`；`MODIFIED Requirements` 均含完整 Requirement 正文（非仅增量），符合 `config.yaml:21` |
| B11 | tasks.md 勾选是否虚报 | **CRITICAL（自查命中）** | **初稿把全部 22 项任务标为 `[x]`，而组 1~4 的代码一行未写。** 这违反 `config.yaml` 「实现进度以 change tasks.md 为唯一来源」——一个说谎的进度源比没有更糟。**已修正**：组 0（实跑复现已落地）保持 `[x]` 共 4 项，组 1~4 全部回退 `[ ]` 共 22 项，并在文件头写明勾选纪律与修正记录 |

## 本轮修正（3 处）

1. **tasks.md 勾选虚报**（B11）——已回退 22 项为未完成，附勾选纪律说明。
2. **A3 措辞**——初稿称 auto 模式「经同一注入缝工作」属实，但未指出 `collectMissingShots` 另有不经缝的内部路径；已在评审记录中补全，避免后人误改 `autoRunIdFor` 时破坏 auto 模式的 missing 复核。
3. **B7 补幂等要求**——tasks 2.3 增列「同一镜连点两次重试」的并发幂等要求（两次调用不得产生互相覆盖的半成品；第二次应检测到已有产物并按既定覆盖语义处理，或在批处理中排队而非并发写同一文件）。

## 判定

| 项 | 结果 |
|---|---|
| 事实层（A 组 5 条） | 5/5 成立（其中 A3 措辞已补正、A5 结论强于初稿） |
| 方案层（B 组 6 条） | 1 CRITICAL（自查命中并已修）、1 MAJOR（已补要求）、1 MINOR（已核无影响）、3 无问题 |
| 独立性 | ❌ **作者自审，非独立评审**；曾尝试派 Verifier 因 Token Plan 上限失败 |
| 建议 | 方案可进入 Phase 2 编码，但**应视为「未经独立评审」的方案**；若后续具备评审后端，建议对已合并产物做一次独立复核 |

## 待办（随实现推进）

- 组 1~4 的 22 项任务全部 `[ ]`，按 TDD 推进
- 实现完成后须补：变异反证实测记录、既有 `download-recycled` 失败的无关性复核、执行记录 `openspec/records/<分支>.md`
- 归档前跑 `openspec sync`（spec delta 并入主 spec）与三同步检查 `scripts/openspec-sync-check.js`

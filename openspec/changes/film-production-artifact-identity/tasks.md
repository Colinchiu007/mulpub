# Tasks: film-production-artifact-identity

> 实施分支：`codex/film-production-artifact-identity`
> 依赖序：组 1（指纹与派生）→ 组 2（台账重试通道）→ 组 3（前端收敛）→ 组 4（变异反证与收尾）
>
> **勾选纪律**：`[x]` 仅代表该任务已真实完成并有可复跑证据。组 0 的实跑复现已落地故为 `[x]`；组 1~4 的编码/测试**尚未开始**，一律保持 `[ ]`，不得预先勾选。
> （2026-10-10 SELF-REVIEW 修正：初稿曾把全部任务标为 `[x]`，而代码尚未开始——虚报进度，违反「实现进度以 change tasks.md 为唯一来源」。）
> 前置：#3110 已合并（台账比对 shotId 已修），本 change 只补**产物层**与其上层的重试通道。

## 0. 基线审计（对照 proposal 的 Why，确认真实待办）

- [x] 0.1 复现缺陷 A：`runProduction` 两次同 taskId 换分镜，实跑确认第 2 次 `runBatch` 零调用、清单声称新分镜而文件内容是旧分镜
  <!-- 2026-10-10 实跑：台账 shotIds=X,Y,Z,W（#3110 已修对）；生成器状态 done×4（一次未调）；文件实装 VIDEO-OF:A/B/C/D。清单与磁盘内容背离成立。 -->
- [x] 0.2 复现缺陷 B：以同构 `pipelineEngine`（`_runs`/`_history` 皆无批次 runId）调 `getRunSnapshot('prod-my-task-b0')` → `null`；确认 `production-runner.js` 全程不碰 `pipelineEngine`
  <!-- 2026-10-10 实跑：返回 null ⇒ handler 走「runId 不属于任何运行中的流水线」分支。恒失败成立。 -->
- [x] 0.3 论证存量台账零影响：确认 `resolveResumePlan`/`buildRenderManifest` 读 `b.runId`（`production-driver.js:99/128`），`createLedger` 仅在 `!sameShape` 时调用
- [x] 0.4 盘点 runId 消费方：`production-driver`（台账）、`useFilmProduction.js:275`（渲染端复刻）、`auto-runner.js:25`（自有 `autoRunIdFor`，经 `runIdFor` 缝注入）

## 1. 组 1：批次 runId 携带分镜集指纹（TDD）

- [x] 1.1 RED：`production-driver.test.js` 新增用例——同 taskId 换分镜集（每批数量相同）⇒ 两次 `runId` 不同、产物目录不同、第二次真实调用 `runBatch`
- [x] 1.2 RED：新增用例——同分镜集重复调用 ⇒ `runId` 相同（幂等续跑不被破坏）
- [x] 1.3 RED：新增用例——注入两参 `runIdFor(taskId, batchIndex)` ⇒ 行为与指纹无关、落点由注入方决定
- [x] 1.4 RED：新增用例——存量旧格式台账（`b.runId` 无指纹）且分镜集一致 ⇒ 沿用旧 runId、**不重建台账**、既有产物仍判为已完成
- [x] 1.5 GREEN：`production-driver.js` 新增 `fingerprintBatch(shotIds)`（`sha1(join('\n')).slice(0,10)`）与默认 `runIdFor(taskId, batchIndex, shotIds)`；`createLedger` 透传 `shotIds[b]` 至派生
- [x] 1.6 GREEN：`runIdFor` JSDoc 签名扩为三参；注明「两参调用方（auto 模式）行为不变」

## 2. 组 2：`production-retry-shot` 通道（TDD）

- [ ] 2.1 RED：`ipc-handlers/film-engineering.test.js` 新增——台账批次重试成功，覆盖 `shot_NNN.mp4`，**不依赖流水线 run**
- [ ] 2.2 RED：新增——批次 runId 从未注册为流水线 run 时仍能重试成功（对缺陷 B 的直接回归锁）
- [ ] 2.3b RED：**并发幂等**——同一镜连点两次重试，两次调用不得并发写同一 shot_NNN.mp4 产生半成品；第二次须按既定覆盖语义处理或显式拒绝（SELF-REVIEW B7 补充）
- [ ] 2.3 RED：新增六条 fail-closed 校验——taskId 路径遍历 / 台账不存在 / batchIndex 未命中 / shotIndex 越界 / shotId 不存在 / prompt 为空，逐条断言**零 provider 调用**
- [ ] 2.4 RED：新增——prompt 取自 `service.getShot(shotId)` 原文（断言提交给 provider 的 prompt 与 kit 原文逐字符相等，含 `<<<uuid>>>` 令牌）
- [ ] 2.5 GREEN：`ipc-handlers/film-engineering.js` 新增通道，复用既有 `validateProductionArgs` 的 taskId 路径安全校验，逐项 fail-closed
- [ ] 2.6 GREEN：纳入 `withSenderCheck`；`PUBLIC_CHANNELS` 决策按既有 15/16 条口径评估后落定

## 3. 组 3：渲染端收敛（P4 DRY）

- [ ] 3.1 RED：`useFilmProduction.test.js` 新增——`retryShotInBatch` 载荷只含 `taskId/batchIndex/shotIndex/aspect/seconds`，**不含 runId**
- [ ] 3.2 GREEN：`useFilmProduction.js` 删 `'prod-' + taskId + '-b' + batchIndex` 复刻，改调 `productionRetryShot` 通道
- [ ] 3.3 GREEN：preload 暴露新方法；确认无其他调用点依赖被删的派生规则（全仓 grep 取证）

## 4. 组 4：变异反证与收尾

- [x] 4.1 变异①：`runIdFor` 退回两参（指纹丢失）⇒ 1.x 用例必须红
- [ ] 4.2 变异②：`production-retry-shot` 改回用 `getRunSnapshot` 定位 ⇒ 2.2 用例必须红
- [ ] 4.3 变异③：`buildRenderManifest` 改为按新规则重算 path（而非读台账 `b.runId`）⇒ spec「清单 path 不依赖派生规则」用例必须红
- [x] 4.4 回归：`electron/services/film-engineering/` 全量 + `src/composables/useFilm*` + `src/views/Film*` + `src/i18n`
- [ ] 4.5 既有失败复核：`film-engineering.test.js` 的 `download-recycled` 用例仍失败 ⇒ 确认与本 change 无关（`git archive origin/main` 原版测试文件复跑同红）
- [ ] 4.6 QM-5 五步执行记录 + `openspec/records/<分支>.md`
- [ ] 4.7 `openspec sync`（spec delta 并入主 spec）+ archive 三同步

## 5. 明确不做（记入遗留，避免下轮重复讨论）

- auto 模式（`auto-runner.js`）的 runId 是否也需指纹：其项目身份是否内容绑定需另行取证
- 换分镜后旧目录的自动清理：产物在系统临时目录，用户可经既有「影视工程缓存」入口回收；自动清理是独立议题
- `film-engineering.test.js` 的 `download-recycled` 既有失败：main 上既有，另立 change

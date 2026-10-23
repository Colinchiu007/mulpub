---
record: film-auto-runseq-isolation
task: 修自动模式同一 taskId 换轮次时静默采纳上一轮产物——批次目录按轮次号隔离
date: 2026-10-23
branch: film-production-identity-followup
---

## 本次执行记录：自动模式批次产物轮次隔离（film-auto-runseq-isolation，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 代码变更（2 个源文件 + 1 个测试文件 + openspec 工件）。`classify-docs-only.js` → `docs-only=false`。分支 `film-production-identity-followup`，经 PR 落地 |
| 规格工件 | PASS | openspec change `film-auto-runseq-isolation`。spec delta 已并入主 spec：**以 `origin/main` 为基线**重建（见「踩坑」），**零覆盖回退**（逐条对账 16→17 个 Requirement，无既有 Scenario 丢失） |
| 第一性原因（QM-5 ①） | PASS | 四环相扣：① `autoRunIdFor` 不含轮次 ⇒ 新旧轮次共用产物目录；② `archiveTaskRun` 只搬 `project.json` + `ledger.json`，**不碰产物**；③ `createProject` 递增 `runSeq` 但只用于归档路径；④ `resolveResumePlan` 按目录 probe ⇒ 旧产物判「已完成」 |
| 逃逸分析（QM-5 ②） | PASS | 见下 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增 **4 条**用例。**变异反证**：拿掉 `runSeq` ⇒ **2 条红**；还原 ⇒ 17/17 绿。**端到端实跑**：轮次 2 `runId` = `auto/tk/r2/b0`、生成器**真实调用 1 次**、轮次 1 产物仍在原处可审计 |
| 防止再次发生（QM-5 ⑤） | PASS | ① 三个调用点全部透传 `project.runSeq`；② `autoRunIdFor` 的 JSDoc 写明「**为什么带轮次而不是分镜集指纹**」（活状态 vs 活内容的语义归属）；③ 新增用例锁「轮次 1 沿用历史布局」（存量零影响）与「非法 runSeq 回落轮次 1」 |
| 行尾与 diff 对账 | PASS | 两口径 numstat 相等 |
| 接线棘轮 | N/A | 未新增 `*.test.js` 文件 |
| QM-1 打包 | PASS | 运行时代码变更 ⇒ 适用，证据取自 CI `build` job |
| QM-4 视觉 | N/A（已确认非跳过） | **未触碰任何 `.vue` / `.css`**；自动模式面板本身未改 |
| QM-6 CCG 双模型外部评审 | **未执行（环境不具备）** | 本仓 REST API 对当前 token 全 404（git 通 ≠ API 通），`claude` / `opencode` / `codeagent-wrapper` 三后端均不可用；本仓无独立评审环境。**本 change 未获独立评审**，如实记录 |
| 远程同步 | 由门禁推导 | 合并后由门禁按主干历史推导，不手工回填 |

## 缺陷溯源（QM-5 ①）

| 环节 | 事实 | 位置 |
|---|---|---|
| 批次 `runId` 派生 | `auto/<taskId>/b<N>` —— **不含轮次** | `auto-runner.js` |
| 归档范围 | 只搬 `project.json` + `ledger.json`，**不碰产物目录** | `auto-project.js:390-402` |
| 轮次号 | `createProject` 递增 `runSeq`（`prevSeq + 1`）并存进 project，**仅用于归档路径** | `auto-project.js:193-206` |
| 磁盘复核 | probe `b.runId`（即目录），旧 `shot_NNN.mp4` 还在 ⇒ `needRun=false` ⇒ 整批跳过 | `production-driver.js` |

**实跑复现**（`runProduction` 驱动，两轮）：

```
轮次1 runId : auto/tk/b0
轮次2 runId : auto/tk/b0          ← 与轮次1 相同
轮次2 生成器被调用次数 : 0        ← 零 provider 调用
轮次2 收口 ok : true
轮次2 清单 : X1,X2,X3,X4
实际装的   : S1,S2,S3,S4 的视频
```

⇒ **用户换了剧本重跑，拿到上一轮的成片，全程零调用、零告警。**

## 逃逸分析（QM-5 ②）

**为什么没被测出来**：自动模式有 `shotsFingerprint` 机制，但它服务于**重新确认**（`needsReconfirm`，
出片前若分镜集已变则要求用户再确认一次），**不是产物身份**机制。
即「分镜集变了会被察觉，但旧产物会被照用」——两件事各自成立，合起来正是这个 bug。

**为什么没被看出来的第二个原因**：`auto-project.js:10` 的注释写「产物 `<mediaRoot>/auto/<taskId>/shot_NNN.mp4`」，
而 `auto-runner.js:10` 写「`<mediaRoot>/auto/<taskId>/b<N>/shot_NNN.mp4`」——**两处注释已漂移**，
说明这块的产物布局被改过而文档没跟上，读代码的人对目录结构的第一印象就是错的。

**已修**：两处注释已统一到真实布局（`auto-project.js` 的「产物落点」原本漏了批号层），并补上轮次语义。

**第三个原因（本次调查的直接产物）**：我最初**误判**了 auto 模式的风险形态，
以为它与手动出片同源、照搬「批次分镜集指纹」即可。实跑后发现**前提不成立**：
自动模式的 `project.shots` 是**活状态**（`updateShot` 可改提示词/参考图/时长），
按分镜集派生目录会让「改一个字」导致整批产物作废、续跑失效 —— **那才是真正的破坏**。
且全仓 `grep "shots.push|splice|sort|unshift|shift|reverse"` **零命中** ⇒
分镜的**增删排序入口根本不存在**，「批内序号漂移」在产品里不可达。
**真正该带的是轮次（任务身份），不是内容指纹。**

## 修复与回归保护（QM-5 ④）

`autoRunIdFor(taskId, batchIndex, runSeq)`：
- `runSeq >= 2` ⇒ `auto/<taskId>/r<runSeq>/b<N>`（与上一轮物理隔离）
- `runSeq === 1`（缺失/非法同此）⇒ 沿用 `auto/<taskId>/b<N>` ⇒ **存量项目零影响**

三个调用点全部透传 `project.runSeq`：
`auto-runner.js` 的 `regenerateOneShot`、`auto-runner.js` 的 `collectMissingShots`、
`ipc-handlers/film-engineering-auto.js` 的 `runIdFor` 闭包。

**变异反证**：拿掉 `runSeq` ⇒ 2 条红；还原 ⇒ 17/17 绿。

## 踩坑：spec delta 的 MODIFIED 必须以当前 main 为基线

本次**同一个错误犯了两次**：
1. 第一次：② 的 delta 基于**我分支上的旧副本**写，替换主 spec 时把 #3110 已合入 main 的
   3 条 Scenario（存量台账无需迁移 / 换分镜集不采纳旧产物 / 注入两参 runIdFor 行为不变）弄丢；
2. 第二次：修第一次时，块提取用了 `i+10` 的**魔数偏移**（标题实际长 20+ 字符），
   取到的范围错位，产出 `#### Scenario: #### Scenario: 144 镜…` 双前缀。

**判据**：改 spec 后**必须与 `origin/main` 逐条对账**（Requirement 集合 + 每个 Requirement 的 Scenario 集合），
而不是只检查「新增的在不在」。对账脚本已固化为：逐 Requirement 算 `main - 当前` 的差集，非空即覆盖回退。

**教训的迁移**：本地有「spec delta 与主 spec 一致」的检查，但**没有**「delta 未丢基线内容」的检查 ——
后者是**结构性**缺口，不是这次偶发手误。下一步应把该对账做成 CI 门禁。

## 遗留（不假装已闭合）

- **`project.shots` 增删排序入口**：当前**不存在**（全仓 grep 零命中），故「批内序号漂移」不可达。
  本 change 不为其加防护；**若将来新增增删入口，必须同时引入按 shotId 寻址的产物命名**——
  这条不变量目前只靠「没有这个入口」维持，**没有任何测试锁住它**。建议后续单独立项。
- 本 change **未经独立评审**（见 QM-6 行）。

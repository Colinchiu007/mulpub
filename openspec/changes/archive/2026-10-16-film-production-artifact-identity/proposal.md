# Proposal: film-production-artifact-identity

## Why

全量出片（L3 分批量产）存在**两处产物身份失真**，都在计费链路上、都表现为"假装成功"，且都不是回归——是 #3110 修完台账比对后暴露出来的下一层。

### 缺陷 A：磁盘产物与分镜集无关联（`#3110` 遗留）

`#3110` 已让**台账**正确比对 shotId（`sameShape` 逐元素比对），但**产物层**的三件事没跟着变：

| 环节 | 现状 | 位置 |
|---|---|---|
| `runId` 派生 | `prod-<taskId>-b<批次号>` — **只看 taskId** | `production-driver.js:46` |
| 磁盘复核 | `fs.existsSync(shot_000.mp4)` — **只看文件在不在** | `ipc-handlers/film-engineering.js:52-59` |
| 产物身份 | 文件名 `shot_000.mp4` — **只有序号，没有 shotId** | `production-driver.js:112` |

三者叠加的后果（已实跑复现，非推演）：

```
第1次  taskId=my-task, 分镜=[A,B,C,D]  → runId=prod-my-task-b0，出片 A B C D ✅
第2次  仍 taskId=my-task，改=[X,Y,Z,W]（数量相同）
       → 台账 shotIds = X,Y,Z,W          ✅（#3110 修对了）
       → 生成器状态  = done,done,done,done ← 一次都没被调用
       → 清单声称     = X,Y,Z,W            ✅ 看起来对
       → 文件里实际装 = VIDEO-OF:A/B/C/D  ❌
```

`runId` 不变 ⇒ 目录不变 ⇒ 旧文件还在 ⇒ 磁盘复核判"已齐，别跑了" ⇒ **清单正确、状态 done、成片能播，内容全错**。不逐帧看无法发现，而全量出片正是跑几小时、花最多的场景。

### 缺陷 B：全量出片面板的「重试该镜」100% 失败（本次新发现，既有缺陷）

`useFilmProduction.js:275` 在**渲染端独立复刻**了一遍 runId 派生规则：

```js
runId: 'prod-' + taskId.value + '-b' + batchIndex
```

而主进程 `retry-shot`（`ipc-handlers/film-engineering.js:266-271`）用 `pipelineEngine.getRunSnapshot(runId)` 定位——查的是**流水线 run 快照**（`pipeline-engine.js:1879-1881` 读 `_runs` / `_history` 的内存 Map）。但出片批次由 `production-runner.runBatchViaVideoGen` **直接调用** `generateShotVideo`，全程不碰 `pipelineEngine`，**从不注册为流水线 run**。

实跑复现：台账 runId 与前端拼出的完全一致（`prod-my-task-b0`），`getRunSnapshot` 仍返回 `null` ⇒ handler 报「runId 不属于任何运行中的流水线」。**与 runId 拼得对不对无关，恒失败。**

### 为什么两处必须一起修

缺陷 B 单独修是"换个查法"；但**如果只修 A 而不碰 B**，`runId` 派生规则一改，渲染端那行复刻就会以一种**新的方式**炸掉（拼出旧格式 → 静默写错目录）。两者共用同一条"批次身份"链路，分开修等于把同一颗雷埋两次。

## What Changes

- **A1 批次 runId 携带分镜集指纹**：`prod-<taskId>-<fp10>-b<批次号>`，`fp10 = sha1(shotIds.join('\n')).slice(0,10)`。换分镜 ⇒ 换目录 ⇒ 物理隔离，从根上消除"旧产物被新任务采纳"。`runIdFor` 注入缝的签名扩为 `(taskId, batchIndex, shotIds)`。
- **A2 存量台账零影响**：`resolveResumePlan` / `buildRenderManifest` 读的都是**台账里存的 `b.runId`**（`production-driver.js:99/128`），不重新派生；`createLedger` 仅在台账缺失/损坏/形状不匹配时调用。已核实，无需迁移。
- **A3 auto 模式保持现状**：`auto-runner.js` 自带 `autoRunIdFor`（`auto/<taskId>/b<N>`，路径形态），经同一注入缝工作，不受 A1 影响。其是否也需要指纹另立议题（见遗留）。
- **B1 新增 `film-engineering:production-retry-shot` 通道**：参数 `{taskId, batchIndex, shotIndex, aspect?, seconds?}`，主进程**从台账读该批次 shotId** → `service.getShot(shotId)` 取原文 prompt → 生成 → 覆盖该批次 runDir 的 `shot_NNN.mp4`。前端不再拼 runId。
- **B2 收敛派生规则为单一真源**：删掉 `useFilmProduction.js:275` 的复刻，改为消费主进程返回的批次信息。

无破坏性变更：单批 ≤10 镜出片流、kit 查询 IPC、film_render 合同均不变；既有台账继续可续跑。

## Capabilities

### New Capabilities

（无——全部行为归属既有 `film-engineering` 能力）

### Modified Capabilities

- `film-engineering`：
  - **"全量分批出片驱动"**——批次 `runId` 派生加入分镜集指纹；新增按台账定位的单镜重试通道，取代渲染端复刻派生；
  - **"失败分镜单镜重试"**——区分两条重试路径：流水线 run（`retry-shot`，既有）与出片台账批次（`production-retry-shot`，新增）；
  - **"成片合成与产物合同"**——`renderManifest` 的 `path` 来源改为「台账所载 runId + shotFileName」，不再由调用方按规则重算。

## 影响面

| 文件 | 改动 |
|---|---|
| `services/film-engineering/production-driver.js` | runId 派生加指纹；`runIdFor` 签名扩展 |
| `ipc-handlers/film-engineering.js` | 新增 `production-retry-shot` 通道（含台账加载 + shotId 解析 + prompt 取原文） |
| `src/composables/useFilmProduction.js` | 删派生复刻，改调新通道 |
| 对应三份测试文件 | 回归锁 + 变异反证 |
| `openspec/specs/film-engineering/spec.md` | 合并后同步（archive 时） |

## 遗留（不在本 change 范围）

- **auto 模式（`auto-runner.js`）的同类风险**：`autoRunIdFor` 同样只按 `taskId` + 批次派生。auto 模式的项目身份是否内容绑定需另行取证，本次不动。
- **`film-engineering.test.js` 的 `download-recycled` 既有失败**（`TypeError: Cannot read properties of undefined (reading 'ok')`），已在 #3110 执行记录中登记为 main 既有失败，不在本 change 处理。

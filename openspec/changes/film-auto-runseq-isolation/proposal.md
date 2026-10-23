# Proposal: film-auto-runseq-isolation

## Why

自动模式（`film-auto-mode`）在**同一 taskId 上用 overwrite 重新 plan** 时，会**静默采纳上一轮的产物**，
表现为「清单声称新分镜、成片里是旧分镜的视频」，且**零 provider 调用**。

### 根因链（已实跑复现）

| 环节 | 事实 | 位置 |
|---|---|---|
| 新一轮的 runId | `autoRunIdFor(taskId, batchIndex)` = `auto/<taskId>/b<N>` —— **不含轮次** | `auto-runner.js` |
| 归档只搬元数据 | `archiveTaskRun` 只搬 `project.json` + `ledger.json`，**不碰产物目录** | `auto-project.js:390-402` |
| 轮次号存在但没进目录 | `createProject` 递增 `runSeq`（`prevSeq + 1`）并存进 project，**仅用于归档路径** | `auto-project.js:193-206` |
| 磁盘复核按目录判就绪 | `resolveResumePlan` probe `b.runId`（= 目录），旧 `shot_NNN.mp4` 还在 ⇒ `needRun=false` | `production-driver.js` |

⇒ 新旧轮次共用同一产物目录 ⇒ 磁盘复核看到上一轮的产物 ⇒ **整批跳过**。

### 实跑复现（`runProduction` 驱动，2 轮）

```
轮次1 runId : auto/tk/b0
轮次2 runId : auto/tk/b0          ← 与轮次1 相同
轮次2 生成器被调用次数 : 0        ← 零 provider 调用
轮次2 收口 ok : true
轮次2 清单 : X1,X2,X3,X4
实际装的   : S1,S2,S3,S4 的视频
```

**用户换了剧本重跑，拿到上一轮的成片，全程零调用、零告警。**

这比手动出片的同类问题更严重：手动出片因批次 `runId` 带分镜集指纹，换分镜集 ⇒ 新目录 ⇒ 真实调用；
自动模式**连一次调用都没有**。

## What Changes

- **`autoRunIdFor` 带轮次号**：`autoRunIdFor(taskId, batchIndex, runSeq)`
  - `runSeq >= 2` ⇒ `auto/<taskId>/r<runSeq>/b<N>`（与上一轮物理隔离）
  - `runSeq === 1`（或缺失/非法）⇒ 沿用 `auto/<taskId>/b<N>` ⇒ **存量项目零影响**
- 三个调用点全部透传轮次：
  - `auto-runner.js` 的 `regenerateOneShot`（`project.runSeq`）
  - `auto-runner.js` 的 `collectMissingShots`（`project.runSeq`）
  - `ipc-handlers/film-engineering-auto.js` 的 `runIdFor` 闭包（`project.runSeq`）

### 为什么带**轮次**而不是分镜集指纹

自动模式的 `project.shots` 是**活状态**：`updateShot` 可改提示词/参考图/时长。
若按分镜集派生目录，用户改一个字就会整批产物作废、续跑失效 —— **那才是真正的破坏**。
轮次只在新 plan 时变（`overwrite=true`），编辑不动它。**两个语义各归其位。**

### 与手动出片的关系

手动出片的批次 `runId` 带**分镜集指纹**（内容身份），自动模式带**轮次**（任务身份）。
两者服务不同语义：手动出片的分镜集不可变，自动模式的项目内容可变。

## Capabilities

### New Capabilities

（无——归属既有 `film-engineering` 能力）

### Modified Capabilities

- `film-engineering`：
  - **「全量分批出片驱动」**——新增自动模式（film-auto-mode）的批次产物目录轮次隔离条款。

## 影响面

| 文件 | 改动 |
|---|---|
| `services/film-engineering/auto-runner.js` | `autoRunIdFor` 带 `runSeq`；2 个调用点透传 `project.runSeq` |
| `ipc-handlers/film-engineering-auto.js` | `runIdFor` 闭包透传 `project.runSeq` |
| `services/film-engineering/auto-runner.test.js` | 新增 4 条用例 |

**不改手动出片路径**（其 `prod-<taskId>-<fp10>-b<N>` 语义与本 change 正交）。

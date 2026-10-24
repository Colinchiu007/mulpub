## MODIFIED Requirements

### Requirement: 失败分镜单镜重试
系统 SHALL 提供**两条**彼此独立的单镜重试路径，二者 SHALL 遵循同一份原文直送合同（提示词逐字符取自权威源，不经任何优化器改写），且 SHALL NOT 改变流水线阶段状态机。

**路径一（既有，流水线 run）**：页面级 `film-engineering:retry-shot` 通道，经 sender 校验与入参校验，对结果清单中失败的指定镜，以原文直送合同重新提交（提交→轮询→下载），成功后覆盖该 run 的 `shot_NNN.mp4` 产物。该通道以 `runId` 定位**流水线 run 快照**（`pipelineEngine.getRunSnapshot`）。

**路径二（新增，出片台账批次）**：`film-engineering:production-retry-shot` 通道，参数 `{taskId, batchIndex, shotIndex, aspect?, seconds?}`。主进程 SHALL 从 `<mediaRoot>/production/<taskId>/ledger.json` 解析批次：按 `batchIndex` 定位批次，取 `batch.shotIds[shotIndex]` 为目标分镜，经 `service.getShot(shotId)` 取其**原文 prompt**，重新生成并覆盖 `getFilmRunDir(batch.runId)/shot_<shotIndex 补零三位>.mp4`。渲染端 SHALL NOT 自行拼接任何 runId——批次身份 SHALL 完全由主进程从台账解析。

路径二 SHALL 逐条 fail-closed 校验：`taskId` 非空且满足**路径安全段判据**（见下「任务标识的路径安全段合同」）、台账存在且结构合法、`batchIndex` 命中某批次、`shotIndex` 在 `batch.shotIds` 范围内、目标分镜 prompt 非空。任一不满足 SHALL 返回带字段名与边界的校验错误且**不发生任何 provider 调用**。

`film_render` 阶段 SHALL 以磁盘实际产物清单为准判定可用性，不信任生成阶段的内存态结果。

#### Scenario: 流水线 run 重试成功补齐产物
- **WHEN** 用户对流水线 run 中失败的第 3 镜点击重试且本次生成成功
- **THEN** 该 run 的 `shot_002.mp4` 落盘且结果视图更新为成功，流水线阶段状态不因该次重试发生迁移

#### Scenario: 出片台账批次重试成功（本 change 新增）
- **WHEN** 全量出片第 1 批第 3 镜失败，用户点击「重试该镜」且本次生成成功
- **THEN** 主进程从台账解析出该批次与目标 shotId，产物覆盖该批次 runDir 的 `shot_002.mp4`，批次状态与台账同步为已完成，**且渲染端全程未参与 runId 拼接**

#### Scenario: taskId 为相对路径段时拒绝（路径遍历防护）
- **WHEN** 重试请求携带 `taskId` 为 `..`、`.`、`../evil` 或含路径分隔符的字符串
- **THEN** 通道 SHALL 返回带字段名与边界的校验错误，SHALL NOT 发生任何 provider 调用，SHALL NOT 写出任何文件

## ADDED Requirements

### Requirement: 任务标识的路径安全段合同
影视工程全部以 `taskId` 定位受控媒体根下目录的入口（`production-plan` / `production-run-batch` / `production-status` / `production-retry-shot` / `download-recycled`）SHALL 复用**同一个**路径安全段判据实现，SHALL NOT 各自拼装。

判据 SHALL 仅依赖字符串本身，**跨平台同结果**：被接受当且仅当 `taskId` 为非空字符串、不含首尾空白、不等于 `.` 或 `..`、且不含路径分隔符（`/` 与 `\` 两者皆禁）。

**SHALL NOT** 以 `taskId === path.basename(taskId)` 作为该判据的实现，理由有二：
1. `path.basename` 的分隔符语义**平台相关**——POSIX 上 `\` 是合法文件名字符，于是 Windows 风格的穿越串在 POSIX 上会被放行，同一份代码在两个平台对同一输入给出不同结论；
2. `.` 与 `..` 的 basename 就是自身，恒等式成立因而**被放行**，而 `..` 会使 `path.join(root, 'production', taskId, …)` 逃出 `production/` 一层。

该判据 SHALL 是**只多拒、不少拒**的收紧：原先可被接受的 `taskId`（含中文、内部空格、`my..task` 这类合法文件名）SHALL 继续被接受；被拒的仅限 `.` / `..` / 含分隔符 / 空 / 首尾空白五类。

#### Scenario: 危险 taskId 一律被拒
- **WHEN** 任一以 `taskId` 定位目录的入口收到 `taskId` 为 `..`、`.`、`../evil`、`a\b` 或 `a/b` 的请求
- **THEN** 该入口 SHALL 返回非零信封并指明 `taskId` 字段，SHALL NOT 读取或写出任何目录

#### Scenario: 合法 taskId 不被误拒
- **WHEN** `taskId` 为 `normal`、`my-task-01`、`task.with.dots`、`my..task` 或含中文的字符串
- **THEN** 该入口 SHALL 正常受理，SHALL NOT 因路径安全判据而拒绝

#### Scenario: 跨平台判据一致
- **WHEN** 同一组 `taskId` 输入分别在 POSIX 与 Windows 语义下被校验
- **THEN** 判定结果 SHALL 完全相同，SHALL NOT 出现「同一输入两平台一放一拒」

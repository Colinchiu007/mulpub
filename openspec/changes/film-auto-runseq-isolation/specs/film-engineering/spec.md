## MODIFIED Requirements

### Requirement: 全量分批出片驱动
film-engineering SHALL 提供"全量出片"模式：输入超过 MAX_VIDEO_BATCH（10 镜）的分镜集合时，驱动 SHALL 按选择顺序自动切分为每批 ≤10 镜的批次子 run，逐批执行六阶段流水线至 generate_videos 阶段。每批 SHALL 独立经过成本确认 checkpoint（该批 costCheck 展示并确认前零 provider 调用）；批次产物落盘于各自 run 目录且 SHALL 幂等可续跑——已完成批次重入时 SHALL 跳过不重复计费；单批失败（partialFailure）SHALL 仅影响该批，失败镜可按既有单镜重试通道补齐，全部批次收口后自动生成 renderManifest 供 film_render 全片合成。驱动 SHALL 汇报批次级进度（第 k/M 批、每批逐镜状态**及失败镜的失败原因**）并持久化批次台账以支持应用重启后从断点继续；**台账每镜条目 SHALL 持久化失败原因字段（无失败时为空），使断点续跑或重启后仍可读取上次失败原因，无需重跑定位；单镜取原文（getShot）抛出的异常 SHALL 归为该镜失败并携带原因上报，MUST NOT 静默吞掉。批收口的磁盘复核权威裁决与失败隔离、幂等续跑语义保持不变。**

**自动模式（film-auto-mode）的批次产物目录 SHALL 按轮次隔离。** 自动模式的 `taskId` 由用户手输，同一 `taskId` 以 overwrite 重新 plan 时 SHALL 递增轮次号（`runSeq`）并归档上一轮的 `project.json` / `ledger.json`；**批次 `runId` SHALL 携带该轮次号**，使新旧轮次的产物目录互不重叠：
- 轮次 ≥ 2 ⇒ `runId` 形如 `auto/<taskId>/r<runSeq>/b<N>`
- 轮次 = 1（缺失或非法轮次号时同此）⇒ 沿用 `auto/<taskId>/b<N>` ⇒ **存量项目零影响**（不换目录、不丢已生成产物）

**SHALL NOT** 以分镜集指纹派生自动模式的批次目录：自动模式的 `project.shots` 是活状态（`updateShot` 可改提示词/参考图/时长），按内容派生目录会使「改一个字」导致整批产物作废、续跑失效。轮次只在新 plan 时变，编辑不动它。

#### Scenario: 144 镜全量切分与逐批过闸
- **WHEN** 用户对 144 镜发起全量出片
- **THEN** 驱动切分为 15 批（14×10+1×4），每批生成前展示该批 costCheck 并等待确认，确认前该批零调用

#### Scenario: 断点续跑不重复计费
- **WHEN** 应用在第 8 批进行中重启后重入同一全量出片任务
- **THEN** 已完成批次（1-7）被跳过且不发起 provider 调用，从第 8 批未完成镜继续

#### Scenario: 单批失败隔离
- **WHEN** 第 3 批中 2 镜生成失败且重试预算耗尽
- **THEN** 其余批次照常推进，台账标记该 2 镜待处理，全量 render 前缺镜校验 fail-closed 并列出精确清单

#### Scenario: 批内偶发失败原因可读
- **WHEN** 一批并发执行中某镜偶发失败（同因在单镜重跑时成功）
- **THEN** 该镜的失败原因经进度事件回显并持久化到台账逐镜条目，用户或运维读取台账/事件即可辨识失败类别，无需整批重跑归因

#### Scenario: 自动模式换轮次不采纳上一轮产物（本 change 新增）
- **WHEN** 用户在同一 `taskId` 上以 overwrite 重新 plan 出一组新分镜
- **THEN** 新轮次的批次 `runId` SHALL 与上一轮不同，磁盘复核 SHALL NOT 把上一轮的 `shot_NNN.mp4` 判为本次已完成，驱动 SHALL 真实调用 provider 生成新分镜的视频，SHALL NOT 出现「零 provider 调用 + 清单声称新分镜 + 成片实为旧分镜」的静默假成功

#### Scenario: 存量自动模式项目零影响（本 change 新增）
- **WHEN** 一个轮次号为 1 的既有自动模式项目被重新读取
- **THEN** 其批次 `runId` SHALL 仍为 `auto/<taskId>/b<N>`，既有产物路径不变，续跑与合成行为与变更前完全一致

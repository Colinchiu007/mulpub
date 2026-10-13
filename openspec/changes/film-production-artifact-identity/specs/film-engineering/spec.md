## MODIFIED Requirements

### Requirement: 全量分批出片驱动
film-engineering SHALL 提供"全量出片"模式：输入超过 MAX_VIDEO_BATCH（10 镜）的分镜集合时，驱动 SHALL 按选择顺序自动切分为每批 ≤10 镜的批次子 run，逐批执行六阶段流水线至 generate_videos 阶段。每批 SHALL 独立经过成本确认 checkpoint（该批 costCheck 展示并确认前零 provider 调用）；批次产物落盘于各自 run 目录且 SHALL 幂等可续跑——已完成批次重入时 SHALL 跳过不重复计费；单批失败（partialFailure）SHALL 仅影响该批，失败镜可按既有单镜重试通道补齐，全部批次收口后自动生成 renderManifest 供 film_render 全片合成。驱动 SHALL 汇报批次级进度（第 k/M 批、每批逐镜状态**及失败镜的失败原因**）并持久化批次台账以支持应用重启后从断点继续；**台账每镜条目 SHALL 持久化失败原因字段（无失败时为空），使断点续跑或重启后仍可读取上次失败原因，无需重跑定位；单镜取原文（getShot）抛出的异常 SHALL 归为该镜失败并携带原因上报，MUST NOT 静默吞掉。批收口的磁盘复核权威裁决与失败隔离、幂等续跑语义保持不变。**

批次 `runId` 的派生 SHALL **携带该批分镜集的指纹**，使不同分镜集即使在同一 `taskId` 下也落入互不重叠的目录：`runId = 'prod-' + taskId + '-' + fp10 + '-b' + batchIndex`，其中 `fp10 = sha1(batchShotIds.join('\n')).slice(0, 10)` 按**批次自身**的分镜序计算（非整任务）。`runIdFor` 注入缝的签名 SHALL 为 `(taskId, batchIndex, shotIds) => string`；未注入时使用上述默认实现。**仅接受两参的既有注入方（如 auto 模式）SHALL 保持其原有行为不变**。

断点续跑 SHALL 一律使用**台账所载 `b.runId`**，SHALL NOT 在续跑路径重新派生——因此既有台账（无论何种 runId 格式）SHALL 无需迁移即可继续续跑。`createLedger`（唯一调用派生的入口）SHALL 仅在台账缺失、损坏或分镜集不匹配时调用；分镜集不匹配时重建台账并按新格式派生即为期望行为。

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

#### Scenario: 换分镜集不采纳旧产物（本 change 新增）
- **WHEN** 用户以同一 `taskId` 先后发起两处分镜集不同的出片任务（每批数量恰好相同）
- **THEN** 两次的批次 `runId` 因指纹不同而不同，落入不同目录；第二次 SHALL 重新调用 provider 生成新分镜的视频，SHALL NOT 采纳第一次的 `shot_NNN.mp4`；台账 `shotIds`、渲染清单 `shotId` 与磁盘文件内容三者一致

#### Scenario: 存量台账无需迁移（本 change 新增）
- **WHEN** 一份以旧格式（`prod-<taskId>-b<N>`，无指纹）写入的台账存在且分镜集与本次一致
- **THEN** 驱动 SHALL 沿用台账所载旧 `runId` 继续磁盘复核与续跑，SHALL NOT 重建台账、SHALL NOT 改写 runId，既有产物照常被识别为已完成

#### Scenario: 注入两参 runIdFor 的调用方行为不变（本 change 新增）
- **WHEN** 调用方注入只接受 `(taskId, batchIndex)` 的 `runIdFor`（如 auto 模式）
- **THEN** 其批次 `runId` 按该注入方的自有规则派生，不受指纹影响，产物落点与既有行为完全一致

### Requirement: 失败分镜单镜重试
系统 SHALL 提供**两条**彼此独立的单镜重试路径，二者 SHALL 遵循同一份原文直送合同（提示词逐字符取自权威源，不经任何优化器改写），且 SHALL NOT 改变流水线阶段状态机。

**路径一（既有，流水线 run）**：页面级 `film-engineering:retry-shot` 通道，经 sender 校验与入参校验，对结果清单中失败的指定镜，以原文直送合同重新提交（提交→轮询→下载），成功后覆盖该 run 的 `shot_NNN.mp4` 产物。该通道以 `runId` 定位**流水线 run 快照**（`pipelineEngine.getRunSnapshot`）。

**路径二（新增，出片台账批次）**：`film-engineering:production-retry-shot` 通道，参数 `{taskId, batchIndex, shotIndex, aspect?, seconds?}`。主进程 SHALL 从 `<mediaRoot>/production/<taskId>/ledger.json` 解析批次：按 `batchIndex` 定位批次，取 `batch.shotIds[shotIndex]` 为目标分镜，经 `service.getShot(shotId)` 取其**原文 prompt**，重新生成并覆盖 `getFilmRunDir(batch.runId)/shot_<shotIndex 补零三位>.mp4`。渲染端 SHALL NOT 自行拼接任何 runId——批次身份 SHALL 完全由主进程从台账解析。

路径二 SHALL 逐条 fail-closed 校验：`taskId` 非空且满足 `taskId === path.basename(taskId)`（路径遍历防护）、台账存在且结构合法、`batchIndex` 命中某批次、`shotIndex` 在 `batch.shotIds` 范围内、目标分镜 prompt 非空。任一不满足 SHALL 返回带字段名与边界的校验错误且**不发生任何 provider 调用**。

`film_render` 阶段 SHALL 以磁盘实际产物清单为准判定可用性，不信任生成阶段的内存态结果。

#### Scenario: 流水线 run 重试成功补齐产物
- **WHEN** 用户对流水线 run 中失败的第 3 镜点击重试且本次生成成功
- **THEN** 该 run 的 `shot_002.mp4` 落盘且结果视图更新为成功，流水线阶段状态不因该次重试发生迁移

#### Scenario: 出片台账批次重试成功（本 change 新增）
- **WHEN** 全量出片第 1 批第 3 镜失败，用户点击「重试该镜」且本次生成成功
- **THEN** 主进程从台账解析出该批次与目标 shotId，产物覆盖该批次 runDir 的 `shot_002.mp4`，批次状态与台账同步为已完成，**且渲染端全程未参与 runId 拼接**

#### Scenario: 出片台账批次重试不再误查流水线（本 change 新增）
- **WHEN** 全量出片批次 runId（如 `prod-<taskId>-<fp>-b0`）从未注册为流水线 run
- **THEN** `production-retry-shot` SHALL 仍能从台账正确定位并完成重试；SHALL NOT 因 `getRunSnapshot` 返回 null 而报「runId 不属于任何运行中的流水线」

#### Scenario: 重试入参非法拒绝
- **WHEN** 重试请求携带路径不安全的 taskId、越界的 batchIndex/shotIndex、缺失台账，或目标分镜 prompt 为空
- **THEN** IPC 返回带字段名与原因的校验错误，不发生 provider 调用

### Requirement: 成片合成与产物合同
film_render 阶段 SHALL 将镜头清单中按顺序可用的镜头视频合成为 final.mp4。镜头清单来源分两种：（a）默认——本 run 的 selectedShots 与本 run 目录 shot_NNN.mp4 磁盘扫描对齐（既有行为，单批 ≤ MAX_VIDEO_BATCH）；（b）全量模式——context.renderManifest 数组，每项含 `{shotId, path, sourceKind: generated|downloaded, orderIndex}`，path 必须位于 film-engineering 受控媒体根内（规范化后越界 SHALL 拒绝），清单条目间可来自不同 run 目录。**全量模式的 `path` SHALL 由「台账所载批次 `runId` + `shotFileName(orderIndex)`」得出，SHALL NOT 由调用方按 runId 派生规则重算**——派生规则是主进程内部实现细节，跨层重算即制造第二份真相源。合成规则不变：全部片段编解码规格一致时 SHALL 零重编码直拷拼接；不一致时 SHALL 仅做最小 scale+pad 归一到目标画幅（不添加转场、调色、字幕或音轨处理）；存在缺失或不可读条目时 SHALL 失败并按 orderIndex 列出缺失清单，不得输出缺镜假成片。完成后前端 SHALL 提供打开所在文件夹与另存入口，报告 SHALL 含成片时长（ffprobe 实测）与清单规模。

#### Scenario: 单批模式向后兼容
- **WHEN** 选中的 5 镜产物齐备且规格一致，推进 film_render（无 renderManifest）
- **THEN** 按选中顺序直拷拼接生成 final.mp4，行为与既有合同完全一致

#### Scenario: 跨 run manifest 聚合成功
- **WHEN** renderManifest 含多个批次 run 目录与下载目录混合来源的 144 条有效条目，orderIndex 连续
- **THEN** 按 orderIndex 顺序拼接产出全片 final.mp4，报告时长等于各片段实测之和（±拼接误差）

#### Scenario: manifest 越界路径拒绝
- **WHEN** renderManifest 某条目 path 指向受控媒体根之外（含 `..` 遍历或 junction 逃逸）
- **THEN** film_render fail-closed 拒绝并指出非法条目，不读取该路径、不产出成片

#### Scenario: 缺镜拒绝出片
- **WHEN** manifest 或磁盘扫描存在缺失/不可读条目（重试后仍缺）
- **THEN** film_render 失败并列出缺失条目序号，不生成不完整的 final.mp4

#### Scenario: 清单 path 不依赖派生规则（本 change 新增）
- **WHEN** 批次 runId 派生规则变更（含指纹），而台账仍载有旧格式 runId
- **THEN** renderManifest 的 `path` SHALL 仍指向台账所载旧 runId 对应的既有产物目录，合成不因派生规则变更而找不到文件

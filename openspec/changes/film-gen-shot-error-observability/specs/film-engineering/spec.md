## MODIFIED Requirements

### Requirement: 分镜视频生成阶段
film_generate_videos 阶段 SHALL 将选中分镜的提示词**原文**（含 `<<<uuid>>>` 令牌与全部块标签，逐字符相等）提交视频 provider：provider 统一解析自模型设置的默认视频能力（getDefault('video')），kit 分镜的 model 字段仅作展示、不参与路由；未配置默认视频 provider 时 SHALL 以 VIDEO_MODEL_NOT_CONFIGURED 失败并在错误上下文携带跳转模型设置的引导信息，不得静默回退其他 provider。该阶段 MUST NOT 调用 prompt-engine 视频优化链路的任何环节。提交参数 SHALL 携带用户发起时选择的画幅（16:9 默认 / 9:16 / 保持源规格）与全局时长（5/8/10 秒，默认 5 秒）；单批选中分镜数 SHALL 不超过 10。每镜 SHALL 按提交→轮询（上限 10 分钟）→下载到本次 run 受控目录（命名 shot_NNN.mp4，NNN 为选中序号）执行。部分镜失败时阶段 SHALL 以部分成功（partialFailure）继续，结果清单 SHALL 逐镜标注成功/失败与失败原因；**单镜失败原因 SHALL 在进入结果清单前即被记录到应用日志（含镜头序号、shotId 与可辨识的失败类别：提交被拒 / provider 返回错误 / 未返回任务 ID / 轮询超时或失败 / 下载或异常），MUST NOT 只在成功时记日志、失败时静默返回。** 全部镜失败时阶段 SHALL 失败。

#### Scenario: 提示词原文直送
- **WHEN** film_generate_videos 对某分镜发起 generateVideo 调用
- **THEN** 提交的 prompt 与该分镜导出文本逐字符一致（含 refTokens 令牌），且调用链未经过 prompt-engine 优化（对优化器的调用即为本合同违例）

#### Scenario: provider 未配置 fail-closed
- **WHEN** 用户未在模型设置配置默认视频 provider 并推进至生成阶段
- **THEN** 阶段以 VIDEO_MODEL_NOT_CONFIGURED 失败，错误含跳转模型设置页的引导，无任何 provider 调用发生

#### Scenario: 超出批次上限拒绝
- **WHEN** 发起时选中分镜超过 10 个
- **THEN** 请求在进入生成阶段前被拒绝，错误说明单批上限为 10 镜，流水线不启动计费调用

#### Scenario: 部分失败逐镜标注
- **WHEN** 一批 5 镜中 1 镜轮询超时或提交报错
- **THEN** 其余 4 镜产物正常落盘，阶段结果为部分成功，失败镜在结果清单中标注失败原因且可单独重试

#### Scenario: 单镜失败即时留痕
- **WHEN** 某镜在提交阶段被 provider 拒绝（返回非零 code 或缺任务 ID）
- **THEN** 该次失败在写入结果清单的同时经应用日志记录镜头序号、shotId 与失败原因，运维无需重跑即可从日志读取失败类别

### Requirement: 全量分批出片驱动
film-engineering SHALL 提供"全量出片"模式：输入超过 MAX_VIDEO_BATCH（10 镜）的分镜集合时，驱动 SHALL 按选择顺序自动切分为每批 ≤10 镜的批次子 run，逐批执行六阶段流水线至 generate_videos 阶段。每批 SHALL 独立经过成本确认 checkpoint（该批 costCheck 展示并确认前零 provider 调用）；批次产物落盘于各自 run 目录且 SHALL 幂等可续跑——已完成批次重入时 SHALL 跳过不重复计费；单批失败（partialFailure）SHALL 仅影响该批，失败镜可按既有单镜重试通道补齐，全部批次收口后自动生成 renderManifest 供 film_render 全片合成。驱动 SHALL 汇报批次级进度（第 k/M 批、每批逐镜状态**及失败镜的失败原因**）并持久化批次台账以支持应用重启后从断点继续；**台账每镜条目 SHALL 持久化失败原因字段（无失败时为空），使断点续跑或重启后仍可读取上次失败原因，无需重跑定位；单镜取原文（getShot）抛出的异常 SHALL 归为该镜失败并携带原因上报，MUST NOT 静默吞掉。批收口的磁盘复核权威裁决与失败隔离、幂等续跑语义保持不变。**

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

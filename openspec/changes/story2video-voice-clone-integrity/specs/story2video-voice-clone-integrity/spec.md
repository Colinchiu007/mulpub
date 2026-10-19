# story2video-voice-clone-integrity（delta）

## Purpose

定义「克隆音色本地样本完整性」的可判定语义：registry 记录必须与本地样本目录对账后才算可用，
失效原因通过 `invalidReason` 暴露；生成阶段必须在任何资源调用前对失效克隆 fail fast，
运行期全部同因 TTS 失败聚合成一条可操作提示，并在渲染层归一化为中英文文案。
判据只认下列 Requirement：`listClones` / `getCloneVoiceStatus` / catalog 失效通道 /
生成前置守卫 / 运行期聚合 / 失败去重 / 错误归一化 / 不变量。

## ADDED Requirements

### Requirement: 克隆音色本地样本完整性对账

`TtsVoiceCloneService.listClones` SHALL 对每条克隆记录做只读磁盘对账：按
`sampleStorage.relativeDir` 定位 `<userData>/voice-clone-samples/<ownerHash>/<storageId>`，
仅当目录存在、非符号链接、且目录内至少有一个文件的扩展名属于 `ALLOWED_AUDIO_EXTENSIONS` 时
判定为有效。失效记录 MUST 输出 `invalid:true` 与 `invalidReason ∈ {invalid_voice_id,
sample_storage_missing}`；`invalid_voice_id` MUST 优先于 `sample_storage_missing`；
有效记录 MUST NOT 输出 `invalidReason`。无 `sampleStorage` 的历史记录 MUST NOT 因样本状态判失效。

#### Scenario: 样本目录被删除
- **WHEN** registry 存在 `deletionState=active` 的克隆记录，但其样本目录不存在
- **THEN** `listClones` 返回该记录 `invalid:true` 且 `invalidReason='sample_storage_missing'`

#### Scenario: 样本目录完好
- **WHEN** 克隆记录有效且样本目录内至少有一个音频扩展名文件
- **THEN** `listClones` 不输出 `invalid`，也不输出 `invalidReason`

#### Scenario: 目录内没有音频文件
- **WHEN** 样本目录存在但为空，或所有文件名扩展名都不在 `ALLOWED_AUDIO_EXTENSIONS` 内
- **THEN** 该记录被判 `invalid`，`invalidReason='sample_storage_missing'`

#### Scenario: 非法 voice_id 优先
- **WHEN** 同一记录既满足 provider 的 voice_id 约束失败，又样本目录缺失
- **THEN** `invalidReason='invalid_voice_id'`（不输出样本缺失原因）

#### Scenario: 不可判定时 fail-open
- **WHEN** `userData` 路径不可解析，或 `lstat` / `readdir` 抛出非 ENOENT 错误
- **THEN** 该记录 MUST NOT 被判失效（按不可判定处理，保持既有可用性）

#### Scenario: 不安全的 sampleStorage 不做探测
- **WHEN** `sampleStorage.relativeDir` 段数不为 3、owner 段不匹配、或含 `..` / 路径分隔符 / 超长段
- **THEN** 不执行任何文件系统访问，直接按 `sample_storage_missing` 处理

### Requirement: 只读音色可用性查询

`TtsVoiceCloneService` SHALL 提供只读方法 `getCloneVoiceStatus({providerId, model, voiceId})`，
返回 code/data 信封：命中有效 → `{code:0,data:{registered:true,name,invalid:false,invalidReason:null}}`；
命中失效 → `{code:0,data:{registered:true,name,invalid:true,invalidReason}}`；
未命中 → `{code:0,data:{registered:false}}`；非法入参 / owner 不可解析 / store 不可用 →
`{code:-1,message}` 分别为 `VOICE_CLONE_INVALID_ARGUMENTS` / `VOICE_OWNER_UNAVAILABLE` /
`VOICE_CLONE_STORE_UNAVAILABLE`。该方法 MUST 遵守 owner 隔离、MUST 支持与
`findCloneSamples` 同风格的模型候选回退，且 MUST NOT 写 registry 或偏好、MUST NOT 清理样本。

#### Scenario: 查询有效克隆
- **WHEN** 以当前 owner、正确 provider/model 查询一条样本完好的克隆
- **THEN** 返回 `registered:true`、`invalid:false`、`invalidReason:null` 与记录名称

#### Scenario: 查询失效克隆
- **WHEN** 记录存在但样本目录缺失
- **THEN** 返回 `registered:true`、`invalid:true`、`invalidReason='sample_storage_missing'`

#### Scenario: 查询未注册音色
- **WHEN** voiceId 不属于当前 owner 的任何 registry 记录
- **THEN** 返回 `{code:0, data:{registered:false}}`，且不返回 name/invalid

#### Scenario: owner 隔离
- **WHEN** 另一个 owner 会话查询该 voiceId
- **THEN** 返回 `registered:false`

#### Scenario: 模型候选回退
- **WHEN** 记录实际绑定在 `speech-2.8-turbo`，调用方用 `speech-2.8-hd` 查询
- **THEN** 仍命中该记录并返回 `registered:true`

#### Scenario: 只读
- **WHEN** 任意一次 `getCloneVoiceStatus` 调用返回（成功或失败）
- **THEN** registry 与偏好内容逐字节不变，样本目录不被创建/删除/改写

### Requirement: 音色目录的失效通道与偏好回退

`tts-voice-service._buildCatalogResponse` SHALL 继续遵守既有 7.1.16 合同：`invalid===true` 的
克隆 MUST 移入 `invalidVoices`、MUST 从可选 `voices` 移除；偏好指向失效音色时 MUST 回退到
默认音色，并在偏好存在时写回。新增的 `sample_storage_missing` 失效来源 MUST 与
`invalid_voice_id` 一样自动继承该通道。

#### Scenario: 失效克隆不进入可选项
- **WHEN** catalog 构建时 `listClones` 返回 `invalid:true`
- **THEN** 该克隆只出现在 `invalidVoices`，不出现在 `voices`

#### Scenario: 偏好回退
- **WHEN** 音色偏好指向已失效克隆
- **THEN** catalog 的 `selectedVoiceId` 回退为默认音色，且偏好被写回默认音色（既有行为）

### Requirement: 生成前置守卫

`story2video-stages.generate_assets` SHALL 在创建任何图片/视频/TTS 调用之前调用只读状态查询；
当结果为 `registered===true && invalid===true` 时 MUST 立即失败，错误 MUST 以
`VOICE_CLONE_UNAVAILABLE` 为前缀，且 MUST NOT 产生任何图片/视频/TTS 生成调用。
manual 模式的 TTS 由 `finalize_assets` 在生成旁白前用同一 helper 守卫。
守卫 MUST fail-open：克隆服务缺失、方法缺失、查询抛错、非 0 信封、`registered:false`、
`invalid:false`、默认音色或非克隆 provider 时 MUST 放行。

#### Scenario: 样本缺失时阻止生成
- **WHEN** 状态查询返回 `registered:true, invalid:true, invalidReason='sample_storage_missing'`
- **THEN** `generate_assets` 立即返回失败，错误以 `VOICE_CLONE_UNAVAILABLE: ` 开头，
  包含音色名称、样本缺失原因与「本次未生成任何图片与旁白」，且图片/视频/TTS 生成调用次数为 0

#### Scenario: 非法 voice_id 时阻止生成
- **WHEN** 状态查询返回 `invalidReason='invalid_voice_id'`
- **THEN** 错误包含「音色 ID 不合法」，仍不产生任何资源调用

#### Scenario: manual 最终化阻止 TTS
- **WHEN** manual 模式进入 `finalize_assets` 且所选克隆失效
- **THEN** 在生成任何 TTS 之前失败，错误前缀同为 `VOICE_CLONE_UNAVAILABLE`

#### Scenario: 守卫自身故障不阻断
- **WHEN** `ttsVoiceCloneService` 未注册、缺少 `getCloneVoiceStatus`、或查询抛错
- **THEN** 生成继续执行（fail-open），不得把守卫故障变成任务失败

#### Scenario: 有效克隆不误伤
- **WHEN** 状态查询返回 `registered:false` 或 `invalid:false`
- **THEN** 生成正常执行

### Requirement: 运行期 TTS 失败聚合与断点保留

当已实际发生 TTS 失败且全部失败均满足「克隆音色不可用」判定时，`generate_assets` MUST 在
写入 `context.generate_assets.resume` 之后返回单条聚合错误：
`VOICE_CLONE_UNAVAILABLE: 所选克隆音色已不可用（供应商拒绝访问，且本地样本无法用于重新克隆）。
请在「声音」设置中重新克隆或改选其它音色后重新启动。`。该错误 MUST NOT 重复原始供应商英文、
MUST NOT 出现 `TTS #`；混合原因 MUST 继续走既有失败聚合。

#### Scenario: 9 条同因失败聚合为一条
- **WHEN** 9 条 TTS 全部因 `you don't have access to this voice_id` 失败
- **THEN** 阶段返回的 `error` 中 `VOICE_CLONE_UNAVAILABLE` 与「供应商拒绝访问」各出现 1 次，
  不含原始英文、不含 `TTS #`，且 `context.generate_assets.resume` 已写入（含已完成场景断点）

#### Scenario: 混合原因不聚合
- **WHEN** TTS 失败中同时存在克隆音色不可用、限流、网络错误
- **THEN** 不触发聚合，按既有失败聚合逐条输出（相同错误仍去重）

### Requirement: 失败聚合去重与场景区间

`summarizeAssetFailures` SHALL 按归一化后的相同 message 分组，保持首次出现顺序，
并输出场景索引：单条 `#3`、连续两条及以上 `#1-#3`、非连续 `#1, #3`、索引缺失 `#?`；
Image 与 TTS MUST 共用同一实现与格式。

#### Scenario: 连续相同错误
- **WHEN** 场景 1–3 的 TTS 失败 message 相同
- **THEN** 输出一条 `TTS #1-#3: <message>`

#### Scenario: 非连续相同错误
- **WHEN** 场景 1 与 3 的失败 message 相同，场景 2 不同
- **THEN** 输出 `TTS #1, #3: <message>`，并另输出场景 2 的错误

#### Scenario: 单条失败保持旧格式
- **WHEN** 只有场景 3 失败
- **THEN** 输出 `TTS #3: <message>`（与旧格式一致）

### Requirement: 错误归一化与本地化文案

桌面端 SHALL 新增 `VOICE_CLONE_UNAVAILABLE_PATTERN` 与通知键
`VOICE_CLONE_UNAVAILABLE → 'story2video.voice_clone_unavailable'`，并在
`resolveMessageKey` 与 `pipeline-error-formatter` 中把判定置于 `VOICE_INVALID` 与
`asset_generation_failed` 之前。locale key MUST 在 `locales/story2video/{zh,en}.js` 成对存在且
中文文案逐字为：
`所选克隆音色不可用：供应商已不再受理该音色，且本地克隆样本缺失，无法自动重建。请在「声音」设置中重新克隆该音色或改选其它可用音色，然后重新启动。`

#### Scenario: 错误码归一化
- **WHEN** 通知携带 `errorCode='VOICE_CLONE_UNAVAILABLE'`
- **THEN** 展示 `story2video.voice_clone_unavailable` 文案

#### Scenario: 供应商原文归一化
- **WHEN** 原始错误为 `you don't have access to this voice_id` 且以 `Asset scene generation failed:` 包裹
- **THEN** 仍归一化为新键，不得落到 `VOICE_INVALID` 或 `asset_generation_failed`

#### Scenario: 英文界面
- **WHEN** 当前 locale 为 en
- **THEN** 展示对应英文文案（与 zh 成对存在）

### Requirement: 不变量

本变更 MUST NOT 改变故事讲述流水线的阶段数量与顺序、MUST NOT 新增 checkpoint 类型、
MUST NOT 静默替换用户音色（失效即失败；重克隆只允许用本地样本重建后重试）。
与 PRD §7.1.16.1 三层降级的关系：样本存在时 Layer 1 仍可重克隆恢复；样本缺失时终态失败并由
本变更给出可操作提示。

#### Scenario: 阶段编排不变
- **WHEN** 以 auto 模式启动 `story2video-compose`
- **THEN** 仍是 7 阶段、`generate_assets` 仍为第 5/7，守卫失败不产生新 checkpoint

#### Scenario: 不静默替换
- **WHEN** 所选克隆音色在运行期不可用且本地样本无法重建
- **THEN** 流水线失败并给出提示，不得改用供应商默认官方音色产出成片

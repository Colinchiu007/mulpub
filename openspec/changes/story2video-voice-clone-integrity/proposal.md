# 克隆音色本地样本完整性核验 + 生成前置守卫（story2video-voice-clone-integrity）

## Why

2026-10-18 22:32–22:44（本地）真实事故：项目 `mvdxd21s_o1ws` 的故事讲述流水线在
`generate_assets`（第 5/7 阶段）失败，`0/9` 场景同时具备图片与旁白；9 条 TTS 全部被供应商拒绝
（原文 `you don't have access to this voice_id`），重克隆回退因本地样本目录
`voice-clone-samples/<ownerHash>/47f825cb-634e-4c5f-8d90-cc904e547411` 不存在而抛 ENOENT。
SQLite registry（`tts-voice-clones:v2:minimax-multimodal:speech-2.8-turbo`）里该记录仍为
`deletionState=active`，音色偏好与 `story2video.lastOptions.v1` 也仍指向该 `voiceId`。

即三方证据互相矛盾：**registry 说存在、磁盘样本已不在、供应商也已拒绝**。而修复前程序：

1. `TtsVoiceCloneService.listClones` 只校验 `voice_id` 格式，从不与样本磁盘对账，
   于是「幽灵克隆」一直以可选项出现；
2. `story2video-stages.generate_assets` 没有任何音色前置守卫，直接把 `voiceId` 交给 TTS；
3. `tryReCloneVoice` 的样本读取对 ENOENT 只是 catch 后返回 null，用户拿到的是原始英文；
4. `summarizeAssetFailures` 按场景逐条拼接，同一句英文重复 9 次；
5. 渲染层 `VOICE_INVALID_PATTERN` 覆盖 not found / invalid / unavailable 等形态，
   匹配不到「没有访问权」，用户只看到不可操作的通用英文错误。

### 根因溯源（QM-5 ①）

- **第一性原因**：把「registry 里有记录」当成「音色可用」。`listClones` 的失效判定只有
  `isProviderCloneVoiceIdValid`（voice_id 格式），而 registry 记录的有效性还依赖
  `sampleStorage.relativeDir` 指向的本地样本目录——后者可能被手工清理、磁盘迁移丢失、
  其它工具误删或同步缺失，但 registry 没有任何对账机制。
- **引入点**：样本持久化（PRD §7.1.16.1）把「本地样本可重建」作为三层降级的 Layer 1，
  但只实现了「写入 + 读取」，没有实现「读取前先确认还在」；`listClones` 的失效判定在
  §7.1.16 只覆盖 voice_id 格式，没有随样本持久化一起扩展。
- **触发条件**：registry active + 样本目录缺失 + 偏好/lastOptions 仍指向该 voiceId +
  供应商不再受理该 voiceId（四者同时成立即必现）。

### 逃逸链（QM-5 ②）

| 层级 | 为什么没拦住 |
|---|---|
| 服务单元测试 | `tts-voice-clone-service.test.js` 覆盖克隆增删改查与样本读取，但没有「记录还在、目录被删」的用例；`listClones` 的既有断言只覆盖非法 `voice_id`（如 `"01"`） |
| catalog 单元测试 | `tts-voice-service.test.js` 的 `invalidVoices` 用例只构造 `invalid:true` 的替身，验证的是 catalog 的消费逻辑，不验证 `listClones` 能否产出该标记 |
| 阶段单元测试 | `story2video-stages.test.js` 覆盖 TTS 失败、重克隆、失败聚合，但没有「生成前就确定音色失效」的用例；失败聚合用例使用的错误各不相同，测不出重复拼接 |
| 渲染层测试 | 通知/格式化测试覆盖 voice not found / invalid / 当前账号无权访问等形态，没有覆盖供应商原文 `you don't have access to this voice_id`；也没有「错误码前缀优先于通用素材失败」的顺序锁 |
| 集成 / E2E | 真实运行只覆盖正常音色与「供应商拒绝但本地样本完好」的重克隆成功路径；「样本也被删」的双失效组合没有夹具 |
| 代码审查 | 样本持久化被当作「有备份」的兜底，未追问「备份本身是否还在」；`tryReCloneVoice` 的 catch 把 ENOENT 归入普通失败，掩盖了它其实是**可预判**的失效 |

### 系统性漏洞（QM-5 ③）

1. **完整性校验缺失（测试场景缺失）**：持久化能力只测「写入/读取」，不测「读取对象已消失」。
   「本地副本」类能力都需要一个「存在性对账」判据，否则它只是乐观假设。
2. **失效通道只有单一来源（测试质量不足）**：§7.1.16 的「失效」概念只由 voice_id 格式产生，
   后续新增失效来源（样本缺失、供应商撤销）没有统一的 `invalidReason` 枚举位置，
   消费方（catalog/前端/流水线）也无法区分原因。
3. **守卫缺位（流程缺失）**：生成阶段对「用户显式选择的资源是否可用」没有前置检查，
   把可预判的失败推给运行期，代价是满额度的资源调用与不可操作的长错误。
4. **错误呈现无聚合（审查盲区）**：失败聚合按条拼接在「批量资源」场景必然产生重复噪音，
   但没有任何测试对「相同错误只出现一次」做断言。

## What Changes

1. **服务层：本地样本完整性对账（只读）**
   - `TtsVoiceCloneService.listClones` 对每条克隆记录执行只读磁盘对账：
     `sampleStorage` 合法性 → `userData` 可解析 → 目录存在/非符号链接 → 目录内至少一个
     `ALLOWED_AUDIO_EXTENSIONS` 扩展名文件。
   - 失效记录输出 `invalid:true` 与 `invalidReason ∈ {invalid_voice_id, sample_storage_missing}`
     （前者优先）；有效记录不输出 `invalidReason`；无 `sampleStorage` 的历史记录不判失效。
   - `userData` 不可解析或 IO 不可判定 ⇒ `unknown`（fail-open，不判失效）；`sampleStorage`
     形状不安全 ⇒ 不做文件系统探测，直接按 `sample_storage_missing`（fail-closed 输入侧）。
2. **服务层：只读状态查询**
   - 新增 `getCloneVoiceStatus({providerId, model, voiceId})`，返回
     `{registered, name, invalid, invalidReason}` 的 code/data 信封；owner 隔离；
     模型候选回退与 `findCloneSamples` 同风格；不写 registry/偏好。
3. **catalog：自动继承既有 7.1.16 合同**
   - `_buildCatalogResponse` 不改：`invalid===true` 的克隆移入 `invalidVoices`、移出可选
     `voices`，偏好不命中回退默认音色并写回。
4. **阶段层：生成前置守卫**
   - `generate_assets` 在创建任何图片/视频/TTS 调用之前调用共享
     `resolveVoiceCloneGuard`（`story2video-voice-guard.js`）；命中 `registered && invalid` 立即失败，前缀
     `VOICE_CLONE_UNAVAILABLE`，不产生任何资源调用。
   - manual 模式的 TTS 由 `finalize_assets` 在生成旁白前复用同一 helper
     （候选图片/视频生成不生成 TTS，故不在候选阶段阻断）。
   - 服务缺失/方法缺失/查询抛错/未注册/有效克隆 ⇒ 放行（fail-open，不得把守卫故障变成任务失败）。
5. **阶段层：运行期聚合与失败去重**
   - 全部 TTS 失败且错误均满足 `isClonedVoiceUnavailableMessage` ⇒ 单条
     `VOICE_CLONE_UNAVAILABLE` 聚合错误（先写 `context.generate_assets.resume`）。
   - `summarizeAssetFailures` 对相同 message 去重并按首次出现顺序输出场景区间
     （`#3` / `#1-#3` / `#1, #3` / `#?`），Image/TTS 共用。
6. **渲染层：错误归一化与文案**
   - 新增 `VOICE_CLONE_UNAVAILABLE_PATTERN`、通知键 `VOICE_CLONE_UNAVAILABLE`、
     locale key `story2video.voice_clone_unavailable`（zh/en 成对）。
   - `resolveMessageKey` 与 `pipeline-error-formatter` 的判定早于 `VOICE_INVALID` 与
     `asset_generation_failed`。
7. **文档**：新增详细 PRD、总 PRD §7.1.16.4（两处副本）、PRD-video-creation 变更记录、
   本 OpenSpec change、执行记录、CHANGELOG、learnings。

## Non-goals

- 不做自动重建（样本目录已丢失时无法凭空重建），只给可操作提示与恢复路径。
- 不静默替换用户音色（延续 PRD §7.1.16.2）；失效即失败。
- 不改 registry schema、不改数据库结构、不迁移历史数据。
- 不在生成前校验供应商侧是否撤销（只能判本地样本完整性；供应商侧撤销由运行期重克隆/聚合兜底）。
- 不改变阶段数量/顺序、不新增 checkpoint 类型。
- 不修复配置页/克隆列表既有硬编码中文的 i18n 存量债务。

## Impact

- 主进程：`apps/desktop/electron/services/tts-voice-clone-integrity.js`（纯逻辑）、
  `apps/desktop/electron/services/tts-voice-clone-service.js`（薄封装）、
  `apps/desktop/electron/services/story2video-voice-guard.js`（守卫/聚合纯逻辑）、
  `apps/desktop/electron/services/story2video-stages.js`（接入）（`tts-voice-service.js` 不改）。
- 渲染层：`apps/desktop/src/story2video/notification-error-patterns.js`、
  `story2video-notifications.js`、`apps/desktop/src/utils/pipeline-error-formatter.js`、
  `apps/desktop/src/locales/story2video/{zh,en}.js`。
- 测试：新增 `electron/services/tts-voice-clone-integrity.test.js`（8 例）与 `electron/services/story2video-voice-guard.test.js`（10 例），并扩展通知（5 例）/格式化器（3 例）用例；既有 `tts-voice-clone-service.test.js` / `story2video-stages.test.js` 作回归。
- 文档：新 PRD、`01-docs/PRD.md` §7.1.16.4（两处副本）、`01-docs/PRD-video-creation.md`、
  本 change、执行记录、CHANGELOG、learnings。
- 不改数据库 schema、不改 IPC 既有通道语义、不改 CI 工作流。

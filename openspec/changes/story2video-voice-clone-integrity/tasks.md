# Tasks：story2video-voice-clone-integrity

## 1. 服务层：样本完整性对账与只读状态查询（TDD）

- [x] 1.1 写服务测试（`electron/services/tts-voice-clone-integrity.test.js`）：样本目录缺失 → `invalid:true` + `invalidReason='sample_storage_missing'`；目录完好不标失效且不输出 `invalidReason`
- [x] 1.2 写服务测试：非法 `voice_id` 优先于样本缺失（`invalid_voice_id`）；无 `sampleStorage` 的历史记录不判失效
- [x] 1.3 实现 `tts-voice-clone-integrity.js` 的 `inspectSampleStorage`（服务层 `_sampleStorageStatus` 薄封装）：`ok / missing / unknown` 三态；`sampleStorage` 形状不安全时不做文件系统探测（fail-closed 输入侧）
- [x] 1.4 实现 `buildPublicCloneEntries` 并改造 `listClones`：逐条对账并输出 `invalid`/`invalidReason`（有效记录不带 reason）
- [x] 1.5 实现 `readCloneVoiceStatus` 并接入 `getCloneVoiceStatus({providerId, model, voiceId})`：code/data 信封、owner 隔离、模型候选回退、只读
- [x] 1.6 写服务测试：`getCloneVoiceStatus` 五态（有效/失效/未注册/非法入参/owner/store 错误）+ owner 隔离 + 模型回退
- [x] 1.7 回归既有克隆能力：`getRequirements` / `createSampleSelection` / `addCloneFromSelection` / `deleteClone` / `replaceCloneVoiceId` / `findCloneSamples` 行为不变

## 2. 阶段层：前置守卫、运行期聚合、失败去重（TDD）

- [x] 2.1 写阶段测试（`electron/services/story2video-voice-guard.test.js`）：守卫命中时零图片/零 TTS 调用、错误前缀与关键片段、音色名称与原因
- [x] 2.2 实现 `story2video-voice-guard.js` 的 `resolveVoiceCloneGuard({pipelineEngine, voiceId, providerId, model})` + `buildVoiceCloneUnavailableError`：只读查询 + 失效原因映射 + warn 日志（`voiceId/provider/reason`，不含音频/密钥/绝对路径）
- [x] 2.3 接入 `generate_assets`：位于 `writeAssetsProgress()` 之后、任何 image/video/TTS Promise 创建之前；命中立即失败
- [x] 2.4 写阶段测试：守卫 fail-open 三种（服务缺失/方法缺失/查询抛错）与不误伤两种（未注册/有效克隆）
- [x] 2.5 接入 manual `finalize_assets`：在生成旁白前复用同一 helper
- [x] 2.6 写阶段测试：运行期 9 条同因 TTS 失败聚合为单条、无原始英文/无 `TTS #`、`context.generate_assets.resume` 仍写入
- [x] 2.7 实现运行期聚合：`buildVoiceCloneAggregateError`（`failedTts.every(isClonedVoiceUnavailableMessage)`）+ 先写 resume 再返回聚合错误
- [x] 2.8 收敛克隆不可用判定：`story2video-voice-guard.js` 的 `isClonedVoiceUnavailableMessage` 被 `tryReCloneVoice` 与聚合共用（保留 `INVALID_CONFIG` 分支）
- [x] 2.9 改写 `summarizeAssetFailures`（`story2video-voice-guard.js`）：相同 message 去重 + `#3` / `#1-#3` / `#1, #3` / `#?`；经 `story2video-stages.js` 过渡期重导供测试直接断言
- [x] 2.10 写阶段测试：`summarizeAssetFailures` 四形态 + `isClonedVoiceUnavailableMessage` 正反例（限流/额度/网络不得误判）
- [x] 2.11 抽出 `story2video-voice-guard.js` 纯逻辑模块（避免 `story2video-stages.js` 行数越界），`story2video-stages.js` 保留过渡期重导

## 3. 渲染层：错误归一化与文案（TDD）

- [x] 3.1 `notification-error-patterns.js` 新增 `VOICE_CLONE_UNAVAILABLE_PATTERN`（错误码前缀 + 「没有访问权」原文变体）
- [x] 3.2 `story2video-notifications.js` 新增通知键 `VOICE_CLONE_UNAVAILABLE` 与 `resolveMessageKey` 顺序（早于 `VOICE_INVALID`），并接受 `errorCode`
- [x] 3.3 `pipeline-error-formatter.js` 新增 `voice_clone_unavailable` 规则，位置早于 `asset_generation_failed`
- [x] 3.4 locales `story2video/{zh,en}.js` 成对新增 `voice_clone_unavailable`（逐字见详细 PRD §9）
- [x] 3.5 写渲染层测试：错误码/原文归一化、zh/en 逐字、顺序锁（不得被 `VOICE_INVALID`/通用素材失败吞掉）

## 4. 文档

- [x] 4.1 新增详细 PRD：`01-docs/PRD-S2V-VOICE-CLONE-INTEGRITY-2026-10-18.md`（事故/数据校验/流程/判定/交互/显示项/可观测性/验收/测试/风险）
- [x] 4.2 `01-docs/PRD.md` 追加 §7.1.16.4（两处完全相同副本，逐字节一致；用 node 脚本定位插入）
- [x] 4.3 `01-docs/PRD-video-creation.md` §1.6 变更记录追加一行
- [x] 4.4 本 OpenSpec change：proposal / design / tasks / spec delta
- [x] 4.5 执行记录 `openspec/records/fix-s2v-voice-clone-integrity.md`（QM-5 五步 + 门禁表 + 勾账）
- [x] 4.6 `CHANGELOG.md` 顶部条目（问题/改动/验证三段）
- [x] 4.7 `01-docs/learnings.md` 顶部新增 `lesson:` 教训

## 5. 质量节拍与交付

- [ ] 5.1 定向测试全绿（服务层 + 阶段层 + 渲染层三个测试文件）
- [ ] 5.2 宽范围回归（story2video 相关服务/渲染层既有用例）
- [ ] 5.3 ESLint、locale 成对校验（`check-locale-sync`）、行尾两口径对账
- [ ] 5.4 QM-1：`electron-builder --win --dir` + asar 清单 + require 链 + 启动 stderr 三层判据
- [ ] 5.5 QM-6 双模型外部评审（codex + claude）
- [ ] 5.6 提交、推送、开 PR；CI 全绿后 squash 自动合并并删除远端分支
- [ ] 5.7 合并后回读该 merge SHA 的 `quality-gate.yml` push run；收口由 `merge-ledger` 推导（不手写状态词、不另开回填 PR）

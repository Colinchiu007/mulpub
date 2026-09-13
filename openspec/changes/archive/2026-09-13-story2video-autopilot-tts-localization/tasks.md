# 实现任务清单（2026-08-08 差异审计后更新）

> 审计结论：本清单基于 requirements 基线 8 项。差异审计（基线 vs 已合并 main）确认约 15 项已由 PR #352 等交付；
> 标注 [已交付] 的项为代码审计确认存在；[待办] 为未实现；[待确认] 依赖用户/外部决策。

## 1. i18n 与流水线更名（基础层）

- [x] 1.1 建立 zh/en i18n 资源并迁移硬编码文案 [已交付：src/locales/zh.js:70-89, en.js；i18n.test.js]
- [x] 1.2 流水线展示名更改为「图片轮播 / Image Carousel」[已交付：zh.js:106 pipelines.names['story2video-compose']]
- [x] 1.3 中英双语言视觉回归 [已交付：PR #352 合入门禁 .quality-gates.md:706 PASS]

## 2. 自动流水线执行与阶段清单

- [x] 2.1 参数提交后自动连续执行 [已交付：pipeline-engine.js:1088-1098 autoAdvance + _autoAdvanceRun]
- [x] 2.2 启动按钮文案「启动流水线」[已交付：CreateView.vue:654-655 i18n 键 startPipeline]
- [x] 2.3 阶段清单进度组件 [已交付：CreateView.vue:60 story2video-stage-list；stages 状态机]
- [x] 2.4 阶段失败后的错误与恢复 [已交付：failed 状态 + content_policy 暂停提示 CreateView.vue:666-668 + 取消重启动]

## 3. 参数收敛

- [x] 3.1 隐藏音调/并发/创意强度，使用默认值 [已交付：CreateView.vue:992-994 voicePitch:0/concurrency:3；界面无控件]
- [x] 3.2 分句语言默认「自动识别」[已交付：CreateView.vue:474-476 splitLanguage='auto']
- [ ] 3.3 运营后台配置读取 [待办/待确认：代码审计确认全库无 opscenter/运营后台/remoteConfig 实现；当前仅本地默认值。需用户澄清运营后台是否真实存在，否则降级为「仅默认值」]

## 4. 图片风格与提示词风格语义去重

- [x] 4.1 明确语义关系并实现去重/保留 [已交付：zh.js:71-72 imageStyleHint vs promptStyleHint 语义区分]
- [x] 4.2 配置持久化与恢复 [已交付：s2vConfig 持久化 lastOptions.v1（PR #352）]

## 5. TTS 音色管理

- [x] 5.1 按模型绑定内置音色 + 能力表 [已交付：tts-voice-catalog.js:57 PROVIDER_MODEL_CAPABILITIES 白名单]
- [x] 5.2 个人音色槽位：保存/读取/绑定来源模型 [已交付：tts-voice-clone-service.js:13 registry v2 + :99-122 持久化 + owner 隔离]
- [ ] 5.3 音色复制（内置→个人、个人→个人）[待确认：无 duplicateVoice/copyVoice 实现；现有「上传样本克隆」是否覆盖需求语义待用户确认]
- [x] 5.4 约束强制执行（克隆/文件限制/API 模型）[已交付：LOCAL_CLONE_SAMPLE_LIMITS + isProviderCloneVoiceIdValid]
- [x] 5.5 IPC/持久化回归 [已交付：tts-voice-catalog.test.js / tts-voice-clone.test.js / tts-voice-service.test.js 存在]

## 6. 图片生成拒绝类失败重试

- [x] 6.1 提示词风险分析 [已交付：story2video-image-retry.js:191 content_policy_safe_rewrite]
- [x] 6.2 受控重写重试 ≤5 次 [已交付：MAX_IMAGE_GENERATION_ATTEMPTS=5 + normalizeAttemptLimit]
- [x] 6.3 第 5 次失败可操作提示 [已交付：CreateView.vue:666-668 checkpoint.recommendation]

## 7. 文档与 UE 建议

- [x] 7.1 PRD 更新 [已交付：01-docs/PRD-video-creation.md 已含自动流水线/TTS/重试]
- [ ] 7.2 独立 UE 优化建议 [待确认：独立交付物，用户确认后实施]
- [x] 7.3 CHANGELOG 与文档同步 [已交付：CHANGELOG.md 图片轮播条目]

## 8. 门禁与交付

- [ ] 8.1 全量测试 + QM-1 打包验证 [待办：实现剩余项后执行]
- [ ] 8.2 中英双语手动验收 [待办]
- [ ] 8.3 openspec archive 三同步 [待办：剩余项（3.3/5.3/7.2）决策完成后执行]

## 审计说明（2026-08-08）

- 已交付项证据：apps/desktop 源码 + locales + PR #352 合并记录（c895a611）
- 待办核心：运营后台配置（3.3）、音色复制（5.3）——均需用户决策
- 待确认：用户清单第 11 项（空）、UE 优化建议（7.2）
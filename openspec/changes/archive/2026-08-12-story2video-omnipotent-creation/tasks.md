# Tasks: story2video-omnipotent-creation

## 前置
- [x] 0.1 差异审计结论：video-carousel-blend（select_video_scenes/混合合成）与参数治理已交付（openspec/specs 有 spec），本 change 只承载真实待办
- [x] 0.2 OpenSpec validate 通过（proposal/design/specs/tasks 依赖顺序）

## 后端引擎与契约
- [x] 1.1 normalizer：creation 段（mode/materialMode）枚举校验 + 默认值 + stageOptions.generate_assets/finalize_assets 输出（story2video-text-config.js）
- [x] 1.2 pipeline-engine：manual 模式动态插入 finalize_assets 阶段；resolveRuntimeStageOptions 增加 creationMode/manualMaterialMode
- [x] 1.3 story2video-stages generate_assets manual 分支：每场景 2 图（同提示词）、video-image 额外 1 视频、跳过 TTS、candidates 清单、scene_asset_selection checkpoint
- [x] 1.4 story2video-stages 新增 finalize_assets 执行器：选择校验 + TTS 生成 + 最终 manifest 组装
- [x] 1.5 翻译生成：optimize 后 uiLocale≠en 时按场景翻译 prompt → context.optimize.promptTranslations；generate_assets 写入 promptTranslation
- [x] 1.6 project-service：segment 持久化 promptTranslation；_safeOptions 增加 creationMode/manualMaterialMode
- [x] 1.7 IPC：pipeline:confirmSceneAssets（校验/写 context/推进）+ preload + api/publisher + ipc-contract 测试
- [x] 1.8 run-state-store：paused 快照含 checkpoint；resumeOrchestration 支持 paused+scene_asset_selection 恢复
- [x] 测试：story2video-text-config.test.js、story2video-stages.test.js、pipeline-engine.test.js、pipeline-story2video-contract.test.js、ipc-contract.test.js 新增/更新用例（normalizer 枚举、候选生成、选择校验、恢复、阶段插入）

## 前端 UI 与 i18n
- [x] 2.1 更名：zh/en pipelines.names/descriptions.story2video-compose、configurationTitle、access_denied、selectVideoScenesOff 等
- [x] 2.2 视频增强区：创作模式 radio（全自动/分镜素材自选）+ 成本提示 + 素材模式 radio（全部图片轮播/视频+图片轮播）+ 说明；s2vConfig 默认值与恢复白名单
- [x] 2.3 SceneAssetSelection 面板组件：候选缩略图（shareUrl）、单选、默认选中（视频优先/第 1 图）、确认提交 IPC、loading/错误态
- [x] 2.4 CreateView 集成：updateOrchestrationStatus 检测 scene_asset_selection checkpoint → 展示面板；恢复路径 paused 返回选择面板；提交 creation 段
- [x] 2.5 ResultView：分段 promptTranslation 只读展示（locale≠en 且有值）；data-testid
- [x] 2.6 组件测试：SceneAssetSelection、CreateView 联动、ResultView 翻译块、i18n 一致性
- [x] 测试：CreateView.test.js/新组件测试（SceneAssetSelection/ResultView 翻译/创作模式）、locales 一致性（zh/en key parity 727=727）、views 断言更新（全能创作）

## 文档与质量门禁
- [x] 3.1 PRD.md（01-docs 与 ops-center/docs）补充：数据校验、流程、功能逻辑、交互逻辑、显示项、提示文字
- [x] 3.2 01-docs 相关文档（如 Story2Video PRD/learnings）同步；CHANGELOG 记录
- [x] 3.3 质量节拍：双模型审查（Claude 完成 2 轮：设计评审 + 代码审查；antigravity 地区不可用降级记录）→ Critical/Warning 修复 → 回归复测全绿
- [x] 3.4 全量相关测试通过（text-config/stages/pipeline-engine/ipc/ui/i18n）+ QM-1 打包（如涉 electron 主进程打包验证）
- [x] 3.5 E2E 真实流程：已登录 Profile + 保存的模型 key，跑通 manual（全部图片轮播 2 图选择 → TTS → 合成）与全自动基线
- [x] 3.6 git：commit、push、PR #653、CI 全绿（含 QG Coverage/Shards/Browser E2E/gui/electron-tests/build 双平台）、merge ecc30d3c；本归档提交完成三同步

## 待确认（记录不阻塞）
- [x] 4.1 「视频+图片轮播」下 videoMode 默认值是否随素材模式联动（当前：沿用现有 videoMode 默认 off，用户在视频增强区自选）——按需求"参照现有判断逻辑"实现，文档注明

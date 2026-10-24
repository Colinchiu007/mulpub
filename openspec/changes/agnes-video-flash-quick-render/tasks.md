# Tasks — agnes-video-flash-quick-render

> 进度以本文件为唯一来源。每组任务 ≤ 一个会话。

## 1. 规格与文档（先文档再代码）

- [x] `openspec/changes/agnes-video-flash-quick-render/`：proposal / design / spec delta（`agnes-video-quick-render` + `s2v-video-generation-contract`）
- [x] `01-docs/PRD-video-creation.md`：快速渲染页的 AI 视频能力矩阵（4 模式 × 媒体要求 × 参数区）
- [x] `01-docs/ARCH-QUICK-RENDER-AGNES-VIDEO.md`：模块归属 + 三层参数契约 + 能力判据 + 进度载荷形状（`DESIGN.md` 是视觉设计系统文档，不承载模块架构，故按仓内 `ARCH-*` 惯例另立）
- [x] `01-docs/i18n-glossary.md`：登记新增文案（模式名 / 参数名 / 错误提示）
- [x] `CHANGELOG.md` 未发布段

## 2. TDD：先写失败测试

- [x] `electron/services/scene-video-generator.test.js`（新增）：媒体参数透传 / 无值不写键 / 显式 seconds 优先 / onProgress 阶段回调 / 既有行为不回退
- [x] `electron/services/adapters/agnes-multimodal.test.js`：能力描述驱动的 size 档位与媒体上限 / 未知模型保守回落 / Flash 拒收参考视频
- [x] `electron/ipc-handlers/render.test.js`：扩展入参校验（缺 prompt / 模式与媒体不匹配 / 时长越界 / 画幅非法）+ 轮询期进度推送 + 画幅与时长透传
- [x] `src/views/video-creation/QuickRenderPanel.test.js`（新增）：4 个 mode tab / 各模式素材区与提交禁用 / profile→画幅映射 / 素材上限预校验 / 取消文案
- [x] `src/views/CreateView.test.js`：改写既有「快速渲染 text 模式」断言（参数已扩展）；新增「快速渲染渲染子组件」断言

## 3. 实现

### 3.1 后端

- [x] `electron/services/adapters/agnes-video-models.js`（新增）：Agnes 视频模型能力描述单一真源（sizes / maxImages / maxAudios / maxVideos / supportsReferenceVideo / aspectRatios）+ `describeVideoModel` 保守回落
- [x] `electron/services/adapters/agnes-multimodal.js`：`generateVideo` 改读能力描述（size 档位、媒体上限、参考视频支持与否）；保留 2.5 Flash 预校验语义
- [x] `electron/services/scene-video-generator.js`（新增）：从 `story2video-stages.js` 抽出 `generateSceneVideo` / `pickFrameCountForSceneDuration` / `downloadVideoToFile` / `probeVideoFile` / `MAX_VIDEO_FILE_BYTES`；扩展入参与 `onProgress`
- [x] `electron/services/story2video-stages.js`：改为 require + re-export（净减约 150 行）
- [x] `electron/ipc-handlers/render.js`：`render:start-ai-video` 入参扩展 + fail-closed 校验 + 轮询期 `render:progress` 推送

### 3.2 前端

- [x] `src/views/video-creation/QuickRenderPanel.vue`（新增）：4 个 mode tab、提示词区、素材区（参考图 ≤5 / 参考音频 ≤3 / 首帧 / 尾帧）、参数区（时长 / 输出平台 / 种子 / 分辨率）、进度与结果
- [x] `src/views/CreateView.vue`：快速渲染视图替换为 `<QuickRenderPanel>`（净减约 100 行）
- [x] `src/locales/create/ui/zh.js` + `en.js`：成对文案

## 4. 回归与质量门禁

- [x] `node .github/scripts/check-max-lines.js`：`story2video-stages.js` 4081→3906、`CreateView.vue` 5528→5419、`model-provider-manager.js` 1284→1284（净零），四个新文件均 < 500 行
- [x] `node scripts/check-gate-record-debt.js`：通过
- [x] `node scripts/check-no-brand-residue.js`：通过
- [x] `pnpm --filter @multi-publish/desktop test`：目标文件全绿（新增/扩展 48 例 + 既有 CreateView 288 例）
- [x] 视觉回归：核实「快速渲染」**不在像素判定域**（`base-screenshots/` 无 create-quick 基线，`check-visual-coverage.js` 通过）⇒ 改 UI 不撞 Gate 7b 的 0px 判定；workflows 套件的截图步骤仍会在 CI 的 QG Visual job 实跑
- [x] `openspec/records/agnes-video-flash-quick-render.md`：执行记录（状态列写「由门禁推导」）

## 5. 交付

- [ ] 推送分支 `agnes-video-flash-quick-render` → 开 PR → CI 全绿 → squash 合并

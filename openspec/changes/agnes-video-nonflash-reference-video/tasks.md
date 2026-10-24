# Tasks — agnes-video-nonflash-reference-video

> 前置：依赖 `agnes-video-flash-quick-render`（能力描述 / 参数契约 / 快速渲染页骨架）。

## 1. 规格与文档

- [x] `openspec/changes/agnes-video-nonflash-reference-video/`：proposal / design / spec delta
- [ ] `01-docs/PRD-video-creation.md`：参考视频语义 + 计费可见性条款
- [ ] `CHANGELOG.md` 未发布段
- [ ] `openspec/records/agnes-video-nonflash-reference-video.md`：执行记录

## 2. TDD：先写失败测试

- [x] `electron/services/adapters/agnes-video-models.test.js`：成本估算（免费 / 按秒 / 参考视频秒数相加 / 更高档位更贵）
- [x] `src/views/video-creation/QuickRenderPanel.test.js`：能力不支持时不渲染参考视频位 / 支持时随载荷提交 / 成本提示（计费与免费两种）

## 3. 实现

- [x] `electron/services/adapters/agnes-video-models.js`：能力描述加计费口径（`listPrices` / `currentPrices`）+ `estimateVideoCost`
- [x] `electron/services/model-provider-video-capabilities.js`：能力响应带 `prices` / `listPrices`
- [x] `electron/services/model-provider-seeds.js` + `adapters/agnes-multimodal.js`：暴露 `agnes-video-2.5`
- [x] `src/views/video-creation/quick-render-constants.js`：参考视频体积上限 + 扩展名→mime
- [x] `src/views/video-creation/useQuickRenderMaterials.js`：`pushVideos`（Data URI + 体积/类型护栏）
- [x] `src/views/video-creation/QuickRenderMaterials.vue`：参考视频上传位（能力门控）
- [x] `src/views/video-creation/QuickRenderPanel.vue`：videos 状态 + 载荷 + 成本提示
- [x] `src/locales/create/ui/{zh,en}.js`：成对文案

## 4. 回归与质量门禁

- [x] `node .github/scripts/check-max-lines.js`：新文件 < 500 行；被点名的文件净零增长
- [x] `node .github/scripts/check-locale-sync.js --cjk` / `--keys`：通过
- [ ] `node scripts/check-gate-record-debt.js` / `check-no-brand-residue.js`：通过

## 5. 交付

- [ ] 推送分支 → 开 PR（注明依赖前两个 change）→ CI 全绿 → squash 合并

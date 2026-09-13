# 实施清单（进度唯一来源）

## 阶段 1：OpenSpec 提案
- [x] proposal / design / tasks / spec delta

## 阶段 2：adapters
- [x] generate-assets.js（createAssetPlan + createGenerateAssets + fail-closed 契约）
- [x] compose-ffmpeg.js（resolveTargetSize / buildAssScript / buildComposeCommand / createFfmpegCompose）
- [x] publish.js（createPublish 可选发布）
- [x] index.js（createSlice3Pipeline）

## 阶段 3：测试
- [x] generate-assets.test.js（7）
- [x] compose-command.test.js（5 纯函数）
- [x] compose-integration.test.js（1 真实 ffmpeg 合成 + ffprobe 校验）
- [x] publish.test.js（4）
- [x] slice3-integration.test.js（2 全链路）
- [x] `node --test` 86 用例全绿

## 阶段 4：文档
- [ ] PRD v1.3 §17 切片 3 详细规格
- [ ] CHANGELOG / .quality-gates.md / CCG task
- [ ] commit → push → PR → 合并（远程状态核实）

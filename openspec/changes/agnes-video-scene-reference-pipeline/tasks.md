# Tasks — agnes-video-scene-reference-pipeline

> 前置：依赖 `agnes-video-flash-quick-render`（`generateSceneVideo` 的参数契约打通）。
> 落点修正见 `design.md` §1：**不是**主流水线，而是视频任务编辑页的「生成 AI 视频」。

## 1. 规格与文档

- [x] `openspec/changes/agnes-video-scene-reference-pipeline/`：proposal / design / spec delta
- [ ] `01-docs/PRD-video-creation.md`：视频任务编辑页「生成 AI 视频」的参考图语义 + 主流水线**不做**的说明（资产策略重做属产品决策）
- [ ] `CHANGELOG.md` 未发布段
- [ ] `openspec/records/agnes-video-scene-reference-pipeline.md`：执行记录

## 2. TDD：先写失败测试

- [x] `electron/services/scene-video-reference.test.js`（新增）：能力分流（keyframe / reference / 都不支持）、未知模型保守回落、无图 / 越界 / 魔数不符 / 体积超限四类降级、魔数嗅探本身

## 3. 实现

- [x] `electron/services/scene-video-reference.js`（新增）：`buildSceneVideoReference`（能力分流 + 三道防线 + Data URI 构造）
- [x] `electron/services/story2video-project-service.js`：`generateSceneAiVideo` 把该场景已选定图片接成参考输入；降级时记 warning + reason
- [ ] 主流水线侧的参考输入（**待产品决策**：多生成图片 + 阶段内串行化）

## 4. 回归与质量门禁

- [x] `electron/services/story2video-project-service.test.js`：既有 130 项全绿（未回归）
- [x] `node .github/scripts/check-max-lines.js`：新增文件 < 500 行；被点名的两个文件净零/负增长
- [x] `node .github/scripts/check-locale-sync.js --cjk` / `--keys`：通过
- [ ] `node scripts/check-gate-record-debt.js`：通过
- [ ] `node scripts/check-no-brand-residue.js`：通过

## 5. 交付

- [ ] 推送分支 `agnes-video-scene-reference-pipeline` → 开 PR（注明依赖 #4342）→ CI 全绿 → squash 合并

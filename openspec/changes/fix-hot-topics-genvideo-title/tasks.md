# Tasks — fix-hot-topics-genvideo-title

## 1. 纯函数层（TDD：先 RED 后 GREEN）

- [ ] 1.1 新建 `apps/desktop/src/features/publish/gen-video-title.js`：`buildGenVideoTitlePrompt` / `normalizeGeneratedTitle` / `resolveGenVideoTitle`
- [ ] 1.2 新建 `apps/desktop/src/features/publish/gen-video-title.test.js`（22 例，见 PRD §10.1）
- [ ] 1.3 先跑测试确认 RED（模块缺失/导出缺失），再实现至 GREEN

## 2. 主进程 IPC（TDD）

- [ ] 2.1 新建 `apps/desktop/electron/ipc-handlers/gen-video-title.js`：`ai:generate-gen-video-title`
- [ ] 2.2 新建 `apps/desktop/electron/ipc-handlers/gen-video-title.test.js`（9 例，见 PRD §10.2）
- [ ] 2.3 注册接线进 handlers 入口（与 `ai.js` 同一处）
- [ ] 2.4 先 RED 后 GREEN

## 3. 渲染层 API 封装

- [ ] 3.1 `apps/desktop/src/api/publisher.js` 新增 `aiGenerateGenVideoTitle`
- [ ] 3.2 `apps/desktop/src/api/publisher.test.js` 补 1 例契约断言

## 4. composable 改造

- [ ] 4.1 `useHotTopicsGenVideo.publishGenVideoResult()` 改 async：查默认模型 → 生成标题 → 降级决策 → 拼 query
- [ ] 4.2 新增 `genVideoTitleSource` 状态与导出（测试锚点）
- [ ] 4.3 `genVideoBusy` 守卫保证重复点击幂等
- [ ] 4.4 run-only 分支同样带 `title` / `title_source` / `title_reason`

## 5. 视图层

- [ ] 5.1 `HotTopics.vue`：弹窗完成态新增静态说明行（`hotTopics.genVideoTitleHint`）
- [ ] 5.2 `Publish.vue`：视频模式标题输入框下方三态来源提示

## 6. i18n（成对）

- [ ] 6.1 `locales/hot-topics/{zh,en}.js`：`genVideoTitleHint`、`genVideoTitleGenerating`
- [ ] 6.2 `locales/publish-page/{zh,en}.js`：`videoTitleFromAi`、`videoTitleFromTopicNoModel`、`videoTitleFromTopicFailed`
- [ ] 6.3 `01-docs/i18n-glossary.md` 登记新文案

## 7. 测试补齐

- [ ] 7.1 `HotTopics.test.js` 新增 8 例（见 PRD §10.3）
- [ ] 7.2 `Publish.test.js` 新增 5 例（见 PRD §10.4）
- [ ] 7.3 全量：`pnpm -C apps/desktop test` 全绿

## 8. 门禁与质量节拍

- [ ] 8.1 locale-sync：`--pair-base origin/main` / `--cjk` / `--keys`
- [ ] 8.2 eslint 全 rc=0
- [ ] 8.3 QM-1 打包：`electron-builder --win --dir --publish never` + asar 清单 + require 链 + 启动三层判据
- [ ] 8.4 视觉回归：`test:visual:pixel`（发布页提示行条件渲染复核）
- [ ] 8.5 Code Review（QM-2 必检项 + 6 大专项）
- [ ] 8.6 Bug 反哺 5 步产出物写入 `01-docs/learnings.md`

## 9. 文档同步

- [ ] 9.1 `01-docs/PRD.md`：热门选题视频发布标题口径
- [ ] 9.2 `01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md`：§3.13 补标题生成小节
- [ ] 9.3 `01-docs/PRD-VIDEO-PIPELINE-PROGRESS-MODAL-2026-10-17.md`：§4.3 补降级链
- [ ] 9.4 `CHANGELOG.md` 追加
- [ ] 9.5 `01-docs/learnings.md` 根因与教训

## 10. 交付

- [ ] 10.1 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` OK
- [ ] 10.2 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → false（含代码）
- [ ] 10.3 commit + push + 开 PR
- [ ] 10.4 CI 全绿后按自动合并判据 squash 合并
- [ ] 10.5 回填远程同步 + 销账（同一次提交）
- [ ] 10.6 保存经验到内置记忆 / 外部记忆 / EverOS

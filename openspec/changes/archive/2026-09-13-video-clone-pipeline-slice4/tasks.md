# 实施清单（进度唯一来源）

## 阶段 1：OpenSpec 提案
- [x] proposal / design / tasks / spec delta

## 阶段 2：engine runner
- [x] pipeline.js：eventSink（stage 事件）+ abortSignal（协作中止）
- [x] runner.js：createVideoCloneRunner（注入事件/中止 + 生命周期事件）
- [x] runner.test.js（5 用例）
- [x] `node --test` 91 用例全绿

## 阶段 3：契约文档
- [x] PRD v1.4 §18（IPC 契约 / preload API / UI 交互 / 服务生命周期 / QM 门禁）
- [x] CHANGELOG / .quality-gates.md / CCG task
- [ ] commit → push → PR → 合并（4b 已实现：engine service + IPC/preload/Vue，QM-1 通过；PR 待推）

## 阶段 4：Electron 接线（4b，待 node_modules + QM-1 打包）
- [ ] video-clone-service.js（runner 会话表 + 清理）
- [ ] ipc-handlers/video-clone.js + preload videoClone API
- [ ] VideoCloneView.vue（输入/进度/报告编辑/结果）+ 提示文字落地
- [ ] QM-1 打包验证 + QM-2 preload/IPC 校验 + 可见窗口证据

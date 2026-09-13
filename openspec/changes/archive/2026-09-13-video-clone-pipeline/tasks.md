# 实施清单（进度唯一来源）

## 阶段 1：OpenSpec 提案（本切片）
- [x] proposal.md / design.md / tasks.md / specs/video-clone-pipeline/spec.md
- [x] worktree + 分支 codex/video-clone-pipeline（隔离并发会话）

## 阶段 2：engine 核心（契约 + 编排）
- [x] packages/video-clone-engine/package.json（零依赖，node:test）
- [x] src/constants.js（层级/类型/平台/阶段/错误码）
- [x] src/errors.js（VideoCloneError + 分类表）
- [x] src/clone-report.js（validate/normalize/edit/sanitizeForIpc）
- [x] src/similarity.js（F4 四项指标 + 综合报告）
- [x] src/stage-executor.js（checkpoint/有界重试/fail-closed）
- [x] src/pipeline.js（adapter 注入 + run）
- [x] src/index.js

## 阶段 3：测试（node --test，零依赖）
- [x] clone-report.test.js（合法/非法/边界/编辑往返/IPC 脱壳）
- [x] similarity.test.js（指标 + 阈值 + 层级判定）
- [x] stage-executor.test.js（顺序/重试/checkpoint/fail-closed）
- [x] pipeline.test.js（happy/错误/请求校验/adapter 未实现）
- [x] `node --test packages/video-clone-engine/test/` 全绿

## 阶段 4：文档
- [x] PRD 详细规格：数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字（zh/en）/ 错误码（PRD-VIDEO-CLONE-2026-08-12.md §11-§30，802 行）
- [x] CHANGELOG（多个 video-clone 条目：相似度真度量/复刻层级自动决定/移除层级下拉/默认链接等）
- [x] .quality-gates.md 执行记录（video-clone 执行记录）
- [ ] CCG task 归档 + 记忆更新

## 阶段 5：交付
- [ ] commit → push → PR → 合并（核实远程状态）
- [x] 后续切片（另行 change）：真实 ingest/analyze/plan/generate/compose/publish + UI 与桌面集成（slice2/3/4 代码已通过多个 PR 合并到 main：PR #1418/#1472/#1456/#626/#632/#624 等）

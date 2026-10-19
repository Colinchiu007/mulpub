# Tasks: forced-update-gate

## 1. 文档

- [ ] 1.1 `01-docs/PRD-FORCED-UPDATE-GATE-2026-10-19.md`（详细 PRD：数据校验/流程/交互/文案/已知限制）
- [ ] 1.2 CHANGELOG 条目 + PRD.md 主文档补章节引用

## 2. 服务端（ops-center/backend，TDD）

- [ ] 2.1 测试先行：`tests/test_version_gate.py`（upsert 校验 5 例 + 版本门 8 例 + router 注入断言）
- [ ] 2.2 `models.py` UpdatePolicy 双列 + `services/update_policy_migration.py` + main.py 接线
- [ ] 2.3 `runtime_service.py`：_update_policy_to_dict 扩展 + upsert 校验
- [ ] 2.4 `services/version_gate.py` enforce_version_gate + catalog/ack/degradation 三端点挂门（member 面经探查证伪，见 proposal Q2 事实修正）
- [ ] 2.5 pytest 全绿（cd ops-center/backend && pytest）

## 3. 服务端前端（ops-center/frontend）

- [ ] 3.1 `UpdatePolicy.vue` 强制阻断卡片（输入框/开关/说明/保存/错误透出）

## 4. 桌面端（apps/desktop，TDD）

- [ ] 4.1 测试先行：`electron/services/enforce-gate.test.js`（evaluate 10 例 + 窗口管理层 + 宽限边界）
- [ ] 4.2 `electron/services/enforce-gate.js` 状态机 + `enforce-gate-text.js` 字典 + gate.html
- [ ] 4.3 `ops-center-sync.js` setOnSyncOutcome 透传 + `auth-service.js` onAuthenticated 订阅器
- [ ] 4.4 `auto-updater.js` onProgress 订阅器 + `bootstrap/phase1-context.js` 四点接线
- [ ] 4.5 契约锁测试（phase1 接线锁 + 文案键集合锁）
- [ ] 4.6 apps/desktop 测试全绿

## 5. 质量门禁

- [ ] 5.1 QM-1：electron-builder --win --dir 打包 + 启动验证（三层判据）
- [ ] 5.2 verify-worktree-deps 通过
- [ ] 5.3 Code Review（QM-2 必检项逐条：异常处理/高频路径/require 路径/Electron 安全）

## 6. 交付

- [ ] 6.1 执行记录 `openspec/records/forced-update-gate.md`（QM-1 证据 + 测试清单）
- [ ] 6.2 push + gh pr create + CI 全绿 + squash 自动合并 + 合并后回读

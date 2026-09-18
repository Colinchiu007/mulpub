## 1. 引擎侧
- [ ] 1.1 RewriteEngine 新增 setHardConstraints + _getHardConstraintPrompt（最前置注入 + 冲突声明）
- [ ] 1.2 移除 _buildPrompt 硬编码纯文案约束（升级为种子数据）
- [ ] 1.3 引擎测试：注入/未注入/优先级声明

## 2. 桌面端
- [ ] 2.1 RewriteHardConstraintManager（JSON 持久化 + sanitize + applyRemote）
- [ ] 2.2 OpsCenterSync 消费 bootstrap.rewrite_hard_constraints
- [ ] 2.3 RewriteEngineService 注入引擎 + container/phase1 接线
- [ ] 2.4 桌面端测试

## 3. ops-center 后端
- [ ] 3.1 RewriteHardConstraint 模型 + 建表
- [ ] 3.2 rewrite_hard_constraint_service（CRUD + 唯一默认事务 + 种子数据）
- [ ] 3.3 routers/rewrite_hard_constraints（列表/创建/更新/删除/设默认/runtime）
- [ ] 3.4 runtime_service bootstrap 下发默认版本
- [ ] 3.5 main.py 注册 + pytest

## 4. ops-center 前端
- [ ] 4.1 api/rewriteHardConstraints.js
- [ ] 4.2 views/RewriteHardConstraints.vue（列表+编辑+删除+设默认）
- [ ] 4.3 router + menuItems
- [ ] 4.4 前端 build 验证

## 5. 文档与交付
- [ ] 5.1 PRD 章节
- [ ] 5.2 双模型审查
- [ ] 5.3 PR + CI

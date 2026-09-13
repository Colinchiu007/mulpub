# Tasks: unify-desktop-frontend

## 1. P0 规范先行（docs + CI 卡点，可先行合入）

- [x] 1.1 撰写《桌面端前端交互规范》docs/frontend-interaction-spec.md：确认框/Toast/Loading/空态/弹窗唯一实现清单 + 危险操作确认门禁条款 + token 引用规则
- [x] 1.2 新建 src/styles/tokens.css 设计定标表（含三套旧变量映射关系注释），本任务仅文档化映射，文件落地在 P2
- [x] 1.3 新建 .github/scripts/check-frontend-consistency.js：两个 grep 卡点——①渲染层直调 window.electronAPI（api/ 白名单，含 src 根入口文件）②window.confirm；第三项"硬编码中文基线不增长"委托既有 Gate 7 check-locale-sync.js --cjk（避免双基线冲突，已在 yml 接线）
- [x] 1.4 将卡点接入现有 quality-gate workflow；全仓检索契约测试确认无破坏（ci-hardening M3 前置）
- [x] 1.5 【子代理审查】P0 全部产物经审查代理核对后提交

## 2. P1 数据层与安全归一

- [x] 2.1 危险操作补二次确认：批量删除发布记录、删除项目、删除音色 → confirmDanger 封装 + 后果文案
- [x] 2.2 window.confirm 清零：SceneAssetSelection、PromptEvalView 等迁移到 ElMessageBox
- [x] 2.3 Dashboard 空 catch 补 ElMessage 反馈；PromptEvalView doDelete/pollRun 补 try/catch（错误文案走 formatUserError）
- [x] 2.4 formatTime 系列 17 处收敛到 utils 单一实现并保留行为测试
- [x] 2.5 IPC 单轨化第一批：14 个视图直调迁移至 electron-bridge 导出函数 + fallback 表；每个 channel 一条行为保持测试
- [ ] 2.6 验证：单元测试全绿 + QM-1 本地打包 + 启动 8 秒 stderr 无异常
- [ ] 2.7 【子代理审查】P1 diff 审查后提交

## 3. P2 设计系统落地

- [x] 3.1 tokens.css 落地：语义变量 + #5048e5 主色 + 字号/圆角阶梯；修复暗色 --primary 浅灰覆盖 bug
- [x] 3.2 三套旧 token 文件头部改别名引用；4 种主蓝字面量清零
- [x] 3.3 EmptyState/LoadingState 组件落地并收编 11 个视图自造样式
- [x] 3.4 死代码清理：Providers.vue+供养测试、UiCard/UiBadge、useKeyboard/CommandPalette 决策（删或接）、CreateHistory/CreateViewHistory 合并
- [x] 3.5 UiButton 补 loading/disabled/aria 态并对齐使用方
- [x] 3.6 门禁：test:visual:pixel 全量通过；diff 图人工审核后更新基线
- [x] 3.7 【子代理审查】P2 diff + 视觉回归报告审查后提交

## 4. P2.5 单壳导航统一

- [x] 4.1 AppNavbar/AppSidebar 壳退役：删除 isYixiaoerWorkspace 分支，4 条路由迁入主壳；FirstRun 保持全屏特性
- [x] 4.2 TabBar 路由注册与图标核对；侧边栏专属交互（升级Pro/服务状态自 AppNavbar 迁入 YixiaoerSidebar footer，设置入口已存于主壳）
- [x] 4.3 门禁：test:visual:pixel 全量通过（17/17，6 个受影响视图基线已更新并人工确认预期 diff）
- [x] 4.4 【子代理审查】壳迁移 diff 审查后提交（审查结论 CLEAN，无阻断项）

## 5. P3 i18n 补齐

- [ ] 5.1 19 个未接入视图按小→大批量迁移 $t()；zh/en 成对写入 locales
- [ ] 5.2 每个迁移视图跑 --single 视觉回归；Quill 工具栏英文混排核对
- [ ] 5.3 CreateView/ResultView 延后项登记入中文扫描基线说明；卡点断言存量不增长生效
- [ ] 5.4 【子代理审查】i18n diff + locale 成对校验后提交

## 6. 收尾交付

- [ ] 6.1 全量单测 + test:all:visual 发版级回归
- [ ] 6.2 CHANGELOG 追加；DESIGN.md 与实现一致性终审
- [ ] 6.3 PR 创建与描述（关联本 change）；CI watch 至绿

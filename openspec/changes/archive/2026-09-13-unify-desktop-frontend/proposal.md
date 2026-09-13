# Proposal: unify-desktop-frontend

## Why

桌面端前端（apps/desktop/src）存在系统性的混乱与不统一：三套零交集的设计 token、71 处跨文件重复类名、四种交互原语实现并存（确认框/Toast/Loading/空态各 2-4 种写法）、IPC 桥接层被 41 处裸调架空（错误兜底行为随调用方式漂移）、批量删除发布记录/删项目/删音色等危险操作无二次确认、暗色模式 `--primary` 被覆盖为浅灰、19/32 视图绕过 i18n 硬编码中文。这些问题叠加导致视觉不一致、交互不可预期、数据误操作风险与持续恶化的维护成本。

既有规范资产已存在但未落地：DESIGN.md 定义了完整设计 token，user-facing-messages spec 已定义 `formatUserError` 错误映射契约，i18n-content-sync spec 已约束 locale 成对修改。本 change 的定位是**让实现对齐既有规范并收敛分裂**，不是另起炉灶。

## What Changes

- **设计 token 单源化**：新建 `src/styles/tokens.css` 作为唯一变量源（主色定标紫色 `#5048e5`，经用户决策），apple-design-tokens/cohere/video-creation 三套旧体系映射为别名后逐文件迁移删除；修复暗色模式 `--primary` 覆盖 bug；统一 4 种并存的主蓝；字号/圆角建立有限阶梯
- **危险操作二次确认**：批量删除发布记录、删除项目、删除音色补 ElMessageBox.confirm（当前直接执行，数据丢失风险）
- **交互原语收敛**：window.confirm 清零改 ElMessageBox；空态统一 `<EmptyState>` 组件收编 11 个视图的自造样式；Loading 态统一封装
- **IPC 单轨化**：41 处裸调 `window.electronAPI` 收敛到 api/electron-bridge.js 唯一出口，fallback 策略声明式配置，CI 卡点禁止新增直调
- **错误处理修复**：Dashboard 空 catch 补用户可见反馈；裸奔 async 操作补 try/catch（遵循 user-facing-messages spec 的 formatUserError 映射）
- **工具去重**：formatTime 系列 17 份复制收敛到 utils 单一实现
- **死代码清理**：Providers.vue（路由不可达）、UiCard/UiBadge（零使用）、useKeyboard/CommandPalette（未挂载）处置；CreateHistory/CreateViewHistory 双文件合并
- **单壳导航统一**：AppNavbar/AppSidebar 壳退役，仅存的 4 条侧边栏壳路由迁入蚁小二主壳（经用户决策纳入）
- **i18n 补齐**：19 个未接入视图批量迁移 $t()（zh/en 成对）；CreateView/ResultView 词条迁移随未来巨石拆解批次执行

明确不在本范围：CreateView.vue(5,556行)/ResultView.vue(1,746行) 结构性拆解（独立立项评估）；ops-center/frontend 改造（第二阶段）。

## Capabilities

### New Capabilities

- `desktop-ui-consistency`: 桌面端 UI 一致性契约——设计 token 单一来源规则、危险操作确认门禁、交互原语唯一实现约定（确认框/Toast/Loading/空态）、IPC 渲染端访问单轨制、视图层 i18n 覆盖要求

### Modified Capabilities

<!-- 无需求级变更：user-facing-messages（错误映射契约不变，本 change 遵循它）、i18n-content-sync（成对规则不变，本 change 遵循它）。样式重构与组件收编属实现细节，不改变既有 capability 的可观测行为要求。 -->

## Impact

- **代码**：apps/desktop/src/{styles,views,components,api,utils} 约 40+ 文件；App.vue + layouts/（单壳迁移）；router/index.js（4 条路由壳归属）
- **新增组件**：EmptyState、LoadingState（或等价封装）；tokens.css
- **删除**：Providers.vue 及其供养测试、UiCard/UiBadge、旧 token 文件（迁移完成后）
- **CI**：新增 grep 型卡点脚本（.github/scripts/check-frontend-consistency.js），接入现有 quality-gate 工作流
- **风险面**：全局样式变更是视觉回归最高风险区——每批小步提交，P2/P2.5 批次必须通过 `test:visual:pixel` 全量门禁；IPC 迁移须逐一核对 invokeWithFallback 的静默降级语义不丢失
- **依赖**：零新增第三方依赖

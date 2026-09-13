# Design: unify-desktop-frontend

## Context

桌面端渲染层（Vue 3.5 + Element Plus 2.14 + Pinia + Vite，hash 路由）现状：三套零交集 token（apple-design-tokens.css 59 变量 / cohere-design-system.css 62 变量 / video-creation-tokens.css 100 变量）、71 处跨文件重复类名、确认框三种实现、Loading 四种实现、41 处裸调 window.electronAPI、暗色模式 --primary 被 App.vue 后加载样式覆盖为浅灰。既有资产：DESIGN.md（Cohere 规范）、user-facing-messages spec（formatUserError 契约）、i18n-content-sync CI Gate、视觉回归框架（94 用例，QM-4）。详见 proposal.md。

## Goals / Non-Goals

**Goals**
- 一致性可机械校验：CI grep 卡点让漂移自动失败
- 行为安全：危险操作有确认门禁，错误必有用户可见反馈
- 迁移零视觉回归：P2/P2.5 全量 test:visual:pixel 把关
- 每批独立可回滚

**Non-Goals**
- CreateView/ResultView 结构拆解（延后立项）
- ops-center/frontend 改造（第二阶段）
- 引入 CSS 框架（Tailwind 等）或更换组件库
- 双壳产品形态重新设计（只做壳归属统一，不改主壳交互）

## Decisions

### D1: token 策略——别名桥接渐进迁移，而非一次性替换
新建 `src/styles/tokens.css` 定义语义变量（--color-primary: #5048e5 等）；三个旧文件顶部改为引用 tokens 的别名定义（`--action-blue: var(--color-primary)`），视图逐文件切换后删除旧文件。
*理由*：一次性替换 200+ 变量的视觉回归排查成本远高于分批；别名层保证迁移期任何时刻全库可渲染。
*备选否决*：直接全局替换（回归面不可控）；保留三套永久并存（问题未解决）。

### D2: 主色定标 #5048e5 并修订 DESIGN.md
用户已决策统一到实际主导色紫色 #5048e5；DESIGN.md 的 Cohere 黑按钮描述同步修订（docs 可 main 提交，此处随分支走）。
*理由*：规范向现实收敛成本最低；#5048e5 已是多数页面的既成事实。

### D3: 危险操作确认——ElMessageBox.confirm 为唯一原语
项目已引入 Element Plus 且部分页面在用；window.confirm 无法定制文案/主题且阻塞 UI 线程观感差。封装 `confirmDanger(options)` 薄包装强制"后果说明"入参。
*备选否决*：自研 UiModal 确认（UiModal 已承担表单弹窗职责，混用会加深分裂）。

### D4: IPC 单轨——以 electron-bridge.js 扩展函数为准，不重写 api/publisher.js
现有两轨中 electron-bridge 是声明规范所在；把 14 个视图的直调迁为 bridge 导出函数 + 显式 fallback 表。CI 卡点扫描 src/{views,components,composables,stores,features} 下 `window.electronAPI` 字面量（api/ 目录白名单）。

### D5: 单壳迁移方向——4 条路由迁入蚁小二主壳
App.vue:123-124 现状仅 /first-run、/model-providers、/keywords、/viral-analysis 走侧边栏壳。迁移 = 删除 isYixiaoerWorkspace 分支判断，4 条路由挂到主壳 TabBar 体系。FirstRun 属首启流程需保留全屏无导航特性（验证其路由 meta 是否已处理，未处理则补 meta.fullscreen）。

### D6: i18n 迁移顺序——先小视图后基线收紧
19 个视图按"小→大"批量迁移并跑 --single 视觉回归；CreateView/ResultView 登记为延后项，中文扫描基线文件记录当前存量数，卡点断言"不增长"。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 全局样式改动引发跨页视觉回归 | P2 分主题域小步提交；每步 test:visual:pixel；diff 图人工审核后才更新基线 |
| IPC 迁移丢失静默降级语义 | fallback 表显式化；每个被迁移 channel 写一条行为保持测试 |
| 删除死代码误伤隐式依赖 | 删前全库检索引用（含测试与 story2video/ 子目录）；删除后全量单测 |
| 别名桥接期双源混淆 | 卡点脚本同时禁止旧文件新增行；迁移完成即删文件 |
| 本地 main 与 origin/main 发散 | 本任务只在 codex/frontend-unify 工作；合并前由维护者同步 main |

## Open Questions

<!-- 无。方向性决策（紫色定标、单壳纳入、i18n 策略、巨石延后）均已经用户拍板。 -->

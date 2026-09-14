# Design: 侧边栏底部用户菜单

## Context

应用壳的登录区与系统级入口（设置 / 升级 Pro / 服务状态）分布在侧边栏的三个不同区域，模块导航右上角另有 4 个占位入口。目标是把用户与系统级入口收敛为底部一个可展开 banner（对齐主流桌面客户端范式），同时清理零价值入口。

约束：

- 侧边栏宽度固定 200px（`--yixiaoer-sidebar-width`），不得引入可折叠侧边栏；
- `ProfileMenu` 已被复用为唯一用户菜单实现，禁止新增同类组件副本（见 `docs/frontend-interaction-spec.md` §2）；
- 设置弹窗（`SettingsDialog`）由 `App.vue` 承载、升级弹窗（`UpgradeModal`）由侧边栏承载 —— 入口迁移不得改变这两个宿主归属；
- 渲染层禁止直接调用 `window.electronAPI`；用户可见文案必须走 i18n；
- 新增硬编码中文会被 CI Gate 7 `--cjk` 拦截。

## Goals / Non-Goals

**Goals**

- 登录区唯一落点在侧边栏底部，收起态只显示一条 banner，点击向上展开菜单；
- 服务连接信息位于 banner 上方（顺序可被测试钉死）；
- 设置与升级 Pro 入口并入菜单，且与其它菜单项共用同一套版式；
- 模块导航不再渲染任何占位工具入口。

**Non-Goals**

- 不做侧边栏可折叠 / 可拖拽调宽；
- 不改动 `SettingsDialog` / `UpgradeModal` 内部结构；
- 不改动身份 / 许可 / 服务状态的 IPC 与存储契约；
- 不新增 i18n 词条（全部复用既有 key）。

## Decisions

### D1：扩展 `ProfileMenu` 而非新建「底部用户菜单」组件

- **选择**：把 `ProfileMenu.vue` 直接改造为底部形态（面板向上展开），并由其承载设置与升级菜单项，向外抛 `open-settings` / `upgrade` 事件。
- **理由**：`ProfileMenu` 已是唯一用户菜单实现（承载身份状态、登录/切换/退出、许可徽标）。新建组件会复制一整套身份逻辑（`hasSessionIdentity` / `statusLabel` / `statusNote` / `errorMessage` / `pendingAction`），并产生两套菜单样式 —— 直接违反「交互原语唯一实现」与「菜单项版式统一」两条要求。
- **替代方案**：
  - A. 新建 `SidebarUserMenu.vue`：违反 DRY，且身份错误映射逻辑双份维护，弃用。
  - B. 用 slot 从侧边栏注入设置/升级项：slot 内容编译在父作用域，无法自动继承子组件的 scoped 样式，需 `:slotted()` 特例，反而耦合更紧，弃用。
- **代价**：组件不再支持向下展开。原顶部栏用法随登录区迁移一并消失，因此**不保留** `placement` 之类的形态开关——零引用的可选分支属死代码，还会把文件推过 CI 债务基线（`filesOver500`）；同时删除原 header 分支样式，`ProfileMenu.vue` 由 534 行压回 500 行以内。若未来确有顶部栏复用需求，再按 YAGNI 扩展。

### D2：事件外抛、宿主承接（不在菜单组件内引入弹窗）

- **选择**：菜单项只抛事件；`open-settings` 由侧边栏透传 `App.vue`，`upgrade` 由侧边栏本地置 `showUpgradeModal`。
- **理由**：保持既有宿主归属（`SettingsDialog` 在 `App.vue`、`UpgradeModal` 在侧边栏），入口位置变化不影响弹窗装配点；避免在 `ProfileMenu` 内 `import UpgradeModal` 造成双实例。
- **替代方案**：组件内直接打开弹窗 —— 会导致 `UpgradeModal` 在侧边栏与 `ProfileMenu` 各挂一份，且 `ProfileMenu` 从"展示组件"变成"业务编排组件"，弃用。

### D3：底部 banner 向上展开且与 banner 等宽

- **选择**：面板 `bottom: calc(100% + 8px)`、`left/right: 0`（宽度随容器），`max-height: min(70vh, 420px)` + 内部滚动。
- **理由**：侧边栏仅 200px 宽，若沿用原有 `width: min(240px, 100vw - 24px)` 会向右溢出侧边栏并压住工作区内容；而侧边栏是 `overflow-y: auto` 容器，横向溢出还会引入横向滚动条。等宽既不溢出也符合"菜单从 banner 长出"的视觉预期（对齐参考客户端）。
- **替代方案**：把菜单挂到 `body`（Teleport）+ 定位计算 —— 需处理滚动/窗口 resize 重算，收益为零，弃用。

### D4：删除 footer「客户端状态」独立文字行，信息下沉进 banner

- **选择**：移除 `.yixiaoer-sidebar-status` 行，改为 banner 头像右下角状态点 + banner `title` + 菜单标题区状态文案。
- **理由**：该行与登录 banner 属同一语义域（在线/未登录/过期/异常），位置相邻时同时显示属重复信息；下沉后信息量不变（点色 + 悬停文案 + 面板内文案三处可见）。
- **代价**：原 `data-testid="yixiaoer-sidebar-status"` 消失，相关断言迁移到 `ProfileMenu` 的状态点（`data-testid="yixiaoer-profile-status"`）。

### D5：整块删除模块导航工具区（而非隐藏或置灰）

- **选择**：删除 `.yixiaoer-module-tools`、4 个按钮、工具面板、`activeTool` / `toolPanels` / `activeToolContent` / `toggleTool` 与全部相关样式，并把原测试改写为**零渲染回归断言**。
- **理由**：4 个入口的能力均为占位说明文案，不是"暂未展示"，而是"尚未实现"。置灰仍会占用视觉热区并暗示能力存在；删除是最诚实的表达。
- **替代方案**：保留但禁用 —— 会持续占据右上角视觉热区并引发"为什么不能点"的困惑，弃用。

### D6：header 改为品牌区

- **选择**：登录区移出后，header 渲染 `MP` 图形标识 + `Multi-Publish` 字样 + `+` 新建发布。
- **理由**：避免 header 只剩一个 24px 圆形按钮的空洞观感；品牌字样为 ASCII 字面量，不触达 i18n 门禁。
- **替代方案**：整行删除 header —— `+ 新建发布` 将失去位置，且品牌锚点消失，弃用。

## Risks / Trade-offs

| 风险 | 影响 | 缓解 |
|------|------|------|
| 像素视觉门禁越阈 | CI Gate 7 失败 | 变更区域集中（侧边栏 ≈200×250px + 模块导航右端 ≈130×70px），阈值 6% 具备容忍度；越阈时按 `test:visual:update-baseline` 重建基线 |
| 窄屏（≤900px）下入口可达性 | 68px 侧边栏可能看不到设置入口 | 窄屏保留 banner（仅头像），菜单仍可展开，入口不丢失；服务连接信息在窄屏隐藏（信息可在宽屏查看） |
| 移除 `data-testid="yixiaoer-sidebar-status"` 影响既有测试/E2E | 断言失败 | 同步更新 `YixiaoerSidebar.test.js`；状态语义迁移到 `ProfileMenu.test.js` 新增断言 |
| 组件不再支持向下展开 | 未来若需在页面内复用需改造 | 当前登录区唯一落点在底部 banner，无第二处用法；需要时按 YAGNI 扩展，避免预埋死代码 |
| 菜单项增加导致面板变高 | 小屏（<400px 高）滚动 | 面板 `max-height: min(70vh, 420px)` + `overflow-y: auto` |

## Migration Plan

1. 修改 `ProfileMenu.vue`（placement + 菜单项 + 事件 + banner 视觉）；
2. 修改 `YixiaoerSidebar.vue`（header 品牌区、主导航去设置、footer 重排、事件承接）；
3. 修改 `YixiaoerModuleNav.vue`（删除工具区/面板/状态/样式）；
4. 更新 3 个单测文件（含 4 条防回归硬契约）；
5. 同步文档（专项 PRD、主 PRD 章节、布局规格、交互规范、CHANGELOG）；
6. 推送 PR → CI（含像素门禁）→ 合并后 `openspec archive`。

**回滚**：单 PR 纯渲染层变更，`git revert` 即完全回滚；无数据迁移、无状态残留。

## Open Questions

- 无（用户 5 条诉求均已在 PRD 中逐条映射实现）。

# Design: ux-audit-hotkeys-settings

## Context

主进程 `electron/services/hotkeys.js` 的 `SHORTCUTS` 表有 **10 条** accelerator，
经 `ipc-handlers/misc.js:20` 的 `hotkeys:list` 与 preload `system.js:141` 的 `hotkeysList()`
暴露给渲染层；实测 `git grep hotkeysList origin/main` 只命中 preload 自身与其测试 ⇒ **零消费方**。
设置弹窗此前有 6 个 Tab，没有快捷键出口。

三个约束决定了显示面不能"把 IPC 原样贴出来"：

1. `SHORTCUTS` 的 `label` 是**中文常量**且被 `hotkeys.js:59` 的日志消费（`log.info('HotKeys', '${accelerator} → ${config.label}')`）；
2. `accelerator` 写成 `CmdOrCtrl+Alt+P`，不是给人读的形态；
3. **route 不是身份**：`/publish` 被 `Alt+P`（发布）与 `Alt+N`（新建发布）共用，
   `/accounts` 被 `Alt+A`（账号管理）与 `CmdOrCtrl+Comma`（设置）共用 ⇒ 以 route 作映射键会合并两条不同动作。

## Goals / Non-Goals

**Goals**
- 让已注册的快捷键在设置页里可见、可读、可本地化；
- 主进程表 ↔ 渲染层登记表 ↔ zh/en locales 三者的对齐由机械锁保证；
- 面板自身不新增可聚焦控件（不改变设置弹窗的键盘走位基线）。

**Non-Goals**
- 不做"用户自定义快捷键"（需要改主进程注册逻辑与持久化，属另一个单元）；
- 不改任何 accelerator 的绑定；
- 不删主进程 `label`（它仍在写日志，删了会让注册现场变哑）；
- 不声称暗色档已就绪（暗色入口是单元 1.1，尚未合并）。

## Decisions

### D1 映射键 = accelerator，不是 route

见 Context 第 3 条。**代价**：主进程若把某条快捷键换成别的组合，登记表与 locales 都要改键名；
这正是对齐锁要红的那一格——换绑必须是一次显式决定，而不是让显示面静默回显原始串。

### D2 未登记项回显「语言中立的原始标识」，不编名字

`hotkeyActionKey()` 返回 `{ key, rawLabel }`；未登记时 `key=null`、
`rawLabel = route || accelerator`。同 AGENTS.md 里「聚合外部搜索源…来源标签禁止兜底品牌名」的纪律：
**给用户一个像真名的假名字，比给他一个看得出来的原始串更伤**。同时该行标
`data-mapped="false"` 并 `console.warn` 点名该 accelerator，使"漏登记"在现场日志里可查。

哨兵值 `__quit__` 不会走到这条回显路径：它的 accelerator 已登记（D1 的键是 accelerator），
所以界面显示"退出应用"而不是 `__quit__`；该事实由 `退出类哨兵值不得被当成路由回显` 一条用例钉住。

### D3 五态而不是"空列表"

`loading / error / unavailable / empty / ready`。三个必须分开的现场：
- 宿主没有桥（浏览器里跑 dev server）⇒ `unavailable`；
- IPC 回来 `code!==0` 或 `data` 非数组 ⇒ `error`（保留重试入口）；
- 真的注册了 0 条 ⇒ `empty`。

把前两者渲染成空列表，等于让用户读成"这个应用没有快捷键"——那与本单元要修的缺陷同形。

### D4 跨包对齐锁读**主进程源码**，双向、带锚点存在断言与规模下界

vitest 在 node realm 跑，拿不到 Electron 主进程运行时，所以判据只能读源文件。
四条不可省的细节（都是本仓同类锁实测踩过的）：

- 起点 `indexOf('const SHORTCUTS')` 与终点 `indexOf('\n}', start)` **各自先断言 `>= 0`**。
  终点失配时 `slice(start, -1)` 把负数解释成"从末尾倒数"⇒ 区间静默放大到接近整份文件，
  锁继续绿但它不再测量它声称的那张表。
- 解析结果条数有下界（`>= 8`）并含一条成员断言（`CmdOrCtrl+Alt+P`），
  否则"解析退化成空集合"会让"零条缺失"读起来完全像通过。
- 方向是**双向**：`已注册 ⇒ 已登记`（漏登记）与 `已登记 ⇒ 已注册`（孤儿项）。
  孤儿项必须红，因为那会让"未命中"分支成为只有测试能走到、生产走不到的死代码。
- locales 成对检查按 `HOTKEY_ACTION_KEYS` 的值逐项在 `settings/zh.js` 与 `settings/en.js` 里查叶子键，
  且路径锚在 `import.meta.url`（`DESKTOP_ROOT`）而不是 `process.cwd()`。
  **动因**：CI Gate 7 的 locale 同步判据只读根级 `zh.js/en.js`，对本仓已拆分的 `settings/*.js`
  **结构性失明**（实测：删掉 en 键 Gate 7 仍打 PASS），所以这条成对判据必须自带。

### D5 Tab 位置与图标

插在「发布设置」之后、「账号设置（disabled）」之前，保持"可用项在前、禁用项在末"的既有排列。
图标用 `@element-plus/icons-vue` 的 `Key`。
**实测教训**：本图标库**没有** `Keyboard` 这个导出（293 个导出里查不到），
凭名字写会拿到 `undefined` 并在运行时静默渲染成空图标位；本批是先运行时枚举导出名才定下 `Key`。

### D6 `initialTab` 只在"打开沿"生效

这是 `SettingsDialog.vue` 既有契约（防止父级无关重渲染把用户拉回被请求的 Tab）。
新 Tab 沿用同一机制，因此测试夹具**必须**走 `visible:false → true` 的翻转；
挂载即 `visible:true` 没有打开沿，测的不是生产形态（生产里弹窗常驻，由 `showSettingsDialog` 翻转驱动）。

### D7 视觉判定域

设置弹窗在像素注册表内（`settings-general`，浅/暗两档）。新增左侧 Tab 会改变导航条像素，
因此**基线必须由同一次 CI 渲染刷新**（AGENTS.md QM-4 第 7 条），禁止本机截图或
`--update-baseline` 消化。本 PR 只提供新基线的**需求**，实际刷新走 CI artifact 回填，
在 CI 未给出同源基线之前不得声称"视觉无回归"。

## Risks / Trade-offs

- **风险 1**：新 Tab 使 `SettingsDialog.test.js` 里按索引的既有断言漂移。
  处置：改成按文案定位（`tabByLabel`），这是**更精确**而非更宽——按索引断言本来就把"顺序变了"
  这件事表达成"另一个 Tab 的名字不对"，掩盖真实原因。
- **风险 2**：暗色档未接（单元 1.1），本面板在暗色下只继承既有 token。
  处置：不为本面板写暗色专属样式，也不在文档里声称暗色已验证。
- **回滚**：面板与映射表是纯新增；`SettingsDialog.vue` 只多一个 Tab 项与一个 `v-else-if` 分支，
  回滚即回到 6 Tab，无数据迁移。

## Open Questions

- 是否需要把这张表做成"可按平台显示真实生效的键"（`CmdOrCtrl` 在 mac 上显示 `⌘`）？
  本批已按 `isMac` 归一，但**注册是否成功**（`globalShortcut.register` 失败只写 warn 日志）
  没有回传渲染层 ⇒ 界面显示的是"应该有的"快捷键，不是"当前真正生效的"。
  这一区分需要主进程把注册结果带进 `getShortcuts()`，属下一批，已登记为遗留。

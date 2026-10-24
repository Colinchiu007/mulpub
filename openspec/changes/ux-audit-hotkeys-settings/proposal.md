# Proposal: ux-audit-hotkeys-settings

## Why

UX 审计阶段 1 的 1.6「快捷键没有任何显示出口」。

主进程 `apps/desktop/electron/services/hotkeys.js` 注册了 10 组全局快捷键（`Ctrl+Alt+P` 一类），
并通过 `hotkeys:list` IPC（`ipc-handlers/misc.js:20`）+ preload `system.js:141 hotkeysList()`
把清单暴露给渲染层 —— 但**全仓零消费方**（实测 `git grep hotkeysList origin/main` 只命中 preload
自身与其测试）。设置弹窗的七个 Tab 里也没有"快捷键"这一项。

后果是这类功能只能靠"口口相传"：用户不知道存在 `Ctrl+Alt+K`，也就永远不会用；
而审计阶段 1.5 刚把键盘入口与鼠标入口收敛成同一段可见导航 —— 键盘通道已经修通，
却仍然没有任何地方告诉用户键盘通道存在。**这是「装饰性链路」在 UI 层的又一次复发**：
链路两端（主进程注册 + IPC 通道）都在，缺的是最后那个把数据端给用户看的显示面。

同时，主进程那份 `config.label` 是**中文硬编码**（`hotkeys.js` 的 `SHORTCUTS` 表），
直接渲染会违反本仓 i18n 合同（渲染端非 locales 文件不得新增中文字面量，且英文用户会看到中文）。
所以显示面不能是"把 IPC 返回值原样贴出来"，必须按**快捷键本身**做本地化映射。

## What Changes

- 新增 `apps/desktop/src/utils/hotkey-labels.js`：快捷键显示面的**单一实现**——
  `HOTKEY_ACTION_KEYS`（accelerator → locale key 登记表）、`hotkeyActionKey()`（取 key 与原始
  accelerator 兜底）、`formatAccelerator()`（按平台把 `Ctrl+Alt+P` 渲染成 `⌃⌥P` / `Ctrl + Alt + P`）、
  `normalizeHotkeyList()`（剔除非法条目并按 accelerator 去重）。
- 新增 `apps/desktop/src/components/HotkeysSettings.vue`：设置弹窗「快捷键」面板，
  五态（loading / error / unavailable / empty / ready），就绪态以 `<table>` 呈现"组合键 + 动作"。
- `SettingsDialog.vue` 新增 `hotkeys` Tab（排在「发布设置」之后、「账号设置（禁用）」之前），
  支持 `initialTab="hotkeys"` 在打开那一刻直接定位。
- locales `settings/zh.js` 与 `settings/en.js` 成对新增 `tabHotkeys` 与整个 `hotkeys` 文案块。
- 新增契约锁：`hotkey-labels.test.js`（映射与格式化 + **跨包对齐锁**：直接解析
  `electron/services/hotkeys.js` 的真实注册表，逐条要求"已注册 ⇒ 已登记"）、
  `HotkeysSettings.test.js`（五态与可访问性）、`SettingsDialog.hotkeys-tab.test.js`（入口接线 + 打开沿定位）。

不改动主进程注册逻辑（`hotkeys.js` 一字不动，含其 `label` 字段——它继续作为**日志**用途）。

## Impact

- Affected specs: `desktop-ui-consistency`（ADDED：快捷键显示面与跨包登记表对齐）
- Affected code: `apps/desktop/src/utils/hotkey-labels.js`、`apps/desktop/src/components/HotkeysSettings.vue`、
  `apps/desktop/src/components/SettingsDialog.vue`、`apps/desktop/src/locales/settings/{zh,en}.js`
- Affected tests: 3 个新测试文件 + `SettingsDialog.test.js`（第七个 Tab 使按索引的既有断言漂移，
  改为按文案定位 —— 更精确而非更宽）
- 视觉判定域：**受影响**。设置弹窗在像素注册表内（`settings-general` 浅/暗两档），
  新增 Tab 会改变左侧导航条；基线须按「只能取自同一次 CI 渲染」的口径刷新，禁止本机截图。
- 风险：低。只读显示面，无写入、无新 IPC、不改主进程。

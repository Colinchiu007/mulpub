# PRD：设置页「快捷键」面板（UX 审计 1.6，ux-audit-hotkeys-settings）

日期：2026-10-21 ｜ 分支：`ux-audit-hotkeys-settings` ｜ 变更类型：新增功能（中等，M）

## 1. 问题与现场取证

### 1.1 现象

应用有 10 组全局快捷键，但**没有任何地方能让用户看到它们**。

### 1.2 链路取证（逐跳，可重跑）

| 跳 | 位置 | 事实 | 取证命令 |
|---|---|---|---|
| ① 注册 | `apps/desktop/electron/services/hotkeys.js:21-32` | `SHORTCUTS` 表 10 条 accelerator，每条 `{route, label}`；`label` 是中文常量 | 直接读文件 |
| ② 生效 | 同文件 `:41-62` | `globalShortcut.register(accelerator, …)`，失败只 `log.warn`，**不回传注册结果** | 直接读文件 |
| ③ 出口 | `electron/ipc-handlers/misc.js:20-24` | `ipcMain.handle('hotkeys:list')` → `{code:0, data: hotkeys.getShortcuts()}`；异常 → `{code:REQUEST_ERROR, message, data:[]}` | 直接读文件 |
| ④ 桥 | `electron/preload/system.js:141` | `hotkeysList: () => ipcRenderer.invoke('hotkeys:list')` | 直接读文件 |
| ⑤ 消费方 | — | **0 个**。`git grep -na hotkeysList origin/main` 只命中 preload 自身与其测试 | `git grep -na "hotkeysList" origin/main` |
| ⑥ 授权 | `ipc-handlers/license-access-control.js:22` | `hotkeys:list` 在 public 清单里（未登录也可读） | 直接读文件 |
| ⑦ 文件头注释 | `hotkeys.js:8-19` | 注释只列了 **6 条**且含一条已不存在的 `Ctrl+Alt+M 分屏监控` ⇒ 表与注释长期漂移 | 对比 ① 与 ⑦ |

**结论**：这是一条「装饰性链路」在 UI 层的复发——四端（注册 / IPC / preload / 授权）全部就绪，
缺的只是最后那个把数据端给用户的显示面。第 ⑦ 跳是同一问题的文档侧证据：
**连这个功能自己的说明书都落后于实现**，用户侧更是零可达。

### 1.3 与阶段 1.5 的关系

1.5（可见导航）把"键盘入口与鼠标入口落到同一处"修通了；本批给键盘入口补**可发现性**。
两批共用 `hotkeys.js`，但 1.5 只读它的发送方语义，本批只读它的注册表，**不互相覆盖**。

## 2. 方案

新增三件：映射层（纯函数）+ 面板（显示组件）+ 接线（设置弹窗第七个 Tab）。
主进程**一字不动功能语义**（只更正 ⑦ 的注释）。

```
hotkeys:list (IPC)
   └─ normalizeHotkeyList(raw)                    ← 数据校验唯一实现
        ├─ formatAccelerator(accel, {isMac})      ← 组合键的可读形态
        └─ hotkeyActionKey({accelerator, route})  ← locales key ｜ 原始标识回显
             └─ HotkeysSettings.vue               ← 五态 + <table>
                  └─ SettingsDialog.vue (tab: hotkeys)
```

## 3. 交互逻辑

### 3.1 主流程

1. 用户打开设置弹窗（`Ctrl+Alt+Comma` 之外的鼠标路径，或侧边栏齿轮）。
2. 左侧导航点击「快捷键」（图标 `Key`，位置：发布设置之后、账号设置之前）。
3. 面板 `onMounted` 立即调 `hotkeysList()`；**期间显示 loading 态**（不显示空白表）。
4. 成功 ⇒ 表格按主进程返回顺序渲染每行：左列组合键（平台化文本），右列动作名（locales）。
5. 失败 / 无桥 / 空表 ⇒ 进入对应状态（见 §3.4），**不得退化成空表**。

### 3.2 数据校验契约（`normalizeHotkeyList`，唯一实现）

| 输入形态 | 处置 | 理由 |
|---|---|---|
| `raw` 不是数组 | 返回 `[]`（不抛错），由调用方按 `code`/宿主能力判态 | 报文破坏不是"列表为空"，态由上层判 |
| 条目不是对象（`null`/数字/字符串） | **丢弃该条** | 渲染成空行会让表格出现无主单元格 |
| `accelerator` 缺失或非非空字符串 | **丢弃该条** | accelerator 是该行的身份（DOM key + 映射键 + 兜底文本） |
| `accelerator` 重复 | **只保留第一条** | DOM `:key` 撞车 ⇒ Vue 复用错行，第二行永远显示第一行数据 |
| `route` 缺失 | 不影响该行存在（只在未登记时影响回显文本） | route 不是显示身份 |
| 未登记的 accelerator | **保留该行**，`actionKey=null`，`rawLabel = route \|\| accelerator` | 丢弃等于"这个键存在但界面上没有"，比裸串更伤 |

`hotkeyActionKey` 的返回是**互斥二值**：命中 ⇒ `{key: 'settings.hotkeys.action.<name>', rawLabel: null}`；
未命中 ⇒ `{key: null, rawLabel: <原始标识>}`。组件按 `key ? t(key) : rawLabel` 渲染，
并把 `data-mapped` 写成 `true/false` —— 这是"忘了补文案"在 DOM 上唯一可检的痕迹。

### 3.3 显示项

| 显示项 | 来源 | 语言 | 备注 |
|---|---|---|---|
| Tab 名「快捷键」 | `settings.tabHotkeys`（zh/en 成对） | 本地化 | 图标 `Key`（**不是** `Keyboard`，该导出在本仓 element-plus 图标库里不存在） |
| 列头「组合键 / 动作」 | `settings.hotkeys.colKeys` / `colAction` | 本地化 | `<th scope="col">`，读屏能报列名 |
| 组合键文本 | `formatAccelerator` | 语言中立符号/名称 | 非 mac：`Ctrl + Alt + P`；mac：`⌘ ⌥ P` |
| 动作名 | `settings.hotkeys.action.*` | 本地化 | **绝不使用主进程 `label`** |
| 未登记行的动作名 | 原始 `route`（缺则 `accelerator`） | 语言中立 | 附 `data-mapped="false"` + 一条 `console.warn` |
| 底部说明 | `settings.hotkeys.hint` | 本地化 | 写明"快捷键由应用统一提供，暂不支持自定义" |

**为什么不显示主进程的 `label`**：它是中文常量且被 `hotkeys.js:59` 的注册日志消费。
把它搬到界面上，en 语言用户会看到未翻译文本，同时违反本仓「渲染端非 locales 文件不得新增中文
字面量」的 i18n 内容同步口径。组件侧另有一条**结构锁**：源码里出现 `.label` 消费即红。

### 3.4 状态与提示文字（五态必须互不相同）

| 态 | 触发 | 文案键 | 用户能做什么 |
|---|---|---|---|
| `loading` | 请求在途 | `settings.hotkeys.loading` | 等 |
| `ready` | `code=0` 且有合法条目 | — | 读表 |
| `empty` | `code=0` 且归一后 0 条 | `settings.hotkeys.empty` | 知道"这个应用确实没配快捷键" |
| `error` | `code≠0` / IPC 抛错 / `data` 非数组 | `settings.hotkeys.loadFailed`（"读不到快捷键列表（主进程未响应），请稍后重开设置。"） | 重开设置面板即会重新拉取（面板没有独立重试按钮 —— 它是**只读面板**，加按钮等于给一个不存在的写操作开门） |
| `unavailable` | 宿主没有 `hotkeysList`（无桥环境） | `settings.hotkeys.unavailable`（"需在桌面应用内查看快捷键。"） | 知道是环境限制而不是应用坏了 |

把 `error` / `unavailable` 渲染成 `empty`，等于告诉用户"这个应用没有快捷键"——
那正是本单元要消灭的"功能存在但不可达"的另一种形态。

## 4. 组合键呈现规则（`formatAccelerator`）

- 分隔符 `+`，逐 token `trim` 后映射；token 大小写不敏感（`CmdOrCtrl` / `Command` / `Control` 都认）。
- mac：`⌘ ⌃ ⌥ ⇧`，并按苹果惯例**重排**（⌘ 最左，其后 ⌃ ⌥ ⇧，非修饰键保持相对顺序）；
  以空格相连（`⌘ ⌥ P`）。
- 非 mac：`Ctrl / Win / Super / Alt / Shift`，以 ` + ` 相连（`Ctrl + Alt + P`）。
- 具名键：`Comma→,`、`Plus→+`、`Space→Space`、`Enter→Enter`、`Esc→Esc`、`Tab→Tab`。
- **未知 token 原样大写保留**（`P→P`），不得丢弃 ⇒ 丢一个 token 就是给用户一个不能按的组合。
- 非字符串 / 空串 ⇒ 返回空串，不抛错。

## 5. 验收标准

| # | 判据 | 实测方式 |
|---|---|---|
| V1 | 打开设置能看到「快捷键」Tab，点它出表 | `SettingsDialog.hotkeys-tab.test.js`（3 条） |
| V2 | 表内容来自宿主，条数与顺序由宿主决定 | `HotkeysSettings.test.js`「按主进程顺序渲染每一行」 |
| V3 | en 语言下面板**不含任何中文字符** | 同文件「主进程的中文 label 绝不进展示面」 |
| V4 | 未登记的快捷键仍成行，动列显原始标识，`data-mapped="false"` | 同文件 + `hotkey-labels.test.js` |
| V5 | 五态互不相同且各自可达 | 同文件「三种『看不到列表』的原因必须可区分」（5 条） |
| V6 | 面板不新增可聚焦元素 | 同文件「面板不新增可聚焦元素（设置弹窗的 Tab 走位基线）」 |
| V7 | 列头有 `scope="col"` | 同文件「表格有列头且 scope=col」 |
| V8 | 主进程表 ↔ 映射 ↔ zh/en locales **三方逐项对齐**，且解析锚点失效会点名 | `hotkey-labels.test.js` 跨包对齐锁（4 条，含规模下界与自证） |
| V9 | 全量渲染层无回归 | `vitest run src`（读数见执行记录门禁表） |
| V10 | 反证：被禁形态必须变红 | `node scripts/hotkey-labels-contract-mutate.js`（读数见执行记录） |

## 6. 反证（变异）

驱动：`scripts/hotkey-labels-contract-mutate.js`（判据与 1.5 的驱动同源：严格命中 +
死探针预筛 + `[PROBE-MAP]` 逐条打印 needle→完整标题 + `finally` 还原 + 独立 md5 回读）。

| # | 注入的被禁形态 | 落点 | 声明的锁（必须全红） |
|---|---|---|---|
| N1 | 登记表漏一条（主进程注册了但没文案） | `hotkey-labels.js` | 跨包对齐锁（missing 半区） |
| N2 | 登记表留一条孤儿（主进程已不注册） | `hotkey-labels.js` | 跨包对齐锁（extra 半区） |
| N3 | 终点锚失配（负数终点让 `slice` 静默放大区间） | `hotkey-labels.test.js` | 判据通路自证 |
| N4 | 未登记条目被整条丢弃 | `hotkey-labels.js` | 逻辑面 + 组件面两条回显锁 |
| N5 | `formatAccelerator` 丢掉未知 token | `hotkey-labels.js` | 保持字母大写 |
| N6 | mac 修饰键不再按惯例排序 | `hotkey-labels.js` | 修饰键顺序 |
| N7 | `data-mapped` 恒写 true | `HotkeysSettings.vue` | 未登记回显那条 |
| N8 | 读取失败被吞成空列表 | `HotkeysSettings.vue` | `code≠0` + 抛错两条报错态 |
| N9 | 无桥环境不再单独成态 | `HotkeysSettings.vue` | 宿主没这个能力 |
| N10 | 列头丢 `scope` | `HotkeysSettings.vue` | scope=col 那条 |
| N11 | 把主进程中文 `label` 当展示文案 | `hotkey-labels.js` | 逻辑面 + 组件面两条 label 锁 |
| N12 | 设置页不再有「快捷键」入口 | `SettingsDialog.vue` | 入口存在 + 七个 Tab 计数 |

**两条 MISSED 的现场记录（必须留下，否则下一个会话会重抄）**：

1. **N3 第一版零条红**。变异打在 `slice(start, X)` 表达式上，而**有牙的是它前面那句
   `expect(end >= 0)`**；且 block 变大后解析结果恰好没变（注释里的 accelerator 不带
   引号+冒号，不匹配解析正则）。改为把变异打在锚点赋值本身（`const end = -1`）后 CAUGHT。
2. **N6 第一版零条红 = 锁的保护面比说明窄**。三条 mac 用例的输入本来就等于苹果惯例顺序，
   把 `.sort()` 整行摘掉照样绿。补 `Alt+Shift+CmdOrCtrl+P ⇒ ⌘ ⌥ ⇧ P` 与
   `Shift+Command+I ⇒ ⌘ ⇧ I` 两条**乱序输入**后 CAUGHT。
   这条与「顺序类断言要喂非规范序输入」同族：**输入本来就等于期望输出时，断言测的不是那个操作**。

## 7. 遗留（不假装已闭合）

1. **界面显示的是"应该有的"快捷键，不是"当前真正注册成功的"**。
   `globalShortcut.register` 失败只在主进程写 `log.warn`（`hotkeys.js:62`），
   `getShortcuts()` 不回传注册结果。要区分需要主进程侧改动，属下一批。
2. **视觉基线未刷新**。设置弹窗在像素判定域内（`settings-general` 浅/暗两档），新增 Tab 必然
   改变左侧导航条像素。按 QM-4 第 7 条，基线只能取自**同一次 CI 渲染**，本机截图与
   `--update-baseline` 都不是合法来源 ⇒ 本 PR 不自称"视觉无回归"，基线刷新另片走 CI artifact。
3. 暗色档入口（单元 1.1）尚未合并，本面板不写暗色专属样式，也不声称暗色已验证。
4. 反证驱动尚未接进 CI（与任务 #23 同批欠账）。

## 8. 质量节拍对照

- QM-1：本批改了 `electron/services/hotkeys.js`（仅注释），故跑打包验证 ——
  `pnpm run build:dir` 成功，`win-unpacked/Multi-Publish.exe` 以隔离 `--user-data-dir`
  启动，8 秒窗口内**存活**且 **stderr 为空**（三层判据的第 ③ 层）。
- QM-2：新增代码无同步 CPU 密集原语；显示面只读一条 IPC。
- QM-3：36+ 条新用例；跨包对齐锁读对方源码而非复制常量。
- QM-4：见 §7 第 2 条，如实登记为未闭合。
- QM-5：本批是"功能存在但不可达"缺陷的修复，逃逸链与系统性漏洞见 §1.2 与执行记录。
- QM-6：M 级新功能，PR 提交前跑双模型评审并逐条处置。

# desktop-ui-consistency — 快捷键显示面（UX 审计 1.6）

## ADDED Requirements

### Requirement: 已注册的全局快捷键必须有一个用户可达的显示出口

主进程注册了全局快捷键并通过 `hotkeys:list` 暴露清单，这不构成"用户知道它们存在"。
系统 MUST 在设置弹窗内提供一个「快捷键」面板，其内容**唯一来源**是主进程注册表
（经 `hotkeysList()` 读取），MUST NOT 在渲染层维护第二份"有哪些快捷键"的清单。

#### Scenario: 打开设置并切到快捷键 Tab

- **WHEN** 用户打开设置弹窗并点击「快捷键」Tab
- **THEN** 面板列出主进程当前注册的全部快捷键，每条含"组合键"与"动作"两列
- **AND** 列表条数由宿主返回值决定，渲染层不得按自己的登记表过滤掉未识别的项

#### Scenario: 直接定位到快捷键 Tab

- **WHEN** 调用方把弹窗的 `initialTab` 设为 `hotkeys`，并且弹窗经历"关→开"这一次翻转
- **THEN** 打开那一刻落在「快捷键」Tab 并渲染面板
- **AND** 打开后用户再点击其他 Tab 时，MUST NOT 被拉回 `initialTab`（只在打开沿生效一次）

#### Scenario: 读取失败不得伪装成"没有快捷键"

- **WHEN** `hotkeysList()` 拒绝、返回 `code !== 0`，或返回的 `data` 不是数组
- **THEN** 面板显示**报错态**文案，MUST NOT 渲染成空列表
- **AND** 三者（加载中 / 出错 / 空）与无桥态在视觉与可访问名上互不相同
- **AND** 报错态不承诺"重试按钮"：本面板是只读展示面，重新拉取由"再次打开面板"承担
  （给一个不存在的写操作加按钮，等于把显示面变成假的可配置面）

#### Scenario: 没有宿主桥的环境

- **WHEN** 渲染端运行在没有 `window.electronAPI` 的环境（如无桥的 dev server）
- **THEN** 面板显示"当前环境不可用"态，MUST NOT 抛未处理拒绝、MUST NOT 显示空列表

### Requirement: 动作名必须本地化，未登记项必须如实兜底并出声

面板显示给用户的所有文案 MUST 来自 locales（zh/en 成对）。主进程注册表里的 `label` 字段是
**中文硬编码且只服务于主进程日志**，渲染端 MUST NOT 把它当作显示文案。

#### Scenario: 英文界面

- **WHEN** 界面语言为英文
- **THEN** 动作列显示英文动作名，且不出现任何主进程下发的中文字面量

#### Scenario: 新增快捷键但显示面尚未登记

- **WHEN** 宿主返回的某条 `accelerator` 在渲染层登记表里不存在
- **THEN** 该条 MUST 仍然显示（不得消失），动作列回落为该条的**语言中立原始标识**
  （`route` 优先，`route` 缺席时取 `accelerator`），MUST NOT 编造一个看起来像真名的词
- **AND** 该行带 `data-mapped="false"` 标记，并输出一条含该 accelerator 的 `console.warn`
- **AND** 已登记项带 `data-mapped="true"`，两者不得同值

#### Scenario: 哨兵值不得被当成路由回显

- **WHEN** 某条快捷键的 `route` 是主进程内部哨兵（如退出用的 `__quit__`）
- **THEN** 该 accelerator 必须**已有**展示键，界面上显示动作名而不是 `__quit__`
  （锁直接断言该条返回键而非原始串；一旦有人把它改成未登记形态即红）

### Requirement: 主进程注册表与渲染层登记表必须有机械对齐锁

"注册了但没登记"会退化成上一条的兜底态（用户看到裸 `Ctrl+Alt+K`），而这类漂移在运行时**没有任何
异常信号**。系统 MUST 有一条锁，从主进程源码解析出真实注册的 accelerator 集合，逐条要求在
`HOTKEY_ACTION_KEYS` 中存在对应 locale key，且该 key 在 zh 与 en 两份 locales 中都已定义。

#### Scenario: 主进程新增快捷键而显示面未跟上

- **WHEN** `electron/services/hotkeys.js` 的注册表新增一个 accelerator，而登记表或 locale 没跟上
- **THEN** 对齐锁 MUST 变红并点名缺失的那一个 accelerator

#### Scenario: 登记表里有而主进程没注册

- **WHEN** 登记表包含一个主进程未注册的 accelerator
- **THEN** 对齐锁 MUST 变红并点名该孤儿项：它让「未命中」分支永远不被真实数据触发，
  于是那条兜底逻辑成为只有测试能走到、生产走不到的死代码
- **AND** 面板为宿主实际返回的条目渲染，MUST NOT 因登记表多一项而凭空多出一行

#### Scenario: 解析锚点自身失效

- **WHEN** 主进程注册表写法改动导致解析取到空集合
- **THEN** 对齐锁 MUST 变红并声明"解析失败"，MUST NOT 把空集合读成"零条缺失"

### Requirement: 组合键呈现必须按平台归一

`formatAccelerator()` MUST 把宿主下发的 `+` 分隔 accelerator 渲染为当前平台的可读形态，
且 MUST NOT 丢弃它不认识的 token。

#### Scenario: Windows / Linux

- **WHEN** 平台非 macOS 且 accelerator 为 `Control+Alt+P`
- **THEN** 显示 `Ctrl + Alt + P`（修饰键有可读名、以 ` + ` 分隔）

#### Scenario: macOS

- **WHEN** 平台为 macOS
- **THEN** 修饰键显示为符号（`⌃` / `⌥` / `⇧` / `⌘`）且 `⌘` 位于最前，分隔符不产生多余空格

#### Scenario: 未知 token 与单键

- **WHEN** accelerator 含未登记修饰键或本身就是单键（如 `F12`）
- **THEN** 该 token 原样保留并可读，MUST NOT 被替换成空白或 `undefined`

### Requirement: 上行的列表数据必须先归一再渲染

面板 MUST 通过单一实现 `normalizeHotkeyList()` 消费宿主返回值，规则闭合为三条：
非对象条目剔除；缺 `accelerator` 或 accelerator 非非空字符串的剔除；按 `accelerator` 去重（保留首条）。

#### Scenario: 脏数据形态

- **WHEN** 返回值含 `null`、数字、`{}`、`{ accelerator: '' }` 或重复 accelerator
- **THEN** 剔除后渲染合法条目，MUST NOT 抛错、MUST NOT 渲染出空行或 `undefined`

### Requirement: 显示面不得改变设置弹窗的键盘走位基线，且表格必须可被辅助技术正确朗读

新增 Tab 与其面板 MUST NOT 引入新的可聚焦控件（面板只做展示，操作仍由既有 Tab 按钮承担）；
列表 MUST 以带列头的 `<table>` 呈现，列头 MUST 声明 `scope="col"`。

#### Scenario: 键盘走位

- **WHEN** 面板渲染完成
- **THEN** 面板内可聚焦元素数量为零，Tab 键序列与整改前一致

#### Scenario: 辅助技术读取

- **WHEN** 辅助技术朗读该面板
- **THEN** 每行的两个单元格分别对应"组合键"与"动作"两个列头，不出现无列头的数据行

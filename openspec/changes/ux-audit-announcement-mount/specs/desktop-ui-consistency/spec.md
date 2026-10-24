# desktop-ui-consistency — 下发型 UI 必须有生产渲染方（UX 审计 1.2）

## ADDED Requirements

### Requirement: 运营下发型 UI 必须接到用户可达的位置，且渲染方缺失必须被机械发现

「后台发了、接口返回了、界面看不见」是本阶段反复出现的同一形状（1.1 的 `useTheme`、1.3 的死组件、本条的公告横幅）。
凡消费**运营中心下发数据**的 UI 组件，MUST 有至少一个生产渲染方；
且 MUST 有一条**接线锁**断言该渲染方存在——只写组件不接线时，判据 MUST 变红，
MUST NOT 依赖"下一个审计的人会发现"。

#### Scenario: 组件存在但无人渲染

- **WHEN** `AnnouncementBanner.vue` 存在且其数据源能返回非空公告列表，而 `App.vue` 不渲染它
- **THEN** 接线锁 MUST 变红并点名缺失的挂载点

#### Scenario: 挂载被后续改动摘掉

- **WHEN** 有人从外壳模板里删掉该组件（其余代码不动、组件文件仍在）
- **THEN** 同一条锁 MUST 变红（MUST NOT 因为"组件文件还在、测试还在"而判通过）

### Requirement: 公告的显示项与交互必须按 severity 分档，且不得静默丢失

系统 MUST 按 `severity` 决定**可见样式、标签文案与可关闭性**，取值闭集为 `info | warning | maintenance`；
未知或缺失取值 MUST 落到 `info` 档而不是丢整条公告（MUST NOT 因分档失败而不渲染用户应看到的通知）。
每条公告 MUST 渲染标题；`content` 缺席时 MUST NOT 渲染空容器。

#### Scenario: 维护公告不可关闭

- **WHEN** 一条公告的 `severity` 为 `maintenance`
- **THEN** MUST NOT 出现关闭按钮（用户不能把"系统维护"通知消音）

#### Scenario: 未知 severity 不得吞掉公告

- **WHEN** 下发的 `severity` 为未登记值（例如 `critical`）或缺失
- **THEN** 该条 MUST 仍被渲染并按 `info` 档展示，MUST NOT 被过滤掉

### Requirement: 「已关闭」的记忆必须能归因到具体一条公告，且对旧数据降级

关闭判据 MUST 优先使用后端稳定 `id`；`id` 缺失（旧数据）时 MUST 降级为可复现的内容摘要键，
MUST NOT 退化成"按数组下标记忆"——下标会因新公告下发而整体位移，
导致用户关掉 A 之后 B 消失、A 复活。

#### Scenario: 新公告下发不得让已关闭项复活

- **WHEN** 用户关闭了 `id=7` 的公告，随后运营新增了 `id=9` 的公告并下发
- **THEN** `id=7` MUST 保持隐藏、`id=9` MUST 显示；判据 MUST NOT 依赖下标

#### Scenario: 无 id 的旧数据

- **WHEN** 某条公告没有 `id` 字段
- **THEN** MUST 用 `severity + title + content` 组合键记忆，且同一内容重启后仍命中同一键

### Requirement: 公告横幅的全部用户可见文案必须 zh/en 成对，且无障碍属性走同一套键

`role="region"` 的 `aria-label`、关闭按钮的 `aria-label`、severity 标签与兜底文案
MUST 来自 locales（zh/en 同批成对），MUST NOT 在组件里硬编码中文——
屏幕阅读器读到的也是文案，双语合同对它同样成立。

#### Scenario: 切到英文界面

- **WHEN** 应用语言为 `en`
- **THEN** 区域标签、关闭按钮标签与三档 severity 名称 MUST 全部为英文，MUST NOT 出现半中半英

#### Scenario: 无公告时不占位也不发声

- **WHEN** 公告列表为空
- **THEN** MUST NOT 渲染任何容器（含 `role="region"`），MUST NOT 给读屏留下空的 landmark

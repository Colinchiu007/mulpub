# PRD：运营公告横幅接线（UX 审计阶段 1 · 单元 1.2）

- 日期：2026-10-21
- 分支 / PR 载体：`ux-audit-announcement-mount`
- 关联规格：`openspec/changes/ux-audit-announcement-mount/`（proposal / design / specs / tasks）
- 关联审计条目：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 1 表 1.2 行

## 1. 问题

`apps/desktop/src/components/AnnouncementBanner.vue` 与它的数据源 `useOpsCenterRuntime` 都已实现，
但**全仓零引用**（含测试目录，实测 `grep -rna "AnnouncementBanner" src electron` 零命中）。

后果是运营链路的一半是装饰性的：后台发布「系统维护」「重要提醒」，
`opsCenterSyncRuntime` 正常返回、`announcements` 数组有值，
但没有任何组件把它渲染出来 ⇒ 用户永远看不到。这与 1.1 的 `useTheme`（已实现、零消费方）同形。

## 2. 目标与非目标

**目标**：让运营下发的公告在应用外壳顶部即时可见；把组件既有语义（分档、可关闭性、记忆）
用测试钉住；把硬编码中文文案迁入 locales 并成对；给"下发型 UI 必须有渲染方"留下一把接线锁。

**非目标**（全部登记在 §8）：改主进程几何契约、公告推送化、已关闭集合回收、横幅进暗色像素基线。

## 3. 显示项（逐项，含缺位行为）

容器 `.announcement-banners`（`role="region"`）只在**至少一条未被用户关闭的公告**存在时渲染；
列表为空时不产出任何节点（连占位注释都不应被读屏感知——`v-if` 而非 `v-show`）。

单条横幅 `.announcement-banner` 由四部分组成：

| 位置 | 内容 | 数据来源 | 缺位行为 |
| --- | --- | --- | --- |
| 左 | 档位标签 `.ann-badge` | `severity` → locale 键 `announcement.severity.<档>` | 未知/缺失档位 ⇒ **降级为 `info` 的样式与标签**，整条仍然显示（不得丢弃） |
| 中上 | 标题 `.ann-title` | `a.title` 原文 | 无标题时仍渲染空标题行（文案由运营负责，前端不猜） |
| 中下 | 正文 `.ann-content` | `a.content` 原文 | `content` 缺席 ⇒ **整行不渲染**（不得留空容器） |
| 右 | 关闭按钮 `.ann-close`（`✕`） | — | `severity === 'maintenance'` ⇒ **不渲染**（维护通告不可被用户消音） |

档位样式：`info` 蓝、`warning` 黄、`maintenance` 红，浅暗两档各有取值（`[data-theme="dark"]` 分支已存在）。
`✕` 是字形不是图标，因此不进 element-plus 组件登记表。

## 4. 文案（zh / en 成对，实测由 `announcement-copy.test.js` 锁）

新增 `src/locales/announcement/{zh,en}.js`，命名空间 `announcement`，同时在 `locales/zh.js`、
`locales/en.js` 展开（`announcement: { ...announcementZh }`）。

| 键 | zh | en |
| --- | --- | --- |
| `regionLabel` | 运营公告 | Service announcements |
| `closeLabel` | 关闭公告 | Dismiss announcement |
| `severity.info` | 提示 | Notice |
| `severity.warning` | 重要提醒 | Important |
| `severity.maintenance` | 系统维护 | Maintenance |

`useOpsCenterRuntime.js` 原先在模块顶层写死 `{ info: '提示', warning: '重要提醒', maintenance: '系统维护' }`
并作为 composable 返回值导出——那是"英文界面必然露中文"的直接原因。本批改为其导出**机器值白名单**
`SEVERITIES = ['info', 'warning', 'maintenance']`，标签由组件按 locale 取。
composable 的自有测试同步改成正向（`SEVERITIES` 词表）+ 反向（`SEVERITY_LABELS` 不得再出现）两条断言。

⚠️ 为什么成对判据要自己写：CI Gate 7（`check-locale-sync.js`）只比对**根级** `zh.js`/`en.js`，
对本仓的拆分文件实测「删掉 en 键仍打 PASS」（任务 #20）。所以键集合相等、两侧取值非空
两条判据落在 `src/locales/announcement-copy.test.js`。

## 5. 交互与状态

1. **挂载即拉取**：`onMounted(() => loadRuntime())`，一次。App.vue 不得另起第二份拉取
   （两份真源会漂移，且运营中心同步已有既有失败语义）。
2. **关闭**：点击 `✕` ⇒ 把该条的 `dismissKey` 并入内存集合 ⇒ 该条立即从 `visibleAnnouncements` 消失 ⇒
   写 `localStorage['announcement-banner-dismissed']`（JSON 数组）。
   集合采用**整体替换**（`new Set([...old, key])`）而不是原地 `.add`，保证 computed 收敛。
3. **重开应用**：挂载时读回该键；`JSON.parse` 失败或结构不是数组 ⇒ 回落"都没关过"。
   「读失败」不等于「用户关掉了全部」——这是本批的一条显式判据（有测试）。
4. **存储写失败**（隐私模式 / 配额）⇒ 只 catch 住不影响本次可见性；下次开机它会重新出现，这是接受的行为。

### 5.1 关闭记忆键（数据校验的核心）

```
id 存在且非 null/''/'  →  'id:' + id          // id=0 是合法 id，判存在用 != null 而不是真值
否则                  →  severity + ':' + title + ':' + content
```

**禁止用数组下标**。下标键的失效形态是双向的：运营在列表最前面加一条新公告后，
用户关掉的那条会**复活**，而那条无辜的新公告会**消失**。
行为用例「运营新增公告不得让已关闭项复活、也不得让新项消失」正是照这个形状写的反向对偶。

### 5.2 severity 校验

闭合词表 `SEVERITIES` 之外的任何取值（含缺失、含 `null`、含未登记的 `critical`）一律落 `info` 档。
降级只降**样式与标签**，不降**可见性**：公告的语义是"运营要让用户看到"，
分档失败不能把它变成看不见。

## 6. 挂载点与几何（为什么不能随便放）

内嵌 `WebContentsView`（浏览器 / 登录标签里的第三方页面）是压在渲染 DOM 之上的原生图层，
CSS `z-index` 对它无效；它的矩形由主进程常量决定：`electron/services/view-bounds.js:29`
`BROWSER_CHROME_TOP = 76`（TabBar 36 + NavBar 40），实测被 `auth-view-manager.test.js:527` 钉住，
而**渲染端不上报内容矩形**（`getBoundingClientRect` 在 `src` 非测试代码里的 8 处用途都与内嵌视图无关）。

因此本批把横幅挂在 `.mp-shell-main` 内、`<NavBar>` 之后、工作区 `<main class="mp-workspace">` 之前：

- 不改 `TOP=76` 契约（`App.vue` 里那句「NavBar 高度 40px 不变…契约保持」是别的修复留下的承重注释）；
- 只在工作台外壳分支渲染，不会在 `isHomeShell`（内嵌主页 SPA 实例）里画第二遍；
- 空列表零占位 ⇒ 像素基线理论上零回归。

三条判据写在 `src/announcement-mount-wiring.test.js`：数量恰为 1、位置在 NavBar 之后且在工作区之前、
壳态分支区域内不得出现该标签。锚点缺失一律先红（`indexOf` 返回 -1 参与大小比较会静默得出"顺序正确"）。

## 7. 验收标准

| # | 判据 | 载体 |
| --- | --- | --- |
| A1 | 有公告 ⇒ 外壳顶部可见；无公告 ⇒ 无任何容器/landmark | `AnnouncementBanner.test.js` |
| A2 | 三档样式与标签键正确；未知/缺失落 `info` 且不丢弃整条 | 同上 |
| A3 | `maintenance` 无关闭按钮；`info`/`warning` 有 | 同上 |
| A4 | 关闭后持久化、重挂载仍隐藏；新增公告不得让已关闭项复活 | 同上 |
| A5 | 无 `id` 旧数据按内容摘要记忆；`id=0` 视为合法；坏 JSON 回落未关闭 | 同上 |
| A6 | 区域与关闭按钮的可访问名来自 locale 键 | 同上 |
| A7 | `App.vue` 真的渲染它，且只在工作台分支渲染一次 | `announcement-mount-wiring.test.js` |
| A8 | zh/en 键集合相等、取值非空、两个装配文件都展开命名空间、组件模板/脚本零硬编码中文 | `locales/announcement-copy.test.js` |
| A9 | 反证 7 道逐条 CAUGHT，且基线 `collected>0` | `scripts/announcement-mount-contract-mutate.js` |

## 8. 残留限制（如实写明，不假装已闭合）

1. **浏览器/登录标签前台时公告被内嵌视图遮住**。这是挂载点方案 C 的定义性代价：
   原生图层覆盖 `y ≥ 76` 的内容矩形，横幅正落在那块区域里。
   真解是几何双向通道——`computeEmbeddedViewBounds` 的 `topOffset` 参数**已经存在**，
   但实测四个消费点（`webview-manager/layout.js:267`、`auth-view-manager.js:167`、
   `oauth-manager/layout.js:87`、`qrcode-login.js:641`）没有一个传过非默认值；
   要用它就得新增"横幅高度"这条渲染端→主进程通道并让四处取值同源，且改动落进 `electron/` ⇒ 触发 QM-1 打包验证。另批。
2. **公告是拉取式**：只在挂载时 `loadRuntime()` 一次，应用长时间开着不会自动获得新公告。
   改成推送属运营中心同步面。
3. `announcement-banner-dismissed` **无上限累积**（公告 id 数量有限，当前不做淘汰，但这是已知增长面）。
4. 本批不新增暗色像素基线；`home-*` 等基线若因横幅出现回归，只能按"同一次 CI 渲染"刷新。
5. 反证驱动尚未接进 CI（任务 #23，与 1.3/1.5/1.6 的同类驱动一起接，落点须避开 30 分钟预算墙）。

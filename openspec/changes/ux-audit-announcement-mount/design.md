# 设计：公告横幅接线（单元 1.2）

## D1 挂载点：为什么不放浮动层

审计行原本写「z-index 低于发布面板」，该表述已被评审否证作废：内嵌 `WebContentsView` 是压在渲染 DOM
之上的**原生图层**，CSS z-index 对它无效（AGENTS.md「应用级浮层弹窗互斥合同」）。所以真正的问题不是
"层级够不够高"，而是"这块 DOM 会不会被原生视图盖住"。

原生视图的位置由主进程常量决定（`electron/services/view-bounds.js:29` 的 `BROWSER_CHROME_TOP = 76`，
实测 `apps/desktop/electron/services/auth-view-manager.test.js:527` 钉住 `{x:200, y:76, …}`），
而**渲染端不向主进程上报内容矩形**（实测 `getBoundingClientRect` 在 `src` 的非测试代码里有 8 处用途，
没有一处用于内嵌视图定位；渲染端只上报过侧栏宽度一类离散值）。
于是任何"把横幅放进内容区顶部"的做法，都改变不了原生视图的覆盖范围。

三条候选与选择（B 行的落点是当场读到的，不是推测）：

| 方案 | 代价 | 结论 |
| --- | --- | --- |
| A. 登记 `useEmbeddedViewSuspension` owner，公告出现即挂起内嵌视图 | 每来一条公告就把用户正在看的平台页藏掉；`overlay-view-suspension.test.js` 需新增 owner 断言；AGENTS.md 要求「释放必须穷尽」——释放若由 `visible` 状态驱动，必须走 `watch(visible)` 的 false 分支**再加** `onBeforeUnmount` 兜底，少一条就是残留挂起计数 | 否：瞬时通知不值得打断浏览，且这是最容易写错的一种 |
| B. 真正的「布局避让」：给横幅腾出顶部带，内嵌视图整体下移 | `computeEmbeddedViewBounds(win, sidebarWidth, topOffset, sidebarCollapsed)` 的 `topOffset` **参数已存在**（`:156`），纯函数不用改；但实测**四个消费点没有一个传过非默认值**——`webview-manager/layout.js:267` 传 `undefined`，`auth-view-manager.js:167`、`oauth-manager/layout.js:87`、`qrcode-login.js:641` 同样——要落地必须新增「横幅高度」这条渲染端→主进程通道（IPC handler + preload + 四处取值一致），漏一处即视觉错位；且改动落进 `electron/` ⇒ 触发 QM-1 完整打包验证 | 否（本批不做）：属"共享几何双向合同"，与本批价值不成比例；**已登记为后续批**，见 tasks §5 |
| **C. 挂在 `.mp-shell-main` 内、`NavBar` 之后、工作区 `main` 之前** | 浏览器/登录标签前台时横幅被原生视图遮住（与页面内容同等命运）；不破坏 `TOP=76` 既有契约 | **取**，并把限制按 D6 如实写明 |

> 这条选择是对审计预设（"A 或 B"）的**有意偏离**，不是遗漏。偏离的理由与代价写在 D6，
> 并留下一条可执行的后续批（tasks §5），而不是把"以后再说"写成免责声明。

C 的位置还有一个理由：它在 `v-else`（工作台外壳）分支内，因此**不会**在 `isHomeShell`
（内嵌主页 SPA 实例）与 `isFullScreenRoute`（`/first-run`）两个分支重复渲染，
避免"同一份公告在壳态里再画一遍"。

## D2 数据面：不新增第二份拉取

`useOpsCenterRuntime` 已经负责拉运营中心运行时并暴露 `announcements` / `loadRuntime`；
组件在 `onMounted` 调 `loadRuntime()`。MUST NOT 在 `App.vue` 里另起一次拉取（两份真源会漂移，
且运营中心同步已有既有失败语义）。空列表时组件 `v-if` 不渲染 ⇒ 外壳零占位、零像素影响。

## D3 文案迁移的落点选择

locale 目录是**拆分文件**制（`src/locales/<domain>/zh.js`）。横幅文案不归入 `settings`——
它是外壳级通知，既不属于设置页也不属于用户错误。新增 `src/locales/announcement/{zh,en}.js`，
键：`regionLabel` / `closeLabel` / `severity.info` / `severity.warning` / `severity.maintenance`。
`SEVERITY_LABELS` 从 `useOpsCenterRuntime.js` 的模块常量迁出：该常量现在把中文写死在 composable 里
（实测 `useOpsCenterRuntime.js:10` = `{ info: '提示', warning: '重要提醒', maintenance: '系统维护' }`），
是英文界面出现中文的直接原因。迁移后 composable 只返回 `severity` 机器值，标签由组件按 locale 取。

⚠️ 已知盲区（不在本批解决，见任务 #20）：`check-locale-sync.js` 只比对根级 `zh.js`/`en.js`，
对拆分文件**实测删掉 en 键仍打 PASS**。因此本批在自己的测试里加一条 zh/en 成对断言，
不依赖那道门禁。

## D4 关闭记忆

沿用既有 `localStorage` 键 `announcement-banner-dismissed`（值为 JSON 数组）。
`dismissKey` 保持「有 `id` 用 `id:<id>`，无 `id` 用 `severity:title:content`」——
这条已经是正确形状，本批的作用是把它**锁住**（实测该组件现在一条测试都没有），
并加一条"新增公告不得让已关闭项复活"的行为用例。
MUST NOT 改成按下标记忆（下标位移会让 A 复活、B 消失）。

## D5 反证（变异）清单

接线类改动最容易被"测试自己 mount 组件"骗过去，故必须做写型反证：

- C1 把 `App.vue` 里的挂载删掉 ⇒ 接线锁必须红（证"注册≠渲染"这道锁真有牙）
- C2 把 `v-if="visibleAnnouncements.length > 0"` 改成恒真 ⇒ 空列表不渲染那条必须红
- C3 让 `maintenance` 也渲染关闭按钮 ⇒ 不可关那条必须红
- C4 把 `dismissKey` 的 `id` 优先改成按下标 ⇒ 新增公告用例必须红
- C5 把 severity 兜底从 `info` 改成"整条丢弃" ⇒ 未知 severity 必须红
- C6 在组件里塞回一句硬编码中文 aria-label ⇒ locale 锁必须红

## D6 残留限制（写给下一个读的人）

1. **浏览器/登录标签前台时看不到公告**。这不是"忘了测"，是 D1 方案 C 的定义性代价：
   原生图层覆盖 `y ≥ 76` 的内容矩形，而横幅正在那块区域里。
   要在不挂起内嵌视图的前提下修好它，唯一出路是 D1 的方案 B（几何双向通道），已登记后续批。
2. **公告是"拉取式"，不是"推送式"**：`loadRuntime()` 只在组件挂载时调用一次。
   应用长时间开着不会自动获得新公告。改成推送属运营中心同步面，另批。
3. `localStorage` 的已关闭集合会**无上限累积**。当前不做淘汰（公告 id 数量有限），
   但这是一个已知增长面，不是"永远不会有问题"。

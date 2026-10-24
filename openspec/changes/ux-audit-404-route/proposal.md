# UX 审计 1.9：未知路由兜底页（catch-all 404）

## Why

`01-docs/UX-AUDIT-2026-10-17.md` 阶段 1.9 记录的问题：`apps/desktop/src/router/index.js` 的
`routes` 数组**没有任何 catch-all 路由**。用户把 hash 地址写错、点到已下线功能的旧链接、
或从历史记录里回放到一个已被重命名/删除的路径时，vue-router 匹配不到任何记录，
`<router-view>` 渲染**空内容** —— 页面既不是错误页也不是空白提示，而是「外壳还在、内容区什么都没有」。

用户侧的实际表现：

- 看起来像应用卡死（左侧菜单可点，但当前页面无任何反馈）
- 地址栏里的错误路径原样留着，页面不告诉用户「是这个地址不对」
- 唯一的自救方式是手动改 hash 或重启应用

同时，`router/index.js` 里的 `setRouteLoadError` 只服务**加载失败**（chunk 拉不到），
与「路径根本不存在」是两种不同的故障，不能复用它来表达 404。

## What Changes

1. **新增兜底路由**：在 `routes` 数组末尾追加 `path: '/:pathMatch(.*)*'`、`name: 'NotFound'`，
   指向新视图 `apps/desktop/src/views/NotFound.vue`。
2. **新增兜底页视图**：如实显示用户当前试图访问的、无法解析的路径，并提供两个可执行出口
   （回主页 / 返回上一页）；文案 zh/en 成对写入 `locales/common`。
3. **登记表新增一等公民「catchAll 类型」**：`apps/desktop/src/config/route-registry.js` 的登记项
   增加 `catchAll: true` 字段。**不动**既有的 `internal` / `entryFrom` 语义。
4. **门禁学会 catchAll**：`.github/scripts/check-route-registry.js` 新增规则 6（catchAll 唯一性 +
   路径形状 + 与 `internal`/`navEntry` 互斥），并让规则 2 只对 `catchAll: true` 的登记项跳过
   「必须回答入口」。同 PR 更新 `.github/scripts/check-route-registry.test.js`。
5. **标签标题走 routeName 分支**：`useTabDocumentTitle.js` 的 `resolveRouteTabTitle(path, routeName)`
   新增第二个参数，仅当 `routeName === 'NotFound'` 时返回「页面不存在」。
   ⛔ **不是**往 `ROUTE_TITLE_KEYS` 补一条 `/:pathMatch(.*)*`：那个 key 是**匹配模式**，
   永远不会等于任何真实 path，补进去就是一个运行时永不命中的死键（QM-6 外部评审 i4 指出
   本文与 design.md 的旧表述与实现相反，已按实现改正；实现侧的既有覆盖度测试已把 catchAll 排除）。

## 为什么不复用 `internal` + `entryFrom`

规则 2 要求每条非 redirect 路由能回答「用户从哪进来」。兜底页的正确答案是**「从任何地方」**——
它不是一个有宿主的暗路由。用 `entryFrom: '/'` 之类的值去满足门禁，是把假事实写进受 CI 强制的
登记表（`/` 并不是它的宿主，且规则 5 还会把这条登记成「有入口」的依赖关系），
下一个会话读到它会认为「404 页从首页进入」。**所以本变更把 catchAll 做成登记表的一等类型，
而不是给门禁造一个魔法值。**

## Impact

- Affected specs: `desktop-ui-consistency`（新增 4 条 Requirement）
- Affected code: `apps/desktop/src/router/index.js`、`apps/desktop/src/views/NotFound.vue`（新增）、
  `apps/desktop/src/config/route-registry.js`、`.github/scripts/check-route-registry.js`（判据本体）、
  `.github/scripts/check-route-registry.test.js`、`apps/desktop/src/locales/common/{zh,en}.js`、
  `apps/desktop/src/composables/useTabDocumentTitle.js`
- 风险：改动**门禁判据本体**（`.github/scripts/`）→ 属 AGENTS.md「改谁来守门」面，
  判据只能收窄不能放宽：新规则只在 `catchAll: true` 时豁免入口，其余登记项的既有约束逐字不变。
- 无视觉基线影响：404 页不进任何视觉注册表，也不改既有已登记视图的 DOM。

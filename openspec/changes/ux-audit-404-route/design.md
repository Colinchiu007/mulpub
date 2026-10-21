# Design — UX 审计 1.9（catch-all 404）

## 1. 判据落点：为什么必须改门禁本体

`route-registry.js` 的规则 2 要求每条非 redirect 路由回答「用户从哪进来」，且规则 5 要求
`entryFrom` 指向**表内已登记的 path**。兜底路由的事实是「从任何地方进来」，它没有单一宿主：

| 候选做法 | 后果 | 裁决 |
| --- | --- | --- |
| `internal: true, entryFrom: '/'` | 把「首页是 404 的宿主」写成受 CI 强制的假事实；后续会话会据此在首页找 404 入口 | ✗ |
| 从 `routes` 里省略 name，让解析器报 parseError | 门禁红，且路由本身仍可用——把红灯当设计 | ✗ |
| 给登记表加一等类型 `catchAll: true` | 表达真实语义；豁免面可被机械约束（恰好一条 + 形状闭合） | ✓ |

**豁免必须窄**：规则 2 的跳过条件写成 `entry.catchAll === true` 且**仅**这一种形态；
字段缺失解析为 `false`（fail-closed），所以既有登记项的行为逐字不变。

## 2. 路径形状是闭合常量，不是模糊正则

vue-router 4 的官方 catch-all 写法只有 `/:pathMatch(.*)*`（`*` 裸写在 v4 已被移除）。
判据取**常量全等**：

```js
const CATCH_ALL_PATH = '/:pathMatch(.*)*'
```

- 不写「path 里含 `(.*)`」这类形态匹配：那会把 `/board/:projectId(.*)` 这类**参数路由**也认成兜底，
  等于给「给普通路由开后门」留一条通道。
- 也不写死成「以 `*` 结尾」：`/foo*` 在 v4 是非法声明，形状判据必须与实际能匹配任意地址的那一种写法对齐。

规则 6 因此是三条合起来的一条：① 全表 `catchAll: true` **恰好一条**；② 该条的 `path === CATCH_ALL_PATH`；
③ router 侧 `/:pathMatch(.*)*` 至多一条（多条时后者永不生效，属静默失配）。

## 3. 「返回上一页」复用既有单一实现，不写第二份

`apps/desktop/src/composables/useSpaNavHistory.js` 已经是本仓「SPA 历史栈能否后退」的唯一实现
（读 `window.history.state.position`，`canGoBack = position > 0`，attach/dispose 成对）。
404 页必须消费它，而不是自己再判一次 `history.length > 1`（后者在 hash SPA 下语义不同：
`history.length` 含应用外的条目，会把「不能后退」判成「能后退」）。

- 在 `onMounted` 调 `attach()`、`onBeforeUnmount` 调 `dispose()`（该 composable 自带幂等 `attached` 守卫）。
- 渲染 `v-if="canGoBack"`；不可后退时**不渲染**该出口（不是禁用），因为对一个做不到的动作给出禁用态按钮，
  等于给用户一个永远不会亮的灯。

## 4. 视图顺序不是承重结构（写下来防止"顺手修")

vue-router 4 在 `createRouter` 时按** matcher score **排序，不依赖数组顺序，
所以把 catch-all 放在 `routes` 末尾只为可读性，不改变匹配结果。
未来会话若把「必须放末尾」当契约去加门禁，那是在锁一件不承重的事。

## 5. 文案与标题

- 键全部进 `locales/common/{zh,en}.js`（该命名空间是**平铺**结构，消费方写 `t('common.xxx')`，
  与 `common.pageLoadFailed` 同族）。
- 标签标题走 `resolveRouteTabTitle(path, routeName)` 的**名字分支**，只认 `routeName === 'NotFound'`。
  两条都是 QM-6 外部评审逼出来的（i4/i7）：
  ① **不往 `ROUTE_TITLE_KEYS` 补模式路径** —— `/:pathMatch(.*)*` 永远不等于任何真实 path，
     补进去是运行时永不命中的死键；既有覆盖度测试因此把 catchAll 条目排除出映射要求，
     「漏加即红」这句话对本条**不成立**（本文件旧版写过，已纠正）。
  ② 既然映射表不再兜底，名字就成了唯一接缝：**登记表 name ↔ router name** 由门禁规则 6 核对，
     **router name ↔ `CATCH_ALL_ROUTE_NAME`** 由 `NotFound.test.js` 核对；任一处改名不同步即红。
- 页面只回显 `route.fullPath` 原样文本，**不回显** `route.name`、chunk 名或任何 error 对象
  （那是 `setRouteLoadError` 的域，两种故障不得混用同一份文案）。

## 6. 无障碍与样式合同

- 出口是真实 `<button>`，沿用 `cohere-btn` 既有类，**不新增可聚焦变体**——
  否则要同步 `focusable-ring-contract.test.js` 的基线（该基线只能缩小）。
- 页面含一个 `<h1>`；不可见图标走 `aria-hidden`，文字按钮自带可访问名。
- 颜色一律取 CSS 变量，暗色档由既有 `[data-theme="dark"]` 分支覆盖，不写死色值。

## 7. 回归锁清单（每条都要能独立变红）

| 锁 | 位置 | 变异反证 |
| --- | --- | --- |
| catchAll 缺失 → 规则 2 点名「未能回答入口」 | `.github/scripts/check-route-registry.test.js` | 把登记项的 `catchAll: true` 删掉（夹具级） |
| 第二条 catchAll → 红 | 同上 | 夹具里复制一条 |
| path 形状不符 → 红 | 同上 | 把登记项 path 改成 `/404` 但保留 `catchAll: true` |
| catchAll 带 navEntry / internal → 红 | 同上 | 夹具加 navEntry |
| 普通暗路由仍被要求 | 同上 | **正控**：不得因新规则而放行 |
| router 侧出现两条同形状 → 红 | 同上 | 夹具追加一条 |
| 真实文件 PASS + 规模下界 | 同上 | 解析退化时规模断言红 |
| 兜底页渲染 / 回显路径 / 两个出口 | `apps/desktop/src/views/NotFound.test.js` | 摘掉 `v-if="canGoBack"`、摘掉 fullPath 回显 |
| 不复用 history.length | 同上 | 把 composable 换成 `history.length > 1` 必须红 |
| 标题映射覆盖 | `useTabDocumentTitle.test.js`（既有，**已排除 catchAll 模式路径**） | 反证 M8：摘掉 routeName 分支必须红 |
| catchAll 不得声明宿主入口（QM-6 i2） | `.github/scripts/check-route-registry.test.js` | 夹具把 `entryFrom: null` 改成 `'/'` 必须红 |
| catchAll 的 name 三处成对（QM-6 i7） | 门禁（登记表↔router）+ `NotFound.test.js`（router↔`CATCH_ALL_ROUTE_NAME`） | 把任一处 name 改掉必须各自变红 |

## 8. 明确不做

- 不加「搜索建议 / 猜测用户想去哪页」——那是另一条产品决策，本变更只保证**不困住用户**。
- 不把 404 上报到 `reportError`：路径不存在不是异常，进错误通道会污染诊断。
- 不改 `setRouteLoadError` 的文案或判定域。

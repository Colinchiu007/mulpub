# PRD：未知路由兜底页（catch-all 404）

> 落地日期 2026-10-21 ｜ 分支 `ux-audit-404-route` ｜ 来源 `01-docs/UX-AUDIT-2026-10-17.md` 阶段 1.9 ｜ OpenSpec change `ux-audit-404-route`

## 1. 问题与立项理由

### 1.1 用户侧现象

用户在下列任一场景里，会看到一个**只有外壳、内容区完全空白**的页面：

- 手输/粘贴一个拼错的地址（`#/colleciton`）
- 点了已下线或已改名功能的旧链接（历史记录、外部文档、运营推送里的旧地址）
- 从带参数的深链进来，而参数段不再匹配任何路由（`#/boardx/p-1`）

此时左侧菜单仍然可点，因此用户读到的是「应用卡了一下 / 这个功能打不开」，
而**不是**「我输入的地址不对」。自救方式只有手动改地址栏或重启应用。

### 1.2 技术事实（改动前取证）

| 坐标 | 事实 |
| --- | --- |
| `apps/desktop/src/router/index.js` | `routes` 数组无任何 catch-all / `pathMatch` / `*` 形态记录，末条是 `/podcast` |
| 同文件 `router.onError` → `setRouteLoadError` | 只覆盖**chunk 加载失败**（有 `error.message` 可显示），与「地址不存在」是两种故障 |
| `apps/desktop/src/App.vue` 工作区 | 用 `v-show`（非 `v-if`），所以未匹配时外壳照常渲染、`<router-view>` 渲染空 |
| `src/config/route-registry.js` | 兜底路由既不在表里，也**无法**诚实填进表里 —— 规则 2 要求每条路由回答「从哪进来」，而它的正确答案是「从任何地方」 |

### 1.3 为什么不复用「页面加载失败」那一套

`common.pageLoadFailed` / `pageLoadFailedMessage` 表达的是「资源没拉到，可以重试」。
把同一句话用在「地址根本不存在」上是**假承诺**：重试一万次它也不存在。
所以两种故障必须有各自的文案、各自的触发面、各自的判据。

## 2. 目标与非目标

**目标**

1. 任何解析不到记录的地址，都落到一个看得见、读得懂、能自救的页面。
2. 页面如实回显用户输入的那条路径 —— 让用户自己能看出哪里错了。
3. 保证用户**总能离开**：回主页恒在；有可退历史时给返回上一页。
4. 把「兜底路由」变成登记表的一等类型，并由 CI 保证它唯一、形状正确、不谎报入口。

**非目标**

- 不做「猜你想去哪个页面」的搜索建议 / 相似链接推荐（另一条产品决策）。
- 不把 404 上报进 `reportError` / 诊断包：路径不存在不是异常，进错误通道会污染诊断。
- 不改 `setRouteLoadError` 的文案或判定域。
- 不做视觉基线用例（新视图不进视觉注册表；见 §8 风险）。

## 3. 功能逻辑

### 3.1 匹配逻辑

- vue-router 4 的 `/:pathMatch(.*)*` 是**唯一**能匹配任意地址的声明形态（裸 `*` 在 v4 已移除）。
- 该 matcher 的 score 恒为最低，因此**数组顺序不承重**：放末尾只是可读性。
  任何会话都不许把「必须放末尾」当契约去加门禁（那是在锁一件不承重的事）。
- 具体路由与参数路由（`/board/:projectId`）照常优先，兜底不参与抢匹配（由行为用例
  `resolve('/collection').name === 'Collection'` 锁住）。

### 3.2 后退能力

- 判据**只有一份**：`composables/useSpaNavHistory`（读 vue-router 写进 `window.history.state.position` 的栈索引，
  `canGoBack = position > 0`），`onMounted(attach)` / `onBeforeUnmount(dispose)` 成对。
- ⛔ 禁止第二份口径 `window.history.length > 1`：hash SPA 下 `history.length` 包含应用外条目与
  会话残留，会把「栈首、无处可退」读成「能后退」，结果是给出一个点了没反应的按钮。
- 无处可退时**不渲染**该出口，而不是渲染一个禁用态按钮（禁用态等于给用户一盏永远不亮的灯）。

### 3.3 离开路径

| 出口 | 动作 | 为什么 |
| --- | --- | --- |
| 回到主页 | `router.replace('/')` | 用 replace 而非 push：兜底页不该留在历史里，否则用户从主页后退会**又撞回这个死胡同** |
| 返回上一页 | `router.back()`（`try/catch` + warn 旁路） | 与 NavBar 箭头的行为同源；失败不得冒泡打断页面 |

## 4. 显示项与文案（用户可见文字的唯一真源）

| 元素 | 键 | zh | en |
| --- | --- | --- | --- |
| 标题（`<h1>`） | `common.notFoundTitle` | 页面不存在 | Page not found |
| 说明 | `common.notFoundMessage` | 应用里没有匹配这个地址的页面，可能是地址输错、功能已改名或已被下线。 | No page in this app matches that address. It may be mistyped, renamed, or retired. |
| 路径标签 | `common.notFoundPathLabel` | 无法访问的地址： | Unreachable address: |
| 路径值 | —（运行时数据） | `route.fullPath` 原样，例如 `/colleciton?from=nav` | 同左 |
| 提示 | `common.notFoundHint` | 回到主页，或从左侧菜单重新进入需要的功能。 | Go back home, or reopen what you need from the sidebar. |
| 出口 1 | `common.notFoundBackHome` | 回到主页 | Back to home |
| 出口 2 | `common.notFoundGoBack` | 返回上一页 | Go back |
| 标签页标题 | 复用 `common.notFoundTitle` | 页面不存在 | Page not found |

文案约束：

1. 全部走 locales（`locales/common/{zh,en}.js` **平铺**命名空间，消费方写 `t('common.xxx')`），zh/en 成对；
   渲染端不得出现新的中文字面量。
2. 不得与 `pageLoadFailed*` 复用 —— 两种故障两种说法（§1.3）。
3. 说明句要把**三种成因**列出来（输错 / 改名 / 下线），否则用户只会怪应用。

## 5. 数据校验与显示规则

| 规则 | 判据 | 不成立时的行为 |
| --- | --- | --- |
| V1 路径回显取值 | `route.fullPath` 为非空字符串 | 回落 `'/'`，不渲染空 `<code>`（空胶囊看起来像坏了） |
| V2 只回显用户输入 | 页面文本 MUST NOT 含 `route.name`、视图文件名、chunk 名、`Error:`、堆栈 | 由用例逐个断言（`NotFound.vue` / `.js` / `chunk` / `Error:` 均不得出现） |
| V3 query / hash 保留 | 回显 `fullPath` 而非 `path` | query 是用户判断「我是不是少填了参数」的唯一线索 |
| V4 长地址不撑破布局 | `overflow-wrap: anywhere` + `word-break: break-all` | 布局塌陷会连带把出口按钮挤出可视区，等于没给出口 |
| V5 出口恒存在 | 「回到主页」不受任何条件门控 | 无条件渲染；这是本功能的最后一道保险 |
| V6 后退出口条件 | `canGoBack === true` | `false` 时整节点不渲染（`v-if`），不出现禁用态 |
| V7 标题真源 | `resolveRouteTabTitle(fullPath, route.name)` | 仅当 `route.name === 'NotFound'` 返回「页面不存在」；**不得**用「映射表没命中」反推（表内有刻意未补键的暗路由，反推会把正常页面标成 404） |

## 6. 登记与门禁契约

见 `docs/frontend-interaction-spec.md` §9.2 / §9.5。核心四条（`check-route-registry.js` 规则 6）：

1. 全表 `catchAll: true` **至多一条**；
2. 该条 `path` 必须**全等** `/:pathMatch(.*)*`（不用形态匹配：含 `(.*)` / 以 `*` 结尾会把参数路由认成兜底）；
3. 该条 MUST NOT 同时带 `navEntry`、`internal: true` 或 redirect 视图；
4. `router/index.js` 侧同形状 MUST NOT 多于一条（后者永不生效 = 静默失配）。

豁免面窄到「只认显式标记」：字段缺失或显式 `false` 都**不**获得豁免 —— 兜底路由若忘标，
它会立刻被规则 2 判成「暗路由未申报」，这是有意选择的失败方向（宁可拦住漏标，不可放行漏标）。

「本仓必须有一条兜底路由」的完整性判据写在 `check-route-registry.test.js` 的真实文件断言
（`stats.catchAllRoutes === 1`），不写进门禁脚本 —— 否则任何最小夹具都被迫携带一条 catchAll。

## 7. 交互流程

```
用户导航 ──► vue-router 匹配
              ├─ 命中具体/参数路由 ──► 该路由视图（兜底不参与）
              └─ 无任何记录命中 ──► NotFound.vue
                                     ├─ 显示：标题 / 说明 / 回显路径 / 提示
                                     ├─ 恒显：回到主页 ──replace──► '/'
                                     └─ 条件：canGoBack ? 返回上一页 ──back──► 上一页
                                                                 : 不渲染该出口
```

## 8. 验收标准

- [ ] `#/typo`、`#/colleciton?x=1`、`#/boardx/p-1` 三者都渲染兜底页，且页面文本含所输入的那条路径
- [ ] 兜底页在「应用启动即错误地址」时**不**出现「返回上一页」；从任一页面进入时出现，且点击后回到进入前页面
- [ ] 点「回到主页」落到 `/`，且从主页按后退**不会**回到兜底页（replace 语义）
- [ ] 中英文切换后文案随语言变化，无另一种语言残留
- [ ] 标签页标题为「页面不存在」，不是品牌名
- [ ] `node .github/scripts/check-route-registry.js` 打 `PASS` 且现场读数含 `兜底 1 条`
- [ ] `node scripts/not-found-contract-mutate.js` → `ALL_CAUGHT（9 条）`，且基线三套件 `red=0`

**已知盲区（不假装已闭合）**：`NotFound.vue` 不进任何视觉注册表 ⇒ QM-4 像素门禁对它失明；
它的暗色档目前只靠 token 层的既有色值，没有像素判定证据。补基线要走「同一次 CI 渲染」的口径，
不能拿本机截图。

## 9. 关联落点

| 文件 | 作用 |
| --- | --- |
| `apps/desktop/src/router/index.js` | `routes` 导出 + 末尾 catch-all 声明 |
| `apps/desktop/src/views/NotFound.vue` | 兜底页视图 |
| `apps/desktop/src/views/NotFound.test.js` | 13 条例为锁（含真实路由表解析、出口条件、防泄漏、夹具前提自证） |
| `apps/desktop/src/config/route-registry.js` | `catchAll` 字段契约 + 兜底登记项 |
| `.github/scripts/check-route-registry.js` / `.test.js` | 规则 6 判据本体与 25 条门禁自测 |
| `apps/desktop/src/locales/common/{zh,en}.js` | 6 组文案，zh/en 成对 |
| `apps/desktop/src/composables/useTabDocumentTitle.js` | `routeName` 分支；覆盖度测试排除 catch-all 模式路径 |
| `scripts/not-found-contract-mutate.js` | 9 道变异反证驱动（尚未接进 CI，欠账见任务 #23） |

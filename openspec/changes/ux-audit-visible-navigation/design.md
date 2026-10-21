# Design: ux-audit-visible-navigation

## 决策 1：三段判断收敛到一个 composable，而不是给 App.vue 补一个 if

现场是两处代码：`MpSidebar.onNavClick`（三段式，正确）与 `App.vue` 的 `api.onNavigate`
回调（裸 `router.push`，漏了前两态）。最小改动是给回调补判断，但那会把同一判断抄成第三遍——
下一个入口（命令面板 / 托盘菜单）会重演同样的缺陷。因此把判断抽成
`useVisibleNavigation({ tabStore, router, apiGetter, warn })`，两个入口都调它，
并用结构锁禁止任何一处再自带 `navigateActiveHomeShell` / `switchToTab('home')` 形态的判断。

## 决策 2：依赖由调用点注入，且必须是惰性箭头函数

组合式**不 import** `@/api/electron-bridge`。两条实测理由：

1. Vite 的 `vi.mock` 工厂缺一个具名导出时，症状是**访问期**抛
   `No "getApi" export is defined on the "@/api/electron-bridge" mock`。
   如果组合式在 import 期就依赖它，那么每一个 mock 桥接层的既有夹具
   （`MpSidebar.more-keyboard` / `.appmenu` / `.more-active` 三个文件共 26 条用例）会被整片打红——
   与本单元无关的用例被迫跟着改夹具。
2. 更糟的形态是在 setup 期把 `getApi` 这个**函数本身**取出来（`apiGetter: getApi`）：
   那就是访问，同样触发上面的失败。因此调用点一律写 `apiGetter: () => getApi()`，
   把访问推迟到真正需要定向导航的那一刻（与改造前的内联版本逐字同构）。

这条不是洁癖：它是本次实跑踩出来的（见执行记录 §四）。

## 决策 3：顺序判据（B 段）与"不重复切"的两道守卫各有分工

`ensureVisibleTab()` 里 `if (tabStore.isHomeTab) return` 与
`if (activeTabId === homeTab.tabId) return` 看似冗余，实测分工不同：
前者挡"当前活动标签本身就是 home"（App 快捷键用例走这一格），
后者挡"标签列表里的 home 恰好已经是活动标签但 isHomeTab 因数据形态未成立"（组合式用例走这一格）。
反证 M6 的第一版只摘掉前者，结果**零条红**——因为后者把同一种状态又挡了一遍；
把变异改打后者才打通。结论写进驱动注释：冗余防御不是契约，id 比较才是有牙的那道。

## 决策 4：定向回执的判据比原实现更严

原 `onNavClick` 判的是 `res && res.data && res.data.handled`；收敛后判
`res && res.code === 0 && res.data && res.data.handled`。
理由：主进程错误分支返回 `{ code: REQUEST_ERROR, data: { handled: false } }`，
两档在真实报文上等价；但"只认 `handled`"会让任何把 `handled` 写在信封外的新失败形态
被读成"已处理"，从而**静默不做任何跳转**。更严的一侧多出来的行为是"回落到可见路径"，
不是拒绝服务，因此可接受并锁在 5 条无回执形态用例里。

## 决策 5：降级永远出声，但不把异常抛给调用方

三段中的任何一段失败（定向抛错、切标签抛错、`router.push` 抛错）都记 `warn` 并继续走完
能走的部分；`navigateVisibly` 自身不 reject。理由：它挂在快捷键回调与点击回调上，
抛出的异常会落进 App 壳层，而"跳错页 / 跳得慢"都比"壳层炸"轻。

## 测试分层

- `useVisibleNavigation.test.js`：A/B/C 三段 + 5 条无回执形态 + 抛错 + 缺桥 + 非法入参 +
  `'/'` + 装配锁（调用点参数面、调用点集合）+ 惰性取桥的反例（缺 `apiGetter` 不崩）。
- `App.visible-navigation.test.js`：真 tab store + 真 `getApi`（`window.electronAPI` 假桥），
  钉"快捷键这条入口也走同一段"，含顺序账本（`switch:home` 必须先于 `push`）、
  定向成功时不得再 push、卸载后不得有幽灵跳转，以及三条结构锁。
- 既有夹具 `MpSidebar.sidebar-focus-nav.test.js` 补 `flushPromises()`：收敛后的实现比原内联版本
  多几层 await，`trigger()` 只等到一次渲染 flush，回退链上的 push 会晚一个微任务 → 间歇性假红。

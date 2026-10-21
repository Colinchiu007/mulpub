# PRD：导航必须「可见」—— 快捷键与鼠标共用一段实现（UX 审计 1.5）

- 变更名：`ux-audit-visible-navigation`
- 日期：2026-10-21
- 关联规格：`openspec/changes/ux-audit-visible-navigation/specs/desktop-ui-consistency/spec.md`
- 关联审计项：阶段 1 的 1.5（`01-docs/UX-AUDIT-2026-10-17.md`）

## 1. 问题与现场取证

### 1.1 现象

同一个"去发布页"动作，两种输入方式结果不同：

| 用户此刻聚焦在 | 鼠标点左侧边栏 | 按全局快捷键 `Ctrl+Alt+P` |
|---|---|---|
| 首页标签（主窗口 SPA） | 可见跳转 | 可见跳转 |
| 普通网页标签（原生 `WebContentsView` 覆盖层） | **先切回首页标签**再跳 → 可见 | 只推主窗口路由 → **屏幕上什么都没发生** |
| 内嵌主页实例（home-shell，独立 SPA 实例） | 经 IPC 定向让该实例自己跳 → 可见 | 只推主窗口路由 → 那个实例没动，且主窗口多出一条它看不见的路由（两侧从此漂移） |

第二、三行的用户侧描述就是审计报告里的"按了没反应"。它不是慢，不是失败，是**跳转发生在看不见的背后**，
因此没有任何错误提示可依赖，也没有日志痕迹。

### 1.2 链路取证（逐跳，可重跑）

```
主进程注册全局加速键      apps/desktop/electron/services/hotkeys.js:58
  → win.webContents.send('app:navigate', config.route)
渲染层订阅               apps/desktop/src/App.vue（onMounted 内）
  → unsubscribeNavigate = api.onNavigate((route) => router.push(route))   ← 缺陷落点
鼠标侧（正确实现）        apps/desktop/src/layouts/MpSidebar.vue:194-214（改造前）
  → onNavClick：三段式（定向 home-shell / 切回首页标签 / 才 push）
```

取证命令（判"两处判断各写一遍"）：

```bash
git grep -n "navigateActiveHomeShell" -- apps/desktop/src   # 改造前只命中 MpSidebar.vue
```

**根因判定**：不是"App.vue 漏了一个 if"，而是**同一段判断被抄了两遍**，其中一遍没抄全。
因此修法不是补 if，而是把判断收敛为单一实现，并锁住"不得有第二份"。

### 1.3 与阶段 3.2 的关系（不冲突声明）

审计 §5 的依赖定序写着"3.2（导航真源收敛到 `route-registry` 派生）先于 1.5，或让 1.5 直接消费派生结果"。
本单元**不产路由清单**——它收敛的是"该跳到哪一面"这条**决策**，路由字符串由调用方原样传入
（侧边栏来自 `SIDEBAR_MENU_DEFINITION`，快捷键来自 `hotkeys.js` 的 `config.route`）。
因此 3.2 落地后本实现无需改动即可继续作为唯一消费点；两条不重叠。

## 2. 方案

新增 `apps/desktop/src/composables/useVisibleNavigation.js`，导出
`useVisibleNavigation({ tabStore, router, apiGetter, warn }) → { navigateVisibly }`。
两个入口（`App.vue` 的 `app:navigate` 订阅、`MpSidebar.vue` 的 `onNavClick`）都调它，
组件内不再保留任何"该跳哪一面"的判断。

## 3. 交互逻辑（三段 + 三条降级纪律）

### 3.1 主流程

```
navigateVisibly(to)
  ├─ 入参校验：typeof to !== 'string' || !to → 直接不动作
  ├─ A 段 tryNavigateHomeShell(to)
  │    ├─ tabStore.activeTabIsHomeShell 为假 → 返回 false（不得误发定向 IPC）
  │    ├─ 取桥失败 / 无该方法 → 返回 false
  │    ├─ await pageManager.navigateActiveHomeShell(to)
  │    └─ 仅当回执 code===0 且 data.handled===true → 返回 true → 【到此收口，不再做任何跳转】
  ├─ B 段 ensureVisibleTab()
  │    ├─ tabStore.isHomeTab → 返回（已在首页标签，不发多余 IPC）
  │    ├─ tabs 里找不到 isHome 的标签 → 返回（不抛错，仍继续跳转）
  │    ├─ activeTabId === homeTab.tabId → 返回（已是那条标签，不重复切）
  │    └─ await tabStore.switchToTab(homeTab.tabId)；抛错 → warn 后继续
  └─ C 段 await router.push(to)；抛错 → warn，不外泄
```

顺序不可反：**先切标签，后推路由**。反序会先改主窗口路由再换可见面，用户在覆盖层背后完成跳转，
与缺陷形态同构。

### 3.2 数据校验与入参契约

| 输入 | 判据 | 行为 | 理由 |
|---|---|---|---|
| `'/publish'` | 非空字符串 | 走完三段 | 正常目标 |
| `'/'` | 非空字符串 | 走完三段 | **回首页是合法目标**，且它是真实流量：`hotkeys.js:24` 注册了 `CmdOrCtrl+Alt+H → route: '/'`。真值判空会让这一格静默失效 |
| `''` / `null` / `undefined` / `42` / `{}` | 非字符串或空 | 不动作，**并记一条 `warn [nav] ignored navigate request`** | 「不认识的目标」不落地是对的，但**静默**不对：静默丢弃与本单元要消灭的缺陷同形（按了没反应、日志零痕迹）。评审 i1 的处置 |
| 无 `pageManager` / 无该方法 | 宿主不支持（纯浏览器 dev、旧 preload） | 直接走 B+C，不抛错 | 桥缺失是常态而非异常，不得制造噪声日志 |

**「找不到 home 标签」这一格单独说**（评审 i4）：`ensureVisibleTab` 在
`tabStore.isHomeTab` 为假、且 `tabs` 里找不到 `isHome` 标签时，仍然会推主窗口路由 ——
这条路径的**可见结果与本次修的缺陷 1:1 同形**（跳转发生在覆盖层背后）。
它只在异常数据形态下可达，但"可达性低"不是"可以静默"的理由，因此该分支必须
`warn [nav] no home tab`，并由两条对称的用例守住（缺 home 时必须恰有一条告警；
有 home 标签时**不得**误报，防它退化成恒发）。

| 回执形态 | 判定 | 后续 |
|---|---|---|
| `{ code: 0, data: { handled: true } }` | 已接管 | 收口，不再切标签、不再 push |
| `{ code: 0, data: { handled: false } }` | 未接管（主进程判活动标签非 home-shell） | 回落 B+C |
| `{ code: 0, data: {} }` / `{ code: 0 }` / `{ code: -3 }` / `null` | 无有效回执 | 回落 B+C |
| 抛异常 | 桥断开 | `warn('[sidebar] navigate home-shell failed')` 后回落 B+C |
| 无 `pageManager` / 无该方法 | 宿主不支持（纯浏览器 dev、旧 preload） | 直接 B+C，不抛错 |

**口径**：「没拿到回执」绝不等于「已处理」。把它读成已处理会让快捷键导航静默失效（用户按了没反应、
日志零痕迹）——这正是本单元要消灭的形态，不得在修复里再造一个。

**上游取值面事实**（决定入参契约的边界）：`hotkeys.js` 的 10 组注册里只有
`CmdOrCtrl+Alt+Q → route: '__quit__'` 不是路由，它在主进程内就被 `win.destroy()` 拦下
（`hotkeys.js:46-49`），**永不下发给渲染层**；因此 `navigateVisibly` 不需要为哨兵值特判，
也不得为此加一层"猜测式白名单"（那会把新增真实路由变成需要两处同步的欠账）。

### 3.3 提示文字与显示项

本单元**不新增任何用户可见文案**（无 locale 变更、无新节点、无新样式），因此：

- 不在像素判定域内（无新基线、无需刷基线）；
- 不新增可聚焦元素，阶段 3.6/4.4 的键盘可达与焦点环基线不变；
- 唯一的"可观测变化"是行为本身：停在网页标签按快捷键时，TabBar 会先高亮首页标签，随后主窗口显示目标页。

诊断痕迹（非用户可见，走 `console.warn`）三条，措辞沿用改造前 `MpSidebar` 的同款前缀，
以便历史日志检索不断链：
`[sidebar] navigate home-shell failed` / `[sidebar] switch home failed` / `[sidebar] navigate failed`。

## 4. 依赖注入口径（实现约束，非偏好）

组合式不 import `@/api/electron-bridge`，桥由调用点以 `apiGetter: () => getApi()` 注入。两条实测理由：

1. Vite 的 `vi.mock` 工厂缺具名导出时，**访问期**抛
   `No "getApi" export is defined on the "@/api/electron-bridge" mock`。
   若在组合式里 import，则每个 mock 桥接层的既有夹具（实测 3 个文件、26 条用例）整片变红。
2. 在 setup 期取 `getApi` 这个函数本身（`apiGetter: getApi`）同样是访问——实测红的那 26 条
   就是这么来的。因此必须是惰性箭头 `() => getApi()`，把访问推迟到真正需要定向的那一刻。

代价是"调用点漏传"不会编译失败，只会让定向分支恒不生效 ⇒ 用装配锁补：
逐个生产调用点断言参数面含 `apiGetter` 与 `getApi`，并对**全仓调用点集合**做等值断言
（新增入口未登记即红）。

## 5. 验收标准

| # | 判据 | 取证方式 | 结果 |
|---|---|---|---|
| V1 | 停在网页标签按快捷键 ⇒ 顺序恒为 `switch:home` → `push` | `App.visible-navigation.test.js`（真 tab store + 假桥 + 顺序账本） | ✅（**证明的是方法调用顺序 + IPC 回执**，不是"原生图层真的换面了"；后者见 §7 遗留 3。评审 i4 的措辞修正） |
| V2 | 聚焦内嵌主页实例且回执 `handled:true` ⇒ 只定向，不切标签、不 push | 同上 | ✅ |
| V3 | 无有效回执的 4 种形态 + 抛错 + 缺桥 ⇒ 一律完成主窗口跳转 | `useVisibleNavigation.test.js` | ✅ |
| V4 | 已在首页标签 ⇒ 不多发一次切标签 IPC | 两层各一条 | ✅ |
| V5 | `'/'` 是合法目标；`''`/`null`/`42`/`{}` 不动作 | 同上 | ✅ |
| V6 | 卸载后不得有幽灵跳转（`onNavigate` 的 stop 被调用且回调不再触发） | `App.visible-navigation.test.js` | ✅ |
| V7 | 两条入口共用同一实现；任一处再自带一份判断即红 | 3 条结构锁（扫描域排除注释行） | ✅ |
| V8 | 10 道变异逐条指名变红 | `node scripts/visible-navigation-contract-mutate.js` | ✅ `CAUGHT=10 其余=0` |
| V9 | 既有侧边栏/壳层用例不回归 | `vitest run src` 全量：**Test Files 405 ⇒ 2 failed / 403 passed；Tests 6421 ⇒ 2 failed / 6417 passed / 2 skipped** | ✅（两条红是 `preload index.bundle.js 已重打包`×2，读的是**非受管构建产物**，本 worktree 未跑打包步骤；归因与取证见执行记录 §二） |
| V10 | 本批新增面自身 | 三个文件单跑：**39 passed**（组合式 25 + App 10 + 侧边栏既有 4），rc=0 且无 `Errors` 行 | ✅ |
| V11 | 通道集合唯一性（评审 i5/i6 的派生锁） | 三条集合锁：发送方恒等于 `{electron/services/hotkeys.js}`、渲染层订阅方恒等于 `{src/App.vue}`、定向 IPC 的消费方恒等于共享实现；每条带扫描域规模下界与构建产物排除 | ✅ |

## 6. 反证（14 道，全部实跑；严格判据 + 死探针预筛）

**测量域必须先说清**（评审 i2）：驱动只跑 3 个测试文件（`useVisibleNavigation.test.js` /
`App.visible-navigation.test.js` / `MpSidebar.sidebar-focus-nav.test.js`，共 39 条用例）。
它证明的是**这些锁有无牙**，不证明「全量无回归」—— 后者由 §5 V9 的 `vitest run src`
（405 文件 / 6421 用例）单独承担。把两者混为一谈会让「CAUGHT=14」读成它没证明的东西。

**两条判据（都是评审 i3 的处置，缺一就会自欺）**：

1. **死探针预筛**：任何一条 `expect` 探针若命中不到**真实存在的用例标题**，驱动以 rc=2 拒跑。
   标题域取自 JSON reporter —— 实测默认 reporter 只打**文件级**勾选行
   （`✓ src/x.test.js (25 tests)`），从 stdout 取用例名会得到空集，
   于是「每条探针都是死探针」，而空集读起来像「锁坏了」：那是工具失明，不是锁坏，必须分档报。
2. **严格命中**：CAUGHT 要求**全部**声明的探针都出现在红集里，否则判 `PARTIAL_RED` 并点名沉默的那条。
   原规则「≥1 命中即过」会把「只打红一条、其余声明的锁在变异下完全沉默」读成锁有牙。

| # | 注入的被禁形态 | 落点 | 声明的锁（必须全红） | 结果 |
|---|---|---|---|---|
| M1 | App.vue 回退为裸 `router.push` | `App.vue` | 快捷键顺序锁 + onNavigate 取体锁 | CAUGHT |
| M2 | 侧边栏绕开共享实现（直连 push） | `MpSidebar.vue` | 侧边栏定向锁 + 切标签锁 | CAUGHT |
| M3 | 调用点漏传 `apiGetter` | `App.vue` | 装配锁 | CAUGHT |
| M4 | 无视 home-shell（恒不定向） | composable | 组合式 A 段 + App 定向锁 + 侧边栏定向锁 | CAUGHT |
| M5 | 「调用过 IPC」当成「已处理」 | composable | 5 种无回执形态 + App 回落锁 + 侧边栏回退锁 | CAUGHT |
| M6 | 摘掉「已是 home 标签就不重复切」的 id 比较 | composable | 组合式那条（App 层走另一格，必须保持绿） | CAUGHT |
| M7 | 顺序反转（先 push 后切标签） | composable | 顺序不可反 | CAUGHT |
| M8 | 入参判据退化为真值判空 + 误杀 `/` | composable | 根路径合法 | CAUGHT |
| M9 | 定向成功后不收口 | composable | App 定向锁 + 侧边栏不 push 锁 | CAUGHT |
| M10 | IPC 抛错被读成「已处理」 | composable | 抛错回落锁 | CAUGHT |
| M11 | 「找不到 home 标签」重新变回无日志（i4） | composable | 如实登记那条 | CAUGHT |
| M12 | 非法入参被静默丢弃（i1） | composable | 非法输入必须出声那条 | CAUGHT |
| M13 | 侧边栏**复制**一份定向判断而不调组合式（i6） | `MpSidebar.vue` | 消费方集合锁 + 侧边栏结构锁 | CAUGHT |
| M14 | 回调体改用「中间变量存 route 再裸 push」（i6） | `App.vue` | 取体锁 + 快捷键顺序锁 | CAUGHT |

现场读数：`[DEAD-PROBE] 全部探针可命中（标题域 39 条）` + `[SUMMARY] 共 14 条：CAUGHT=14 其余=0`，rc=0。

三条**关于反证自身**的实测更正（不写下来就会被下一个会话重抄）：

1. **M6 的第一版零条红**。它摘的是 `if (tabStore.isHomeTab) return`，而后面那道
   `activeTabId === homeTab.tabId` 比较把同一种状态又挡了一遍 —— 前者是冗余防御，
   **有牙的是 id 比较**。变异必须打在生效的那一格里，否则这条 M 是恒真的装饰。
2. **M7 的第一版是 `PROBE_BLIND`**。多行片段替换留下了悬空的 `} catch {}`，vitest 在解析期就失败，
   汇总行缺失 ⇒ 既不能判 CAUGHT 也不能判 MISSED。改为只替换「切标签 + 推路由」这两步的顺序。
3. **过度声明是反向的自欺**（改严格判据后当场暴露）：M2 原声明的侧边栏结构锁、M6/M7 原声明的
   另外几条锁，在对应变异下**合法地保持绿** —— 它们守的是别的格子。把这些写成预期会让严格判据
   把它们变成永久 `PARTIAL_RED`；正解是把声明收窄到真覆盖的锁，并**为沉默的那条另开一条能真正
   打红它的变异**（M13/M14 就是这么来的），而不是删掉那条锁或放宽判据。

驱动另有两条不可省的口径：基线不干净（`rc≠0` / 有 failed / `Errors>0`）一律拒跑（退出码 2）；
还原动作放 `finally`，但**自报不作数** —— 跑完逐文件 md5 回读比对，不等即退出码 4。

## 7. 遗留（不假装已闭合）

1. 反证驱动目前仍是**手动跑**（与 `publish-staleness-contract-mutate.js` 等三条同批欠账，任务 #23）：
   它接进 CI 需要一条不吃 30 分钟预算的落点，本批不擅自决定。
2. `MpSidebar.onNavClick` 与快捷键现在同源，但**第三个入口**（命令面板 / 托盘菜单 / `TabBar` 的
   「新标签」按钮里那些直接 `router.push` 的分支）尚未收敛。调用点集合锁会在有人新增
   `useVisibleNavigation(` 而未登记时红，但**不会**把仍在裸 push 的旧入口拉进来——
   那需要一条"裸 router.push 的导航入口"清点，属阶段 3.2/5.x 的域。
3. 键盘路径的**可见性**只能由行为锁证明（顺序账本 + 定向不回落）。真实 Electron 里"覆盖层背后
   跳转看不见"这一现象需要人眼或像素级观测；本批未做真机验证，故不声称"已在真机确认"。

## 8. QM-6 第一轮评审处置（外部模型 claude 评审，判定 DUAL，8 条问题 / 6 条待裁决）

评审引擎现场读数：`评审完成：8 条问题，维度分 4 个（correctness/security/performance/maintainability），最低分 6`；
`收敛判定: status=self_play reason=selfPlay minScore=6`；`待裁决 6 条；其中高危域必须外部复核 0 条`。
产物：`.adversarial/ccg-deep-a9dd314e/{critique-v1.md,adjudication.json}`。

**六条全部 upheld**（没有一条被"看起来没问题"打发）。逐条的指控 / 辩护 / 处置：

| # | 指控要点 | 为什么不成立的那一半（辩护） | 实际处置（可验证） |
|---|---|---|---|
| i1 | 非字符串入参被**静默**丢弃，未来任一发送方给对象描述符就复现"按了没反应、零痕迹" | 两条生产入口今天都只发字符串；不认识的输入不落地本身是对的 | 丢弃改为**出声**（`[nav] ignored navigate request`）+ 行为锁逐个非法值断言恰有一条日志 + 变异 M12。对象型描述符的透传通路**刻意不实现**（无消费者的分支＝新增无人维护的路径），由该告警在真出现时暴露 |
| i2 | 验收表把「2 failed 的全量跑」记成通过，与记录里"不认领也不放行"自相矛盾；且驱动域只有 3 文件，CAUGHT 不能读成无回归 | 全域回归与变异覆盖本就是两件事 | 措辞与域都改：V9 结论写成"已归因的既有红 + 判据"；§6 顶部明写测量域与它**不**覆盖的范围 |
| i3 | 判据是「≥1 命中即 CAUGHT」，且存在**永远命中不到的死探针**（M1 的「调用同一个组合式」在实际标题里不存在） | 红集全量打印，人工可读回 | 驱动加**死探针预筛**（标题域取自 JSON reporter；取不到读数 rc=2）+ **严格命中**（全部声明必须红，否则 `PARTIAL_RED` 并点名沉默的那条）。改完当场暴露 M2/M6/M7 的**过度声明**（见 §6 更正 3） |
| i4 | 「找不到 home 标签」分支静默在覆盖层背后完成跳转 = 缺陷 1:1 同形且无日志；顺序账本被当成"可见性"证据 | 该分支需异常数据形态才可达；单测无法观测原生图层 | 该分支加 `[nav] no home tab` 告警 + 对称双锁（缺标签必有一告警 / 有标签不得误报）+ 变异 M11；V1 措辞收窄为"方法调用顺序 + IPC 回执"，真机观测留在 §7 |
| i5 | 把所有 `app:navigate` 都改成可见导航，但 PRD 只举证一个发送方；第二个发送方（引导/许可证/托盘）本意可能不同 | 实测确实只有一个发送方 | 前提经检索为假，但结论按可执行方式收口：**三条集合锁**（发送方集合 / 渲染层订阅方集合 / 定向 IPC 消费方集合），把"我读过代码说没有"变成回归锁（V11） |
| i6 | 「不得有第二份判断」弱于宣称：字面形态匹配可被中间变量绕过；集合锁只认"调用了组合式"的文件，复制判断而不调用者能穿过 | 结构锁只提高成本，不是编译器 | ① App.vue 取体改为**括号配对 + 跳过字符串**，并给取体逻辑配自证用例（含"未配对必须返回 null"）+ 变异 M14 用被禁形态打红；② 探测面从"是否调用组合式"换成"是否引用定向 IPC `navigateActiveHomeShell`" + 变异 M13 正是这一形态 |

**方法论沉淀（可带走的部分）**：

- 「一次 grep 说不可达」不是结论，**集合锁**才是。i5/i6 的处置都不是加散文说明，而是把
  可达性/唯一性变成会红的判据。
- **严格命中会暴露过度声明**，这是收益不是代价：它逼出了 M13/M14 两条新变异，
  也把"M2 声明了侧边栏结构锁"这种纸面覆盖纠正成真实覆盖。
- **不要在一个反证驱动正在改写文件的 worktree 里跑测试**：本轮实测出现一次"39 条里 1 条红"，
  红的是驱动瞬时变异态，不是代码缺陷 —— 与"外部模型评审期间禁止跑变异"是同一条纪律的另一半。

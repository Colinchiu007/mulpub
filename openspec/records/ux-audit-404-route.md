---
record: ux-audit-404-route
task: UX 审计 1.9 —— 未知路由兜底页（catch-all 404）+ 登记表新增 catchAll 一等类型
date: 2026-10-21
---

## 本次执行记录：未知路由兜底页（ux-audit-404-route，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 运行时代码（含门禁判据本体） | worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-404-route`，裸分支 `ux-audit-404-route`（非 C 盘）；取证力靠分支名与 PR 号，不靠本机绝对路径 |
| 第一性原因（QM-5 ①） | ✅ | `apps/desktop/src/router/index.js` 的 `routes` 数组自始至终**没有 catch-all 记录**（改动前该文件 72 行，末条为 `/podcast`）。vue-router 匹配不到 → `<router-view>` 渲染空内容，外壳仍在 ⇒ 用户读作「应用卡死」 |
| 逃逸分析（QM-5 ②） | ✅ | 单元测试：无（从未有用例问过「未知地址渲染什么」）；视觉回归：无（无可见元素可拍）；审查盲区：`route-registry.js` 的规则 2「必须回答入口」让人以为「每条路由都有宿主」，实际兜底路由根本不在表里，门禁对它无从判 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `NotFound.vue` + 路由 + 登记表 `catchAll` 类型 + 门禁规则 6；`apps/desktop/src/views/NotFound.test.js`（13 例，含用**真实路由表**解析未知地址的行为锁）；`.github/scripts/check-route-registry.test.js`（+11 例） |
| 防止再次发生（QM-5 ⑤） | ✅ | 判据本体新增规则 6（唯一性 / 形状全等 / 与 navEntry·internal 互斥），真实文件断言 `catchAllRoutes === 1`；`scripts/not-found-contract-mutate.js` 9 道变异全部 CAUGHT |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径相等（见下方「行尾现场」） |
| 接线棘轮 | ✅ | 新增测试文件均在 vitest workspace（`apps/desktop`）与既有 `node --test` 点名处；驱动 `scripts/not-found-contract-mutate.js` **未接进 CI**，与同族三个驱动一起挂在欠账 #23，本条如实记 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`；新视图不进任何视觉注册表，既有基线的拍摄条件未被改写 |
| QM-6 CCG 双模型外部评审 | PENDING | 本 PR 触到「门禁判据本体」（`.github/scripts/`），属高危面，只认 `tier=external`；驱动已就位，评审在跑，结果与逐条处置见下方 §五 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>` |

## 一、动因与现状取证

审计条目 1.9 的原始观察：「输入一个不存在的地址，页面什么都不显示，用户不知道发生了什么」。

本轮先做取证（不采信审计文档的一句话结论）：

- `router/index.js` 全文 72 行，`routes` 内 20+ 条具体路径 + 3 条 redirect，**无任何 `pathMatch` / `*` 形态**；
- 该文件里有 `router.onError(...)` → `setRouteLoadError(...)`，但它只覆盖 **chunk 加载失败**，
  与「地址不存在」是两种故障，产品语义不同（前者可重试，后者重试一万次也不存在）；
- `App.vue` 的工作区是 `v-show`（非 `v-if`），所以未知地址下外壳正常、内容区空 → 与审计描述一致。

## 二、为什么不复用 `internal` + `entryFrom`

规则 2 要求每条非 redirect 路由回答「用户从哪进来」，规则 5 还要求 `entryFrom` 指向表内已登记 path。
兜底路由的真实答案是「从任何地址进来」，写任何单一宿主都是**把假事实写进受 CI 强制的登记表**，
且规则 5 会把这条假事实当成依赖关系去做死链检查。

因此本变更把 `catchAll: true` 做成登记表的一等类型，并把豁免面**窄到只认这个显式标记**：

- 字段缺失 → `false`（fail-closed）；显式 `catchAll: false` 同样不获豁免（M3 型反证：见 §四）。
- 规则 6 的四条判据：登记面至多一条 · path 必须**全等** `/:pathMatch(.*)*` · 不得带 navEntry/internal/redirect 视图 · router 声明面至多一条同形状。
- 形状判据**刻意不写成形态匹配**（含 `(.*)` / 以 `*` 结尾）：那会把参数路由也认成兜底，等于给「普通路由开入口豁免」留通道。
- 「本仓必须有一条兜底路由」这条**完整性**判据不写进门禁（否则任何最小夹具都得带一条 catchAll，把夹具逼成生产形态），而由真实文件断言 `catchAllRoutes === 1` 锁住。

## 三、实现要点（显示项 / 交互 / 数据校验）

| 项 | 内容 |
| --- | --- |
| 显示项 | `<h1>` 标题「页面不存在」；说明句（三种成因：输错 / 改名 / 下线）；**回显用户输入的 `route.fullPath`**（含 query）；提示句；两个出口按钮 |
| 不显示 | `route.name`、视图文件名、chunk 名、异常对象、堆栈 —— 由用例逐个断言 DOM 文本不含这些字样 |
| 交互 | 「回到主页」恒在，走 `router.replace('/')`（用 replace 而非 push：兜底页不该留在历史里，否则从主页后退又撞回死胡同）；「返回上一页」仅当 `canGoBack` 为真时**渲染**（不是禁用态） |
| 数据校验 | `badPath = route.fullPath \|\| '/'`（空值不渲染空 `<code>`）；路径长到撑破布局由 `overflow-wrap: anywhere` 兜住 |
| 后退判据 | 复用唯一实现 `composables/useSpaNavHistory`（读 vue-router 写入的 `history.state.position`）；**禁止**第二份口径 `window.history.length`（hash SPA 下它含应用外条目，会把栈首读成可后退） |
| 生命周期 | `onMounted(attach)` / `onBeforeUnmount(dispose)` 成对；该 composable 自带 `attached` 幂等守卫 |
| 无障碍 | 真实 `<button type="button">` + 可见文字作可访问名；`aria-labelledby` 指向本页 `<h1>`；不新增可聚焦变体（沿用 `cohere-btn`），因此不扩大 `tabindex` 基线 |
| 文案 | `locales/common/{zh,en}.js` 平铺新增 6 键，zh/en 成对；与 `pageLoadFailed*` 分开，两种故障不复用同一句话 |
| 标签标题 | `resolveRouteTabTitle(path, routeName)` 新增第二参数：仅当 `routeName === 'NotFound'` 时返回 `common.notFoundTitle`。**不从「映射表没命中」反推 404** —— 覆盖度测试里存在刻意未补键的暗路由（`/first-run` 等），反推会把正常页面标成「页面不存在」（M9 专打这一格） |

## 四、变异反证（`node scripts/not-found-contract-mutate.js`，实测输出）

基线三套件全部 `red=0`（未变异必须绿，否则「红」不能归因给变异）：

```
[BASE] .github/scripts/check-route-registry.test.js rc=0 red=0
[BASE] src/views/NotFound.test.js rc=0 red=0
[BASE] src/composables/useTabDocumentTitle.test.js rc=0 red=0
M1 CAUGHT red=1  摘掉 catch-all 路由声明
M2 CAUGHT red=1  「返回上一页」不再看后退能力（无条件渲染）
M3 CAUGHT red=1  后退判据退回 window.history.length
M4 CAUGHT red=1  登记表删掉 catchAll 标记
M5 CAUGHT red=7  把豁免面放宽成「所有 internal:false 的登记项都免答入口」（被禁形态本身）
M6 CAUGHT red=1  摘掉 catchAll 的路径形状全等判据
M7 CAUGHT red=1  摘掉 router 侧「多条兜底路由」判据
M8 CAUGHT red=2  摘掉标题解析的 route.name 分支
M9 CAUGHT red=5  标题改成「映射表没命中就说 404」（用反推代替显式事实）
ALL_CAUGHT（9 条）
[RESTORE-CHECK] 5 个被改文件 md5 identical=true
```

口径说明（不夸大）：M2 与 M3 的红**落在同一条用例**（`position = 0 而 history.length > 1`）。
这不是重复：M2 是「恒渲染」，M3 是「用错时钟」，两者在该观测面上的可证伪形态相同；
若把它们合并成一条变异，就会失去「M3 在只有 `history.length` 判据时也能红」这一独立证据，
所以驱动要求**红集逐条打印**，由人核对而不是由驱动判同异。

## 五、一次自我纠正（夹具前提没自证，导致同一断言先绿后红）

第一版有一条用例写成「直接以错误地址启动（栈首）时不渲染返回按钮」，但它**没有断言自己处在栈首**。
实跑结果：同一句 `expect(exists()).toBe(false)` 在文件首条用例绿、在末条用例红。

- 根因：jsdom 的 `window.history` **跨用例共享且不可收缩**，`resetSession()` 只把当前条目的 state 置 null，
  而 vue-router 的 `position` 游标会随前面的 push 前进。于是「是不是栈首」取决于前面跑过几条用例 —— 测的是夹具位置，不是组件判据。
- 正解：用例自己把游标钉住（`replaceState({...state, position: 0})` + 按真实 popstate 语义派发事件，
  同 `useSpaNavHistory.test.js` 既有手法），并**断言前提**（`position === 0` 且 `history.length > 1`）。
- 沉淀：见 `## learnings` 第一条。这也是本仓「夹具前提必须自己断言」的第 N 次现场，不是新洞，是新落点。

## 六、验证现场

- `node --test .github/scripts/check-route-registry.test.js` → `# tests 25 / # pass 25 / # fail 0`
- `node .github/scripts/check-route-registry.js` → `[route-registry] router 路由 37 条（redirect 3 条）/ 登记 37 条 / 菜单项 22 个 / 暗路由 11 条 / 兜底 1 条` + `PASS`
- `vitest run src/views/NotFound.test.js` → 13 passed
- `vitest run src/composables/useTabDocumentTitle.test.js` → 17 passed（含新增 4 条）
- 邻近套件：`route-registry-entry-hosts` / `useSpaNavHistory` / `locales/structure-lock` 全绿
- eslint：**按 CI Gate 11 的同一条聚合命令跑**（`cd apps/desktop && eslint electron/ src/ --quiet`）→ `ESLINT_AGG_RC=0`。
  口径来自 #4197 的同期教训：只 lint「我改过的 8 个文件」会漏掉"一个文件里两份同名真源"这类
  聚合口径才显形的缺陷 —— CI 的判定域是整个 `electron/` + `src/`。

### 行尾现场（当场量，不凭记忆）

`git ls-files --eol` 逐文件读数（本次改动集里两半都有）：

```
i/lf  w/crlf  attr/text=auto   01-docs/UX-AUDIT-2026-10-17.md
i/lf  w/crlf  attr/text=auto   docs/frontend-interaction-spec.md
i/lf  w/lf    attr/text=auto   apps/desktop/src/views/NotFound.vue
i/lf  w/lf    attr/text=auto   apps/desktop/src/views/NotFound.test.js
i/lf  w/lf    attr/text=auto   openspec/records/ux-audit-404-route.md
```

即：两份既有文档的工作副本是 checkout 出来的 CRLF，新建文件是 LF —— **这是仓库既有状态，不是本次改写**。
对账证据：`git diff --cached --numstat` 与 `git diff --cached --ignore-cr-at-eol --numstat`
两口径**增删行数完全相等**（均为 1512），说明没有任何一行是因行尾而被动改写。
`git add` 时打印的 `LF will be replaced by CRLF` 是这件事的即时告警，本次已核对为「索引 blob 仍是 LF」，
不是需要修的问题；但**下一次再动这两份文档时仍要先测行尾分布**，别把它当噪声忽略。

### 遗留（不假装已闭合）

## 五、QM-6 外部评审处置（critic=claude，8 条 findings，逐条附可重取证据）

判定 `DUAL`（907 行），外部 critic 真实跑过（产物 `.adversarial/ccg-deep-21a7b3d5/critique-v1.md`，
dimensionScores：correctness 7 / security 10 / performance 10 / maintainability 6）。

| # | 级别 | 裁决 | 依据（现场取证） | 处置 |
| --- | --- | --- | --- | --- |
| i1 | Warning | **dismissed** | 评审称规则 6 的 `continue` 会跳过规则 4 的 view 核对。实测规则 4 是**独立遍历**（在规则 2 之前，不看 catchAll 标记）；探针 A：把真实登记表 catchAll 的 view 改成 `NotFoundPage.vue` → `ok=false`，原文「视图不一致：/:pathMatch(.*)* …」 | 不改判据；把这条「独立遍历」写进 design.md §7 以免下轮再被提 |
| i2 | Warning | **upheld** | 探针 B：`entryFrom: null` → `'/'` 后 `ok=true`。规则 5 只在 `entry.internal` 为真时查 entryFrom，catchAll 条目 internal 为假 ⇒ 假宿主从侧门进表，而规格 Requirement 3 写了「不声明宿主入口」 | 判据补 `catchAll 不得声明宿主入口`；夹具用例 + 反证 **M11 CAUGHT**；脚本头部规则清单同步 |
| i3 | Info | **dismissed** | 评审称「router 侧删掉兜底时门禁单独跑是绿的」。探针 D：删掉 router 那行 → `ok=false`，原文「陈旧登记：/:pathMatch(.*)* 在 router/index.js 中已不存在」 | 不改；spec 的「与路由器声明一致」确有判据支撑 |
| i4 | Warning | **upheld** | 真问题：proposal.md 第 5 点与 design.md §5 仍写「ROUTE_TITLE_KEYS 必须新增该 path 的条目 / 漏加即红」，而实现把 catchAll **排除**出映射覆盖要求（模式路径永不等于真实 path，补进去是死键）。文档与实现互相否定 | proposal 第 5 点与 design §5/§7 全部按实现改写，并把「漏加即红」明确标注为**不成立** |
| i5 | Info | **upheld** | 驱动循环里 `restoreAll()` 被调用两次，且 `restored` 只进日志不参与判定 —— 单条还原失败会在脏基底上继续跑后续变异 | 删重复调用；`restored !== true` 当场 `return 4` 中止 |
| i6 | Info | **成立但描述不准** | 评审问「看不到命中该否定的父规则」。父规则确实存在：`.gitignore` 的 `scripts/*.js`（AGENTS.md 亦写明「新脚本须补 negation」），故 `!scripts/not-found-contract-mutate.js` 不是死配置 | 在此登记父规则名，避免下轮再问 |
| i7 | Info | **upheld** | 探针 C：登记表 name 改成 `NotFond` → `ok=true`。三处字面量（登记表 name / router 声明 name / `CATCH_ALL_ROUTE_NAME`）里没有任何一处一致性断言 | 判据补「catchAll 的 name 必须与 router 声明逐字一致」+ 反证 **M12 CAUGHT**；渲染层半边由 `NotFound.test.js` 新增的三处成对用例锁 |
| i8 | Info | **upheld（记为债务）** | 兜底页不做焦点迁移；而本页「禁止出现 tabindex」的用例正好堵掉常规修法（`h1 tabindex=-1` + focus） | 写进 PRD §8 已知盲区，注明「要修必须单独变更并同步更新那条禁令」，不静默留洞 |

**闭合状态（如实）**：`deepReview.status = self_play_blocked`、`performedBy = self-play`。
两条 Warning 成立 ⇒ 引擎自扮演出口判阻断，且本 PR 触到判据本体属高危面，
**closure 只认 `tier=external`**（AGENTS.md「QM-6 残留风险」+ 任务 #19）。
所有成立项均已在实现中修掉并有变异反证，但**不得**为了过 `check-pr-exec-record` 手工改写
`status` 字段 —— 那正是本仓记录的「装饰性门禁」同型。合并动作待人工过目。

- QM-6 外部评审闭合：本 PR 改到门禁判据本体，属高危面，自扮演豁免不够格；结果待回填本文件 §五（处置表），不得手写 `status` 凑闭环。
- 反证驱动未接进 CI（与 `img-loading-contract-mutate.js` 等三个同族驱动一并挂在任务 #23）。
- `NotFound.vue` 不进视觉基线判定域（QM-4 对它失明），因此它的暗色档目前只有 token 层的既有色值保障，无人做过像素判定。

## CHANGELOG 条目

# feat(路由): 未知地址落到可见兜底页，登记表新增 catchAll 一等类型（ux-audit-404-route）

- 输入错误地址、点了已下线的旧链接时，不再出现「外壳还在、内容区空白」的假死状态：现在会显示「页面不存在」，
  原样回显那条地址，并给出「回到主页」出口；确实有可退历史时才出现「返回上一页」。
- 404 页的标签标题不再顶着品牌名，改为「页面不存在」。
- 路由入口登记门禁（`check-route-registry.js`）学会把兜底路由当**一等类型**：它不再被要求填写宿主入口，
  但全仓必须恰好一条、路径形状必须与 vue-router 的兜底写法逐字一致，也不得同时声明菜单入口或暗路由标记。

## learnings

### lesson: 依赖宿主历史栈的用例必须自己钉住游标并断言前提

**现场**：`NotFound.test.js` 同一句「栈首时不渲染返回按钮」在文件首条用例绿、末条用例红；
驱动基线跑也报 `red=0`，红是在我把它挪到文件末尾之后才出现的。

**根因**：jsdom 的 `window.history` 跨用例共享且不可收缩；`replaceState(null)` 只清当前条目的 state，
不清 vue-router 写进 state 的 `position` 游标。于是「处于栈首」这个**前提**成了测试文件内用例顺序的函数，
断言量的不再是组件的判据。

**可复用的 N 条**：

1. 任何「宿主状态相对量」（历史栈、滚动位置、剪贴板、焦点、时钟）作为用例前提时，
   必须在用例内**显式建立 + 显式断言**，不能靠"夹具刚初始化所以一定成立"。
2. 判据「同一断言在一次跑里既绿又红」永远归因到夹具，不归因到被测代码 —— 被测代码在整个文件里是同一份。
3. 建立前提的手法要复用仓内既有先例（这里是 `replaceState + PopStateEvent`，来自 `useSpaNavHistory.test.js`），
   不要发明第二套；第二套本身就是本条要消灭的那个洞。
4. 反证驱动必须先跑一次**未变异基线**并要求 `red=0`，且读到「没有汇总行」时单独成档
   （`PROBE_BLIND`），不得把「探针没读到」读成「没红」。

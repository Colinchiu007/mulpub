---
record: ux-audit-more-keyboard
task: UX 审计阶段 4.5（audit-31）—— 侧边栏「更多」菜单补 roving tabindex + 方向键 + Esc + 焦点归还，并配 13 条行为锁与 7 条变异反证
date: 2026-10-19
sync_pr: pending
sync_status: PENDING
sync_reason: 运行时代码变更（apps/desktop/src）+ 文档，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：「更多」菜单键盘可达（ux-audit-more-keyboard，2026-10-19）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 独立 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-nav-telemetry`（非 C 盘）。**路径与分支名不同源**：该 worktree 原为「导航埋点」任务创建，埋点因隐私边界未定被中止（见 PRD 待决项），本批改用其工作树，分支已 `git branch -m` 更名为 `ux-audit-more-keyboard`（回读 `rev-parse --abbrev-ref HEAD` = 该值）。目录名保留是已知不整齐，不留第二个未用 worktree 的成本更低 |
| 质量节拍 pre-flight | ✅ | 编辑前确认当前分支非共享根 `main`；共享根未被写入（本轮所有落盘都在 worktree 内） |
| 自测 | ✅ | `vitest run src/layouts/MpSidebar.more-keyboard.test.js` → **13 passed / 0 failed**；`vitest run src/layouts`（含既有 4 份侧边栏套件）→ **49 passed / 0 failed / 5 files** |
| 反证（7 条） | ✅ | MK-1…MK-7 全部 CAUGHT 且**各自红在指名用例**；控制跑（未变异）rc=0 passed=13；`RESTORED_OK=true`、`BYTE_IDENTICAL_RESTORE=true`（逐字节比对备份）。首轮 MK-2 报 **MISSED**，据此补了一条行为锁后复跑转 CAUGHT（见「三、MK-2 那条 MISSED」） |
| 静态门禁 | ✅ | `check-locale-sync.js --cjk` → **PASS（基线 1331 条，当前 1148 条，无新增硬编码）**：本批新增中文只出现在注释里，没有新的用户可见字符串 ⇒ **不需要**成对改 locales（Gate 7 的 `--pair-base` 无触发面）；`check-no-brand-residue` / `check-doc-abs-paths` 无新增竞品名与绝对路径（本记录一律用 `<仓库父目录>/…` 占位） |
| QM-1 打包 | N/A | 只改 `apps/desktop/src/**`（渲染端），未触碰 `apps/desktop/electron/**` 与 `packages/rpa-engine/**` ⇒ 打包判据不触发；理由写在这里，不留给下一个会话猜 |
| QM-4 视觉回归 | 未跑（如实登记） | 本批只加 ARIA 属性、`tabindex`、事件绑定与隐藏态容器 id，**不改任何盒模型/颜色/字号**；且本机像素门禁需要"本 worktree 自己的 dev server + CI 同源基线"两个前提，缺一即报 `ERR_VISUAL_ENV_MISSING`（不是回归）。像素门禁由 `QG Visual` 在 CI 上以 CI 渲染为准执行 |
| QM-6 双模型 | 未跑 | 本机无 CCG（pre-commit 实测打印「未找到 CCG（run_skill.js），已跳过」），如实登记为未执行，不伪造 `cleared` |
| 第一性原因（QM-5 ①） | ✅ | 不是「忘了写方向键」，而是**给了角色却没给该角色的操作方式**：容器早已声明 `role="menu"` / `role="menuitem"`，但 `tabindex` 全默认、无任何 keydown 处理、Esc/焦点离开都不收起。读屏软件据此 announce「菜单」并期待方向键可用 ⇒ 比声明 `role="menu"` 之前更坏（承诺了一个不存在的能力） |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：既有 4 份侧边栏套件只断言「点击展开」「选中态类名」「折叠宽度上报」，**没有一条键盘路径断言**；集成/视觉层：像素门禁对 `tabindex`、`aria-controls` 完全失明（非视觉属性），`role="menu"` 存在与否也不改变像素；审查层：audit-31 是靠人工读模板发现的，说明缺口此前不在任何机械判据的视野内。四类逃逸原因同时命中：无测试 / Mock 过度（`RouterLink` stub 不带可聚焦语义）/ 断言不精确 / 环境差异 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 单一实现落在 `MpSidebar.vue` 的模板 + setup 内（roving tabindex、`focusableOf`、`visibleMoreIndexes`、`moveMoreActive`、`initialMoreIndex`、`toggleMoreMenu` / `openMoreAt` / `closeMoreMenu` / `onMoreMenuKeydown` / `onMoreMenuFocusout`）；回归保护 = 同目录新文件 `MpSidebar.more-keyboard.test.js`（13 条，用真实组件 + 真实 jsdom 焦点，不 mock 键盘行为） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 13 条锁全部**从渲染结果反推夹具**（`discoverMoreItems()` 读 `href`/`data-testid`），菜单增删改序不会把判据变成假结论；② 每条行为都配了一条**取被禁形态本身**的变异（MK-1 写 `tabindex="0"`、MK-5 起点写死 0、MK-6 摘 `aria-controls`…），7 条红集互不相同；③ 驱动脚本把「探针自身是否活着」写成硬判据（控制跑必须 rc=0 且 passed>0，否则整体 `PROBE_BLIND` 不产出结论），这条正是本轮踩出来的（见「四、探针自己先瞎过一次」）；④ 反法论已记入 learnings |

## 一、这次到底改了什么（用户可见口径）

**展开方式**（两种都保留）：
- 鼠标点「更多」→ 展开，焦点留在触发器（不变，避免改变既有肌肉记忆）。
- 键盘停在「更多」上按 **↓** → 展开并把焦点直接放进菜单里的那一项。

**进菜单以后**：

| 键 | 行为 | 为什么这样定 |
|---|---|---|
| ↓ / ↑ | 在**可见项之间循环**移动焦点（末位再按 ↓ 回第一项，首位再按 ↑ 回末项） | WAI-ARIA menu 模式；循环比"停在末位"少一次反方向按 |
| Home / End | 直达首项 / 末项 | 13 项扁平菜单（audit-31 同一发现）没有分组，两端是最常用的落点 |
| Esc | **收起菜单并把焦点还给「更多」触发器** | 只收起不还焦点 = 把键盘用户丢回 `document.body`，得从头 Tab 一遍 |
| Tab | 收起菜单，但**不还焦点、不 preventDefault** | Tab 的语义是"继续往前走"；实现若抢回触发器，用户按一次 Tab 会退回原地 |
| Enter / Space | 收起并让 `<a>` 的原生激活发生（真正的跳转仍由 `onNavClick` 负责） | 收起是键盘路径的收尾，不改既有导航实现 |
| 鼠标点击 / 聚焦某项 | 该项立刻成为 roving 位，随后按方向键从**它**继续 | 真实用户会先点一项再按方向键；这条是 MK-2 逼出来的（见第三节） |
| 焦点移出菜单且没落在触发器上 | 自动收起 | 焦点走了还挂着一块 `role="menu"`，读屏会继续播报不可见的面板 |

**显示项**：无新增/删除任何可见文字。触发器与 13 项的 label、图标、激活高亮、`aria-current="page"` 全部不变；新增的只有 `aria-controls` / `id` / `role="menuitem"` 上的 `tabindex`（`0`/`-1` 两态）。

**数据校验**：本批不读写任何持久化数据，不触碰 IPC 参数。唯一"输入"是键盘事件与焦点转移。

**交互逻辑边界（三条刻意写出来的）**：
1. **运营把某项隐藏后索引不得漂移**：`visibleMoreIndexes()` 只认真实存在的项，方向键的候选集是"当前渲染出来的那些"，不是 `moreItems` 的全长。
2. **起点不是第 0 项**：`initialMoreIndex` 取「当前路由命中项」。用户在 `/hot-topics` 打开菜单被丢到列表第一项，等于每次都要重新走一遍。
3. **反复展开不留残值**：收起后 `moreItemEls` 里那些项被置 `null`（Vue 卸载时以 `null` 回调 ref），重新展开时 roving 位按规则重置为起点，而不是沿用上次的末位。

## 二、一条实现层的硬约束：模板 ref 回调不得写响应式状态

第一版把元素表写成 `ref([])` 并在 `:ref="(el) => setMoreItemRef(index, el)"` 里赋新数组，
组件**立刻**抛 `Maximum recursive updates exceeded in component <MpSidebar>`。
原因是 render → ref 回调 → 改状态 → 再 render 自成闭环。
修法：元素表用**普通数组** `const moreItemEls = []`，只在事件处理器里读，不参与渲染。
配套：`<router-link>` 的模板 ref 拿到的是**组件实例**，可直接 `focus()` 的是它渲染出的 `<a>`，
所以统一走 `focusableOf()`（与 AGENTS「宿主 API 字段归属必须先核实」同型，只是这里换了层）。

## 三、MK-2 那条 MISSED：变异反证发现的是**判据的洞**，不是产品缺陷

首轮 7 条里 MK-2（摘掉 `@focus="moreActiveIndex = index"`）**照绿**。
读实现才看清：方向键路径上 `focusMoreItem()` 自己就改了 `moreActiveIndex`，
所以「按方向键 → roving 位迁移」这条断言**结构上测不到**那个事件监听。
而真实用户会先用**鼠标点**某一项，此时只有 `@focus` 会把 roving 位搬过去；
摘掉它的症状是「点了第 7 项、再按 ↓ 却从原来的位置跳走」。
补了一条「鼠标点/聚焦到别的项后，roving 位必须跟着焦点走」的行为锁，复跑 7 条全部 CAUGHT。
**结论口径**：反证报 MISSED 时，第一问不是"这处代码不重要"，而是"我的断言有没有覆盖到那条边"。

## 四、探针自己先瞎过一次（本轮最该留住的一条）

变异驱动 v1 用了 `vitest --reporter=basic` —— vitest 4 已移除该 reporter，
每次跑都是 `Startup Error … Failed to load custom Reporter from basic`、rc=1、红集为空。
于是 7 条变异**全部**被报成 `CAUGHT`。如果只看 verdict 行，这一轮会写成"七条反证均实测变红"，
而事实是一条都没跑。两处修正：
- 驱动加了硬判据：**控制跑（未变异）必须 rc=0 且 passed 可解析为正数**，否则整体 `PROBE_BLIND` 并且不产出任何结论；
  每条变异还要求 `red.length > 0` 且**指名用例**在红集里（`CAUGHT_WRONG_TEST` 单列）。
- 顺带踩到第二个坑：v2 首跑把自己判成 `PROBE_BLIND`，原因是 `ctrl.failed` 为 `NaN` ——
  **vitest 全绿时根本不打印 `N failed`**。缺字段是 0 不是"探针坏了"；把探针的缺省读数当成失败信号，
  与把它当成成功信号是同一类失真。

## 五、刻意没做的事（三条，都有归属）

1. **`sidebar.cloudPublish` 的标签「CLI」没有改**。audit-31 的第二半句是「桌面 GUI 里用户无从理解」，
   但改成什么是**产品命名决定**（zh/en 两侧 `locales/sidebar/zh.js:63`、`en.js:63` 当前都是 `CLI`），
   不由实现侧代订。已在 PRD 待决项里列出，等口径后单独走一个成对 locales 的小 PR。
2. **「更多」组仍扁平无分组**（13 项）。本批只补键盘可达，不重排信息架构 —— 那是 audit-31 的第三条建议，
   属结构性变更，动它会把选中态、运营中心配置主键和像素基线一起牵进来。
3. **没有引入 `aria-activedescendant`**。roving tabindex 与 activedescendant 是同一需求的两种实现，
   本仓菜单项是真 `<a>`（可点、可读 href、浏览器自带焦点环），选 roving；
   若后续改成"焦点始终留在容器"的写法，本文件的 13 条断言里有 6 条要同步改口径，这里先记下不偷改。

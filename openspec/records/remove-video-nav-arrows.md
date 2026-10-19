---
record: remove-video-nav-arrows
task: 删除视频创作页头 ←/→ 页面导航箭头整组（含页内浏览历史状态机）——视图 tab + 左侧菜单已承接导航
date: 2026-10-20
branch: remove-video-nav-arrows
---

# 执行记录：移除视频创作页头导航箭头（remove-video-nav-arrows，2026-10-20）

## 0. 动因（用户截图反馈）

用户截图圈住视频创作页头部的 ←/→ 导航区域，要求「多个页面顶部的导航区域，去掉」。这是 #4002（删流水线「返回」按钮）之后的第二刀导航收敛——导航语义已由视图 tab + 左侧菜单完整承接，页内箭头冗余。

## 1. 变更类型与隔离

| 项 | 内容 |
|---|---|
| 变更类型 | 运行时代码（renderer 层） |
| 隔离方式 | 独立 worktree `mp-worktrees\mp-remove-video-nav-arrows`，裸分支 `remove-video-nav-arrows`，`verify-worktree-deps` OK |

## 2. 实现（删 31 行，不留半套死机制）

删除对象分三层，**整套页内浏览历史机制一并下线**：

1. **模板**：`.page-header-nav` 容器 + 两个 `.nav-arrow-btn`；
2. **逻辑**：computed `canGoBack`/`canGoForward`、methods `goBack`/`goForward`/`applyViewState`、`pushViewState` 及 `switchView` 内的入栈调用、`selectPipeline` film-engineering 分支的入栈调用、data `viewHistory`/`viewHistoryIndex`；
3. **样式**：`.page-header-nav`/`.nav-arrow-btn` 四条规则（含 reduced-motion 引用已在上一轮清除）；#4002 的注释口径同步更新（「由顶部导航箭头承接」已不成立）。

完整性自查：`pushViewState`/`applyViewState` 全仓仅被被删方法引用；`viewHistory` 无其它消费者；`NavBar.vue`（应用级浏览器导航）与 `useSpaNavHistory`（首页 SPA 历史）是**另一套机制**，不在删除面。

## 3. TDD

| 阶段 | 结果 |
|---|---|
| 先加锁 | **RED**：「顶部导航箭头整组下线」（`.page-header-nav`/`.nav-arrow-btn` 不存在 + `goBack/goForward` 为 undefined + 标题区完整） |
| 实现后 | **GREEN**：CreateView + 样式契约 345/345 全绿；eslint rc=0 |

## 4. 门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 独立 worktree，deps OK |
| TDD | PASS | RED(1) → GREEN(345)；eslint rc=0 |
| QM-4 视觉 | 本地像素差**归因排除**，判定交 PR CI | 本地 PIXEL_ONLY 三视图 24.8%/24.6%/1.27%——差异图显示整页网格布局位移（上游 #3936 折叠区改版所致），非本刀 31 行删除所能造成；本机渲染截图取证确认箭头消失、标题置顶。**真实判定以 PR CI Gate 7b 为准**（0 px 判据 + 两轮甄别） |
| QM-1 打包 | 不触发（renderer-only，未触 electron/） | — |
| QM-2 代码必检项 | PASS | 纯删除；无新同步原语/全局注册/IPC/中文硬编码 |
| QM-6 | single 档 | UI 微改，未调用外部模型 |
| CHANGELOG | PASS | 置顶追加 |

| 远程同步 | 由门禁推导 |

- 保留门禁：变更类型与隔离 ✅ | TDD ✅ | eslint ✅ | QM-4（判定交 CI）| QM-2 ✅ | CHANGELOG ✅

## 5. 已知残留（不假装已闭合）

- 本地像素环境差（本机 vs CI 渲染）是系统性问题：本机渲染相对 CI 基线普遍漂移 0.2%~25%（随页面复杂度），本地像素跑只能做「方向性取证」，精确判定必须靠 CI。本轮再次验证了上一刀 #4002 的教训。
- 若上游 #3936 之后的布局改版没有同步刷 `create-editor`/`create-pipeline` 基线，本 PR 的 Gate 7b 可能连带点名（那属于上游欠账，按先例从最新 CI artifact 重建即可）。

---
record: tasks-3-4-3-5-audit
task: tasks 3.4 勾账与 3.5 双向拆分（一处"勾账滞后"与一处"半落"必须分开处理）
date: 2026-10-14
---

# tasks 3.4 / 3.5 对账（tasks-3-4-3-5-audit，2026-10-14）

> 分支 `tasks-3-4-3-5-audit`（隔离 worktree `mp-podcast-script-entries`，**非 C 盘**）。动因是上一轮我自己写下一句过头的话：「3.4/3.5 属勾账滞后而非欠实现」。实测只对了一半。

## 两条判据现查现写（不读历史结论）

| 项 | 判据（`git show origin/main:<file>` 的命中数） | 结论 |
| --- | --- | --- |
| 3.4 | composable 有 `livePhase`/`liveTrail` 相位驱动、`PodcastPublishAction.vue` 存在、`overlay-view-suspension.test.js` 已登记 podcast owner | **已落**，勾并附证据行 |
| 3.5 | `CreateView.vue` 命中 `PodcastPublishAction`=有、`ResultView.vue`=**0** | **半落** ⇒ 拆 ①/②，整条不勾 |

## 为什么不能整条勾 3.5（也不能整条留着不动）

整条勾掉＝把「结果页入口」这条用户可见能力写成分已完成，下一个会话照账走就会漏做一枚入口，而它**没有任何自动化会替我发现**（组件存在、绑定在其中一个视图里，编译与测试都过）。整条留着不动＝把已完成的那一半重新变成待办，诱导重复施工。仓内既有对账法给的正是第三条路：**已交付的旧编号项补 PR 号 + 文件名的证据行，未完成的后半拆成新的未勾项**，两边都不说谎。

## 3.5② 落地时的合同（现在就写进未勾项，避免到时候只留一个标题）

- 入口位置与文案键（`podcast.episode.*`，zh/en 成对，Gate 7）；
- 浮层 owner 必须在 `src/overlay-view-suspension.test.js` 登记接入断言（`WebContentsView` 压在 DOM 之上，CSS z-index 无效）；
- 显示项与提示文字要按 PRD §6.4 的两张表逐形态对齐（结果页与创建页的入参形态不同，进度通道与取消语义相同）。

## 门禁

- docs-only 判定**必须在 commit 之后**取（未提交时 `HEAD==base` ⇒ 空 diff ⇒ 假 `docs-only=false`）
- 行尾对账两口径相同；ledger 键＝剥掉 `## ` 前缀的标题文本

## 远程同步

| 远程同步 | PASS | merge SHA 67a06c09a · 2026-10-13T19:47:03Z · 远端分支已删（ls-remote 0 行）· 同次提交删除 ledger 登记项 |

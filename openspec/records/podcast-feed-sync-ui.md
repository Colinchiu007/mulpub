---
record: podcast-feed-sync-ui
task: 关闭刀 2 复核留下的 over-claim——把 feedSync 的读侧接到界面（channel:get 带段 + 横幅 + 只重试上传 feed）
date: 2026-10-11
sync_reason: 待 PR 合并后按产物取证（state=MERGED + mergeCommit.oid、远端分支 0 行、git log 恰好 1 行、比树为空）并就地回填
sync_backfill_owner: podcast-feed-sync-ui 分支作者（本会话）
---

# 本次执行记录：播客 feedSync 读侧接线（podcast-feed-sync-ui，2026-10-11）

> 分支：`podcast-feed-sync-ui`（隔离 worktree `D:\Data\projects\mp-worktrees\mp-podcast-feed-sync-ui`，**非 C 盘**）；共享根保持 `main` 且未被本会话改动。
> 范围：🛠 运行时代码 ⇒ 完整质量节拍；`classify-docs-only.js` 判 false（混合 PR）。

## 提交构成（origin/main..HEAD）

| SHA | 内容 |
| --- | --- |
| （本次代码提交） | `channel:get` 带 `feedSync`、`usePodcastChannel` 存状态、`PodcastHostingCard` 横幅 + 重试、`PodcastChannelView` 传真源并在发布两条出口重读；locales 三条成对键；信封/卡片/父级 7 条用例 |
| （本次文档提交） | PRD §8 显示项与 §13 第 9 条、spec Requirement + Scenario、tasks 3.6 拆 3.6a/3.6b、CHANGELOG、本记录与 `.quality-gates.md` 顶部记录及 ledger 登记 |

## 关键判断（为什么这么修，不是改了什么）

1. **over-claim 要么兑现要么改措辞，不能留在文档里**：刀 2 的复核发现「写了 feedSync 就宣称用户看得见」。本片选择**兑现**，因为读侧的输入已经在真源里，缺的只是一个键和一个判据；把它改成「界面不显示」反而要让 §8 一整段退回。**但兑现的方式受原判据约束**：重试必须复用 `podcast:feed:publish` 那一条发布路径，不能在横幅里再拼一套「重建 + 上传」。
2. **null 与「缺席」不是一回事，且都不等于 success**：主进程不带 `feedSync` 键（旧版产物、或有人改动 handler）时，渲染层要按缺席处理（不显示），而不是给一个默认值。造 `success` 就是把「读侧又断了」演成「一切正常」——正是本片要消灭的那类谎。
3. **形状破坏不喊**：`feedSync` 声明为 Object，但真源可能被别的写者污染（字符串、未知 status）。横幅只在 `failed`/`partial` 出现，其余一律不显示：一条假的「未同步」提示会让用户反复点重试并真的覆盖公网对象。
4. **发布后两条出口都要重读真源**：`writeFeedSync` 在成功与失败两支都写了盘，只刷配额与列表会让横幅停在旧状态——用户会以为重试没生效再点一次。

## 远程同步

| 远程同步 | PENDING | 待 PR 合并后回填 `PASS` + merge SHA（取证：`gh pr view <n> --json state,mergeCommit`、`git log origin/main --grep="(#<n>)$" --format=%H|%cI`、`git ls-remote --heads origin podcast-feed-sync-ui` 0 行、squash 后比树为空），并在同一次提交删除 frontmatter 两个 sync_* 字段与 ledger 登记项 |


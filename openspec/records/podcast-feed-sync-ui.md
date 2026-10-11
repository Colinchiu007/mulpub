---
record: podcast-feed-sync-ui
task: 关闭刀 2 复核留下的 over-claim——把 feedSync 的读侧接到界面（channel:get 带段 + 横幅 + 只重试上传 feed）
date: 2026-10-11
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

## 增量处置（QM-6 双模型评审后，2026-10-11）

- **后端（claude，session `154c9028-7030-45e0-aecc-68371f61b11c`）**：无 Critical；2 Warning（① 切频道不清 `feedSync`；② spec/PRD 的 `feedSync.result` 与代码/横幅的 `status` 两名指同一份数据）+ 3 Info（`partial` 分支不可达、locale 键无死键、发布完成后按活动频道重读）。前两条 Warning 与两条 Info 已处置，第三条记为刀 3 边界。
- **前端（opencode，session `ses_ed7c407adffeEzmyBmY7yVs3KY`）**：1 Critical（切频道后 `feedSync` 残留 → 横幅挂在 B 名下而重试按 B 出站，属不可逆外发写）+ 3 Warning（三面重复文案、按钮文案名实不符、读侧接线只有源码字符串断言）+ 1 Info（`partial` 死分支与 spec 键漂移）。Critical/Warning/Info 全部处置。
- **评审暴露出的更大事实**：追 Critical 时发现 `switchChannel` 自刀 1 起就是**必然抛错**的死函数（引用了本模块作用域不存在的页面域标识符，且它自己声明的 `onChannelActivated` 回调从未被调用）。全仓 0 条用例引用 `switchChannel` ⇒ 单元/集成/视觉/审查四层同时失明。修复 + 5 条回归锁 + QM-5 五步产出物见 `01-docs/BUGFIX-PODCAST-CHANNEL-SWITCH-2026-10-11.md`。
- **刻意不做**：toast 与卡片内联渲染同一句 `podcast.hosting.publishFailed` 的重复（前端评审 #2）——该重复早于本片存在，收敛点在刀 3 的发布状态机（要同时改 toast 语义与相位文案），判据已写进 PRD §8。
- **刀 3 边界（本片未闭合，不是遗漏）**：① 发布完成后的重读取「完成时刻的活动频道」，定向按被发布的 `channelId` 重读要等那一刀的发布状态机；② `partial` 目前是被声明的预留（spec reserved 标记 + 三向对账锁），刀 3 真正写入时必须同 PR 把该值从标记里删掉；③ 崩溃/退出中断对账（3.6b）。

## 远程同步

| 远程同步 | PASS | PR #3286 squash 合并为 `cd7bc476e70c4ee9c26207a1f7dc726940ab0e2c`（2026-10-11T09:10:58+08:00），远端分支已删（ls-remote 0 行） |


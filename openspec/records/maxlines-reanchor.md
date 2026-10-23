---
record: maxlines-reanchor
task: 允许同一个 PR 在自己的 diff 里重锚 targets，不再把主干红甩给下一个会话
date: 2026-10-23
---

# targets 零增长：把「合法增长」和「偷偷膨胀」分开

## 1. 问题（2026-10-23 实测）

`#4276` 给 `rpa-view-platforms.js` 加了「先点添加视频再上传」的分支（+13 行），越过 `targets` 里 1484 的还账目标。结果：

- `main` 的 `债务熔断检查` 红；
- **所有 open PR 被判 `STOP_MAIN_RED`（rc=2）**，包括已经全绿的 #4328（`newRed=0`）；
- 最后由**无关会话**开 #4329 上调目标才修好。

也就是说：**谁引入，谁不负责；谁碰上，谁背锅。**

根因不是「零增长容差」本身，而是它把两件事判成同一件：
- 合法功能增长（文件确实变长了，目标该跟着走）
- 偷偷放宽（文件没涨，目标却往上调，白送免涨额度）

## 2. 改法

允许**同一个 PR 在自己的 diff 里**上调 `targets`，但只允许**恰好锚定当前行数**。三条新判据，且只在**本 PR 改了 targets** 时触发（无关 PR 不受影响）：

| 判据 | 触发条件 | 含义 |
|---|---|---|
| `TARGET_BUMP_UNJUSTIFIED` | 上调了目标，但文件当前行数并未超过原目标 | 没有增长可解释这次上调 |
| `TARGET_BUMP_HEADROOM` | 新目标 ≠ 当前行数 | 高出来的部分就是白送的免涨额度 |
| `TARGET_REMOVED` | 删掉某个 target | 等于永久解除零增长约束 |

下调目标（还债）永远允许。

**base 从哪来**：`git show origin/main:.github/scripts/max-lines-baseline.json`（debt workflow 是 `fetch-depth: 0`，可取）。
取不到时：GitHub Actions 内 **fail-closed**（`TARGET_BASE_UNAVAILABLE`），本地只提示 —— 静默跳过等于给「偷偷放宽」开一条无人守门的通道。
`--baseline` 覆盖（测试夹具）不读 base，因为夹具基线在 base 提交里不存在同名文件。

## 3. 判据

`check-max-lines.test.js` 新增 6 条：合法上调 / 无增长支撑 / 留额度 / 删目标 / 无关 PR 不受影响 / 只降不升。

**A/B 实测**：未改动源码跑同一测试 = **38 pass / 5 fail**（环境相关既有失败）；改动后 = **41 pass / 2 fail**，新增 6 条全绿，失败数反而下降。

## 4. 踩坑记录

`[System.IO.File]::AppendAllText` 用相对路径时按 **.NET 进程 CWD** 解析，第一次把测试块写进了**共享根**而不是 worktree（AGENTS 已记过这条，我仍踩了）。已 `git checkout --` 恢复，共享根 `status=0`。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
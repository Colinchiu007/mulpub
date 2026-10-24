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

### 补：base 的取法（2026-10-23，CI 当场抓出）

上面那句「2 fail」里有一条**不是环境问题，是本片自己造成的**：
`evaluate` 多了第 5 个参数（baseInfo）⇒ 没传 baseInfo 的既有用例会多收到一条
「本地无 base 基线」的 notice ⇒ `回归②墓碑` 那条断言 `notices.length === 1` 红了。
已把该断言改成「集合里有 LEDGER_RESURRECTED 那条」而不是「它在第 0 位」
（后者等于把 notice 的排列顺序钉死，而新判据本来就会往最前面插自己的提示）。
**修完 47 pass / 0 fail。**

更要紧的是**base 在 CI 里根本取不到**，本片那三条判据一条也点不着火：

```
❌ TARGET_BASE_UNAVAILABLE: 取不到 base 的 targets 基线，无法校验本次是否在放宽零增长约束（CI 内 fail-closed）
```

根因：`readBaseTargets` 只认 `origin/main`，而 CI 的 `actions/checkout@v4` 默认
`fetch-depth: 1` ⇒ runner 上**既没有 `origin/main` 的远程跟踪 ref、也没有父提交**
⇒ `git show origin/main:...` 必然失败 ⇒ fail-closed 规则**恒红**。
本机同一条命令 rc=0 —— 差的就是这一个 ref（**同一个现象两台机器两个结论，先怀疑取数那一侧**）。

修法三处：

| 落点 | 改法 |
|---|---|
| `.github/scripts/check-max-lines.js` | `readBaseTargets` 改候选链：`MP_BASE_REF` → `origin/main` → `HEAD^1` → `HEAD^`；全落空才返回 null（fail-closed 不变） |
| `.github/workflows/debt-guard.yml` | checkout 加 `fetch-depth: 0`（否则连父提交都没有）；并按仓内既有口径算 **merge-base** 传入 `MP_BASE_REF`（与 quality-gate.yml 的 Gate 2c3 同族：base 必须取 merge-base，不能直接取 origin/main） |
| `check-max-lines.test.js` | 新增 3 条把「取法」本身钉住：显式 base 优先 / 给的 ref 取不到时回落到 HEAD^（CI 形态）/ 四条候选全落空才返回 null |

`HEAD^1` 与 `HEAD^` 在非 merge 提交下指向同一个提交（git 的别名）⇒ 用例断言**内容**
（读到的必须是 base 那份基线），不断言落在哪个别名上 —— 断言别名等于把实现细节钉死。

## 4. 踩坑记录

`[System.IO.File]::AppendAllText` 用相对路径时按 **.NET 进程 CWD** 解析，第一次把测试块写进了**共享根**而不是 worktree（AGENTS 已记过这条，我仍踩了）。已 `git checkout --` 恢复，共享根 `status=0`。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
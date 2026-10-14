---
record: podcast-prd-compliance-wording
task: 播客 §8.2 compliance 合同措辞写回实测取值面
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（三形态同改：表格行 + bullet + 删本段三字段 + 删 ledger 登记项，同一次提交）
---

## 本次执行记录：播客 §8.2 compliance 合同措辞写回实测取值面（podcast-prd-compliance-wording，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（commit 后取现值）。
- 变更类型与隔离：纯规格/文档变更，不改运行行为；隔离 worktree `D:/Data/projects/mp-worktrees/mp-prd-compliance-wording`，分支裸名 `podcast-prd-compliance-wording`，基线 `cc6a4f988`（= 当时的 `origin/main`）。

### 为什么没在共享根就地编辑（并发铁律的一次现场应用）

开工前 `git status --porcelain` 在共享根给出两条**已暂存**条目：`A .ccg/reviews/478a1f5476840….json`（23 行）与 `M .quality-gates.md`（11 行，内容是「回填 #3543 远程同步 PASS」的记录块）。AGENTS.md 的 docs-only 流程要求「本地 main commit → `git branch` 保住 → `git reset --keep origin/main` → 推分支开 PR」，而这条路会直接动别人的 index；`scripts/start-mp-task.ps1` 的严格入口又先跑 `mp-worktree-health.ps1 -RequireClean -RequirePrimary`，脏 index 必拒。两者都不该由本片去消解（前者是他人 in-flight 工作，后者是守门条件本身），所以选择**新建隔离 worktree 承载这笔文档 PR**：加性、可经 `scripts/safe-worktree-remove.ps1` 回收、共享根零改动。

### 合同里不可满足的那一对（本 PR 的实际修复对象）

| 条款 | 原话 | 实测 |
| --- | --- | --- |
| §8.2.2 | `reasons` 每项是「领域码（`PODCAST_*` 一族）」 | `validateEpisode` 产出 `EPISODE_*` 族，无 `PODCAST_` 前缀 |
| §8.2.6 锁2 | 码表取 `podcast-error-codes.test.js` 那份清单 | 该文件 harvest 正则 `/['"](PODCAST_[A-Z0-9_]+)['"]/g`（`:68`）+ `PRODUCERS` 12 项全在 `apps/desktop/`（`:21-39`），对 `packages/shared-utils` 的校验器**双重失明** |
| §8.2.6 锁5 | `reasons` 必须来自 `validateEpisode` 的 `issues[].code` | 与锁2 同时成立只能是「清单里没有这些码，也没人管它们有没有文案」 |

两条退路都否掉：把锁2 弱化成「reasons 是非空字符串」＝对「有码无文案」完全失明（本仓记过多次的装饰性门禁）；给 RSS 层的码统一加 `PODCAST_` 前缀＝连带改 98 个 locale 键、`issueText()` 取键方式与 §6.3 已合并的 `PODCAST_FEED_INVALID` 透传合同。

### 实测取值面（数字来源，可重跑）

- 重跑：`node D:/Temp/measure-episode-code-coverage.cjs`（文件级差集）、`node D:/Temp/extract-validate-episode-codes.cjs`（逐字提取函数体，终点取函数自己的顶层闭合括号，不用「下一个函数名」当脆弱锚点）。
- `packages/shared-utils/src/podcast-rss.js` 全大写码字面量 **53** 条：`CHANNEL_*` 21、`EPISODE_*` 20、`ENCLOSURE_*` 5、`FEED_*` 3、`EPISODES_*` 2、`DURATION_MISSING` 1、`PODCAST_FEED_INVALID` 1。
- `apps/desktop/src/locales/podcast/{zh,en}.js` 的 `errors` 键 **zh 98 / en 98**，与上述 53 条求差集 → **缺文案 0 条**。这是新措辞敢把「每条 `reason` 必须取得到文案」写成硬锁的前提。
- `validateEpisode`（`:136-169`）逐期重跑实际可产出 **19** 条：函数体内直接 `issue(...)` 16 条 + 经 `resolveEnclosure`（`:124-133`）由 `:152` 转推 3 条（`EPISODE_AUDIO_REQUIRED` / `EPISODE_AUDIO_NOT_HTTPS` / `EPISODE_HOSTING_NOT_CONFIGURED`）。`EPISODE_DUPLICATE` 出自 `validateEpisodeList`（`:171+`），属列表级，**不在**逐期取值面。

### 本 PR 明确不做

- 不做实现：`compliance` 的组装、四态闭集、七条回归锁全部属下一片（tasks 4.4b②），落在 `mp-podcast-episode-compliance`。
- 不加 locale 键：四个 `podcast.compliance.*` 在渲染层还没有消费者，先加就是 AGENTS.md 禁止的死键，随 UI 片同 PR 落。
- 不改 `podcast-error-codes.test.js`：扩域是实现片的事，本 PR 只把它写成合同要求（锁5），代码与合同不在同一笔里混改。
- 不动 `openspec-sync-check.js` 报红的那些历史 `.ccg/tasks/archive/**` 产物（非本 PR 引入，也不属文档同步判据的承重项）。

## 远程同步

| 远程同步 | PENDING | 待本 PR 合并后由后续 docs PR 回填 merge SHA 并销账 |

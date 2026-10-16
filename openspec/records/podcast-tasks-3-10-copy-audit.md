---
record: podcast-tasks-3-10-copy-audit
task: 把 tasks 3.10 从"看着没做"对账成"已交付并勾账"，并把勾账门槛从"键存在"升级成"键被消费（字面 ∪ 动态）"
date: 2026-10-16
sync_status: PENDING
sync_reason: 本 PR 合并后由后续 docs PR 回填 merge SHA 与时间，并在同一次提交删除本文件 frontmatter 的 sync_* 三字段
sync_backfill_owner: agent 收尾链（回填 = 合并后第一笔 docs PR）
---

# tasks 3.10 文案键对账（podcast-tasks-3-10-copy-audit，2026-10-16）

> 分支 `podcast-tasks-3-10-copy-audit`（worktree `mp-podcast-episodes-dir-unreadable`，非 C 盘，起点 origin/main `8a023cdcb`）。docs-only：未动 locales、未动运行时代码。
> 载体冻结已生效 ⇒ **未写** `.quality-gates.md`、**未加** ledger 键，记录只落本篇。

## 一、结论：勾账滞后，不是欠实现

3.10 一直挂着未勾，读起来像"第 4 片欠一堆文案键没写"。逐字实测三条全部相反：

- §6.4 声明 `podcast.episode.*` **25** 个键；zh 25、en 25，**双向差集为空**、成对无破口。
- 9 个 `podcast.errors.PODCAST_*` 码在 zh/en 的 `errors` 块**逐个在位**，且逐个都能在 `apps/desktop/electron` / `packages` / `apps/desktop/src` 找到生产或引用面（9/9）。
- 判定性的一条不是"有没有键"而是"有没有人用"：**两种消费形态都不沾的键数 = 0** ⇒ 不是 AGENTS.md 禁止的死键。

第 4 片（PR #3376）真正缺的是出期编排链与它的打包/评审证据，不是这把键。

## 二、判据本体的首轮误判与更正（这条是本片的主要内容）

第一版判据只认字面 `podcast.episode.<key>`，读数 `未引用=5`：`audioDegraded` / `extractFailed` / `encoderMissing` / `measureFailed` / `feedBuildFailed`，当场按 fail-closed 停手没勾账。停手是对的，但结论错了——这 5 个键的真实消费形态是**动态建键**：

```js
// apps/desktop/src/composables/usePodcastEpisodePublish.js:63-75
export const EPISODE_COPY_KEYS = Object.freeze({
  PODCAST_AUDIO_DEGRADED_SOURCE: 'audioDegraded',
  ...
  PODCAST_FEED_BUILD_FAILED: 'feedBuildFailed',
})
// :186 同一出口
if (key) return i18n.global.t(`podcast.episode.${key}`)
```

码 → 键的映射把键名放进了**变量**，字面串因此在源码里不存在。判据必须按"这条链能不能到达 `t()`"来量，而不是按"源码里有没有这个字符串"。更正版口径三条，缺一不可：

1. **字面集 A**：`git grep -o 'podcast\.episode\.[A-Za-z0-9_]*' -- apps/desktop/src`。
2. **动态集 B**：`EPISODE_COPY_KEYS` 的映射值 ∪ `episodeCopyKeyFor` 直接 `return` 的字面量，且**前提是同一文件里存在动态出口** `t(\`podcast.episode.${)`；该出口一旦不存在，脚本**抛错停手**而不是退回只算 A（否则"链已断"会被读成"全都消费"，正好是假绿的方向）。
3. **判据自证**：A 与 B 都不得吞掉全集（否则"未消费=0"没有区分力）；哨兵键 `__mp_probe__` 必须不属于两者。首轮实测 `字面引用=20 仅动态消费=5 未消费=0`，负控通过。

顺带一条同源提醒：`episodeCopyKeyFor` 里 `encoderBroken` 是按 `stage === 'encoders'` 分支 return 的，属于 B 的第二个来源；只解析映射表会漏掉它（实测该键也确在 zh/en 里）。

## 三、质量节拍自检

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | docs-only；D 盘独立 worktree，共享根未被用作 cwd（他方已 staged 条目会被普通 `git commit` 收走） |
| 对账判据（本片本体） | PASS | `25 = 20 字面 + 5 动态`、`未消费=0`、`zhOnly=0 enOnly=0`、9 码 `缺文案=0 / 有生产或引用面=9/9`；任一不成立即抛错不勾 |
| 判据负控 | PASS | A/B 规模均小于键总数、哨兵不命中；动态出口缺失改为抛错（不是静默降档） |
| 行尾与 diff 对账 | PASS | 勾行继承该行自身行尾；提交前 `--cached --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径必须逐字相等 |
| 载体冻结合规 | PASS | 旧载体与 ledger 未出现在 diff（按路径 `git diff --name-only` 核），记录只写 openspec/records |
| QM-1 / QM-4 / TDD | N/A | 未触运行时代码与 locales |
| QM-6 双模型外部评审 | 未执行 | 纯文档对账片按 AGENTS 不强制；如实登记，不自扮演豁免 |
| 远程同步 | PENDING | 本 PR 合并后由后续 docs PR 回填 |

## 四、遗留（不假装已闭合）

- 对账脚本在 `D:/Temp/probe-310-consume.cjs` 与驱动 `D:/Temp/tick-310b.cjs`，**未入库**（一次性工具）。要把"勾账前先验消费面（含动态形态）"变成常设判据，属新增门禁本体，需单独一刀并交人工过目。
- **动态消费的判据是启发式**：它认的是"同一文件内存在映射表值 + 动态出口"。若将来映射表与 `t()` 分处两个文件，B 集会算少并触发停手（fail-closed 方向，可接受），但不会算多（假绿方向）。这一点要写清，免得下个人以为它做过数据流分析。
- 3.11 / 3.12 与 3.10 无关，仍按原样未勾。
- **本片已提交并推分支，但故意没开 PR**（2026-10-16 现场）：主干上 `scripts/check-gate-record-debt.js` 当场 rc=1，红因是 `carrierDrift`——冻结基线 607 条 / sha `636b6e82cdf8…`，现状 613 条 / sha `27eebfa9ff6c…`，多出的 **6 个块全是已合并的上游 PR** 留下的旧载体记录，没有任何人违规。该判据**在 PR 档与 main 档都拦**（只有「状态相等」判据分档），所以此刻开 PR 只会红在别人的漂移上，属 AGENTS「既有失败不认领」且不能自动合并。
  归属已明确：**PR #3694**（分支 `bf-3672`）正是"回填 #3672 + 销账 + 冻结基线第四次重取（607→613）"，本机实测它 `QG Changes=pass`（合并预览里基线已重取）、`mergeable=MERGEABLE`、`autoMergeRequest=null` —— 它本身属「改谁来守门」，**等人工过目**，不得代开、不得代合。
  **下一步的唯一正解**：#3694 进主干后，把 `podcast-tasks-3-10-copy-audit` rebase 到新 main（`git rebase` 不跑 pre-commit，秒级；不要用重放 commit，那会触发 23–40 分钟的钩子），再开 PR。若届时要重放提交，推之前必须断言 `rev-list --count origin/main..HEAD > 0`——本仓实测把分支推成空 diff 会让 PR 自己关闭。
  **禁止的处置**：为让 Gate 2c 变绿去改 `scripts/gate-carrier-freeze.json`（那是 #3694 已占的动作，重复即互相覆盖），或放宽/挂起 `carrierDrift`，或按出路①把上游 6 个已合并的块改写成 openspec/records —— 那等于替别人已合并的 PR 改写载体，无此资格。

## 远程同步

| 远程同步 | PENDING | 本 PR（podcast-tasks-3-10-copy-audit）合并后由后续 docs PR 回填 merge SHA 与时间，并在同一次提交删除本文件 frontmatter 的 sync_* 三字段 |

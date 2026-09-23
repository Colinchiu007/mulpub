# 逐文件行数门禁的「逃逸」复盘与运维手册（audit 收尾，2026-09-23）

关联：`01-docs/PRD.md`「全仓代码体检整改」第八/九/十二节；`.github/scripts/check-max-lines.js`；
`.github/workflows/debt-guard.yml`；上一批拆组件 PR #2274（`63ff037446`）。

## 1. 症状

同一条僵尸挂账条目 `apps/desktop/src/components/LogsSettings.vue: 598` 在一天内**复发 3 次**，
每次都让 `origin/main` 处于门禁违规态，并把在飞的所有 PR（含 docs-only）在
required check「债务熔断检查」上判红：

```
❌ STALE_LEDGER_ENTRY: apps/desktop/src/components/LogsSettings.vue 已不在扫描结果中
   （文件已删/改名/移出受管目录），请 --update 清账
limit=500 growthAllowance=200 超限文件=99 挂账=100
```

而 `LogsSettings.vue` 当时是 469 行、文件好好在那里 —— **提示语把「债已还」误报成「文件没了」**，
并建议一个会伤及他人的动作（整份 `--update`）。

## 2. 根因链（全部有 git 证据）

| 时刻 | 事件 | 证据 |
|---|---|---|
| 02:24:30Z | #2252 落地逐文件行数门禁（0 条存量违规） | `9a48af8938` |
| 02:30:10Z | #2262 给 `LogsSettings.vue` 加「缓存清理」卡片 473 → 598；其 CI 跑在门禁落地之前，无人拦截；同 PR 把聚合基线 `filesOver500` 99 `--update` 到 100 | `14f71f4cc4` |
| 之后 | 每个 PR 的 merge-preview 红在这条无关项上（`pull_request` 检出的是与 base 合并后的树） | #2270 复盘 PR 被卡 |
| 第二次开门 | #2249 用一次整份 `--update` 把 `LogsSettings.vue: 598` 登记进逐文件清单让 CI 过关 —— 把「新增超限必须拆」实质变成「挂个账就能长期停在这个体量」；该键插入位置也不满足 `--update` 的字典序产物（第 9 行夹在 `ipc-handlers/*` 之间），说明是手工解冲突的产物 | `89682d9ed4`、`git log -S` |
| 还债 | #2274 拆组件到 469 行 + 外科式删除该单键（diff `-1/+0`） | `63ff037446` |
| 第三次复发 | #2264（切自 #2274 之前）合并时**又把这个键带回 main**：`git show --numstat 7d6bc83ed5 -- .github/scripts/max-lines-baseline.json` = `1 insertion / 0 deletion` | `7d6bc83ed5` |

两处设计缺陷（不是运气问题）：

1. **死代码 + 危险处方**：`collectOverLimit()` 只返回 `lines >= limit` 的文件，
   所以「已降到 limit 以下 → 债务已还」这条分支在生产路径永远不可能命中；已还债文件落到上一分支，
   被误判为「文件已删/改名」并统一建议 `--update`（整份重写 → 顺手吸收别人的存量漂移）。
2. **状态型门禁只在 `pull_request` 上跑必然逃逸**：断言对象是「全仓当前状态」，但 PR 上下文里
   base 已被合并覆盖，main 自身违规无人显红；同时**共享 JSON 的行级三方合并无法表达**
   「这个键已被判定为已还清」，于是并发分支可以无声地把删掉的键带回。

测试层面的共犯：原用例直接 `evaluate(base, {file: 320})`，人造出 `main()` 永远产不出的输入形状，
于是「已还债」断言长期绿灯，掩盖了第 1 条缺陷。

## 3. 本次改动

| 层 | 改动 |
|---|---|
| 判定 | `evaluate(baseline, scanned, existing)` 新增第三参（全量 `scanAllLines()`），据此区分「文件真没了」与「债已还」 |
| 语义 | 新码 `DEBT_REPAID_LEDGER`（阻断）；非阻断提示 `LEDGER_RESURRECTED`；`STALE_LEDGER_ENTRY` 只用于真·账目腐烂；三者处方统一为 `--prune <路径>`，明文禁止整份 `--update` |
| 墓碑 | 清单新增 `pruned`：① 命中即取消同路径挂账豁免（重新超限按 `NEW_OVER_LIMIT` 阻断）；② 已知复活降级为 ⚠️，不参与退出码 |
| 命令 | 新增 `--prune <路径>`（单键、fail-closed、幂等）；`--update` 收紧为增量（不抬已有值、不删键、不覆盖 `pruned`）；全量重生需显式 `--update --rewrite` |
| CI | `debt-guard.yml` 的 `on:` 增加 `push: branches: [main]`；required check 名与「不得生效 paths-ignore」两条约束由用例锁定 |
| 数据 | `--prune` 掉第三次复发的僵尸条目，立碑 `469`；`files` 100 → 99 |

## 4. 运维手册

**Q1 CI 报 `DEBT_REPAID_LEDGER`（我把大文件拆小了）**
```bash
node .github/scripts/check-max-lines.js --prune <仓内相对路径>   # 例：apps/desktop/src/components/LogsSettings.vue
```
把产出的单键 diff 与代码改动一起提交。**不要**跑 `--update`。

**Q2 CI 报 `STALE_LEDGER_ENTRY`（文件确实删了/改名/移出受管目录）**
同样用 `--prune <旧路径>`；若该文件是被改名替代，新文件若超限必须真拆（新路径无挂账 → `NEW_OVER_LIMIT`）。

**Q3 看到 `⚠️ LEDGER_RESURRECTED`**
说明有人把已还清的条目带回清单（通常是切自还债 PR 之前的分支合并所致）。**不阻塞、不影响退出码**；
在你因别的原因触碰该清单时顺手 `--prune` 掉即可。不要为了消掉提示去改门禁阈值。

**Q4 需要登记一批新的存量超限文件**
`node .github/scripts/check-max-lines.js --update` 只加不改不删，会明确打印它**拒绝**抬高的
（`⚠️ 拒绝抬高 K 个已有登记值`）与**不会**删除的（`⚠️ 不会静默删账 R 条`）条目。
只有 `--update --rewrite` 才全量重生；该命令会重排键、掩盖别人的漂移，必须人工逐行审 diff，
且需要有明确授权（这是历史上两次「开门」用到的动作）。

**Q5 门禁在 main 上显红了**
自本次起 `push: branches: [main]` 会让这种情况在 5 分钟内被看见（此前只有别人开 PR 才暴露）。
处置顺序：看 ❌ 前缀分类 → Q1/Q2 的 `--prune` → 若为 `NEW_OVER_LIMIT` 则拆文件，不放宽阈值。

## 5. 不变量与回归保护

1. 墓碑取消挂账豁免 —— `回归③`（变异自证：改回「僵尸条目仍算豁免」即转红）。
2. 已知复活不阻断链条 —— `回归②`。
3. 「已还债」分支在生产路径可达 —— `回归①`（`collectOverLimit` + `scanAllLines` 真实组合喂入）。
4. 清账只能单键、可拒、幂等 —— `回归⑤⑥`。
5. `--update` 无法悄悄抬高/删改他人登记值 —— `回归⑦`（变异自证：插一行「顺手抬基线」即转红）。
6. workflow 必须 `pull_request` + `push` 双触发、无生效 `paths-ignore`、required check 名不变 —— 读文本断言。

本地复跑：
```bash
node .github/scripts/check-max-lines.js
node --test .github/scripts/check-max-lines.test.js
node scripts/check-debt-budget.js
```

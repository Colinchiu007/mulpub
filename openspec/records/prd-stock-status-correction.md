---
record: prd-stock-status-correction
task: 更正 PRD §7.9.7 的过期陈述「宿主接线未做」，使主干文档与 #3387 已合并的事实一致
date: 2026-10-14
---

# 更正 PRD §7.9.7 的过期陈述（prd-stock-status-correction，2026-10-14）

> 分支 `prd-stock-status-correction`（隔离 worktree `mp-podcast-script-entries`，**非 C 盘**）。动因：#3387（merge SHA `8bd87f385`，2026-10-13T18:54:27Z）落了 4.4b 的 ①，而 §7.9.7 那句「宿主接线未做」还留在主干 PRD 里——**它现在是假的**。

## 为什么单独开这一片

PRD 是「先文档再代码」前置门的读源。合并动作本身已正确落盘（判据取产物：`state=MERGED` + `mergeCommit.oid`、`git log origin/main --grep` 恰好 1 行、`ls-remote` 0 行），但**合并不会自动改写规格**。留着过期句的后果不是排版问题，是下一个会话照着一份说「宿主没接线」的 PRD 再去接一遍，或把 4.4b① 再落一次。同型既有教训：手工维护的文案表会被后续改词打旧（实测 135 条里曾有 89 条逐字值对不上）。

## 改法与为什么不删原文

① **不删**原句：只把引导词换成「（2026-10-12 的现场，其中「宿主接线未做」已被上面那条更正）」，并在其**之前**插一条带日期与 merge SHA 的更正行。删掉历史陈述会让后来人以为那句话从未错过，也就看不出 §7.9.7 与 §7.9.5 之间曾有「判据先落、落点后补」的节奏。② 更正行必须同时写清**仍未做的三件**并把「4.4b 父项保持未勾」写进同一句——只报完成不报缺口，等价于把欠账藏进文档。

## 现场口径（更正行里逐条可核）

| 项 | 值 |
| --- | --- |
| 已落 | `podcast-stock-freeze-host.js` 六个出口全注入；`ipc-handlers/podcast.js` 的 `getService` 在首个需要频道数据的调用处触发一次 |
| 幂等 | 进程内恰好一次（同一频道第二次调用 no-op）；`stockStamp` 在位即静默跳过、不写文件、不刷 info 日志 |
| 旁路 | 固化抛错只 `warn` 一次并返回 `null`，不冒泡给读请求；缺 `registry` 或出口不齐即抛，不回落真实 userData 目录 |
| 校验口径 | §7.9.5 不变：重跑必须 `filled=0` 且字节不变；写盘走 tmp + rename 原子替换 |
| 未落 | ② `stock` 档、③ 摘要与 `podcast.stock.*` 三对键 zh/en、④ 落盘型变异反证（M2 曾两次因锚点少写 `extOf(` 没落进文件，如实记为未建立） |

## 判定与门禁

- 判定**必须在 commit 之后**取（未提交时 `HEAD==base` ⇒ 空 diff ⇒ 假 `docs-only=false`）：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`
- `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径必须相同（PRD 工作副本 `i/lf w/crlf`，禁止整份统一回写行尾）
- 本 PR 是**就地改写型**（PRD 那句被改），不是纯追加：丢失行集合必须恰好等于那一处的旧值

## 远程同步

| 远程同步 | PASS | merge SHA 0c41d1c21 · 2026-10-13T19:19:50Z · 远端分支已删（ls-remote 0 行）· 同次提交删除 ledger 登记项 |

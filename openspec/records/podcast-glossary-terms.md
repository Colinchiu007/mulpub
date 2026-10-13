---
record: podcast-glossary-terms
task: 收口播客术语到 01-docs/i18n-glossary.md 并完成三处记忆同步（tasks 5.3）
date: 2026-10-14
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账）
---

# 播客术语收口 + 三处记忆同步（podcast-glossary-terms，2026-10-14）

> 分支 `podcast-glossary-terms`（隔离 worktree `mp-podcast-script-entries`，**非 C 盘**）。落点 = `openspec/changes/podcast-oneclick-publish/tasks.md` 的 5.3。

## 判据为什么先要量一次

`check-locale-sync.js --pair-base` 只判**键级成对**，判不到**术语成对**；词条行由 `apps/desktop/src/i18n/glossary.test.js`（L3）单独守，它的判据实测是「locale 某个**值包含**该字面量」（`v.includes(entry.zh)` / `en` 侧忽略大小写的 `includes`），**不是全等**。上一轮把这一步写成 `出期 → Publish episode` 就是栽在这里：那是**我认为的标准译法**而不是 UI 实际用的串，锁当场红。所以本片先读 `locales/podcast/en.js` 取真实逐字值，再落笔。

## 变更

| zh | en | 机器 ID | 取值出处 |
| --- | --- | --- | --- |
| 出期 | Publish as podcast episode | podcast.episode.entry | `locales/podcast/en.js` 的 `episode.entry` |
| 一键发布 | One-click podcast episode | podcast.episode.title | `locales/podcast/en.js` 的 `episode.title` |

两条都插在既有同域行 `| 单集 | Episode | podcast.episode |` 之后，便于对照；方向按 AGENTS.md：**让 UI 采用 canonical 术语，而不是把词典削到已有裸词**——本片只补条目，**未改任何已上线文案**，因此不触碰 locale 文件、不属运行时代码变更。

## 三处记忆同步（5.3 的另一半）

| 记忆 | 现场 |
| --- | --- |
| 内置记忆 | 新增/改写 4 条并进索引：叠片携带评审前旧副本、5.3 现成判据与逐字取值、4.4 闭合现场指针、回填通用判据 |
| EverOS | `everos cascade status` 实测 `pending=0`、`max==last_processed`、`lag=0`、`done 162→166`（判据取产物三件，不看 rc；另有 7 条 `retryable=FALSE` 是 2026-10-03/04/12 的 episode/atomic_fact 缺 `timestamp`，不属本片产物，如实记为未处置） |
| 仓库文档 | PRD §7.9.7 过期陈述更正（#3514，merge `0c41d1c21`）+ #3382 / #3387 两片执行记录与 tasks 勾账 |

## 门禁

- `pnpm exec vitest run src/i18n/glossary.test.js`（在 `apps/desktop` 下）——**必须实跑为绿**，不得交给 CI 猜
- docs-only：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（**commit 之后**取证）
- 行尾对账：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径相同（逐行保留各自行尾，禁止整份统一回写）
- ledger 键形状：**剥掉 `## ` 前缀的标题文本**（由 debt 门禁「未登记 + 陈旧」双向报错实测给出）

## 远程同步

| 远程同步 | PENDING | 本 PR（podcast-glossary-terms）的远程同步待合并后由后续 docs PR 回填 PASS + merge SHA，并在同一次提交删除 ledger 本条登记项 |

# 本次执行记录：dep-audit-new-advisories 提案（dependency-advisory-cleanup）

| 门禁 | 状态 |
|---|---|
| 变更类型与隔离声明 | 就地编辑 + PR 落地（纯 openspec/ 文档，不进 worktree） |
| docs-only 判定 | 由门禁推导 |
| 品牌残留 | ✅ |
| doc-abs-paths | ✅ |
| 远程同步 | 由门禁推导 |

- 保留门禁：品牌残留 ✅ | doc-abs-paths ✅ | 远程同步 PR #NNNN

## 背景

PR #4341（hifly-voice-subtitle-parity，数字人形象+声音捆绑克隆）代码侧已全部完成，
PR 侧 13 项门禁全绿，但 `依赖漏洞审计` 在 origin/main 上红 ⇒ `check-main-red.js` 判 rc=2
主干红 ⇒ 按 AGENTS 不得合并。

本会话核实了三件事，确认不是 #4341 的责任：
1. `git diff --name-only origin/main HEAD` 无 `package.json` / `pnpm-lock.yaml`
2. 10 条 NEW_ADVISORY 全部指向本仓库长期未刷新的传递依赖（body-parser / fast-uri / undici / electron / zod）
3. rebase 到最新 origin/main 后本地跑 `check-dep-audit.js` 仍 rc=1

## 本会话产出

`openspec/changes/dep-audit-new-advisories/`：
- `proposal.md` —— 门禁机制、10 条公告明细（含本地实测版本）、A/B/C 三级处置建议、三个设计决策、交付顺序
- `tasks.md` —— 可勾选任务清单，含前置确认 / A 级 / C 级 / 收尾验证 / 合并后 / B 级六段

## 关键读数（其他会话可直接引用）

| 项 | 读数 |
|---|---|
| 门禁 workflow | `依赖漏洞审计门禁`（ID `364691268`） |
| 判据 | `node scripts/check-dep-audit.js`（本地可复现） |
| 基线规模 | `advisories` 27 条，`reviewBy: 2026-12-31` |
| 待处理 | 10 条：fast-uri ×4、undici ×3、body-parser ×1、zod ×1、electron ×1 |
| 本地实测版本 | body-parser 1.20.5/2.3.0、zod 4.3.6、electron 43.7.7、undici 7.30.0、fast-uri 3.1.8 |
| 交付顺序 | ① A 级（fast-uri+undici，消 7 条）→ ② C 级（electron 登记，消最后 1 条 high，**此时主干转绿**）→ ③ B 级单独排期 |

## 给负责会话的三条 Open Questions

1. `fast-uri` / `undici` 走 lockfile 刷新还是 `pnpm.overrides`？（传递依赖，前者可能刷不动）
2. `zod` 4.3.6 → 4.6.6 是否已有其他会话在跟？
3. `electron` 登记 `accepted-risk` 时，「复检条件」写什么？（建议：electron-builder 或 ensure-electron.js 下次改动时连带评估）

## CHANGELOG 条目

# docs(openspec): 新增 dep-audit-new-advisories 提案，收敛依赖漏洞审计门禁的 10 条主干红

- 记录 `依赖漏洞审计门禁` 在 origin/main 上的 10 条 `NEW_ADVISORY`（fast-uri ×4、undici ×3、body-parser、zod、electron 各 1），附本地实测版本与影响路径。
- 给出 A/B/C 三级处置建议：A 级（fast-uri + undici，差一个 patch）直接升级；C 级（electron，AGENTS 锁定 43.x）登记 `accepted-risk` 并写清影响面与复检条件；B 级（body-parser + zod）单独排期。
- 明确交付顺序：完成 A 级 + C 级即可让主干转绿，不必等 B 级。
- 附可直接勾选的 tasks.md，含每步验证口径（含「locale 改动必须跑 `src/i18n/i18n.test.js` 而非只跑 `--keys`」这条实测教训）。

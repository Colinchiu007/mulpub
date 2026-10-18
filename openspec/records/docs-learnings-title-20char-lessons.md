---
branch: docs-learnings-title-20char-lessons
type: docs-only
date: 2026-10-18
---

# 补回标题 20 字增量轮的 learnings 教训（docs-only follow-up）

## 背景：这是上一轮汇报里说漏的一处遗漏

PR #3883（热门选题「去发布」标题修复 + 20 字上限 + 实时字数，merge SHA `2a4e03c8d`）收尾时，
我为了让它尽快落地，**放弃了 `01-docs/learnings.md` 的本轮增量段落**：它与 `CHANGELOG.md` 同属
「顶部追加型热点文件」，在「主干每 10–20 分钟合一个 PR + CI 约 45 分钟」的形态下形成 DIRTY 活锁
（rebase 完再推、推完主干又前进、再判冲突），本轮实测连中四轮。

当时的汇报说「内容已完整落在 PRD §15、执行记录、内置记忆、gstack、EverOS 五处」——
**这句不准确**：五处记忆载体里确实都有，但**仓库里的 `learnings.md` 没有**。
而且那段内容当时只存在于 `stash@{0}` 一份副本，一旦 stash 被清理就彻底消失。

本 PR 用上一轮**实测出来的正确插入形态**补回，而不是重蹈顶部插入的覆辙。

## 为什么插在「最后一个一级标题之前」

上一轮在 CHANGELOG 上试过三个位置，逐一被门禁否掉：

| 插入位置 | 结果 |
|---|---|
| 文件顶部 | 与所有并发 PR 同位置插入 ⇒ 必然冲突 ⇒ DIRTY 活锁 |
| 文件绝对末尾 | `changelog-dedup-reconcile` 的 **A2** 判红：它要求 base 每块在 head 有逐字节同源块，插末尾会让**最后一块**的边界提前到我的标题处、字节变样 |
| **最后一个一级标题之前** | ✅ 前面的块尾部不变，最后一块整体后移但内容逐字节不变；且该位置在稳定区，后续 rebase 只会「落后」不会「冲突」 |

`learnings.md` 没有 A2 这类逐字节判据，但为一致性与可预期性，照用同一位置。

## 本次改动

- `01-docs/learnings.md`：+56 行，从 `stash@{0}` 的唯一副本取回后插入（8 个 lesson 小节）。
  取回方式是 `git show 'stash@{0}:01-docs/learnings.md'` 导出到临时文件再按标题边界切段，
  **不凭记忆重写** —— 避免「以为记得内容」而写出版本漂移的第二份。

## 补回的 8 条 lesson

| key | 一句话 |
|---|---|
| `zero-growth-file-extract-before-adding` | 零增长容差不是「不能改」，是改动必须自带还债（含自己上一轮加的新债） |
| `rebase-before-claiming-headroom` | 行数读数必须在 rebase 之后取，否则结论基于过期基线 |
| `label-merge-is-legitimate-for-line-budget` | 模板排版合并是合法省行手段，语义合并不是 |
| `test-migration-not-deletion-when-contract-changes` | 契约变了的用例要迁移改写，不是删掉 |
| `multilevel-fallback-needs-empty-chain-fixture` | 多级回退链必须有一例「前几级全空」的生产形态夹具 |
| `electron-builder-alone-ships-white-screen-package` | `electron-builder` 单独跑会产出启动即白屏的包（asar 无 `dist/`） |
| `deep-review-timeout-not-proportional-to-diff-size` | 深度审查超时与 diff 体量无单调关系，拆 PR 不是解法 |
| `hot-append-surface-put-new-block-at-tail` | 顶部追加型热点文件的插入位选择与三轮实测 |

## 保留门禁读数（docs-only 快通道）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（files=2：`01-docs/learnings.md` + `.ccg/reviews/<sha>.json`，后者同样命中文档白名单）
- ① 变更类型与隔离声明：✅ 纯文档变更，共享主工作区就地编辑，`session-guard.ps1 -Branch main` 声明通过（守卫确认「当前分支 main 与会话声明一致」）
- ② 行尾/编码对账：✅ `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（`56 0`，纯新增零删除）
- ③ 品牌残留：✅ `node scripts/check-no-brand-residue.js` PASS（扫描 10226 个 tracked 文件）
- ④ doc-gate 文档同步：✅ `bash scripts/check-docs-sync.sh --base=main --head=HEAD` PASS（注意：该脚本内部会拼 `origin/$BASE`，故 `--base` 必须传裸分支名 `main`，传 `origin/main` 会得到 `origin/origin/main` 并 fetch 失败 rc=128 —— 这是脚本自身的参数契约，不是判定红）
- Gate 12c 本机绝对路径：✅ `node scripts/check-doc-abs-paths.js --base=origin/main` PASS
- gate-record-debt：✅ `node scripts/check-gate-record-debt.js` OK
- 跳过的门禁（与运行时无关，docs-only 通道豁免）：QM-1 打包、QM-2 代码必检项、QM-4 视觉、TDD、QM-6 双模型评审

## 远程同步

| 远程同步 | 由门禁推导 |

- 远程同步 PR #NNNN（合并后由 `MERGE-LEDGER` 按主干历史推导收口，不手写状态词）

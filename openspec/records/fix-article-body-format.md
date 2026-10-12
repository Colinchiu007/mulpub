---
record: fix-article-body-format
task: 百家号图文正文「整篇一整段」根因修复——新增图文正文承载形态适配单一实现并接入 8 条链
date: 2026-10-12
---

## 本次执行记录：图文正文承载形态适配——百家号「整篇一整段」根因修复（fix-article-body-format，2026-10-12）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 🐛 Bug 修复 + 运行时代码（`packages/api-publish-engine` 8 文件）+ 文档 ⇒ `classify-docs-only` = false（混合 PR）。隔离 worktree `D:\Data\projects\mp-worktrees\mp-fix-article-body-format`（D 盘，非 C 盘）、裸分支 `fix-article-body-format`、基线 `origin/main = c5a355f7d`；共享根保持 main 且本次未在其落盘 |
| 需求边界 | ✅ | 用户三问逐条作答：①正文本身问题 → **否**（源文含 `\n\n`，863/8 换行/5 段）；②传参/形态问题 → **是**（HTML 字段收纯文本）；③其他平台 → 逐平台审计矩阵（1 同类已确认 / 2 同类先例已修 / 6 反向同类已修 / DOM 轨待真机复核），见 `01-docs/PRD-ARTICLE-BODY-FORMAT-2026-10-12.md` §4 |
| 根因取证（QM-5 ①） | ✅ | ①平台产物：11/11 篇公开页正文 `<p>`=0、`<br>`=0、原始换行=0；②源内容：`rewrite_history` 含 `\n\n`；③**逐字节对账**：`源文去掉全部 \n == 平台正文` 为 True（855==855、1235==1235）；④交叉证据：参考产品 `HtmlDocument/RichTextParser` 生成 `<p>`、头条同族字段内部名 `htmlContent`、本仓头条直连与公众号已各有同款 `<p>` 包装 |
| 逃逸链（QM-5 ②） | ✅ | 单测层：`content-formatter.test.js` 无正文形态用例；链级层：`baijiahao-article-chain.test.js` 只 `toContain("content=")`，对「压平」完全免疫；E2E 层：只断言 success/回填 id，无产物结构断言；审查层：PRD §12.1 只写字段名不写承载形态 |
| 系统性漏洞（QM-5 ③） | ✅ | `content-formatter.js` 有「标签风格 / 长度上限」两维、**没有「平台字段承载形态」维**；`AGENTS.md` 的「文本结构断言（MUST）」已成文但新链产物断言默认仍写 `toContain` |
| TDD | ✅ | 先写 18 条新/改断言并实跑**红**（`content-formatter.test.js` 12 例 `hasHtmlTags is not a function` 等；vitest 6 例：douyin-image/B-5/baijiahao×4），再实现，后**绿**（62/62 + 94/94） |
| 回归 | ✅ | 引擎全量 `node scripts/run-tests.js` rc=0（39 个 vitest 文件 / 333 用例 + direct 组全绿）；`content-formatter.test.js` 62/62；定向 vitest 8 文件 94/94 |
| 精确断言 | ✅ | 本层用例一律 `assert.deepStrictEqual` / `toBe` 精确串；含"代码尖括号不误伤"正反两向、空输入不产出空 `<p>`、幂等三项结构不变量 |
| QM-1 打包 | N/A | 未改 `apps/desktop/electron/**`、未改 `packages/rpa-engine/**` ⇒ 触发条件不满足（如实记账，不伪造打包证据） |
| QM-4 视觉 | N/A | 无 UI / locale / 样式改动 |
| QM-6 外部评审 | ✅（后端单模型，如实记账） | `claude -p` 独立评审 **verdict=no_critical**（Critical 0 / Warning 4 / Info 2）：3 条采纳并修（`stripKnownHtmlTags` 死导出、块级闭合缺 `html/body/head`、代码尖括号边界写明），2 条经 `publishMode` 证据核实为「legacy 适配器不在运行路由上」⇒ 不接线并写进 PRD §5.4。逐条见 `openspec/changes/article-body-format/review-response.md`；前端 `opencode` 未产出结构化 findings，**不冒充双模型通过** |
| 预防措施（QM-5 ⑤） | ✅ | `AGENTS.md` QM-2 新增「图文正文承载形态合同」；`PRD-API-PUBLISH-ENGINE.md` §12.1 字段口径更新；新 PRD §14 遗留清单登记三份同族实现收敛与 DOM 轨复核 |
| 远程同步 | PASS | 已合并：PR #3389，merge `2bb7c2b9a82cc1ee7de0a2c0d11e5a579f0e3a4e`（2026-10-12T06:20:32Z，squash）。取证：`git log origin/main --grep='(#3389)

### 遗留（不假装已闭合）

- **DOM 轨 contenteditable 注入未取证**（头条/百家号 DOM 兜底、YouTube/TikTok/微博/小红书/快手编辑器）：`_fillInput` 的 `execCommand('insertText')` 多段文本是否在平台编辑器模型里成段，离屏不可判定 ⇒ 复核 runbook 见 PRD §12.3。
- **同族逻辑仍有三份实现**（desktop `stripHtmlToPlainText`、`wechat-mp-article.toParagraphHtml`/`hasHtmlTags`、rpa-engine 头条直连内联 `<p>` 拼接）：收敛需改 `apps/desktop/electron/**`（触发 QM-1 打包验证）⇒ 拆后续 PR；且前三者宽判据会误伤代码片段（本次已在引擎侧用白名单收窄）。
- **Markdown → HTML 未做**：`# 标题` / `**粗体**` 进 HTML 承载平台仍是字面量（与改造前一致，非本次回归）。
- **远程同步已回填并销账**：PR #3389 = `2bb7c2b9a82cc1ee7de0a2c0d11e5a579f0e3a4e`（2026-10-12T06:20:32Z，squash）；本回填提交与 ledger 登记项删除、`sync_*` 三字段删除在同一次提交发生。
 --format=%H|%cI` 唯一命中；`git ls-remote --heads origin fix-article-body-format` 返回 **0 行**（远端分支已删）；上方三个 `sync_*` 字段已在本回填提交同次删除，`scripts/gate-record-debt-ledger.json` 登记项亦同次删除 |

### 遗留（不假装已闭合）

- **DOM 轨 contenteditable 注入未取证**（头条/百家号 DOM 兜底、YouTube/TikTok/微博/小红书/快手编辑器）：`_fillInput` 的 `execCommand('insertText')` 多段文本是否在平台编辑器模型里成段，离屏不可判定 ⇒ 复核 runbook 见 PRD §12.3。
- **同族逻辑仍有三份实现**（desktop `stripHtmlToPlainText`、`wechat-mp-article.toParagraphHtml`/`hasHtmlTags`、rpa-engine 头条直连内联 `<p>` 拼接）：收敛需改 `apps/desktop/electron/**`（触发 QM-1 打包验证）⇒ 拆后续 PR；且前三者宽判据会误伤代码片段（本次已在引擎侧用白名单收窄）。
- **Markdown → HTML 未做**：`# 标题` / `**粗体**` 进 HTML 承载平台仍是字面量（与改造前一致，非本次回归）。
- **远程同步已回填并销账**：PR #3389 = `2bb7c2b9a82cc1ee7de0a2c0d11e5a579f0e3a4e`（2026-10-12T06:20:32Z，squash）；本回填提交与 ledger 登记项删除、`sync_*` 三字段删除在同一次提交发生。

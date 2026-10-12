# Tasks — article-body-format

> 验收目标：纯文本/多段正文发到**HTML 承载平台**（百家号）时以 `<p>` 表达段落；HTML 正文发到**纯文本承载平台**时不残留标签字面量；判定与转换为单一实现且精确断言锁死。
> 真机边界：平台侧 `<p>` 计数复核（PRD §12.3）未执行前，不得声称端到端已通。

## 1. 复现与根因（QM-5 ①）

- [x] 平台产物取证：11/11 篇百家号公开页正文 `<p>`=0 / `<br>`=0 / 原始换行=0
- [x] 源内容取证：`rewrite_history` 含 `\n\n`（863/8/5 段、1263/28/15 段）
- [x] 逐字节对账：源文去换行 == 平台正文（True ×2）⇒ 只丢换行，无截断/改写
- [x] 交叉证据：参考产品 `HtmlDocument/RichTextParser` 生成 `<p>`；头条同族字段内部名 `htmlContent`
- [x] 同类先例定位：`toutiao-direct-bridge.js:33`、`wechat-mp-article.js`（第二/第三份实现）

## 2. 逃逸链（QM-5 ②）

- 单测层：`content-formatter.test.js` 只覆盖标签/截断/话题，**无正文形态用例** ⇒ 形态回归免疫
- 链级层：`baijiahao-article-chain.test.js` 只断言 `content=` 存在（`toContain`），**断言不到内容结构**
- E2E 层：真实发布有成功率断言，**没有产物内容的结构断言**（publicUrl 只做 id 回填）
- 审查层：PRD §12.1 只写字段名与「透传」，未写承载形态 ⇒ 契约缺口无人在评审时对照

## 3. 系统性漏洞定位（QM-5 ③）

- `packages/api-publish-engine/src/content-formatter.js`：**缺少**「平台字段承载形态」这一维度（有标签风格、有长度上限，没有形态）⇒ 任何新链都可能重犯
- 断言形态漏洞：本仓「文本结构断言（MUST）」已在 AGENTS.md 成文（`toContain` 对压平免疫），但**新链的产物断言默认仍写 `toContain`**

## 4. 实现（TDD：先红后绿）

- [x] `test/content-formatter.test.js`：+12 例（白名单判据、段落转换、转义、空输入、幂等、反向剥标签、代码尖括号不误伤）
- [x] `src/content-formatter.js`：`hasHtmlTags` / `textToParagraphHtml` / `htmlToPlainText` / `getArticleBodyKind` / `formatArticleBody` + 平台清单常量 + 导出
- [x] `src/publish/platforms/baijiahao-article.js`：`content` 接 `formatArticleBody`，话题转换先于包装
- [x] `test/baijiahao-article-chain.test.js`：+4 例精确断言（多段/单段/幂等/顺序不变量）
- [x] `test/topic-inline-contract.test.js` B-5：契约更新为 `<p>今日探店 #话题# 太好吃了</p>`
- [x] 纯文本链接线：`douyin-image.js` / `douyin-video.js` / `kuaishou-video.js` / `bilibili-video.js` / `shipinhao-video.js` / `xiaohongshu-draft.js`
- [x] HTML 链接线补：`adapters/wechat-mp/draft.js` 的 `content0`（公众号草稿 API 轨，2026-10-12 #3375 新落地；其测试用 HTML 输入故幂等透传，纯文本输入新增 1 例精确断言）
- [x] 反向用例：`douyin-image-chain.test.js` +1、`tests/xiaohongshu-draft-chain.test.js` +1、`test/wechat-mp-draft.test.js` +1

## 5. 回归（QM-5 ④）

- [x] `content-formatter.test.js` 62/62
- [x] 定向 vitest 8 文件 94/94
- [x] 引擎全量 `node scripts/run-tests.js` rc=0（39 vitest 文件 / 333 用例）

## 6. 预防措施（QM-5 ⑤）

- [x] `AGENTS.md` QM-2 新增「图文正文承载形态合同」：任何写平台正文字段的链必须经 `formatArticleBody`；形态清单显式登记；结构断言必须精确
- [x] `01-docs/PRD-ARTICLE-BODY-FORMAT-2026-10-12.md`：形态合同 + 全平台审计矩阵 + 真机复核 runbook
- [x] `01-docs/learnings.md`：沉淀「承载形态不匹配」pitfall + 取证方法（产物 vs 源文逐字节对账）+ 白名单判据
- [x] `PRD-API-PUBLISH-ENGINE.md` §12.1 表单字段口径更新

## 7. 真机复核（待执行，判据取产物）

- [ ] 发一条多段图文到百家号 → 公开页容器内 `<p>` 数 == 源文自然段数（runbook：PRD §12.3）
- [ ] 发一条富文本 HTML 内容到抖音/小红书 → 描述不含字面量 `<p>`
- [ ] 逐平台复核 DOM 轨 contenteditable 注入（头条/微博/YouTube/TikTok/小红书/快手）
- [ ] 若平台仍合并段落 ⇒ 按产物 HTML 反推期望形态，回写本 change 与 PRD

## 8. 交付

- [ ] PR（squash 自动合并）+ 合并后同次回填远程同步（`.quality-gates.md` / 本记录 / ledger）
- [ ] 记忆三路沉淀（内置记忆 / `01-docs/learnings.md` + gstack jsonl / EverOS），EverOS 以落盘文件 grep 为判据

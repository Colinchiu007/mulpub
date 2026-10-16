# Tasks — fix-article-paragraph-zhihu-publish

> 验收目标：① 富文本编辑器装载后，**编辑器里看到的段落数 == HTML 承载平台拿到的 `<p>` 数**；② 知乎「发布成功」只能是**公开文章页**这一个终态，其余一律如实失败并给出机器可读 reason。
> 真机边界：百家号与知乎的**端到端真机复核均未执行**（判据见 `design.md` §9 与 `01-docs/BUGFIX-ARTICLE-PARAGRAPH-AND-ZHIHU-PUBLISH-2026-10-15.md` §3.11）；复核前不得声称「已修复」。

## 1. 复现与根因（QM-5 ①）

- [x] 先证明「修复在跑」：`git merge-base --is-ancestor 2bb7c2b9a fe9f41879` rc=0；`require.resolve` 解析到运行 worktree 的 `baijiahao-article.js:152`（含 `formatArticleBody`）
- [x] 平台产物取证：2026-10-15 那篇（postId `1879119523718680476`）`data-testid="article"` 内 `<p>`=**1** / `<br>`=0 / 原始换行=0；对照 2026-10-09（修复前）`<p>`=0
- [x] 源文取证：`rewrite_history.id=mv9izcxt37xlxqcq`，1075 字符 / 10 个 `\n` / 6 段
- [x] 逐字节对账：`源文去掉全部 \n == 平台正文` ⇒ **True（1055 == 1055）** ⇒ 只丢换行，无截断/改写
- [x] 本地同源复现：同一份引擎源码调 `BaijiahaoArticleChain.buildArticleFormData` ⇒ **6 个 `<p>`** / 1097 字符 ⇒ 链路能成段，段落是在**进链路之前**丢的
- [x] 逐行实证装载机理：`@vueup/vue-quill@1.5.3` 的 `setContents → setHTML → quill.root.innerHTML`（`:427-429`）+ `text-change → handleTextChange → emit('update:content', getHTML())`（`:257`/`:336-341`/`:423-425`）
- [x] 知乎真机日志 + 记录字段取证：`[zhihu] published!` → `url=…/p/2094165753981309631/edit` → `rpa-publish-ok`；`tracked_content.post_id=''`
- [x] 知乎根因定位：`_publish_zhihu` 成功判据含 `/\/p\/\d+/`（`/edit` 同样命中）+ 只点一次 + `panelGone` 第二个假成功出口

## 2. 逃逸链（QM-5 ②）

- [x] 单测层 A：修复前**没有任何**「编辑器装载后段落数」用例；`ArticleEditor.test.js` 全程 mock `QuillEditor`，真实 Quill 是「装载即改内容」的黑盒 ⇒ mock 结构性失明
- [x] 单测层 B：2026-09-29 的回归测试**夹具就是 `/edit`、断言却要求 `success === true`** ⇒ 缺陷被固化成契约，此后任何改动都不会变红
- [x] 集成层：无「纯文本 → 编辑器 → `payload.content`」贯通用例；无「`/write` → `/p/<id>/edit` → `/p/<id>`」URL 序列驱动用例（mock `getURL` 是固定值）
- [x] E2E / 记录层：无「发布后抓公开页数 `<p>`」与「发布后回查公开页 HTTP」判据；`post_id=''` 无人消费
- [x] 审查层 A：2026-10-12 的审查盯的是发布链（`formatArticleBody` 本身写得很严谨），没有回溯「内容从哪来」
- [x] 审查层 B：「`/p/<id>` 是文章页」这一命名看起来天经地义，审查者不会质疑 URL 语义
- [x] 流程层：2026-10-12 / 2026-09-29 两次都**文档化了根因结论但没做真机复核** ⇒ 未验证假设沉淀成了 QM-2 合同

## 3. 系统性漏洞定位（QM-5 ③）

- [x] A：本仓 QM-2 只写了「写平台字段前必须经 `formatArticleBody`」，**没有覆盖「内容进链路之前的那一跳」** ⇒ 需要一个与之**同判据**的装载侧合同
- [x] A：mock 掉真实编辑器 = 把最危险的一跳换成假的；慢但真实的 DOM 级用例（`quill-load`）此前完全缺位
- [x] B：成功判据的形态问题 —— 「子串命中即成功」在 `rpa-view-platforms.js` 内不是孤例，本次只修知乎这一处，其余登记为审计项
- [x] B：可观测异常（`post_id` 为空）没有消费者 ⇒ 记录层只存不判

## 4. 实现（TDD：先红后绿）

- [x] `packages/shared-utils/src/article-body-format.js`（CJS）+ `article-body-format.browser.js`（ESM 孪生，逐行同源）：`HTML_TAG_PATTERN` / `hasHtmlTags` / `escapeHtml` / `textToParagraphHtml` / `toHtmlBody`
- [x] `packages/shared-utils/src/__tests__/article-body-format-parity.test.js`：9 例（逐行同源 + 导出面 + 与 `formatArticleBody(baijiahao|toutiao|wechat_mp, x)` 逐字节相同 + 事故形态反证）
- [x] `apps/desktop/vite.config.js`：登记 `@multi-publish/shared-utils/src/article-body-format` → `.browser.js` alias
- [x] `apps/desktop/src/components/ArticleEditor.vue`：`richContent.get` 由 `props.modelValue` 改为 `toHtmlBody(props.modelValue)`
- [x] `apps/desktop/src/components/ArticleEditor.test.js`：+7 例（多段成段、HTML 幂等、空内容不留空 `<p>`、`<stdio.h>` 不被当标签、Quill 回写透传、Markdown 模式不变、结构锁）
- [x] `apps/desktop/src/components/ArticleEditor.quill-load.test.js`：**真实 Quill 不 mock** 4 例（2 段 ⇒ DOM 2 个 `<p>`；6 段 ⇒ 6 个 `<p>`；HTML 原样；代码片段保留）
- [x] `apps/desktop/electron/services/zhihu-publish-state.js`：纯函数判据（`isZhihuPublishedUrl` / `isZhihuDraftEditorUrl` / `extractZhihuPostId` / `parseZhihuUrl`）+ 注入式两段式状态机 `confirmZhihuPublished`
- [x] `apps/desktop/electron/services/zhihu-publish-state.test.js`：39 例（`/edit`、`/write`、`/p/<id>/draft`、`/manage`、`evil.example.com`、`javascript:`、空值等反例；状态机 7 例）
- [x] `apps/desktop/electron/services/rpa-view-platforms.js`：`_publish_zhihu` 接入状态机、**删除 `panelGone` 兜底**、成功带 `postId`（净 +2 行，满足行数门禁点名还账零增长）
- [x] `apps/desktop/electron/services/rpa-view-platforms-zhihu-publish.test.js`：5 例（公开页判成功带 `postId`；两段式补点成功；写作页不补点如实失败；结构锁「成功只能经 `confirmZhihuPublished`、不得再自造 URL 子串判据」）
- [x] `apps/desktop/electron/services/rpa-view-platforms.test.js`：原「草稿编辑页 ⇒ 成功」用例**改写为反例**（`success === false` + error 含 `not confirmed`）

## 5. 回归与反证（QM-5 ④）

- [x] `article-body-format-parity.test.js` 9/9；`ArticleEditor.test.js` 17/17；`ArticleEditor.quill-load.test.js` 4/4
- [x] 知乎三文件合计 **126 例**全绿（`zhihu-publish-state` 39 + `rpa-view-platforms-zhihu-publish` 5 + `rpa-view-platforms` 全量）
- [x] **变异反证 A**：`ArticleEditor.vue` getter 改回 `props.modelValue` ⇒ `ArticleEditor.test.js` **4 例红**、`quill-load` **3 例红**；恢复即绿
- [x] **变异反证 B**：`isZhihuPublishedUrl` 放宽为「路径包含 `/p/`」⇒ `zhihu-publish-state.test.js` 的 `/edit` 反例与结构锁当场红
- [x] `scripts/check-renderer-cjs-boundary.js` PASS；`.github/scripts/check-max-lines.js` PASS
- [x] `packages/api-publish-engine` 全量 `node scripts/run-tests.js` rc=0（41 文件 / 425 用例）

## 6. 预防措施（QM-5 ⑤）

- [x] `AGENTS.md` QM-2 新增「富文本编辑器装载合同（`article-body-load-format`，2026-10-15）」：装载即归一、与发布链同判据、判据仍是标签名白名单；并写明「编辑器里看到的段落数 == HTML 承载平台拿到的 `<p>` 数」这条不变式与必跑的三个测试文件
- [x] `01-docs/PRD-ARTICLE-BODY-FORMAT-2026-10-12.md`：补第一性根因修正 + 把上次未执行的真机复核写成必须项
- [x] `01-docs/BUGFIX-ARTICLE-PARAGRAPH-AND-ZHIHU-PUBLISH-2026-10-15.md`：Bug 反思 5 步全量（含两条真机复核 runbook）
- [x] `01-docs/PRD-ZHIHU-PUBLISH-2026-10-15.md`：知乎发布终态判据、两段式流程与记录字段
- [x] `01-docs/learnings.md`：沉淀「修复层级必须早于事故点」「夹具把缺陷锁成契约」「mock 掉真实编辑器」「成功判据必须是严格形状」「两段式动作的补点资格」「文档化 ≠ 已复核」六条
- [x] `openspec/records/fix-article-paragraph-zhihu-publish.md` + `.quality-gates.md` 混合 PR 记录 + `CHANGELOG.md` 两条条目

## 7. 真机复核（待执行，判据取产物）

- [ ] 百家号：发一条**已知分段结构**的图文 ⇒ 公开页 `div[data-testid="article"]` 容器内 **`<p>` 数 == 源文自然段数**，且段间文本不再黏连（源文段数由 `rewrite_history.rewritten_content` 的 `\n\n` 计数得出）
- [ ] 知乎：发一条图文 ⇒ 发布记录 `url` **无 `/edit`**、`post_id` **非空**，打开该 URL 能看到已发布文章
- [ ] 头条 / 公众号（同为 HTML 承载、走另一段注入代码）：各自复核是否存在同类「装载吞段落」路径
- [ ] 若任一平台仍被合并段落 ⇒ 按产物 HTML 反推期望形态，回写本 change 与 PRD，不得先改判据

## 8. 交付

- [ ] PR（squash 自动合并）+ 合并后**同一次提交**回填远程同步（`.quality-gates.md` 表格行 + bullet、`openspec/records/*.md` 表格行、删除 `sync_*` 三字段、删除 `scripts/gate-record-debt-ledger.json` 登记项）
- [ ] 记忆三路沉淀（内置记忆 / `01-docs/learnings.md` / 落盘文件 grep 为判据）

## Why

用户 2026-10-15 一次会话里报了两条**彼此独立**的缺陷，同批修复：

**Bug A（同一现象的二次报障）**：发布到**百家号**的图文，在平台上正文**没有分段、是一整段**。用户的原话是「这个问题我记得之前已经修复过啊，怎么没有生效」——这句必须被机械地回答，答案分四层：

1. **修复确实在代码里，而且正在运行的应用就是含修复的构建**：当时跑的 Electron 来自 worktree `mp-app-live2`（tip `fe9f41879`），2026-10-12 的修复提交 `2bb7c2b9a`（PR `#3389`，change `article-body-format`）是它的**祖先**；`require.resolve` 实证引擎解析到该 worktree 的 `packages/api-publish-engine/src/publish/platforms/baijiahao-article.js:152`，该行正是 `params.set('content', formatArticleBody('baijiahao', withTopics))`。发布日志亦证走的是 `mode=api`（只有这条轨有 `formatArticleBody`）。
2. **但真机产物证明修复无效**：2026-10-15 20:40 发布的那篇（postId `1879119523718680476`）公开页 `data-testid="article"` 容器内 **`<p>` 数 = 1**（`<p>…全篇…</p>` 包住整篇）、`<br>` = 0、容器内原始换行 = 0；正文可见文本 **1055** 字符，与源文（`rewrite_history.id=mv9izcxt37xlxqcq`，1075 字符 / 10 个 `\n` / 6 段）**去掉全部换行后逐字节相等**（1055 == 1055，脚本判定 True）。对照 2026-10-09（修复前）那篇 `1878588576245723518`：`<p>` = 0（裸文本节点）/ 855 字符。⇒ 平台**确实**消费了我们 `content` 里的 HTML（从裸文本变成 `<p>` 包裹），但收到的是**只有一个 `<p>` 的 HTML**。
3. **发布链本身没问题（本地同源复现）**：用**同一份运行中的引擎源码**对同一篇源文调 `BaijiahaoArticleChain.buildArticleFormData`，产出 **6 个 `<p>`** / 1097 字符 ⇒ 若进链路的正文仍带段落结构，平台会收到 6 个 `<p>`。真机只收到 1 个 ⇒ **在进入发布链之前，段落就已经没了**。
4. **第一性根因在渲染层（2026-09-04 引入）**：`apps/desktop/src/components/ArticleEditor.vue` 的富文本模式把 `props.modelValue` 原样交给 `@vueup/vue-quill` 的 `<QuillEditor content-type="html" v-model:content="richContent">`，而 `richContent.get()` 原先直接返回 `props.modelValue`。`@vueup/vue-quill@1.5.3` 的 `setContents()` 对 `contentType === 'html'` 走 `setHTML()`（`quill.root.innerHTML = 值`，源码 `dist/vue-quill.esm-bundler.js:427-429`），Quill 随后经 MutationObserver 触发 `text-change` → `handleTextChange`（`:257`、`:336-341`）→ `emit('update:content', getHTML())`（`:423-425`），**回写的是 `quill.root.innerHTML`**。纯文本（`第一段\n\n第二段`）进入 HTML 语义时换行属**可忽略空白** ⇒ **编辑器装载那一刻段落就塌成一整段**，回写后 `article.content` 已是单段 HTML；发布链看到「已是 HTML」即**幂等透传**。⇒ **修复层级在事故之后，因此再正确也救不回来。**

**Bug B（新报障）**：发布图文时**知乎显示发布成功，但并没有真实发布**。真机日志（同批发布，`shared-user-data/logs/app-2026-10-15.log`）：`12:40:19.645Z` 点击 `button:has-text('发布'), .PublishPanel-publish` → `12:40:22.662Z` `RpaView [zhihu] published!` → `12:40:22.664Z` `RpaView publish done platform=zhihu url=https://zhuanlan.zhihu.com/p/2094165753981309631/edit` → `PublisherRouter rpa-publish-ok {mode: dom, url: …/p/2094165753981309631/edit}`；而发布记录里知乎那条 `post_id = ''`（**空**）、`url = …/p/<id>/edit`（**草稿编辑页**）。

1. **第一性根因**：`apps/desktop/electron/services/rpa-view-platforms.js` 的 `_publish_zhihu` 成功判据含 `/\/p\/\d+/`，而**草稿编辑页** `https://zhuanlan.zhihu.com/p/<id>/edit` 同样命中 ⇒ **只落草稿也报成功**；且知乎发布是**两段式**——首次点「发布」只把稿子落成草稿并跳到该编辑页，需在该页**再点一次「发布」**才真发布（并跳公开文章页 `/p/<id>`）。另有一个假成功出口 `panelGone`（发布按钮消失/隐藏即判成功），可因发布设置面板遮住原按钮而误判。
2. **逃逸链（本次最硬的一环）**：2026-09-29 的同族修复留下的回归测试 `rpa-view-platforms.test.js`「发布成功判定包含知乎 `/p/<id>` 文章 URL 模式」用的夹具 URL 就是 `https://zhuanlan.zhihu.com/p/2088256436652589762/edit`，却断言 `success === true` —— **测试把缺陷锁成了契约**，此后任何改动都不会让它变红。
3. **可观测信号无人消费**：`tracked_content.post_id` 为空是可观测的异常，但发布记录层只存不判，没有任何门禁消费它。

## What Changes

- **新增正文承载形态原语（Bug A，单一实现 + 渲染端孪生）**
  - `packages/shared-utils/src/article-body-format.js`（CJS）+ `article-body-format.browser.js`（ESM 孪生，**逐行同源**）：`HTML_TAG_PATTERN` / `hasHtmlTags` / `escapeHtml` / `textToParagraphHtml` / `toHtmlBody`。
  - `apps/desktop/vite.config.js` 登记 alias（渲染端消费 ESM 孪生；未登记 alias 会被 `scripts/check-renderer-cjs-boundary.js` 拦红）。
  - ⛔ 判定用**标签名白名单**，禁止「`<` 后跟字母」的宽判据（后者会把 `#include <stdio.h>`、`vector<int>` 当标签）。
- **编辑器装载归一（Bug A 的修复点）**：`ArticleEditor.vue` 的 `richContent.get` 由 `props.modelValue` 改为 `toHtmlBody(props.modelValue)` —— 纯文本按行成段、**已是 HTML 幂等透传**；与发布链 `formatArticleBody` 的 HTML 分支**逐字节等价**（两包不能互相 require，属「各存一份 + parity 锁」既有形态）。
- **知乎发布终态判据 + 两段式确认状态机（Bug B）**：新增 `apps/desktop/electron/services/zhihu-publish-state.js`
  - 纯函数（零依赖、可穷举）：`isZhihuPublishedUrl` / `isZhihuDraftEditorUrl` / `extractZhihuPostId` / `parseZhihuUrl`；只有 `https://<zhuanlan|www>.zhihu.com/p/<数字>`（**无 `/edit`、无其它尾段**）才算已发布，两个判据**互斥**。
  - 注入式状态机 `confirmZhihuPublished({readUrl, waitForElement, click, sleep, …})`：先等公开文章页；**仅当确证停在草稿编辑页**时才等按钮就绪并**补点一次**（至多 1 次），再等公开页；未确认一律 `published: false` + 机器可读 `reason`。
  - `_publish_zhihu` 改为调用它、**删除 `panelGone` 假成功兜底**；成功时带出 `postId`。
- **测试（先红后绿）**：`article-body-format-parity.test.js` 9 例；`ArticleEditor.test.js` +7 例（共 17）；`ArticleEditor.quill-load.test.js` **真实 Quill 不 mock** 4 例；`zhihu-publish-state.test.js` 39 例；`rpa-view-platforms-zhihu-publish.test.js` 5 例；`rpa-view-platforms.test.js` 把原「草稿页 = 成功」用例**改写为反例**。
- **文档**：`01-docs/BUGFIX-ARTICLE-PARAGRAPH-AND-ZHIHU-PUBLISH-2026-10-15.md`（Bug 反思 5 步）、`01-docs/PRD-ARTICLE-BODY-FORMAT-2026-10-12.md`（第一性根因修正 + 真机判据）、`01-docs/PRD-ZHIHU-PUBLISH-2026-10-15.md`、`01-docs/PRD-API-PUBLISH-ENGINE.md`、`01-docs/PRD.md`、`AGENTS.md` QM-2 新增「富文本编辑器装载合同」、`CHANGELOG.md`、`01-docs/learnings.md`、`.quality-gates.md`、`openspec/records/fix-article-paragraph-zhihu-publish.md`。

**不变的红线**

- 不改平台端点、请求头、token 链、风控语义（知乎仍走 `mode=rpa_vm`，不新增 API 轨）。
- 不改发布链 `formatArticleBody` 的平台承载形态登记表（HTML 承载仍是 `baijiahao` / `toutiao` / `wechat_mp`）；本次只在**装载侧**复用同一判据。
- 不改 `usePublishFlow` 的 payload 字段、`contentFormat` 语义、字数计数口径。
- 不改知乎「用户主动选存草稿」的 `draft: true` 分支语义（仍按草稿成功返回，见遗留）。
- 不改重试/队列策略（「未确认 ⇒ 失败」对自动重试的影响登记为遗留，不顺手改）。
- 不新增/不修改任何用户可见文案（Bug A 无提示变化；Bug B 的失败文案由既有 `RpaVmPublisher` 透传通道承载）。

## Capabilities

### New Capabilities

- `article-body-load-format`: 任何把正文灌进**富文本编辑器**（`content-type="html"` / Quill / contenteditable / ProseMirror）的路径，装载前必须把纯文本按行归一为段落 HTML；判据与发布链的 HTML 分支**逐字节等价**、幂等、标签名白名单。建立的不变式：**编辑器里看到的段落数 == HTML 承载平台拿到的 `<p>` 数**。
- `publish-zhihu-confirmation`: 知乎图文发布的**成功判据必须是严格终态**（公开文章页 `/p/<数字>`，无 `/edit`、无其它尾段），且必须经「两段式确认状态机」——仅在确证停在草稿编辑页时补点一次，未确认一律失败并给出机器可读 reason；成功时带出 `postId`。

### Modified Capabilities

- `publish-article-body-format`（前作 change `article-body-format` 的能力，尚未归档）：本次不改它的登记表与链侧契约，只在**同一 capability 的边界之外**补上「装载侧」这一跳；接口文件 `01-docs/PRD-ARTICLE-BODY-FORMAT-2026-10-12.md` 的第一性根因结论被本次修正（原结论「发布时传参不对」不完整）。

## 验收面（数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字）

| 面 | Bug A（编辑器装载归一） | Bug B（知乎发布确认） |
|----|------------------------|----------------------|
| 数据校验 | `null`/非字符串 ⇒ 空串；空/纯空白 ⇒ `''`（**不产出 `<p></p>`**）；CRLF 归一；逐行 `.trim()`；**先转义后拼标签**（`&`/`<`/`>`）；已是 HTML ⇒ 幂等原样返回 | 主机仅 `zhuanlan.zhihu.com` / `www.zhihu.com`；协议仅 `http:`/`https:`；文章路径严格 `^/p/(\d+)/?$`；草稿页严格 `^/p/(\d+)/edit/?$`；空/非法 ⇒ `false` 不抛；读 URL 抛错收敛为空串；补点资格必须先确证在草稿页 |
| 流程 | 改写/采集产出纯文本 → 编辑器装载归一 → Quill 渲染多段 → 回写 `article.content` → payload → `PublisherRouter`（`baijiahao → api`）→ `formatArticleBody` 幂等 → 平台 | `PublisherRouter`（`zhihu → rpa_vm`）→ 登录态恢复 → 打开 `/write` → 写标题/正文 → 点「发布」→ **`confirmZhihuPublished`** → 公开页判成功 / 草稿页补点 / 其它页如实失败 |
| 功能逻辑 | 保留富文本格式（加粗/列表仍随 HTML 下发）；Markdown 模式不变（`\n` 原样保留） | 至多 2 次「发布」点击；不补点即不造第二份草稿；成功带 `postId` 供回查 |
| 交互逻辑 | 富文本装载多段内容时**编辑器内显示为多个自然段**（修复前挤成一整段——也是用户最早能在应用内看出来的症状） | 只落草稿时**不再显示成功**；停在写作页不补点；草稿页按钮缺失如实失败 |
| 显示项 | 编辑器段落渲染、字数计数（口径不变，仍按 `modelValue` 码点） | 进度面板阶段文案不变（`publishing...` → `verifying...` → `published!`），但**判定依据**从「URL 含 `/p/`」换成「URL 严格等于公开文章页」；发布记录 `post_id` / `url` 有值 |
| 提示文字 | **无新增/无修改**（无 toast、无对话框） | 失败：`zhihu: publish not confirmed (<reason>) url=<url>`，`reason ∈ {unexpected-page, draft-editor-publish-button-missing, draft-editor-still-not-published}`；日志 `[WARN] RpaView [zhihu] publish not confirmed reason=<reason> url=<url>`；成功：`{success:true, url, platform:'zhihu', postId}`；旧文案 `zhihu: publish verification failed` 随 `panelGone` 一并移除 |

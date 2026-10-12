## Why

用户报障：成功发布到**百家号**的图文，在平台查看时正文**没有分段、是一整段文字**。三个问题都需要机械可查的答案，而证据链指向同一结论：

1. **不是正文内容的问题**：发布前真源（本机 `rewrite_history.rewritten_content`）含 `\n\n` 空行分段 —— 例：863 字符 / 8 个换行 / 5 个自然段；另一篇 1263 字符 / 28 个换行 / 15 个自然段。
2. **是发布时传参的「承载形态」问题**：百家号 `content` 是**富文本编辑器的 HTML 字段**（参考产品逆向证据：`HtmlDocument`/`RichTextParser` 生成 `<p>`；头条同族字段内部名直接叫 `htmlContent`），而链路把纯文本原样 `params.set('content', …)` 进去。HTML 把换行当**可忽略空白** ⇒ 平台把整篇正文存成单个文本节点。
   - 平台产物取证：用户账号已发布的 **11/11 篇**图文公开页 `data-testid="article"` 容器内 `<p>` 数为 **0**、`<br>` 数为 0、原始换行为 0。
   - 逐字节对账：`源文去掉全部 \n == 平台正文字符串` 为 **True**（855==855、1235==1235）⇒ 唯一差异就是换行/段落被吞，排除截断/改写等假设。
3. **其他平台不是「都一样」，而是三类**：
   - 同类**已确认**：百家号（本 change 修）；
   - 同类**先例已修**：公众号（2026-10-12 同日 `wechat-mp-article-content-cover`）、头条 Node 直连兜底（`toutiao-direct-bridge.js:33` 已 `<p>` 包装，但属**第二份实现**）；
   - **反向同类缺陷**（HTML 进纯文本字段 ⇒ `<p>` 以字面量进作品描述）：抖音 `content_desc`、小红书 `desc`、快手 `caption`、B 站 `desc`、视频号 `description`，本 change 一并修；
   - **待真机复核**（离屏不可判定）：所有走 `_fillInput` contenteditable 的 DOM 轨（含头条/百家号图文 DOM 兜底、YouTube/TikTok/微博/小红书/快手编辑器）。

## What Changes

- **`packages/api-publish-engine/src/content-formatter.js`（单一实现）**：新增「图文正文承载形态」层
  - `hasHtmlTags(value)`：**白名单标签名**判据（`p/div/br/a/img/h1-h6/ul/ol/li/blockquote/pre/code/strong/em/hr/table/…`）。⛔ 不用「`<` 后跟字母」的宽判据 —— 代码片段 `#include <stdio.h>`、`vector<int>` 会被整段吃掉（本仓既有 `stripHtmlToPlainText` 的已知边界）。
  - `textToParagraphHtml(text)`：纯文本 → `<p>`；每个非空行一段；转义先行（`& < >`）；CRLF 归一；空行不产出空 `<p>`。
  - `htmlToPlainText(html)`：`<br>`→`\n`；块级闭合→`\n`；实体解码；`\n{3,}`→`\n\n`。
  - `getArticleBodyKind(platform)` / `formatArticleBody(platform, content)`：按形态适配；未知平台保守按纯文本。
- **接线（写字段前最后一跳）**：
  - HTML 承载：`baijiahao-article.js` 的 `content`；**顺序不变量** = 先 `convertInlineTopics`（纯文本上 `(^|\s)#话题` 边界成立）再整体包 `<p>`。另含 `adapters/wechat-mp/draft.js` 的 `content0`（公众号草稿 API 轨，2026-10-12 #3375 新落地，测试原用 HTML 输入故幂等透传）。
  - 纯文本承载：`douyin-image.js` / `douyin-video.js` / `kuaishou-video.js` / `bilibili-video.js` / `shipinhao-video.js` / `xiaohongshu-draft.js` 的描述字段。
- **测试（精确断言，先红后绿）**：`content-formatter.test.js` +12 例（`toBe`/`deepStrictEqual` 精确串）；`baijiahao-article-chain.test.js` +4 例（表单 `content` 解码后精确断言）；`topic-inline-contract.test.js` B-5 契约更新为 `<p>…</p>`；`douyin-image-chain.test.js`、`xiaohongshu-draft-chain.test.js` 各 +1 例反向锁。
- **文档**：新增 `01-docs/PRD-ARTICLE-BODY-FORMAT-2026-10-12.md`（含全平台审计矩阵与真机复核 runbook）；`PRD-API-PUBLISH-ENGINE.md` §12.1 表单字段口径更新；`AGENTS.md` QM-2 新增「图文正文承载形态合同」；`CHANGELOG.md` / `01-docs/learnings.md` / `.quality-gates.md` / `openspec/records/fix-article-body-format.md`。

**不变的红线**

- 不改平台端点、请求头、token 链、风控语义（errno=10000015 仍即停不降级）。
- 不改标题截断、正文长度上限、话题三态矩阵（仅把「转换先于包装」显式化并加锁）。
- 不改 `apps/desktop/electron/**` 与 `packages/rpa-engine/**`（收敛既有三份同族实现属后续 PR，避免本期引入打包验证面）。
- 未知平台一律不改写内容。

## Capabilities

### New Capabilities

- `publish-article-body-format`: 图文正文/描述在**写入平台字段前**必须按其承载形态适配 —— HTML 承载平台收到 `<p>` 段落（纯文本自动成段、已是 HTML 幂等透传），纯文本承载平台收到无标签纯文本（HTML 自动剥标签）；判定、转换与转义为**单一实现**，未知平台保守不改写。

### Modified Capabilities

- `publish-api-engine`（`PRD-API-PUBLISH-ENGINE.md` §12.1）：百家号图文表单 `content` 的口径由「透传字符串」细化为「HTML 段落（`formatArticleBody`）」。

'use strict'
/**
 * article-body-format.js — 正文承载形态原语（无依赖、可被渲染端孪生复用）
 *
 * ## 为什么需要它（2026-10-15 百家号「整篇一整段」二次报障的第一性根因）
 * 发布链侧 `formatArticleBody()` 只解决「**已经是多段**的内容在 HTML 承载平台上如何表达」
 * —— 纯文本按行包 `<p>`、已是 HTML 幂等透传（2026-10-12 change `article-body-format`）。
 * 但只要内容在**进入发布链之前**就已经被压成一段，发布链再正确也救不回来：
 * 桌面端文章编辑器 `ArticleEditor.vue` 的富文本模式是 `@vueup/vue-quill` 的
 * `content-type="html"`，它把 `modelValue` 直接写进 `quill.root.innerHTML`；
 * 纯文本（`第一段\n\n第二段`）进 HTML 语义 ⇒ 换行属可忽略空白 ⇒ **编辑器加载那一刻
 * 段落就塌成一整段**，回写 `modelValue` 的是 Quill 的 `innerHTML`（单个 `<p>`）。
 * 之后发布链看到的是「已是 HTML」⇒ 幂等透传 ⇒ 平台只收到一个 `<p>`
 * （真机取证：2026-10-15 发布的公开页正文 `<p>`=1、全篇 6 段黏连、段间无空白）。
 *
 * ## 用途
 * 富文本编辑器**装载**内容前调用 `toHtmlBody(content)`：纯文本按行成段、已是 HTML 原样。
 * 与发布链的 `formatArticleBody(platform, content)` 的 HTML 分支**同判据**（由
 * `src/__tests__/article-body-format-parity.test.js` 的行为向量锁死），因此
 * 「编辑器里看到的段落数」== 「HTML 承载平台上拿到的 `<p>` 数」。
 *
 * ## 为什么与 api-publish-engine 各存一份
 * `packages/api-publish-engine` 是**零 workspace 依赖、可独立打包**的运行时
 * （见 `src/publish/category-resolver.js` 头注释与 Docker runner 的 COPY 清单），
 * 不能 require `@multi-publish/shared-utils` ⇒ 同族原语按本仓既有形态「各存一份 + parity 锁」
 * （先例：`cloud-accounts/validate-account.js`、`card-paginator-core`）。
 *
 * ## 判据不可放宽
 * 标签判据必须是**标签名白名单**（`HTML_TAG_PATTERN`）。宽判据「`<` 后跟字母」会把技术正文里的
 * `#include <stdio.h>` / `vector<int>` 当标签，纯文本承载平台会整段吃掉用户代码示例
 * （2026-10-12 已实测，见 PRD-ARTICLE-BODY-FORMAT §14）。
 */

/** 已知 HTML 标签名白名单（与 api-publish-engine/src/content-formatter.js 逐字同源） */
const HTML_TAG_PATTERN = '<\\/?(?:html|body|head|title|meta|p|div|br|span|a|img|h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|b|i|u|s|del|ins|hr|table|thead|tbody|tfoot|tr|td|th|caption|figure|figcaption|section|article|header|footer|nav|aside|main|video|audio|source|iframe|sub|sup|dl|dt|dd|mark|small|time|center|font)\\b[^>]*>'

/**
 * 真标签判据：`<` 后必须是**白名单内的标签名**（含属性/自闭合）。
 * `价格 <100 元` 这类数学比较、`#include <stdio.h>` 这类代码片段、`&lt;p&gt;` 实体都不是标签。
 * @param {unknown} value
 * @returns {boolean}
 */
function hasHtmlTags (value) {
  return new RegExp(HTML_TAG_PATTERN, 'i').test(String(value == null ? '' : value))
}

/** HTML 转义 `& < >`（转义先行：纯文本转 HTML 不制造标签注入面） */
function escapeHtml (value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 纯文本 → 段落 HTML：每个非空行一个 `<p>`（转义先行、CRLF 归一、行首尾空白剔除、
 * 空行不产出空 `<p>`）。段界口径：**单换行与空行都算段界**。
 * @param {unknown} text
 * @returns {string} `<p>…</p>` 拼接串（空/空白输入返回空串）
 */
function textToParagraphHtml (text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line) out.push('<p>' + escapeHtml(line) + '</p>')
  }
  return out.join('')
}

/**
 * 按「HTML 承载形态」归一正文：已是 HTML **原样透传**（幂等，不二次包装）、
 * 纯文本按行成段。富文本编辑器装载内容前调用它，段落才不会在装载阶段被吞掉。
 * @param {unknown} content
 * @returns {string} 归一后的 HTML（空/空白输入返回空串）
 */
function toHtmlBody (content) {
  const raw = String(content == null ? '' : content)
  if (!raw.trim()) return ''
  return hasHtmlTags(raw) ? raw : textToParagraphHtml(raw)
}

module.exports = {
  HTML_TAG_PATTERN,
  hasHtmlTags,
  escapeHtml,
  textToParagraphHtml,
  toHtmlBody,
}

// 渲染端（vite dev / build）使用的 ESM 孪生文件；主进程仍用 article-body-format.js（CJS）。
// 逐行同源由 packages/shared-utils/src/__tests__/article-body-format-parity.test.js 拦截
// （剥离头注释与模块包装后两文件必须逐行相同），并用行为向量锁住与
// packages/api-publish-engine/src/content-formatter.js 的 HTML 分支同判据。
// 存在理由与判据口径见 article-body-format.js 头注释与 01-docs/BUGFIX-ARTICLE-PARAGRAPH-AND-ZHIHU-PUBLISH-2026-10-15.md。

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

export {
  HTML_TAG_PATTERN,
  hasHtmlTags,
  escapeHtml,
  textToParagraphHtml,
  toHtmlBody,
}

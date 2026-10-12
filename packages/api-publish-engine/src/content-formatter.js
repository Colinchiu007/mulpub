/**
 * content-formatter.js — 统一内容格式化
 * 负责：29 平台标签格式转换 + 内容/标题截断
 * 遵循增量原则：不修改 taskData 结构，只格式化已有字段
 */

// ---- 标签风格映射 ----
// '#tag'    →  douyin/xiaohongshu/kuaishou/bilibili/toutiao 等（多数平台）
// '#tag#'   →  weibo/souhu
// 'plain'   →  zhihu/wechat_mp/dayu/wangyi/yidianhao/dewu/baijiahao
var TAG_STYLES = {
  douyin: '#tag', xiaohongshu: '#tag', kuaishou: '#tag',
  bilibili: '#tag', toutiao: '#tag', aiqiyi: '#tag',
  pipixia: '#tag', meipai: '#tag', shipinhao: '#tag',
  xigua: '#tag', duoduo: '#tag', qiehao: '#tag',
  tengxun_shipin: '#tag', weishi: '#tag', souhu_shipin: '#tag',
  meiyou: '#tag', xhs_shangjia: '#tag', acfun: '#tag',
  chejiahao: '#tag', yichehao: '#tag',
  weibo: '#tag#', souhu: '#tag#',
  zhihu: 'plain', wechat_mp: 'plain', dayu: 'plain',
  wangyi: 'plain', yidianhao: 'plain', dewu: 'plain', baijiahao: 'plain',
};

// ---- 内容截断上限（字符数） ----
// 2026-10-08 CCG 评审（W4）同步：值对齐 packages/shared-utils/src/publish-capabilities.json
// 注册表（单一真源）；引擎零依赖约束下不能运行时 import 注册表，改由
// test/content-formatter-registry-sync.test.js 契约锁钉住两表一致（漂移即红）。
// 无标题平台（weibo/tencent_video/kuaishou/tiktok/twitter/instagram）：标题合并进
// 描述（由各适配器 compose），标题不单独截断（title 上限设 100000 = no-op），
// 合并后长度由 contentMax 管辖。百家号标题按 UTF-8 字节 149 上限（≈49 中文字符）。
var CONTENT_LIMITS = {
  wechat_mp: 20000, zhihu: 100000, weibo: 10000,
  douyin: 5000, xiaohongshu: 5000, tencent_video: 5000, kuaishou: 480,
  toutiao: 100000, bilibili: 2000, baijiahao: 100000,
  youtube: 5000, tiktok: 2200, twitter: 280, instagram: 2200, facebook: 63206,
};

// ---- 标题截断上限（字符数） ----
var TITLE_LIMITS = {
  wechat_mp: 64, zhihu: 50,
  douyin: 55, xiaohongshu: 20,
  toutiao: 30, bilibili: 80, baijiahao: 49,
  youtube: 100, facebook: 100,
  // 无标题平台：标题合并进描述，不单独截断（no-op 上限）
  weibo: 100000, tencent_video: 100000, kuaishou: 100000,
  tiktok: 100000, twitter: 100000, instagram: 100000,
};

var DEFAULT_CONTENT_LIMIT = 10000;
var DEFAULT_TITLE_LIMIT  = 100;

/**
 * 格式化标签数组
 * @param {string} platform
 * @param {Array} tags - 字符串数组 或 {name} 对象数组
 * @returns {Array}
 */
function formatTags(platform, tags) {
  if (!tags || !Array.isArray(tags)) return [];
  var style = TAG_STYLES[platform] || '#tag';
  return tags.map(function (t) {
    var name = (typeof t === 'string') ? t : (t && t.name ? t.name : String(t));
    if (style === '#tag') return '#' + name;
    if (style === '#tag#') return '#' + name + '#';
    return name; // plain
  });
}

/**
 * 截断内容
 * @param {string} platform
 * @param {string} str
 * @returns {string}
 */
function truncateContent(platform, str) {
  if (!str) return '';
  var limit = CONTENT_LIMITS[platform] || DEFAULT_CONTENT_LIMIT;
  return str.length > limit ? str.slice(0, limit) : str;
}

/**
 * 截断标题
 * @param {string} platform
 * @param {string} str
 * @returns {string}
 */
function truncateTitle(platform, str) {
  if (!str) return '';
  var limit = TITLE_LIMITS[platform] || DEFAULT_TITLE_LIMIT;
  return str.length > limit ? str.slice(0, limit) : str;
}

/**
 * 完整格式化 pipeline
 * @param {string} platform
 * @param {object} taskData - { title, content, tags }
 * @returns {object} 格式化后的 taskData（浅拷贝）
 */
function formatContent(platform, taskData) {
  if (!taskData) return taskData;
  var result = {};
  // 只处理关心的字段，其余透传
  for (var k in taskData) {
    if (Object.prototype.hasOwnProperty.call(taskData, k)) {
      result[k] = taskData[k];
    }
  }
  result.title   = truncateTitle(platform, result.title);
  result.content = truncateContent(platform, result.content);
  result.tags    = formatTags(platform, result.tags);
  return result;
}


function replacePlaceholders(text, topics, mentions) {
  if (!text) return { text: "", topics: [], mentions: [] }
  var result = { text: text, topics: [], mentions: [] }
  result.text = result.text.replace(/\{tmp_h_(\d+)\}/g, function(m, idx) {
    var t = topics[parseInt(idx) - 1]
    if (t) { result.topics.push(t); return "#" + t + "#" }
    return m
  })
  result.text = result.text.replace(/\{tmp_f_(\d+)\}/g, function(m, idx) {
    var u = mentions[parseInt(idx) - 1]
    if (u) { result.mentions.push(u); return "@" + u }
    return m
  })
  return result
}

// ============================================================
// 话题内联描述（publish-topic-inline-description）
// 描述文本是话题唯一真源：UI 追加管道把话题以 `#话题` 内联进描述，
// 引擎侧按平台三态处理——内联保留 / 内联转换（双井号）/ 剥离独立字段。
// 三个函数是唯一实现，各适配器只调用，禁止自抄（契约锁
// test/topic-inline-contract.test.js）。
// ============================================================

/** 转义正则特殊字符（话题名拼进动态正则用） */
function escapeTopicName(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 已知话题清单归一化：接受字符串或 {name} 对象数组，剔空 */
function normalizeKnownTopics(knownTopics) {
  var list = Array.isArray(knownTopics) ? knownTopics : [];
  var names = [];
  for (var i = 0; i < list.length; i++) {
    var name = typeof list[i] === "string" ? list[i] : (list[i] && list[i].name) || "";
    if (name) names.push(String(name));
  }
  return names;
}

/**
 * 解析描述文本中的内联话题名（单井号 `#话题` 与双井号 `#话题#` 都识别，
 * 名字不含井号；`#` 后需至少一个非空白非井号字符，孤立井号不产生话题）。
 * 前置边界：井号前须为文本开头或空白——URL 片段（`https://x.com#tag`）
 * 里的井号不是话题（CCG claude 路评审修复，2026-10-09）。
 * @param {string} content 描述文本
 * @returns {string[]} 话题名数组（按出现顺序，不去重）
 */
function extractInlineTopicNames(content) {
  if (!content) return [];
  var tokens = String(content).match(/(^|\s)#[^\s#]+/g) || [];
  var names = [];
  for (var i = 0; i < tokens.length; i++) names.push(tokens[i].trim().slice(1));
  return names;
}

/**
 * 从描述剥离已知话题片段（独立字段型平台用：B站/知乎/头条/百家号/公众号）。
 * 只剥离 knownTopics 精确匹配的话题（词边界完整匹配），未列出的话题留在
 * 描述——防误伤代码片段（如 `#include`）、URL 片段与用户正文里的普通井号。
 * 双井号形态（`#话题#`）剥离时连同尾井号；移除后收拢分隔空白。
 * @param {string} content 描述文本
 * @param {Array} knownTopics 已知话题（字符串或 {name} 对象）
 * @returns {{content: string, topics: string[]}} 剥离后的描述与实际剥离出的话题名
 */
function stripTopicsFromContent(content, knownTopics) {
  var text = String(content == null ? "" : content);
  var removed = [];
  var names = normalizeKnownTopics(knownTopics);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    // 前置边界 (^|\s)：井号前须为开头或空白，URL 片段里的 #tag 不受影响
    var pattern = "(^|\\s)#" + escapeTopicName(name) + "#?(?=\\s|$)(\\s?)";
    var hit = false;
    text = text.replace(new RegExp(pattern, "g"), function(full, before, after) {
      hit = true;
      if (before && after) return before;
      return "";
    });
    if (hit) removed.push(name);
  }
  return { content: text, topics: removed };
}

/** 双井号内联平台（微信系/微博系/百家号话题形态——参考产品取证：话题 `#名#` 拼正文） */
var DOUBLE_HASH_PLATFORMS = { weibo: true, tencent_video: true, baijiahao: true };

/**
 * 内联型平台的话题格式转换（发布时隐性转换，用户无感知）：
 * weibo/tencent_video 把描述里的 `#话题` 转成 `#话题#`（双井号），
 * 其余内联平台原样返回。只转换 knownTopics 精确匹配的话题（词边界 +
 * 前置边界：井号前须为开头或空白，URL 片段不误转），已是双井号的形态不重复加井号。
 * @param {string} platform 平台标识
 * @param {string} content 描述文本
 * @param {Array} knownTopics 已知话题（字符串或 {name} 对象）
 * @returns {string} 转换后的描述
 */
function convertInlineTopics(platform, content, knownTopics) {
  var text = String(content == null ? "" : content);
  if (!DOUBLE_HASH_PLATFORMS[platform]) return text;
  var names = normalizeKnownTopics(knownTopics);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var pattern = "(^|\\s)#" + escapeTopicName(name) + "#?(?=\\s|$)";
    text = text.replace(new RegExp(pattern, "g"), "$1#" + name + "#");
  }
  return text;
}

/**
 * 扫描已知话题在描述文本中的位置段（抖音 text_extra 等位置标记消费）。
 * 偏移按字符口径（JS string index，中文按 1 计）；双井号形态 end 含尾井号；
 * 多话题按出现位置排序；同一话题多次出现全部标记。
 * 前置边界：井号前须为开头或空白（URL 片段不产生虚假位置段）。
 * @param {string} content 描述文本
 * @param {Array} knownTopics 已知话题（字符串或 {name} 对象）
 * @returns {Array<{name: string, start: number, end: number}>} 位置段列表
 */
function findInlineTopicPositions(content, knownTopics) {
  var text = String(content == null ? "" : content);
  var positions = [];
  var names = normalizeKnownTopics(knownTopics);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var pattern = "(^|\\s)#" + escapeTopicName(name) + "#?(?=\\s|$)";
    var re = new RegExp(pattern, "g");
    var match;
    while ((match = re.exec(text)) !== null) {
      // match 含前导边界捕获（^ 匹配空串或一个空白），start 越过前导
      var lead = match[1] || "";
      positions.push({ name: name, start: match.index + lead.length, end: match.index + match[0].length });
    }
  }
  positions.sort(function (a, b) { return a.start - b.start; });
  return positions;
}

// ============================================================
// 图文正文承载形态（publish-article-body-format，2026-10-12）
//
// 每个平台的「正文字段」有**固定承载形态**：HTML（富文本编辑器）或纯文本（描述语义）。
// 形态不匹配就是「整篇一整段」类事故的根因：**纯文本进 HTML 字段**时，HTML 把换行当作
// 可忽略空白，平台把整篇正文存成一个文本节点 —— 2026-10-12 真机复核百家号 11/11 篇
// 公开文章正文 `<p>` 数为 0，且正文字节 == 源文去掉全部换行后**逐字节相等**（源文来自
// rewrite_history，含 `\n\n` 空行分段）；反向（HTML 进纯文本字段）则会把 `<p>` 以字面量
// 贴进作品描述。
//
// 本层是「形态适配」的单一实现（各链只调用，禁止自抄）：本仓既有两处同类逻辑
// （apps/desktop 的 `stripHtmlToPlainText` 与 `wechat-mp-article.toParagraphHtml`、
// packages/rpa-engine 头条直连兜底的内联 `<p>` 拼接）语义与之一致，但互不可见；
// 引擎侧新增链一律经本层，桌面/RPA 侧的收敛见 PRD-ARTICLE-BODY-FORMAT-2026-10-12 §遗留。
// ============================================================

/** HTML 承载正文的平台（正文字段是富文本编辑器的 HTML，段落必须由 `<p>` 表达） */
var HTML_BODY_PLATFORMS = {
  baijiahao: true,   // /pcui/article/save|publish 的 content（富文本编辑器）
  toutiao: true,     // mp/agw/article/publish 的 content（参考产品字段表 htmlContent）
  wechat_mp: true,   // 公众号 ProseMirror（HTML 语义）
};

/** 纯文本承载正文/描述的平台（字数按可见字符算，`\n` 原样保留） */
var PLAIN_BODY_PLATFORMS = {
  weibo: true, zhihu: true, xiaohongshu: true, douyin: true, kuaishou: true,
  tencent_video: true, bilibili: true, youtube: true, tiktok: true,
  twitter: true, instagram: true, facebook: true,
};

/**
 * 已知 HTML 标签名白名单（Quill 富文本产物 + 常见块级/行内标签）。
 * ⛔ 判据**不能**用「`<` 后跟字母」这种宽写法：技术类正文里的代码片段
 * `#include <stdio.h>`、`vector<int>` 会被当成标签并整段剥掉/包进 `<p>` 判定，
 * 用户可见的代码示例被吃掉（本仓 2026-10-12 实测，既有 desktop `stripHtmlToPlainText`
 * 的宽判据同样会误伤 —— 收敛待办见 PRD §遗留）。白名单收窄后才能安全用于发布链。
 */
var HTML_TAG_PATTERN = '<\\/?(?:p|div|br|span|a|img|h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|b|i|u|s|del|ins|hr|table|thead|tbody|tfoot|tr|td|th|caption|figure|figcaption|section|article|header|footer|nav|aside|main|video|audio|source|iframe|sub|sup|dl|dt|dd|mark|small|time|center|font)\\b[^>]*>'

/**
 * 真标签判据：`<` 后必须是**白名单内的标签名**（含属性/自闭合）。
 * `价格 <100 元` 这类数学比较、`&lt;p&gt;` 实体、代码片段 `<stdio.h>` 都不是标签。
 * @param {string} value
 * @returns {boolean}
 */
function hasHtmlTags(value) {
  return new RegExp(HTML_TAG_PATTERN, 'i').test(String(value == null ? "" : value));
}

/** 剥掉白名单内的 HTML 标签（代码片段里的尖括号原样保留） */
function stripKnownHtmlTags(html) {
  return String(html == null ? "" : html).replace(new RegExp(HTML_TAG_PATTERN, 'gi'), "");
}

/** HTML 转义 `& < >`（转义先行，纯文本转 HTML 不制造标签注入面） */
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 纯文本 → 段落 HTML：每个非空行一个 `<p>`（转义先行）。
 * 段界口径与既有实现一致：**单换行与空行都算段界**（头条直连兜底 `split(/\n+/)`、
 * 公众号 `toParagraphHtml` 同款），CRLF 归一，行首尾空白剔除，空行不产出空 `<p>`。
 * @param {string} text
 * @returns {string} `<p>…</p>` 拼接串（空输入返回空串）
 */
function textToParagraphHtml(text) {
  var lines = String(text == null ? "" : text).split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line) out.push("<p>" + escapeHtml(line) + "</p>");
  }
  return out.join("");
}

/**
 * HTML → 纯文本：块级标签收口为换行、`<br>` 为单换行、实体解码、
 * 3 个以上连续换行压成 2 个（与 desktop `stripHtmlToPlainText` 同口径）。
 * @param {string} html
 * @returns {string}
 */
function htmlToPlainText(html) {
  return String(html == null ? "" : html)
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(?:p|div|li|h[1-6]|blockquote|section|article|tr)\s*>/gi, "\n")
    .replace(new RegExp(HTML_TAG_PATTERN, 'gi'), "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 平台正文字段承载形态。未知平台返回 `'plain'`（保守：不改写未知平台的内容）。
 * @param {string} platform
 * @returns {'html'|'plain'}
 */
function getArticleBodyKind(platform) {
  return HTML_BODY_PLATFORMS[platform] ? "html" : "plain";
}

/**
 * 按平台承载形态适配正文（**发布前必须调用**，各链只调用本函数，禁止自抄转换）：
 *   - HTML 承载平台：纯文本 → `<p>` 段落；已是 HTML 原样透传（幂等，不二次包装）。
 *   - 纯文本承载平台：HTML → 纯文本（段落收口为换行）；纯文本原样透传。
 * 空/空白输入返回空串（不产出空 `<p>`）。
 * @param {string} platform 平台标识
 * @param {string} content 正文（富文本 HTML 或纯文本）
 * @returns {string} 适配后的正文字符串
 */
function formatArticleBody(platform, content) {
  var raw = String(content == null ? "" : content);
  if (!raw.trim()) return "";
  if (getArticleBodyKind(platform) === "html") {
    return hasHtmlTags(raw) ? raw : textToParagraphHtml(raw);
  }
  return hasHtmlTags(raw) ? htmlToPlainText(raw) : raw;
}

module.exports = {
  formatContent, formatTags, truncateContent, truncateTitle, replacePlaceholders,
  extractInlineTopicNames, stripTopicsFromContent, convertInlineTopics, findInlineTopicPositions,
  hasHtmlTags, htmlToPlainText, textToParagraphHtml, getArticleBodyKind, formatArticleBody,
  HTML_BODY_PLATFORMS, PLAIN_BODY_PLATFORMS,
};
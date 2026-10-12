const assert = require("assert");
// 上限真源：shared-utils 发布能力注册表（与 content-formatter-registry-sync.test.js 同一取数先例）。
// 超限测试数据从注册表同源派生，禁止改回硬编码长度——2026-10-01 事故：douyin contentMax
// 1000→5000 后，按旧上限硬编码的期望值（1000）全部失真（nx @multi-publish/api-publish-engine:test 红）。
const fs = require("fs");
const path = require("path");
function sharedUtilsFile (name) {
  let dir = __dirname;
  for (let hop = 0; hop < 10; hop += 1) {
    const candidate = path.join(dir, "packages", "shared-utils", "src", name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("找不到注册表锚点 packages/shared-utils/src/" + name + "（从 " + __dirname + " 上溯 10 级）");
}
const registry = require(sharedUtilsFile("publish-capabilities.js"));
const DOUYIN_CONTENT_MAX = registry.getPlatformContentLimit("douyin").contentMax;


// ---- TDD stubs (module may not exist yet) ----
let formatContent, formatTags, truncateContent, truncateTitle;
try {
  const m = require("../src/content-formatter");
  formatContent   = m.formatContent;
  formatTags      = m.formatTags;
  truncateContent = m.truncateContent;
  truncateTitle   = m.truncateTitle;
} catch (e) {
  formatContent = (p, td) => td;
  formatTags    = (p, tags) => tags;
  truncateContent = (p, s) => s;
  truncateTitle   = (p, s) => s;
  console.log("[INFO] content-formatter not yet implemented, using stub");
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ✅ " + name); }
  catch (e) { failed++; console.log("  ❌ " + name + ": " + e.message); }
}
function assertEqual(a, b) { assert.deepStrictEqual(a, b); }

// ---- formatTags ----
console.log("\n--- formatTags ---");
test("douyin: #tag style", () => {
  assertEqual(formatTags("douyin", ["科技", "AI"]), ["#科技", "#AI"]);
});
test("xiaohongshu: #tag style", () => {
  assertEqual(formatTags("xiaohongshu", ["美食", "教程"]), ["#美食", "#教程"]);
});
test("kuaishou: #tag style", () => {
  assertEqual(formatTags("kuaishou", ["游戏"]), ["#游戏"]);
});
test("weibo: #tag# style", () => {
  assertEqual(formatTags("weibo", ["热门", "新闻"]), ["#热门#", "#新闻#"]);
});
test("zhihu: plain style", () => {
  assertEqual(formatTags("zhihu", ["科技", "互联网"]), ["科技", "互联网"]);
});
test("wechat_mp: plain style", () => {
  assertEqual(formatTags("wechat_mp", ["科技"]), ["科技"]);
});
test("bilibili: #tag style", () => {
  assertEqual(formatTags("bilibili", ["数码", "评测"]), ["#数码", "#评测"]);
});
test("toutiao: #tag style", () => {
  assertEqual(formatTags("toutiao", ["财经"]), ["#财经"]);
});
test("empty tags", () => {
  assertEqual(formatTags("douyin", []), []);
});
test("null/undefined tags", () => {
  assertEqual(formatTags("douyin", null), []);
  assertEqual(formatTags("douyin", undefined), []);
});
test("tags with object format", () => {
  assertEqual(formatTags("zhihu", [{ name: "科技" }, { name: "AI" }]), ["科技", "AI"]);
});

// ---- truncateContent ----
console.log("\n--- truncateContent ---");
test("douyin: 按注册表 contentMax 截断（同源派生，勿改回硬编码）", () => {
  const r = truncateContent("douyin", "a".repeat(DOUYIN_CONTENT_MAX + 500));
  assertEqual(r.length, DOUYIN_CONTENT_MAX);
});
test("weibo: 10000 chars max（2026-10-02 用户终裁放宽，官方 FAQ 5000 为历史口径，与注册表同源）", () => {
  const r = truncateContent("weibo", "b".repeat(9000));
  assertEqual(r.length, 9000); // 9000 < 10000 → 不截断
  assertEqual(truncateContent("weibo", "b".repeat(11000)).length, 10000);
});
test("zhihu: 100000 chars max (no truncation)", () => {
  const r = truncateContent("zhihu", "c".repeat(5000));
  assertEqual(r.length, 5000);
});
test("empty content", () => {
  assertEqual(truncateContent("douyin", ""), "");
});
test("null content", () => {
  assertEqual(truncateContent("douyin", null), "");
});
test("under limit", () => {
  assertEqual(truncateContent("douyin", "hello world"), "hello world");
});

// ---- truncateTitle ----
// 2026-10-08 CCG 评审（W4）同步注册表口径：douyin 55（旧 30）、xiaohongshu 20（旧 40）
console.log("\n--- truncateTitle ---");
test("douyin: 55 chars max（注册表口径，旧值 30 已废）", () => {
  const r = truncateTitle("douyin", "a".repeat(60));
  assertEqual(r.length, 55);
});
test("bilibili: 80 chars max", () => {
  const r = truncateTitle("bilibili", "b".repeat(100));
  assertEqual(r.length, 80);
});
test("xiaohongshu: 20 chars max（注册表口径，旧值 40 已废）", () => {
  const r = truncateTitle("xiaohongshu", "c".repeat(40));
  assertEqual(r.length, 20);
});
test("null title", () => {
  assertEqual(truncateTitle("douyin", null), "");
});

// ---- formatContent full pipeline ----
console.log("\n--- formatContent ---");
test("formatContent: douyin full pipeline（标题 40 ≤ 注册表 55 不截断）", () => {
  const td = formatContent("douyin", {
    title: "a".repeat(40), content: "b".repeat(DOUYIN_CONTENT_MAX + 500), tags: ["科技", "AI"]
  });
  // CCG W4 事故场景回归：40 字标题经渲染层（注册表 55）放行后不得被引擎截到旧值 30
  assertEqual(td.title.length, 40);
  assertEqual(td.content.length, DOUYIN_CONTENT_MAX); // 同源派生（勿改回硬编码 1000，上限 5000 后失真）
  assertEqual(td.tags, ["#科技", "#AI"]);
});
test("formatContent: weibo full pipeline", () => {
  const td = formatContent("weibo", {
    title: "test", content: "hello", tags: ["新闻", "热点"]
  });
  assertEqual(td.tags, ["#新闻#", "#热点#"]);
});
test("formatContent: unknown platform uses defaults", () => {
  const td = formatContent("unknown", {
    title: "test", content: "content", tags: ["tag1"]
  });
  assertEqual(td.title, "test");
  assertEqual(td.content, "content");
  assertEqual(td.tags, ["#tag1"]);
});

// ---- 话题内联描述（publish-topic-inline-description）----
// extractInlineTopicNames / stripTopicsFromContent / convertInlineTopics
// 单一实现（各适配器只调用，禁止自抄——契约锁见 topic-inline-contract.test.js）
console.log("\n--- topic inline (publish-topic-inline-description) ---");

let extractInlineTopicNames, stripTopicsFromContent, convertInlineTopics, findInlineTopicPositions;
try {
  const m2 = require("../src/content-formatter");
  extractInlineTopicNames = m2.extractInlineTopicNames;
  stripTopicsFromContent = m2.stripTopicsFromContent;
  convertInlineTopics = m2.convertInlineTopics;
  findInlineTopicPositions = m2.findInlineTopicPositions;
} catch (e) { /* 模块缺失时保持 undefined，下列用例变红 */ }

test("extractInlineTopicNames: 单井号话题提取", () => {
  assertEqual(extractInlineTopicNames("正文 #美食探店 #vlog 结尾"), ["美食探店", "vlog"]);
});
test("extractInlineTopicNames: 双井号话题提取时剥离尾井号", () => {
  assertEqual(extractInlineTopicNames("正文 #美食探店# 结尾"), ["美食探店"]);
});
test("extractInlineTopicNames: 无话题与孤立井号返回空数组", () => {
  assertEqual(extractInlineTopicNames("正文没有任何话题"), []);
  assertEqual(extractInlineTopicNames(""), []);
  assertEqual(extractInlineTopicNames("C 语言的 # include 写法 #"), []);
});

test("stripTopicsFromContent: 剥离已知话题（中间位置收拢空白）", () => {
  const r = stripTopicsFromContent("正文 #美食探店 #vlog", ["美食探店"]);
  assertEqual(r.content, "正文 #vlog");
  assertEqual(r.topics, ["美食探店"]);
});
test("stripTopicsFromContent: 剥离已知话题（尾部连同前导空白）", () => {
  const r = stripTopicsFromContent("正文 #美食探店", ["美食探店"]);
  assertEqual(r.content, "正文");
  assertEqual(r.topics, ["美食探店"]);
});
test("stripTopicsFromContent: 双井号形态剥离时连同尾井号", () => {
  const r = stripTopicsFromContent("正文 #美食探店#", ["美食探店"]);
  assertEqual(r.content, "正文");
});
test("stripTopicsFromContent: 未列出的话题不剥离（留在描述）", () => {
  const r = stripTopicsFromContent("正文 #美食探店 #vlog", ["vlog"]);
  assertEqual(r.content, "正文 #美食探店");
  assertEqual(r.topics, ["vlog"]);
});
test("stripTopicsFromContent: 代码片段 #include 不误伤（不在已知清单）", () => {
  const r = stripTopicsFromContent("代码 #include <stdio.h> 结尾", ["美食"]);
  assertEqual(r.content, "代码 #include <stdio.h> 结尾");
  assertEqual(r.topics, []);
});
test("stripTopicsFromContent: 词边界——#AI 不误匹配 #AI技术", () => {
  const r = stripTopicsFromContent("正文 #AI技术", ["AI"]);
  assertEqual(r.content, "正文 #AI技术");
  assertEqual(r.topics, []);
});
test("stripTopicsFromContent: 对象形态话题（{name}）同样支持", () => {
  const r = stripTopicsFromContent("正文 #美食探店", [{ name: "美食探店" }]);
  assertEqual(r.content, "正文");
});

test("convertInlineTopics: weibo 单井号转双井号", () => {
  assertEqual(convertInlineTopics("weibo", "正文 #美食探店", ["美食探店"]), "正文 #美食探店#");
});
test("convertInlineTopics: tencent_video 单井号转双井号", () => {
  assertEqual(convertInlineTopics("tencent_video", "正文 #美食探店", ["美食探店"]), "正文 #美食探店#");
});
test("convertInlineTopics: 其余内联平台原样返回", () => {
  assertEqual(convertInlineTopics("douyin", "正文 #美食探店", ["美食探店"]), "正文 #美食探店");
  assertEqual(convertInlineTopics("kuaishou", "正文 #美食探店", ["美食探店"]), "正文 #美食探店");
});
test("convertInlineTopics: 未列出的话题不转换", () => {
  assertEqual(convertInlineTopics("weibo", "正文 #vlog", ["美食探店"]), "正文 #vlog");
});
test("convertInlineTopics: 已双井号形态不重复加井号", () => {
  assertEqual(convertInlineTopics("weibo", "正文 #美食探店#", ["美食探店"]), "正文 #美食探店#");
});
test("convertInlineTopics: 词边界——#AI 不误转换 #AI技术", () => {
  assertEqual(convertInlineTopics("weibo", "正文 #AI技术", ["AI"]), "正文 #AI技术");
});

test("findInlineTopicPositions: 已知话题位置段（字符偏移，中文按 1 计）", () => {
  // '今天探店 #美食探店 太好吃了'：'#美食探店' 起于索引 5，长度 5 → end=10（开区间）
  const r = findInlineTopicPositions("今天探店 #美食探店 太好吃了", ["美食探店"]);
  assertEqual(r, [{ name: "美食探店", start: 5, end: 10 }]);
});
test("findInlineTopicPositions: 多话题按出现位置排序", () => {
  const r = findInlineTopicPositions("正文 #vlog 中段 #美食探店", ["美食探店", "vlog"]);
  assertEqual(r, [{ name: "vlog", start: 3, end: 8 }, { name: "美食探店", start: 12, end: 17 }]);
});
test("findInlineTopicPositions: 双井号形态 end 含尾井号", () => {
  const r = findInlineTopicPositions("正文 #美食探店#", ["美食探店"]);
  assertEqual(r, [{ name: "美食探店", start: 3, end: 9 }]);
});
test("findInlineTopicPositions: 未列出话题与词边界不产生位置段", () => {
  assertEqual(findInlineTopicPositions("正文 #vlog", ["美食探店"]), []);
  assertEqual(findInlineTopicPositions("正文 #AI技术", ["AI"]), []);
  assertEqual(findInlineTopicPositions("代码 #include <stdio.h>", ["美食"]), []);
});
test("findInlineTopicPositions: 同一话题多次出现全部标记", () => {
  const r = findInlineTopicPositions("#a #a", ["a"]);
  assertEqual(r, [{ name: "a", start: 0, end: 2 }, { name: "a", start: 3, end: 5 }]);
});

// ---- URL 片段防护（CCG claude 路评审修复，2026-10-09）----
// 井号前须为开头或空白：URL 片段（https://x.com#tag）里的 #tag 不是话题
console.log("\n--- URL fragment guard (CCG review fix) ---");

test("extractInlineTopicNames: URL 片段里的 #tag 不产生话题", () => {
  assertEqual(extractInlineTopicNames("See https://x.com#tag #tag"), ["tag"]);
  assertEqual(extractInlineTopicNames("https://x.com#section"), []);
});
test("stripTopicsFromContent: 不误剥 URL 片段里的同名锚点", () => {
  const r = stripTopicsFromContent("See https://x.com#tag #tag", ["tag"]);
  assertEqual(r.content, "See https://x.com#tag");
  assertEqual(r.topics, ["tag"]);
});
test("convertInlineTopics: 不误转换 URL 片段里的 #tag", () => {
  assertEqual(convertInlineTopics("weibo", "See https://x.com#tag #tag", ["tag"]), "See https://x.com#tag #tag#");
});
test("findInlineTopicPositions: URL 片段不产生虚假位置段", () => {
  const r = findInlineTopicPositions("See https://x.com#tag #tag", ["tag"]);
  assertEqual(r, [{ name: "tag", start: 22, end: 26 }]);
});

// ---- 图文正文承载形态（publish-article-body-format，2026-10-12）----
// 事故：百家号图文正文「整篇一整段」（真机 11/11 篇公开页 0 个 <p>，正文字节 ==
// 源文去掉全部换行后逐字节相等）。根因是**承载形态不匹配**：`content` 字段是富文本
// 编辑器的 HTML，而传进去的是纯文本 —— HTML 里换行是可忽略空白，段落全部塌掉。
// 本组用例锁：① 纯文本 → `<p>` 段落；② 已是 HTML 幂等透传；③ 纯文本承载平台
// （抖音/小红书描述）反向剥标签；④ 空输入不产出空 `<p>`。
console.log("\n--- article body format (publish-article-body-format) ---");

let formatArticleBody, hasHtmlTags, textToParagraphHtml, htmlToPlainText, getArticleBodyKind;
try {
  const m3 = require("../src/content-formatter");
  formatArticleBody = m3.formatArticleBody;
  hasHtmlTags = m3.hasHtmlTags;
  textToParagraphHtml = m3.textToParagraphHtml;
  htmlToPlainText = m3.htmlToPlainText;
  getArticleBodyKind = m3.getArticleBodyKind;
} catch (e) { /* 模块缺失时保持 undefined，下列用例变红 */ }

test("hasHtmlTags: 真标签判据（`<100 元`、实体、代码片段都不是标签）", () => {
  assertEqual(hasHtmlTags("<p>正文</p>"), true);
  assertEqual(hasHtmlTags("<br/>"), true);
  assertEqual(hasHtmlTags('<a href="https://x.com">链接</a>'), true);
  assertEqual(hasHtmlTags("纯文本正文"), false);
  assertEqual(hasHtmlTags("价格 <100 元 与 >50 元"), false);
  assertEqual(hasHtmlTags("&lt;p&gt;正文&lt;/p&gt;"), false);
  // 技术类正文的代码片段：宽判据（`<` 后跟字母即标签）会把它整段吃掉
  assertEqual(hasHtmlTags("代码 #include <stdio.h> 结尾"), false);
  assertEqual(hasHtmlTags("vector<int> 容器"), false);
});

test("formatArticleBody: 代码片段里的尖括号不被当标签（防吃掉代码示例）", () => {
  const code = "代码 #include <stdio.h> 结尾";
  assertEqual(formatArticleBody("bilibili", code), code);
  assertEqual(formatArticleBody("douyin", "<p>代码 #include <stdio.h> 结尾</p>"), code);
  assertEqual(formatArticleBody("baijiahao", code), "<p>代码 #include &lt;stdio.h&gt; 结尾</p>");
});

test("htmlToPlainText: 完整 HTML 文档反转后不残留包裹标签（QM-6 Info-2 回归锁）", () => {
  assertEqual(htmlToPlainText("<html><body><p>甲</p><p>乙</p></body></html>"), "甲\n乙");
  assertEqual(formatArticleBody("douyin", "<html><head><title>标题</title></head><body><p>甲</p></body></html>"), "标题\n\n甲");
});

test("textToParagraphHtml: 空行分段 → 每段一个 <p>（精确串断言）", () => {
  assertEqual(textToParagraphHtml("第一段\n\n第二段"), "<p>第一段</p><p>第二段</p>");
});

test("textToParagraphHtml: 单换行 / 多换行 / CRLF 同为段界（与头条、公众号既有口径一致）", () => {
  assertEqual(textToParagraphHtml("行一\n行二"), "<p>行一</p><p>行二</p>");
  assertEqual(textToParagraphHtml("a\n\n\n b \n\n"), "<p>a</p><p>b</p>");
  assertEqual(textToParagraphHtml("a\r\nb"), "<p>a</p><p>b</p>");
});

test("textToParagraphHtml: 转义 & < >（不制造标签注入面）", () => {
  assertEqual(textToParagraphHtml("a & b <c>"), "<p>a &amp; b &lt;c&gt;</p>");
});

test("textToParagraphHtml: 空/空白输入不产出空 <p>", () => {
  assertEqual(textToParagraphHtml(""), "");
  assertEqual(textToParagraphHtml("   \n  \n"), "");
  assertEqual(textToParagraphHtml(null), "");
});

test("htmlToPlainText: 块级标签收口为换行、<br> 为单换行（与 desktop stripHtmlToPlainText 同口径）", () => {
  assertEqual(htmlToPlainText("<p>a</p><p>b</p>"), "a\nb");
  assertEqual(htmlToPlainText("<div>a<br>b</div>"), "a\nb");
  assertEqual(htmlToPlainText("<p>a &amp; b</p>"), "a & b");
  assertEqual(htmlToPlainText("<p>a</p><p></p><p>b</p>"), "a\n\nb");
});

test("getArticleBodyKind: HTML 承载平台 vs 纯文本承载平台（未知平台保守按纯文本）", () => {
  assertEqual(getArticleBodyKind("baijiahao"), "html");
  assertEqual(getArticleBodyKind("toutiao"), "html");
  assertEqual(getArticleBodyKind("wechat_mp"), "html");
  assertEqual(getArticleBodyKind("douyin"), "plain");
  assertEqual(getArticleBodyKind("xiaohongshu"), "plain");
  assertEqual(getArticleBodyKind("weibo"), "plain");
  assertEqual(getArticleBodyKind("unknown-platform"), "plain");
});

test("formatArticleBody(baijiahao): 多段纯文本 → HTML 段落（本次事故的回归锁）", () => {
  assertEqual(
    formatArticleBody("baijiahao", "凌晨两点的烘焙坊。\n\n起初，这被当作普通案例。\n\n后来评论区炸了。"),
    "<p>凌晨两点的烘焙坊。</p><p>起初，这被当作普通案例。</p><p>后来评论区炸了。</p>",
  );
});

test("formatArticleBody(baijiahao): 已是 HTML → 原样透传（幂等，不重复包装）", () => {
  const html = "<p>第一段</p><p>第二段</p>";
  assertEqual(formatArticleBody("baijiahao", html), html);
});

test("formatArticleBody(douyin/xiaohongshu): HTML → 纯文本（防标签字面量进描述）", () => {
  assertEqual(formatArticleBody("douyin", "<p>第一段</p><p>第二段</p>"), "第一段\n第二段");
  assertEqual(formatArticleBody("xiaohongshu", "<p>一段</p>"), "一段");
});

test("formatArticleBody: 纯文本平台的纯文本输入原样（零契约变更）", () => {
  assertEqual(formatArticleBody("douyin", "第一段\n\n第二段"), "第一段\n\n第二段");
  assertEqual(formatArticleBody("weibo", "正文"), "正文");
});

test("formatArticleBody: 空/空白输入返回空串（不产出空 <p>）", () => {
  assertEqual(formatArticleBody("baijiahao", ""), "");
  assertEqual(formatArticleBody("baijiahao", null), "");
  assertEqual(formatArticleBody("douyin", "   "), "");
});

console.log("\n========== Result ==========");
console.log("  Passed: " + passed + " / " + (passed + failed));
console.log("  Failed: " + failed + " / " + (passed + failed));
if (failed > 0) process.exit(1);
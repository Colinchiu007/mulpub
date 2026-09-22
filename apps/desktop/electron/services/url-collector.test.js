// @ts-check
/**
 * UrlCollector 回归测试 — 知乎专栏/问题回答正文提取
 *
 * 覆盖：
 *   - 知乎专栏（zhuanlan.zhihu.com）：.Post-RichTextContainer 优先提取
 *   - 知乎问题/回答（www.zhihu.com）：.RichContent-inner 优先提取
 *   - 百家号（baijiahao.baidu.com）：SPA <p> 段落聚合 + h1 标题回退
 *   - 通用站点回退：article → main → body
 *   - SSRF 防护：内网地址拒绝
 *   - IPC handler：url-collect:fetch 成功/失败路径
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const UrlCollector = (await import("./url-collector")).default;

// 回归保护：35ae6224 误删 urlCollector 唯一 IPC 注册点后，采集回退层静默失败且无日志。
// 此 describe 锁定「失败必须留痕」合同：collect 失败路径必须写应用 logger。
describe("UrlCollector 失败日志（回归：采集失败无日志）", () => {
  let collector;
  let logger;
  let auditDir;

  beforeEach(async () => {
    vi.clearAllMocks();
    const os = await import("os");
    const path = await import("path");
    // 显式注入审计目录，验证 AuditLogger 落盘合同
    auditDir = path.join(os.tmpdir(), "mp-collect-audit-test-" + Date.now());
    // 依赖注入 logger（vi.mock 拦不住 CJS 模块内部的 require，构造注入是唯一可靠方式）
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    collector = new UrlCollector({ auditDir, log: logger });
  });

  afterEach(async () => {
    // 审查 M4：测试临时目录自清理
    const fs = await import("fs");
    try { fs.rmSync(auditDir, { recursive: true, force: true }); } catch { /* 已清理 */ }
  });

  it("浏览器采集异常时写 error 日志（含 URL 与错误信息）", async () => {
    // _collectViaBrowser 抛错 → catch 分支必须写日志
    collector._rateLimiter = { evaluate: () => ({ allowed: true }), recordRequest: () => {} };
    collector._collectViaBrowser = vi.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_RESET"));
    const result = await collector.collect("https://zhuanlan.zhihu.com/p/2081651053322421603");
    expect(result.success).toBe(false);
    expect(result.error).toContain("采集失败");
    expect(logger.error).toHaveBeenCalled();
    const args = logger.error.mock.calls[0];
    expect(String(args[0])).toContain("url-collect");
    expect(JSON.stringify(args)).toContain("2081651053322421603");
  });

  it("HTTP 采集异常时写 error 日志", async () => {
    collector._rateLimiter = { evaluate: () => ({ allowed: true }), recordRequest: () => {} };
    collector._needsBrowser = () => false; // 强制走 HTTP 路径
    collector._getAxios = () => ({ get: vi.fn().mockRejectedValue(new Error("timeout of 15000ms exceeded")) });
    const result = await collector.collect("https://example.com/post/1");
    expect(result.success).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  // 回归保护：知乎采集偶发报「原因未识别」（2026-09-13）。
  // 根因：stealth 浏览器 page.content() 在页面导航中抛
  // "Unable to retrieve content because the page is navigating"，错误消息不含已知
  // 分类关键词 → classifyCollectError 判为 unknown。修复：_readPageContentWithRetry
  // 导航竞态重试 + collect catch 把导航错误归类为 content_unextractable。
  describe("UrlCollector 导航竞态（回归：知乎采集原因未识别）", () => {
    let collector;
    let logger;

    beforeEach(() => {
      logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      collector = new UrlCollector({ auditDir: null, log: logger });
    });

    it("_readPageContentWithRetry：导航竞态后重试成功", async () => {
      const page = {
        content: vi.fn()
          .mockRejectedValueOnce(new Error("Unable to retrieve content because the page is navigating and changing the content."))
          .mockResolvedValueOnce("<html><body><article><p>正文</p></article></body></html>"),
      };
      const html = await collector._readPageContentWithRetry(page);
      expect(html).toContain("正文");
      expect(page.content).toHaveBeenCalledTimes(2);
    });

    it("_readPageContentWithRetry：非导航错误不重试，直接抛出", async () => {
      const page = {
        content: vi.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_RESET")),
      };
      await expect(collector._readPageContentWithRetry(page)).rejects.toThrow("ERR_CONNECTION_RESET");
      expect(page.content).toHaveBeenCalledTimes(1);
    });

    it("collect catch：导航错误归类为 content_unextractable（非 unknown）", async () => {
      collector._rateLimiter = { evaluate: () => ({ allowed: true }), recordRequest: () => {} };
      collector._collectViaBrowser = vi.fn().mockRejectedValue(
        new Error("Unable to retrieve content because the page is navigating and changing the content.")
      );
      const result = await collector.collect("https://zhuanlan.zhihu.com/p/2081651053322421603");
      expect(result.success).toBe(false);
      expect(result.reason).toBe("content_unextractable");
      expect(result.error).toContain("采集失败");
    });

    it("collect catch：非导航错误不附加 reason（保持原样）", async () => {
      collector._rateLimiter = { evaluate: () => ({ allowed: true }), recordRequest: () => {} };
      collector._collectViaBrowser = vi.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_RESET"));
      const result = await collector.collect("https://zhuanlan.zhihu.com/p/2081651053322421603");
      expect(result.success).toBe(false);
      expect(result.reason).toBeUndefined();
    });
  });

  it("构造时注入 auditDir 后 AuditLogger 事件落盘 jsonl", async () => {
    const os = await import("os");
    const path = await import("path");
    const fs = await import("fs");
    collector._auditLogger.error("zhihu", "default", new Error("test-audit"), { url: "https://zhuanlan.zhihu.com/p/1" });
    collector._auditLogger.flush();
    const dir = collector._auditLogger._dir;
    expect(dir).toBeTruthy();
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("collection-audit-"));
    expect(files.length).toBeGreaterThan(0);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(content).toContain("test-audit");
  });

  it("auditDir 传 null 时禁用落盘且不缓冲（审查 M5：防内存泄漏）", () => {
    const c = new UrlCollector({ auditDir: null });
    expect(c._auditLogger._dir).toBe(null);
    c._auditLogger.error("zhihu", "default", new Error("should-not-buffer"), { url: "https://example.com" });
    expect(c._auditLogger._buffer.length).toBe(0);
  });

  it("auditDir 相对路径被规范化为绝对路径（审查 C2）", () => {
    const c = new UrlCollector({ auditDir: "relative/audit-dir" });
    expect(c._auditLogger._dir.includes("relative")).toBe(true);
    expect(c._auditLogger._dir).toMatch(new RegExp("^[A-Za-z]:[\\\\/]|^/"));
  });

  it("AuditLogger 落盘时 URL 敏感参数被脱敏（审查 C1）", async () => {
    const fs = await import("fs");
    const pathMod = await import("path");
    collector._auditLogger.request("zhihu", "default", "https://example.com/callback?code=OAUTH_SECRET&state=x", 200, 0);
    collector._auditLogger.flush();
    const files = fs.readdirSync(auditDir).filter((f) => f.startsWith("collection-audit-"));
    const content = fs.readFileSync(pathMod.join(auditDir, files[0]), "utf8");
    // URL.searchParams.set 会做百分号编码，[REDACTED] → %5BREDACTED%5D
    expect(content.toLowerCase()).toContain("redacted");
    expect(content).not.toContain("OAUTH_SECRET");
  });
});

function zhihuColumnHtml() {
  return `<html>
  <head>
    <meta property="og:title" content="知乎专栏文章标题">
    <meta property="og:description" content="专栏描述">
    <meta property="og:image" content="https://example.com/cover.jpg">
    <meta property="article:published_time" content="2024-01-01T00:00:00+08:00">
    <meta property="og:site_name" content="知乎">
    <title>知乎专栏文章标题</title>
  </head>
  <body>
    <nav>导航栏无关内容</nav>
    <div class="Post-RichTextContainer">
      <div class="RichText ztext Post-RichText">这是知乎专栏的正文内容，包含完整段落文字。</div>
    </div>
    <aside>侧栏推荐内容</aside>
    <footer>页脚版权信息</footer>
  </body>
</html>`;
}

function zhihuAnswerHtml() {
  return `<html>
  <head>
    <meta property="og:title" content="知乎问题标题">
    <title>知乎问题标题 - 知乎</title>
  </head>
  <body>
    <header>顶部导航</header>
    <div class="QuestionHeader">
      <h1 class="QuestionHeader-title">知乎问题标题</h1>
    </div>
    <div class="RichContent RichContent--unescapable">
      <div class="RichText ztext RichContent-inner">这是知乎某个回答的完整正文内容。</div>
    </div>
    <div class="RichContent RichContent--unescapable">
      <div class="RichText ztext RichContent-inner">这是第二个回答的正文。</div>
    </div>
    <aside>相关推荐</aside>
  </body>
</html>`;
}

function genericArticleHtml() {
  return `<html>
  <head><title>普通文章标题</title></head>
  <body>
    <article><p>普通站点正文内容。</p></article>
    <footer>页脚</footer>
  </body>
</html>`;
}

function baijiahaoHtml() {
  // 百家号是 SPA，class 名每次构建混淆变化；正文稳定在 <p> 段落标签中。
  // 页面含多个带 class 的容器（导航/侧栏/正文），正文容器拥有最多 <p>。
  return `<html>
  <head><title>英伟达“掀桌子”了：国产大模型免费用 - 百家号</title></head>
  <body>
    <div class="_1nav">
      <a>首页</a><a>登录</a>
    </div>
    <div class="xcp-publish">
      <p>AI导读：这是一段较短的导读文字。</p>
    </div>
    <div class="_2jN0Z">
      <h1>英伟达“掀桌子”了：国产大模型免费用</h1>
      <p>上次发了一篇文章，发现AI行业内外有巨大的信息差。</p>
      <p>周六又发了一个“英伟达开放 60 多个免费大模型”的视频被转发了几千次。</p>
      <p>听起来像是黄仁勋突然改行做慈善：GLM、MiniMax、Qwen，统统不要钱。</p>
      <p>真正的福利是：英伟达替你准备好了显卡和运行环境。</p>
    </div>
    <div class="_3side">
      <p>相关推荐：另一篇文章标题</p>
    </div>
  </body>
</html>`;
}

describe("UrlCollector _needsBrowser", () => {
  let collector;

  beforeEach(() => {
    collector = new UrlCollector();
  });

  it("识别知乎域名需要浏览器渲染", () => {
    expect(collector._needsBrowser("zhuanlan.zhihu.com")).toBe(true);
    expect(collector._needsBrowser("www.zhihu.com")).toBe(true);
    expect(collector._needsBrowser("zhihu.com")).toBe(true);
  });

  it("识别百家号域名需要浏览器渲染", () => {
    expect(collector._needsBrowser("baijiahao.baidu.com")).toBe(true);
  });

  it("非知乎域名不需要浏览器渲染", () => {
    expect(collector._needsBrowser("example.com")).toBe(false);
    expect(collector._needsBrowser("mp.weixin.qq.com")).toBe(false);
  });
});

// 回归保护：知乎链接一键改写报 rate_limited（2026-09-13）。
// 根因：渲染层先走 Python 聚合层 trafilatura 裸连知乎 → 触发反爬失败 →
// 回退 urlCollectFetch 才走 stealth。每次点击都先白挨一次反爬检测（封 IP 风险）。
// 修复：暴露 needs-stealth 路由查询，渲染层对反爬站点直接走 stealth 通道。
describe("UrlCollector url-collect:needs-stealth 路由查询（回归：知乎先裸连触发风控）", () => {
  let collector;
  let handlers;

  beforeEach(() => {
    collector = new UrlCollector({ auditDir: null, log: { info() {}, warn() {}, error() {} } });
    handlers = {};
    collector.registerIpcHandlers({ handle: (ch, fn) => { handlers[ch] = fn } });
  });

  it("知乎问题/回答 URL → needsStealth: true（必须走 stealth，禁止裸连）", async () => {
    const ret = await handlers["url-collect:needs-stealth"](null, {
      url: "https://www.zhihu.com/question/20255485/answer/2021183938203263464",
    });
    expect(ret.code).toBe(0);
    expect(ret.data.needsStealth).toBe(true);
  });

  it("知乎专栏 URL → needsStealth: true", async () => {
    const ret = await handlers["url-collect:needs-stealth"](null, {
      url: "https://zhuanlan.zhihu.com/p/368038553",
    });
    expect(ret.code).toBe(0);
    expect(ret.data.needsStealth).toBe(true);
  });

  it("百家号 URL → needsStealth: true", async () => {
    const ret = await handlers["url-collect:needs-stealth"](null, {
      url: "https://baijiahao.baidu.com/s?id=1873093353787420593",
    });
    expect(ret.code).toBe(0);
    expect(ret.data.needsStealth).toBe(true);
  });

  it("普通站点 → needsStealth: false（走默认聚合路径）", async () => {
    const ret = await handlers["url-collect:needs-stealth"](null, {
      url: "https://example.com/article",
    });
    expect(ret.code).toBe(0);
    expect(ret.data.needsStealth).toBe(false);
  });

  it("非法 URL → 不拦截（needsStealth: false，交由 collect 完整校验）", async () => {
    const ret = await handlers["url-collect:needs-stealth"](null, { url: "not-a-url" });
    expect(ret.code).toBe(0);
    expect(ret.data.needsStealth).toBe(false);
  });

  it("缺少参数对象 → VALIDATION_ERROR", async () => {
    const ret = await handlers["url-collect:needs-stealth"](null, null);
    expect(ret.code).not.toBe(0);
  });

  it("静态判断与 _needsBrowser 共用同一域名清单（单一来源，防漂移）", () => {
    // _needsBrowser 与 isAntiCrawlHost 必须一致：实例采集与渲染层路由不能各维护一份清单
    for (const host of ["zhuanlan.zhihu.com", "www.zhihu.com", "zhihu.com", "baijiahao.baidu.com"]) {
      expect(UrlCollector.isAntiCrawlHost(host)).toBe(true);
      expect(collector._needsBrowser(host)).toBe(true);
    }
    for (const host of ["example.com", "mp.weixin.qq.com", "bilibili.com"]) {
      expect(UrlCollector.isAntiCrawlHost(host)).toBe(false);
      expect(collector._needsBrowser(host)).toBe(false);
    }
  });
});

describe("UrlCollector _parseHtml", () => {
  let collector;

  beforeEach(() => {
    collector = new UrlCollector();
  });

  it("知乎专栏：优先从 .Post-RichTextContainer 提取正文，排除导航/侧栏/页脚", () => {
    const result = collector._parseHtml(zhihuColumnHtml(), "https://zhuanlan.zhihu.com/p/368038553");
    expect(result.title).toBe("知乎专栏文章标题");
    expect(result.content).toContain("这是知乎专栏的正文内容");
    expect(result.content).not.toContain("导航栏无关内容");
    expect(result.content).not.toContain("侧栏推荐内容");
    expect(result.content).not.toContain("页脚版权信息");
    expect(result.source).toBe("知乎");
    expect(result.publishTime).toBe("2024-01-01T00:00:00+08:00");
    expect(result.coverImage).toBe("https://example.com/cover.jpg");
  });

  it("知乎问题回答：优先从 .RichContent-inner 提取首个回答正文", () => {
    const result = collector._parseHtml(zhihuAnswerHtml(), "https://www.zhihu.com/question/12345678/answer/87654321");
    expect(result.content).toContain("这是知乎某个回答的完整正文内容");
    expect(result.content).not.toContain("第二个回答的正文");
    expect(result.content).not.toContain("顶部导航");
    expect(result.content).not.toContain("相关推荐");
  });

  it("通用站点：回退到 article 标签", () => {
    const result = collector._parseHtml(genericArticleHtml(), "https://example.com/post/1");
    expect(result.content).toContain("普通站点正文内容");
    expect(result.content).not.toContain("页脚");
  });

  it("无 article/main 时回退到 body", () => {
    const html = `<html><head><title>无结构页</title></head><body>只有正文的页面</body></html>`;
    const result = collector._parseHtml(html, "https://example.com/plain");
    expect(result.content).toContain("只有正文的页面");
  });

  it("zhihu.com（无 www）也走回答提取分支", () => {
    const result = collector._parseHtml(zhihuAnswerHtml(), "https://zhihu.com/question/12345678/answer/87654321");
    expect(result.content).toContain("这是知乎某个回答的完整正文内容");
  });

  it("百家号：SPA <p> 段落聚合，取含最多 <p> 的容器为正文，排除导航/侧栏/导读", () => {
    const result = collector._parseHtml(baijiahaoHtml(), "https://baijiahao.baidu.com/s?id=1873093353787420593");
    // 正文容器含 4 个 <p>，其余容器段落更少
    expect(result.content).toContain("上次发了一篇文章");
    expect(result.content).toContain("周六又发了一个");
    expect(result.content).toContain("听起来像是黄仁勋");
    expect(result.content).toContain("真正的福利是");
    // 排除侧栏/导航/导读内容
    expect(result.content).not.toContain("AI导读");
    expect(result.content).not.toContain("相关推荐");
    expect(result.content).not.toContain("首页");
  });

  it("百家号：无 og:title 时回退 h1 或 <title>", () => {
    const result = collector._parseHtml(baijiahaoHtml(), "https://baijiahao.baidu.com/s?id=1873093353787420593");
    // 百家号 SPA 无 og:title meta，title 来自 <title> 标签
    expect(result.title).toContain("英伟达");
  });
});

/**
 * 回归保护（2026-09-16）：采集页正文丢失原文换行/分段。
 *
 * 根因：通用回退分支用 `.text().trim().replace(/\s+/g, ' ')`，把包括换行在内的所有连续
 * 空白压成单个半角空格 → 正文变成一整行，用户侧表现为「采集到的文字没有分行和分段，
 * 一整篇看着非常乱」，送进 AI 改写的正文也同时失去段落结构。
 *
 * 逃逸原因（为什么旧测试没拦住）：此前所有正文断言都是 `toContain` 子串匹配，
 * 没有任何一条锁定段落结构 —— 整篇压成一行时，每个子串依然命中。
 * 因此本 describe 一律用 `toBe` 精确锁定段落结构，旧实现必然失败。
 */
describe("UrlCollector 正文换行/分段保留（回归：正文被压成一整行）", () => {
  let collector;

  beforeEach(() => {
    collector = new UrlCollector();
  });

  it("通用站点：段落之间保留空行，列表项之间单换行（精确匹配）", () => {
    const html = `<html><head><title>T</title></head><body><article>
      <h2>小标题</h2>
      <p>第一段。</p>
      <p>第二段。</p>
      <ul><li>要点一</li><li>要点二</li></ul>
    </article></body></html>`;
    const result = collector._parseHtml(html, "https://example.com/post/98");
    // 旧实现：整篇被压成 "小标题 第一段。 第二段。 要点一 要点二"（零换行）
    expect(result.content).toBe("小标题\n\n第一段。\n\n第二段。\n\n要点一\n要点二");
  });

  it("<br> 强制换行保留为单个换行（不产生空行）", () => {
    const html = `<html><body><article><p>第一行<br>第二行<br>第三行</p></article></body></html>`;
    const result = collector._parseHtml(html, "https://example.com/post/99");
    expect(result.content).toBe("第一行\n第二行\n第三行");
  });

  it("行内多余空白仍被压缩为单个空格（换行不受影响）", () => {
    const html = `<html><body><article><p>甲   乙\t丙\u3000丁</p></article></body></html>`;
    const result = collector._parseHtml(html, "https://example.com/post/100");
    expect(result.content).toBe("甲 乙 丙 丁");
  });

  it("连续 3 个以上换行压缩为 1 个空行，首尾换行被去除", () => {
    // 真实页面源码缩进会在块级元素之间产生大量空白
    const html = `<html><body><article>\n\n\n<p>甲</p>\n\n\n\n\n<p>乙</p>\n\n</article></body></html>`;
    const result = collector._parseHtml(html, "https://example.com/post/101");
    expect(result.content).toBe("甲\n\n乙");
  });

  it("<pre> 代码块保留内部换行与缩进（不被行内空白压缩抹平）", () => {
    const html = `<html><body><article><p>示例：</p><pre>function a() {\n  return 1\n}</pre><p>结束。</p></article></body></html>`;
    const result = collector._parseHtml(html, "https://example.com/post/102");
    expect(result.content).toBe("示例：\n\nfunction a() {\n  return 1\n}\n\n结束。");
  });

  it("表格单元格不粘连（同一行内以空格分隔，行与行之间换行）", () => {
    const html = `<html><body><article><table><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></table></article></body></html>`;
    const result = collector._parseHtml(html, "https://example.com/post/103");
    expect(result.content).toBe("甲 乙\n丙 丁");
  });

  it("噪声节点（导航/页脚/脚本/侧栏）不进入正文，也不制造伪换行", () => {
    const html = `<html><body><article><nav>导航</nav><p>正文。</p><script>var a=1</script><aside>侧栏</aside><footer>页脚</footer></article></body></html>`;
    const result = collector._parseHtml(html, "https://example.com/post/104");
    expect(result.content).toBe("正文。");
  });

  it("知乎分支（.Post-RichTextContainer）同样保留段落换行", () => {
    const html = `<html><head><meta property="og:site_name" content="知乎"></head><body>
      <div class="Post-RichTextContainer"><div class="RichText ztext Post-RichText"><p>知乎第一段。</p><p>知乎第二段。</p></div></div>
    </body></html>`;
    const result = collector._parseHtml(html, "https://zhuanlan.zhihu.com/p/1");
    expect(result.content).toBe("知乎第一段。\n\n知乎第二段。");
  });

  it("百家号：段落之间为空行（与通用站点格式统一）", () => {
    const html = `<html><head><title>百家号</title></head><body>
      <div class="_2jN0Z"><p>百家号第一段。</p><p>百家号第二段。</p></div>
    </body></html>`;
    const result = collector._parseHtml(html, "https://baijiahao.baidu.com/s?id=1");
    expect(result.content).toBe("百家号第一段。\n\n百家号第二段。");
  });

  it("空正文容器返回空串且不抛错", () => {
    const result = collector._parseHtml("<html><body></body></html>", "https://example.com/empty");
    expect(result.content).toBe("");
  });

  it("超长正文截断到 50000 字符后仍保留段落结构", () => {
    const para = "这是一段用于验证截断行为的正文。";
    const html = `<html><body><article>${Array.from({ length: 3000 }, () => `<p>${para}</p>`).join("")}</article></body></html>`;
    const result = collector._parseHtml(html, "https://example.com/long");
    expect(result.content.length).toBeLessThanOrEqual(50000);
    // 截断后仍是多段落，而非一整行
    expect(result.content).toContain("\n\n");
    expect(result.content.startsWith(para)).toBe(true);
  });
});

describe("UrlCollector SSRF 防护", () => {
  let collector;

  beforeEach(() => {
    collector = new UrlCollector();
  });

  it.each([
    ["http://127.0.0.1:8299/api"],
    ["http://localhost:3000"],
    ["http://10.0.0.1/admin"],
    ["http://192.168.1.1/internal"],
    ["http://172.16.0.1/service"],
    ["http://169.254.169.254/latest/meta-data"],
  ])("拒绝内网地址 %s", async (url) => {
    const result = await collector.collect(url);
    expect(result.success).toBe(false);
    expect(result.error).toContain("内网");
  });

  it("拒绝非 http/https 协议", async () => {
    const result = await collector.collect("file:///etc/passwd");
    expect(result.success).toBe(false);
    expect(result.error).toContain("协议");
  });
});

// 回归保护：百家号采集「超时」误报（实际是 weekend-throttle 被限流拦截，
// 但 IPC 返回缺顶层 message + 前端取错字段 + 分类器 code -1 兜底误判为 timeout）。
// 三个独立缺陷：① baijiahao 无平台映射落 generic（weekendFactor 0.6 随机拒绝）
// ② IPC 失败返回缺顶层 message ③ 前端未读 data.error
describe("UrlCollector 百家号平台映射与 IPC 错误契约（回归：超时误报）", () => {
  let collector;

  beforeEach(() => {
    collector = new UrlCollector({ auditDir: null, log: { info() {}, warn() {}, error() {} } });
  });

  it("baijiahao.baidu.com 映射到 baijiahao 平台（非 generic）", () => {
    expect(collector._platformFromHostname("baijiahao.baidu.com")).toBe("baijiahao");
  });

  it("IPC 失败返回必须带顶层 message（从 data.error 提取）", async () => {
    const handlers = {};
    const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn } };
    collector.registerIpcHandlers(fakeIpc);
    // 模拟限流拦截：collect 返回 { success: false, error: '请求频率受限...', reason }
    collector.collect = async () => ({ success: false, error: "请求频率受限，请稍后再试", reason: "weekend-throttle" });
    const ret = await handlers["url-collect:fetch"](null, { url: "https://baijiahao.baidu.com/s?id=1" });
    expect(ret.code).toBe(-1);
    expect(ret.message).toBe("请求频率受限，请稍后再试");
    expect(ret.data.error).toBe("请求频率受限，请稍后再试");
  });
});

// P0-P2 日志遗漏修复 + 手动采集豁免周末限流
describe("UrlCollector 日志覆盖（P0-P2）+ 手动采集周末豁免", () => {
  let collector;
  let logger;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    collector = new UrlCollector({ auditDir: null, log: logger });
  });

  it("P0: 预算耗尽拦截写应用日志", async () => {
    collector._strategy.checkBudget = () => ({ allowed: false });
    const r = await collector.collect("https://example.com/a");
    expect(r.reason).toBe("budget_exhausted");
    expect(logger.warn).toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).toContain("budget_exhausted");
  });

  it("P0: 熔断拦截写应用日志", async () => {
    collector._circuitBreaker.isOpen = () => true;
    const r = await collector.collect("https://example.com/a");
    expect(r.reason).toBe("circuit_open");
    expect(JSON.stringify(logger.warn.mock.calls)).toContain("circuit_open");
  });

  it("P0: 限流拦截写应用日志（含 reason 与 waitMs）", async () => {
    collector._rateLimiter.evaluate = () => ({ allowed: false, reason: "rate-limit", waitMs: 5000 });
    const r = await collector.collect("https://example.com/a");
    expect(r.reason).toBe("rate-limit");
    expect(JSON.stringify(logger.warn.mock.calls)).toContain("rate-limit");
    expect(JSON.stringify(logger.warn.mock.calls)).toContain("5000");
  });

  // 回归保护：非活跃时段拦截不得误报为「请求过于频繁」（2026-09-13）。
  // 根因：用户 22 点后手动点击采集知乎被 outside-active-hours 拦截，
  // 但统一返回「请求频率受限」→ 前端 classifyCollectError 误判为 rate_limited。
  it("P0: outside-active-hours 拦截错误消息区分（非「请求频率受限」）", async () => {
    collector._rateLimiter.evaluate = () => ({ allowed: false, reason: "outside-active-hours" });
    const r = await collector.collect("https://example.com/a");
    expect(r.reason).toBe("outside-active-hours");
    expect(r.error).not.toContain("请求频率受限");
    expect(r.error).toContain("活跃采集时段");
  });

  it("P1: 缓存命中写应用日志（解释为何返回空数据）", async () => {
    // CI 可能跑在周末（UTC 时差），真实 RateLimiter 会触发 weekend-throttle 拦截，
    // 必须 mock 放行才能到达缓存命中分支
    collector._rateLimiter = { evaluate: () => ({ allowed: true }), recordRequest: () => {} };
    collector._contentCache.hasUrl = () => true;
    const r = await collector.collect("https://example.com/cached");
    expect(r.reason).toBe("cache_hit");
    expect(logger.info).toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).toContain("cache_hit");
  });

  it("P2: 采集成功写 info 日志（含标题/正文长度）", async () => {
    collector._rateLimiter = { evaluate: () => ({ allowed: true }), recordRequest: () => {} };
    collector._needsBrowser = () => false;
    collector._getAxios = () => ({ get: vi.fn().mockResolvedValue({ data: "<html><head><title>T</title></head><body><article><p>正文内容足够长</p></article></body></html>" }) });
    const r = await collector.collect("https://example.com/ok");
    expect(r.success).toBe(true);
    expect(logger.info).toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).toContain("采集成功");
  });

  it("P2: 浏览器采集路径写过程日志", async () => {
    collector._rateLimiter = { evaluate: () => ({ allowed: true }), recordRequest: () => {} };
    collector._collectViaBrowser = async () => ({ success: true, title: "T", content: "C".repeat(100) });
    const r = await collector.collect("https://zhuanlan.zhihu.com/p/1");
    expect(r.success).toBe(true);
    expect(logger.info).toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).toContain("browser");
  });

  it("手动采集（manual）跳过 weekend-throttle 随机拒绝", async () => {
    collector._rateLimiter.evaluate = vi.fn((s) => {
      const factor = s.manual ? 1 : (s.weekendFactor ?? 1);
      if (factor < 1 && 0.99 > factor) return { allowed: false, reason: "weekend-throttle" };
      return { allowed: true };
    });
    collector._collectViaHttp = async () => ({ success: true, title: "T", content: "C" });
    collector._needsBrowser = () => false;
    const r = await collector.collect("https://example.com/m", { manual: true });
    expect(r.success).toBe(true);
    expect(collector._rateLimiter.evaluate).toHaveBeenCalledWith(expect.objectContaining({ manual: true }));
  });

  it("非手动采集仍受 weekend-throttle 限制", async () => {
    collector._rateLimiter.evaluate = vi.fn((s) => {
      const factor = s.manual ? 1 : (s.weekendFactor ?? 1);
      if (factor < 1 && 0.99 > factor) return { allowed: false, reason: "weekend-throttle" };
      return { allowed: true };
    });
    const r = await collector.collect("https://example.com/auto");
    expect(r.success).toBe(false);
    expect(r.reason).toBe("weekend-throttle");
  });

  it("IPC url-collect:fetch 透传 manual 参数", async () => {
    const handlers = {};
    collector.registerIpcHandlers({ handle: (ch, fn) => { handlers[ch] = fn } });
    collector.collect = vi.fn().mockResolvedValue({ success: true, title: "T" });
    await handlers["url-collect:fetch"](null, { url: "https://example.com/x", manual: true });
    expect(collector.collect).toHaveBeenCalledWith("https://example.com/x", { manual: true });
  });
});


// ===================== 互动数据解析（viral-library-integration P0 / F-101~F-103） =====================
// 契约：NULL = 未知（解析失败/页面无数），0 = 真实零互动。绝不猜测填 0，绝不把缺省压平成 0。
describe("UrlCollector 互动数据解析（engagement）", () => {
  const collector = new UrlCollector({ auditDir: null, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });

  // U-101/U-102 数字格式解析（纯函数）
  describe("_parseEngagementNumber", () => {
    it("U-101: 万/w/逗号/纯数字格式", () => {
      expect(UrlCollector._parseEngagementNumber("1.2万")).toBe(12000);
      expect(UrlCollector._parseEngagementNumber("1.2 万")).toBe(12000);
      expect(UrlCollector._parseEngagementNumber("3.4w")).toBe(34000);
      expect(UrlCollector._parseEngagementNumber("1,234")).toBe(1234);
      expect(UrlCollector._parseEngagementNumber("523")).toBe(523);
      expect(UrlCollector._parseEngagementNumber("0")).toBe(0); // 真零保留
      expect(UrlCollector._parseEngagementNumber(1234)).toBe(1234); // JSON 数字原样
    });
    it("U-102: 非法值一律 null（不猜测填 0）", () => {
      for (const bad of [null, undefined, "", "  ", "abc", "-5", NaN, Infinity, {}, [], "1.2.3"]) {
        expect(UrlCollector._parseEngagementNumber(bad)).toBeNull();
      }
      expect(UrlCollector._parseEngagementNumber("99999999999999999999")).toBeNull(); // 超 MAX_SAFE
    });
  });

  // U-103 平台 fixture 页提取
  describe("_parseHtml 返回 engagement 字段", () => {
    it("知乎回答页：VoteButton 计数提取为 likes", () => {
      const html = '<html><body><div class="RichContent-inner"><span class="VoteButton"><span class="CountNumber">1.2 万</span></span></div></body></html>';
      const r = collector._parseHtml(html, "https://www.zhihu.com/question/1/answer/2");
      expect(r.engagement.likes).toBe(12000);
    });
    it("小红书内联 JSON：likedCount/commentCount", () => {
      const state = JSON.stringify({ note: { noteData: { interactInfo: { likedCount: "3456", collectedCount: "12", commentCount: "89" } } } });
      const html = "<html><body><script>window.__INITIAL_STATE__=" + state + "</script></body></html>";
      const r = collector._parseHtml(html, "https://www.xiaohongshu.com/explore/abc");
      expect(r.engagement.likes).toBe(3456);
      expect(r.engagement.comments).toBe(89);
    });
    it("B站 JSON stat：like/reply", () => {
      const html = '<html><body><script>window.__INITIAL_STATE__={"stat":{"aid":1,"view":900,"danmaku":2,"reply":37,"favorite":5,"like":618}}</script></body></html>';
      const r = collector._parseHtml(html, "https://www.bilibili.com/video/BV1xx");
      expect(r.engagement.likes).toBe(618);
      expect(r.engagement.comments).toBe(37);
    });
    it("通用 JSON-LD interactionStatistic", () => {
      const ld = JSON.stringify({ "@type": "Article", interactionStatistic: [{ "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: 400 }, { "@type": "InteractionCounter", interactionType: "http://schema.org/CommentAction", userInteractionCount: 21 }] });
      const html = '<html><head><script type="application/ld+json">' + ld + '</script></head><body><article><p>正文内容足够长可以穿过阈值</p></article></body></html>';
      const r = collector._parseHtml(html, "https://example.com/post");
      expect(r.engagement.likes).toBe(400);
      expect(r.engagement.comments).toBe(21);
    });
    it("无计数页面 → 两字段 null（不是 0）", () => {
      const html = "<html><body><article><p>没有任何计数</p></article></body></html>";
      const r = collector._parseHtml(html, "https://example.com/plain");
      expect(r.engagement).toEqual({ likes: null, comments: null });
    });
    it("页面明确显示 0 → 产出 0（真零语义）", () => {
      const html = '<html><body><span class="VoteButton"><span class="CountNumber">0</span></span></body></html>';
      const r = collector._parseHtml(html, "https://www.zhihu.com/question/1");
      expect(r.engagement.likes).toBe(0);
    });
    it("解析抛错不破坏采集主结果（fail-open）", () => {
      const html = '<html><head><script type="application/ld+json">{invalid json!!</script></head><body><article><p>正文仍然存在</p></article></body></html>';
      const r = collector._parseHtml(html, "https://example.com/bad-ld");
      expect(r.success).toBe(true);
      expect(r.engagement).toEqual({ likes: null, comments: null });
    });
  });
});

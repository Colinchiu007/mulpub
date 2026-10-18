// @ts-check
/**
 * url-collector-antibot 回归测试 — 反爬安全验证页判定 / 采集路由 / 浏览器请求头
 *
 * 背景（2026-10-18 现场）：百家号单篇 URL 采集把「百度安全验证」滑块页当正文返回，
 * 用户侧表现为「采集成功」但正文只有一堆验证文案。现场保存的 3 份 CHALLENGE 页
 * （D:\Temp\baijiahao-probe-out\*-CHALLENGE.html）解析正文均为 114 字，且三份逐字一致：
 *   网络不给力，请稍后重试 返回首页 问题反馈 百度安全验证 请完成下方验证后继续操作
 *   正在验证... 验证通过 图片未转正 网络不给力，请刷新重试 加载中... 图片由AI生成
 *   拖动左侧滑块使图片为正 扫码验证| 意见反馈 |刷新
 * 同目录 3 份 OK 页则一个标记都不含（正文 4000+ 字）。
 *
 * 因此判据取舍是「宁漏不误杀」：
 *   - 结构性信号（最终 URL 落在 wappass captcha 端点 / title 含「百度安全验证」）当场判真；
 *   - 正文只认强标记：≥2 个强标记，或「1 个强标记且正文 <300 字」；
 *   - 弱标记（网络不给力 / 正在验证 / 验证通过 / 加载中 / 图片由AI生成）单独出现**不得**判真
 *     —— 「网络不给力，请刷新重试」是合法长文里极常见的用户抱怨语（误杀反例见下）。
 */
import { describe, it, expect } from "vitest";

const antiBot = (await import("./url-collector-antibot")).default;

/** 实测 CHALLENGE 页正文（114 字，现场三份逐字一致） */
const CHALLENGE_TEXT =
  "网络不给力，请稍后重试 返回首页 问题反馈 百度安全验证 请完成下方验证后继续操作 正在验证... 验证通过 图片未转正 网络不给力，请刷新重试 加载中... 图片由AI生成 拖动左侧滑块使图片为正 扫码验证| 意见反馈 |刷新";
const CHALLENGE_URL = "https://wappass.baidu.com/static/captcha/tuxing.html?ack=abc&traceid=1";
const CHALLENGE_HTML = `<html><head><title>百度安全验证</title></head><body><div class="passMod">${CHALLENGE_TEXT}</div></body></html>`;

/** 实测 OK 页结构：正常文章标题 + 4000+ 字正文，无任何标记 */
const OK_TITLE = "扎克伯格突然感谢库克接班人——这对斗了十年的老冤家，为了一个AI模型握手了";
const OK_TEXT = "苹果与Meta破冰合作，Meta最强开源模型Muse Spark Open亮相，两位CEO罕见同框。".repeat(60);
const OK_HTML = `<html><head><title>${OK_TITLE}</title></head><body><div class="article">${OK_TEXT}</div></body></html>`;

describe("isVerificationHtml（实测 CHALLENGE / OK 页）", () => {
  it("实测 CHALLENGE 页（title=百度安全验证 + 114 字验证文案 + captcha URL）→ 判验证页", () => {
    expect(antiBot.isVerificationHtml(CHALLENGE_HTML, CHALLENGE_URL)).toBe(true);
  });

  it("只有 HTML、没有最终 URL 也能判（title/正文信号自足）", () => {
    expect(antiBot.isVerificationHtml(CHALLENGE_HTML)).toBe(true);
  });

  it("实测 OK 页结构（正常标题 + 长正文）→ 不判验证页", () => {
    expect(antiBot.isVerificationHtml(OK_HTML, "https://baijiahao.baidu.com/s?id=1879211845239319012")).toBe(false);
  });

  it("空/非法输入 → false 且不抛错", () => {
    expect(antiBot.isVerificationHtml("")).toBe(false);
    expect(antiBot.isVerificationHtml(null)).toBe(false);
    expect(antiBot.isVerificationHtml(undefined, undefined)).toBe(false);
  });

  it("正文强标记在 <script> 外才生效：脚本里出现标记不单独判真（噪声隔离）", () => {
    // 合法长文页的统计脚本可能内联「验证通过」等词；htmlToText 必须剔除 script/style
    const html = `<html><head><title>正常文章</title></head><body><script>var s = "正在验证... 验证通过 加载中...";</script><div>${OK_TEXT}</div></body></html>`;
    expect(antiBot.isVerificationHtml(html, "https://example.com/post/1")).toBe(false);
  });
});

describe("isVerificationPage 判据优先级", () => {
  it("最终 URL 落在 wappass captcha 端点 → true（结构性信号，即使正文很长）", () => {
    expect(antiBot.isVerificationPage({ url: CHALLENGE_URL, title: OK_TITLE, text: OK_TEXT })).toBe(true);
  });

  it("title 含「百度安全验证」→ true（结构性信号，即使正文很长）", () => {
    expect(antiBot.isVerificationPage({ title: "百度安全验证", text: OK_TEXT })).toBe(true);
  });

  it("只传 HTML 时 title 从 HTML 提取（浏览器通道按 { url, html } 判，title 信号不能丢）", () => {
    const html = `<html><head><title>百度安全验证</title></head><body><div>${OK_TEXT}</div></body></html>`;
    expect(antiBot.isVerificationPage({ html })).toBe(true);
    expect(antiBot.isVerificationPage({ url: "https://baijiahao.baidu.com/s?id=1", html })).toBe(true);
  });

  it("≥2 个强标记 → true（长文本也判）", () => {
    const text = "请完成下方验证后继续操作 " + "拖动左侧滑块使图片为正 " + "正文说明".repeat(120);
    expect(antiBot.isVerificationPage({ text })).toBe(true);
  });

  it("1 个强标记 + 正文 <300 字 → true", () => {
    expect(antiBot.isVerificationPage({ text: "请完成下方验证后继续操作 请稍后再试" })).toBe(true);
  });

  it("1 个强标记 + 正文 ≥300 字 → false（单标记不够，宁漏不误杀）", () => {
    const text = "请完成下方验证后继续操作 " + "正文".repeat(200);
    expect(antiBot.isVerificationPage({ text })).toBe(false);
  });

  it("弱标记全部命中但无强标记 → false（弱标记不得单独判真）", () => {
    const text =
      "网络不给力，请刷新重试 正在验证... 验证通过 加载中... 图片由AI生成 " + "正文内容".repeat(100);
    expect(antiBot.isVerificationPage({ text })).toBe(false);
  });

  it("误杀反例：合法长文含「网络不给力，请刷新重试」→ false", () => {
    const text =
      "我家宽带上周末一直抽风，页面老是提示「网络不给力，请刷新重试」，刷新十几次才打开后台。" +
      "后来换了 DNS 才恢复正常，这里记录一下排查过程，供遇到同类问题的同学参考。".repeat(6);
    expect(antiBot.isVerificationPage({ title: "一次宽带 DNS 故障排查记录", text })).toBe(false);
  });

  it("实测 CHALLENGE 文本（无 URL/title，仅正文）→ true（强标记 ≥2）", () => {
    expect(antiBot.isVerificationPage({ text: CHALLENGE_TEXT })).toBe(true);
  });

  it("「扫码验证| 意见反馈 |刷新」组合页脚单独出现（长文本）→ false（仍是单标记）", () => {
    const text = "扫码验证 | 意见反馈 | 刷新 " + "正文".repeat(200);
    expect(antiBot.isVerificationPage({ text })).toBe(false);
  });

  it("组合页脚 + 另一强标记 → true（合计 2 个强标记）", () => {
    const text = "请完成下方验证后继续操作 扫码验证| 意见反馈 |刷新 " + "正文".repeat(200);
    expect(antiBot.isVerificationPage({ text })).toBe(true);
  });

  it("空输入 → false 且不抛错", () => {
    expect(antiBot.isVerificationPage({})).toBe(false);
    expect(antiBot.isVerificationPage()).toBe(false);
    expect(antiBot.isVerificationPage({ url: null, title: null, html: null, text: null })).toBe(false);
  });
});

describe("securityChallengeFailure 失败结构（前端 classifyCollectError 命中契约）", () => {
  it("success=false + reason=security_challenge + error 含「安全验证」", () => {
    const r = antiBot.securityChallengeFailure();
    expect(r.success).toBe(false);
    expect(r.reason).toBe("security_challenge");
    expect(r.error).toBe(antiBot.SECURITY_CHALLENGE_ERROR);
    // 前端 classifyCollectError 靠 message 里的「安全验证」命中 security_challenge
    expect(r.error).toContain("安全验证");
    expect(r.error).toContain("百度安全验证");
  });
});

describe("buildBrowserHeaders 完整浏览器请求头", () => {
  const headers = antiBot.buildBrowserHeaders();

  it("Chrome 131 UA（防御性加固：完整浏览器头降低被识别为脚本的概率）", () => {
    // 证据口径校正（2026-10-18）：普通 HTTP 通道探测百家号 20/20 成功、与 UA 完整/截断无关；
    // 挑战只出现在 headless 浏览器通道且概率性出现。完整头仅作加固，不是挑战的已证原因。
    expect(headers["User-Agent"]).toMatch(/Chrome\/131\.\d+\.\d+\.\d+/);
    expect(headers["User-Agent"]).toMatch(/Mozilla\/5\.0/);
    expect(headers["User-Agent"]).toMatch(/Windows NT 10\.0/);
  });

  it("Accept / Accept-Language / Accept-Encoding 齐备", () => {
    expect(headers.Accept).toContain("text/html");
    expect(headers["Accept-Language"]).toMatch(/zh-CN/);
    expect(headers["Accept-Encoding"]).toMatch(/gzip/);
  });

  it("Upgrade-Insecure-Requests + Sec-Fetch-* 齐备（缺任一都像脚本请求）", () => {
    expect(headers["Upgrade-Insecure-Requests"]).toBe("1");
    expect(headers["Sec-Fetch-Dest"]).toBe("document");
    expect(headers["Sec-Fetch-Mode"]).toBe("navigate");
    expect(headers["Sec-Fetch-Site"]).toBe("none");
    expect(headers["Sec-Fetch-User"]).toBe("?1");
  });
});

describe("采集路由拆分（浏览器优先 vs HTTP 优先）", () => {
  it("ANTI_CRAWL_HOSTNAMES 只保留知乎类（浏览器优先）", () => {
    expect([...antiBot.ANTI_CRAWL_HOSTNAMES].sort()).toEqual([
      "www.zhihu.com",
      "zhihu.com",
      "zhuanlan.zhihu.com",
    ]);
    expect(antiBot.isAntiCrawlHost("www.zhihu.com")).toBe(true);
    expect(antiBot.isAntiCrawlHost("baijiahao.baidu.com")).toBe(false);
  });

  it("NODE_HTTP_FIRST_HOSTNAMES 含百家号（HTTP 优先）", () => {
    expect([...antiBot.NODE_HTTP_FIRST_HOSTNAMES].sort()).toEqual([
      "baijiahao.baidu.com",
      "mbd.baidu.com",
    ]);
    expect(antiBot.isHttpFirstHost("baijiahao.baidu.com")).toBe(true);
    expect(antiBot.isHttpFirstHost("mbd.baidu.com")).toBe(true);
    expect(antiBot.isHttpFirstHost("www.zhihu.com")).toBe(false);
  });

  it("routeFor 三分支：browser / http-first / http", () => {
    expect(antiBot.routeFor("zhuanlan.zhihu.com")).toBe("browser");
    expect(antiBot.routeFor("baijiahao.baidu.com")).toBe("http-first");
    expect(antiBot.routeFor("mbd.baidu.com")).toBe("http-first");
    expect(antiBot.routeFor("example.com")).toBe("http");
  });
});

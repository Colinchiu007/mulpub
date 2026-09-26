import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * http-login-checker — fetchAccountInfoViaHttpApi（platform_uid 提取）契约
 *
 * 命名约定（由 http-login-checker-uid-coverage.test.js 结构锁强制，改标题前先读那个文件）：
 *  - 每个平台至少一条**正例**：标题以「<平台key> 」开头，断言里出现非空 `platformAccountId: "…"`；
 *  - 每个平台至少一条**负例**：标题以「<平台key> 」开头且含「未登录」或「login page」，
 *    断言必须是整对象精确相等 `toEqual({ supported: true|false })`
 *    ——即「uid 缺失」的形态本身被钉住，不允许用 toContain 式弱断言蒙过。
 *  - 追加用例（结构变更、多用户污染等）不受命名约定约束，但同样禁止真实出站：
 *    所有响应都是喂进来的 fixture（test-setup 的出站守卫会把真网络变成即时失败）。
 */

describe("http-login-checker fetchAccountInfoViaHttpApi", () => {
  let checker;
  beforeEach(async () => {
    vi.resetModules();
    global.__enableElectronMock();
    global.__resetElectronMock();
    __registerMock("./logger", { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
    checker = await import("./http-login-checker.js");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 喂一个 JSON 响应（不发真实网络请求） */
  const mockJson = (data) => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(data) });
    vi.stubGlobal("fetch", f);
    return f;
  };
  /** 喂一个 HTML 响应（不发真实网络请求） */
  const mockHtml = (html) => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(html) });
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("weibo 未登记任何 uid/资料提取来源，返回 supported:false", async () => {
    expect(
      await checker.fetchAccountInfoViaHttpApi("weibo", [{ name: "a", value: "b" }]),
    ).toEqual({ supported: false });
  });
  it("无 cookie 返回 supported:true 无字段（不发请求）", async () => {
    expect(await checker.fetchAccountInfoViaHttpApi("douyin", [])).toEqual({ supported: true });
  });

  // ─── douyin（json 来源）───────────────────────────────
  it("douyin 提取昵称与平台ID（无粉丝字段则省略键）", async () => {
    mockJson({ status_code: 0, data: { uid: "u1", nickname: "抖昵称" } });
    expect(
      await checker.fetchAccountInfoViaHttpApi("douyin", [{ name: "sessionid", value: "x" }]),
    ).toEqual({ supported: true, nickname: "抖昵称", platformAccountId: "u1" });
  });
  it("douyin 未登录（status_code:8 明确未登录）不产出 uid", async () => {
    mockJson({ status_code: 8, status_msg: "未登录" });
    expect(
      await checker.fetchAccountInfoViaHttpApi("douyin", [{ name: "sessionid", value: "x" }]),
    ).toEqual({ supported: true });
  });
  it("douyin 响应结构变更（缺 uid/user_id）不猜值、不拿昵称顶替", async () => {
    mockJson({ status_code: 0, data: { nickname: "只有昵称" } });
    expect(
      await checker.fetchAccountInfoViaHttpApi("douyin", [{ name: "sessionid", value: "x" }]),
    ).toEqual({ supported: true, nickname: "只有昵称" });
  });

  // ─── toutiao（json 来源）──────────────────────────────
  it("toutiao 从 data.user 提取昵称与粉丝", async () => {
    mockJson({ code: 0, data: { user: { id: "t1", name: "条昵称", fans_count: 66 } } });
    expect(
      await checker.fetchAccountInfoViaHttpApi("toutiao", [{ name: "x", value: "y" }]),
    ).toEqual({ supported: true, nickname: "条昵称", followers: 66, platformAccountId: "t1" });
  });
  it("toutiao 未登录（message「请先登录」，登录页/无 user 形状）不产出 uid", async () => {
    mockJson({ code: 3, message: "请先登录", data: null });
    expect(
      await checker.fetchAccountInfoViaHttpApi("toutiao", [{ name: "x", value: "y" }]),
    ).toEqual({ supported: true });
  });

  // ─── tencent_video（json 来源，finderUser.uniqId）───────
  it("tencent_video 提取昵称与粉丝 fansCount（对齐参考实现 finderUser）", async () => {
    mockJson({
      errCode: 0,
      data: { finderUser: { uniqId: "wx1", nickname: "视昵称", fansCount: 12345 } },
    });
    expect(
      await checker.fetchAccountInfoViaHttpApi("tencent_video", [{ name: "x", value: "y" }]),
    ).toEqual({ supported: true, nickname: "视昵称", followers: 12345, platformAccountId: "wx1" });
  });
  it("tencent_video 未登录（errCode 300333 登录失效、finderUser 缺席）不产出 uid", async () => {
    mockJson({ errCode: 300333, errMsg: "登录失效" });
    expect(
      await checker.fetchAccountInfoViaHttpApi("tencent_video", [{ name: "x", value: "y" }]),
    ).toEqual({ supported: true });
  });

  // ─── bilibili（json 来源，data.mid）────────────────────
  it("bilibili 缺 bili_jct 时 precheck 拦截、不发请求", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(
      await checker.fetchAccountInfoViaHttpApi("bilibili", [{ name: "SESSDATA", value: "x" }]),
    ).toEqual({ supported: true });
    expect(f).not.toHaveBeenCalled();
  });
  it("bilibili 从 data.mid 提取平台ID与昵称", async () => {
    mockJson({ code: 0, data: { mid: 31000000, uname: "站昵称", fans: 77 } });
    expect(
      await checker.fetchAccountInfoViaHttpApi("bilibili", [{ name: "bili_jct", value: "x" }]),
    ).toEqual({ supported: true, nickname: "站昵称", followers: 77, platformAccountId: "31000000" });
  });
  it("bilibili 未登录（code -101 请登录，data 为 false）不产出 uid", async () => {
    mockJson({ code: -101, message: "请填写密码", data: false });
    expect(
      await checker.fetchAccountInfoViaHttpApi("bilibili", [{ name: "bili_jct", value: "x" }]),
    ).toEqual({ supported: true });
  });

  // ─── wechat_mp（html 来源：与 checkHtml 同源同页的 uin）───
  // 登录态 loginpage 才会内嵌 token + uin:"<数字>"（公众号账号原生 ID）。
  const WECHAT_MP_LOGGED_IN_HTML =
    '<!doctype html><html><head><title>微信公众平台</title></head><body>' +
    '<script>window.token = "123456789";window.uin = "3100000001";</script>' +
    '<script>var pageData = { uin: "3100000001", nick_name: "公众号甲" };</script>' +
    '<a href="/cgi-bin/home?t=home/index&token=123456789">首页</a></body></html>';
  const WECHAT_MP_LOGIN_PAGE_HTML =
    '<!doctype html><html><head><title>微信公众平台</title></head><body>' +
    '<div class="login_scanTips">请使用微信扫码</div><p>扫码登录</p>' +
    '<script>var pageData = { uin: "", nick_name: "" };</script></body></html>';

  it("wechat_mp 从登录态 loginpage HTML 的 uin 提取平台ID（无 JSON 端点，与登录判定同源）", async () => {
    const f = mockHtml(WECHAT_MP_LOGGED_IN_HTML);
    expect(
      await checker.fetchAccountInfoViaHttpApi("wechat_mp", [{ name: "slave_sid", value: "v" }]),
    ).toEqual({ supported: true, platformAccountId: "3100000001" });
    // 端点必须是已注册的 loginpage（不新增、不编造 URL）
    expect(f.mock.calls[0][0]).toBe("https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome");
  });
  it("wechat_mp 未登录 login page（扫码登录页，uin 为空串）不产出 uid", async () => {
    mockHtml(WECHAT_MP_LOGIN_PAGE_HTML);
    expect(
      await checker.fetchAccountInfoViaHttpApi("wechat_mp", [{ name: "slave_sid", value: "v" }]),
    ).toEqual({ supported: true });
  });
  it("wechat_mp uid 提取与登录判定共用同一份证据：登录页被 checkHtml 判 false 时 extract 也不产出", () => {
    const { checkHtml, extract } = checker.HTTP_CHECK_APIS.wechat_mp;
    expect(checkHtml(WECHAT_MP_LOGGED_IN_HTML)).toBe(true);
    expect(extract(WECHAT_MP_LOGGED_IN_HTML)).toEqual({ platformAccountId: "3100000001" });
    expect(checkHtml(WECHAT_MP_LOGIN_PAGE_HTML)).toBe(false);
    expect(extract(WECHAT_MP_LOGIN_PAGE_HTML)).toEqual({});
  });

  // ─── kuaishou（cookie 来源：登录后身份 Cookie，不发请求）───
  // 匿名/埋点 Cookie 名取自 2026-09-25 实测（platform-definitions.test.js 同款清单）。
  const KS_ANONYMOUS_COOKIES = ["did", "wid", "_did", "divid", "kwssectoken", "kwpsecproductname", "kwfv1", "kwscode"]
    .map((name) => ({ name, value: "anon-" + name }));

  it("kuaishou 从登录后身份 Cookie userId 派生平台ID（纯本地，不发任何网络请求）", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(
      await checker.fetchAccountInfoViaHttpApi("kuaishou", [
        ...KS_ANONYMOUS_COOKIES,
        { name: "kuaishou.web.cp.api_st", value: "ST-123" },
        { name: "userId", value: "5321009876543" },
      ]),
    ).toEqual({ supported: true, platformAccountId: "5321009876543" });
    expect(f).not.toHaveBeenCalled();
  });
  it("kuaishou 未登录（login page 只写入 did/wid/divid 埋点标识）不得产出 uid", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await checker.fetchAccountInfoViaHttpApi("kuaishou", KS_ANONYMOUS_COOKIES))
      .toEqual({ supported: true });
    expect(f).not.toHaveBeenCalled();
  });
  it("kuaishou 设备标识冒充（仅有 did/wid/divid 同名值）一律不作为 uid", async () => {
    // 「有 Cookie」不等于「已登录」：过不了会话标记门禁时，即使 did 的值形似 ID 也不产出
    expect(
      await checker.fetchAccountInfoViaHttpApi("kuaishou", [
        { name: "did", value: "5321009876543" },
        { name: "divid", value: "5321009876543" },
      ]),
    ).toEqual({ supported: true });
  });
  it("kuaishou 已登录但 userId 值形态不合规（模板占位）时不产出 uid", async () => {
    expect(
      await checker.fetchAccountInfoViaHttpApi("kuaishou", [
        { name: "kuaishou.web.cp.api_st", value: "ST-123" },
        { name: "userId", value: "{{userId}}" },
      ]),
    ).toEqual({ supported: true });
  });
  it("kuaishou 未登记登录检测端点：检测路径必须保持 supported:false（不因为登记 uid 来源而改变行为）", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await checker.checkLoginViaHttpApi("kuaishou", [{ name: "userId", value: "1" }]))
      .toEqual({ supported: false });
    expect(checker.isHttpCheckSupported("kuaishou")).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  // ─── xiaohongshu / zhihu（html 来源：SSR 身份属性，全页唯一命中）───
  it("xiaohongshu 从 SSR HTML 的 data-account-id 提取平台ID（唯一命中）", async () => {
    mockHtml(
      '<!doctype html><html><body><div id="app"><span class="user-name" data-account-id="5f1a2b3c00000000002a1b3c">小红昵称</span></div></body></html>',
    );
    expect(
      await checker.fetchAccountInfoViaHttpApi("xiaohongshu", [{ name: "web_session", value: "v" }]),
    ).toEqual({ supported: true, platformAccountId: "5f1a2b3c00000000002a1b3c" });
  });
  it("xiaohongshu 未登录 login page（登录壳里没有任何身份属性）不产出 uid", async () => {
    mockHtml(
      '<!doctype html><html><head><title>小红书创作服务平台</title></head><body>' +
      '<div class="login-container"><span>扫码登录</span><input placeholder="手机号" /></div></body></html>',
    );
    expect(
      await checker.fetchAccountInfoViaHttpApi("xiaohongshu", [{ name: "web_session", value: "v" }]),
    ).toEqual({ supported: true });
  });
  it("xiaohongshu 页面含多个互不相同的身份属性（评论/协作访客）时不产出 uid", async () => {
    mockHtml(
      '<!doctype html><html><body>' +
      '<div data-user-id="5f1a2b3c00000000002a1b3c"></div>' +
      '<div data-user-id="9a8b7c6d5e4f3a2b1c0d9e8f"></div></body></html>',
    );
    expect(
      await checker.fetchAccountInfoViaHttpApi("xiaohongshu", [{ name: "web_session", value: "v" }]),
    ).toEqual({ supported: true });
  });

  it("zhihu 从 SSR HTML 的 data-user-id 提取平台ID（唯一命中）", async () => {
    const f = mockHtml(
      '<!doctype html><html><body><header class="AppHeader">' +
      '<a class="AppHeader-profile" href="/people/ming-yue-88" data-user-id="013a4b7c9d2e4f6a8b0c1d2e3f4a5b6c">甲公司</a>' +
      "</header></body></html>",
    );
    expect(
      await checker.fetchAccountInfoViaHttpApi("zhihu", [{ name: "z_c0", value: "v" }]),
    ).toEqual({ supported: true, platformAccountId: "013a4b7c9d2e4f6a8b0c1d2e3f4a5b6c" });
    expect(f.mock.calls[0][0]).toBe("https://www.zhihu.com/");
  });
  it("zhihu 未登录 login page（页面标题「首页 - 知乎」及其派生值不得当 uid）", async () => {
    mockHtml(
      '<!doctype html><html><head><title>首页 - 知乎</title>' +
      '<meta property="og:title" content="首页 - 知乎"></head><body>' +
      '<div class="SignContainer"><span>登录知乎</span><input name="username" /></div></body></html>',
    );
    expect(
      await checker.fetchAccountInfoViaHttpApi("zhihu", [{ name: "z_c0", value: "v" }]),
    ).toEqual({ supported: true });
  });
  it("zhihu 身份属性为模板占位/空值（SSR 未填充）时不产出 uid", async () => {
    mockHtml(
      '<!doctype html><html><body><div data-user-id="" data-account-id="{{userId}}"></div></body></html>',
    );
    expect(
      await checker.fetchAccountInfoViaHttpApi("zhihu", [{ name: "z_c0", value: "v" }]),
    ).toEqual({ supported: true });
  });

  // ─── 通道级降级：非 2xx / 非对象响应一律不产出（不判失效）───
  it("HTML 来源平台返回非 2xx 时不产出 uid（降级语义不变）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve("") }));
    expect(
      await checker.fetchAccountInfoViaHttpApi("zhihu", [{ name: "z_c0", value: "v" }]),
    ).toEqual({ supported: true });
  });
});

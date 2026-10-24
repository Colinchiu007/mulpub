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
  /**
   * 按 URL 逐个喂响应（多端点平台用；未登记的 URL → 404）。
   * 资料通道自 2026-10-22 起与登录判定**分表**（HTTP_PROFILE_APIS），
   * 一个平台的昵称/头像/粉丝/平台ID 可能分散在多个端点上。
   */
  const mockRoutes = (routes) => {
    const f = vi.fn(async (url) => {
      const hit = routes[url];
      if (hit === undefined) return { ok: false, status: 404, text: () => Promise.resolve(""), json: () => Promise.resolve(null) };
      if (typeof hit === "string") return { ok: true, status: 200, text: () => Promise.resolve(hit) };
      return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(hit)), json: () => Promise.resolve(hit) };
    });
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
  // 断言变更（2026-10-22，带实测证据）：抖音的资料端点是
  // `GET creator.douyin.com/web/api/media/user/info/`，真实响应里 user 在**顶层**
  // （实测 `{"status_code":0,"user":{nickname,uid,follower_count,avatar_larger:{url_list[]}},…}`），
  // 原实现读 `data.user` ⇒ 昵称/头像/粉丝恒空 ⇒ 账号卡显示平台名。
  it("douyin 提取昵称、头像与平台ID（顶层 user 对象）", async () => {
    mockRoutes({
      "https://creator.douyin.com/web/api/media/user/info/": {
        status_code: 0,
        user: {
          nickname: "抖昵称",
          uid: "u1",
          follower_count: 266,
          avatar_larger: { url_list: ["https://p3.douyinpic.com/aweme/1080x1080/aweme-avatar/x.jpeg"] },
        },
      },
    });
    expect(
      await checker.fetchAccountInfoViaHttpApi("douyin", [{ name: "sessionid", value: "x" }]),
    ).toEqual({
      supported: true,
      nickname: "抖昵称",
      avatar: "https://p3.douyinpic.com/aweme/1080x1080/aweme-avatar/x.jpeg",
      followers: 266,
      platformAccountId: "u1",
    });
  });
  it("douyin 未登录（status_code:8 明确未登录）不产出 uid", async () => {
    mockJson({ status_code: 8, status_msg: "未登录" });
    expect(
      await checker.fetchAccountInfoViaHttpApi("douyin", [{ name: "sessionid", value: "x" }]),
    ).toEqual({ supported: true });
  });
  it("douyin 响应结构变更（user 缺 uid）不猜值、不拿昵称顶替", async () => {
    mockRoutes({
      "https://creator.douyin.com/web/api/media/user/info/": { status_code: 0, user: { nickname: "只有昵称" } },
    });
    expect(
      await checker.fetchAccountInfoViaHttpApi("douyin", [{ name: "sessionid", value: "x" }]),
    ).toEqual({ supported: true, nickname: "只有昵称" });
  });

  // ─── toutiao（json 来源）──────────────────────────────
  // 断言变更（2026-10-22，带实测证据）：头条的昵称/头像在 `data.media`
  // （display_name / https_avatar_url —— 字段名是「https_avatar_url」不是「avatar_url」），
  // 粉丝数在**另一个**端点 `statistic/v2/fans/latest_stat` 的 `data.fans_stat.total_fans_count`。
  it("toutiao 从 data.media 提取昵称与头像，粉丝取 fans/latest_stat", async () => {
    mockRoutes({
      "https://mp.toutiao.com/mp/agw/media/get_media_info": {
        code: 0,
        data: {
          media: { display_name: "条昵称", id: "t1", https_avatar_url: "https://p6.toutiaoimg.com/img/user-avatar/abc~300x300.image" },
          user: { id: "t1", screen_name: "条昵称" },
        },
      },
      "https://mp.toutiao.com/mp/agw/statistic/v2/fans/latest_stat": {
        data: { fans_stat: { total_fans_count: 66 } },
      },
    });
    expect(
      await checker.fetchAccountInfoViaHttpApi("toutiao", [{ name: "x", value: "y" }]),
    ).toEqual({
      supported: true,
      nickname: "条昵称",
      avatar: "https://p6.toutiaoimg.com/img/user-avatar/abc~300x300.image",
      followers: 66,
      platformAccountId: "t1",
    });
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
  // 断言变更（2026-10-22，带实测证据）：B 站昵称/头像在 nav 的 `data.uname` / `data.face`；
  // 粉丝数在 `x/relation/stat?vmid=<mid>`，必须先由 nav 拿到 mid。
  it("bilibili 从 nav 提取平台ID、昵称与头像，粉丝取 relation/stat", async () => {
    mockRoutes({
      "https://api.bilibili.com/x/web-interface/nav": {
        code: 0,
        data: { mid: 31000000, uname: "站昵称", face: "https://i0.hdslb.com/bfs/face/member/noface.jpg" },
      },
      "https://api.bilibili.com/x/relation/stat?vmid=31000000": { code: 0, data: { follower: 77 } },
    });
    expect(
      await checker.fetchAccountInfoViaHttpApi("bilibili", [{ name: "bili_jct", value: "x" }]),
    ).toEqual({
      supported: true,
      nickname: "站昵称",
      avatar: "https://i0.hdslb.com/bfs/face/member/noface.jpg",
      followers: 77,
      platformAccountId: "31000000",
    });
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

  it("wechat_mp 从登录态 loginpage HTML 的 uin 提取平台ID与昵称（无 JSON 端点，与登录判定同源）", async () => {
    const f = mockHtml(WECHAT_MP_LOGGED_IN_HTML);
    expect(
      await checker.fetchAccountInfoViaHttpApi("wechat_mp", [{ name: "slave_sid", value: "v" }]),
    ).toEqual({ supported: true, nickname: "公众号甲", platformAccountId: "3100000001" });
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

  // ─── xiaohongshu / zhihu（json 来源：平台自己的 user-info 只读接口）───
  // 断言变更（2026-10-22，带实测证据）：小红书的身份与资料来自
  // `GET creator.xiaohongshu.com/api/galaxy/user/info`（B 阶段真实抓包 + 本轮实测互证），
  // 真实字段是 `data.userId` / `data.userName` / `data.userAvatar`。
  // 原实现从 SSR HTML 的 `data-account-id` 取 uid —— 那条路实测取不到（生产库
  // 小红书账号的 platform_account_id 一直是空），故改走平台自己的接口。
  it("xiaohongshu 从 galaxy/user/info 提取平台ID（data.userId）", async () => {
    mockRoutes({
      "https://creator.xiaohongshu.com/api/galaxy/user/info": {
        success: true,
        data: { userId: "5f1a2b3c00000000002a1b3c", userName: "小红昵称", userAvatar: "https://sns-avatar-qc.xhscdn.com/avatar/abc" },
      },
      "https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info": { success: true, data: { fans_count: 457 } },
    });
    expect(
      await checker.fetchAccountInfoViaHttpApi("xiaohongshu", [{ name: "web_session", value: "v" }]),
    ).toEqual({
      supported: true,
      nickname: "小红昵称",
      avatar: "https://sns-avatar-qc.xhscdn.com/avatar/abc",
      followers: 457,
      platformAccountId: "5f1a2b3c00000000002a1b3c",
    });
  });
  it("xiaohongshu 未登录 login page（success 不为 true / data 缺席）不产出 uid", async () => {
    mockRoutes({
      "https://creator.xiaohongshu.com/api/galaxy/user/info": { success: false, code: -101 },
      "https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info": { success: false, code: -101 },
    });
    expect(
      await checker.fetchAccountInfoViaHttpApi("xiaohongshu", [{ name: "web_session", value: "v" }]),
    ).toEqual({ supported: true });
  });
  it("xiaohongshu 响应结构变更（data 缺身份字段）不产出 uid", async () => {
    mockRoutes({
      "https://creator.xiaohongshu.com/api/galaxy/user/info": { success: true, data: { desc: "无身份字段" } },
      "https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info": { success: true, data: {} },
    });
    expect(
      await checker.fetchAccountInfoViaHttpApi("xiaohongshu", [{ name: "web_session", value: "v" }]),
    ).toEqual({ supported: true });
  });

  it("zhihu 从 /api/v4/me 提取平台ID、昵称与头像", async () => {
    mockRoutes({
      "https://www.zhihu.com/api/v4/me": {
        id: "013a4b7c9d2e4f6a8b0c1d2e3f4a5b6c",
        url_token: "ming-yue-88",
        name: "秋叔",
        avatar_url: "https://picx.zhimg.com/v2-22dfe7094375e34e38695123acd219db_xl.jpg",
      },
    });
    expect(
      await checker.fetchAccountInfoViaHttpApi("zhihu", [{ name: "z_c0", value: "v" }]),
    ).toEqual({
      supported: true,
      nickname: "秋叔",
      avatar: "https://picx.zhimg.com/v2-22dfe7094375e34e38695123acd219db_xl.jpg",
      platformAccountId: "013a4b7c9d2e4f6a8b0c1d2e3f4a5b6c",
    });
  });
  it("zhihu 未登录 login page（响应里没有身份字段）不产出 uid", async () => {
    mockRoutes({
      "https://www.zhihu.com/api/v4/me": { code: 401, message: "请先登录" },
    });
    expect(
      await checker.fetchAccountInfoViaHttpApi("zhihu", [{ name: "z_c0", value: "v" }]),
    ).toEqual({ supported: true });
  });
  it("zhihu 身份字段为模板占位/空值时不产出 uid", async () => {
    mockRoutes({
      "https://www.zhihu.com/api/v4/me": { id: "", url_token: "", name: "", avatar_url: "" },
    });
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

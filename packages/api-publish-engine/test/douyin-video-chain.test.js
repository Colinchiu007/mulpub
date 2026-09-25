/**
 * douyin-video-chain.test.js — 抖音准自包含视频发布链契约（W2 §2/§7，vitest 组）
 *
 * creator/vod/imagex/upload 四类 base 均注入本机假 HTTP 服务器（127.0.0.1），零外发。
 * 覆盖：步骤序列（csrf HEAD → auth/v5 → vod apply → 分片 transfer POST → finish → CommitUploadInner
 *       → imagex apply → 封面 POST → CommitImageUpload → create_v2）、每步 method/URL/headers/body
 *       字段逐字对照取证切片；clientSign 头组、msToken 回退伪值、x-tt-verify 风控、
 *       §4.5 fail-closed（四类签名材料逐一缺失 / 文件不存在）零请求。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { startFakeServer, methodPathList } = require("./helpers/fake-http");
const { createHttpClient } = require("../src/publish/core/http-base");
const { DouyinVideoChain, DouyinVideoError, CSRF_POOL } = require("../src/publish/platforms/douyin-video");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

// —— 构造含合法 EC 私钥与四类签名材料的 security-sdk cookie（clientSign 可签出）——
function encField (inner) { return encodeURIComponent(JSON.stringify({ data: JSON.stringify(inner) })); }
function encB64 (jsonStr) { return encodeURIComponent(Buffer.from(jsonStr, "utf-8").toString("base64")); }
function makeCookie (o = {}) {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const parts = [];
  if (!o.omitCrypt) parts.push("security-sdk/s_sdk_crypt_sdk=" + encField({ ec_privateKey: pem }));
  if (!o.omitSign) parts.push("security-sdk/s_sdk_sign_data_key/web_protect=" + encField({ ticket: o.ticket || "t_" + Date.now(), ts_sign: o.tsSign || "TSSIGN" }));
  if (!o.omitRee) parts.push("bd_ticket_guard_client_data=" + encB64(JSON.stringify({ "bd-ticket-guard-ree-public-key": o.ree || "REE_PUB_KEY" })));
  if (!o.omitSid) parts.push("sid_tt=SESSID123");
  if (o.msToken) parts.push("msToken=" + o.msToken);
  parts.push("sessionid=abc");
  return parts.join("; ");
}

// apply 响应里的 UploadHost 由 startSrv 启动后就地注入真实 host（假服务器按引用读 route.body）
function baseRoutes () {
  return [
    { method: "HEAD", match: /\/web\/api\/media\/aweme\/create\/$/, status: 200, raw: true, body: "", headers: { "x-ware-csrf-token": "PREPART,THETOKEN" } },
    { method: "GET", match: /upload\/auth\/v5/, body: { auth: JSON.stringify({ AccessKeyID: "AKID", SecretAccessKey: "ASecret", SessionToken: "ASToken" }), status_code: 0 } },
    { method: "GET", match: /Action=ApplyUploadInner/, body: { Result: { InnerUploadAddress: { UploadNodes: [{ SessionKey: "VSK", UploadHost: "HOST", StoreInfos: [{ Auth: "VAUTH", StoreUri: "vstore.mp4" }] }] } } } },
    { method: "GET", match: /Action=ApplyImageUpload/, body: { Result: { InnerUploadAddress: { UploadNodes: [{ SessionKey: "CSK", UploadHost: "HOST", StoreInfos: [{ Auth: "CAUTH", StoreUri: "cstore.jpg" }] }] } } } },
    { method: "POST", match: /Action=CommitUploadInner/, body: { Result: { Results: [{ Vid: "VID123" }] } } },
    { method: "POST", match: /Action=CommitImageUpload/, body: { Result: { Results: [{ Uri: "image-cn/cover.uri" }] } } },
    { method: "POST", match: /phase=transfer/, body: { crc32: "aabbccdd", partNum: 1 } },
    { method: "POST", match: /phase=finish/, body: { Result: { Results: [] } } },
    { method: "POST", match: /\/upload\/v1\/cstore\.jpg/, body: { crc32: "covercrc" } },
    { method: "POST", match: /create_v2/, body: { status_code: 0, aweme_id: "AWEME999" } },
  ];
}

async function startSrv (mutate) {
  const routes = baseRoutes();
  if (mutate) mutate(routes);
  const srv = await startFakeServer(routes);
  const host = srv.url.replace(/^https?:\/\//, "");
  for (const r of routes) {
    const nodes = r.body && r.body.Result && r.body.Result.InnerUploadAddress && r.body.Result.InnerUploadAddress.UploadNodes;
    if (nodes) nodes.forEach((n) => { n.UploadHost = host; });
  }
  srv.__host = host;
  return srv;
}

function newChain (srv, cookie, extra) {
  const http = createHttpClient({ baseURL: srv.url, timeout: 5000 });
  return new DouyinVideoChain(Object.assign({
    cookie, userAgent: UA,
    creator: http, vod: http, imagex: http, uploadHttp: http,
    vodBase: srv.url, imagexBase: srv.url, creatorBase: srv.url, uploadScheme: "http:",
  }, extra || {}));
}

function writeTemp (size) {
  const p = path.join(os.tmpdir(), "dy-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".mp4");
  fs.writeFileSync(p, Buffer.alloc(size, 7));
  return p;
}

describe("publish/platforms/douyin-video", function () {
  test("全链十步序列：csrf→auth→vod apply→transfer→finish→commit→imagex apply→cover→commit→create_v2", async function () {
    const srv = await startSrv();
    const file = writeTemp(4096);
    try {
      const result = await newChain(srv, makeCookie({ msToken: "MS123" })).run({ title: "标题一", content: "文案", video: { path: file }, cover: { path: file } }, { draft: true });
      expect(result.success).toBe(true);
      expect(result.publishId).toBe("AWEME999");
      expect(result.mode).toBe("api");
      expect(methodPathList(srv.requests)).toEqual([
        "HEAD /web/api/media/aweme/create/",
        "GET /web/api/media/upload/auth/v5/",
        "GET /",
        "POST /upload/v1/vstore.mp4",
        "POST /upload/v1/vstore.mp4",
        "POST /",
        "GET /",
        "POST /upload/v1/cstore.jpg",
        "POST /",
        "POST /web/api/media/aweme/create_v2/",
      ]);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("vod apply 参数 + 分片 transfer 头/URL 逐字 + commit aws4/X-Amz-Content-Sha256", async function () {
    const srv = await startSrv();
    const file = writeTemp(2048);
    try {
      await newChain(srv, makeCookie()).run({ title: "T", video: { path: file }, cover: { path: file } }, { draft: true });
      const apply = srv.requestsFor(/Action=ApplyUploadInner/)[0];
      expect(apply.url).toContain("SpaceName=aweme");
      expect(apply.url).toContain("FileType=video");
      expect(apply.url).toContain("IsInner=1");
      expect(apply.url).toContain("app_id=2906");
      expect(apply.url).toContain("Version=2020-11-19");
      const part = srv.requestsFor(/phase=transfer/)[0];
      expect(part.method).toBe("POST");
      expect(part.url).toContain("/upload/v1/vstore.mp4");
      expect(part.url).toContain("part_number=1");
      expect(part.url).toContain("phase=transfer");
      expect(part.url).toContain("part_offset=0");
      expect(part.headers.authorization).toBe("VAUTH");
      expect(part.headers["content-crc32"]).toMatch(/^[0-9a-f]{8}$/); // 补零至 8 位
      const commit = srv.requestsFor(/Action=CommitUploadInner/)[0];
      expect(commit.body.Functions[0].name).toBe("GetMeta");
      expect(commit.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
      expect(commit.headers.authorization).toMatch(/AWS4-HMAC-SHA256/);
      expect(commit.headers["x-amz-date"]).toBeTruthy();
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("create_v2 头组：clientSign/ree/web-version/csrf-token + msToken + a_bogus + 私密草稿字段透传", async function () {
    const srv = await startSrv();
    const file = writeTemp(1024);
    try {
      await newChain(srv, makeCookie({ msToken: "MSXYZ", ticket: "nhash_xxx" })).run({ title: "标题", content: "正文", video: { path: file }, cover: { path: file }, visibility_type: 0 }, { draft: true });
      const pub = srv.requestsFor(/create_v2/)[0];
      expect(pub.url).toContain("msToken=MSXYZ");
      expect(pub.url).toContain("a_bogus=");
      expect(pub.url).toContain("read_aid=2906");
      expect(pub.headers["bd-ticket-guard-client-data"]).toBeTruthy();
      expect(pub.headers["bd-ticket-guard-ree-public-key"]).toBe("REE_PUB_KEY");
      expect(pub.headers["bd-ticket-guard-web-version"]).toBe("1"); // ticket 不以 hash 开头
      expect(pub.headers["bd-ticket-guard-version"]).toBe("2");
      expect(pub.headers["x-secsdk-csrf-token"]).toBe("THETOKEN");
      const body = pub.body;
      expect(body.item.common.item_title).toBe("标题");
      expect(body.item.common.video_id).toBe("VID123");
      expect(body.item.common.visibility_type).toBe(0);
      expect(body.item.cover.poster).toBe("image-cn/cover.uri");
      expect(body.item.declare.user_declare_info).toBe("{}");
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("msToken 缺失 → create_v2 url 回退伪值 a12man123masb", async function () {
    const srv = await startSrv();
    const file = writeTemp(1024);
    try {
      await newChain(srv, makeCookie({})).run({ title: "T", video: { path: file }, cover: { path: file } }, { draft: true });
      expect(srv.requestsFor(/create_v2/)[0].url).toMatch(/msToken=a12man123masb\d+/);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("x-tt-verify-passport-decision 响应头 → risk_blocked（不自动验证、不降级）", async function () {
    const srv = await startSrv((rs) => { rs[rs.length - 1] = { method: "POST", match: /create_v2/, status: 200, headers: { "x-tt-verify-passport-decision": "verify-center" }, body: { status_code: 110, status_msg: "sms" } }; });
    const file = writeTemp(1024);
    try {
      const result = await newChain(srv, makeCookie()).run({ title: "T", video: { path: file }, cover: { path: file } }, { draft: true });
      expect(result.success).toBe(false);
      expect(result.risk_blocked).toBe(true);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("web-version：ticket 以 hash 开头 → '2'", async function () {
    const srv = await startSrv();
    const file = writeTemp(1024);
    try {
      await newChain(srv, makeCookie({ ticket: "hashabc" })).run({ title: "T", video: { path: file }, cover: { path: file } }, { draft: true });
      expect(srv.requestsFor(/create_v2/)[0].headers["bd-ticket-guard-web-version"]).toBe("2");
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test.each([["omitCrypt"], ["omitSign"], ["omitRee"], ["omitSid"]])("§4.5 fail-closed：%s 缺失 → 抛错且零请求", async (key) => {
    const srv = await startSrv();
    const file = writeTemp(1024);
    try {
      const opts = {}; opts[key] = true;
      await expect(newChain(srv, makeCookie(opts)).run({ title: "T", video: { path: file }, cover: { path: file } }, { draft: true })).rejects.toThrow(DouyinVideoError);
      expect(srv.requests.length).toBe(0);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("§4.5 fail-closed：视频文件不存在 → 抛错且零请求", async function () {
    const srv = await startSrv();
    try {
      await expect(newChain(srv, makeCookie()).run({ title: "T", video: { path: path.join(os.tmpdir(), "nope-" + Date.now() + ".mp4") }, cover: { path: "c" } }, { draft: true })).rejects.toThrow(DouyinVideoError);
      expect(srv.requests.length).toBe(0);
    } finally { await srv.close(); }
  });

  test("CSRF_POOL 三 URL 池 + idx 轮换（默认命中 /aweme/create/）", function () {
    expect(CSRF_POOL.length).toBe(3);
    expect(CSRF_POOL[1]).toContain("/web/api/media/aweme/create/");
  });
});

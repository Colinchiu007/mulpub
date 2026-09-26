/**
 * kuaishou-video-chain.test.js — 快手视频 API 发布链契约（W3 §4/§5，vitest 组）
 *
 * cp/upload 两类 base 均注入本机假 HTTP 服务器（127.0.0.1），求签函数注入假签，零外发。
 * 逐字对照 01-docs/rpa-api-publish/evidence/yx-kuaishou-w3-slices.txt §1.1-§1.11：
 *   全链序列（pre→fragment×N→complete→finish→cover→submit→photo/list）、
 *   带签端点清单（pre/finish/submit 带 __NS_sig3；fragment/complete/cover/list 不带）、
 *   buildPostData 全字段、api_ph 三处透传（body/header/multipart）、
 *   签名字段本地断言（空/<40 → fail-closed 零请求）、签名页未就绪 → unsupported（可降级）、
 *   result=109 → login_expired 停任务、非 JSON 验证页 → risk_blocked、complete result!=1 重试一次。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { startFakeServer, methodPathList } = require("./helpers/fake-http");
const { createHttpClient } = require("../src/publish/core/http-base");
const { KuaishouVideoChain, KuaishouVideoError, buildKuaishouPostData } = require("../src/publish/platforms/kuaishou-video");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
// S2b 实证：真 sig3 为 56 字符 VM 产物；假签取 56 位过 ≥40 断言
const GOOD_SIG = "S".repeat(56);
const API_PH = "abcdefghij0123456789"; // 36 字符位样式
const COOKIE = `kuaishou.web.cp.api_ph=${API_PH}; userId=U1; did=D1`;

function makeRoutes (srv) {
  const host = srv.url.replace(/^https?:\/\//, "");
  return [
    { method: "POST", match: /upload\/pre/, body: { result: 1, data: { token: "UTOK", endPoints: ["http://" + host] } } },
    { method: "POST", match: /api\/upload\/fragment/, body: { checksum: "CK" } },
    { method: "POST", match: /api\/upload\/complete/, body: { result: 1 } },
    { method: "POST", match: /upload\/finish/, body: { result: 1, data: { fileId: "FID9" } } },
    { method: "POST", match: /cover\/upload/, body: { result: 1, data: { coverKey: "CKEY7" } } },
    { method: "POST", match: /video\/pc\/submit/, body: { result: 1, currentTime: "1758780000123" } },
    { method: "POST", match: /photo\/list/, body: { result: 1, data: { list: [{ unPublishCoverKey: "CKEY7", uploadTime: "1758780009999" }] } } },
  ];
}

async function startSrv (mutate) {
  const routes = makeRoutes({ url: "http://127.0.0.1:0" });
  if (mutate) mutate(routes);
  const srv = await startFakeServer(routes);
  const host = srv.url.replace(/^https?:\/\//, "");
  const pre = routes.find((r) => String(r.match) === "/upload\\/pre/");
  if (pre && pre.body && pre.body.data) pre.body.data.endPoints = ["http://" + host];
  srv.__host = host;
  return srv;
}

// 按 match 源码定位并替换路由（正则字面量不可用 === 比较）
function mutateRoute (routes, re, next) {
  const idx = routes.findIndex((r) => String(r.match) === String(re));
  routes[idx] = next;
}

function newChain (srv, opts) {
  const http = createHttpClient({ timeout: 5000, validateStatus: (s) => s >= 200 && s < 500 });
  return new KuaishouVideoChain(Object.assign({
    cookie: COOKIE, userAgent: UA,
    cpBase: srv.url, uploadScheme: "http:",
    cpHttp: http, uploadHttp: http,
    signer: async () => GOOD_SIG,
    partSize: 2048,
  }, opts || {}));
}

function writeTemp (size) {
  const p = path.join(os.tmpdir(), "ks-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".mp4");
  fs.writeFileSync(p, Buffer.alloc(size, 7));
  return p;
}

function task (file) {
  return { title: "标题", content: "文案", video: { path: file }, cover: { path: file } };
}

describe("publish/platforms/kuaishou-video", () => {
  test("全链七步序列 + 带签端点清单逐字（pre/finish/submit 带签；fragment/complete/cover/list 不带）", async () => {
    const srv = await startSrv();
    const file = writeTemp(3000); // 2048 分片 → 2 片
    try {
      const result = await newChain(srv).run(task(file), { accountId: "acct1" });
      expect(result).toMatchObject({ success: true, mode: "api", platform: "kuaishou", publishId: "1758780000" });
      expect(methodPathList(srv.requests)).toEqual([
        "POST /rest/cp/works/v2/video/pc/upload/pre",
        "POST /api/upload/fragment",
        "POST /api/upload/fragment",
        "POST /api/upload/complete",
        "POST /rest/cp/works/v2/video/pc/upload/finish",
        "POST /rest/cp/works/v2/video/pc/upload/cover/upload",
        "POST /rest/cp/works/v2/video/pc/submit",
        "POST /rest/cp/works/v2/video/pc/photo/list",
      ]);
      const signed = (r) => r.url.includes("__NS_sig3=" + GOOD_SIG);
      expect(signed(srv.requests[0])).toBe(true);
      expect(signed(srv.requests[4])).toBe(true);
      expect(signed(srv.requests[6])).toBe(true);
      expect(srv.requests.slice(1, 4).every((r) => !r.url.includes("__NS_sig3"))).toBe(true);
      expect(srv.requests[7].url).not.toContain("__NS_sig3");
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("upload/pre 请求逐字：headers（cookie/Referer/Content-Type/api_ph）+ body {uploadType:1, api_ph}", async () => {
    const srv = await startSrv();
    const file = writeTemp(1024);
    try {
      await newChain(srv).run(task(file), { accountId: "a1" });
      const pre = srv.requestsFor(/upload\/pre/)[0];
      expect(pre.method).toBe("POST");
      expect(pre.headers.cookie).toBe(COOKIE);
      expect(pre.headers.referer).toContain("/article/publish/video");
      expect(pre.headers["content-type"]).toMatch(/application\/json/);
      expect(pre.headers["kuaishou.web.cp.api_ph"]).toBe(API_PH);
      expect(pre.body).toEqual({ uploadType: 1, "kuaishou.web.cp.api_ph": API_PH });
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("分片上传：Content-Range 偏移/总量 + upload_token/fragment_id + application/stream + 结果契约 checksum", async () => {
    const srv = await startSrv();
    const file = writeTemp(3000);
    try {
      await newChain(srv).run(task(file), { accountId: "a1" });
      const parts = srv.requestsFor(/api\/upload\/fragment/);
      expect(parts).toHaveLength(2);
      expect(parts[0].url).toContain("upload_token=UTOK");
      expect(parts[0].url).toContain("fragment_id=1");
      expect(parts[1].url).toContain("fragment_id=2");
      expect(parts[0].headers["content-range"]).toBe("bytes 0-2047/3000");
      expect(parts[1].headers["content-range"]).toBe("bytes 2048-2999/3000");
      expect(parts[0].headers["content-type"]).toBe("application/stream");
      expect(parts[0].byteLength).toBe(2048);
      // complete：fragment_count/upload_token + 空 body
      const done = srv.requestsFor(/api\/upload\/complete/)[0];
      expect(done.url).toContain("fragment_count=2");
      expect(done.url).toContain("upload_token=UTOK");
      expect(done.byteLength).toBe(0);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("finish 请求体逐字（token/fileName/fileTyp/fileLength/api_ph）→ fileId", async () => {
    const srv = await startSrv();
    const file = writeTemp(1024);
    try {
      await newChain(srv).run(task(file), { accountId: "a1" });
      const fin = srv.requestsFor(/upload\/finish/)[0];
      expect(fin.body).toMatchObject({
        token: "UTOK", fileTyp: "video/mp4", fileLength: 1024,
        "kuaishou.web.cp.api_ph": API_PH,
      });
      expect(typeof fin.body.fileName).toBe("string");
      expect(fin.body.fileName.length).toBeGreaterThan(0);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("封面 multipart：file(image/jpeg) + api_ph 字段 → coverKey", async () => {
    const srv = await startSrv();
    const file = writeTemp(1024);
    try {
      await newChain(srv).run(task(file), { accountId: "a1" });
      const cov = srv.requestsFor(/cover\/upload/)[0];
      const raw = cov.rawBody.toString("latin1");
      expect(cov.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
      expect(raw).toContain('name="file"');
      expect(raw).toContain("image/jpeg");
      expect(raw).toContain('name="kuaishou.web.cp.api_ph"');
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("submit body = buildPostData 原样字符串 + charset=UTF-8；字段对照切片 §1.7（含 ai_generated 平移、可见性透传）", async () => {
    const srv = await startSrv();
    const file = writeTemp(1024);
    try {
      await newChain(srv).run({ title: "标题", content: "文案", video: { path: file }, cover: { path: file }, visibilityType: 1 }, { accountId: "a1" });
      const sub = srv.requestsFor(/video\/pc\/submit/)[0];
      expect(sub.headers["content-type"]).toBe("application/json;charset=UTF-8");
      expect(sub.body).toMatchObject({
        caption: "标题\n文案",
        pkCoverKey: "", pkCoverSize: "a", pkCoverTimeStamp: 0, pkCoverType: 2,
        poiId: "", latitude: "", longitude: "",
        domain: "", secondDomain: "",
        coverCropped: false, coverKey: "CKEY7", coverType: 3,
        fileId: "FID9", "kuaishou.web.cp.api_ph": API_PH,
        movieId: "", notifyResult: 0,
        photoStatus: 1, photoType: 0, publishTime: 0,
        ai_generated: 1,
      });
      expect(typeof sub.body).toBe("object");
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("buildKuaishouPostData 纯函数：coverType=coverKey?3:1、downloadType==2 才带、aiGenerated=false → 0（默认如实声明）", () => {
    const ctx = { fileId: "F", coverKey: "C", apiPh: "P" };
    const base = buildKuaishouPostData({ title: "T" }, ctx);
    expect(base.coverType).toBe(3);
    expect(base.downloadType).toBeUndefined();
    expect(base.ai_generated).toBe(1);
    expect(buildKuaishouPostData({ title: "T", downloadType: 2 }, ctx).downloadType).toBe(2);
    expect(buildKuaishouPostData({ title: "T", aiGenerated: false }, ctx).ai_generated).toBe(0);
    expect(buildKuaishouPostData({ title: "T" }, { ...ctx, coverKey: "" }).coverType).toBe(1);
  });

  test.each([
    ["空串", async () => ""],
    ["短签(<40)", async () => "A".repeat(32)],
  ])("签名断言 fail-closed：%s → 抛错且零请求", async (_name, signer) => {
    const srv = await startSrv();
    const file = writeTemp(1024);
    try {
      await expect(newChain(srv, { signer }).run(task(file), { accountId: "a1" })).rejects.toThrow(KuaishouVideoError);
      expect(srv.requests.length).toBe(0);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("求签调用形态：command=kuaishou.ns-sig3-browser + {url,type:params} 结构 + accountId 透传", async () => {
    const srv = await startSrv();
    const file = writeTemp(1024);
    const calls = [];
    try {
      await newChain(srv, {
        signer: async (command, payload) => { calls.push({ command, payload }); return GOOD_SIG; },
      }).run(task(file), { accountId: "acct9" });
      expect(calls.length).toBeGreaterThanOrEqual(3); // pre/finish/submit 三处带签
      expect(calls.every((c) => c.command === "kuaishou.ns-sig3-browser")).toBe(true);
      expect(calls.every((c) => c.payload.accountId === "acct9")).toBe(true);
      expect(calls[0].payload).toMatchObject({ url: "/rest/cp/works/v2/video/pc/upload/pre", type: "json" });
      expect(calls[0].payload.params).toEqual({ uploadType: 1, "kuaishou.web.cp.api_ph": API_PH });
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("签名页未就绪（bridge 未注入语义）→ 链返回 unsupported（api-then-dom 可降级 DOM），零请求", async () => {
    const srv = await startSrv();
    const file = writeTemp(1024);
    const notReady = async () => { throw new Error("签名页未就绪（browser-page-provider: bridge not injected）"); };
    try {
      const r = await newChain(srv, { signer: notReady }).run(task(file), { accountId: "a1" });
      expect(r.success).toBe(false);
      expect(r.unsupported).toBe(true);
      expect(srv.requests.length).toBe(0);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test.each([
    ["pre", /upload\/pre/],
    ["finish", /upload\/finish/],
    ["submit", /video\/pc\/submit/],
  ])("result=109（%s 步）→ login_expired 停任务，后续步骤零发出", async (_name, re) => {
    const srv = await startSrv((rs) => {
      mutateRoute(rs, re, { method: "POST", match: re, body: { result: 109, message: "login expired" } });
    });
    const file = writeTemp(1024);
    try {
      const r = await newChain(srv).run(task(file), { accountId: "a1" });
      expect(r.success).toBe(false);
      expect(r.login_expired).toBe(true);
      const afterIdx = srv.requests.findIndex((q) => re.test(q.url));
      expect(srv.requests.length).toBe(afterIdx + 1); // 109 命中步即止
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("submit 返回非 JSON 验证页 → risk_blocked（不降级、不重试刷签）", async () => {
    const srv = await startSrv((rs) => {
      mutateRoute(rs, /video\/pc\/submit/, { method: "POST", match: /video\/pc\/submit/, raw: true, body: "<html><body>slider verify</body></html>" });
    });
    const file = writeTemp(1024);
    try {
      const r = await newChain(srv).run(task(file), { accountId: "a1" });
      expect(r.success).toBe(false);
      expect(r.risk_blocked).toBe(true);
      expect(srv.requestsFor(/video\/pc\/submit/)).toHaveLength(1);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("complete result!=1 → 按切片重试一次；仍失败 → 抛错停链（不进 finish）", async () => {
    const srv = await startSrv((rs) => {
      mutateRoute(rs, /api\/upload\/complete/, { method: "POST", match: /api\/upload\/complete/, body: { result: 2 }, times: 2 });
    });
    const file = writeTemp(1024);
    try {
      await expect(newChain(srv).run(task(file), { accountId: "a1" })).rejects.toThrow(KuaishouVideoError);
      expect(srv.requestsFor(/api\/upload\/complete/)).toHaveLength(2);
      expect(srv.requestsFor(/upload\/finish/)).toHaveLength(0);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("fail-closed：cookie 缺 api_ph → 抛错且零请求（不回退伪造 Guid）", async () => {
    const srv = await startSrv();
    try {
      await expect(newChain(srv, { cookie: "userId=U1" }).run(task("x"), { accountId: "a1" })).rejects.toThrow(KuaishouVideoError);
      expect(srv.requests.length).toBe(0);
    } finally { await srv.close(); }
  });

  test("fail-closed：视频文件不存在 → 抛错且零请求", async () => {
    const srv = await startSrv();
    try {
      await expect(newChain(srv).run(task(path.join(os.tmpdir(), "nope-" + Date.now() + ".mp4")), { accountId: "a1" })).rejects.toThrow(KuaishouVideoError);
      expect(srv.requests.length).toBe(0);
    } finally { await srv.close(); }
  });

  test("publishId 兜底 currentTime；回查 photo/list 以近 5min 窗口 + unPublishCoverKey 匹配", async () => {
    const srv = await startSrv();
    const file = writeTemp(1024);
    try {
      await newChain(srv).run(task(file), { accountId: "a1" });
      const list = srv.requestsFor(/photo\/list/)[0];
      expect(list.body.queryType).toBe("2");
      expect(list.body.limit).toBe(30);
      expect(list.body.startTime).toBeLessThanOrEqual(Date.now() - 4 * 60 * 1000);
      expect(list.body["kuaishou.web.cp.api_ph"]).toBe(API_PH);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });
});

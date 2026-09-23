/**
 * bilibili-video-chain.test.js — B站 upos 视频发布链契约（W1 §4.2 + §4.5，vitest 组）
 *
 * api/cdn 两客户端均注入 baseURL=srv.url（upos host 走相对 objectPath），仅打本机假 HTTP 服务器。
 * 覆盖：probe→args→init(?uploads)→分片 PUT(X-Upos-Auth)→complete→add/draft(csrf=bili_jct)
 *       逐字请求序列、8MiB 边界、PartInfo/eTag、csrf 传递、私密优先 draft、§4.5 fail-closed 零请求。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { startFakeServer, methodPathList } = require("./helpers/fake-http");
const { createHttpClient } = require("../src/publish/core/http-base");
const { BilibiliVideoChain, BilibiliVideoError, buildUposTarget, pickCookieValue } = require("../src/publish/platforms/bilibili-video");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const OBJ = "/ugcbucket/n123.mp4";

function makeChain (srv, extra) {
  const http = createHttpClient({ baseURL: srv.url, timeout: 5000 });
  return new BilibiliVideoChain(Object.assign({
    api: http, cdn: http, cookie: "DedeUserID=123456; bili_jct=TOKJCT; SESSDATA=s", userAgent: UA,
  }, extra || {}));
}

function fullRoutes () {
  return [
    { method: "GET", match: /\/preupload\?r=probe/, body: { lines: [{ query: "upcdn=bda2", os: "upos" }] } },
    { method: "GET", match: /\/preupload\?/, body: { auth: "UP_AUTH", endpoint: "//upos.test.local", upos_uri: "upos://ugcbucket/n123.mp4", biz_id: 42 } },
    { method: "POST", match: /uploads/, body: { upload_id: "UPID" } },
    { method: "PUT", match: /partNumber/, headers: { etag: '"PART_ETAG"' }, body: {} },
    { method: "POST", match: /output=json/, body: { location: "ugcbucket/n123.mp4" } },
    { method: "POST", match: /draft\/add/, body: { code: 0, data: { bvid: "BV1TEST", aid: 999 } } },
    { method: "POST", match: /web\/add\/v3/, body: { code: 0, data: { bvid: "BV1TEST", aid: 999 } } },
  ];
}

function writeTemp (size) {
  const p = path.join(os.tmpdir(), "bili-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".mp4");
  fs.writeFileSync(p, Buffer.alloc(size, 3));
  return p;
}

describe("publish/platforms/bilibili-video", function () {
  test("私密优先：草稿链六步序列，X-Upos-Auth/csrf 逐级传递", async function () {
    const srv = await startFakeServer(fullRoutes());
    const file = writeTemp(1024 * 1024);
    try {
      const chain = makeChain(srv);
      const result = await chain.run({ title: "标题", content: "正文", tags: ["热点", { name: "资讯" }], category: 21, video: { path: file } }, { draft: true });
      expect(result.success).toBe(true);
      expect(result.draft).toBe(true);
      expect(result.publishId).toBe("BV1TEST");
      expect(result.aid).toBe(999);
      expect(methodPathList(srv.requests)).toEqual([
        "GET /preupload", "GET /preupload", "POST " + OBJ, "PUT " + OBJ, "POST " + OBJ, "POST /x/vupre/web/draft/add",
      ]);
      // init 带 X-Upos-Auth=args.auth
      const init = srv.requestsFor(/uploads/)[0];
      expect(init.headers["x-upos-auth"]).toBe("UP_AUTH");
      // 分片：二进制 + X-Upos-Auth
      const part = srv.requestsFor(/partNumber/)[0];
      expect(part.headers["x-upos-auth"]).toBe("UP_AUTH");
      expect(part.byteLength).toBe(1024 * 1024);
      expect(part.url).toContain("partNumber=1");
      expect(part.url).toContain("chunks=1");
      // complete：parts eTag 去引号（output=json&name= 专属 complete，区别于 init 的 uploads=&output=json）
      const done = srv.requestsFor(/output=json&name=/)[0];
      expect(done.body.parts).toEqual([{ partNumber: 1, eTag: "PART_ETAG" }]);
      // draft：csrf 同时进 query 与 body
      const pub = srv.requestsFor(/draft\/add/)[0];
      expect(pub.url).toContain("csrf=TOKJCT");
      expect(pub.body.csrf).toBe("TOKJCT");
      expect(pub.body.tid).toBe(21);
      expect(pub.body.videos[0].filename).toBe("n123");
      expect(pub.body.videos[0].cid).toBe(42);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("正式发布走 /x/vu/web/add/v3（不触达 draft）", async function () {
    const srv = await startFakeServer(fullRoutes());
    const file = writeTemp(2048);
    try {
      const chain = makeChain(srv);
      const result = await chain.run({ title: "T", video: { path: file } }, { draft: false });
      expect(result.success).toBe(true);
      expect(result.draft).toBe(false);
      expect(srv.requestsFor(/web\/add\/v3/).length).toBe(1);
      expect(srv.requestsFor(/draft\/add/).length).toBe(0);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("多分片：>8MiB 按 8388608 切片，PartNumber 从 1 递增", async function () {
    const srv = await startFakeServer(fullRoutes());
    const file = writeTemp(8388608 + 100);
    try {
      const chain = makeChain(srv);
      await chain.run({ title: "T", video: { path: file } }, { draft: true });
      const parts = srv.requestsFor(/partNumber/);
      expect(parts.length).toBe(2);
      expect(parts[0].url).toContain("partNumber=1");
      expect(parts[0].url).toContain("chunks=2");
      expect(parts[1].url).toContain("partNumber=2");
      expect(parts[1].byteLength).toBe(100);
      const done = srv.requestsFor(/output=json&name=/)[0];
      expect(done.body.parts.length).toBe(2);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("§4.5 fail-closed：缺 cookie → 抛错且零请求", async function () {
    const srv = await startFakeServer(fullRoutes());
    try {
      const chain = makeChain(srv, { cookie: "" });
      await expect(chain.run({ title: "T", video: { path: "D:/x.mp4" } }, { draft: true })).rejects.toThrow(BilibiliVideoError);
      expect(srv.requests.length).toBe(0);
    } finally { await srv.close(); }
  });

  test("§4.5 fail-closed：视频文件不存在 → io_error 且零请求", async function () {
    const srv = await startFakeServer(fullRoutes());
    try {
      const chain = makeChain(srv);
      await expect(chain.run({ title: "T", video: { path: path.join(os.tmpdir(), "nope-" + Date.now() + ".mp4") } }, { draft: true })).rejects.toThrow(/not found/);
      expect(srv.requests.length).toBe(0);
    } finally { await srv.close(); }
  });

  test("§4.5 fail-closed：probe 无线路 → 抛错且不触达任何 upos/写请求", async function () {
    const srv = await startFakeServer([
      { method: "GET", match: /\/preupload\?r=probe/, body: { lines: [] } },
      { method: "GET", match: /\/preupload\?/, body: { auth: "X", upos_uri: "upos://b/o.mp4" } },
    ]);
    try {
      const chain = makeChain(srv);
      const file = writeTemp(100);
      try {
        await expect(chain.run({ title: "T", video: { path: file } }, { draft: true })).rejects.toThrow(/获取上传参数/);
        expect(methodPathList(srv.requests)).toEqual(["GET /preupload"]);
      } finally { fs.unlinkSync(file); }
    } finally { await srv.close(); }
  });

  test("buildUposTarget / pickCookieValue 纯函数", function () {
    expect(buildUposTarget({ endpoint: "//upos-h.bilivideo.com", upos_uri: "upos://ugc/n.mp4" })).toEqual({ host: "upos-h.bilivideo.com", objectPath: "/ugc/n.mp4" });
    expect(buildUposTarget({ endpoint: "", upos_uri: "//upos-h/ugc/n.mp4" }).host).toBe("upos-h");
    expect(pickCookieValue("a=1; bili_jct=TOK; b=2", "bili_jct")).toBe("TOK");
    expect(pickCookieValue("a=1", "bili_jct")).toBe("");
  });
});

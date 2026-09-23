/**
 * shipinhao-video-chain.test.js — 视频号视频发布链契约（W1 §4.1 + §4.5，vitest 组）
 *
 * 仅对本机假 HTTP 服务器发请求（api/cdn 两客户端均注入 baseURL=srv.url），杜绝外发。
 * 覆盖：authKey→applyuploaddfs→uploadpartdfs→completepartuploaddfs→post_create/post_draft
 *       逐字请求序列、X-Arguments/Authorization/Content-MD5 头、分片字节完整性、
 *       §4.5 fail-closed：缺 cookie、文件不存在、authKey 缺失 → 零（写）请求。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { startFakeServer, methodPathList } = require("./helpers/fake-http");
const { createHttpClient } = require("../src/publish/core/http-base");
const { ShipinhaoVideoChain, ShipinhaoVideoError, buildXArguments } = require("../src/publish/platforms/shipinhao-video");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function fullRoutes () {
  return [
    { method: "POST", match: /helper_upload_params/, body: { authKey: "AUTH_K" } },
    { method: "PUT", match: /\/applyuploaddfs/, body: { UploadID: "UP_1" } },
    { method: "PUT", match: /\/uploadpartdfs/, body: { ETag: "ETAG_1" } },
    { method: "POST", match: /\/completepartuploaddfs/, body: { url: "https://v.qq.com/x.mp4" } },
    { method: "POST", match: /\/post\/post_draft/, body: { errCode: 0, data: { postId: "POST_D1" } } },
    { method: "POST", match: /\/post\/post_create/, body: { errCode: 0, data: { postId: "POST_C1" } } },
  ];
}

function makeChain (srv, extra) {
  const http = createHttpClient({ baseURL: srv.url, timeout: 5000 });
  return new ShipinhaoVideoChain(Object.assign({
    api: http, cdn: http, cookie: "session=abc", userAgent: UA, finderId: "FIND_1", finderUin: "UIN_1",
  }, extra || {}));
}

function writeTempVideo (size) {
  const p = path.join(os.tmpdir(), "sph-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".mp4");
  fs.writeFileSync(p, Buffer.alloc(size, 5));
  return p;
}

describe("publish/platforms/shipinhao-video", function () {
  test("私密优先：草稿链走 post_draft，五步请求序列 + 鉴权头逐级传递", async function () {
    const srv = await startFakeServer(fullRoutes());
    const file = writeTempVideo(1024 * 1024);
    try {
      const chain = makeChain(srv);
      const result = await chain.run({ title: "标题", content: "描述", video: { path: file, width: 1920, height: 1080, duration: 12 } }, { draft: true, taskid: "TASK_1" });
      expect(result.success).toBe(true);
      expect(result.draft).toBe(true);
      expect(result.publishId).toBe("POST_D1");
      expect(result.platform).toBe("shipinhao");
      expect(methodPathList(srv.requests)).toEqual([
        "POST /cgi-bin/mmfinderassistant-bin/helper/helper_upload_params",
        "PUT /applyuploaddfs",
        "PUT /uploadpartdfs",
        "POST /completepartuploaddfs",
        "POST /cgi-bin/mmfinderassistant-bin/post/post_draft",
      ]);
      // applyuploaddfs：1MB < 8MiB → 单分片，BlockSum=1
      const apply = srv.requestsFor(/\/applyuploaddfs/)[0];
      expect(apply.body.BlockSum).toBe(1);
      expect(apply.body.BlockPartLength).toEqual([1024 * 1024]);
      expect(apply.headers["x-arguments"]).toContain("scene=2");
      expect(apply.headers["x-arguments"]).toContain("apptype=251");
      expect(apply.headers["x-arguments"]).toContain("taskid=TASK_1");
      expect(apply.headers.authorization).toBe("AUTH_K");
      // uploadpartdfs：Content-MD5 = 分片 md5；二进制字节完整
      const up = srv.requestsFor(/\/uploadpartdfs/)[0];
      const wantMd5 = crypto.createHash("md5").update(Buffer.alloc(1024 * 1024, 5)).digest("hex");
      expect(up.headers["content-md5"]).toBe(wantMd5);
      expect(up.headers["x-arguments"]).toContain("scene=0");
      expect(up.url).toContain("PartNumber=1");
      expect(up.url).toContain("UploadID=UP_1");
      expect(up.byteLength).toBe(1024 * 1024);
      // completepartuploaddfs：PartInfo 带 ETag
      const done = srv.requestsFor(/\/completepartuploaddfs/)[0];
      expect(done.body.TransFlag).toBe("0_0");
      expect(done.body.PartInfo).toEqual([{ PartNumber: 1, ETag: "ETAG_1" }]);
      // publish body：JSON 含 media.videoId=uploadId（content-type json 已被假服务器解析为对象）
      const pub = srv.requestsFor(/\/post\/post_draft/)[0];
      expect(pub.body.media.videoId).toBe("UP_1");
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("正式发布链走 post_create（不触达 post_draft）", async function () {
    const srv = await startFakeServer(fullRoutes());
    const file = writeTempVideo(2048);
    try {
      const chain = makeChain(srv);
      const result = await chain.run({ title: "T", content: "C", video: { path: file } }, { draft: false });
      expect(result.success).toBe(true);
      expect(result.draft).toBe(false);
      expect(result.publishId).toBe("POST_C1");
      expect(srv.requestsFor(/\/post\/post_create/).length).toBe(1);
      expect(srv.requestsFor(/\/post\/post_draft/).length).toBe(0);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("多分片：>8MiB 文件按 8388608 切片，逐片 PartNumber 递增", async function () {
    const srv = await startFakeServer(fullRoutes());
    const size = 8388608 + 100; // 两片
    const file = writeTempVideo(size);
    try {
      const chain = makeChain(srv);
      await chain.run({ title: "T", content: "C", video: { path: file } }, { draft: true });
      const apply = srv.requestsFor(/\/applyuploaddfs/)[0];
      expect(apply.body.BlockSum).toBe(2);
      expect(apply.body.BlockPartLength).toEqual([8388608, 100]);
      const parts = srv.requestsFor(/\/uploadpartdfs/);
      expect(parts.length).toBe(2);
      expect(parts[0].url).toContain("PartNumber=1");
      expect(parts[1].url).toContain("PartNumber=2");
      expect(parts[1].byteLength).toBe(100);
      const done = srv.requestsFor(/\/completepartuploaddfs/)[0];
      expect(done.body.PartInfo.length).toBe(2);
    } finally { fs.unlinkSync(file); await srv.close(); }
  });

  test("§4.5 fail-closed：缺 cookie → 抛错且零请求", async function () {
    const srv = await startFakeServer(fullRoutes());
    try {
      const chain = makeChain(srv, { cookie: "" });
      await expect(chain.run({ title: "T", video: { path: "D:/x.mp4" } }, { draft: true })).rejects.toThrow(ShipinhaoVideoError);
      expect(srv.requests.length).toBe(0);
    } finally { await srv.close(); }
  });

  test("§4.5 fail-closed：视频文件不存在 → io_error 且零请求", async function () {
    const srv = await startFakeServer(fullRoutes());
    try {
      const chain = makeChain(srv);
      const missing = path.join(os.tmpdir(), "nope-" + Date.now() + ".mp4");
      await expect(chain.run({ title: "T", video: { path: missing } }, { draft: true })).rejects.toThrow(/not found/);
      expect(srv.requests.length).toBe(0);
    } finally { await srv.close(); }
  });

  test("§4.5 fail-closed：authKey 缺失 → 抛错且不触达任何 CDN 写请求", async function () {
    const srv = await startFakeServer([
      { method: "POST", match: /helper_upload_params/, body: { errCode: 0 } },
      { method: "PUT", match: /\/applyuploaddfs/, body: { UploadID: "UP_1" } },
    ]);
    try {
      const chain = makeChain(srv);
      const file = writeTempVideo(100);
      try {
        await expect(chain.run({ title: "T", video: { path: file } }, { draft: true })).rejects.toThrow(/authKey/);
        expect(methodPathList(srv.requests)).toEqual(["POST /cgi-bin/mmfinderassistant-bin/helper/helper_upload_params"]);
        expect(srv.requestsFor(/\/applyuploaddfs|\/uploadpartdfs|\/post\//).length).toBe(0);
      } finally { fs.unlinkSync(file); }
    } finally { await srv.close(); }
  });

  test("buildXArguments 纯函数：apptype=251 固定、filekey URL 编码、scene 参数化", function () {
    const s = buildXArguments({ filetype: "mp4", weixinnum: "U1", filekey: "a b.mp4", filesize: 123, taskid: "T1", scene: 0 });
    expect(s).toContain("apptype=251");
    expect(s).toContain("filekey=a%20b.mp4");
    expect(s).toContain("filesize=123");
    expect(s.endsWith("scene=0")).toBe(true);
  });
});

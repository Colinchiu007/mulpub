// @ts-check
/**
 * BaijiahaoAdapter API 发布链测试（移植参考产品逆向分析实现）
 *
 * 覆盖：token 获取 / app_id / preupload / 分片上传 / complete / video process 轮询 /
 *       buildVideoPostData（位置空对象/原创声明）/ publish 发布端点
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import BaijiahaoAdapter from "../src/adapters/baijiahao"
import os from "os"
import path from "path"
import fs from "fs"

function mockHttp(adapter, handlers) {
  const calls = []
  adapter.http.post = vi.fn(async (url, body, opts) => {
    calls.push({ method: 'post', url, body, opts })
    const h = handlers.post && handlers.post(url, body, opts)
    if (h) return h
    return { data: {} }
  })
  adapter.http.get = vi.fn(async (url, opts) => {
    calls.push({ method: 'get', url, opts })
    const h = handlers.get && handlers.get(url, opts)
    if (h) return h
    return { data: {} }
  })
  return calls
}

describe("BaijiahaoAdapter API 发布链", () => {
  let adapter
  beforeEach(() => { adapter = new BaijiahaoAdapter() })

  it("getBaseToken 从首页提取 BJH__INIT__AUTH__ token", async () => {
    mockHttp(adapter, {
      get: () => ({ data: 'var BJH__INIT__AUTH__ = "TOKEN_ABC"; var x=1' }),
    })
    const token = await adapter.getBaseToken("cookie=abc")
    expect(token).toBe("TOKEN_ABC")
  })

  it("getAppId 从 appinfo 提取 user.app_id", async () => {
    mockHttp(adapter, {
      get: () => ({ data: { data: { user: { app_id: "APP_123" } } } }),
    })
    const appId = await adapter.getAppId("cookie=abc")
    expect(appId).toBe("APP_123")
  })

  it("preuploadVideo 返回 upload_key（video_type=short + 浏览器头）", async () => {
    mockHttp(adapter, {
      post: (url, body, opts) => {
        expect(url).toContain("preuploadVideo")
        expect(body).toContain("app_id=APP_123")
        expect(body).toContain("md5=MD5VAL")
        expect(body).toContain("video_type=short")
        expect(opts.headers["User-Agent"]).toBeDefined()
        expect(opts.headers.Cookie).toContain("cookie=abc")
        // 浏览器指纹头（对齐参考产品 HttpConfig，防玄武风控误判非浏览器环境）
        expect(opts.headers["Sec-CH-UA"]).toBeDefined()
        expect(opts.headers["Sec-Fetch-Site"]).toBe("same-origin")
        expect(opts.headers["Accept-Encoding"]).toBe("gzip, deflate, br")
        expect(opts.headers["Connection"]).toBe("keep-alive")
        return { data: { upload_key: "KEY_1", upload_id: "UPLOAD_1" } }
      },
    })
    const r = await adapter.preuploadVideo("cookie=abc", "APP_123", "TOKEN", "MD5VAL")
    expect(r.upload_key).toBe("KEY_1")
  })

  it("uploadVideoPart 分片上传 rsbjh 端点（每片响应须含 uploadId）", async () => {
    mockHttp(adapter, {
      post: (url) => {
        expect(url).toContain("rsbjh.baidu.com/builder/author/video/uploadVideo")
        return { data: { code: 0, uploadId: "UP_1" } }
      },
    })
    const r = await adapter.uploadVideoPart("cookie=abc", Buffer.from("chunk1"), "CHUNK_0", "KEY_1", "APP_123", "MD5VAL", 100, "01.mp4", 1, 0)
    expect(r.uploadId).toBe("UP_1")
  })

  it("uploadVideoPart 存储服务异常时换 rsbjh10/11/12 重试", async () => {
    const calls = mockHttp(adapter, {
      post: (url) => {
        if (url.includes("rsbjh.baidu.com")) return { data: { error_msg: "存储服务异常" } }
        if (url.includes("rsbjh10.baidu.com")) return { data: { uploadId: "UP_RETRY" } }
        return { data: {} }
      },
    })
    const r = await adapter.uploadVideoPart("cookie=abc", Buffer.from("chunk1"), 0, "KEY_1", "APP_123", "MD5VAL", 100, "01.mp4", 1, 0)
    expect(r.uploadId).toBe("UP_RETRY")
    const urls = calls.filter((c) => c.method === "post").map((c) => c.url)
    expect(urls.some((u) => u.includes("rsbjh.baidu.com"))).toBe(true)
    expect(urls.some((u) => u.includes("rsbjh10.baidu.com"))).toBe(true)
  })

  it("completeUpload 返回 mediaId/bos_url（video_type=short）", async () => {
    mockHttp(adapter, {
      post: (url, body) => {
        expect(url).toContain("compuploadVideo")
        expect(body).toContain("upload_key=KEY_1")
        expect(body).toContain("video_type=short")
        return { data: { mediaId: "MEDIA_1", bos_url: "http://bos.baidu.com/x.mp4" } }
      },
    })
    const r = await adapter.completeUpload("cookie=abc", "APP_123", "TOKEN", "KEY_1", 1, "01.mp4", 100, "short")
    expect(r.mediaId).toBe("MEDIA_1")
    expect(r.bos_url).toContain("http://bos")
  })

  it("waitVideoProcess 支持 deadline 与 signal 中断", async () => {
    mockHttp(adapter, {
      post: () => ({ data: { data: { editVideo: { coverImage: "" } } } }),
    })
    const r1 = await adapter.waitVideoProcess("c", "t", "m", 5, 1500, Date.now() - 1)
    expect(r1).toBeNull()
    const r2 = await adapter.waitVideoProcess("c", "t", "m", 5, 1500, 0, { aborted: true })
    expect(r2).toBeNull()
  })

  it("waitVideoProcess 轮询直到 editVideo.coverImage 出现", async () => {
    let count = 0
    mockHttp(adapter, {
      post: () => {
        count++
        if (count < 3) return { data: { data: { editVideo: { coverImage: "" } } } }
        return { data: { data: { editVideo: { coverImage: "http://cover.jpg" } } } }
      },
    })
    const cover = await adapter.waitVideoProcess("cookie=abc", "TOKEN", "MEDIA_1", 3)
    expect(cover).toContain("http://")
  })

  it("buildVideoPostData 位置为空对象 + 原创声明参数", () => {
    const pd = adapter.buildVideoPostData({
      title: "测试标题",
      content: "测试内容",
      tags: ["a", "b"],
      video: { duration: 48.6 },
      original: true,
    }, { mediaId: "MEDIA_1" }, "", "01.mp4", "")
    const decoded = decodeURIComponent(pd)
    expect(decoded).toContain("type=video")
    expect(decoded).toContain("title=")
    expect(decoded).toContain("mediaId")
    expect(decoded).toContain("position_lat_lng={}")
    expect(decoded).toContain("original_status=2")
    expect(decoded).toContain("video_duration=49")
  })

  it("buildVideoPostData 无位置时仍传空对象（位置可选）", () => {
    const pd = adapter.buildVideoPostData({
      title: "T", content: "C", video: { duration: 10 }, original: false,
    }, { mediaId: "M1" }, "", "01.mp4", "")
    expect(decodeURIComponent(pd)).toContain("position_lat_lng={}")
    expect(decodeURIComponent(pd)).toContain("original_status=0")
  })

  it("buildVideoPostData 默认勾选 AI 生成内容声明（is_checked=1）", () => {
    const pd = adapter.buildVideoPostData({
      title: "T", content: "C", video: { duration: 10 },
    }, { mediaId: "M1" }, "", "01.mp4", "")
    const decoded = decodeURIComponent(pd)
    expect(decoded).toContain("activity_list[0][id]=aigc_bjh_status")
    expect(decoded).toContain("activity_list[0][is_checked]=1")
  })

  it("buildVideoPostData 百家号标题按 UTF-8 字节截断到 149 字节", () => {
    // 50 个中文字符 = 150 字节，超过 149 上限，应截断到 49 个中文字符（147 字节）
    const pd = adapter.buildVideoPostData({
      title: "外".repeat(50),
      content: "C", video: { duration: 10 },
    }, { mediaId: "M1" }, "", "01.mp4", "")
    const decoded = decodeURIComponent(pd)
    const titleMatch = /title=([^&]*)/.exec(decoded)
    expect(titleMatch).toBeTruthy()
    const title = titleMatch[1]
    expect(Array.from(title).length).toBe(49)
    expect(Buffer.byteLength(title, "utf8")).toBe(147)

    // 混合字符：49 中文 + 1 英文 = 148 字节，未超限保留
    const mixed = adapter.buildVideoPostData({
      title: "外".repeat(49) + "a",
      content: "C", video: { duration: 10 },
    }, { mediaId: "M1" }, "", "01.mp4", "")
    const mixedDecoded = decodeURIComponent(mixed)
    const mixedTitle = /title=([^&]*)/.exec(mixedDecoded)[1]
    expect(mixedTitle).toBe("外".repeat(49) + "a")
    expect(Buffer.byteLength(mixedTitle, "utf8")).toBe(148)
  })

  it("buildVideoPostData 显式 aiGenerated=false 时取消勾选 AI 声明（is_checked=0）", () => {
    const pd = adapter.buildVideoPostData({
      title: "T", content: "C", video: { duration: 10 }, aiGenerated: false,
    }, { mediaId: "M1" }, "", "01.mp4", "")
    const decoded = decodeURIComponent(pd)
    expect(decoded).toContain("activity_list[0][id]=aigc_bjh_status")
    expect(decoded).toContain("activity_list[0][is_checked]=0")
  })

  it("execute 默认勾选 AI 生成声明（真实上传链 postData 含 is_checked=1）", async () => {
    const tmpPath = path.join(os.tmpdir(), "bj-aigc-" + Date.now() + ".mp4")
    fs.writeFileSync(tmpPath, Buffer.alloc(1024, 1))
    let publishBody = ""
    adapter.http.get = vi.fn(async (url) => {
      if (url.includes("source=inner")) return { data: 'BJH__INIT__AUTH__ = "TOKEN_AIGC"' }
      if (url.includes("appinfo")) return { data: { data: { user: { app_id: "APP_AIGC" } } } }
      return { data: {} }
    })
    adapter.http.post = vi.fn(async (url, body) => {
      if (url.includes("compuploadVideo")) return { data: { bos_url: "http://b/x", mediaId: "M_AIGC" } }
      if (url.includes("preuploadVideo")) return { data: { upload_key: "K_AIGC" } }
      if (url.includes("rsbjh.baidu.com")) return { data: { uploadId: "UP_AIGC" } }
      if (url.includes("video/process")) return { data: { data: { editVideo: { coverImage: "http://c.jpg" } } } }
      if (url.includes("article/publish")) { publishBody = String(body); return { data: { errno: 0, ret: { id: "ART_AIGC" } } } }
      return { data: {} }
    })
    const result = await adapter.execute({
      title: "AIGC 视频", content: "测试", video: { path: tmpPath, duration: 10, width: 1920, height: 1080 },
    }, "cookie=abc", { timeout: 60000 })
    fs.unlinkSync(tmpPath)
    expect(result.success).toBe(true)
    expect(decodeURIComponent(publishBody)).toContain("activity_list[0][is_checked]=1")
  })

  it("publish 调用 pcui/article/publish 端点", async () => {
    mockHttp(adapter, {
      post: (url, body, opts) => {
        expect(url).toContain("pcui/article/publish")
        expect(opts.headers.Cookie).toContain("cookie=abc")
        expect(opts.headers["Sec-CH-UA-Platform"]).toBe('"Windows"')
        expect(opts.headers["Sec-CH-UA-Mobile"]).toBe("?0")
        expect(opts.headers.token).toBe("TOKEN")
        return { data: { errno: 0, ret: { id: "ARTICLE_1" } } }
      },
    })
    const r = await adapter.publishVideo("cookie=abc", "TOKEN", "title=x&type=video")
    expect(r.success).toBe(true)
    expect(r.publishId).toBe("ARTICLE_1")
  })

  it("publishVideo draft 模式走 pcui/article/save", async () => {
    mockHttp(adapter, {
      post: (url) => {
        expect(url).toContain("pcui/article/save")
        return { data: { errno: 0, ret: { id: "DRAFT_1" } } }
      },
    })
    const r = await adapter.publishVideo("cookie=abc", "TOKEN", "title=x", { draft: true })
    expect(r.success).toBe(true)
    expect(r.publishId).toBe("DRAFT_1")
  })

  it("publishVideo 识别 10000015 账号风控弹码并给出可操作提示", async () => {
    mockHttp(adapter, {
      post: () => ({
        data: {
          errno: 10000015,
          errmsg: "您所在网络环境异常，请完成验证",
          data: {
            hit_rule: "30天内注册的百家号作者弹码",
            pass_auth: [{ auth_scene: "bjh_risk_phone", auth_id: "AUTH_ID_1" }, { auth_scene: "bjh_risk_auth" }],
          },
        },
      }),
    })
    const r = await adapter.publishVideo("cookie=abc", "TOKEN", "title=x")
    expect(r.success).toBe(false)
    expect(r.code).toBe(10000015)
    expect(r.error).toContain("风控拦截")
    expect(r.error).toContain("30天内注册的百家号作者弹码")
    expect(r.error).toContain("请先在浏览器中登录百家号完成验证")
    expect(r.error).toContain("bjh_risk_phone/bjh_risk_auth")
  })

  it("publishVideo 其他 errno 仍透传原 errmsg（不吞原始错误）", async () => {
    mockHttp(adapter, {
      post: () => ({ data: { errno: 20040003, errmsg: "用户服务异常" } }),
    })
    const r = await adapter.publishVideo("cookie=abc", "TOKEN", "title=x")
    expect(r.success).toBe(false)
    expect(r.code).toBe(20040003)
    expect(r.error).toContain("用户服务异常")
  })

  it("publish 拒绝基类 cancelToken 形态（缺 token 直接报错）", async () => {
    await expect(adapter.publish("cookie=abc", "title=x", { isCancelled: false })).rejects.toThrow(/opts\.token/)
  })

  it("execute 走真实上传链（临时文件 + http mock 分流，含分片计数/bos_url 门禁）", async () => {
    const calls = []
    const tmpPath = path.join(os.tmpdir(), "bj-e2e-" + Date.now() + ".mp4")
    fs.writeFileSync(tmpPath, Buffer.alloc(3 * 1024 * 1024, 7))
    adapter.http.get = vi.fn(async (url) => {
      calls.push('get:' + url)
      if (url.includes("source=inner")) return { data: 'BJH__INIT__AUTH__ = "TOKEN_X"' }
      if (url.includes("appinfo")) return { data: { data: { user: { app_id: "APP_X" } } } }
      return { data: {} }
    })
    adapter.http.post = vi.fn(async (url, body, opts) => {
      calls.push('post:' + url.split('?')[0])
      // 注意子串顺序：compuploadVideo/preuploadVideo 均含 "uploadVideo"
      if (url.includes("compuploadVideo")) {
        expect(body).toContain("video_type=short")
        return { data: { bos_url: "http://bos.baidu.com/x.mp4", mediaId: "MEDIA_X" } }
      }
      if (url.includes("preuploadVideo")) return { data: { upload_key: "KEY_X", upload_id: "UP_X" } }
      if (url.includes("rsbjh.baidu.com")) return { data: { uploadId: "UP_PART" } }
      if (url.includes("video/process")) return { data: { data: { editVideo: { coverImage: "http://c.jpg" } } } }
      if (url.includes("article/publish")) return { data: { errno: 0, ret: { id: "ART_X" } } }
      return { data: {} }
    })
    const result = await adapter.execute({
      title: "E2E 视频",
      content: "测试",
      video: { path: tmpPath, duration: 48.6, width: 1920, height: 1080 },
      original: false,
    }, "cookie=abc", { timeout: 60000 })
    fs.unlinkSync(tmpPath)
    expect(result.success).toBe(true)
    expect(result.publishId).toBe("ART_X")
    const uploadCalls = calls.filter((c) => c.startsWith("post:") && c.includes("rsbjh.baidu.com"))
    expect(uploadCalls.length).toBe(2)
    expect(calls.some((c) => c.includes("video/process"))).toBe(true)
    expect(calls.some((c) => c.includes("article/publish"))).toBe(true)
  })

  it("uploadVideo 错误消息脱敏（只回显 errmsg，不泄露瞬时值）", async () => {
    const tmpPath = path.join(os.tmpdir(), "bj-err-" + Date.now() + ".mp4")
    fs.writeFileSync(tmpPath, Buffer.from("v123"))
    mockHttp(adapter, {
      get: (url) => {
        if (url.includes("source=inner")) return { data: 'BJH__INIT__AUTH__ = "TOKEN_X"' }
        return { data: { data: { user: { app_id: "APP_X" } } } }
      },
      post: () => ({ data: { errno: 20040003, errmsg: "用户服务异常", upload_key: "SECRET_KEY" } }),
    })
    try {
      await adapter.uploadVideo({ video: { path: tmpPath } }, "cookie=abc")
      throw new Error("应当抛出上传失败")
    } catch (e) {
      expect(e.message).toContain("用户服务异常")
      expect(e.message).not.toContain("SECRET_KEY")
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it("execute 显式拒绝自定义封面（首帧封面契约）", async () => {
    const result = await adapter.execute({ title: "x", video: { path: "D:/x.mp4", width: 1920, height: 1080 }, cover: "C:/cover.jpg" }, "cookie=abc")
    expect(result.success).toBe(false)
    expect(result.error).toContain("暂不支持自定义封面")
  })

  it("execute 视频文件缺失返回可读错误", async () => {
    const result = await adapter.execute({ title: "x", video: { path: "D:/not-exist-" + Date.now() + ".mp4", width: 1920, height: 1080 } }, "cookie=abc")
    expect(result.success).toBe(false)
    expect(result.error).toContain("视频文件缺失")
  })

  it("execute 取消信号中断发布", async () => {
    const tmpPath = path.join(os.tmpdir(), "bj-cancel-" + Date.now() + ".mp4")
    fs.writeFileSync(tmpPath, Buffer.alloc(1024, 1))
    mockHttp(adapter, {
      get: (url) => {
        if (url.includes("source=inner")) return { data: 'BJH__INIT__AUTH__ = "TOKEN_X"' }
        return { data: { data: { user: { app_id: "APP_X" } } } }
      },
      post: () => ({ data: { upload_key: "KEY_X", uploadId: "UP_X", bos_url: "http://b/x", mediaId: "M_X", errno: 0, ret: { id: "A" } } }),
    })
    const result = await adapter.execute({ title: "x", video: { path: tmpPath, duration: 1, width: 1920, height: 1080 } }, "cookie=abc", { signal: { aborted: true } })
    fs.unlinkSync(tmpPath)
    expect(result.success).toBe(false)
    expect(result.error).toContain("取消")
  })
})

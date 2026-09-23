// @ts-check
/**
 * BaijiahaoAdapter API 发布链测试（W1 §4.4：由旧视频链改委托新文章链 BaijiahaoArticleChain）
 *
 * 本文件只验「适配器委托接线」：execute → chain.run、私密草稿优先、缺标题 fail-closed、
 * 结果归一（success/error/code/url/platform）、buildPostData 委托文章链表单（AI 声明 + 标题截断）。
 * 链级 HTTP/token/uploadproxy/风控/截断契约在 baijiahao-article-chain.test.js（本机假 HTTP）覆盖。
 * 全程零外发：链用 _chainOverride 注入或纯表单函数，绝不触真实网络。
 */
import { describe, it, expect, beforeEach } from "vitest"
import BaijiahaoAdapter from "../src/adapters/baijiahao"

describe("BaijiahaoAdapter 委托文章链（§4.4）", () => {
  let adapter
  beforeEach(() => { adapter = new BaijiahaoAdapter() })

  it("外部接口保真：getReferer/getOrigin 指向百家号图文编辑页", () => {
    expect(adapter.getReferer()).toContain("baijiahao.baidu.com")
    expect(adapter.getReferer()).toContain("type=news")
    expect(adapter.getOrigin()).toBe("https://baijiahao.baidu.com")
  })

  it("图文无视频：uploadVideo / uploadCover 返回 null（不发起请求）", async () => {
    await expect(adapter.uploadVideo({ title: "T" }, "cookie=abc")).resolves.toBeNull()
    await expect(adapter.uploadCover({ title: "T" }, "cookie=abc")).resolves.toBeNull()
  })

  it("buildPostData 委托文章链表单（type=news + aigc_bjh_status + 标题）", () => {
    const fd = adapter.buildPostData({ title: "测试标题", content: "<p>正文</p>" })
    const decoded = decodeURIComponent(fd)
    expect(decoded).toContain("type=news")
    expect(decoded).toContain("title=测试标题")
    expect(decoded).toContain("activity_list[0][id]=aigc_bjh_status")
    expect(decoded).toContain("activity_list[0][is_checked]=1")
  })

  it("buildPostData aiGenerated=false → is_checked=0（人工创作如实取消）", () => {
    const decoded = decodeURIComponent(adapter.buildPostData({ title: "T", content: "C", aiGenerated: false }))
    expect(decoded).toContain("activity_list[0][is_checked]=0")
  })

  it("buildPostData 标题按 UTF-8 字节截断到 149 上限", () => {
    const fd = adapter.buildPostData({ title: "外".repeat(50), content: "C" })
    const titlePart = /title=([^&]*)/.exec(fd)[1]
    expect(Buffer.byteLength(decodeURIComponent(titlePart), "utf8")).toBeLessThanOrEqual(149)
  })

  it("execute 委托 chain.run：私密草稿优先（opts.draft 默认 true），归一 publishId/url", async () => {
    let seen = null
    adapter._chainOverride = {
      async run (taskData, opts) { seen = { taskData, opts }; return { success: true, draft: true, publishId: "ART_1", platform: "baijiahao" } },
    }
    const result = await adapter.execute({ title: "标题", content: "正文" }, "cookie=abc", {})
    expect(seen.opts.draft).toBe(true)
    expect(result.success).toBe(true)
    expect(result.platform).toBe("baijiahao")
    expect(result.publishId).toBe("ART_1")
    expect(result.draft).toBe(true)
    expect(result.url).toContain("baijiahao.baidu.com")
  })

  it("execute 透传 opts.draft=false → 正式发布", async () => {
    let seen = null
    adapter._chainOverride = {
      async run (taskData, opts) { seen = opts; return { success: true, draft: false, publishId: "PUB_1" } },
    }
    const result = await adapter.execute({ title: "T", content: "C" }, "cookie=abc", { draft: false })
    expect(seen.draft).toBe(false)
    expect(result.success).toBe(true)
    expect(result.draft).toBe(false)
  })

  it("execute 缺标题 → 失败且不调用链（fail-closed 零请求）", async () => {
    let called = false
    adapter._chainOverride = { async run () { called = true; return { success: true } } }
    const result = await adapter.execute({ content: "无标题" }, "cookie=abc")
    expect(called).toBe(false)
    expect(result.success).toBe(false)
    expect(result.error).toContain("缺少标题")
    expect(result.platform).toBe("baijiahao")
  })

  it("execute 链返回风控失败 → 透传 error/code（不吞原始错误）", async () => {
    adapter._chainOverride = {
      async run () { return { success: false, code: 10000015, error: "百家号风控拦截：请先在浏览器中登录百家号完成验证" } },
    }
    const result = await adapter.execute({ title: "T", content: "C" }, "cookie=abc")
    expect(result.success).toBe(false)
    expect(result.code).toBe(10000015)
    expect(result.error).toContain("风控拦截")
    expect(result.platform).toBe("baijiahao")
  })

  it("execute 链抛错（如缺 cookie fail-closed）→ 捕获归一为失败结果", async () => {
    adapter._chainOverride = {
      async run () { throw new Error("baijiahao-article: missing cookie (fail-closed, refusing to publish)") },
    }
    const result = await adapter.execute({ title: "T", content: "C" }, "")
    expect(result.success).toBe(false)
    expect(result.error).toContain("missing cookie")
    expect(result.platform).toBe("baijiahao")
  })
})

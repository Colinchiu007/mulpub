// @ts-check
import { describe, it, expect, beforeEach } from "vitest"
import KuaishouAdapter from "../src/adapters/kuaishou"

describe("KuaishouAdapter AI 内容声明", () => {
  let adapter
  beforeEach(() => { adapter = new KuaishouAdapter() })

  it("默认声明为 AI 生成内容（ai_generated=1）", () => {
    const data = adapter.buildPostData({ title: "测试", content: "测试内容", tags: ["标签1"] })
    expect(data.ai_generated).toBe(1)
  })

  it("显式 aiGenerated=false 时声明为人工创作（ai_generated=0）", () => {
    const data = adapter.buildPostData({ title: "人工", aiGenerated: false })
    expect(data.ai_generated).toBe(0)
  })

  it("显式 aiGenerated=true 时声明为 AI 生成（ai_generated=1）", () => {
    const data = adapter.buildPostData({ title: "AI", aiGenerated: true })
    expect(data.ai_generated).toBe(1)
  })

  it("非布尔真值仍按 AI 生成处理", () => {
    expect(adapter.buildPostData({ title: "t", aiGenerated: undefined }).ai_generated).toBe(1)
    expect(adapter.buildPostData({ title: "t", aiGenerated: null }).ai_generated).toBe(1)
    expect(adapter.buildPostData({ title: "t", aiGenerated: 1 }).ai_generated).toBe(1)
  })

  // W3 §5.3 变薄委托后形态：快手无独立标题字段，title/content/tags 合并进 caption（与 DOM RPA _composeEditorCaption 一致）；
  // ai_generated 语义平移保持不变。
  it("标题/正文/话题合并进 caption（平台字段映射）", () => {
    const data = adapter.buildPostData({ title: "完整", content: "内容", tags: ["科技"], aiGenerated: false })
    expect(data.caption).toBe("完整\n内容\n#科技")
    expect(data.ai_generated).toBe(0)
  })

  it("空数据仍默认 AI 生成，caption 为空串", () => {
    const data = adapter.buildPostData({})
    expect(data.ai_generated).toBe(1)
    expect(data.caption).toBe("")
  })
})

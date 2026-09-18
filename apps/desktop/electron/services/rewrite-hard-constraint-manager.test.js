// @ts-check
/**
 * RewriteHardConstraintManager 单元测试
 * 覆盖：sanitize 类型防御、applyRemote 变更检测、持久化往返、getContent 回退
 */
const os = require("os")
const path = require("path")
const fs = require("fs")
const RewriteHardConstraintManager = require("./rewrite-hard-constraint-manager")

function tmpFile() {
  return path.join(os.tmpdir(), "rhc-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".json")
}

describe("RewriteHardConstraintManager", () => {
  test("sanitize：合法对象通过（title/content 清洗）", () => {
    const safe = RewriteHardConstraintManager.sanitizeRemoteHardConstraint({
      title: "  默认硬约束  ",
      content: " 只输出纯文案。 ",
    })
    expect(safe).toEqual({ title: "默认硬约束", content: "只输出纯文案。" })
  })

  test("sanitize：null/非对象/空内容/超长内容 → null", () => {
    expect(RewriteHardConstraintManager.sanitizeRemoteHardConstraint(null)).toBeNull()
    expect(RewriteHardConstraintManager.sanitizeRemoteHardConstraint("string")).toBeNull()
    expect(RewriteHardConstraintManager.sanitizeRemoteHardConstraint({ content: "   " })).toBeNull()
    expect(RewriteHardConstraintManager.sanitizeRemoteHardConstraint({ content: "x".repeat(5001) })).toBeNull()
  })

  test("sanitize：数组形态取第一个 is_default 项", () => {
    const arr = [
      { title: "A", content: "规则A", is_default: false },
      { title: "B", content: "规则B", is_default: true },
    ]
    const safe = RewriteHardConstraintManager.sanitizeRemoteHardConstraint(arr)
    expect(safe).toEqual({ title: "B", content: "规则B" })
  })

  test("sanitize：数组无默认项 → null", () => {
    expect(RewriteHardConstraintManager.sanitizeRemoteHardConstraint([
      { title: "A", content: "规则A", is_default: false },
    ])).toBeNull()
  })

  test("applyRemote：首次应用返回 true 并持久化", () => {
    const file = tmpFile()
    const mgr = new RewriteHardConstraintManager(file)
    const changed = mgr.applyRemote({ title: "默认", content: "规则1" })
    expect(changed).toBe(true)
    expect(mgr.getContent()).toBe("规则1")
    // 持久化往返
    const mgr2 = new RewriteHardConstraintManager(file)
    expect(mgr2.getContent()).toBe("规则1")
    fs.unlinkSync(file)
  })

  test("applyRemote：内容未变返回 false；变化返回 true", () => {
    const file = tmpFile()
    const mgr = new RewriteHardConstraintManager(file)
    mgr.applyRemote({ title: "默认", content: "规则1" })
    expect(mgr.applyRemote({ title: "默认", content: "规则1" })).toBe(false)
    expect(mgr.applyRemote({ title: "默认", content: "规则2" })).toBe(true)
    expect(mgr.getContent()).toBe("规则2")
    fs.unlinkSync(file)
  })

  test("applyRemote：非法载荷返回 false 且不覆盖已有值", () => {
    const file = tmpFile()
    const mgr = new RewriteHardConstraintManager(file)
    mgr.applyRemote({ title: "默认", content: "规则1" })
    expect(mgr.applyRemote(null)).toBe(false)
    expect(mgr.applyRemote({ content: "   " })).toBe(false)
    expect(mgr.getContent()).toBe("规则1")
    fs.unlinkSync(file)
  })

  test("getContent：未配置返回空串", () => {
    const file = tmpFile()
    const mgr = new RewriteHardConstraintManager(file)
    expect(mgr.getContent()).toBe("")
    expect(mgr.getCurrent()).toBeNull()
    // 未配置时不落盘（无文件产生）
    expect(fs.existsSync(file)).toBe(false)
  })
})

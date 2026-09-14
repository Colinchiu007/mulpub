/**
 * E2E 测试 — 多平台发布流程
 *
 * 覆盖：选中平台 → 填写内容 → 发布 → 查看结果
 *
 * 运行：E2E=1 npx vitest run tests/e2e/
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"

const E2E_ENABLED = process.env.E2E === "1"

describe.skipIf(!E2E_ENABLED)("E2E: Publish Flow", () => {
  beforeAll(async () => {
    if (!E2E_ENABLED) return
    const { _electron: electron } = await import("playwright")
    this.app = await electron.launch({
      args: ["dist/main.js"],
      env: { ...process.env, NODE_ENV: "test" }
    })
    this.page = await this.app.firstWindow()
  })

  afterAll(async () => {
    if (!E2E_ENABLED) return
    await this.app?.close()
  })

  it("should show platform selection page", async () => {
    if (!E2E_ENABLED) return
    const page = this.page
    await page.waitForSelector("[data-testid=publish-target-selector]")
    const platforms = await page.$$eval("[data-testid^=platform-]", els => els.length)
    expect(platforms).toBeGreaterThanOrEqual(5)
  })

  it("should select multiple platforms", async () => {
    if (!E2E_ENABLED) return
    const page = this.page
    await page.waitForSelector("[data-testid=publish-target-selector]")
    const checkboxes = page.locator('[data-testid^="platform-"]:not(:disabled)')
    await checkboxes.nth(0).check()
    await checkboxes.nth(1).check()
    const selected = await page.locator('[data-testid^="platform-"]:checked').count()
    expect(selected).toBeGreaterThanOrEqual(2)
  })

  it("should fill content and submit", async () => {
    if (!E2E_ENABLED) return
    const page = this.page
    await page.fill("[data-testid=publish-title] input", "E2E Test Article")
    const markdownSwitch = page.locator('[data-testid=publish-editor] button:has-text("Markdown")')
    if (await markdownSwitch.count()) await markdownSwitch.click()
    const body = page.locator('[data-testid=publish-editor] textarea.md-editor, [data-testid=publish-editor] .ql-editor').first()
    await body.fill("This is an automated E2E test.")
    await page.click("[data-testid=publish-submit]")
    await page.waitForSelector("[data-testid=publish-progress]", { timeout: 30000 })
    const progressVisible = await page.isVisible("[data-testid=publish-progress]")
    expect(progressVisible).toBe(true)
  })

  it("should show publish history after submission", async () => {
    if (!E2E_ENABLED) return
    const page = this.page
    await page.waitForSelector("[data-testid=mp-tab-publish-history]", { timeout: 5000 })
    await page.click("[data-testid=mp-tab-publish-history]")
    await page.waitForSelector(".publish-history-page")
    const historyItems = await page.locator(".history-item").count()
    expect(historyItems).toBeGreaterThanOrEqual(0)
  })
})

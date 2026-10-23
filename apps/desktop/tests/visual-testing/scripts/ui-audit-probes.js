/**
 * UI 视觉巡检 —— 浏览器探针（在页面上下文里枚举界面元素）。
 *
 * 独立成文件的原因同 ui-audit-scenes.js：拆分超 500 行的巡检编排文件，
 * 避免抬高「债务熔断」的文件行数基线。
 *
 * 这里的所有探针都必须是**纯函数式的页面内求值**：
 * 传给 page.evaluate 的回调会被序列化到浏览器上下文，
 * 不能引用外层作用域的任何常量（踩过：TAB_SELECTORS is not defined）。
 * 所以每个探针把选择器表**内联在回调里**。
 */

/** 渲染稳定化样式：关动画、关光标闪烁 —— 保证同一台机器两次截图逐像素可比 */
const STABLE_RENDERING_CSS = `
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    caret-color: transparent !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
  }
`

/**
 * 页面就绪等待上限（毫秒）。
 *
 * ⚠ 这个常量曾在拆分时漏带：探针文件引用了 READY_TIMEOUT，但定义留在了
 *   ui-audit-capture.js 里 —— 于是拆分后的采集脚本对**每一条路由**都抛
 *   「READY_TIMEOUT is not defined」，一张图都采不出来（巡检清单的 210 行
 *   是拆分**之前**那次运行留下的，所以表面上看不出问题）。
 *   教训见 `ui-audit-scripts.test.js` 的「采集脚本必须真能采出图」一条：
 *   只测「函数能不能被 require」不够，必须真的跑一次。
 */
const READY_TIMEOUT = 20000

/** 稳定化页面：禁用动画、等待字体与两帧 */
async function stabilize (page) {
  await page.addStyleTag({ content: STABLE_RENDERING_CSS })
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function gotoRoute (page, baseUrl, route) {
  await page.goto(`${baseUrl}/#${route}`, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT })
  await page.waitForFunction(() => {
    const app = document.querySelector('#app')
    return app?.hasAttribute('data-v-app') && (app.textContent || '').trim().length > 0
  }, { timeout: READY_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(1100)
}

/** 采集当前页面上「像标签页」的元素描述 */
async function listTabs (page) {
  return page.evaluate(() => {
    const visible = element => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const selectors = [
      '[role="tab"]',
      '[role="tabitem"]',
      '.cohere-tab',
      '.history-status-tabs button',
      '.collection-tab-btn',
      '.mp-tab',
      '.tab-btn',
      '[class*="tab-item"]',
      '[class*="tab-btn"]',
      '[class*="-tab"]',
      '[data-testid*="tab"]',
    ]
    const seen = new Set()
    const out = []
    for (const selector of selectors) {
      let nodes = []
      try { nodes = Array.from(document.querySelectorAll(selector)) } catch { continue }
      for (const node of nodes) {
        if (!visible(node)) continue
        if (node.closest('nav') && !/tab/i.test(node.className || '')) continue
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
        const key = text + '|' + (node.className || '')
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ text, index: out.length, className: String(node.className || '').slice(0, 80) })
      }
    }
    return out
  })
}

/** 页面上是否存在浮层 */
async function detectOverlay (page) {
  return page.evaluate(() => {
    const visible = element => {
      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const selectors = [
      '.el-dialog', '.el-drawer', '.el-popper', '.el-message-box', '.el-message',
      '.el-notification', '.mp-modal', '[role="dialog"]', '[role="alertdialog"]',
      '.modal-mask', '.drawer', '.popover', '.dropdown-menu', '.toast', '.snackbar',
      '.mp-settings-drawer', '.settings-drawer',
    ]
    for (const selector of selectors) {
      let nodes = []
      try { nodes = Array.from(document.querySelectorAll(selector)) } catch { continue }
      for (const node of nodes) {
        if (!visible(node)) continue
        const rect = node.getBoundingClientRect()
        if (rect.height < 60) continue
        return { selector, text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) }
      }
    }
    return null
  })
}

async function listInteractive (page) {
  return page.evaluate(() => {
    const visible = element => {
      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const buttons = []
    const inputs = []
    const nodeList = Array.from(document.querySelectorAll('button, [role="button"], input:not([type="hidden"]), textarea, select, [role="switch"], [role="checkbox"], [role="radio"], [contenteditable="true"]'))
    for (const node of nodeList) {
      if (!visible(node)) continue
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      if (rect.width < 12 || rect.height < 12) continue
      if (rect.top < 0 || rect.top > window.innerHeight - 4) continue
      const text = (node.textContent || node.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      const testId = node.getAttribute('data-testid') || ''
      const isInput = node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.getAttribute('contenteditable') === 'true'
      const disabled = Boolean(node.disabled) || node.getAttribute('aria-disabled') === 'true'
      const record = { text, testId, className: String(node.className || '').slice(0, 80), disabled, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } }
      if (isInput) inputs.push(record)
      else buttons.push(record)
    }
    return { buttons, inputs }
  })
}

module.exports = { STABLE_RENDERING_CSS, stabilize, gotoRoute, listTabs, detectOverlay, listInteractive }

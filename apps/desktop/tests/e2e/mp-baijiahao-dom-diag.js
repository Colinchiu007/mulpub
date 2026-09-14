// @ts-check
/**
 * mp Phase C 诊断 2：百家号发布页 DOM 结构检查
 *
 * 打开百家号视频创作页，检查：发布声明输入框、弹窗关闭按钮、发布按钮、
 * 以及发布后页面状态。输出 DOM 结构供选择器修复参考。
 */
const fs = require('node:fs')
const path = require('node:path')
const { _electron } = require('playwright')

const DESKTOP = path.resolve(__dirname, '..', '..')
const REPO_ROOT = path.resolve(DESKTOP, '..', '..')
const PROFILE = process.env.MP_PROFILE || 'D:\\tmp\\Multi-Publish-debug-profile'
const VITE_PORT = process.env.MP_VITE_PORT || 5394
const OUTPUT_DIR = path.join(REPO_ROOT, 'apps', 'desktop', 'tests', 'e2e-output', 'mp-dom-diag-' + Date.now())
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  let app = null
  const report = { checks: [], status: 'running' }
  const check = (name, ok, detail = '') => { const i = { name, ok, detail: String(detail || '').slice(0, 600) }; report.checks.push(i); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')) }
  try {
    app = await _electron.launch({
      executablePath: path.join(REPO_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [path.join(DESKTOP, 'electron', 'main.js'), '--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
      cwd: DESKTOP,
      env: { ...process.env, ELECTRON_USER_DATA_DIR: PROFILE, ELECTRON_DISABLE_GPU: '1', DEV_SERVER_PORT: String(VITE_PORT) },
      timeout: 120000,
    })
    const mainPage = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('主窗口超时')), 90000)
      const iv = setInterval(async () => {
        for (const w of app.windows()) {
          const title = await w.title().catch(() => '')
          if (title && title !== 'DevTools') { clearTimeout(t); clearInterval(iv); resolve(w); return }
        }
      }, 500)
    })
    check('主窗口出现', true, await mainPage.title())

    // 用主进程创建新 BrowserWindow 加载百家号（带登录分区 Cookie）
    const bjWindow = await app.evaluate(({ BrowserWindow }, url) => {
      return new Promise((resolve) => {
        try {
          const win = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: { partition: 'persist:auth-baijiahao-1787557367207', contextIsolation: false, nodeIntegration: false, sandbox: false } })
          win.loadURL(url)
          win.webContents.once('did-finish-load', () => setTimeout(() => resolve({ windowId: win.id }), 4000))
          win.webContents.on('did-fail-load', (e, code, desc) => resolve({ failed: code + ' ' + desc }))
          setTimeout(() => resolve({ windowId: win.id }), 22000)
        } catch (e) { resolve({ failed: e.message }) }
      })
    }, 'https://baijiahao.baidu.com/builder/rc/edit?type=videoV2').catch(() => null)
    if (!bjWindow || bjWindow.failed) { check('百家号窗口打开', false, JSON.stringify(bjWindow)); report.status = 'failed'; return report }
    await sleep(8000)
    const windows = app.windows()
    const bjPage = windows[windows.length - 1]
    if (!bjPage) { check('百家号窗口获取', false); report.status = 'failed'; return report }

    // DOM 检查：发布声明输入框、弹窗、按钮
    const dom = await bjPage.evaluate(() => {
      const out = {}
      const allText = document.body?.innerText || ''
      out.hasDeclaredText = allText.includes('发布声明')
      out.hasKnowBtn = allText.includes('我知道了')
      out.hasOriginalText = allText.includes('原创声明')
      const inputs = Array.from(document.querySelectorAll('input')).map((i) => ({
        placeholder: i.placeholder || '',
        type: i.type || '',
        cls: (i.className || '').slice(0, 60),
      }))
      out.inputs = inputs.slice(0, 12)
      const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({
        text: (b.innerText || '').trim().slice(0, 30),
        cls: (b.className || '').slice(0, 50),
        disabled: b.disabled,
      }))
      out.buttons = buttons.filter((b) => b.text).slice(0, 15)
      const modals = Array.from(document.querySelectorAll('[class*="modal"], [class*="dialog"], [class*="Modal"]')).map((m) => ({
        cls: (m.className || '').slice(0, 80),
        text: (m.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
      }))
      out.modals = modals.slice(0, 8)
      out.url = window.location.href
      return out
    }).catch((e) => ({ error: e.message }))

    check('百家号页面 DOM 检查', !dom.error, JSON.stringify(dom).slice(0, 900))
    report.dom = dom
    await bjPage.screenshot({ path: path.join(OUTPUT_DIR, 'baijiahao-edit-page.png') }).catch(() => {})
    report.status = 'completed'
  } catch (e) {
    report.status = 'failed'
    report.error = e.message || String(e)
    console.error('FAIL run :: ' + (e.message || String(e)))
  } finally {
    if (app) await app.close().catch(() => {})
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2))
  console.log('报告: ' + path.join(OUTPUT_DIR, 'report.json'))
  return report
}

if (require.main === module) run().then((r) => process.exit(r.status === 'completed' ? 0 : 1))
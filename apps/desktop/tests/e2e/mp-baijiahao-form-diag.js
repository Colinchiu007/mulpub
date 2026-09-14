// @ts-check
/**
 * mp Phase C 诊断 3：百家号发布页完整表单元素 dump
 *
 * 用应用的 RPA 会话（登录 Cookie）打开百家号视频创作页，
 * dump 所有 input/textarea/contenteditable 的 placeholder/aria-label/class，
 * 精确定位「用户须知」「创作声明」等发布校验字段。
 */
const fs = require('node:fs')
const path = require('node:path')
const { _electron } = require('playwright')

const DESKTOP = path.resolve(__dirname, '..', '..')
const REPO_ROOT = path.resolve(DESKTOP, '..', '..')
const PROFILE = process.env.MP_PROFILE || 'D:\\tmp\\Multi-Publish-debug-profile'
const VITE_PORT = process.env.MP_VITE_PORT || 5394
const OUTPUT_DIR = path.join(REPO_ROOT, 'apps', 'desktop', 'tests', 'e2e-output', 'mp-form-diag-' + Date.now())
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  let app = null
  const report = { checks: [], status: 'running' }
  const check = (name, ok, detail = '') => { const i = { name, ok, detail: String(detail || '').slice(0, 1200) }; report.checks.push(i); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')) }
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

    // 用主进程创建百家号窗口（带登录分区 Cookie）
    const winInfo = await app.evaluate(({ BrowserWindow }, url) => {
      return new Promise((resolve) => {
        try {
          const win = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: { partition: 'persist:auth-auth-baijiahao-1787557367207', contextIsolation: false, nodeIntegration: false, sandbox: false } })
          win.loadURL(url)
          win.webContents.once('did-finish-load', () => setTimeout(() => resolve({ windowId: win.id }), 5000))
          win.webContents.on('did-fail-load', (e, code, desc) => resolve({ failed: code + ' ' + desc }))
          setTimeout(() => resolve({ windowId: win.id }), 25000)
        } catch (e) { resolve({ failed: e.message }) }
      })
    }, 'https://baijiahao.baidu.com/builder/rc/edit?type=videoV2').catch(() => null)
    if (!winInfo || winInfo.failed) { check('百家号窗口', false, JSON.stringify(winInfo)); report.status = 'failed'; return report }
    await sleep(8000)
    const windows = app.windows()
    const bjPage = windows[windows.length - 1]

    // 上传视频（模拟 RPA CDP 上传：file input 设置 D:/01.mp4）
    const VIDEO = 'D:\\01.mp4'
    check('视频存在', require('node:fs').existsSync(VIDEO), VIDEO)
    if (require('node:fs').existsSync(VIDEO)) {
      const uploadInput = bjPage.locator('input[type="file"]').first()
      const fcPromise = bjPage.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null)
      await bjPage.evaluate(() => { const i = document.querySelector('input[type="file"]'); if (i) i.click() }).catch(() => {})
      const fc = await fcPromise
      if (fc) { await fc.setFiles(VIDEO); check('视频上传触发', true) } else { check('视频上传触发', false, 'filechooser 不可用'); }
      // 等待上传完成（预览/编辑器出现）
      await sleep(15000)
    }

    // 完整表单元素 dump（上传后状态，含"用户须知"等发布校验字段）
    const dump = await bjPage.evaluate(() => {
      const out = { inputs: [], textareas: [], contenteditables: [], buttons: [], bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 1500) }
      document.querySelectorAll('input').forEach((i) => {
        out.inputs.push({
          placeholder: i.placeholder || '',
          aria: i.getAttribute('aria-label') || '',
          cls: (i.className || '').slice(0, 80),
          type: i.type || '',
          id: i.id || '',
        })
      })
      document.querySelectorAll('textarea').forEach((t) => {
        out.textareas.push({ placeholder: t.placeholder || '', cls: (t.className || '').slice(0, 80), id: t.id || '' })
      })
      document.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"]').forEach((e) => {
        out.contenteditables.push({ cls: (e.className || '').slice(0, 80), id: e.id || '', dataAttr: (e.getAttribute('data-lexical-editor') || '') })
      })
      document.querySelectorAll('button').forEach((b) => {
        const t = (b.innerText || '').trim()
        if (t && t.length < 20) out.buttons.push({ text: t, cls: (b.className || '').slice(0, 60), disabled: b.disabled })
      })
      return out
    }).catch((e) => ({ error: e.message }))
    check('表单元素 dump', !dump.error, JSON.stringify(dump).slice(0, 1100))
    report.dump = dump
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
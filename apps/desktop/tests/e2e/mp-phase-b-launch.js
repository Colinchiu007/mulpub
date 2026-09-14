// @ts-check
/**
 * mp-ue-parity Phase B：真实应用启动验证
 *
 * 用 Playwright _electron 启动 Electron（挂 D:/tmp/Multi-Publish-debug-profile），
 * 验证：应用可启动、账号页渲染、两账号（百家号/快手）登录态展示。
 * 输出：截图 + 账号状态报告。
 */
const fs = require('node:fs')
const path = require('node:path')
const { _electron } = require('playwright')

const DESKTOP = path.resolve(__dirname, '..', '..')
const REPO_ROOT = path.resolve(DESKTOP, '..', '..')
const PROFILE = process.env.MP_PROFILE || 'D:\\tmp\\Multi-Publish-debug-profile'
const VITE_PORT = process.env.MP_VITE_PORT || 5394
const OUTPUT_DIR = path.join(REPO_ROOT, 'apps', 'desktop', 'tests', 'e2e-output', 'mp-phase-b-' + Date.now())
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const report = {
  startedAt: new Date().toISOString(),
  profile: PROFILE,
  outputDir: OUTPUT_DIR,
  checks: [],
  accounts: [],
  consoleErrors: [],
  pageErrors: [],
  mainStderr: '',
  status: 'running',
}

function check(name, ok, detail = '') {
  const item = { name, ok: Boolean(ok), detail: detail || '' }
  report.checks.push(item)
  console.log((item.ok ? 'PASS ' : 'FAIL ') + name + (item.detail ? ' :: ' + item.detail : ''))
  return item.ok
}

async function waitFor(predicate, timeoutMs = 60000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(Math.min(intervalMs, Math.max(25, deadline - Date.now())))
  }
  if (lastError) throw lastError
  return false
}

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  let app = null
  try {
    app = await _electron.launch({
      executablePath: path.join(REPO_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [path.join(DESKTOP, 'electron', 'main.js'), '--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
      cwd: DESKTOP,
      env: {
        ...process.env,
        ELECTRON_USER_DATA_DIR: PROFILE,
        ELECTRON_DISABLE_GPU: '1',
        DEV_SERVER_PORT: String(VITE_PORT),
      },
      timeout: 120000,
    })
    check('启动 Electron 成功', true, 'pid=' + app.process().pid)

    const child = app.process()
    child.stdout?.on('data', (chunk) => { /* 忽略 stdout */ })
    child.stderr?.on('data', (chunk) => { report.mainStderr += String(chunk) })

    // 等待主窗口
    const page = await waitFor(async () => {
      for (const win of app.windows()) {
        const title = await win.title().catch(() => '')
        if (title && title !== 'DevTools') return win
      }
      return null
    }, 90000, 500)
    if (!page) throw new Error('主窗口未出现')
    page.on('console', (msg) => { if (msg.type() === 'error') report.consoleErrors.push(msg.text()) })
    page.on('pageerror', (err) => report.pageErrors.push(err.message || String(err)))
    check('主窗口出现', true, await page.title())

    // 导航到账号页
    await page.goto('http://localhost:' + VITE_PORT + '/#/accounts').catch(() => {})
    await sleep(3000)
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'accounts.png'), fullPage: true })
    check('账号页截图', true, path.join(OUTPUT_DIR, 'accounts.png'))

    // 提取账号卡片信息
    const accountTexts = await page.evaluate(() => {
      const body = document.body.innerText || ''
      const cards = Array.from(document.querySelectorAll('[class*="account"], [class*="Account"]')).map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
      return { cards: cards.slice(0, 10), bodySample: body.slice(0, 2000) }
    })
    report.accounts = accountTexts
    check('账号页渲染内容', accountTexts.cards.length > 0 || accountTexts.bodySample.length > 0, 'cards=' + accountTexts.cards.length)

    // 检查登录态关键词
    const hasKuaishou = /快手|kuaishou/i.test(JSON.stringify(accountTexts))
    const hasBaijiahao = /百家号|baijiahao/i.test(JSON.stringify(accountTexts))
    check('快手账号展示', hasKuaishou, '')
    check('百家号账号展示', hasBaijiahao, '')

  
  // 附加：直接测 IPC + Python 后端
  try {
    const ipcResult = await page.evaluate(async () => {
      const api = window.electronAPI || null
      if (!api) return { hasApi: false }
      const list = await api.listAccounts().catch((e) => ({ error: e.message }))
      return { hasApi: true, list }
    })
    report.ipcAccounts = ipcResult
    check('IPC accounts:list 调用', ipcResult.hasApi, JSON.stringify(ipcResult.list).slice(0, 200))
  } catch (e) {
    report.ipcError = e.message || String(e)
  }
  // Python 后端健康
  const http = require('node:http')
  const pyHealth = await new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8299/health', (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 200) }))
    })
    req.on('error', (e) => resolve({ error: e.message }))
    req.setTimeout(5000, () => { req.destroy(); resolve({ error: 'timeout' }) })
  })
  report.pythonHealth = pyHealth
  check('Python 后端 8299 健康', pyHealth.status === 200, JSON.stringify(pyHealth))

  report.status = 'completed'
    console.log(JSON.stringify({ accounts: accountTexts }, null, 2))
  } catch (error) {
    report.status = 'failed'
    report.error = error.message || String(error)
    console.error('FAIL run :: ' + (error.message || String(error)))
  } finally {
    if (app) await app.close().catch(() => {})
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2))
  console.log('报告: ' + path.join(OUTPUT_DIR, 'report.json'))
  return report
}

module.exports = { run }

if (require.main === module) {
  run().then((r) => process.exit(r.status === 'completed' && r.checks.every((c) => c.ok) ? 0 : 1))
}
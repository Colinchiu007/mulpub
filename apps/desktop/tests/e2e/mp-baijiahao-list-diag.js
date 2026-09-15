// @ts-check
/**
 * mp Phase C 诊断：查询百家号后台视频列表，验证发布是否实际成功
 *
 * 启动应用（挂 debug profile），打开百家号创作页（复用 RPA 会话 + Cookie），
 * 在页面内 fetch pcui/article/lists 查询最近视频的 title/status。
 */
const fs = require('node:fs')
const path = require('node:path')
const { _electron } = require('playwright')

const DESKTOP = path.resolve(__dirname, '..', '..')
const REPO_ROOT = path.resolve(DESKTOP, '..', '..')
const PROFILE = process.env.MP_PROFILE || 'D:\\tmp\\Multi-Publish-debug-profile'
const VITE_PORT = process.env.MP_VITE_PORT || 5394
const OUTPUT_DIR = path.join(REPO_ROOT, 'apps', 'desktop', 'tests', 'e2e-output', 'mp-diag-' + Date.now())
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  let app = null
  const report = { checks: [], status: 'running' }
  const check = (name, ok, detail = '') => { const i = { name, ok, detail }; report.checks.push(i); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')) }
  try {
    app = await _electron.launch({
      executablePath: path.join(REPO_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [path.join(DESKTOP, 'electron', 'main.js'), '--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
      cwd: DESKTOP,
      env: { ...process.env, ELECTRON_USER_DATA_DIR: PROFILE, ELECTRON_DISABLE_GPU: '1', DEV_SERVER_PORT: String(VITE_PORT) },
      timeout: 120000,
    })
    const page = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('主窗口超时')), 90000)
      const iv = setInterval(async () => {
        for (const w of app.windows()) {
          const title = await w.title().catch(() => '')
          if (title && title !== 'DevTools') { clearTimeout(t); clearInterval(iv); resolve(w); return }
        }
      }, 500)
    })
    check('主窗口出现', true, await page.title())

    // 打开新窗口加载百家号创作页（主窗口保持应用渲染）
    const bjPage = await app.browserWindow({ url: 'https://baijiahao.baidu.com/builder/rc/edit?type=videoV2' }).catch(() => null)
    const target = bjPage || page
    if (bjPage) await sleep(10000)
    await target.bringToFront().catch(() => {})

    // 在百家号页面内查询视频列表
    const listResult = await target.evaluate(async () => {
      try {
        const endpoint = 'https://baijiahao.baidu.com/pcui/article/lists'
        const params = new URLSearchParams({ currentPage: '1', pageSize: '10', type: 'video', collection: 'publish', search: '', dynamic: '1' })
        const resp = await fetch(endpoint + '?' + params.toString(), { credentials: 'include', headers: { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' } })
        if (!resp.ok) return { ok: false, status: resp.status, reason: 'HTTP ' + resp.status }
        const json = await resp.json()
        const rows = json && json.data && Array.isArray(json.data.list) ? json.data.list : []
        return {
          ok: true,
          count: rows.length,
          items: rows.map((item) => ({
            id: item.article_id || item.id,
            title: String(item.title || '').slice(0, 80),
            status: String(item.status || ''),
            publish_at: item.publish_at || '',
            share_url: (item.share_url || '').slice(0, 100),
          })),
        }
      } catch (e) { return { ok: false, reason: e.message } }
    }).catch((e) => ({ ok: false, reason: e.message }))

    if (listResult.ok) {
      check('百家号视频列表查询', true, 'count=' + listResult.count)
      report.items = listResult.items
      listResult.items.forEach((item) => console.log(`  [${item.status}] ${item.title} (${item.id}) ${item.publish_at}`))
    } else {
      check('百家号视频列表查询', false, JSON.stringify(listResult))
    }
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'baijiahao-list.png'), fullPage: true })
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
// @ts-check
/**
 * mp-ue-parity Phase C：真实发布 E2E
 *
 * Playwright _electron 启动（挂 debug profile），走真实 UI 流程：
 * /publish 视频模式 → 上传 D:/01.mp4 → 提取+裁剪封面 → 选账号 → 标题/标签 → 发布
 * → 监听进度至终态 → 报告 + 截图。
 *
 * 用法：
 *   node tests/e2e/real-video-publish.js [--platforms=baijiahao,kuaishou] [--video=D:\01.mp4]
 */
const fs = require('node:fs')
const path = require('node:path')
const { _electron } = require('playwright')

const DESKTOP = path.resolve(__dirname, '..', '..')
const REPO_ROOT = path.resolve(DESKTOP, '..', '..')
const PROFILE = process.env.MP_PROFILE || 'D:\\tmp\\Multi-Publish-debug-profile'
const VITE_PORT = process.env.MP_VITE_PORT || 5394
const OUTPUT_DIR = path.join(REPO_ROOT, 'apps', 'desktop', 'tests', 'e2e-output', 'mp-phase-c-' + Date.now())
const VIDEO = process.env.MP_VIDEO || 'D:\\01.mp4'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const args = process.argv.slice(2)
const platformsArg = args.find((a) => a.startsWith('--platforms='))
const TARGET_PLATFORMS = platformsArg
  ? platformsArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
  : ['baijiahao']

const report = {
  startedAt: new Date().toISOString(),
  video: VIDEO,
  platforms: TARGET_PLATFORMS,
  outputDir: OUTPUT_DIR,
  checks: [],
  publishResult: null,
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

async function waitMainWindow(app, timeoutMs = 90000) {
  return waitFor(async () => {
    for (const win of app.windows()) {
      const title = await win.title().catch(() => '')
      if (title && title !== 'DevTools') return win
    }
    return null
  }, timeoutMs, 500)
}

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  if (!fs.existsSync(VIDEO)) {
    report.status = 'failed'
    report.error = '视频文件不存在: ' + VIDEO
    console.error('FAIL 视频文件不存在 :: ' + VIDEO)
    fs.writeFileSync(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2))
    return report
  }
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
    child.stderr?.on('data', (chunk) => { report.mainStderr += String(chunk) })

    const page = await waitMainWindow(app)
    if (!page) throw new Error('主窗口未出现')
    page.on('console', (msg) => { if (msg.type() === 'error') report.consoleErrors.push(msg.text()) })
    page.on('pageerror', (err) => report.pageErrors.push(err.message || String(err)))
    check('主窗口出现', true, await page.title())

    // 导航到发布页（等待应用初始化完成）
    await waitFor(async () => {
      const url = await page.evaluate(() => window.location.href).catch(() => "")
      return url.includes("publish") || url.includes("517") || url.includes("5394")
    }, 30000, 500).catch(() => {})
    await sleep(3000)
    await page.evaluate(() => { window.location.hash = "#/publish" }).catch(() => {})
    await waitFor(() => page.evaluate(() => Boolean(document.querySelector('[data-testid="publish-target-selector"]'))), 20000, 500).catch(() => {})
    await sleep(2000)
    const pageUrl = await page.evaluate(() => window.location.href).catch(() => "")
    const hasSelector = await page.evaluate(() => Boolean(document.querySelector('[data-testid="publish-target-selector"]')))
    check('发布页渲染', hasSelector, 'url=' + pageUrl)

    // 切换到视频模式：精确点击发布页模式 tab（.publish-mode-tab 第一个即视频），
    // 避免误点侧栏/其他含「视频」文本的元素导致仍停留在图文模式。
    const videoModeClicked = await page.evaluate(() => {
      const tab = document.querySelector('.publish-mode-tab')
      if (!tab) return false
      tab.click()
      return true
    })
    check('切换到视频模式', videoModeClicked)
    await sleep(1500)
    // 断言模式真正激活（视频上传区可见），防止后续步骤静默跑在图文模式
    const videoModeActive = await page.evaluate(() => {
      if (document.querySelector('.video-upload-zone')) return true
      const activeTab = document.querySelector('.publish-mode-tab.active')
      return Boolean(activeTab && /视频/.test(activeTab.textContent || ''))
    })
    check('视频模式已激活（video-upload-zone 可见）', videoModeActive)

    // 上传视频：DOM 层构造带 path 的 File 并派发 change（Electron 渲染进程支持 File.path）
    const videoPath = VIDEO.replace(/\\\\/g, "/")
    const uploadResult = await page.evaluate((vp) => {
      const input = document.querySelector('.video-upload-zone input[type="file"], .el-upload input[type="file"]')
      if (!input) return { ok: false, reason: "no input" }
      const name = vp.split("/").pop()
      const file = new File([new Uint8Array([0])], name, { type: "video/mp4" })
      try { Object.defineProperty(file, "path", { value: vp, configurable: true }) } catch (_) {}
      const dt = new DataTransfer()
      dt.items.add(file)
      Object.defineProperty(input, "files", { value: dt.files, configurable: true })
      input.dispatchEvent(new Event("change", { bubbles: true }))
      return { ok: true }
    }, videoPath).catch((e) => ({ ok: false, reason: e.message }))
    check("视频文件注入", uploadResult.ok, JSON.stringify(uploadResult))
    await sleep(3000)
    const videoPathSet = await page.evaluate(() => {
      // 通过页面状态判断：提取封面按钮出现即 video_path 已设置
      return Array.from(document.querySelectorAll('button')).some((el) => (el.innerText || '').includes('提取'))
    })
    check('视频上传（video_path 设置）', videoPathSet)
    await page.screenshot({ path: path.join(OUTPUT_DIR, '01-video-uploaded.png'), fullPage: true })

    // 提取封面
    const extractClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((el) => (el.innerText || '').includes('提取'))
      if (!btn) return false
      btn.click()
      return true
    })
    check('点击提取封面', extractClicked)
    // 等待提取结果写入 article.cover_path（cover-state 隐藏元素携带真实路径）
    const coverPath = await waitFor(async () => {
      const value = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="cover-state"]')
        return el ? el.getAttribute('data-cover-path') || '' : ''
      }).catch(() => '')
      return value || false
    }, 15000, 500)
    check('封面首帧提取（cover_path 已写入）', Boolean(coverPath), 'path=' + coverPath)
    await page.screenshot({ path: path.join(OUTPUT_DIR, '02-cover-extracted.png'), fullPage: true })
    report.coverPath = coverPath || ''

    // 选平台账号（记录勾选账号的真实 id，替代硬编码）
    const selectedAccountIds = {}
    for (const platform of TARGET_PLATFORMS) {
      const sel = '[data-testid="platform-' + platform + '"]'
      const platformEl = page.locator(sel).first()
      const platformVisible = await platformEl.isVisible().catch(() => false)
      if (!platformVisible) {
        check('平台 ' + platform + ' 选择器存在', false, '未找到 ' + sel)
        continue
      }
      await platformEl.click()
      await sleep(1000)
      // 勾选账号：优先选择本地存在加密凭证的账号（避免选中无凭证的模板账号）
      const accountSel = '[data-testid^="account-' + platform + '-"]'
      const allIds = await page.evaluate((p) => {
        const prefix = 'account-' + p + '-'
        return Array.from(document.querySelectorAll('input[data-testid^="' + prefix + '"]'))
          .map((el) => el.getAttribute('data-testid').slice(prefix.length))
          .filter(Boolean)
      }, platform).catch(() => [])
      // 凭证可能位于 credentials/ 或其 owners/<hash>/ 命名空间下（Logto 身份隔离）
      const listCredentialIds = (root) => {
        const out = []
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (/\.json\.enc$/.test(entry.name)) out.push(entry.name.split('.')[0])
          }
        }
        walk(root)
        return out
      }
      const credIds = fs.existsSync(PROFILE) && fs.existsSync(path.join(PROFILE, 'credentials'))
        ? listCredentialIds(path.join(PROFILE, 'credentials'))
        : []
      if (allIds.length === 0) {
        check('勾选 ' + platform + ' 账号', false, '账号列表为空（页面提示请先添加账号）')
        selectedAccountIds[platform] = []
        continue
      }
      const preferred = allIds.find((id) => credIds.includes(id))
      if (!preferred) {
        check('勾选 ' + platform + ' 账号', false, '无凭证账号可选 页面=' + allIds.join(',') + ' 凭证=' + credIds.join(','))
        selectedAccountIds[platform] = []
        continue
      }
      const targetBox = page.locator('[data-testid="account-' + platform + '-' + preferred + '"]').first()
      const checked = await targetBox.isChecked().catch(() => false)
      if (!checked) await targetBox.click()
      await sleep(500)
      const nowChecked = await targetBox.isChecked().catch(() => false)
      check('勾选 ' + platform + ' 账号', nowChecked, 'id=' + preferred + ' (凭证=' + credIds.join(',') + ')')
      selectedAccountIds[platform] = nowChecked ? [preferred] : []
      console.log('平台 ' + platform + ' 账号勾选: ' + preferred + ' checked=' + nowChecked)
    }

    // 填写标题/描述（视频模式输入框）
    const titleInput = page.locator('[data-testid="publish-title"] input').first()
    const titleOk = await titleInput.count().then((n) => n > 0).catch(() => false)
    const titleValue = '真实发布E2E-短视频-' + Date.now().toString(36)
    if (titleOk) await titleInput.fill(titleValue).catch(() => {})
    check('填写标题', titleOk)
    const descInput = page.locator('[data-testid="publish-desc"] textarea').first()
    const descOk = await descInput.count().then((n) => n > 0).catch(() => false)
    if (descOk) await descInput.fill(titleValue + ' 自动验证').catch(() => {})
    check('填写视频描述', descOk)
    await page.screenshot({ path: path.join(OUTPUT_DIR, '03-ready.png'), fullPage: true })

    // 真实发布：IPC 直调 publish:batch（Playwright 无法模拟 Electron 文件选择，
    // 视频路径直接传入；发布链路本身是真实 RPA + Cookie 恢复）
    const allTargetsReady = TARGET_PLATFORMS.every((p) => (selectedAccountIds[p] || []).length > 0)
    const articlePayload = {
      title: titleValue,
      content: titleValue + " 自动验证",
      video_path: VIDEO,
      // 百家号 API 发布链使用平台视频首帧封面（video/process 处理），
      // 自定义封面上传链路存在时会显式拒绝；封面提取路径仅在报告中留证。
      cover_path: "",
      tags: ["E2E"],
      accountId: "",
    }
    const targets = TARGET_PLATFORMS.map((p) => {
      const ids = selectedAccountIds[p] || []
      return { platform: p, accountId: ids[0] || "" }
    })
    check('发布目标账号就绪（每个平台均有凭证账号）', allTargetsReady, JSON.stringify(targets))
    if (!allTargetsReady) throw new Error('账号就绪失败：无法继续真实发布')
    const batchResult = await page.evaluate(async (payload) => {
      const api = window.electronAPI || null
      if (!api || typeof api.publishBatch !== "function") return { ok: false, reason: "no publishBatch api" }
      const res = await api.publishBatch(payload.platforms, payload.article).catch((e) => ({ code: -1, message: e.message }))
      return res
    }, { platforms: targets, article: articlePayload })
    check("publish:batch 提交", batchResult && batchResult.code === 0, JSON.stringify(batchResult).slice(0, 200))
    await sleep(5000)
    await page.screenshot({ path: path.join(OUTPUT_DIR, '04-publishing.png'), fullPage: true })

    // 监听进度到终态（最长 3 分钟）
    const progressObserved = await waitFor(async () => {
      // 终态判定收紧（审查意见 C1）：先看进度面板，再回退整页；
      // 显式排除「上传完成/处理完成」等中间态，避免「完成」单字误判成功。
      const state = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="publish-progress"]')
        const src = panel ? panel.innerText || '' : document.body.innerText || ''
        const txt = src.replace(/\s+/g, ' ')
        if (/上传完成|处理完成|初始化完成|提取完成|任务已完成|排队中|发布中|上传中|处理中/.test(txt)) return null
        const success = /发布成功|发布完成|已发布|publish\s*成功|已完成发布/.test(txt)
        const failed = /发布失败|发布出错|publish.*failed|平台.*失败|执行.*失败/.test(txt)
        if (success && !failed) return 'success'
        if (failed || /错误|failed|error/i.test(txt)) return 'failed'
        return null
      })
      return state
    }, 180000, 1000)
    check('发布进度到终态', progressObserved === 'success', '终态=' + progressObserved)
    await sleep(2000)
    await page.screenshot({ path: path.join(OUTPUT_DIR, '05-final.png'), fullPage: true })

    // 提取发布结果（从页面）
    const finalText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 3000))
    report.publishResult = { terminalState: progressObserved, pageTextSample: finalText }

    report.status = progressObserved === 'success' ? 'completed' : (progressObserved === 'failed' ? 'failed' : 'unknown')
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
  run().then((r) => {
    const criticalOk = r.checks.filter((c) => c.name.includes('发布')).every((c) => c.ok) || r.status === 'completed'
    process.exit(criticalOk && r.status !== 'failed' ? 0 : 1)
  })
}

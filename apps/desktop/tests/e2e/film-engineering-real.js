// @ts-check

/**
 * 电影工程真实 Electron E2E。
 *
 * 使用已打包的 Multi-Publish.exe，通过真实 preload/IPC/film-kit 驱动页面，
 * 覆盖入口、分镜库、详情、复制、导出、剧本套用、方法论和生成入口。
 * 生成图片是否真正成功取决于测试 profile 中是否配置图片 Provider；
 * 未配置时把“Provider 不可用”记录为环境阻断，但把参数校验错误视为失败。
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('playwright')

const DESKTOP = path.resolve(__dirname, '..', '..')
const EXE = process.env.FILM_E2E_EXE || path.join(DESKTOP, 'dist-electron', 'win-unpacked', 'Multi-Publish.exe')
const REPO_ROOT = path.resolve(DESKTOP, '..', '..')
const OUTPUT_DIR = process.env.FILM_E2E_OUTPUT
  ? path.resolve(REPO_ROOT, process.env.FILM_E2E_OUTPUT)
  : path.join(os.tmpdir(), 'multi-publish-film-engineering-e2e-' + Date.now())
const GENERATION_RESULT_TIMEOUT = 30000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const report = {
  startedAt: new Date().toISOString(),
  executable: EXE,
  outputDir: OUTPUT_DIR,
  checks: [],
  messages: [],
  consoleErrors: [],
  pageErrors: [],
  mainStdout: '',
  mainStderr: '',
  status: 'running',
}

function check (name, ok, detail = '') {
  const item = { name, ok: Boolean(ok), detail: detail || '' }
  report.checks.push(item)
  console.log((item.ok ? 'PASS ' : 'FAIL ') + name + (item.detail ? ' :: ' + item.detail : ''))
  return item.ok
}

function messageText (value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

async function waitFor (predicate, timeoutMs = 30000, intervalMs = 250) {
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

async function waitMainWindow (app, timeoutMs = 90000) {
  return waitFor(async () => {
    for (const window of app.windows()) {
      const title = await window.title().catch(() => '')
      if (title && title !== 'DevTools') return window
    }
    return null
  }, timeoutMs, 500)
}

async function capturedMessages (page) {
  return page.evaluate(() => Array.isArray(window.__filmEngineeringE2eMessages)
    ? window.__filmEngineeringE2eMessages.slice()
    : [])
}

async function assertNoValidationMessage (page, action) {
  const messages = await capturedMessages(page)
  const invalid = messages.filter((text) => text.includes('提交的数据不符合要求'))
  report.messages = messages
  return check(action + ' 未出现参数校验错误', invalid.length === 0, invalid.join(' | '))
}

async function waitForToast (page, pattern, timeoutMs = 10000, intervalMs = 200) {
  return waitFor(async () => {
    const messages = await capturedMessages(page)
    return messages.find((text) => pattern.test(text)) || ''
  }, timeoutMs, intervalMs)
}

async function installMessageObserver (page) {
  await page.evaluate(() => {
    window.__filmEngineeringE2eMessages = []
    const collect = () => {
      const values = Array.from(document.querySelectorAll('.el-message, .el-message-box'))
        .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
      for (const value of values) {
        if (!window.__filmEngineeringE2eMessages.includes(value)) {
          window.__filmEngineeringE2eMessages.push(value)
        }
      }
    }
    collect()
    const observer = new MutationObserver(collect)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    window.__filmEngineeringE2eMessageObserver = observer
  })
}

function classifyVideoOutcome (observed) {
  const o = observed || {}
  if (o.openFolderVisible) return 'done'
  if (o.gotoModelVisible) return 'fail-closed'
  return 'unknown'
}

async function run () {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  if (!fs.existsSync(EXE)) throw new Error('打包应用不存在: ' + EXE)

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'film-engineering-profile-'))
  let app = null
  let page = null

  try {
    app = await _electron.launch({
      executablePath: EXE,
      args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
      cwd: DESKTOP,
      env: {
        ...process.env,
        ELECTRON_USER_DATA_DIR: profile,
        ELECTRON_DISABLE_GPU: '1',
      },
      timeout: 120000,
    })
    check('打包 Electron 进程启动', true, 'pid=' + app.process().pid)

    const child = app.process()
    child.stdout?.on('data', (chunk) => { report.mainStdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { report.mainStderr += String(chunk) })

    page = await waitMainWindow(app)
    if (!page) throw new Error('主窗口未出现')
    page.on('console', (message) => {
      if (message.type() === 'error') report.consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => report.pageErrors.push(error.message || String(error)))
    await installMessageObserver(page)
    check('主窗口出现', true, await page.title())

    await page.evaluate(() => { window.location.hash = '#/create' })
    const entry = page.locator('[data-pipeline-id="film-engineering"]').first()
    await entry.waitFor({ state: 'visible', timeout: 30000 })
    check('视频创作页显示电影工程入口', true, messageText(await entry.textContent()))
    await page.screenshot({ path: path.join(OUTPUT_DIR, '01-create-film-engineering.png'), fullPage: true })

    await entry.click()
    await page.locator('.film-engineering-view').waitFor({ state: 'visible', timeout: 30000 })
    check('点击入口进入电影工程', true, await page.url())

    const unavailable = page.locator('.fe-empty-detail')
    const available = page.locator('.fe-meta-title')
    await waitFor(async () => (await available.isVisible().catch(() => false)) || (await unavailable.isVisible().catch(() => false)), 30000, 250)
    if (await unavailable.isVisible().catch(() => false)) {
      const detail = messageText(await unavailable.textContent())
      check('film-kit 随包资源可用', false, detail)
      throw new Error('film-kit 不可用，无法继续真实电影工程流程: ' + detail)
    }
    check('film-kit 随包资源可用', true, messageText(await available.textContent()))
    check('Hell Grind 元信息加载', (await available.textContent() || '').includes('Hell Grind'))

    const sceneNodes = page.locator('.fe-scene-node')
    await waitFor(async () => (await sceneNodes.count()) > 0, 30000, 250)
    check('场景树加载', (await sceneNodes.count()) > 0, 'count=' + await sceneNodes.count())
    const sceneWithShots = sceneNodes.filter({ has: page.locator('.fe-scene-badge') }).first()
    check('场景树包含可浏览分镜的场景', await sceneWithShots.count() > 0)
    const firstScene = sceneWithShots
    await firstScene.click()
    const shots = page.locator('.fe-shot-card')
    await waitFor(async () => (await shots.count()) > 0, 30000, 250)
    if ((await shots.count()) === 0) throw new Error('选中的场景没有加载分镜')
    check('分镜列表加载', (await shots.count()) > 0, 'count=' + await shots.count())
    check('分镜卡包含复制入口', await shots.first().locator('.fe-shot-copy').count() === 1)
    await assertNoValidationMessage(page, '进入分镜库')

    await shots.first().locator('.fe-shot-body').click()
    const detail = page.locator('.fe-detail')
    const detailLoaded = await waitFor(async () => await detail.isVisible().catch(() => false), 15000, 250)
    check('点击分镜打开详情抽屉', Boolean(detailLoaded))
    if (detailLoaded) {
      check('详情包含提示词正文', (await detail.locator('.fe-prompt-text').textContent() || '').trim().length > 0)
      const drawerCopy = detail.locator('[data-testid="fe-detail-copy"]')
      await drawerCopy.click()
      await waitForToast(page, /提示词已复制|复制失败/, 10000)
      await assertNoValidationMessage(page, '分镜详情复制')
      await page.keyboard.press('Escape')
    }

    await shots.first().locator('.fe-shot-check').click()
    const batchCopy = page.locator('[data-testid="fe-copy-selected"]')
    const exportJson = page.locator('[data-testid="fe-export-json"]')
    const exportMarkdown = page.locator('[data-testid="fe-export-markdown"]')
    const generate = page.locator('[data-testid="fe-generate"]')
    check('勾选分镜后批量工具栏可用', !(await batchCopy.isDisabled()) && !(await exportJson.isDisabled()) && !(await exportMarkdown.isDisabled()))

    await batchCopy.click()
    await waitForToast(page, /已复制|复制失败/, 10000)
    await assertNoValidationMessage(page, '批量复制')

    await exportJson.click()
    await waitForToast(page, /已导出|导出失败/, 10000)
    await assertNoValidationMessage(page, 'JSON 导出')
    await exportMarkdown.click()
    await waitForToast(page, /已导出|导出失败/, 10000)
    await assertNoValidationMessage(page, 'Markdown 导出')

    const adaptTab = page.locator('.fe-tabs .el-tabs__item').filter({ hasText: '剧本套用' })
    await adaptTab.click()
    const script = page.locator('.fe-adapt textarea')
    await script.fill('第1场\n小林在雨夜走进车站。\n\n第2场\n小林在月台发现一枚旧钥匙。')
    await page.locator('.fe-role-value input').first().fill('小林')
    await page.locator('.fe-adapt-actions .el-button').click()
    const adapted = page.locator('.fe-adapted-card')
    const adaptedLoaded = await waitFor(async () => (await adapted.count()) > 0, 15000, 250)
    check('剧本套用生成本地分镜', Boolean(adaptedLoaded), 'count=' + await adapted.count())
    await assertNoValidationMessage(page, '剧本套用')

    const doctrineTab = page.locator('.fe-tabs .el-tabs__item').filter({ hasText: '提示词方法论' })
    await doctrineTab.click()
    const doctrine = page.locator('.fe-doctrine')
    await doctrine.waitFor({ state: 'visible', timeout: 15000 })
    check('提示词方法论加载', (await doctrine.locator('.fe-doctrine-block').count()) > 0 && (await doctrine.locator('.fe-doctrine-rule').count()) > 0)

    const libraryTab = page.locator('.fe-tabs .el-tabs__item').filter({ hasText: '分镜库' })
    await libraryTab.click()
    await generate.click()
    const generateMessage = await waitForToast(page, /已提交|生成完成|Provider|配置|不可用|生成失败|提交的数据不符合要求/, GENERATION_RESULT_TIMEOUT)
    const expectedProviderBlock = /Provider|配置|不可用|API|模型服务商/i.test(generateMessage)
    const generationSucceeded = /已提交|生成完成/.test(generateMessage)
    check('生成入口已真实调用且未触发参数校验错误', Boolean(generateMessage) && !/提交的数据不符合要求/.test(generateMessage), generateMessage || '未捕获生成结果提示')
    check('生成结果可分类', Boolean(generateMessage) && (expectedProviderBlock || generationSucceeded || /生成失败/.test(generateMessage)), generateMessage || '未知结果')
    if (expectedProviderBlock && !generationSucceeded) {
      console.log('INFO 生成图片被当前临时 profile 的 Provider 配置阻断')
    }
    await assertNoValidationMessage(page, '生成入口')

    // ===== 6.1 分镜视频生成打包 E2E（成本闸 / 确认卡 / 确认前零调用 / fail-closed）=====
    await page.keyboard.press('Escape').catch(() => {})
    if ((await shots.count()) > 1) {
      await shots.nth(1).locator('.fe-shot-check').click()
    }
    const videoEntry = page.locator('[data-testid="fe-video-entry"]')
    await videoEntry.waitFor({ state: 'visible', timeout: 15000 })
    check('视频生成入口按钮存在', true)
    check('视频生成入口按钮已启用（数组参数化入口）', !(await videoEntry.isDisabled()))

    await videoEntry.click()
    const videoPanel = page.locator('.fe-vg').first()
    const panelVisible = await waitFor(async () => await videoPanel.isVisible().catch(() => false), 15000, 250)
    check('视频发起面板（idle）渲染', Boolean(panelVisible))
    const videoStart = page.locator('[data-testid="fe-video-start"]')
    check('视频发起按钮存在', (await videoStart.count()) > 0)
    await videoStart.click()

    // 停在 generate_videos 成本闸 → 确认卡渲染；确认前不得出现逐镜成功（成本闸未过零 provider 调用的前端可观测代理）
    const confirmBtn = page.locator('[data-testid="fe-video-confirm"]')
    const confirmRendered = await waitFor(async () => await confirmBtn.isVisible().catch(() => false), GENERATION_RESULT_TIMEOUT * 2, 500)
    check('成本确认卡渲染（停在成本闸）', Boolean(confirmRendered))
    let successBeforeConfirm = 0
    if (confirmRendered) {
      const shotRows = await page.locator('.fe-vg-shot').count()
      check('成本确认卡含逐镜清单', shotRows > 0, 'rows=' + shotRows)
      successBeforeConfirm = await page.locator('.fe-vg-shot .el-tag--success').count()
      check('确认前零逐镜成功（成本闸未过不调用 provider）', successBeforeConfirm === 0, 'successBeforeConfirm=' + successBeforeConfirm)
    }
    await assertNoValidationMessage(page, '视频成本确认卡')

    const outcome = { gotoModelVisible: false, openFolderVisible: false }
    if (confirmRendered) {
      await confirmBtn.click()
      const gotoModels = page.locator('[data-testid="fe-video-goto-models"]')
      outcome.gotoModelVisible = Boolean(await waitFor(async () => await gotoModels.isVisible().catch(() => false), GENERATION_RESULT_TIMEOUT * 2, 1000))
      outcome.openFolderVisible = Boolean(await waitFor(async () => await page.locator('[data-testid="fe-video-open-folder"]').isVisible().catch(() => false), 3000, 500))
      const verdict = classifyVideoOutcome(outcome)
      check('确认后要么出成片要么 fail-closed（不静默失败）', verdict !== 'unknown', verdict)
      if (verdict === 'fail-closed') {
        const noModelHint = await page.locator('.fe-vg-hint').first().textContent().catch(() => '')
        check('fail-closed 给出未配置视频模型引导（跳模型设置）', messageText(noModelHint).length > 0, messageText(noModelHint))
      }
    }
    await assertNoValidationMessage(page, '分镜视频生成')
    await page.screenshot({ path: path.join(OUTPUT_DIR, '03-film-engineering-video.png'), fullPage: true })
    await page.screenshot({ path: path.join(OUTPUT_DIR, '02-film-engineering-final.png'), fullPage: true })
    report.messages = await capturedMessages(page)
    report.status = report.checks.every((item) => item.ok) ? 'passed' : 'failed'
  } catch (error) {
    report.status = 'failed'
    report.failure = error instanceof Error ? error.stack || error.message : String(error)
    console.error('E2E_FAILURE ' + report.failure)
    if (page) {
      await page.screenshot({ path: path.join(OUTPUT_DIR, '99-film-engineering-failure.png'), fullPage: true }).catch(() => {})
      report.messages = await capturedMessages(page).catch(() => [])
    }
  } finally {
    if (app) await app.close().catch((error) => { report.closeError = String(error) })
    fs.rmSync(profile, { recursive: true, force: true })
    report.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(OUTPUT_DIR, 'film-engineering-real-e2e.json'), JSON.stringify(report, null, 2))
    fs.writeFileSync(path.join(OUTPUT_DIR, 'film-engineering-main-stdout.log'), report.mainStdout)
    fs.writeFileSync(path.join(OUTPUT_DIR, 'film-engineering-main-stderr.log'), report.mainStderr)
    console.log('EVIDENCE_DIR=' + OUTPUT_DIR)
    console.log('E2E_STATUS=' + report.status)
  }

  if (report.status !== 'passed') process.exitCode = 1
}

if (require.main === module) {
  run().catch((error) => {
    report.status = 'failed'
    report.failure = error instanceof Error ? error.stack || error.message : String(error)
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    fs.writeFileSync(path.join(OUTPUT_DIR, 'film-engineering-real-e2e.json'), JSON.stringify(report, null, 2))
    console.error('E2E_FATAL ' + report.failure)
    process.exitCode = 1
  })
}

module.exports = {
  GENERATION_RESULT_TIMEOUT,
  waitForToast,
  classifyVideoOutcome,
}

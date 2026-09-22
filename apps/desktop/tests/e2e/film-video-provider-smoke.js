// @ts-check
/**
 * film-video-provider-smoke.js — 6.2 opt-in 真实 provider 冒烟脚本（手动触发，不进默认 CI）
 *
 * 目的（design D10 / OQ2 / 风险条目「超长 kit 提示词被截断」）：
 *  - 最短 + 最长 kit 分镜各出 1 镜 5s 片，ffprobe 记录真实返回规格
 *    （宽高/时长/帧率/编码），消化 source 画幅的 adapter 实际行为；
 *  - 走完整成本闸 UI 路径（登录 profile → start → 确认卡 advance → 逐镜结果），
 *    补 6.1 未登录临时 profile 下标 SKIP 的两个断言项的真环境证据。
 *
 * ⚠️ 会产生真实 provider 计费。双保险 opt-in：
 *    未设 FILM_SMOKE_OPT_IN=1 一律 fail-closed 拒绝启动（不拉起 Electron、零计费）。
 *
 * 前置条件（缺一即 fail-closed 退出，不半途计费）：
 *  1. 打包应用存在（FILM_SMOKE_EXE，默认 dist-electron/win-unpacked/Multi-Publish.exe）
 *  2. 已登录 profile（FILM_SMOKE_PROFILE，默认 D:\tmp\Multi-Publish-debug-profile），
 *     authenticated 通道可用（未登录时 pipeline:start-orchestrated 被许可证门拦截）
 *  3. 该 profile 已配置默认视频模型（getDefault('video')，如 Seedance/Kling/Veo）
 *  4. ffprobe 在 PATH（用于记录真实规格；缺失则仅告警并跳过规格记录）
 *
 * 用法（Git Bash 示例）：
 *   FILM_SMOKE_OPT_IN=1 node tests/e2e/film-video-provider-smoke.js [--cases=short-long,source]
 * 环境变量：
 *   FILM_SMOKE_OPT_IN   必须 =1（计费确认）
 *   FILM_SMOKE_EXE / FILM_SMOKE_PROFILE / FILM_SMOKE_OUTPUT / FILM_SMOKE_TIMEOUT_MS
 *
 * 用例：
 *   short-long：最短 prompt 出 1 镜（16x9/5s）+ 最长 prompt 出 1 镜（16x9/5s，验证超长不被静默截断）
 *   source   ：最短 prompt 出 1 镜（source 画幅/5s），ffprobe 对照 16x9 结果固化 OQ2
 *   all      ：以上全部（默认）
 *
 * 证据：JSON 报告（checks + 每 case 的 ffprobe 规格 + 截图）落 FILM_SMOKE_OUTPUT。
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { _electron } = require('playwright')

const DESKTOP = path.resolve(__dirname, '..', '..')
const REPO_ROOT = path.resolve(DESKTOP, '..', '..')
const EXE = process.env.FILM_SMOKE_EXE || path.join(DESKTOP, 'dist-electron', 'win-unpacked', 'Multi-Publish.exe')
const SRC_PROFILE = process.env.FILM_SMOKE_PROFILE || 'D:\\tmp\\Multi-Publish-debug-profile'
const OUTPUT_DIR = process.env.FILM_SMOKE_OUTPUT
  ? path.resolve(REPO_ROOT, process.env.FILM_SMOKE_OUTPUT)
  : path.join(DESKTOP, 'tests', 'e2e', 'reports', 'film-62-smoke-' + Date.now())
const VIDEO_TIMEOUT_MS = Number(process.env.FILM_SMOKE_TIMEOUT_MS || 15 * 60 * 1000)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const CASES_ARG = (process.argv.slice(2).find((a) => a.startsWith('--cases=')) || '--cases=all').split('=')[1]
const CASE_SET = CASES_ARG === 'all' ? new Set(['short', 'long', 'source']) : new Set(CASES_ARG.split(',').map((s) => s.trim()).filter(Boolean))

const report = {
  startedAt: new Date().toISOString(),
  exe: EXE,
  profile: SRC_PROFILE,
  cases: [...CASE_SET],
  outputDir: OUTPUT_DIR,
  checks: [],
  specs: [],
  consoleErrors: [],
  pageErrors: [],
  mainStderr: '',
  status: 'running',
}

function check (name, ok, detail = '') {
  const item = { name, ok: Boolean(ok), detail: String(detail || '') }
  report.checks.push(item)
  console.log((item.ok ? 'PASS ' : 'FAIL ') + name + (item.detail ? ' :: ' + item.detail : ''))
  return item.ok
}

async function waitFor (predicate, timeoutMs = 60000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch { /* 轮询窗口内容忍瞬态错误 */ }
    await sleep(Math.min(intervalMs, Math.max(25, deadline - Date.now())))
  }
  return false
}

async function waitMainWindow (app, timeoutMs = 120000) {
  return waitFor(async () => {
    for (const win of app.windows()) {
      const title = await win.title().catch(() => '')
      if (title && title !== 'DevTools') return win
    }
    return null
  }, timeoutMs, 500)
}

/** ffprobe 真实规格（失败返回 null，不阻断冒烟主流程） */
function probeSpec (file) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_frames',
      '-show_entries', 'format=duration',
      '-of', 'json', file,
    ], { encoding: 'utf8' })
    const json = JSON.parse(out)
    const st = (json.streams && json.streams[0]) || {}
    return {
      file: path.basename(file),
      codec: st.codec_name || null,
      width: st.width || null,
      height: st.height || null,
      avg_frame_rate: st.avg_frame_rate || null,
      nb_frames: st.nb_frames || null,
      duration: json.format && json.format.duration ? Number(json.format.duration) : null,
      sizeBytes: fs.statSync(file).size,
    }
  } catch (e) {
    console.log('WARN ffprobe 失败（' + path.basename(file) + '）: ' + (e && e.message ? e.message.split('\n')[0] : String(e)))
    return null
  }
}

function messageText (t) { return String(t || '').replace(/\s+/g, ' ').trim() }

/**
 * 单个视频生成用例：勾选目标分镜 → 打开面板 → 选画幅/时长 → start → 成本闸确认 → 等终态。
 * 返回 { reached, verdict, runId }；计费发生与否以 verdict=done/failed 为准。
 */
async function runVideoCase (page, target, ui, aspect) {
  const { shots, confirmBtn, videoStart, videoPanel } = ui
  if (!(await shots.count())) throw new Error('分镜列表为空，无法定位目标分镜')
  const idx = target.uiIndex
  if (idx < 0 || idx >= await shots.count()) throw new Error('目标分镜不在当前列表（uiIndex=' + idx + ' count=' + (await shots.count()) + '）')

  // 清理既有勾选（面板入口要求恰好 1 项，避免混选计费）
  for (let i = 0; i < await shots.count(); i++) {
    const box = shots.nth(i).locator('.fe-shot-check')
    if (await box.isChecked().catch(() => false)) await box.click().catch(() => {})
  }
  await shots.nth(idx).locator('.fe-shot-check').click()

  await page.locator('[data-testid="fe-video-entry"]').waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('[data-testid="fe-video-entry"]').click()
  await videoPanel.waitFor({ state: 'visible', timeout: 15000 })

  // 画幅 / 时长选择（el-select：点开再选项）
  const aspectSelect = page.locator('[data-testid="fe-video-aspect"]')
  if (await aspectSelect.count()) {
    await aspectSelect.click()
    await page.locator('.el-select-dropdown__item').filter({ hasText: aspect === 'source' ? /原片|source/i : /16\s*[x:×]\s*9/i }).first().click()
  }
  const secondsSelect = page.locator('[data-testid="fe-video-seconds"]')
  if (await secondsSelect.count()) {
    await secondsSelect.click()
    await page.locator('.el-select-dropdown__item').filter({ hasText: /\b5\b/ }).first().click()
  }

  await videoStart.click()
  const gate = { confirmVisible: false, gotoModelVisible: false, errorText: '' }
  const reachedGate = await waitFor(async () => {
    gate.confirmVisible = await confirmBtn.isVisible().catch(() => false)
    gate.gotoModelVisible = await page.locator('[data-testid="fe-video-goto-models"]').isVisible().catch(() => false)
    gate.errorText = (gate.confirmVisible || gate.gotoModelVisible) ? '' : messageText(await page.locator('.fe-vg .fe-vg-error').first().textContent().catch(() => ''))
    return gate.confirmVisible || gate.gotoModelVisible || gate.errorText.includes('许可证')
  }, 120000, 500)
  if (!reachedGate) return { reached: false, verdict: 'gate-timeout', errorText: gate.errorText }
  if (!gate.confirmVisible) {
    return { reached: true, verdict: gate.gotoModelVisible ? 'no-video-model' : 'license-gated', errorText: gate.errorText }
  }

  // 成本闸全路径证据（6.1 SKIP 项的登录环境补全）
  check('[' + target.label + '] 成本确认卡渲染（登录环境全路径）', true)
  const shotRows = await page.locator('.fe-vg-shot').count()
  check('[' + target.label + '] 成本确认卡含逐镜清单', shotRows === 1, 'rows=' + shotRows)
  check('[' + target.label + '] 确认前零逐镜成功', (await page.locator('.fe-vg-shot .el-tag--success').count()) === 0)
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'gate-' + target.label + '.png'), fullPage: true })

  await confirmBtn.click()
  const done = await waitFor(async () => await page.locator('[data-testid="fe-video-open-folder"]').isVisible().catch(() => false), VIDEO_TIMEOUT_MS, 2000)
  if (done) return { reached: true, verdict: 'done' }
  const failedNow = messageText(await page.locator('.fe-vg .fe-vg-error').first().textContent().catch(() => ''))
  const failedGoto = await page.locator('[data-testid="fe-video-goto-models"]').isVisible().catch(() => false)
  return { reached: true, verdict: (failedNow || failedGoto) ? 'gen-failed' : 'timeout', errorText: failedNow }
}

async function run () {
  // ===== fail-closed 前置校验（任何一条不满足：零计费退出）=====
  if (process.env.FILM_SMOKE_OPT_IN !== '1') {
    report.status = 'refused'
    report.error = '未设 FILM_SMOKE_OPT_IN=1——真实 provider 冒烟会产生计费，拒绝启动（opt-in 双保险）'
    console.log('REFUSED ' + report.error)
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    process.exitCode = 2
    return
  }
  if (!fs.existsSync(EXE)) throw new Error('打包应用不存在: ' + EXE)
  if (!fs.existsSync(SRC_PROFILE)) throw new Error('登录 profile 目录不存在: ' + SRC_PROFILE)

  let app = null
  let page = null
  let workProfile = null
  try {
    // 复制 profile 到临时目录并锁 userData 根：run 产物落 tmpDir/film-engineering/<runId>/，
    // 系统临时目录不被污染，冒烟后可整体清理。
    workProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'film-smoke-profile-'))
    fs.cpSync(SRC_PROFILE, workProfile, { recursive: true })
    app = await _electron.launch({
      executablePath: EXE,
      args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN', '--user-data-dir=' + workProfile],
      cwd: DESKTOP,
      env: { ...process.env, ELECTRON_USER_DATA_DIR: workProfile, ELECTRON_DISABLE_GPU: '1' },
      timeout: 120000,
    })
    const child = app.process()
    child.stderr?.on('data', (chunk) => { report.mainStderr += String(chunk) })
    page = await waitMainWindow(app)
    if (!page) throw new Error('主窗口未出现')
    page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => report.pageErrors.push(e.message || String(e)))
    check('打包 Electron 启动（登录 profile 副本）', true, 'userData=' + workProfile)

    await page.evaluate(() => { window.location.hash = '#/create' })
    const entry = page.locator('[data-pipeline-id="film-engineering"]').first()
    await entry.waitFor({ state: 'visible', timeout: 30000 })
    await entry.click()
    await page.locator('.film-engineering-view').waitFor({ state: 'visible', timeout: 30000 })

    // 登录态预检：authenticated/offline_authenticated 才继续（未登录 = pipeline:start-orchestrated
    // 必被许可证门拦截，白拉应用）；identityGetState 属公开通道，可在拦截前查询。
    const st = await page.evaluate(async () => {
      try { return await window.electronAPI.identityGetState() } catch { return null }
    }).catch(() => null)
    const status = (st && (st.status || (st.data && st.data.status))) || 'unknown'
    if (!check('profile 登录态可用（authenticated）', status === 'authenticated' || status === 'offline_authenticated', 'identityStatus=' + status)) {
      throw new Error('profile 未登录/不可确认登录态——6.2 需登录环境（成本闸为 authenticated 通道），中止冒烟')
    }

    // 收集全部 kit 分镜 prompt，按长度选最短/最长（每场景切换后 UI 列表重建）
    const all = await page.evaluate(async () => {
      const scenesRes = await window.electronAPI.filmEngineering.listScenes()
      if (!scenesRes || scenesRes.code !== 0) return { error: 'listScenes 失败: ' + (scenesRes && scenesRes.message) }
      /** @type {Array<{sceneId:string, sceneTitle:string, shotId:string, prompt:string}>} */
      const shots = []
      for (const sc of (scenesRes.data && (scenesRes.data.scenes || scenesRes.data)) || []) {
        const sceneId = sc.id || sc.sceneId
        const shotsRes = await window.electronAPI.filmEngineering.listShots(sceneId)
        if (!shotsRes || shotsRes.code !== 0) continue
        for (const s of (shotsRes.data && (shotsRes.data.shots || shotsRes.data)) || []) {
          const sid = s.id || s.shotId
          const g = await window.electronAPI.filmEngineering.getShot(sid)
          const prompt = (g && g.code === 0 && g.data && (g.data.prompt || (g.data.shot && g.data.shot.prompt))) || ''
          if (typeof prompt === 'string' && prompt.trim()) shots.push({ sceneId, sceneTitle: sc.title || sc.name || '', shotId: sid, prompt })
        }
      }
      return { shots }
    })
    if (all.error) throw new Error(all.error)
    const shotsInfo = all.shots.slice().sort((a, b) => a.prompt.length - b.prompt.length)
    check('kit 分镜 prompt 收集', shotsInfo.length > 0, 'count=' + shotsInfo.length)
    if (!shotsInfo.length) throw new Error('未收集到任何分镜 prompt')
    const shortest = shotsInfo[0]
    const longest = shotsInfo[shotsInfo.length - 1]
    console.log('INFO prompt 长度谱: min=' + shortest.prompt.length + ' max=' + longest.prompt.length + ' n=' + shotsInfo.length)

    const confirmBtn = page.locator('[data-testid="fe-video-confirm"]')
    const videoStart = page.locator('[data-testid="fe-video-start"]')
    const videoPanel = page.locator('.fe-vg').first()

    /** 定位目标分镜在当前列表的行号（按 prompt 头部文本匹配） */
    async function locateUiIndex (target) {
      const cards = page.locator('.fe-shot-card')
      const c = await cards.count()
      for (let i = 0; i < c; i++) {
        const txt = await cards.nth(i).innerText().catch(() => '')
        if (txt.includes(target.prompt.slice(0, 24))) return i
      }
      return -1
    }

    /** 执行一个 case 并记录产物规格 */
    async function doCase (label, target, aspect) {
      if (!CASE_SET.has(label)) return
      const sceneIndex = await (async () => {
        // 找到目标所在场景：逐个点击场景并文本定位
        const sceneNodes = page.locator('.fe-scene-node')
        await waitFor(async () => (await sceneNodes.count()) > 0, 30000, 250)
        const n = await sceneNodes.count()
        for (let i = 0; i < n; i++) {
          await sceneNodes.nth(i).click()
          if (!await waitFor(async () => (await page.locator('.fe-shot-card').count()) > 0, 15000, 200)) continue
          if ((await locateUiIndex(target)) >= 0) return i
        }
        return -1
      })()
      check('[' + label + '] 目标分镜定位', sceneIndex >= 0, 'sceneIndex=' + sceneIndex)
      if (sceneIndex < 0) return
      const uiIndex = await locateUiIndex(target)
      const before = new Set(fs.existsSync(path.join(workProfile, 'film-engineering'))
        ? fs.readdirSync(path.join(workProfile, 'film-engineering')) : [])
      const outcome = await runVideoCase(page, { ...target, label, uiIndex }, { shots: page.locator('.fe-shot-card'), confirmBtn, videoStart, videoPanel }, aspect)
      check('[' + label + '] 走完成本闸到终态', outcome.verdict === 'done', JSON.stringify(outcome))
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'final-' + label + '.png'), fullPage: true }).catch(() => {})

      if (outcome.verdict === 'done' || outcome.verdict === 'gen-failed') {
        const rootDir = path.join(workProfile, 'film-engineering')
        const newRuns = fs.existsSync(rootDir) ? fs.readdirSync(rootDir).filter((d) => !before.has(d)) : []
        for (const rid of newRuns) {
          const dir = path.join(rootDir, rid)
          for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /^shot_\d+\.mp4$/.test(x)) : []) {
            const spec = probeSpec(path.join(dir, f))
            if (spec) report.specs.push({ case: label, aspect, runId: rid, promptChars: target.prompt.length, ...spec })
          }
        }
        check('[' + label + '] 真实规格已记录（ffprobe）', report.specs.some((s) => s.case === label), JSON.stringify(report.specs.filter((s) => s.case === label)))
      }
      // 复位面板供下一 case 使用
      await page.locator('[data-testid="fe-video-new-run"]').click().catch(() => {})
      await waitFor(async () => !(await confirmBtn.isVisible().catch(() => false)) && !(await videoPanel.locator('[data-testid="fe-video-open-folder"]').isVisible().catch(() => false)), 15000, 300)
    }

    await doCase('short', shortest, '16x9')
    await doCase('long', longest, '16x9')
    await doCase('source', shortest, 'source')

    report.status = report.checks.every((c) => c.ok) ? 'passed' : 'failed'
  } catch (error) {
    report.status = 'failed'
    report.failure = error instanceof Error ? (error.stack || error.message) : String(error)
    console.error('SMOKE_FAILURE ' + report.failure)
    if (page) await page.screenshot({ path: path.join(OUTPUT_DIR, '99-smoke-failure.png'), fullPage: true }).catch(() => {})
  } finally {
    if (app) await app.close().catch((e) => { report.closeError = String(e) })
    if (workProfile) fs.rmSync(workProfile, { recursive: true, force: true })
    report.finishedAt = new Date().toISOString()
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    fs.writeFileSync(path.join(OUTPUT_DIR, 'film-video-provider-smoke.json'), JSON.stringify(report, null, 2))
    console.log('EVIDENCE_DIR=' + OUTPUT_DIR)
    console.log('SMOKE_STATUS=' + report.status)
  }
  if (report.status !== 'passed') process.exitCode = 1
}

if (require.main === module) {
  run().catch((error) => {
    report.status = 'failed'
    report.failure = error instanceof Error ? (error.stack || error.message) : String(error)
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    fs.writeFileSync(path.join(OUTPUT_DIR, 'film-video-provider-smoke.json'), JSON.stringify(report, null, 2))
    console.error('SMOKE_FATAL ' + report.failure)
    process.exitCode = 1
  })
}

module.exports = { probeSpec, CASE_SET }

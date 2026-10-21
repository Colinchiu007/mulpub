#!/usr/bin/env node
'use strict'

/**
 * dy-publish-e2e.cjs —— 抖音视频发布真机 E2E（含分轨诊断提取）
 *
 * ── 用途 ────────────────────────────────────────────────────
 * 一键复跑抖音视频发布，并把**分轨诊断**（track / apiTrackAttempted /
 * apiTrackFailed，见 PRD §16.19.4）从发布历史里提取出来。
 *
 * 有了埋点后，一次失败即可定位：
 *   - track=dom 且无 apiTrackAttempted ⇒ 根本没走 API 轨（配置/适配器问题）
 *   - track=api-then-dom 且 apiTrackFailed 有值 ⇒ API 轨失败（看其 error/code）
 *   - track=api-then-dom 且无 apiTrackFailed ⇒ API 轨成功，DOM 轨超时（RPA 问题）
 *
 * ── 前置 ────────────────────────────────────────────────────
 * 1. 应用已启动且 CDP 端口开放（默认 9279，可用 DY_CDP_PORT 覆盖）；
 * 2. 抖音账号已登录（`has_cookies: true` 且 user/info 返回真实创作者数据）；
 * 3. 测试视频存在（默认 D:\Temp\dy-small.mp4，0.24MB —— 小文件排除上传慢干扰）。
 *
 * ── 用法 ────────────────────────────────────────────────────
 *   node scripts/dy-publish-e2e.cjs [--video <path>] [--title <title>]
 *
 * 输出：任务入队 → 轮询至终态 → 打印终态 + 分轨诊断。
 *
 * ⚠ 会在抖音账号产生一条**草稿**（draft 语义），属目标授权的真机测试。
 */

const fs = require('node:fs')
const http = require('node:http')

const CDP_PORT = process.env.DY_CDP_PORT || '9279'
const VIDEO = argOf('--video') || 'D:\\Temp\\dy-small.mp4'
const TITLE = argOf('--title') || '被误解的明朝：西方史料里的另一个大明'

function argOf (flag) {
  const i = process.argv.indexOf(flag)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

const CONTENT = [
  '你还记得大明是"东亚病夫"吗？别被洗脑了，翻开西方史料，根本不是同一回事。',
  '葡萄牙水手艾维拉第一次见到明朝水师时记录：那些战船大得像移动城堡，炮口能塞进一头牛。',
  '法国国王披一件明朝丝绸，烧掉三万金币；伦敦贵族为买套青花瓷，得用白银称斤。',
  '朝鲜把"全盘明化"写进宪法，崇祯年号用了两百多年。',
  '那个被遮掩的强大帝国，才是撑起华夏文明主骨的脊梁。',
].join('\n')

function getJson (url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main () {
  if (!fs.existsSync(VIDEO)) { console.error('视频不存在: ' + VIDEO); process.exit(1) }
  console.log('视频: ' + VIDEO + ' (' + (fs.statSync(VIDEO).size / 1024).toFixed(0) + ' KB)')

  const { chromium } = require('playwright')
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
  const ctx = browser.contexts()[0]
  const pg = ctx.pages().find((x) => /5231/.test(x.url() || ''))
  if (!pg) { console.error('未找到应用页（5231）'); await browser.close(); process.exit(1) }

  for (let i = 0; i < 15; i++) {
    const ok = await pg.evaluate(() => !!(window.electronAPI && window.electronAPI.publishBatch)).catch(() => false)
    if (ok) break
    await sleep(1000)
  }

  const article = {
    title: TITLE,
    content: CONTENT,
    video_path: VIDEO,
    accountId: '01ab122e',
  }
  const out = await pg.evaluate(async (art) => {
    try {
      const r = await window.electronAPI.publishBatch([{ platform: 'douyin', accountId: '01ab122e' }], art)
      return JSON.stringify(r)
    } catch (e) { return 'ERR ' + e.message }
  }, article)
  console.log('入队: ' + out)
  const m = out.match(/task_[0-9_]+/)
  if (!m) { await browser.close(); process.exit(1) }
  const TARGET = m[0]
  console.log('任务: ' + TARGET)

  // 轮询至终态
  let terminal = null
  for (let round = 0; round < 60 && !terminal; round++) {
    await sleep(30000)
    const st = await pg.evaluate(async () => {
      try {
        const h = await window.electronAPI.getQueueHistory()
        const s = await window.electronAPI.getQueueStatus()
        return JSON.stringify({ h: h.data || [], s: s.data || {} })
      } catch (e) { return 'ERR ' + e.message }
    })
    let d
    try { d = JSON.parse(st) } catch (_e) { continue }
    const mine = (d.h || []).find((t) => t.id === TARGET)
    if (mine && ['success', 'failed', 'cancelled', 'error'].includes(String(mine.status))) terminal = mine
    else console.log('  ...轮询 ' + round + '（running=' + (d.s ? d.s.running : '?') + '）')
  }

  console.log('=== 终态 ===')
  if (!terminal) console.log('未取到终态（超时或进程中断）')
  else {
    console.log(JSON.stringify(terminal, null, 1))
    // 分轨诊断（PRD §16.19.4）
    const r = terminal.result || {}
    console.log('=== 分轨诊断 ===')
    console.log('  track           = ' + (r.track || '(未记录，旧代码)'))
    console.log('  apiTrackAttempted = ' + (r.apiTrackAttempted === true ? 'true' : (r.apiTrackAttempted === false ? 'false' : '(未记录)')))
    console.log('  apiTrackFailed  = ' + (r.apiTrackFailed ? JSON.stringify(r.apiTrackFailed) : '(未记录)'))
  }
  await browser.close()
}

main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })

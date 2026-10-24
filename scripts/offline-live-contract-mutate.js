#!/usr/bin/env node
/**
 * offline-live-contract-mutate.js — 离线横幅实时检测（UX 审计 1.7）的变异反证驱动
 *
 * 三条硬约束（同族驱动 not-found-contract-mutate.js 一字不动地沿用）：
 *  1. 变异取「被禁形态本身」（M5 = catch 里什么都不做，即「静默配置失败必须留日志」禁止的那格）；
 *  2. 未变异基线必须 0 红，否则「红」不能归因给变异；
 *  3. 每条变异后按 md5 还原，进程退出兜底再还原一次。
 *
 * 用法：node scripts/offline-live-contract-mutate.js [--only=M1,M5] [--list]
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const DESKTOP = path.join(ROOT, 'apps', 'desktop')
const F = { composable: 'apps/desktop/src/composables/useOfflineStatus.js', view: 'apps/desktop/src/components/OfflineIndicator.vue' }
const LIVE = 'src/composables/useOfflineStatus.live.test.js'
const VIEW = 'src/components/OfflineIndicator.test.js'

const MUTATIONS = [
  { id: 'M1', name: '摘掉 window offline 监听（回到「中途断网横幅永不出现」的原状）', file: F.composable, from: "    window.addEventListener('offline', onBrowserOffline)\n", to: '', verify: LIVE },
  { id: 'M2', name: '只挂 offline、不挂 online（恢复那条边静默）', file: F.composable, from: "    window.addEventListener('online', onBrowserOnline)\n", to: '', verify: LIVE },
  { id: 'M3', name: '浏览器事件后不向主进程复核（队列深度与连通性分家）', file: F.composable, from: '    isOffline.value = offline\n    reconcile()', to: '    isOffline.value = offline\n    void reconcile', verify: LIVE },
  { id: 'M4', name: '复核结果只写计数、不回写连通性（两边各写各的）', file: F.composable, from: '          isOffline.value = !!res.data.offline\n          cachedTaskCount.value = res.data.cachedCount || 0\n          return', to: '          cachedTaskCount.value = res.data.cachedCount || 0\n          return', verify: LIVE },
  { id: 'M5', name: '复核失败退回静默 catch（被禁形态本身）', file: F.composable, from: "        console.warn('[offline] reconcile failed:', (e && e.message) || String(e))", to: '        void e', verify: LIVE },
  { id: 'M6', name: 'dispose 不再解绑 window 监听（跨 SPA 实例串写状态）', file: F.composable, from: "    window.removeEventListener('offline', onBrowserOffline)\n    window.removeEventListener('online', onBrowserOnline)\n", to: '', verify: LIVE },
  { id: 'M7', name: '去掉 dispose 的 attached 守卫（重复解绑 + 重复注销）', file: F.composable, from: '    if (!attached) return\n    attached = false\n    window.removeEventListener', to: '    attached = false\n    window.removeEventListener', verify: LIVE },
  { id: 'M8', name: '文案退回硬编码中文（英文用户看到中文）', file: F.view, from: "{{ t('common.offlineBanner') }}", to: '网络已断开 — 发布任务将被缓存', verify: VIEW },
  { id: 'M9', name: '横幅退回不可播报的纯 div（去掉 role=status）', file: F.view, from: ' role="status" aria-live="polite"', to: '', verify: VIEW },
  { id: 'M10', name: '颜色退回 hex 字面量（暗色档变亮色补丁）', file: F.view, from: '  background: var(--color-warning-soft);', to: '  background: #fef3c7;', verify: VIEW },
  { id: 'M11', name: '去掉 prefers-reduced-motion 守卫', file: F.view, from: '@media (prefers-reduced-motion: reduce) {', to: '@media (min-width: 999999px) {', verify: VIEW },
  { id: 'M12', name: '装饰图标不再 aria-hidden', file: F.view, from: '<span class="offline-banner__icon" aria-hidden="true">', to: '<span class="offline-banner__icon">', verify: VIEW },
  { id: 'M13', name: '计数段改为恒渲染（0 也说「0 个待发布」）', file: F.view, from: '<span v-if="cachedTaskCount > 0"', to: '<span', verify: VIEW },
  { id: 'M14', name: '摘掉复核的迟到响应守卫（旧结论可把已确认的离线改回在线）', file: F.composable, from: '\n        if (epoch !== readEpoch) return\n', to: '\n', verify: LIVE },
  { id: 'M15', name: '摘掉 init 读回的迟到响应守卫（两条写入路径不得各有各的守卫）', file: F.composable, from: '\n          if (epoch !== readEpoch) return\n', to: '\n', verify: LIVE },
  { id: 'M16', name: '播报锚点退回被 v-if 的横幅节点（恢复那半边对读屏不存在）', file: F.view, from: '<div class="offline-live" role="status" aria-live="polite" data-testid="offline-live">', to: '<div class="offline-live" data-testid="offline-live">', verify: VIEW },
  { id: 'M17', name: '卸载不清恢复回执的定时器（计时器泄漏 + 回调打到已卸载组件）', file: F.view, from: '  clearRecoveryTimer()\n  disposeOfflineStatus()', to: '  disposeOfflineStatus()', verify: VIEW },
  { id: 'M18', name: '跃迁判据写反（首次挂载就在线也算「刚恢复」，或恢复永不回执）', file: F.view, from: '  if (wasOffline !== true) return', to: '  if (wasOffline === true) return', verify: VIEW },
  { id: 'M14b', name: '占位：正控说明（未变异基线必须 0 红）', file: null },
]

const readSafe = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const writeSafe = (rel, text) => fs.writeFileSync(path.join(ROOT, rel), text, 'utf8')
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex')

function locateAnchor (original, from) {
  const variants = []
  if (original.includes(from)) variants.push(from)
  const crlf = from.replace(/\r?\n/g, '\r\n')
  if (original.includes(crlf)) variants.push(crlf)
  for (const v of variants) {
    const c = original.split(v).length - 1
    if (c > 0) return { count: c, matched: v }
  }
  return { count: 0, matched: null }
}

function alignEol (text, original) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  return text.replace(/\r?\n/g, eol)
}

function stripAnsi (s) {
  return s.replace(/\u001b\[[0-9;]*m/g, '')
}

function parseRed (outRaw) {
  const out = stripAnsi(outRaw || '')
  const line = out.split('\n').find((l) => /^\s*Tests\s+\S/.test(l))
  if (!line) return -1
  // 「Tests  no tests」= 整个文件没编译/没收集。它与「0 失败」长得一样，
  // 但把编译失败读成"变异没造出红"是让反证假阴性的第三条路（本仓实测踩过）。
  if (/no tests/.test(line)) return -1
  const failed = /(\d+) failed/.exec(line)
  return failed ? Number(failed[1]) : 0
}

function runSuite (target) {
  const r = spawnSync(process.execPath, [VITEST, 'run', target], { cwd: DESKTOP, encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  return { red: parseRed(out), rc: r.status, out }
}

const pending = []
function restoreAll () {
  while (pending.length > 0) {
    const { rel, original } = pending.pop()
    writeSafe(rel, original)
  }
}
process.on('exit', restoreAll)

function parseArgs (argv) {
  const opts = { only: null, list: false }
  for (const a of argv) {
    if (a.startsWith('--only=')) opts.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--list') opts.list = true
    else throw new Error(`unknown option: ${a}`)
  }
  return opts
}

function main () {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.list) {
    for (const m of MUTATIONS) console.log(`${m.id}\t${m.name}`)
    return 0
  }
  const targets = MUTATIONS.filter((m) => m.file && (!opts.only || opts.only.includes(m.id)))

  for (const suite of [LIVE, VIEW]) {
    const base = runSuite(suite)
    console.log(`[BASE] ${suite} rc=${base.rc} red=${base.red}`)
    if (base.red !== 0) {
      console.error('基线不干净：未变异就有红（或读不到汇总行），本次反证不作数')
      console.error(base.out.split('\n').slice(-25).join('\n'))
      return 2
    }
  }

  let missed = 0
  const redSets = []
  for (const m of targets) {
    const original = readSafe(m.file)
    const anchor = locateAnchor(original, m.from)
    if (anchor.count !== 1) {
      console.log(`${m.id} BROKEN anchor（命中 ${anchor.count} 次，期望 1）：${m.file}`)
      missed += 1
      continue
    }
    pending.push({ rel: m.file, original })
    writeSafe(m.file, original.replace(anchor.matched, alignEol(m.to, original)))
    if (md5(readSafe(m.file)) === md5(original)) {
      console.log(`${m.id} BROKEN no-op（写回后字节未变）`)
      missed += 1
      restoreAll()
      continue
    }
    const res = runSuite(m.verify)
    restoreAll()
    const restored = md5(readSafe(m.file)) === md5(original)
    if (res.red === -1) {
      console.log(`${m.id} PROBE_BLIND rc=${res.rc} suite=${m.verify} restored=${restored} —— ${m.name}`)
      console.error(res.out.split('\n').slice(-20).join('\n'))
      missed += 1
    } else if (res.red > 0) {
      console.log(`${m.id} CAUGHT red=${res.red} rc=${res.rc} suite=${m.verify} restored=${restored} —— ${m.name}`)
      redSets.push(`${m.id}:${res.red}`)
    } else {
      console.log(`${m.id} MISSED red=0 rc=${res.rc} suite=${m.verify} —— ${m.name}`)
      missed += 1
    }
  }

  for (const rel of new Set(MUTATIONS.filter((m) => m.file).map((m) => m.file))) {
    console.log(`[RESTORE-CHECK] ${rel} bytes=${Buffer.byteLength(readSafe(rel), 'utf8')}`)
  }
  console.log(`\n红集：${redSets.join('  ')}`)
  if (missed > 0) {
    console.error(`变异反证未闭合：MISSED/BROKEN/PROBE_BLIND ${missed} 条`)
    return 1
  }
  console.log(`ALL_CAUGHT（${targets.length} 条）`)
  return 0
}

if (require.main === module) process.exit(main())

module.exports = { MUTATIONS }

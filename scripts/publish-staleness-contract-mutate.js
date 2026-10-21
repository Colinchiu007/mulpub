#!/usr/bin/env node
/**
 * publish-staleness-contract-mutate.js —— 阶段 1.8「无更新看门狗」的变异反证驱动
 *
 * 用法（仓库根或任意 cwd 都可，路径按 __dirname 解析）：
 *   node scripts/publish-staleness-contract-mutate.js          # 跑全部变异
 *   node scripts/publish-staleness-contract-mutate.js M3 M8    # 只跑指定几条
 *
 * 每条变异都必须让锁变红，且红集必须与「这条变异破坏了哪个可观测行为」自洽。
 * 驱动自己的四条护栏（缺一即不可信，全部来自本仓实测踩过的坑）：
 *  1. 注入前断言「字节确实变了」—— 锚点未命中的 no-op 会被读成「锁是装饰性的」；
 *  2. 还原后与备份逐字节比对，失败即以 rc=4 退出（绝不把源码留在变异态）；
 *  3. 读测试结果先剥 ANSI，并同时取汇总行的 `N failed` 计数（rc≠0 只说明有东西坏了）；
 *  4. 「Tests no tests」判 -1（PROBE_BLIND）—— 编译期失败会让 rc=1 而红集为空，
 *     那与「锁没抓住」在屏幕上完全同形。
 *
 * 锚点一律取「一行内的唯一原文」，不用跨行正则；CRLF 文件（本仓 .vue 工作副本是 w/crlf）
 * 由 locateAnchor 兼容两种行尾，否则注入静默不发生。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '..')
const DESKTOP = path.join(REPO, 'apps', 'desktop')
const F_UTILS = path.join(DESKTOP, 'src/utils/publish-progress-staleness.js')
const F_COMPOSABLE = path.join(DESKTOP, 'src/composables/usePublishProgressStaleness.js')
const F_PANEL = path.join(DESKTOP, 'src/components/PublishProgressPanel.vue')

const SUITES = [
  'src/utils/publish-progress-staleness.test.js',
  'src/components/PublishProgressPanel.test.js',
]

/** 注入一条变异：把 file 里的 from 换成 to（要求 from 在该文件里唯一命中） */
function mutate(file, from, to) {
  const original = fs.readFileSync(file, 'utf8')
  const idx = locateAnchor(original, from)
  if (idx < 0) throw new Error(`ANCHOR_NOT_FOUND in ${path.basename(file)}: ${JSON.stringify(from)}`)
  const next = original.slice(0, idx) + to + original.slice(idx + from.length)
  if (next === original) throw new Error(`NO_OP_INJECTION: ${JSON.stringify(from)}`)
  return { file, original, next }
}

/** 兼容 LF/CRLF 的锚点定位：把锚点里的换行替换成文件实际使用的行尾再找 */
function locateAnchor(text, anchor) {
  const crlf = text.includes('\r\n')
  const candidates = [anchor, crlf ? anchor.replace(/\n/g, '\r\n') : anchor.replace(/\r\n/g, '\n')]
  for (const cand of candidates) {
    const i = text.indexOf(cand)
    if (i >= 0) return i
  }
  return -1
}

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex')

function runSuites() {
  const res = spawnSync('pnpm', ['exec', 'vitest', 'run', ...SUITES], {
    cwd: DESKTOP,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: true,
  })
  const raw = (res.stdout || '') + (res.stderr || '')
  const plain = raw.replace(/\x1b\[[0-9;]*m/g, '')
  if (/Tests\s+no tests/.test(plain)) return { rc: res.status, failed: -1, passed: 0, red: [], blind: true }
  const failedMatch = plain.match(/Tests\s+(?:\S+\s+)?(\d+)\s+failed/)
  const passedMatch = plain.match(/Tests\s+(?:\S+\s+)?(\d+)\s+passed/)
  // 全绿时 vitest 只打 `Tests N passed`，根本不打 `N failed` —— 缺席不是「0 条失败」的证据，
  // 必须两个汇总形态都认，取不到就判探针失明（本仓同族坑：解析器的缺席形态要逐条枚举）。
  const failed = failedMatch ? Number(failedMatch[1]) : (passedMatch ? 0 : -1)
  const passed = passedMatch ? Number(passedMatch[1]) : 0
  const red = []
  const re = /^\s*[×✗]\s+(.+)$/gm
  let m
  while ((m = re.exec(plain)) !== null) red.push(m[1].trim())
  return { rc: res.status, failed, passed, red, blind: failed < 0 }
}

const MUTATIONS = [
  {
    id: 'M1', label: '阈值从 3 分钟改成「永不到来」（面板退化回永不解禁）',
    file: F_UTILS, from: 'export const DEFAULT_STALE_AFTER_MS = 180_000',
    to: 'export const DEFAULT_STALE_AFTER_MS = 86_400_000',
  },
  {
    id: 'M2', label: '射程去掉「只看运行中会话」的过滤（done 会话也被催更）',
    file: F_UTILS, from: "if (!session || session.status !== 'running') continue",
    to: 'if (!session) continue',
  },
  {
    id: 'M3', label: '终态集合去掉 cancelled（已取消的任务被当成还在等更新）',
    file: F_UTILS, from: "new Set(['success', 'failed', 'cancelled'])",
    to: "new Set(['success', 'failed'])",
  },
  {
    // v2：v1 把 `: now` 拼在三元首行末尾，破坏了后续行的三元链 ⇒ 文件根本编译不过，
    // 报成 PROBE_BLIND 而不是 CAUGHT。改成替换整条兜底支路，注入的是同一种危害的合法 JS。
    id: 'M4', label: '锚点缺席时当作「刚有事件」（死字段继续没人读）',
    file: F_UTILS, from: ': (isFiniteNumber(session.createdAt) ? session.createdAt : null)',
    to: ': now',
  },
  {
    id: 'M5', label: '跨任务/跨会话改取最旧锚点（任一任务刚有事件也报无更新）',
    file: F_UTILS, from: 'if (lastEventAt === null || anchor > lastEventAt) lastEventAt = anchor',
    to: 'if (lastEventAt === null || anchor < lastEventAt) lastEventAt = anchor',
  },
  {
    id: 'M6', label: '阈值边界由「达到即陈旧」放宽成「超过才陈旧」（差 1ms 的口径漂移）',
    file: F_UTILS, from: 'if (elapsed < threshold) return',
    to: 'if (elapsed <= threshold) return',
  },
  {
    id: 'M7', label: '分钟数去掉「至少 1」钳位（显示「已 0 分钟无更新」）',
    file: F_UTILS, from: 'minutes: Math.max(1, Math.floor(elapsed / 60_000))',
    to: 'minutes: Math.floor(elapsed / 60_000)',
  },
  {
    id: 'M8', label: '非法阈值不回落默认（坏配置把面板钉成恒陈旧）',
    file: F_UTILS, from: '  const threshold = isFiniteNumber(staleAfterMs) && staleAfterMs > 0',
    to: '  const threshold = isFiniteNumber(staleAfterMs) || staleAfterMs > 0',
  },
  {
    id: 'M9', label: '看门狗不看 hasRunning（空闲应用也挂常驻定时器）',
    file: F_COMPOSABLE, from: '  }, { immediate: true })',
    to: '  })',
  },
  {
    id: 'M10', label: '卸载不清表（组件销毁后定时器泄漏）',
    file: F_COMPOSABLE, from: '  onBeforeUnmount(stopTick)',
    to: '  // onBeforeUnmount(stopTick)',
  },
  {
    id: 'M11', label: '面板关闭可用性忽略陈旧（× 仍是永久禁用）',
    file: F_PANEL, from: 'const closeBlocked = computed(() => store.hasRunning && !staleness.value.stale)',
    to: 'const closeBlocked = computed(() => store.hasRunning)',
  },
  {
    id: 'M12', label: '陈旧态点 × 不再收起（把解禁做成一个死按钮）',
    file: F_PANEL, from: '  if (staleness.value.stale) store.minimizePanel()',
    to: '  if (false) store.minimizePanel()',
  },
  {
    id: 'M13', label: '陈旧徽标去掉 role=status（屏读用户收不到状态跃迁）',
    file: F_PANEL, from: '            role="status"',
    to: '            role="presentation"',
  },
  {
    id: 'M14', label: '胶囊提示顺序回退（陈旧被「请勿关闭应用」顶掉）',
    file: F_PANEL, from: 'v-if="staleness.stale" class="ppp__pill-hint"',
    to: 'v-if="store.hasRunning" class="ppp__pill-hint"',
  },
]

function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const targets = only.length ? MUTATIONS.filter((x) => only.includes(x.id)) : MUTATIONS
  if (only.length && targets.length !== only.length) {
    console.error(`MUTATION_ID_UNKNOWN requested=${only.join(',')} known=${MUTATIONS.map((x) => x.id).join(',')}`)
    process.exit(2)
  }

  const baseline = runSuites()
  if (baseline.rc !== 0 || baseline.failed !== 0 || baseline.passed === 0) {
    console.error(`[BASELINE] 基线未成立 rc=${baseline.rc} failed=${baseline.failed} passed=${baseline.passed}（passed=0 或取不到汇总＝探针失明，不得当作全绿）`)
    console.error(baseline.red.slice(0, 10).join('\n'))
    process.exit(3)
  }
  console.log(`[BASELINE] ${SUITES.join(' + ')} 全绿 passed=${baseline.passed}`)

  const results = []
  for (const mut of targets) {
    let handle
    try {
      handle = mutate(mut.file, mut.from, mut.to)
    } catch (e) {
      results.push({ id: mut.id, verdict: 'PROBE_BLIND', note: e.message })
      console.log(`${mut.id} PROBE_BLIND  ${e.message}`)
      continue
    }
    fs.writeFileSync(handle.file, handle.next, 'utf8')
    const out = runSuites()
    // 立刻还原并逐字节核对，任何情况下不把源码留在变异态
    fs.writeFileSync(handle.file, handle.original, 'utf8')
    const restored = md5(fs.readFileSync(handle.file, 'utf8')) === md5(handle.original)
    if (!restored) {
      console.error(`${mut.id} RESTORE_FAILED —— 源码可能仍是变异态，已中止`)
      process.exit(4)
    }
    if (out.blind) {
      results.push({ id: mut.id, verdict: 'PROBE_BLIND', note: '跑不出用例（编译/收集失败）' })
      console.log(`${mut.id} PROBE_BLIND  未变异前该文件能跑，变异后收集失败`)
    } else if (out.failed > 0) {
      results.push({ id: mut.id, verdict: 'CAUGHT', failed: out.failed, red: out.red.slice(0, 3) })
      console.log(`${mut.id} CAUGHT       failed=${out.failed} :: ${out.red.slice(0, 2).join(' | ')}`)
    } else {
      results.push({ id: mut.id, verdict: 'MISSED', note: `rc=${out.rc} failed=${out.failed}` })
      console.log(`${mut.id} MISSED       rc=${out.rc} failed=${out.failed} —— 这条锁没抓住`)
    }
  }

  const missed = results.filter((r) => r.verdict !== 'CAUGHT')
  console.log('')
  console.log(`[SUMMARY] 共 ${results.length} 条：CAUGHT=${results.length - missed.length} 其余=${missed.length}`)
  if (missed.length) console.log(missed.map((r) => `  ${r.id} ${r.verdict} ${r.note || ''}`).join('\n'))
  process.exit(missed.length ? 1 : 0)
}

main()

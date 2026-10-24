#!/usr/bin/env node
/**
 * not-found-contract-mutate.js — 兜底路由（UX 审计 1.9）的变异反证驱动
 *
 * 要回答的问题不是「测试会不会过」，而是「把实现改坏，测试是否**必定**发现」。
 * 每条变异各自独立跑一次测试，红集互不相同；任何一条 MISSED 即整个驱动失败。
 *
 * 三条硬约束（沿袭本仓既有反证纪律）：
 *  1. 变异必须取「规则明文禁止的那个形态」本身，而不是它的近似（例如 M5 是把豁免面
 *     改成「所有 internal:false 的登记项都豁免」—— 这才是放宽的真形态，M4 那种
 *     「删标记」只能证明标记被读到）。
 *  2. 跑之前必须先跑一次**未变异**的基线，红数必须为 0，否则「红」不能归因给变异。
 *  3. 电池被打断也必须还原：进程退出兜底（process.on('exit')）按备份写回原字节，
 *     并在每条变异后校验 md5 与原文一致。
 *
 * 用法：
 *   node scripts/not-found-contract-mutate.js          # 全部
 *   node scripts/not-found-contract-mutate.js --only=M3,M5
 *   node scripts/not-found-contract-mutate.js --list
 *
 * 跨平台：一律用 process.execPath + node_modules/vitest/vitest.mjs，不走 pnpm.cmd / shell:true。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const DESKTOP = path.join(ROOT, 'apps', 'desktop')

const F = {
  gate: '.github/scripts/check-route-registry.js',
  router: 'apps/desktop/src/router/index.js',
  registry: 'apps/desktop/src/config/route-registry.js',
  view: 'apps/desktop/src/views/NotFound.vue',
  title: 'apps/desktop/src/composables/useTabDocumentTitle.js',
}

const GATE_TEST = '.github/scripts/check-route-registry.test.js'
const V_GATE = { kind: 'gate', target: GATE_TEST }
const V_NOTFOUND = { kind: 'vitest', target: 'src/views/NotFound.test.js' }
const V_TITLE = { kind: 'vitest', target: 'src/composables/useTabDocumentTitle.test.js' }

/**
 * 变异清单。expect 只声明「这条变异必须让哪个套件变红」——不钉死红数，
 * 因为同一条实现改动会连带打掉多条相关用例（那正是覆盖充分的证据）；
 * 但红数必须 ≥1，且驱动会打印红数供人核对与相邻变异是否同形。
 */
const MUTATIONS = [
  {
    id: 'M1',
    name: '摘掉 catch-all 路由声明（回到「未知地址渲染空内容」的原状）',
    file: F.router,
    from: "  { path: '/:pathMatch(.*)*', name: 'NotFound', component: () => import('@/views/NotFound.vue') },\n",
    to: '',
    verify: V_NOTFOUND,
  },
  {
    id: 'M2',
    name: '「返回上一页」不再看后退能力（无条件渲染）',
    file: F.view,
    from: '        v-if="canGoBack"\n',
    to: '',
    verify: V_NOTFOUND,
  },
  {
    id: 'M3',
    name: '后退判据退回 window.history.length（本仓明令禁止的第二份口径）',
    file: F.view,
    from: 'const { canGoBack, attach, dispose } = useSpaNavHistory(router)',
    to: 'const canGoBack = computed(() => window.history.length > 1)\nconst attach = () => {}\nconst dispose = () => {}\nvoid useSpaNavHistory',
    verify: V_NOTFOUND,
  },
  {
    id: 'M4',
    name: '登记表删掉 catchAll 标记（兜底路由变回「未申报的暗路由」）',
    file: F.registry,
    from: '    catchAll: true,\n',
    to: '',
    verify: V_GATE,
  },
  {
    id: 'M5',
    name: '把门禁豁免面放宽成「所有 internal:false 的登记项都免答入口」（被禁形态本身）',
    file: F.gate,
    from: '    if (entry.catchAll) {',
    to: '    if (!entry.internal) {',
    verify: V_GATE,
  },
  {
    id: 'M6',
    name: '摘掉 catchAll 的路径形状全等判据（可把普通路由标成兜底）',
    file: F.gate,
    from: "      if (entry.path !== CATCH_ALL_PATH) {\n        errors.push(`catchAll 登记项的 path 必须是兜底形状 '${CATCH_ALL_PATH}'，当前 '${entry.path}'`)\n      }\n",
    to: '',
    verify: V_GATE,
  },
  {
    id: 'M7',
    name: '摘掉 router 侧「多条兜底路由」判据（后者永不生效却无人出声）',
    file: F.gate,
    from: '  const catchAllRoutes = routes.filter((r) => r.path === CATCH_ALL_PATH)',
    to: '  const catchAllRoutes = []',
    verify: V_GATE,
  },
  {
    id: 'M8',
    name: '摘掉标题解析的 route.name 分支（404 页标签继续顶着品牌名）',
    file: F.title,
    from: "  if (routeName === CATCH_ALL_ROUTE_NAME) return t('common.notFoundTitle')\n",
    to: '',
    verify: V_TITLE,
  },
  {
    id: 'M9',
    name: '标题改成「映射表没命中就说 404」（用反推代替显式事实）',
    file: F.title,
    from: "  if (routeName === CATCH_ALL_ROUTE_NAME) return t('common.notFoundTitle')",
    to: "  if (routeName === CATCH_ALL_ROUTE_NAME) return t('common.notFoundTitle')\n  const _probe = ROUTE_TAB_TITLES.get(path.split('#')[0].split('?')[0])\n  if (_probe === undefined) return t('common.notFoundTitle')",
    verify: V_TITLE,
  },
  {
    id: 'M11',
    name: '摘掉 catchAll 的 entryFrom 侧门锁（QM-6 i2 的修复本身）',
    file: F.gate,
    from: "      if (entry.entryFrom) errors.push(`catchAll 不得声明宿主入口：${entry.path}（它从任何地址进来，entryFrom 必须为 null，当前 '${entry.entryFrom}'）`)\n",
    to: '',
    verify: V_GATE,
  },
  {
    id: 'M12',
    name: '摘掉 catchAll 的 name 成对锁（QM-6 i7 的修复本身）',
    file: F.gate,
    from: "  if (catchAllEntries.length === 1 && catchAllRoutes.length === 1 && catchAllEntries[0].name !== catchAllRoutes[0].name) {\n    errors.push(`catchAll 的 name 必须与 router 声明逐字一致：登记表 '${catchAllEntries[0].name}' ≠ router '${catchAllRoutes[0].name}'`)\n  }\n",
    to: '',
    verify: V_GATE,
  },
  {
    id: 'M10',
    name: '正控：不做任何改动，基线必须 0 红（由驱动主流程执行，此条仅占位说明）',
    file: null,
  },
]

/**
 * 行尾自适应锚点：本仓工作副本是 checkout 态（`git ls-files --eol` 逐文件不同，
 * 有 w/crlf 也有 w/lf），把锚点里的 `\n` 写死成 LF 会让变异**静默不落地**
 * （命中 0 次 ≠ 判据没被改坏，是探针没打到）。
 * 返回 { count, matched } —— matched 是文件里真实出现的那个形态（含它自己的行尾），
 * 替换时用同一形态回写，从而只改内容、不改行尾。
 */
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

/** 变异体内的换行按目标文件实际行尾改写（否则插入的是混合行尾） */
function alignEol (text, original) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  return text.replace(/\r?\n/g, eol)
}

function readSafe (rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function writeSafe (rel, text) {
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8')
}

function md5 (s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex')
}

function stripAnsi (s) {
  // vitest / node --test 都会上色；ANSI 序列插在数字前后会打断 `(\d+) failed` 匹配，
  // 于是驱动会把「真红」读成「读不到」再报 MISSED（本仓既有反证坑）。
  // 写成 \u001b 而不是原始 ESC 字节：源码文件里出现裸控制字符会被后续编辑吞掉。
  return s.replace(/\u001b\[[0-9;]*m/g, '')
}

function parseRed (outRaw) {
  const out = stripAnsi(outRaw || '')
  // node --test TAP：总是打印 "# fail N"
  const tap = /^# fail (\d+)$/m.exec(out)
  if (tap) return Number(tap[1])
  // vitest：汇总行 "  Tests  2 failed | 11 passed (13)"，全绿时是 "  Tests  13 passed (13)"
  const line = out.split('\n').find((l) => /^\s*Tests\s+\S/.test(l))
  if (!line) return -1
  // 「Tests  no tests」= 文件没编译/没收集；读成 0 红会让变异假装"没牙"（同源坑见离线驱动）
  if (/no tests/.test(line)) return -1
  const failed = /(\d+) failed/.exec(line)
  return failed ? Number(failed[1]) : 0
}

function runVerify (spec) {
  if (spec.kind === 'gate') {
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', spec.target], { cwd: ROOT, encoding: 'utf8' })
    return { red: parseRed((r.stdout || '') + (r.stderr || '')).valueOf(), rc: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }
  const r = spawnSync(process.execPath, [VITEST, 'run', spec.target], { cwd: DESKTOP, encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  return { red: parseRed(out), rc: r.status, out }
}

function parseArgs (argv) {
  const opts = { only: null, list: false }
  for (const a of argv) {
    if (a.startsWith('--only=')) opts.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--list') opts.list = true
    else throw new Error(`unknown option: ${a}`)
  }
  return opts
}

const pending = []

function restoreAll () {
  while (pending.length > 0) {
    const { rel, original } = pending.pop()
    writeSafe(rel, original)
  }
}

process.on('exit', restoreAll)

function main () {
  const opts = parseArgs(process.argv.slice(2))
  const targets = MUTATIONS.filter((m) => m.file !== null && (!opts.only || opts.only.includes(m.id)))
  if (opts.list) {
    for (const m of MUTATIONS) console.log(`${m.id}\t${m.name}`)
    return 0
  }

  // 基线：未变异必须 0 红，否则后面的「红」不能归因给变异
  const baseSeen = new Map()
  for (const spec of [V_GATE, V_NOTFOUND, V_TITLE]) {
    const base = runVerify(spec)
    console.log(`[BASE] ${spec.target} rc=${base.rc} red=${base.red}`)
    if (base.red !== 0) {
      console.error('基线不干净：未变异就有红，本次反证不作数（先修基线再谈反证）')
      console.error(base.out.split('\n').slice(-25).join('\n'))
      return 2
    }
    baseSeen.set(spec.target, base.red)
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
    const after = readSafe(m.file)
    if (md5(after) === md5(original)) {
      console.log(`${m.id} BROKEN no-op（写回后字节未变）`)
      missed += 1
      restoreAll()
      continue
    }
    const res = runVerify(m.verify)
    restoreAll()
    const restored = md5(readSafe(m.file)) === md5(original)
    if (res.red === -1) {
      // 探针失明 ≠ 没红：读不到汇总行时单独成档，绝不当成 MISSED（那会把工具故障说成实现无罪）
      console.log(`${m.id} PROBE_BLIND rc=${res.rc} suite=${m.verify.target} restored=${restored} —— ${m.name}`)
      console.error(res.out.split('\n').slice(-20).join('\n'))
      missed += 1
    } else if (res.red > 0) {
      console.log(`${m.id} CAUGHT red=${res.red} rc=${res.rc} suite=${m.verify.target} restored=${restored} —— ${m.name}`)
      redSets.push(`${m.id}:${m.verify.target}:${res.red}`)
    } else {
      console.log(`${m.id} MISSED red=${res.red} rc=${res.rc} suite=${m.verify.target} —— ${m.name}`)
      missed += 1
    }
    // QM-6 外部评审 i5：还原不成立必须**当场停**，不能只打进日志继续跑下一条 ——
    // 后续变异会在脏基底上继续，而 md5 对账要到循环结束才做（那时已污染了两条以上）。
    if (!restored) {
      console.error(`${m.id} 还原失败：文件仍处于变异态，中止后续变异并请求人工恢复`)
      return 4
    }
  }

  // 还原完整性：被改文件必须与开工前逐字节一致（不一致 = 把变异态留在了工作树里）
  const pristine = new Map()
  for (const rel of new Set(MUTATIONS.filter((m) => m.file).map((m) => m.file))) {
    pristine.set(rel, md5(readSafe(rel)))
  }
  // （基线跑在变异之前，所以这里的读数就是开工前状态；变异循环内的 restored 标志是逐条对账）
  for (const [rel, hash] of pristine) {
    const ok = md5(readSafe(rel)) === hash
    console.log(`[RESTORE-CHECK] ${rel} md5=${hash.slice(0, 8)} identical=${ok}`)
    if (!ok) {
      console.error('还原不一致：文件仍处于变异态，立即停止并人工恢复')
      return 3
    }
  }

  console.log(`\n红集互不相同性核对：${redSets.join('  ')}`)
  if (missed > 0) {
    console.error(`变异反证未闭合：MISSED/BROKEN ${missed} 条`)
    return 1
  }
  console.log(`ALL_CAUGHT（${targets.length} 条）`)
  return 0
}

if (require.main === module) process.exit(main())

module.exports = { MUTATIONS }

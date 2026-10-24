#!/usr/bin/env node
/**
 * 首屏启动链收口原语的反证驱动（ux-audit-accounts-load-failure）
 *
 * 每道变异取的都是「规则明文禁止的那个形态」本身（退回裸调用 / 退回空处理器 /
 * 默认 sink 退回 noop / 摘掉 handler），不是"把判据改成 no-op"。
 * 期望红集写的是测试真名片段；红多条不算失败，**红了但没红到期望那条**才算 MISSED。
 *
 * 跑法：node scripts/accounts-startup-chain-contract-mutate.js
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const DESKTOP = path.join(ROOT, 'apps', 'desktop')
const ACCOUNTS_VUE = path.join(DESKTOP, 'src', 'views', 'Accounts.vue')
const HELPER = path.join(DESKTOP, 'src', 'utils', 'startup-promise.js')
const TEST_FILES = ['src/views/Accounts.test.js', 'src/utils/startup-promise.test.js']
const RUNNER = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')
const backups = new Map()
const originals = new Map()
for (const p of [ACCOUNTS_VUE, HELPER]) {
  backups.set(p, fs.readFileSync(p))
  originals.set(p, md5(p))
}
let restored = false
function restoreAll () {
  if (restored) return
  restored = true
  for (const [p, buf] of backups) fs.writeFileSync(p, buf)
}
process.on('exit', restoreAll)
process.on('SIGINT', () => { restoreAll(); process.exit(130) })
process.on('SIGTERM', () => { restoreAll(); process.exit(143) })
process.on('uncaughtException', (e) => { console.error('uncaught:', e && e.message); restoreAll(); process.exit(1) })

function runSuite () {
  const r = spawnSync(RUNNER, ['exec', 'vitest', 'run', ...TEST_FILES], {
    cwd: DESKTOP, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024, shell: process.platform === 'win32',
  })
  const out = String((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '')
  // collected 必须取「Tests … passed」那一行；用裸 `(\d+) passed` 会先撞上
  // "Test Files 2 passed"，把 2 当读数报出去（实测本驱动第一版就这么报的）。
  const collected = Number((out.match(/collected\s+(\d+)/i) || [])[1]
    || (out.match(/Tests\s+(\d+) passed/i) || [])[1] || 0)
  const reds = [...out.matchAll(/^\s*FAIL\s+\S+\s+>\s+(.+?)\s*$/gm)].map((m) => m[1].trim())
  return {
    rc: r.status === null ? -1 : r.status,
    out,
    collected,
    failedCount: Number((out.match(/Tests?\s+(\d+) failed/i) || [])[1] || 0),
    errors: /Test suite failed to run|Unhandled Error/i.test(out),
    reds: [...new Set(reds)],
  }
}

const MUTS = [
  {
    id: 'A1', file: ACCOUNTS_VUE,
    desc: '启动链退回裸调用（本批要消灭的浮空形态）：列表刷新不再经原语',
    from: "terminateStartupPromise('accounts-list', () => refresh())", to: 'refresh()',
    expect: ['列表刷新拒绝'],
  },
  {
    id: 'A2', file: ACCOUNTS_VUE,
    desc: '统一类别退回"接了但零痕迹"的空处理器（静默失败明禁的形态）',
    from: "terminateStartupPromise('content-categories', () => loadContentCategories())",
    to: 'loadContentCategories().catch(() => {})',
    expect: ['结构锁：启动链不得出现空 catch'],
  },
  {
    id: 'A3', file: ACCOUNTS_VUE,
    desc: '分组入口退回裸调用：结构锁的"逐个经原语 + 标签齐全"必须因此红',
    from: "terminateStartupPromise('account-groups', () => accountStore.loadGroups())",
    to: 'accountStore.loadGroups()',
    expect: ['结构锁：启动链不得出现空 catch'],
  },
  {
    id: 'B1', file: HELPER,
    desc: '原语默认 warn 退回 noop（生产接线不传 warn ⇒ 失败零痕迹）',
    from: 'warn = (msg) => console.warn(msg)', to: 'warn = () => {}',
    expect: ['默认 warn 必须是真 console.warn'],
  },
  {
    id: 'B2', file: HELPER,
    desc: 'thunk 形态不再被调用（同步抛错那一格失去读者）',
    from: 'const maybe = typeof task === \'function\' ? task() : task', to: 'const maybe = task',
    expect: ['thunk 形态的同步抛错必须被就地接住并出声'],
  },
  {
    id: 'B3', file: HELPER,
    desc: '摘掉 handler（只求值不接住）⇒ rejection 重新逃逸到进程级',
    from: 'Promise.resolve(maybe).then(undefined, report)', to: 'Promise.resolve(maybe)',
    expect: ['任何输入形态都不得把 rejection 留给进程'],
  },
  {
    id: 'B4', file: HELPER,
    desc: '日志丢掉原因（只剩标签）⇒ "可归因"这一格退化',
    from: 'failed: ${describeReason(reason)}', to: 'failed',
    expect: ['原因不是 Error 时也要出声', '分组真源拒绝', '列表刷新拒绝', '默认 warn 必须是真 console.warn'],
  },
]

function main () {
  const base = runSuite()
  console.log(`[BASELINE] rc=${base.rc} failed=${base.failedCount} passed=${base.collected} reds=${base.reds.length} blind=${base.collected === 0 || base.errors}`)
  if (base.rc !== 0 || base.collected === 0 || base.errors) {
    console.log('[BASELINE] 基线不干净（或有套件没跑起来）—— 先修基线，否则变异红集不可归因')
    console.log(base.out.split(/\r?\n/).slice(-25).join('\n'))
    process.exit(2)
  }
  let caught = 0
  let missed = 0
  for (const m of MUTS) {
    ensure(m)
    const src = fs.readFileSync(m.file, 'utf8')
    const parts = src.split(m.from)
    if (parts.length !== 2) {
      console.log(`[${m.id}] ANCHOR_${parts.length - 1} :: ${m.desc} —— 锚点命中 ${parts.length - 1} 次，这条变异一次都没生效，不得读成"锁没反应"`)
      missed += 1
      continue
    }
    fs.writeFileSync(m.file, parts.join(m.to))
    if (md5(m.file) === originals.get(m.file)) {
      console.log(`[${m.id}] NO_CHANGE :: 替换后字节与原文件相同，变异未生效`)
      restoreOne(m.file)
      missed += 1
      continue
    }
    const r = runSuite()
    const hit = m.expect.filter((e) => !r.reds.some((t) => t.includes(e)))
    const status = r.rc !== 0 && hit.length === 0 ? 'CAUGHT' : 'MISSED'
    if (status === 'CAUGHT') caught += 1
    else missed += 1
    console.log(`[${m.id}] ${status} :: ${m.desc} — rc=${r.rc} 红=${r.reds.length} 未中期望=${hit.length ? hit.join(' / ') : '无'}${r.errors ? ' PROBLEM: 套件报错' : ''}`)
    if (status === 'MISSED') r.reds.slice(0, 4).forEach((t) => console.log(`      实际红: ${t}`))
    restoreOne(m.file)
    if (md5(m.file) !== originals.get(m.file)) {
      console.log(`[${m.id}] RESTORE_FAIL :: ${m.file} 未回到原字节，停止后续变异`)
      process.exit(2)
    }
    console.log(`[${m.id}] RESTORE_OK`)
  }
  console.log(`[SUMMARY] 共 ${MUTS.length} 条：CAUGHT=${caught} MISSED=${missed}`)
  process.exit(missed === 0 ? 0 : 1)
}
function ensure (m) { if (!backups.has(m.file)) throw new Error('未备份: ' + m.file) }
function restoreOne (p) { fs.writeFileSync(p, backups.get(p)) }
main()

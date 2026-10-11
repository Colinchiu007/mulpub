// @ts-check
/**
 * dev-ports.test.js — worktree 独立端口解析回归保护（node --test）
 * 覆盖：默认路径、派生范围、确定性、大小写不敏感、真实 worktree fleet 无碰撞、
 * 显式覆盖（含部分覆盖保持另一端口派生）、非法端口拒绝。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveDevPorts, parsePort, DEFAULT_VITE_PORT, DEFAULT_CDP_PORT } = require('./dev-ports')

const WT = 'D:/Data/projects/mp-worktrees'

test('非 worktree 路径（主仓库/CI）使用默认 5174/9222', () => {
  const r = resolveDevPorts('D:/Data/projects/mulpub', {})
  assert.equal(r.vite, DEFAULT_VITE_PORT)
  assert.equal(r.cdp, DEFAULT_CDP_PORT)
  assert.equal(r.derived, false)
})

test('mp-worktrees 下路径稳定派生端口且落在范围内', () => {
  const r1 = resolveDevPorts(WT + '/mp-desktop-dev', {})
  assert.equal(r1.derived, true)
  assert.ok(r1.vite >= 5174 && r1.vite <= 7973, 'vite ' + r1.vite + ' 超出范围')
  assert.ok(r1.cdp >= 9222 && r1.cdp <= 12021, 'cdp ' + r1.cdp + ' 超出范围')

  const r2 = resolveDevPorts(WT + '/mp-desktop-dev', {})
  assert.equal(r1.vite, r2.vite)
  assert.equal(r1.cdp, r2.cdp)
})

test('路径大小写/结尾分隔符不影响派生结果（Windows 不敏感）', () => {
  const a = resolveDevPorts(WT + '/mp-desktop-dev', {})
  const b = resolveDevPorts(WT + '/MP-DESKTOP-DEV/', {})
  assert.equal(a.vite, b.vite)
  assert.equal(a.cdp, b.cdp)
})

// 真实本地 worktree fleet 快照（2026-08-15）：span=900 时代 mp-content-type-auto-suggest 与
// mp-s2v-translation-optimize 曾同时派生 vite=5854/cdp=9902；span=2800 后必须全 fleet 无碰撞。
test('真实 worktree fleet 全量无端口碰撞（回归 span 900 碰撞对）', () => {
  const names = [
    'mp-account-card-creator-tab',
    'mp-content-type-auto-suggest',
    'mp-desktop-dev',
    'mp-engine-marketing-docs',
    'mp-engine-shared-core',
    'mp-film-engineering',
    'mp-higgsfield-p0',
    'mp-merge-domain-enrich',
    'mp-pe-round3bc-archive',
    'mp-pe-round3bc-contract',
    'mp-prompt-eval-video',
    'mp-s2v-compose-progress',
    'mp-s2v-duration-50min',
    'mp-s2v-history-fix',
    'mp-s2v-scene-multi-materials',
    'mp-s2v-translation-optimize',
  ]
  const vites = names.map((n) => resolveDevPorts(WT + '/' + n, {}).vite)
  const cdps = names.map((n) => resolveDevPorts(WT + '/' + n, {}).cdp)
  assert.equal(new Set(vites).size, vites.length, 'vite 撞车: ' + vites.join(','))
  assert.equal(new Set(cdps).size, cdps.length, 'cdp 撞车: ' + cdps.join(','))
})

test('显式 MP_VITE_PORT/MP_CDP_PORT 同时覆盖派生（应急/测试）', () => {
  const r = resolveDevPorts(WT + '/mp-desktop-dev', { MP_VITE_PORT: '5188', MP_CDP_PORT: '9333' })
  assert.equal(r.vite, 5188)
  assert.equal(r.cdp, 9333)
  assert.equal(r.derived, true)
})

test('只覆盖一个端口时，另一个仍按路径派生（不回落共享默认 9222）', () => {
  const base = resolveDevPorts(WT + '/mp-desktop-dev', {})
  const r = resolveDevPorts(WT + '/mp-desktop-dev', { MP_VITE_PORT: '5188' })
  assert.equal(r.vite, 5188)
  assert.equal(r.cdp, base.cdp)
  assert.equal(r.derived, true)

  const r2 = resolveDevPorts(WT + '/mp-desktop-dev', { MP_CDP_PORT: '9333' })
  assert.equal(r2.vite, base.vite)
  assert.equal(r2.cdp, 9333)
  assert.equal(r2.derived, true)
})

test('非 worktree 路径 + 显式覆盖也生效', () => {
  const r = resolveDevPorts('D:/Data/projects/mulpub', { MP_VITE_PORT: '7777' })
  assert.equal(r.vite, 7777)
  assert.equal(r.cdp, DEFAULT_CDP_PORT)
  assert.equal(r.derived, true)
})

test('非法端口覆盖值抛错（NaN/越界）', () => {
  assert.throws(() => parsePort('abc'), /非法端口/)
  assert.throws(() => parsePort('99'), /非法端口/)
  assert.throws(() => parsePort('70000'), /非法端口/)
  assert.throws(() => resolveDevPorts(WT + '/mp-desktop-dev', { MP_VITE_PORT: 'not-a-port' }), /非法端口/)
})

test('MP_WORKTREES_ROOT 可配置（目录迁移后派生仍生效）', () => {
  const alt = 'D:/tmp/alt-worktrees'
  const r = resolveDevPorts(alt + '/mp-other-dev', { MP_WORKTREES_ROOT: alt })
  assert.equal(r.derived, true)
  assert.ok(r.vite >= 5174 && r.vite <= 7973)
})

// ---- #2459：bridge 侧端口必须与 vite/cdp 一样按 worktree 派生 ----
// 旧状态：dev-ports 只管 vite/cdp，bridge 端口（backend 8299 / prompt 8013 / splitter 8002 /
// aligner 8004 / callback 16521）被当成"必须避开的固定区"，于是**所有** worktree 共用同一组。
// 后果（实测三次）：第二个 dev 实例的 python 后端 uvicorn bind 10048 失败并反复重启，
// 而健康检查只是对 127.0.0.1:8299 发 HTTP —— 会被**别人的**后端应答，
// 于是启动器打印 MAIN_BACKEND_LISTENING / START_CONTRACT_OK 假报就绪。

test('#2459 非 worktree 路径保持既有 bridge 默认端口（行为不变）', () => {
  const r = resolveDevPorts('D:/Data/projects/mulpub', {})
  assert.equal(r.backend, 8299)
  assert.equal(r.prompt, 8013)
  assert.equal(r.splitter, 8002)
  assert.equal(r.aligner, 8004)
  assert.equal(r.callback, 16521)
})

test('#2459 worktree 路径下每个 bridge 端口都离开默认值并落在自己的带内', () => {
  const r = resolveDevPorts(WT + '/mp-desktop-dev', {})
  const bands = { backend: [18300, 21099], prompt: [21100, 23899], splitter: [23900, 26699], aligner: [26700, 29499], callback: [29500, 32299] }
  for (const [name, [lo, hi]] of Object.entries(bands)) {
    assert.ok(r[name] >= lo && r[name] <= hi, `${name} ${r[name]} 超出 [${lo},${hi}]`)
    assert.notEqual(r[name], { backend: 8299, prompt: 8013, splitter: 8002, aligner: 8004, callback: 16521 }[name],
      `${name} 仍是共享默认值 —— 并发实例会互抢`)
  }
})

test('#2459 同一 worktree 两次解析完全一致，且不同 worktree 的 backend 不撞车', () => {
  const a1 = resolveDevPorts(WT + '/mp-one', {})
  const a2 = resolveDevPorts(WT + '/mp-one', {})
  assert.deepEqual(
    [a1.backend, a1.prompt, a1.splitter, a1.aligner, a1.callback],
    [a2.backend, a2.prompt, a2.splitter, a2.aligner, a2.callback],
  )
  const seen = new Set()
  for (const t of ['mp-a', 'mp-b', 'mp-c', 'mp-d', 'mp-e', 'mp-f', 'mp-g', 'mp-h', 'mp-i', 'mp-j']) {
    const r = resolveDevPorts(WT + '/' + t, {})
    assert.ok(!seen.has(r.backend), `backend ${r.backend} 在两个 worktree 间撞车`)
    seen.add(r.backend)
  }
})

test('#2459 bridge 端口带与 vite/cdp 区间及彼此的相对关系固定（同一 h 偏移，可复现）', () => {
  const r = resolveDevPorts(WT + '/mp-offset', {})
  // 同 worktree 的所有 bridge 端口共享同一偏移 ⇒ 相对间距恒定，便于按端口反推 worktree
  assert.equal(r.prompt - r.backend, 21100 - 18300)
  assert.equal(r.splitter - r.backend, 23900 - 18300)
  assert.equal(r.aligner - r.backend, 26700 - 18300)
  assert.equal(r.callback - r.backend, 29500 - 18300)
  // 派生空间不得与 vite / cdp 区间重叠，否则"避开头"的注释会变成真抢占
  assert.ok(r.backend > 12021, 'bridge 带压到 cdp 区间')
})

test('#2459 显式 BACKEND_PORT 优先于派生，且不牵连其余端口（部分覆盖）', () => {
  const r = resolveDevPorts(WT + '/mp-partial', { BACKEND_PORT: '8431' })
  assert.equal(r.backend, 8431, '用户显式指定的端口必须被尊重（dev.js 不得把它覆回派生值）')
  const base = resolveDevPorts(WT + '/mp-partial', {})
  assert.equal(r.prompt, base.prompt)
  assert.equal(r.callback, base.callback)
  assert.equal(r.vite, base.vite)
})

test('#2459 非法 bridge 端口覆盖值一律拒绝（与 vite/cdp 同一校验口径）', () => {
  // '8299.5' / '8299abc' 是这次真正挖出来的洞：旧 parsePort 的守卫拿 n 和它自己比，
  // 恒为 false，于是两者都被静默接受成 8299 —— 用户以为换了端口，实际没换。
  for (const bad of ['0', '80', '70000', 'abc', '8299.5', '8299abc', '-1']) {
    assert.throws(() => resolveDevPorts(WT + '/mp-bad', { BACKEND_PORT: bad }), /非法端口/,
      `应当拒绝 ${JSON.stringify(bad)}`)
  }
  // 空串是"未设置"而不是"非法值"：必须回落到派生/默认，而不是抛错炸掉启动
  assert.equal(
    resolveDevPorts(WT + '/mp-bad', { BACKEND_PORT: '' }).backend,
    resolveDevPorts(WT + '/mp-bad', {}).backend,
  )
  // 合法值仍要接受（别把逃生阀一起焊死）；首尾空白按 cmd `set "K=V"` 的历史坑容忍
  assert.equal(resolveDevPorts(WT + '/mp-bad', { BACKEND_PORT: '8431' }).backend, 8431)
  assert.equal(resolveDevPorts(WT + '/mp-bad', { BACKEND_PORT: '8299 ' }).backend, 8299)
  assert.equal(resolveDevPorts(WT + '/mp-bad', { BACKEND_PORT: ' 8431 ' }).backend, 8431)
})

// ---- #2459：启动器不得再对硬编码端口探活 ----
// 派生之后，`Get-NetTCPConnection -LocalPort 8299` 这类写法会静默失效：本实例后端起在
// 派生端口，探 8299 要么命中别人的后端（假报 START_CONTRACT_OK，请求实际落到别人的
// 数据目录），要么谁都命中不到（把成功报成失败）。这里用读源码的结构锁把两件事钉住，
// 放在已被 CI 显式点名的 dev-ports.test.js 里（Gate 1，quality-gate.yml:77），
// 避免为 .ps1 新建测试文件再踩一遍 PowerShell 运行时分档。
test('#2459 启动器必须探派生端口并验证监听者归属，不得硬编码 8299', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const launcher = path.resolve(__dirname, '..', '..', '..', 'scripts', 'mp-applive-launcher.ps1')
  // 读不到就红 —— 允许 skip 的结构锁等于没有锁
  const src = fs.readFileSync(launcher, 'utf8')

  assert.doesNotMatch(src, /-LocalPort\s+8299/, '后端探活端口必须来自派生结果，不能是字面量 8299')
  assert.match(src, /\[int\]\$ports\.backend/, '启动器必须从 resolveDevPorts 取 backend 端口')
  assert.match(src, /set "BACKEND_PORT=/, '派生端口必须显式下发给子进程')
  assert.match(src, /OwningProcess/, '就绪判据必须落到进程级归属')
  assert.match(src, /Get-BackendListenerOwnership/, '归属校验必须是具名函数，而不是内联一次就散掉')
})

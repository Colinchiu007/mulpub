'use strict'

/**
 * 快手签名命令选择（Tier-A 纯 JS vs Tier-B 页面签名器）的回归锁
 *
 * 背景：2026-10 把竞品 VM 的 sig3 算法完整还原为纯 JS 并接入注册表，
 * 主链路的默认签名命令从 `kuaishou.ns-sig3-browser`（页面签名器，需 Playwright/CEF）
 * 切到 `kuaishou.ns-sig3`（纯 JS）。本文件锁住三件事：
 *   1. 两个发布入口的默认命令都是纯 JS
 *   2. 仍可通过 { signCommand } 显式回退到页面签名器
 *   3. 常量导出完整且自洽
 *
 * 不联网、不启动浏览器。
 */

const assert = require('assert')

const capMod = require('../src/publish/capabilities/kuaishou-capabilities')
const vidMod = require('../src/publish/platforms/kuaishou-video')

const { KuaishouCapabilities, DEFAULT_SIGN_COMMAND, BROWSER_SIGN_COMMAND, SIGN_COMMAND } = capMod
const { KuaishouVideoChain } = vidMod

let passed = 0
let failed = 0
const queue = []
function t (name, fn) { queue.push({ name, fn }) }

async function runOne ({ name, fn }) {
  try {
    await fn()
    passed++
    console.log('  \u2705 ' + name)
  } catch (e) {
    failed++
    console.log('  \u274C ' + name + ': ' + (e && e.message))
  }
}

// 构造器需要 cookie（缺 api_ph 只在请求时才抛），这里给一个形状合法的即可
const COOKIE = 'kuaishou.web.cp.api_ph=PH_TEST; did=did_test'

// ── 1. 常量自洽
t('DEFAULT_SIGN_COMMAND 是纯 JS 命令', () => {
  assert.strictEqual(capMod.DEFAULT_SIGN_COMMAND, 'kuaishou.ns-sig3')
  assert.strictEqual(vidMod.DEFAULT_SIGN_COMMAND, 'kuaishou.ns-sig3')
})
t('BROWSER_SIGN_COMMAND 是页面签名器命令', () => {
  assert.strictEqual(capMod.BROWSER_SIGN_COMMAND, 'kuaishou.ns-sig3-browser')
  assert.strictEqual(vidMod.BROWSER_SIGN_COMMAND, 'kuaishou.ns-sig3-browser')
})
t('兼容导出 SIGN_COMMAND === DEFAULT_SIGN_COMMAND', () => {
  assert.strictEqual(capMod.SIGN_COMMAND, capMod.DEFAULT_SIGN_COMMAND)
  assert.strictEqual(vidMod.SIGN_COMMAND, vidMod.DEFAULT_SIGN_COMMAND)
})
t('两个命令不相同（避免回退时静默走同一路径）', () => {
  assert.notStrictEqual(DEFAULT_SIGN_COMMAND, BROWSER_SIGN_COMMAND)
})
t('SIGN_COMMAND 等于纯 JS 命令（旧名不再指向页面签名器）', () => {
  assert.strictEqual(SIGN_COMMAND, 'kuaishou.ns-sig3')
})

// ── 2. 默认走纯 JS
t('KuaishouCapabilities 默认 signCommand = 纯 JS', () => {
  const c = new KuaishouCapabilities({ cookie: COOKIE })
  assert.strictEqual(c.signCommand, 'kuaishou.ns-sig3')
})
t('KuaishouVideoChain 默认 signCommand = 纯 JS', () => {
  const c = new KuaishouVideoChain({ cookie: COOKIE })
  assert.strictEqual(c.signCommand, 'kuaishou.ns-sig3')
})

// ── 3. 可显式回退
t('KuaishouCapabilities 可回退到页面签名器', () => {
  const c = new KuaishouCapabilities({ cookie: COOKIE, signCommand: BROWSER_SIGN_COMMAND })
  assert.strictEqual(c.signCommand, 'kuaishou.ns-sig3-browser')
})
t('KuaishouVideoChain 可回退到页面签名器', () => {
  const c = new KuaishouVideoChain({ cookie: COOKIE, signCommand: vidMod.BROWSER_SIGN_COMMAND })
  assert.strictEqual(c.signCommand, 'kuaishou.ns-sig3-browser')
})
t('显式传空串时回落到默认（不产生空命令）', () => {
  const c = new KuaishouCapabilities({ cookie: COOKIE, signCommand: '' })
  assert.strictEqual(c.signCommand, 'kuaishou.ns-sig3')
})

// ── 4. 注册表确实有这两个命令
t('注册表同时存在 Tier-A 与 Tier-B 命令', () => {
  const signerMod = require('../src/signer')
  const list = signerMod.registry.list()
  assert.strictEqual(list.includes('kuaishou.ns-sig3'), true)
  assert.strictEqual(list.includes('kuaishou.ns-sig3-browser'), true)
})

// ── 5. 端到端：把命令名传给 signer（用注入 signer 截获，不发请求）
t('capabilities 传给 signer 的是纯 JS 命令名', async () => {
  const captured = []
  const c = new KuaishouCapabilities({
    cookie: COOKIE,
    signer: async (cmd, payload) => { captured.push({ cmd, payload }); return 'x'.repeat(56) },
  })
  await c._sign('/rest/v2/creator/pc/authority/account/current', {})
  assert.strictEqual(captured.length, 1)
  assert.strictEqual(captured[0].cmd, 'kuaishou.ns-sig3')
  assert.strictEqual(captured[0].payload.type, 'json')
  assert.strictEqual(captured[0].payload.url, '/rest/v2/creator/pc/authority/account/current')
})
t('video 传给 signer 的是纯 JS 命令名', async () => {
  const captured = []
  const c = new KuaishouVideoChain({
    cookie: COOKIE,
    signer: async (cmd, payload) => { captured.push({ cmd, payload }); return 'x'.repeat(56) },
  })
  await c._sign('/rest/cp/works/v2/video/pc/upload/pre', { foo: 1 }, 'json')
  assert.strictEqual(captured.length, 1)
  assert.strictEqual(captured[0].cmd, 'kuaishou.ns-sig3')
  assert.deepStrictEqual(captured[0].payload.params, { foo: 1 })
})
t('回退时传给 signer 的是页面签名器命令名', async () => {
  const captured = []
  const c = new KuaishouCapabilities({
    cookie: COOKIE,
    signCommand: BROWSER_SIGN_COMMAND,
    signer: async (cmd) => { captured.push(cmd); return 'y'.repeat(56) },
  })
  await c._sign('/rest/x', {})
  assert.strictEqual(captured[0], 'kuaishou.ns-sig3-browser')
})

// ── 6. 真签名可用：注册表默认链路端到端产出 56 hex
t('注册表 kuaishou.ns-sig3 端到端产出 56 hex', async () => {
  const signerMod = require('../src/signer')
  const sig = await signerMod.registry.sign('kuaishou.ns-sig3', {
    url: '/rest/v2/creator/pc/authority/account/current',
    type: 'json',
    params: { 'kuaishou.web.cp.api_ph': 'PH_TEST' },
  })
  assert.strictEqual(typeof sig, 'string')
  assert.strictEqual(sig.length, 56)
  assert.strictEqual(/^[0-9a-f]{56}$/.test(sig), true)
})

;(async () => {
  for (const item of queue) await runOne(item)
  console.log('\n========== kuaishou-sign-command Result ==========')
  console.log('  Passed: ' + passed + ' / ' + (passed + failed))
  console.log('  Failed: ' + failed + ' / ' + (passed + failed))
  if (failed > 0) process.exit(1)
})()

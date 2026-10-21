import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 接线锁：五个「加载平台真实页面」的内嵌视图必须都装上统一外部协议守卫。
 *
 * 为什么用源码锁而不是逐个驱动视图：auth-view-manager / qrcode-login / oauth-manager /
 * rpa-view-session 的创建路径都带定时器、session 分区、真实平台 URL，驱动成本高且易碎；
 * 而「这一处到底装没装守卫」是**接线事实**，源码锁能精确回答，且新增视图时会被本锁点名。
 * 守卫本身的拦截行为由 external-protocol-guard.test.js 逐条覆盖。
 */

const SERVICES_DIR = path.resolve(__dirname)

/** [文件名, 期望 tag] */
const WIRED_SITES = [
  ['auth-view-session.js', 'auth-view'],
  ['qrcode-login.js', 'qrcode-login'],
  ['oauth-manager.js', 'oauth'],
  ['rpa-view-session.js', 'rpa-view'],
  ['auth-view-manager.js', 'silent-auth'],
]

/**
 * 从源码里取出 `attachExternalProtocolGuard(...)` 的**实参文本**。
 *
 * 为什么不用一条正则直接匹配整个调用（CCG 第 2 轮 i3）：
 * 单条正则 `attachExternalProtocolGuard\([^)]*tag:…` 会被三种正常写法打穿 ——
 * ① 实参换行（`[^)]*` 里的 `.` 默认不跨行）；② 实参里出现嵌套括号（`[^)]*` 提前截断）；
 * ③ 调用写成 `attachExternalProtocolGuard\n  (…`。这些都会让"锁"假红或假绿，
 * 而这条锁是新增视图登记的唯一防线 ⇒ 改成**括号配平**扫描，与写法无关。
 */
function extractGuardCallArgs (text) {
  const args = []
  const re = /attachExternalProtocolGuard\s*\(/g
  let m
  while ((m = re.exec(text)) !== null) {
    let depth = 1
    let i = m.index + m[0].length
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i]
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
    }
    args.push(text.slice(m.index + m[0].length, Math.max(m.index + m[0].length, i - 1)))
  }
  return args
}

describe('外部协议守卫接线锁', () => {
  it('守卫模块必须复用共享判据且不得自带协议正则（与 href-scheme-contract 同一口径）', () => {
    const text = fs.readFileSync(path.join(SERVICES_DIR, 'external-protocol-guard.js'), 'utf8')
    expect(text).toContain('safe-http-url')
    expect(text).not.toMatch(/\/\^https\?:/)
  })

  it.each(WIRED_SITES)('%s 必须调用统一守卫并带可区分的 tag（%s）', (file, tag) => {
    const text = fs.readFileSync(path.join(SERVICES_DIR, file), 'utf8')
    expect(text, `${file} 必须 require 守卫模块`).toContain('external-protocol-guard')
    const calls = extractGuardCallArgs(text)
    expect(calls.length, `${file} 必须至少调用一次 attachExternalProtocolGuard`).toBeGreaterThan(0)
    const tagged = calls.some(args => new RegExp(`\\btag\\s*:\\s*'${tag}'`).test(args))
    expect(
      tagged,
      `${file} 的 attachExternalProtocolGuard 调用必须带 tag: '${tag}'（实参：${JSON.stringify(calls)}）`,
    ).toBe(true)
  })

  it('接线锁自身不得被调用写法打穿（换行 / 嵌套括号 / 括号前空格都要认）', () => {
    const probes = [
      "attachExternalProtocolGuard(view.webContents, { tag: 'x' })",
      "attachExternalProtocolGuard(\n  view.webContents,\n  { tag: 'x' },\n)",
      "attachExternalProtocolGuard(view.webContents, { tag: 'x', extra: fn(1) })",
      "attachExternalProtocolGuard (view.webContents, { tag: 'x' })",
    ]
    for (const probe of probes) {
      const args = extractGuardCallArgs(probe)
      expect(args.length, `探针未扫到调用：${JSON.stringify(probe)}`).toBe(1)
      expect(/\btag\s*:\s*'x'/.test(args[0]), `探针未取到 tag：${JSON.stringify(probe)}`).toBe(true)
    }
  })

  it('已有守卫的视图不得被本守卫重复接管（普通标签/身份窗/签名页各有各的判据）', () => {
    const alreadyGuarded = [
      path.join(SERVICES_DIR, 'webview-manager', 'tab-lifecycle.js'),
      path.resolve(SERVICES_DIR, 'identity', 'identity-auth-window.js'),
      path.resolve(SERVICES_DIR, '..', 'signer', 'signer-page-manager.js'),
    ]
    for (const file of alreadyGuarded) {
      const text = fs.readFileSync(file, 'utf8')
      expect(text, `${file} 不应接入本守卫`).not.toContain('external-protocol-guard')
    }
  })
})

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

describe('外部协议守卫接线锁', () => {
  it('守卫模块必须复用共享判据且不得自带协议正则（与 href-scheme-contract 同一口径）', () => {
    const text = fs.readFileSync(path.join(SERVICES_DIR, 'external-protocol-guard.js'), 'utf8')
    expect(text).toContain('safe-http-url')
    expect(text).not.toMatch(/\/\^https\?:/)
  })

  it.each(WIRED_SITES)('%s 必须调用统一守卫并带可区分的 tag（%s）', (file, tag) => {
    const text = fs.readFileSync(path.join(SERVICES_DIR, file), 'utf8')
    expect(text, `${file} 必须 require 守卫模块`).toContain('external-protocol-guard')
    expect(
      text,
      `${file} 必须调用 attachExternalProtocolGuard 并传入 tag: '${tag}'`,
    ).toMatch(new RegExp(`attachExternalProtocolGuard\\([^)]*tag:\\s*'${tag}'`))
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

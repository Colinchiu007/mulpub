'use strict'

/**
 * stdio-log-bridge 回归锁（2026-10-24）
 *
 * 锁的是「包内 console.log 必须出现在应用日志里」这条管线。
 * 变异反证：把 main.js 里的 install() 调用摘掉、或把 bridge 里的 _depth 重入保护去掉，
 * 对应用例必须当场红。
 */

const { install, _resetForTest } = require('./stdio-log-bridge')

function makeFakeLogger () {
  const calls = []
  return {
    calls,
    info: function (tag, msg) { calls.push(['info', tag, msg]) },
    warn: function (tag, msg) { calls.push(['warn', tag, msg]) },
    error: function (tag, msg) { calls.push(['error', tag, msg]) },
  }
}

describe('stdio-log-bridge', () => {
  let origOut
  let origErr

  beforeEach(() => {
    origOut = process.stdout.write.bind(process.stdout)
    origErr = process.stderr.write.bind(process.stderr)
    _resetForTest()
  })

  afterEach(() => {
    process.stdout.write = origOut
    process.stderr.write = origErr
    _resetForTest()
  })

  test('安装后 stdout 的内容会被写进应用日志（带 tag）', () => {
    const fake = makeFakeLogger()
    expect(install({ logger: fake, tag: 'PkgLog' })).toBe(true)
    process.stdout.write('hello-from-package\n')
    const hit = fake.calls.find((c) => c[0] === 'info' && c[2] === 'hello-from-package')
    expect(hit).toBeTruthy()
    expect(hit[1]).toBe('PkgLog')
  })

  test('stderr 走 error 级别', () => {
    const fake = makeFakeLogger()
    install({ logger: fake })
    process.stderr.write('boom\n')
    expect(fake.calls.some((c) => c[0] === 'error' && c[2] === 'boom')).toBe(true)
  })

  test('重入保护：logger 自己写 console 不会无限递归', () => {
    let depth = 0
    const fake = {
      info: function () {
        depth++
        if (depth > 5) throw new Error('recursion')
        process.stdout.write('inner\n')
      },
      warn: function () {},
      error: function () {},
    }
    install({ logger: fake })
    expect(() => process.stdout.write('outer\n')).not.toThrow()
    expect(depth).toBe(1)
  })

  test('重复安装是幂等的（第二次返回 false）', () => {
    const fake = makeFakeLogger()
    expect(install({ logger: fake })).toBe(true)
    expect(install({ logger: fake })).toBe(false)
  })

  test('原输出行为保持不变（终端仍能看到）', () => {
    const fake = makeFakeLogger()
    const seen = []
    const cur = process.stdout.write
    // 先装桥，再在桥的外层记录一次实际写出的内容
    install({ logger: fake })
    const afterInstall = process.stdout.write
    process.stdout.write = function (chunk) {
      seen.push(String(chunk))
      return afterInstall.apply(process.stdout, arguments)
    }
    process.stdout.write('still-visible\n')
    expect(seen.join('')).toContain('still-visible')
    process.stdout.write = cur
  })
})

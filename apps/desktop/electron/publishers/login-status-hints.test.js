import { describe, it, expect } from 'vitest'

const hintsPath = new URL('./login-status-hints.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const { hintForLoginStatus, summarizeHintActions, REASON_HINTS, CODE_HINTS } = await import(hintsPath)

describe('login-status-hints 用户可执行提示', () => {
  it('reason 优先于 code：同一个 INCONCLUSIVE 码下的不同原因给不同提示', () => {
    const a = hintForLoginStatus({ code: 'CHECK_LOGIN_INCONCLUSIVE', reason: 'http-check-inconclusive' })
    const b = hintForLoginStatus({ code: 'CHECK_LOGIN_INCONCLUSIVE', reason: 'no-cookie' })
    expect(a.key).not.toBe(b.key)
    expect(a.action).toBe('retry') // 接口没定论 → 可重试
    expect(b.action).toBe('relogin') // 没凭证 → 要重新登录
  })

  it('未知 reason / 未知 code ⇒ 返回 null（调用方回落通用文案，绝不编动作）', () => {
    expect(hintForLoginStatus({ code: 'CHECK_LOGIN_INCONCLUSIVE', reason: 'brand-new-reason' })).toBeNull()
    expect(hintForLoginStatus({ code: 'SOME_UNKNOWN_CODE' })).toBeNull()
    expect(hintForLoginStatus(null)).toBeNull()
    expect(hintForLoginStatus(undefined)).toBeNull()
    expect(hintForLoginStatus('nope')).toBeNull()
  })

  it('每个提示都必须带 locales 键 + 主进程兜底文案 + 动作分类（三者缺一即红）', () => {
    for (const [id, h] of Object.entries({ ...REASON_HINTS, ...CODE_HINTS })) {
      expect(h.key, id + '.key').toMatch(/^accountsPage\.checkHints\./)
      expect(typeof h.fallback, id + '.fallback').toBe('string')
      expect(h.fallback.length, id + '.fallback 长度').toBeGreaterThan(4)
      expect(['retry', 'relogin', 'wait', 'contact', 'none'], id + '.action').toContain(h.action)
    }
  })

  it('「检测参数不合法」这类非用户可处理项不得给出引导动作', () => {
    const h = hintForLoginStatus({ code: 'CHECK_LOGIN_INVALID_PARAMS' })
    expect(h).toBeNull()
  })

  it('聚合：按动作分类计数，供批量检测汇总行使用', () => {
    const items = [
      { hint: { action: 'relogin' } },
      { hint: { action: 'relogin' } },
      { hint: { action: 'retry' } },
      { hint: null },
      {}
    ]
    expect(summarizeHintActions(items)).toEqual({ relogin: 2, retry: 1, wait: 0, contact: 0, none: 0, unknown: 2 })
    expect(summarizeHintActions(null)).toEqual({ relogin: 0, retry: 0, wait: 0, contact: 0, none: 0, unknown: 0 })
  })
})

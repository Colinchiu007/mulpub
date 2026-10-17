import { describe, it, expect, vi } from 'vitest'

const runnerPath = new URL('./dom-login-check-runner.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const { runHiddenPageCheck, diedResult, createDeadProcessRunner } = await import(runnerPath)

describe('dom-login-check-runner 隐藏页面判定的进程隔离', () => {
  const req = { platform: 'weibo', accountId: 'acc-1', url: 'https://weibo.com/login', successSelector: '.user', cookies: [], localStorage: {} }

  it('默认路径：直接走主进程内实现，结果原样透传', async () => {
    const runInProcess = vi.fn().mockResolvedValue({ valid: true, code: 'CHECK_LOGIN_SUCCESS' })
    const out = await runHiddenPageCheck(req, { runInProcess })
    expect(out).toEqual({ valid: true, code: 'CHECK_LOGIN_SUCCESS' })
    expect(runInProcess).toHaveBeenCalledTimes(1)
  })

  it('主进程内实现抛错 ⇒ 降级未确认，绝不把异常抛给调用方', async () => {
    const runInProcess = vi.fn().mockRejectedValue(new Error('getContext failed'))
    const out = await runHiddenPageCheck(req, { runInProcess })
    expect(out.valid).toBeUndefined()
    expect(out.code).toBe('CHECK_LOGIN_INCONCLUSIVE')
    expect(out.reason).toBe('dom-check-process-died')
    expect(out.error).toContain('getContext failed')
  })

  it('隔离路径：子进程运行器死亡 ⇒ 降级未确认（这是本方案的全部意义）', async () => {
    const spawnIsolated = vi.fn().mockReturnValue(createDeadProcessRunner({ message: 'render process gone (signal 11)' }))
    const runInProcess = vi.fn()
    const out = await runHiddenPageCheck(req, { runInProcess, spawnIsolated }, { isolated: true })
    expect(out).toEqual({
      valid: undefined,
      code: 'CHECK_LOGIN_INCONCLUSIVE',
      reason: 'dom-check-process-died',
      error: 'render process gone (signal 11)'
    })
    // 隔离时不得再走主进程内实现（否则等于没隔离）
    expect(runInProcess).not.toHaveBeenCalled()
  })

  it('隔离路径但没提供 spawnIsolated ⇒ 回落主进程内实现（fail-closed 到默认路径）', async () => {
    const runInProcess = vi.fn().mockResolvedValue({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    const out = await runHiddenPageCheck(req, { runInProcess }, { isolated: true })
    expect(out.valid).toBe(false)
    expect(runInProcess).toHaveBeenCalledTimes(1)
  })

  it('子进程返回空结果 ⇒ 判未确认，不得当成"有效"', async () => {
    const spawnIsolated = vi.fn().mockReturnValue({ run: async () => null })
    const out = await runHiddenPageCheck(req, { runInProcess: async () => ({}), spawnIsolated }, { isolated: true })
    expect(out.reason).toBe('dom-check-process-died')
    expect(out.valid).toBeUndefined()
  })

  it('runInProcess 缺失 ⇒ 抛 TypeError（合同面守卫，防止静默走错分支）', async () => {
    await expect(runHiddenPageCheck(req, {})).rejects.toThrow(/runInProcess 必须为函数/)
  })

  it('diedResult 的形状必须可被 hint 映射命中（dom-check-process-died 有专属提示）', () => {
    const out = diedResult('x')
    expect(out).toEqual({ valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE', reason: 'dom-check-process-died', error: 'x' })
  })
})

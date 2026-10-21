'use strict'

/**
 * title-fill-verify 的行为锁（2026-10-22）
 *
 * 真机现场：西瓜上传页标题框里是 `dy-small`（=视频文件名），而期望值是文章标题；
 * 旧的可信判据只有「读回非 0」⇒ 非空但不等于期望值也判成功，且日志无痕迹。
 */

// 使用 vitest 全局（runner 以 --globals 运行）
const { fillAndVerifyTitle, readValue } = require('../electron/services/title-fill-verify.js')

/** 造一个假 win：executeJavaScript 返回当前"页面值" */
function fakeWin (state) {
  return { webContents: { executeJavaScript: async () => state.value } }
}

/** 造一个假 ctx：_fillInput 会改动 state.value */
function fakeCtx (state, behavior) {
  return {
    _fillInput: async (win, sel, value) => {
      if (behavior === 'ignore') return // 写入无效
      if (behavior === 'platform-overwrite') { state.value = 'dy-small'; return }
      state.value = String(value)
    },
  }
}

describe('title-fill-verify', () => {
  test('填充成功且回读等值 ⇒ ok、retried=false', async () => {
    const state = { value: '' }
    const r = await fillAndVerifyTitle(fakeCtx(state), fakeWin(state), 'input.x', '被误解的明朝', {})
    expect(r.ok).toBe(true)
    expect(r.readback).toBe('被误解的明朝')
    expect(r.retried).toBe(false)
  })

  test('首次不匹配 → 重填一次并成功 ⇒ retried=true', async () => {
    const state = { value: '' }
    let calls = 0
    const ctx = { _fillInput: async (w, s, v) => { calls++; if (calls === 1) { state.value = '' } else { state.value = String(v) } } }
    const r = await fillAndVerifyTitle(ctx, fakeWin(state), 'input.x', '标题A', {})
    expect(calls).toBe(2)
    expect(r.retried).toBe(true)
    expect(r.readback).toBe('标题A')
  })

  test('平台反复覆盖（写进去又被改成文件名）⇒ 仍 ok 但 readback 如实反映、且有 warn', async () => {
    const state = { value: '' }
    const warns = []
    const ctx = fakeCtx(state, 'platform-overwrite')
    const r = await fillAndVerifyTitle(ctx, fakeWin(state), 'input.x', '被误解的明朝', {
      platform: 'toutiao',
      log: { warn: (m, s) => warns.push(s) },
    })
    expect(r.ok).toBe(true)
    expect(r.readback).toBe('dy-small')
    expect(warns.some((w) => /readback mismatch/.test(w))).toBe(true)
    expect(warns.some((w) => /still mismatched after refill/.test(w))).toBe(true)
  })

  test('readValue 在取不到元素时返回空串（不抛错）', async () => {
    const win = { webContents: { executeJavaScript: async () => { throw new Error('boom') } } }
    expect(await readValue(win, 'input.x')).toBe('')
  })
})

describe('pickVisibleTarget 接线', () => {
  test('优先用可见元素打标记后的唯一选择器去填', async () => {
    const state = { value: '' }
    const used = []
    const win = {
      webContents: {
        executeJavaScript: async (code) => {
          if (String(code).indexOf('data-mp-title-target') >= 0 && String(code).indexOf('setAttribute') >= 0) return '[data-mp-title-target="1"]'
          return state.value
        },
      },
    }
    const ctx = { _fillInput: async (w, sel, v) => { used.push(sel); state.value = String(v) } }
    const r = await fillAndVerifyTitle(ctx, win, 'input.xigua-input', '标题A', {})
    expect(used[0]).toBe('[data-mp-title-target="1"]')
    expect(r.readback).toBe('标题A')
  })

  test('找不到元素时回退原选择器', async () => {
    const state = { value: '' }
    const used = []
    const win = { webContents: { executeJavaScript: async () => '' } }
    const ctx = { _fillInput: async (w, sel, v) => { used.push(sel); state.value = String(v) } }
    await fillAndVerifyTitle(ctx, win, 'input.x', '标题B', {})
    expect(used[0]).toBe('input.x')
  })
})
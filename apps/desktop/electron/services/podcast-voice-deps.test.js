/**
 * 音色接线层的契约锁（tasks 4.5b④ / PRD §7.4.1.3；QM6 i3 采纳项的**载体**）
 *
 * i3 成立的那半是：「同一份接线」当时只剩源码形状在守，两处调用工厂会得到两份实例。
 * 拆进本模块后这条不变量必须能被断言，而不是被注释声明——所以第 1 条就是**引用同一性**，
 * 第 5 条锁的是消费面（`ipc-handlers/podcast.js` 只许装配一次、两处共用同一个 getter，
 * 且不得再自带第二份 `createVoiceReaders`）。
 *
 * 接缝：只假 IPC 注入面（store / modelProviderManager / identityService），
 * 真跑 `podcast-episode-tts-adapters.createVoiceReaders`（偏好键的字面量是它持有的，
 * 本层若自己拼键名，第 4 条就会红）。
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { createVoiceDepsFactory } from './podcast-voice-deps'

const here = path.dirname(fileURLToPath(import.meta.url))

function makeLog () {
  const lines = []
  return { lines, warn: (m) => lines.push(String(m)), info: () => {}, error: () => {} }
}

describe('§podcast-voice-deps 音色接线的实例同一性与缺省口径', () => {
  it('① 同一个 deps 反复调用工厂 ⇒ 返回同一个 getter、同一个 voiceDeps 对象引用（QM6 i3 的载体）', () => {
    const deps = { store: { getUserSetting: () => null } }
    const log = makeLog()
    const a = createVoiceDepsFactory({ deps, log })
    const b = createVoiceDepsFactory({ deps, log })
    expect(a, '工厂本身必须被记忆化，否则两处调用会各建一份接线').toBe(b)
    expect(a()).toBe(b())
    expect(typeof a().defaultProviderOf).toBe('function')
    // 不同 deps 必须是不同实例——否则 A 会话的 store 会替 B 会话读偏好
    const c = createVoiceDepsFactory({ deps: { store: { getUserSetting: () => null } }, log })
    expect(c()).not.toBe(a())
  })

  it('② 缺 store ⇒ 偏好按未配置处理（返回 null），且 warn 只报一次（刷屏会把真信号冲掉）', () => {
    const log = makeLog()
    const get = createVoiceDepsFactory({ deps: {}, log })
    const d = get()
    expect(d.readPreference('prov', 'model')).toBe(null)
    expect(d.readPreference('prov', 'model')).toBe(null)
    expect(get()).toBe(d)
    const depWarn = log.lines.filter((l) => l.includes('缺 store 注入'))
    expect(depWarn.length).toBe(1)
    expect(depWarn[0]).toContain('不猜默认音色')
  })

  it('③ 缺 modelProviderManager ⇒ 定位键为 null（② ③ 两层随之如实拒绝），warn 同样只一次', () => {
    const log = makeLog()
    const get = createVoiceDepsFactory({ deps: { store: { getUserSetting: () => null } }, log })
    const d = get()
    expect(d.defaultProviderOf()).toBe(null)
    expect(d.defaultProviderOf()).toBe(null)
    const m = log.lines.filter((l) => l.includes('modelProviderManager'))
    expect(m.length).toBe(1)
    expect(m[0]).toContain('② ③ 两层没有定位键')
  })

  it('④ 有 store ⇒ 偏好键原样交给 store.getUserSetting，并带上 owner subject（键名由 adapters 一处持有，本层不拼第二份）', () => {
    const seen = []
    const ownerProbe = vi.fn(() => 'subject-42')
    const deps = {
      identityService: { whoami: 'noop' },
      store: { getUserSetting: (k, def, owner) => { seen.push({ k, def, owner }); return { voiceId: 'v1' } } },
    }
    const d = createVoiceDepsFactory({ deps, log: makeLog(), ownerSubjectOf: ownerProbe })()
    expect(d.readPreference('prov_x', 'model_y')).toEqual({ voiceId: 'v1' })
    expect(seen.length).toBe(1)
    expect(seen[0].k.startsWith('tts-voice-preference:v1:prov_x:model_y'), '键格式必须出自 createVoiceReaders 那一处实现：' + seen[0].k).toBe(true)
    expect(seen[0].owner).toBe('subject-42')
    expect(ownerProbe).toHaveBeenCalledTimes(1)
  })

  it('⑤ 接线锁：ipc-handlers/podcast.js 只装配一次、宿主与预览共用同一个 getter，且不得自带第二份装配', () => {
    const src = fs.readFileSync(path.resolve(here, '..', 'ipc-handlers', 'podcast.js'), 'utf8')
    const code = src.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('//')).join('\n')
    expect((code.match(/createVoiceDepsFactory/g) || []).length).toBe(2) // 一次 require + 一次调用，不得出现第三处装配
    expect(code).toMatch(/voice:\s*voiceResolveDeps\(\)/)
    expect(code).toMatch(/createEpisodePlanPreview\(voiceResolveDeps\(\)\)/)
    // 第二份 createVoiceReaders 会让「同一份接线」退回两份实例（QM6 i3 的成因），此处按语义位置禁掉
    expect(code).not.toMatch(/createVoiceReaders\s*\(/)
    expect(code).not.toMatch(/tts-voice-preference:/) // 偏好键字面量只允许在 adapters 一处
  })
})

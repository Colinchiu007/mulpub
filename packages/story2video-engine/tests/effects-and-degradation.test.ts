/**
 * 审计 P2（audit-batch-4）两处收口的回归保护：
 *  1) 枚举单一来源：动效/转场 ID 白名单由 effects-library 元数据派生（原为 types.ts 与
 *     桌面端各抄一份，共 3 处），新增效果只登记一次；
 *  2) 静默 catch 收口：slideshow 的四处有意降级必须留痕（createDegradationSink）。
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  IMAGE_EFFECTS, TRANSITION_EFFECTS, IMAGE_EFFECT_IDS, TRANSITION_EFFECT_IDS,
} from '../src/effects-library'
import { createDegradationSink } from '../src/slideshow'

// 迁移前桌面端两处硬编码列表的逐项快照：单一来源不得改变既有顺序（'none' 恒置顶）
const LEGACY_IMAGE_IDS = ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'zoom-pan', 'rotate', 'blur-in']
const LEGACY_TRANSITION_IDS = ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down']

function readSrc(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

describe('动效/转场 ID 单一来源', () => {
  it('IMAGE_EFFECT_IDS 与迁移前逐项一致（顺序 + 集合双锁）', () => {
    expect(Array.from(IMAGE_EFFECT_IDS)).toEqual(LEGACY_IMAGE_IDS)
  })

  it('TRANSITION_EFFECT_IDS 与迁移前逐项一致', () => {
    expect(Array.from(TRANSITION_EFFECT_IDS)).toEqual(LEGACY_TRANSITION_IDS)
  })

  it('白名单是元数据的派生结果（不引入未登记 ID）', () => {
    expect(IMAGE_EFFECTS.map((e) => e.id).sort()).toEqual([...IMAGE_EFFECT_IDS].sort())
    expect(TRANSITION_EFFECTS.map((e) => e.id).sort()).toEqual([...TRANSITION_EFFECT_IDS].sort())
  })

  it('导出为冻结数组，消费方无法就地篡改', () => {
    expect(Object.isFrozen(IMAGE_EFFECT_IDS)).toBe(true)
    expect(() => { (IMAGE_EFFECT_IDS as string[]).push('ghost') }).toThrow()
  })

  it('types.ts 的 TS 联合类型与运行时白名单同源（防类型/常量各改一半）', () => {
    const src = readSrc('src/types.ts')
    const parse = (name: string) => {
      const m = src.match(new RegExp('export type ' + name + ' =([\\s\\S]*?);'))
      expect(m, 'types.ts 缺少 ' + name + ' 联合类型').toBeTruthy()
      return Array.from(m![1].matchAll(/'([^']+)'/g)).map((x) => x[1])
    }
    expect(parse('ImageEffect').sort()).toEqual([...LEGACY_IMAGE_IDS].sort())
    expect(parse('TransitionEffect').sort()).toEqual([...LEGACY_TRANSITION_IDS].sort())
  })
})

describe('createDegradationSink 降级留痕', () => {
  it('注入 onWarn 时按 (stage, message) 上抛，Error 取 message', () => {
    const calls: Array<[string, string]> = []
    const warn = createDegradationSink((s, m) => { calls.push([s, m]) })
    warn('audio-mix', new Error('no track'))
    warn('bgm-load', '字符串错误')
    expect(calls).toEqual([['audio-mix', 'no track'], ['bgm-load', '字符串错误']])
  })

  it('宿主回调自身抛错不得影响渲染主流程', () => {
    const warn = createDegradationSink(() => { throw new Error('宿主炸了') })
    expect(() => warn('recorder-stop', new Error('x'))).not.toThrow()
  })

  it('未注入时回落 console.warn（带 [slideshow] 前缀与 stage）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      createDegradationSink()('audio-duration', new Error('decode failed'))
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toBe('[slideshow] audio-duration 降级: decode failed')
    } finally {
      spy.mockRestore()
    }
  })

  it('slideshow 四处降级点全部接上留痕，且无零留痕空 catch', () => {
    const src = readSrc('src/slideshow.ts')
    for (const stage of ['audio-duration', 'bgm-load', 'audio-mix', 'recorder-stop']) {
      expect(src, '降级点缺留痕: ' + stage).toContain("warn('" + stage + "', e)")
    }
    const silent = src.match(/catch\s*\{\s*(\/\*[^*]*\*\/|\/\/[^\n]*)?\s*\}/g) || []
    // 仅允许 onWarn 隔离这一处（宿主回调异常不得反噬主流程，已有注释说明）
    expect(silent).toHaveLength(1)
    expect(silent[0]).toContain('宿主回调异常')
  })
})

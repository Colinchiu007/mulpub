// @ts-check
/**
 * agnes-video-request.test.js — Agnes 视频请求体构造的**行为锁**
 *
 * ## 为什么要有行为锁（不只靠结构锁）
 *
 * `image-adapter-aspect-contract.test.js` 里那道是**结构锁**（扫源码正则）——
 * 它能挡住「解析分支被整个删掉」，但挡不住「解析了、结果却没进请求体」这类错位。
 * 历史上真正咬人的那两次（2026-10-02 竖屏被静默丢弃、2026-10-06 换个 Provider 就复现）
 * 都是**行为层**的问题 ⇒ 必须有一道真的跑一遍、断言**请求体里那个字段**的锁。
 *
 * 覆盖：
 * - 显式画幅（`aspect_ratio` 与 `aspectRatio` 两个键名）优先于宽高推导；
 * - 两者都没有时按宽高推导到最近的合法画幅；
 * - 非白名单画幅被本地拒收（不发给上游换 400）；
 * - 分辨率档位按模型能力（Flash 固定 720P；非 Flash 放行 1080P/1K/2K）；
 * - 媒体上限按模型能力（Flash 参考图 ≤5、参考音频 ≤3、**不支持参考视频**）；
 * - 时长越界本地拒收（不静默夹取）。
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'

const { buildAgnesVideoRequest, pickAspectRatio, pickSeconds, VALID_ASPECT_RATIOS } = require('./agnes-video-request')

const FLASH = 'agnes-video-2.5-flash'
const FULL = 'agnes-video-2.5'

describe('buildAgnesVideoRequest — 画幅解析（行为锁）', () => {
  it('显式 aspect_ratio 优先于宽高推导', () => {
    const r = buildAgnesVideoRequest({
      params: { prompt: 'p', aspect_ratio: '9:16', width: 1920, height: 1080 },
      model: FLASH,
    })
    expect(r.error).toBeUndefined()
    expect(r.body.aspect_ratio).toBe('9:16')
  })

  it('驼峰 aspectRatio 同样被认（只认一个键名会让竖屏被静默丢弃）', () => {
    const r = buildAgnesVideoRequest({
      params: { prompt: 'p', aspectRatio: '3:4', width: 1920, height: 1080 },
      model: FLASH,
    })
    expect(r.error).toBeUndefined()
    expect(r.body.aspect_ratio).toBe('3:4')
  })

  it('两个显式键都没有时按宽高推导到最近的合法画幅', () => {
    const r = buildAgnesVideoRequest({
      params: { prompt: 'p', width: 720, height: 1280 },
      model: FLASH,
    })
    expect(r.error).toBeUndefined()
    expect(r.body.aspect_ratio).toBe('9:16')
  })

  it('宽高也没有时回落 16:9', () => {
    const r = buildAgnesVideoRequest({ params: { prompt: 'p' }, model: FLASH })
    expect(r.body.aspect_ratio).toBe('16:9')
  })

  it('非白名单画幅被本地拒收（不发出去换一次 400）', () => {
    const r = buildAgnesVideoRequest({ params: { prompt: 'p', aspect_ratio: 'auto' }, model: FLASH })
    expect(r.error).toMatch(/aspect_ratio must be one of/)
    expect(r.body).toBeUndefined()
  })

  it('pickAspectRatio 推导结果必在合法画幅集合内', () => {
    for (const [w, h] of [[1920, 1080], [720, 1280], [1024, 1024], [1680, 720], [960, 720], [720, 960]]) {
      expect(VALID_ASPECT_RATIOS).toContain(pickAspectRatio(w, h))
    }
  })
})

describe('buildAgnesVideoRequest — 分辨率档位与时长', () => {
  it('Flash 固定 720P（不显式指定时）', () => {
    const r = buildAgnesVideoRequest({ params: { prompt: 'p' }, model: FLASH })
    expect(r.body.size).toBe('720P')
  })

  it('非 Flash 允许 1080P', () => {
    const r = buildAgnesVideoRequest({ params: { prompt: 'p', size: '1080P' }, model: FULL })
    expect(r.body.size).toBe('1080P')
  })

  it('Flash 显式要 1080P 被本地拒收', () => {
    const r = buildAgnesVideoRequest({ params: { prompt: 'p', size: '1080P' }, model: FLASH })
    expect(r.error).toMatch(/size must be one of/)
  })

  it('时长越界被本地拒收（不静默夹取）', () => {
    const r = buildAgnesVideoRequest({ params: { prompt: 'p', seconds: 20 }, model: FLASH })
    expect(r.error).toMatch(/seconds must be between 4 and 12/)
  })

  it('时长缺省时按帧数推导并夹在 4–12', () => {
    expect(pickSeconds(121, 24)).toBe('5')
    expect(pickSeconds(48, 24)).toBe('4')
    expect(pickSeconds(9999, 24)).toBe('12')
  })
})

describe('buildAgnesVideoRequest — 媒体上限按模型能力', () => {
  it('Flash 参考图 ≤5，超出被拒', () => {
    const images = Array.from({ length: 6 }, (_, i) => `https://x/${i}.png`)
    const r = buildAgnesVideoRequest({ params: { prompt: 'p', mode: 'reference', images }, model: FLASH })
    expect(r.error).toMatch(/images length must not exceed 5/)
  })

  it('非 Flash 参考图 ≤8', () => {
    const images = Array.from({ length: 9 }, (_, i) => `https://x/${i}.png`)
    const r = buildAgnesVideoRequest({ params: { prompt: 'p', mode: 'reference', images }, model: FULL })
    expect(r.error).toMatch(/images length must not exceed 8/)
  })

  it('Flash 不支持参考视频（服务端会 400，本地先拒）', () => {
    const r = buildAgnesVideoRequest({
      params: { prompt: 'p', mode: 'reference', videos: [{ url: 'https://x/a.mp4' }] },
      model: FLASH,
    })
    expect(r.error).toMatch(/videos is not supported/)
  })

  it('非 Flash 支持参考视频并原样透传', () => {
    const videos = [{ url: 'https://x/a.mp4', start_seconds: 0, require_audio: false }]
    const r = buildAgnesVideoRequest({ params: { prompt: 'p', mode: 'reference', videos }, model: FULL })
    expect(r.error).toBeUndefined()
    expect(r.body.videos).toEqual(videos)
  })

  it('seed=0 是合法值（不被静默丢弃）', () => {
    const r = buildAgnesVideoRequest({ params: { prompt: 'p', seed: 0 }, model: FLASH })
    expect(r.body.seed).toBe(0)
  })
})

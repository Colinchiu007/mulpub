'use strict'

/**
 * podcast-episode-source 行为合同（刀 3 第 1–2 步）
 *
 * 这里锁的是"什么情况下不许出期"，不是"能不能抽出音频"：
 * - 降级判据**只认布尔 true**：字符串 'true' 不算降级（那是展示端也不会告警的形态），
 *   而 `source` 里带 placeholder 字样但 degraded 缺席的**不得**被拦——按字符串猜会把
 *   好稿子拦下、把坏稿子放行，两侧都要有用例钉住。
 * - 编码器缺失必须 fail closed，不得退到 pcm/WAV（体积 10 倍量级，等于给用户发一份
 *   让订阅端抓取超时的 feed）。
 * - 时长必须实测；拿不到有效数值时输出**空串**而不是 '00:00'/'NaN'——
 *   `length="NaN"` 一旦进 feed 就是永久污染（订阅端会缓存坏值）。
 */
import { describe, it, expect } from 'vitest'

import {
  PODCAST_EPISODE_ERRORS,
  readDegradedFlags,
  planAudioCodec,
  buildMixArgs,
  buildProbeArgs,
  parseProbeOutput,
  formatDuration,
} from './podcast-episode-source'

describe('readDegradedFlags：与 ResultView 同源同判据', () => {
  it('audioMeta.degraded === true 才算静音占位旁白，并带上段 id 供界面指名', () => {
    const r = readDegradedFlags({
      segments: [
        { id: 'seg-1', audioMeta: { degraded: true, source: 'tts:elevenlabs' } },
        { id: 'seg-2', audioMeta: { degraded: false } },
      ],
    })
    expect(r.silentNarration).toBe(true)
    expect(r.silentNarrationSegmentIds).toEqual(['seg-1'])
  })

  it('字符串 "true" 不算降级（否则与展示端告警不一致）', () => {
    const r = readDegradedFlags({ segments: [{ id: 's', audioMeta: { degraded: 'true' } }] })
    expect(r.silentNarration).toBe(false)
    expect(r.silentNarrationSegmentIds).toEqual([])
  })

  it('禁止拿 source 字符串当第二判据：source 像占位但 degraded 缺席 ⇒ 不拦', () => {
    const r = readDegradedFlags({
      segments: [{ id: 's', audioMeta: { source: 'placeholder_silent', provider: 'builtin' } }],
    })
    expect(r.silentNarration).toBe(false)
  })

  it('图片占位与音频占位是两类，不得混成一个布尔（处置方向不同）', () => {
    const r = readDegradedFlags({
      segments: [{ id: 's', imageMeta: { degraded: true } }],
    })
    expect(r.placeholderImage).toBe(true)
    expect(r.silentNarration).toBe(false)
  })

  it('segments 缺席/畸形不得抛错（读侧宽容，写侧才严格）', () => {
    expect(readDegradedFlags(null).silentNarration).toBe(false)
    expect(readDegradedFlags({ segments: [null, 'x', {}] }).segmentCount).toBe(3)
  })
})

describe('planAudioCodec：编码方案只从实测编码器列表推导', () => {
  const mp3List = 'audio encoders:\n  libmp3lame      libavcodec mp3\n  aac               Native AAC encoder'
  const aacOnly = 'audio encoders:\n  aac               Native AAC encoder'
  const none = 'audio encoders:\n  some_unknown      x'

  it('有 libmp3lame 时优先 mp3（聚合端兼容面最宽）', () => {
    const p = planAudioCodec(mp3List)
    expect(p.codec).toBe('libmp3lame')
    expect(p.ext).toBe('.mp3')
    expect(p.mime).toBe('audio/mpeg')
  })

  it('无 mp3 但有原生 aac ⇒ m4a + faststart', () => {
    const p = planAudioCodec(aacOnly)
    expect(p.codec).toBe('aac')
    expect(p.ext).toBe('.m4a')
    expect(p.args).toContain('-movflags')
  })

  it('两者都没有 ⇒ null，绝不退 pcm/WAV（体积 10 倍量级不是兜底而是新的死法）', () => {
    expect(planAudioCodec(none)).toBeNull()
    expect(planAudioCodec('')).toBeNull()
    const e = expect(() => buildMixArgs(null, '/a.mp4', '/b.mp3'))
    e.toThrow(PODCAST_EPISODE_ERRORS.ENCODER_UNAVAILABLE)
  })

  it('抽取命令必须是「只取混音」：-vn + map 0:a:0 + 单声道 44.1k，且不得出现旁白输入', () => {
    const args = buildMixArgs(planAudioCodec(mp3List), '/out/scene.mp4', '/tmp/e1.mp3')
    expect(args.slice(0, 4)).toEqual(['-hide_banner', '-loglevel', 'error', '-y'])
    expect(args).toContain('-vn')
    expect(args).toContain('0:a:0')
    expect(args.filter((a) => /narration|旁白/.test(String(a)))).toEqual([])
    expect(args[args.length - 1]).toBe('/tmp/e1.mp3')
  })

  it('ffprobe 命令必须同时索取 duration 与 size（缺一即无法做三处一致校验）', () => {
    const args = buildProbeArgs('/bin/ffprobe', '/tmp/e1.mp3')
    const joined = args.join(' ')
    expect(joined).toContain('format=duration,size')
    expect(joined).toContain('stream=codec_type,codec_name')
  })
})

describe('parseProbeOutput / formatDuration：实测值才可用', () => {
  const real = [
    'codec_name=mov',
    'codec_type=video',
    'codec_name=libmp3lame',
    'codec_type=audio',
    '[PROGRAM]',
    'duration=19.000000',
    'size=312489',
    '[/PROGRAM]',
  ].join('\n')

  it('解析出时长、字节与音频轨存在性', () => {
    const r = parseProbeOutput(real)
    expect(r).toEqual({ durationSec: 19, sizeBytes: 312489, codecName: 'mov', hasAudio: true })
  })

  it('无 duration 或为 0 ⇒ durationSec 为 null（不得凭空补 0）', () => {
    expect(parseProbeOutput('size=100').durationSec).toBeNull()
    expect(parseProbeOutput('duration=N/A\nsize=100').durationSec).toBeNull()
    expect(parseProbeOutput('duration=0\nsize=100').durationSec).toBeNull()
  })

  it('没有音频轨时如实报 hasAudio:false（上层据此 fail closed）', () => {
    expect(parseProbeOutput('codec_type=video\nduration=12\nsize=9').hasAudio).toBe(false)
  })

  it('时长格式按「有小时带小时，否则 mm:ss」精确断言，NaN 一律不产出字符串', () => {
    expect(formatDuration(19)).toBe('00:19')
    expect(formatDuration(380)).toBe('06:20')
    expect(formatDuration(3800)).toBe('1:03:20')
    expect(formatDuration(NaN)).toBe('')
    expect(formatDuration(0)).toBe('')
    expect(formatDuration('19')).toBe('00:19')
  })
})

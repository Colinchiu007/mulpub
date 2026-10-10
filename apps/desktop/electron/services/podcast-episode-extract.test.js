'use strict'

/**
 * podcast-episode-extract 行为合同（刀 3 步骤 2–3）
 *
 * 锁的是"什么时候不许出期"和"出的这一期数字是不是实测的"：
 * - 降级旁白必须在**任何宿主访问之前**被拦下（连 spawn 都不该发生）；
 * - 编码器缺失 fail closed，不退 pcm/WAV；
 * - ffmpeg 退出码非 0、报成功却没文件、probe 拿不到 duration、stat≠ffprobe、
 *   上传返回字节≠本地实测 ⇒ 五类各自独立的拒绝，压成一句"抽取失败"就失去了排查方向；
 * - 超时必须有硬上限、必须调用 killImpl，且迟到的 resolve 不得变成 unhandledRejection。
 *
 * 夹具用 os.tmpdir() 下带 PID+随机后缀的独立目录（文件系统测试隔离），
 * spawn 一律假实现：单测里不起真进程、不出站。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  PODCAST_EPISODE_ERRORS,
  EXTRACT_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  assertUploadSizeMatches,
  extractEpisodeAudio,
  runWithTimeout,
} from './podcast-episode-extract'

const CODECS_MP3 = 'Codecs:\n  V..... h264           H.264\n  A....L libmp3lame     MP3 (mp3float)\n  A....D aac           AAC (Advanced Audio Coding)'
const CODECS_NO_AUDIO = 'Codecs:\n  V..... h264           H.264'
const PROBE_OK = 'codec_name=mov\ncodec_type=video\ncodec_name=libmp3lame\ncodec_type=audio\nduration=37.500000\nsize=600123'

let dir = ''
let video = ''

function okSpawn (bytes = 'audio-bytes-600123-pad'.repeat(25)) {
  const calls = []
  return {
    calls,
    impl: async ({ command, args }) => {
      calls.push({ command, args })
      if (args.includes('-codecs')) return { code: 0, stdout: CODECS_MP3, stderr: '' }
      if (command.includes('ffprobe')) return { code: 0, stdout: PROBE_OK, stderr: '' }
      // mix：真的把文件写出来，尺寸必须与 PROBE_OK 的 size 一致才算自洽
      const out = args[args.length - 1]
      const body = String(bytes).slice(0, 600123).padEnd(600123, 'x')
      fs.writeFileSync(out, body)
      return { code: 0, stdout: '', stderr: '' }
    },
  }
}

beforeEach(() => {
  dir = path.join(os.tmpdir(), 'mp-pod-extract-' + process.pid + '-' + Math.random().toString(36).slice(2, 10))
  fs.mkdirSync(dir, { recursive: true })
  video = path.join(dir, 'scene.mp4')
  fs.writeFileSync(video, 'fake-mp4')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const base = (over = {}) => Object.assign({
  project: { segments: [{ id: 's1', audioMeta: { degraded: false } }] },
  videoPath: video,
  outBase: path.join(dir, 'ep-1'),
  ffmpegPath: '/packaged/ffmpeg',
  ffprobePath: '/packaged/ffprobe',
  spawnImpl: okSpawn().impl,
}, over)

describe('extractEpisodeAudio 拒绝顺序', () => {
  it('静音占位旁白 ⇒ 在任何 spawn 与 stat 之前拒绝，并带段 id', async () => {
    const spawn = okSpawn()
    const p = base({
      spawnImpl: spawn.impl,
      project: { segments: [{ id: 'a', audioMeta: { degraded: true } }, { id: 'b', audioMeta: { degraded: true } }] },
      videoPath: path.join(dir, '不存在的.mp4'),
    })
    await expect(extractEpisodeAudio(p)).rejects.toMatchObject({
      code: PODCAST_EPISODE_ERRORS.DEGRADED_SOURCE,
      segmentIds: ['a', 'b'],
    })
    expect(spawn.calls).toEqual([])
  })

  it('成片文件不存在 ⇒ NO_COMPOSE_OUTPUT，一次 spawn 都不发出', async () => {
    const spawn = okSpawn()
    await expect(extractEpisodeAudio(base({ videoPath: path.join(dir, 'nope.mp4'), spawnImpl: spawn.impl })))
      .rejects.toMatchObject({ code: PODCAST_EPISODE_ERRORS.NO_COMPOSE_OUTPUT })
    expect(spawn.calls).toHaveLength(0)
  })

  it('未注入 spawnImpl / 未解析宿主路径 ⇒ 立刻拒绝（不得默默用系统 PATH 或起真进程）', async () => {
    await expect(extractEpisodeAudio(base({ spawnImpl: undefined })))
      .rejects.toMatchObject({ code: PODCAST_EPISODE_ERRORS.EXTRACT_FAILED })
    await expect(extractEpisodeAudio(base({ ffmpegPath: '' })))
      .rejects.toMatchObject({ code: PODCAST_EPISODE_ERRORS.EXTRACT_FAILED })
  })

  it('打包 ffmpeg 没有 mp3/aac 编码器 ⇒ ENCODER_UNAVAILABLE，且不发起抽取', async () => {
    const calls = []
    const spawnImpl = async ({ command, args }) => {
      calls.push(args[1])
      if (args.includes('-codecs')) return { code: 0, stdout: CODECS_NO_AUDIO, stderr: '' }
      return { code: 0, stdout: PROBE_OK, stderr: '' }
    }
    await expect(extractEpisodeAudio(base({ spawnImpl })))
      .rejects.toMatchObject({ code: PODCAST_EPISODE_ERRORS.ENCODER_UNAVAILABLE })
    expect(calls).toEqual(['-codecs'])
  })
})

describe('extractEpisodeAudio 成功形状', () => {
  it('扩展名由实测编码方案补，数字全部来自实测', async () => {
    const r = await extractEpisodeAudio(base())
    expect(r.outPath).toBe(path.join(dir, 'ep-1') + '.mp3')
    expect(r.mime).toBe('audio/mpeg')
    expect(r.durationText).toBe('00:37')
    expect(r.durationSec).toBe(37.5)
    expect(r.sizeBytes).toBe(600123)
    expect(fs.existsSync(r.outPath)).toBe(true)
  })

  it('抽取命令是「只取混音」：-vn 且 map 0:a:0，输出名由方案补扩展名', async () => {
    const spawn = okSpawn()
    await extractEpisodeAudio(base({ spawnImpl: spawn.impl }))
    const mix = spawn.calls.find((c) => c.args.includes('-vn'))
    expect(mix.args).toContain('0:a:0')
    expect(mix.args[mix.args.length - 1]).toMatch(/ep-1\.mp3$/)
  })
})

describe('extractEpisodeAudio 失败形状各归其码', () => {
  it('ffmpeg 非 0 退出 ⇒ EXTRACT_FAILED 带退出码与 stderr 尾巴', async () => {
    const spawnImpl = async ({ args }) => {
      if (args.includes('-codecs')) return { code: 0, stdout: CODECS_MP3, stderr: '' }
      return { code: 234, stdout: '', stderr: 'x Invalid argument / ' + 'z'.repeat(400) }
    }
    const e = await extractEpisodeAudio(base({ spawnImpl })).catch((x) => x)
    expect(e.code).toBe(PODCAST_EPISODE_ERRORS.EXTRACT_FAILED)
    expect(e.message).toContain('234')
    expect(e.stderr.length).toBeLessThanOrEqual(240)
  })

  it('ffmpeg 报成功但没写出文件 ⇒ EXTRACT_FAILED，不得拿半份东西去实测', async () => {
    const spawnImpl = async ({ args }) => {
      if (args.includes('-codecs')) return { code: 0, stdout: CODECS_MP3, stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
    await expect(extractEpisodeAudio(base({ spawnImpl })))
      .rejects.toMatchObject({ code: PODCAST_EPISODE_ERRORS.EXTRACT_FAILED })
  })

  it('probe 拿不到 duration ⇒ MEASURE_FAILED（禁止用分段求和或申报值补）', async () => {
    const spawnImpl = async ({ command, args }) => {
      if (args.includes('-codecs')) return { code: 0, stdout: CODECS_MP3, stderr: '' }
      if (command.includes('ffprobe')) return { code: 0, stdout: 'size=100', stderr: '' }
      const out = args[args.length - 1]
      fs.writeFileSync(out, 'x'.repeat(100))
      return { code: 0, stdout: '', stderr: '' }
    }
    await expect(extractEpisodeAudio(base({ spawnImpl })))
      .rejects.toMatchObject({ code: PODCAST_EPISODE_ERRORS.MEASURE_FAILED })
  })

  it('stat 与 ffprobe 字节不符 ⇒ SIZE_MISMATCH（写完后被人改过就是不能发）', async () => {
    const spawnImpl = async ({ command, args }) => {
      if (args.includes('-codecs')) return { code: 0, stdout: CODECS_MP3, stderr: '' }
      if (command.includes('ffprobe')) return { code: 0, stdout: 'codec_type=audio\nduration=10\nsize=999999', stderr: '' }
      const out = args[args.length - 1]
      fs.writeFileSync(out, 'x'.repeat(100))
      return { code: 0, stdout: '', stderr: '' }
    }
    const e = await extractEpisodeAudio(base({ spawnImpl })).catch((x) => x)
    expect(e.code).toBe(PODCAST_EPISODE_ERRORS.SIZE_MISMATCH)
    expect(e.statSize).toBe(100)
    expect(e.probeSize).toBe(999999)
  })
})

describe('assertUploadSizeMatches 与超时预算', () => {
  it('三处一致的最后一环：上传返回字节必须等于本地实测，否则不许进 feed', () => {
    expect(assertUploadSizeMatches(1000, 1000)).toBe(true)
    expect(() => assertUploadSizeMatches(1000, 999)).toThrow(/SIZE_MISMATCH/)
    expect(() => assertUploadSizeMatches(1000, undefined)).toThrow(/SIZE_MISMATCH/)
    expect(() => assertUploadSizeMatches('NaN', 10)).toThrow(/SIZE_MISMATCH/)
  })

  it('超时 ⇒ 有上限、调用 killImpl、且迟到的 resolve 不产生 unhandledRejection', async () => {
    const kill = vi.fn()
    let releaseLate
    const run = () => new Promise((resolve) => { releaseLate = resolve })
    const p = runWithTimeout(run, { timeoutMs: 20, label: 'ffmpeg 抽混音', kill })
    await expect(p).rejects.toMatchObject({ code: PODCAST_EPISODE_ERRORS.EXTRACT_FAILED, timedOut: true })
    expect(kill).toHaveBeenCalledTimes(1)
    expect(() => releaseLate({ code: 0 })).not.toThrow()
    const unh = []
    const onRej = (r) => unh.push(r)
    process.on('unhandledRejection', onRej)
    await new Promise((r) => setTimeout(r, 40))
    process.off('unhandledRejection', onRej)
    expect(unh).toEqual([])
  })

  it('超时预算必须是正有限数（env 非法值回落默认，不得让预算变成 0/NaN 而永不超时）', async () => {
    expect(Number.isFinite(EXTRACT_TIMEOUT_MS) && EXTRACT_TIMEOUT_MS > 0).toBe(true)
    expect(Number.isFinite(PROBE_TIMEOUT_MS) && PROBE_TIMEOUT_MS > 0).toBe(true)
    const r = await extractEpisodeAudio(base({ extractTimeoutMs: 5000, probeTimeoutMs: 5000 }))
    expect(r.durationSec).toBe(37.5)
  })
})

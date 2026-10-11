/**
 * 刀 3 第 3 片新增收口的行为锁（后端评审 F1 / F2 / F4 / F5 / F7 各一条，不装饰）
 *
 * 夹具一律**只假宿主**（spawnImpl / uploadImpl / sink），一致校验与退出码判据走真实实现：
 * 本仓踩过「夹具替对方剥壳 → 断链在全绿下躺一整轮」，所以宁可多接两行真实现。
 */
import { describe, it, expect, vi } from 'vitest'
import os from 'os'
import path from 'path'
import { createEpisodePublisher } from './podcast-episode-publish'
import { assertUploadSizeMatches, extractEpisodeAudio } from './podcast-episode-extract'

const TMP_AUDIO = path.join(os.tmpdir(), 'mp-ep-guard.mp3')
const MIXED = { durationSec: 42, sizeBytes: 1000, mime: 'audio/mpeg', outPath: TMP_AUDIO }
const okUpload = () => ({ url: 'https://cdn.example.com/a/b.mp3', size: 1000 })
const fsStub = (calls) => ({ existsSync: () => true, unlinkSync: (p) => calls.push(p) })

function mk (over = {}) {
  return Object.assign({
    extractEpisodeAudio: async () => Object.assign({}, MIXED),
    assertUploadSizeMatches,
    uploadImpl: async () => okUpload(),
    episodeSink: async () => ({ id: 'ep_1' }),
    feedSink: async () => ({ path: path.join(os.tmpdir(), 'mp-ep-feed.xml'), itemCount: 1 }),
  }, over)
}

describe('播客出期编排 · 中间态收口（评审 F1/F4/F5/F7）', () => {
  it('F5：五个实现缺任何一个都构造失败（三处一致校验不得被恒真 stub 静默绕过）', () => {
    for (const key of ['extractEpisodeAudio', 'uploadImpl', 'episodeSink', 'feedSink', 'assertUploadSizeMatches']) {
      const deps = mk()
      delete deps[key]
      expect(() => createEpisodePublisher(deps)).toThrow(/PODCAST_EPISODE_INVALID/)
    }
  })

  it('F1：挂期失败必须清临时文件、补领域码并带相位（不得留下无人收尾的中间态）', async () => {
    const unlinked = []
    const p = createEpisodePublisher(mk({
      episodeSink: async () => { throw new Error('磁盘满') },
    }))
    await expect(p.publish({ channelId: 'ch_a', title: '一期', fsImpl: fsStub(unlinked) }))
      .rejects.toMatchObject({ code: 'PODCAST_EPISODE_INVALID', publishPhases: expect.any(Array) })
    expect(unlinked).toEqual([TMP_AUDIO])
  })

  it('F1：底层已带领域码时不得被覆写成别的码（覆写会让渲染层取错文案）', async () => {
    const p = createEpisodePublisher(mk({
      episodeSink: async () => { const e = new Error('x'); e.code = 'PODCAST_EPISODES_FULL'; throw e },
    }))
    await expect(p.publish({ channelId: 'ch_a', fsImpl: fsStub([]) }))
      .rejects.toMatchObject({ code: 'PODCAST_EPISODES_FULL' })
  })

  it('F4：feedSink 形状缺 path 时是一句可读失败而不是同步 TypeError', async () => {
    const p = createEpisodePublisher(mk({ feedSink: async () => ({ itemCount: 3 }) }))
    await expect(p.publish({ channelId: 'ch_a', fsImpl: fsStub([]) }))
      .rejects.toMatchObject({ code: 'PODCAST_FEED_BUILD_FAILED', episodeId: 'ep_1' })
  })

  it('F4：partial 必须带上底层失败原因（上层要能区分被拒绝与暂时失败）', async () => {
    const p = createEpisodePublisher(mk({
      uploadImpl: async (o) => {
        if (o && o.kind === 'feed') throw Object.assign(new Error('403'), { code: 'PODCAST_HOSTING_UPLOAD_FAILED', status: 403 })
        return okUpload()
      },
    }))
    const r = await p.publish({ channelId: 'ch_a', fsImpl: fsStub([]) })
    expect(r.state).toBe('partial')
    expect(r.errorCode).toBe('PODCAST_HOSTING_UPLOAD_FAILED')
    expect(r.errorMessage).toBe('403')
    expect(r.feedUrl).toBe('')
  })

  it('F7：feed 回 http 明文地址不得进 success（与音频侧同一 https 判据）', async () => {
    const p = createEpisodePublisher(mk({
      uploadImpl: async (o) => (o && o.kind === 'feed'
        ? { url: 'http://cdn.example.com/feed.xml', size: 10 }
        : okUpload()),
    }))
    const r = await p.publish({ channelId: 'ch_a', fsImpl: fsStub([]) })
    expect(r.state).toBe('partial')
    expect(r.errorCode).toBe('PODCAST_HOSTING_UPLOAD_FAILED')
  })

  it('F7：两次上传的 kind 必须可分（音频显式标 audio，feed 标 feed）', async () => {
    const seen = []
    const p = createEpisodePublisher(mk({
      uploadImpl: async (o) => {
        seen.push(o.kind)
        return o.kind === 'feed' ? { url: 'https://x/feed.xml', size: 1 } : okUpload()
      },
    }))
    await p.publish({ channelId: 'ch_a', fsImpl: fsStub([]) })
    expect(seen).toEqual(['audio', 'feed'])
  })

  it('success 仍要求三处一致：putObject 回来的字节不等于实测就不挂这一期', async () => {
    const p = createEpisodePublisher(mk({
      uploadImpl: async (o) => (o && o.kind === 'audio'
        ? { url: 'https://x/a.mp3', size: 999 }
        : { url: 'https://x/feed.xml', size: 1 }),
    }))
    await expect(p.publish({ channelId: 'ch_a', fsImpl: fsStub([]) }))
      .rejects.toMatchObject({ code: 'PODCAST_AUDIO_SIZE_MISMATCH' })
  })
})

describe('播客混音抽取 · 宿主退出码不再被丢（评审 F2）', () => {
  const base = {
    videoPath: 'x.mp4',
    outBase: path.join(os.tmpdir(), 'mp-ep-out'),
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    fsImpl: { existsSync: () => true, statSync: () => ({ size: 1000 }) },
  }

  it('ffmpeg 探测编码器就非 0 退出 ⇒ EXTRACT_FAILED 且 stage=encoders（不得错报成缺编码器）', async () => {
    const seen = []
    await expect(extractEpisodeAudio(Object.assign({}, base, {
      spawnImpl: async (o) => { seen.push(o.args.join(' ')); return { code: 1, stdout: '', stderr: 'error while loading shared libraries' } },
    }))).rejects.toMatchObject({ code: 'PODCAST_AUDIO_EXTRACT_FAILED', stage: 'encoders' })
    expect(seen.length).toBe(1)
  })

  it('ffprobe 非 0 退出 ⇒ MEASURE_FAILED（不得拿 stdout 里残留的数字当实测成功）', async () => {
    await expect(extractEpisodeAudio(Object.assign({}, base, {
      spawnImpl: async (o) => {
        if (o.probe === 'encoders') return { code: 0, stdout: ' A..... libmp3lame' }
        if (String(o.command).indexOf('ffprobe') >= 0) return { code: 3, stdout: 'duration=12 size=1000' }
        return { code: 0, stdout: '' }
      },
    }))).rejects.toMatchObject({ code: 'PODCAST_AUDIO_MEASURE_FAILED', exitCode: 3 })
  })
})

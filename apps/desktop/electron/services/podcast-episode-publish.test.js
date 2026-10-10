'use strict'

/**
 * podcast-episode-publish 逐格结果态（刀 3 结构锁⑪的配套：改相位枚举必须与这里同 PR）
 *
 * 每条都在测"这一格用户看到什么、库里留下什么、磁盘上少了什么"，
 * 而不是"函数被调用过"——后者对着错实现也会绿。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  createEpisodePublisher, PHASES, EPISODE_PUBLISH_ERRORS,
} from './podcast-episode-publish'
import { assertUploadSizeMatches } from './podcast-episode-extract'

let dir = ''
let tmpAudio = ''
let realFs = null

beforeEach(() => {
  dir = path.join(os.tmpdir(), 'mp-pod-pub-' + process.pid + '-' + Math.random().toString(36).slice(2, 9))
  fs.mkdirSync(dir, { recursive: true })
  tmpAudio = path.join(dir, 'ep-1.mp3')
  fs.writeFileSync(tmpAudio, 'x'.repeat(1000))
  realFs = fs
})

afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

const mixed = () => ({ outPath: tmpAudio, mime: 'audio/mpeg', codec: 'libmp3lame', durationSec: 37.5, durationText: '00:37', sizeBytes: 1000 })

function mk (over = {}) {
  const calls = { upload: [], episode: [], feed: [] }
  const publisher = createEpisodePublisher({
    extractEpisodeAudio: async () => mixed(),
    assertUploadSizeMatches,
    uploadImpl: async (a) => { calls.upload.push(a); return { url: 'https://cdn.example.com/podcast/ch_a0000001/ep-1.mp3', size: 1000 } },
    episodeSink: async (ch, ep) => { calls.episode.push([ch, ep]); return { id: 'ep-1' } },
    feedSink: async (ch) => { calls.feed.push(ch); return { path: path.join(dir, 'feed.xml'), itemCount: 3 } },
    ...over.deps,
  })
  const input = {
    channelId: 'ch_a0000001',
    title: '第一期',
    meta: { episodeType: 'full' },
    fsImpl: over.fsImpl || fs,
    ...over.input,
  }
  return { publisher, calls, input }
}

describe('成功与形状', () => {
  it('相位顺序就是合同顺序，一个不多一个不少', async () => {
    const { publisher, input } = mk()
    const r = await publisher.publish(input)
    expect(r.phases.map((p) => p.phase)).toEqual(['pickChannel', 'extractMix', 'probe', 'uploadAudio', 'attach', 'buildFeed', 'uploadFeed'])
    expect(PHASES).toEqual(['pickChannel', 'extractMix', 'probe', 'uploadAudio', 'attach', 'buildFeed', 'uploadFeed'])
    expect(r.state).toBe('success')
  })

  it('挂进 episodes 的是**实测**时长/字节/mime，不是申报值', async () => {
    const { publisher, calls, input } = mk()
    await publisher.publish(input)
    const [ch, ep] = calls.episode[0]
    expect(ch).toBe('ch_a0000001')
    expect(ep).toMatchObject({ title: '第一期', durationSec: 37.5, sizeBytes: 1000, mime: 'audio/mpeg' })
    expect(ep.audioUrl).toMatch(/^https:\/\//)
  })

  it('成功后临时文件被回收，公网 feed 地址回传', async () => {
    const { publisher, input } = mk()
    const r = await publisher.publish(input)
    expect(r.feedUrl).toContain('https://')
    expect(fs.existsSync(tmpAudio)).toBe(false)
  })
})

describe('拒绝格：库里一行都不许多', () => {
  it('缺 channelId ⇒ 立即拒绝，一次上传与一次写库都不发生', async () => {
    const { publisher, calls } = mk({ input: { channelId: '' } })
    await expect(publisher.publish({ channelId: '  ' })).rejects.toMatchObject({ code: EPISODE_PUBLISH_ERRORS.NO_CHANNEL })
    expect(calls.upload).toEqual([])
    expect(calls.episode).toEqual([])
  })

  it('上传回来的字节与实测不符 ⇒ 不挂这一期且清理临时文件', async () => {
    const { publisher, calls, input } = mk({
      deps: { uploadImpl: async () => ({ url: 'https://cdn.example.com/a.mp3', size: 999 }) },
    })
    await expect(publisher.publish(input)).rejects.toMatchObject({ code: EPISODE_PUBLISH_ERRORS.SIZE_MISMATCH })
    expect(calls.episode).toEqual([])
    expect(fs.existsSync(tmpAudio)).toBe(false)
  })

  it('上传没给出可公网访问的 https 地址 ⇒ 不挂期（http/空串都不算成功）', async () => {
    const { publisher, calls, input } = mk({
      deps: { uploadImpl: async () => ({ url: 'http://insecure.example.com/a.mp3', size: 1000 }) },
    })
    await expect(publisher.publish(input)).rejects.toMatchObject({ code: EPISODE_PUBLISH_ERRORS.UPLOAD_FAILED })
    expect(calls.episode).toEqual([])
  })

  it('上传抛错 ⇒ 原样带出领域码，并把已走过的相位挂在错误上', async () => {
    const boom = new Error('PODCAST_HOSTING_UPLOAD_FAILED(403)')
    boom.code = 'PODCAST_HOSTING_UPLOAD_FAILED'
    const { publisher, input } = mk({ deps: { uploadImpl: async () => { throw boom } } })
    const e = await publisher.publish(input).catch((x) => x)
    expect(e.code).toBe('PODCAST_HOSTING_UPLOAD_FAILED')
    expect(e.publishPhases.map((p) => p.phase)).toContain('uploadAudio')
    expect(fs.existsSync(tmpAudio)).toBe(false)
  })
})

describe('partial 与取消：两种"不算成功"必须可区分', () => {
  it('音频已传、feed 上传失败 ⇒ state=partial，这一期保留，临时文件留着重试', async () => {
    const { publisher, input, calls } = mk({
      deps: {
        uploadImpl: async (a) => {
          calls.upload.push(a)
          if (a.kind === 'feed') throw new Error('403')
          return { url: 'https://cdn.example.com/podcast/ch_a0000001/ep-1.mp3', size: 1000 }
        },
      },
    })
    const r = await publisher.publish(input)
    expect(r.state).toBe('partial')
    expect(r.episodeId).toBe('ep-1')
    expect(r.feedUrl).toBe('')
    expect(r.message).toContain('公网 feed 尚未更新')
    expect(calls.episode).toHaveLength(1)
    expect(fs.existsSync(tmpAudio)).toBe(true)
  })

  it('uploadAudio 之前取消 ⇒ 一次上传都不发出，临时文件回滚', async () => {
    const calls = []
    const publisher = createEpisodePublisher({
      extractEpisodeAudio: async () => mixed(),
      assertUploadSizeMatches,
      uploadImpl: async () => { calls.push(1); return { url: 'https://x/y', size: 1 } },
      episodeSink: async () => ({ id: 'e' }),
      feedSink: async () => ({ path: 'feed.xml', itemCount: 1 }),
    })
    const token = { cancelled: true }
    await expect(publisher.publish({ channelId: 'ch_a0000001', cancelToken: token, fsImpl: fs })).rejects.toMatchObject({
      code: EPISODE_PUBLISH_ERRORS.CANCELLED,
    })
    expect(calls).toEqual([])
    expect(fs.existsSync(tmpAudio)).toBe(false)
  })

  it('取消窗口只到 uploadAudio 之前（之后取消会留下半态，界面须给理由而不是静默接受）', () => {
    const { publisher } = mk()
    expect(publisher.cancellableAt('pickChannel')).toBe(true)
    expect(publisher.cancellableAt('probe')).toBe(true)
    expect(publisher.cancellableAt('uploadAudio')).toBe(false)
    expect(publisher.cancellableAt('attach')).toBe(false)
    expect(publisher.cancellableAt('未知相位')).toBe(false)
  })
})

describe('装配判据', () => {
  it('四个实现缺任何一个都构造失败（禁止默认发真实出站）', () => {
    for (const key of ['extractEpisodeAudio', 'uploadImpl', 'episodeSink', 'feedSink']) {
      const base = {
        extractEpisodeAudio: async () => mixed(),
        assertUploadSizeMatches,
        uploadImpl: async () => ({ url: 'https://x', size: 1 }),
        episodeSink: async () => ({ id: 'e' }),
        feedSink: async () => ({ path: 'f', itemCount: 1 }),
      }
      delete base[key]
      expect(() => createEpisodePublisher(base), key).toThrow(/注入/)
    }
  })

  it('临时文件清理失败只出声，不掩盖主结论', async () => {
    const warns = []
    const publisher = createEpisodePublisher({
      extractEpisodeAudio: async () => mixed(),
      assertUploadSizeMatches,
      uploadImpl: async () => { const e = new Error('403'); e.code = 'PODCAST_HOSTING_UPLOAD_FAILED'; throw e },
      episodeSink: async () => ({ id: 'e' }),
      feedSink: async () => ({ path: 'f', itemCount: 1 }),
      logger: { info () {}, warn: (m) => warns.push(m), error () {} },
    })
    const hostileFs = { existsSync: () => true, unlinkSync: () => { throw new Error('EBUSY') } }
    await expect(publisher.publish({ channelId: 'ch_a0000001', fsImpl: hostileFs }))
      .rejects.toMatchObject({ code: 'PODCAST_HOSTING_UPLOAD_FAILED' })
    expect(warns.some((w) => w.includes('EBUSY'))).toBe(true)
  })
})

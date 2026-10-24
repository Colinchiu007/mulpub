import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 飞影「创作模式」端点测试（change: hifly-full-api）。
 *
 * 覆盖 6 个收费创作端点：
 *   POST /video/create_by_audio     视频创作（声音驱动）
 *   POST /video/create_by_template  视频创作（网感模板）
 *   POST /video/translate           视频翻译
 *   POST /video/create_by_sing      视频创作（唱歌）
 *   POST /video/create_by_image     视频创作（图片驱动）
 *   POST /audio/create_by_tts       音频创作
 *
 * 共同契约：全部**收费**；成功响应都带 `task_id`（音频创作也是 task，走 /video/task 查询）。
 *
 * 数据校验重点（官方逐条）：
 *  - 二选一必填：audio_url | file_id（create_by_audio）
 *  - 至少一个：avatar | video_file_id（create_by_audio / create_by_template）
 *  - text ≤ 10000 字、title ≤ 20 字
 *  - aigc_flag ∈ {0,1,2}
 *  - norm_lufs 0~100（4 个响度参数）
 *  - model ∈ {0,5,6}（图片驱动）
 */

const { HiFlyAdapter } = require('./hifly.js')
const { ERROR_CODES } = require('./_base/provider-error')

const BASE = 'https://hfw-api.hifly.cc/api/v2/hifly'
const TOKEN = 'test-token'

function createFetchResponse (body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function createFetchMock (responses = []) {
  const calls = []
  const fn = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts })
    const next = responses.shift()
    return next || createFetchResponse({ code: 0, task_id: 'task-default' })
  })
  fn.calls = calls
  return fn
}

function createAdapter () {
  return new HiFlyAdapter({ id: 'hifly', apiKey: TOKEN })
}

let originalFetch
beforeEach(() => { originalFetch = global.fetch })
afterEach(() => { global.fetch = originalFetch })

// ── 声音驱动 ────────────────────────────────────────────────────────────
describe('createVideoByAudio — 声音驱动（change: hifly-full-api）', () => {
  it('file_id + avatar 透传，返回 taskId', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, task_id: 't-audio' })])
    const r = await createAdapter().createVideoByAudio({ fileId: 'f-1', avatar: 'av-1', title: '音频驱动' })
    expect(r.taskId).toBe('t-audio')
    expect(global.fetch.calls[0].url).toBe(`${BASE}/video/create_by_audio`)
    expect(JSON.parse(global.fetch.calls[0].opts.body)).toEqual({
      file_id: 'f-1',
      avatar: 'av-1',
      title: '音频驱动',
    })
  })

  // 官方：audio_url 与 file_id 二选一必填
  it('audio_url / file_id 都不给 ⇒ INVALID_CONFIG，不发请求', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().createVideoByAudio({ avatar: 'av-1' })).rejects.toThrow(/audio/i)
    expect(m).not.toHaveBeenCalled()
  })

  // 官方：avatar 与 video_file_id 至少填一个
  it('avatar / video_file_id 都不给 ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().createVideoByAudio({ fileId: 'f-1' })).rejects.toThrow(/avatar|video_file_id/i)
    expect(m).not.toHaveBeenCalled()
  })

  it('video_start_msec 负数 ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(
      createAdapter().createVideoByAudio({ fileId: 'f', avatar: 'a', videoStartMsec: -1 }),
    ).rejects.toThrow(/videoStartMsec/)
    expect(m).not.toHaveBeenCalled()
  })

  it('title 超 20 字 ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(
      createAdapter().createVideoByAudio({ fileId: 'f', avatar: 'a', title: '一'.repeat(21) }),
    ).rejects.toThrow(/title/)
    expect(m).not.toHaveBeenCalled()
  })
})

// ── 网感模板 ────────────────────────────────────────────────────────────
describe('createVideoByTemplate — 网感模板（change: hifly-full-api）', () => {
  it('voice + text + avatar + template 透传', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, task_id: 't-tpl' })])
    const r = await createAdapter().createVideoByTemplate({
      voice: 'v-1',
      text: '今天聊三件事',
      avatar: 'av-1',
      template: 'tpl-1',
    })
    expect(r.taskId).toBe('t-tpl')
    expect(JSON.parse(global.fetch.calls[0].opts.body)).toMatchObject({
      voice: 'v-1',
      text: '今天聊三件事',
      avatar: 'av-1',
      template: 'tpl-1',
    })
  })

  it('缺 template ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(
      createAdapter().createVideoByTemplate({ voice: 'v', text: 'x', avatar: 'a' }),
    ).rejects.toThrow(/template/)
    expect(m).not.toHaveBeenCalled()
  })

  it('缺 text ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(
      createAdapter().createVideoByTemplate({ voice: 'v', avatar: 'a', template: 't' }),
    ).rejects.toThrow(/text/)
    expect(m).not.toHaveBeenCalled()
  })

  // 官方：norm_lufs 系列 0~100
  it('norm_lufs 越界（101 或负数）⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(
      createAdapter().createVideoByTemplate({
        voice: 'v', text: 'x', avatar: 'a', template: 't', normLufs: 101,
      }),
    ).rejects.toThrow(/normLufs/)
    await expect(
      createAdapter().createVideoByTemplate({
        voice: 'v', text: 'x', avatar: 'a', template: 't', bgmNormLufs: -1,
      }),
    ).rejects.toThrow(/bgmNormLufs/)
    expect(m).not.toHaveBeenCalled()
  })

  // 给了 video_file_id 时可替代 voice 与 avatar
  it('只给 video_file_id + text + template 也合法', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, task_id: 't2' })])
    const r = await createAdapter().createVideoByTemplate({
      videoFileId: 'vf-1',
      text: 'x',
      template: 'tpl',
    })
    expect(r.taskId).toBe('t2')
    expect(JSON.parse(global.fetch.calls[0].opts.body)).toMatchObject({ video_file_id: 'vf-1' })
  })

  it('既无 voice/avatar 又无 video_file_id ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(
      createAdapter().createVideoByTemplate({ text: 'x', template: 'tpl' }),
    ).rejects.toThrow(/voice|avatar|video_file_id/i)
    expect(m).not.toHaveBeenCalled()
  })
})

// ── 视频翻译 ────────────────────────────────────────────────────────────
describe('translateVideo — 视频翻译（change: hifly-full-api）', () => {
  it('video_file_id + 目标语言透传', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, task_id: 't-tr' })])
    const r = await createAdapter().translateVideo({ videoFileId: 'vf-1', targetLanguageCode: 'en' })
    expect(r.taskId).toBe('t-tr')
    expect(global.fetch.calls[0].url).toBe(`${BASE}/video/translate`)
    expect(JSON.parse(global.fetch.calls[0].opts.body)).toEqual({
      video_file_id: 'vf-1',
      target_language_code: 'en',
    })
  })

  it('缺 video_file_id ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().translateVideo({ targetLanguageCode: 'en' })).rejects.toThrow(/videoFileId/)
    expect(m).not.toHaveBeenCalled()
  })

  it('缺 target_language_code ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().translateVideo({ videoFileId: 'vf' })).rejects.toThrow(/targetLanguage/i)
    expect(m).not.toHaveBeenCalled()
  })
})

// ── 唱歌 ────────────────────────────────────────────────────────────────
describe('createVideoBySing — 唱歌（change: hifly-full-api）', () => {
  it('图片 + 音频 file_id 透传', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, task_id: 't-sing' })])
    const r = await createAdapter().createVideoBySing({ imageFileId: 'img-1', audioFileId: 'aud-1' })
    expect(r.taskId).toBe('t-sing')
    expect(JSON.parse(global.fetch.calls[0].opts.body)).toEqual({
      image_file_id: 'img-1',
      audio_file_id: 'aud-1',
    })
  })

  it('缺 image_file_id ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().createVideoBySing({ audioFileId: 'a' })).rejects.toThrow(/imageFileId/)
    expect(m).not.toHaveBeenCalled()
  })

  it('缺 audio_file_id ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().createVideoBySing({ imageFileId: 'i' })).rejects.toThrow(/audioFileId/)
    expect(m).not.toHaveBeenCalled()
  })
})

// ── 图片驱动 ────────────────────────────────────────────────────────────
describe('createVideoByImage — 图片驱动（change: hifly-full-api）', () => {
  it('image_file_id + voice + text 透传', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, task_id: 't-img' })])
    const r = await createAdapter().createVideoByImage({
      imageFileId: 'img-1', voice: 'v-1', text: '你好',
    })
    expect(r.taskId).toBe('t-img')
    expect(global.fetch.calls[0].url).toBe(`${BASE}/video/create_by_image`)
  })

  it('缺 text ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(
      createAdapter().createVideoByImage({ imageFileId: 'i', voice: 'v' }),
    ).rejects.toThrow(/text/)
    expect(m).not.toHaveBeenCalled()
  })

  // 官方 model 只允许 0 / 5 / 6
  it('model 非法（7）⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(
      createAdapter().createVideoByImage({ imageFileId: 'i', voice: 'v', text: 'x', model: 7 }),
    ).rejects.toThrow(/model/)
    expect(m).not.toHaveBeenCalled()
  })

  it('model=6（卡通）合法', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, task_id: 't6' })])
    const r = await createAdapter().createVideoByImage({
      imageFileId: 'i', voice: 'v', text: 'x', model: 6,
    })
    expect(r.taskId).toBe('t6')
    expect(JSON.parse(global.fetch.calls[0].opts.body).model).toBe(6)
  })
})

// ── 音频创作 ────────────────────────────────────────────────────────────
describe('createAudioByTts — 音频创作（change: hifly-full-api）', () => {
  it('voice + text 透传，返回 taskId', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, task_id: 't-aud' })])
    const r = await createAdapter().createAudioByTts({ voice: 'v-1', text: '旁白内容' })
    expect(r.taskId).toBe('t-aud')
    expect(global.fetch.calls[0].url).toBe(`${BASE}/audio/create_by_tts`)
  })

  it('缺 voice ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().createAudioByTts({ text: 'x' })).rejects.toThrow(/voice/)
    expect(m).not.toHaveBeenCalled()
  })

  // 官方：text ≤ 10000 字
  it('text 超 10000 字 ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(
      createAdapter().createAudioByTts({ voice: 'v', text: '一'.repeat(10001) }),
    ).rejects.toThrow(/text/)
    expect(m).not.toHaveBeenCalled()
  })

  it('aigc_flag 非法（3）⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(
      createAdapter().createAudioByTts({ voice: 'v', text: 'x', aigcFlag: 3 }),
    ).rejects.toThrow(/aigcFlag/)
    expect(m).not.toHaveBeenCalled()
  })
})

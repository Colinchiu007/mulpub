// @ts-check
/**
 * hifly.test.js — 飞影 HiFly 数字人 Adapter 测试（change: digital-human-multiprovider）
 *
 * 与 heygen.js 的关系：**同名同参**（digital-human-stages.js 已按
 * `{character, voice, script}` 调用，adapter 内部做字段映射）。
 * 差异全在飞影侧的 API 形态上，本测试锁定这些差异不被「照抄 heygen」抹平：
 *
 *  1. 认证头是 `Authorization: Bearer`（HeyGen 是 X-Api-Key）
 *  2. 视频生成字段是**扁平** `{avatar, voice, text}`（HeyGen 是 video_inputs 对象）
 *  3. 状态查询是 `GET /video/task?task_id=`（HeyGen 是 /v1/video_status.get）
 *  4. 形象/音色列表带 **page/size/kind 分页**（HeyGen 全量），adapter 内消化
 *  5. 业务错误走 **HTTP 200 + body code**（HeyGen 也是，但 code 语义不同）
 *
 * ⚠ 端点与字段来自官方文档摘录 + 官方 skill 常量 + Apifox 镜像，
 *   **未经真实 Token 核对**（tasks.md T10）。测试按这些事实写，
 *   首跑核对后如需修正，改这里而不是改实现迁就测试。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

__registerMock('../logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() })

const { HiFlyAdapter } = require('./hifly')
const { ProviderError, ERROR_CODES } = require('./_base/provider-error')

const BASE = 'https://hfw-api.hifly.cc/api/v2/hifly'

function createFetchResponse (body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    async json() { return body },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
    body: null,
  }
}

function createFetchMock (responses = []) {
  const calls = []
  const mock = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts })
    return responses.shift() || createFetchResponse({})
  })
  mock.calls = calls
  return mock
}

function createAdapter (extra = {}) {
  return new HiFlyAdapter({ id: 'hifly', apiKey: 'hf-key', baseUrl: BASE, ...extra })
}

function bodyOf (call) {
  return JSON.parse(call.opts.body)
}

describe('HiFlyAdapter — 飞影数字人', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch; vi.clearAllMocks() })

  describe('构造与配置', () => {
    it('默认 baseUrl 指向飞影官方 API', () => {
      const adapter = new HiFlyAdapter({ id: 'hifly', apiKey: 'k' })
      expect(adapter.credentials.baseUrl).toBe(BASE)
    })

    it('缺 apiKey 时 validateConfig invalid', () => {
      expect(createAdapter({ apiKey: '' }).validateConfig().valid).toBe(false)
    })
  })

  describe('认证头（与 HeyGen 的关键差异）', () => {
    it('发 Authorization: Bearer，不发 X-Api-Key', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ code: 0, data: { avatars: [] } })])
      global.fetch = fetchMock
      await createAdapter().listAvatars()
      expect(fetchMock.calls[0].opts.headers['Authorization']).toBe('Bearer hf-key')
      expect(fetchMock.calls[0].opts.headers['X-Api-Key']).toBeUndefined()
    })
  })

  describe('generateVideo — 扁平字段映射', () => {
    it('把 {character, voice, script} 映射为官方扁平 {avatar, voice, text}', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ code: 0, data: { task_id: 'task-1' } })])
      global.fetch = fetchMock

      const result = await createAdapter().generateVideo({
        character: 'av_abc', voice: 'voice_abc', script: '这是口播文案',
      })

      expect(result.taskId).toBe('task-1')
      expect(fetchMock.calls[0].url).toBe(`${BASE}/video/create_by_tts`)
      expect(fetchMock.calls[0].opts.method).toBe('POST')
      const body = bodyOf(fetchMock.calls[0])
      expect(body).toMatchObject({ avatar: 'av_abc', voice: 'voice_abc', text: '这是口播文案' })
      // 不得残留 HeyGen 的对象形状
      expect(body.video_inputs).toBeUndefined()
    })

    it('title 可选透传，缺省不发', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ code: 0, data: { task_id: 't' } })])
      global.fetch = fetchMock
      await createAdapter().generateVideo({ character: 'a', voice: 'v', script: 's' })
      expect(bodyOf(fetchMock.calls[0]).title).toBeUndefined()

      const fetchMock2 = createFetchMock([createFetchResponse({ code: 0, data: { task_id: 't' } })])
      global.fetch = fetchMock2
      await createAdapter().generateVideo({ character: 'a', voice: 'v', script: 's', title: '标题' })
      expect(bodyOf(fetchMock2.calls[0]).title).toBe('标题')
    })

    it('三要素任一缺失抛 INVALID_CONFIG，且不发起请求', async () => {
      const fetchMock = createFetchMock()
      global.fetch = fetchMock
      await expect(createAdapter().generateVideo({ voice: 'v', script: 's' })).rejects.toThrow(/character/i)
      await expect(createAdapter().generateVideo({ character: 'c', script: 's' })).rejects.toThrow(/voice/i)
      await expect(createAdapter().generateVideo({ character: 'c', voice: 'v' })).rejects.toThrow(/script/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('响应缺 task_id → PROVIDER_ERROR（字段名点出来）', async () => {
      global.fetch = createFetchMock([createFetchResponse({ code: 0, data: {} })])
      try {
        await createAdapter().generateVideo({ character: 'a', voice: 'v', script: 's' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
      }
    })

    // ── change: hifly-voice-subtitle-parity：字幕参数透传 ──────────────
    // 飞影官方 create_by_tts 支持 9 个字幕字段；不传则默认不显示字幕。

    it('subtitle 缺省 ⇒ 请求体不含任何 st_* 字段（保持官方「默认不显示」）', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ code: 0, task_id: 't' })])
      global.fetch = fetchMock
      await createAdapter().generateVideo({ character: 'a', voice: 'v', script: 's' })
      const body = bodyOf(fetchMock.calls[0])
      expect(Object.keys(body).filter((k) => k.startsWith('st_'))).toEqual([])
    })

    it('subtitle.show=true ⇒ st_show=1，其余字幕字段一并透传', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ code: 0, task_id: 't' })])
      global.fetch = fetchMock
      await createAdapter().generateVideo({
        character: 'a', voice: 'v', script: 's',
        subtitle: {
          show: true, fontName: '抖音美好体', fontSize: 120,
          primaryColor: '#ff0000', outlineColor: '#000000',
          width: 640, height: 120, posX: 80, posY: 960,
        },
      })
      expect(bodyOf(fetchMock.calls[0])).toMatchObject({
        st_show: 1,
        st_font_name: '抖音美好体',
        st_font_size: 120,
        st_primary_color: '#ff0000',
        st_outline_color: '#000000',
        st_width: 640,
        st_height: 120,
        st_pos_x: 80,
        st_pos_y: 960,
      })
    })

    it('subtitle.show=false ⇒ st_show=0（显式关闭，不依赖官方默认）', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ code: 0, task_id: 't' })])
      global.fetch = fetchMock
      await createAdapter().generateVideo({ character: 'a', voice: 'v', script: 's', subtitle: { show: false } })
      expect(bodyOf(fetchMock.calls[0]).st_show).toBe(0)
    })

    it('字幕字段做数据校验：颜色须为 #rrggbb、数值须为有限整数，非法则拒', async () => {
      const fetchMock = createFetchMock()
      global.fetch = fetchMock
      await expect(createAdapter().generateVideo({
        character: 'a', voice: 'v', script: 's', subtitle: { show: true, primaryColor: 'red' },
      })).rejects.toThrow(/st_primary_color/)
      await expect(createAdapter().generateVideo({
        character: 'a', voice: 'v', script: 's', subtitle: { show: true, fontSize: 12.5 },
      })).rejects.toThrow(/st_font_size/)
      await expect(createAdapter().generateVideo({
        character: 'a', voice: 'v', script: 's', subtitle: { show: true, width: -1 },
      })).rejects.toThrow(/st_width/)
      // 非法输入不得发起请求
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('getVideoStatus — /video/task 端点', () => {
    it('GET /video/task?task_id=，status=3 返回 videoUrl 与 duration', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        code: 0,
        message: '',
        status: 3,
        video_Url: 'https://cdn.hifly.cc/v.mp4?token=xyz',
        duration: 45,
      })])
      global.fetch = fetchMock

      const result = await createAdapter().getVideoStatus('task-1')

      expect(fetchMock.calls[0].url).toBe(`${BASE}/video/task?task_id=task-1`)
      expect(fetchMock.calls[0].opts.method).toBe('GET')
      expect(result.status).toBe('completed')
      expect(result.videoUrl).toBe('https://cdn.hifly.cc/v.mp4?token=xyz')
      expect(result.duration).toBe(45)
    })

    it('processing/pending 归一为 processing', async () => {
      for (const st of [1, 2]) {
        global.fetch = createFetchMock([createFetchResponse({ code: 0, status: st })])
        expect((await createAdapter().getVideoStatus('t')).status).toBe('processing')
      }
    })

    it('failed/error/cancelled 归一为 failed', async () => {
      global.fetch = createFetchMock([createFetchResponse({ code: 0, status: 4 })])
      expect((await createAdapter().getVideoStatus('t')).status).toBe('failed')
    })

    it('未知 status 兜底 processing（不谎称完成）', async () => {
      global.fetch = createFetchMock([createFetchResponse({ code: 0, status: 99 })])
      expect((await createAdapter().getVideoStatus('t')).status).toBe('processing')
    })

    it('HTTP 200 但业务 code 非 0 → PROVIDER_ERROR（飞影错误模型）', async () => {
      global.fetch = createFetchMock([createFetchResponse({ code: 40001, message: 'task not found' })])
      try {
        await createAdapter().getVideoStatus('nope')
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
        expect(e.message).toContain('task not found')
      }
    })

    it('401 → AUTH_FAILED', async () => {
      global.fetch = createFetchMock([createFetchResponse({ message: 'Unauthorized' }, 401)])
      try {
        await createAdapter().getVideoStatus('t')
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.AUTH_FAILED)
      }
    })

    it('空 taskId 抛 INVALID_CONFIG', async () => {
      await expect(createAdapter().getVideoStatus('')).rejects.toThrow(/taskId/i)
    })
  })

  // 真实契约（Token 核对 2026-10-24）：响应是 { code, message, data: [...], request_id }，
  // data 直接是数组，**没有 total 字段** ⇒ 翻页判据只能是「本页是否翻满」。
  describe('listAvatars / listVoices — 真实契约（Token 核对）', () => {
    it('listAvatars 取 kind=1（自己的），字段是 avatar/title/cover_url', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ code: 0, data: [{ avatar: 'Qr2xcAv_Y21', kind: 1, title: '我的形象', cover_url: 'https://cdn/x.png' }] }),
      ])
      global.fetch = fetchMock

      const list = await createAdapter().listAvatars()

      expect(list).toEqual([{ id: 'Qr2xcAv_Y21', name: '我的形象', previewUrl: 'https://cdn/x.png', gender: '' }])
      expect(fetchMock.calls[0].url).toContain('kind=1')
    })

    it('listVoices 取 kind=2（公共），字段是 voice/title/preview_url', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ code: 0, data: [{ voice: 'BMB1UhRK-SPv', type: 10, title: '普通话', preview_url: 'https://cdn/a.wav' }] }),
      ])
      global.fetch = fetchMock

      const list = await createAdapter().listVoices()

      expect(list).toEqual([{ id: 'BMB1UhRK-SPv', name: '普通话', language: '', gender: '' }])
      expect(fetchMock.calls[0].url).toContain('kind=2')
    })

    it('本页翻满 ⇒ 继续翻页；没翻满即止', async () => {
      const full = Array.from({ length: 100 }, (_, i) => ({ avatar: `a${i}` }))
      global.fetch = createFetchMock([
        createFetchResponse({ code: 0, data: full }),
        createFetchResponse({ code: 0, data: [{ avatar: 'a100' }] }),
      ])
      let list = await createAdapter().listAvatars()
      expect(list).toHaveLength(101)

      // 没翻满（1 条 < 100）⇒ 只打一次请求
      global.fetch = createFetchMock([createFetchResponse({ code: 0, data: [{ avatar: 'only-1' }] })])
      list = await createAdapter().listAvatars()
      expect(list.map((a) => a.id)).toEqual(['only-1'])
      expect(global.fetch.mock.calls).toHaveLength(1)
    })

    it('缺 id 的条目丢弃（不产出空 character 让下游炸）', async () => {
      global.fetch = createFetchMock([
        createFetchResponse({ code: 0, data: [{ title: '无名' }, { avatar: 'ok' }] }),
      ])
      const list = await createAdapter().listAvatars()
      expect(list.map((a) => a.id)).toEqual(['ok'])
    })

    it('listVoices 归一化 voice_id/id 混用', async () => {
      global.fetch = createFetchMock([
        createFetchResponse({ code: 0, data: { list: [{ voice_id: 'v1', name: '音色1', language: 'zh' }] } }),
      ])
      const list = await createAdapter().listVoices()
      expect(list).toEqual([{ id: 'v1', name: '音色1', language: 'zh', gender: '' }])
    })

    it('业务 code 非 0 → 返回空数组（不抛，UI 走空态）', async () => {
      global.fetch = createFetchMock([createFetchResponse({ code: 50000, message: 'boom' })])
      await expect(createAdapter().listAvatars()).resolves.toEqual([])
    })
  })

  describe('testConnection', () => {
    it('用 GET /avatar/list 验证认证，200 返回 true', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ code: 0, data: { list: [] } })])
      global.fetch = fetchMock
      const result = await createAdapter().testConnection()
      expect(result.success).toBe(true)
      expect(fetchMock.calls[0].url).toContain('/avatar/list')
    })

    it('401 → success:false + AUTH_FAILED', async () => {
      global.fetch = createFetchMock([createFetchResponse({ message: 'bad token' }, 401)])
      const result = await createAdapter().testConnection()
      expect(result.success).toBe(false)
      expect(result.error.code).toBe(ERROR_CODES.AUTH_FAILED)
    })
  })

  describe('形象与声音克隆（change: digital-human-multiprovider 用户核心需求）', () => {
    // 官方契约要点：
    //  - 素材必须先经 tool/create_upload_url 拿 file_id，再 PUT 上传，最后把 file_id 交给克隆接口
    //    （create_by_image / create_by_video 只接受 image_url/video_url 或 file_id，不接受二进制）
    //  - 声音克隆：POST /voice/create，voice_type 必填且目前只支持 8
    //  - 克隆任务状态：GET /avatar/task（形象）与 GET /voice/task（声音），status 同为整数枚举

    describe('素材上传两段式', () => {
      it('createUploadUrl 返回 file_id + content_type + upload_url', async () => {
        const fetchMock = createFetchMock([createFetchResponse({
          code: 0,
          upload_url: 'https://upload.hifly.cc/a.mp4?Expires=1',
          content_type: 'video/mp4',
          file_id: 'file_abc',
        })])
        global.fetch = fetchMock

        const result = await createAdapter().createUploadUrl('mp4')

        expect(fetchMock.calls[0].url).toBe(`${BASE}/tool/create_upload_url`)
        expect(result.fileId).toBe('file_abc')
        expect(result.contentType).toBe('video/mp4')
        expect(result.uploadUrl).toContain('upload.hifly.cc')
        expect(JSON.parse(fetchMock.calls[0].opts.body)).toEqual({ file_extension: 'mp4' })
      })

      it('uploadFile 用 PUT + binary + 该 content_type，不发认证头（预签名 URL）', async () => {
        global.fetch = vi.fn(async () => ({ ok: true, status: 200 }))

        await createAdapter().uploadFile({
          uploadUrl: 'https://upload.hifly.cc/a.mp4?Expires=1',
          contentType: 'video/mp4',
          buffer: Buffer.from('abc'),
        })

        const [url, opts] = global.fetch.mock.calls[0]
        expect(url).toContain('upload.hifly.cc')
        expect(opts.method).toBe('PUT')
        expect(opts.body).toEqual(Buffer.from('abc'))
        expect(opts.headers['Content-Type']).toBe('video/mp4')
        // 预签名 URL 自带凭证，**不得**再发 Authorization
        expect(opts.headers.Authorization).toBeUndefined()
      })
    })

    describe('形象克隆', () => {
      // 飞影克隆接口只接受 *_url / file_id，**不接受二进制**。
      // 而 avatar-clone-service 传的是 Blob（HeyGen 契约：{ image|video: Blob }）。
      // 所以 adapter 必须自己把 Blob 换成 file_id —— 换血放在这里，
      // service/IPC/UI 才不需要长 provider 分支。
      it('传 Blob ⇒ 自动 create_upload_url + PUT 换 file_id，再带 file_id 克隆', async () => {
        const fetchMock = createFetchMock([
          // ① 换上传地址
          createFetchResponse({ code: 0, upload_url: 'https://upload.hifly.cc/a.png?Expires=1', content_type: 'image/png', file_id: 'file_auto' }),
          // ② PUT 上传
          { ok: true, status: 200, headers: new Map(), async json() { return {} }, async text() { return '' } },
          // ③ 创建克隆
          createFetchResponse({ code: 0, task_id: 't-av-auto' }),
        ])
        global.fetch = fetchMock

        const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
        const result = await createAdapter().createAvatar({ type: 'photo', name: '自动上传', image: blob })

        expect(result.taskId).toBe('t-av-auto')
        expect(fetchMock.calls).toHaveLength(3)
        expect(fetchMock.calls[0].url).toBe(`${BASE}/tool/create_upload_url`)
        expect(JSON.parse(fetchMock.calls[0].opts.body)).toEqual({ file_extension: 'png' })
        expect(fetchMock.calls[1].url).toBe('https://upload.hifly.cc/a.png?Expires=1')
        expect(fetchMock.calls[1].opts.method).toBe('PUT')
        expect(fetchMock.calls[1].opts.headers['Content-Type']).toBe('image/png')
        // 预签名 URL 自带凭证，不得再发 Authorization
        expect(fetchMock.calls[1].opts.headers.Authorization).toBeUndefined()
        expect(fetchMock.calls[2].url).toBe(`${BASE}/avatar/create_by_image`)
        expect(JSON.parse(fetchMock.calls[2].opts.body)).toMatchObject({ title: '自动上传', file_id: 'file_auto' })
      })

      it('传 Blob 但换 file_id 失败 ⇒ 抛错且不调克隆接口（不留半截状态）', async () => {
        const fetchMock = createFetchMock([createFetchResponse({ code: 50000, message: 'upload-url boom' })])
        global.fetch = fetchMock
        const blob = new Blob([new Uint8Array([1])], { type: 'image/png' })
        await expect(createAdapter().createAvatar({ type: 'photo', name: 'x', image: blob })).rejects.toThrow(/upload-url boom/)
        expect(fetchMock.calls).toHaveLength(1)
      })

      it('后缀从 Blob 的 MIME 反查（含别名：mpeg→mp3、quicktime→mov、jpeg→jpg）', async () => {
        const a = createAdapter()
        expect(a._resolveFileExtension({ type: 'audio/mpeg' }, undefined, 'audio')).toBe('mp3')
        expect(a._resolveFileExtension({ type: 'video/quicktime' }, undefined, 'digital_twin')).toBe('mov')
        expect(a._resolveFileExtension({ type: 'image/jpeg' }, undefined, 'photo')).toBe('jpg')
        expect(a._resolveFileExtension({ type: 'image/png' }, undefined, 'photo')).toBe('png')
        // 显式 fileName 优先于 MIME
        expect(a._resolveFileExtension({ type: 'image/png' }, 'real.WEBP', 'photo')).toBe('webp')
        // MIME 缺失时按 type 兜底
        expect(a._resolveFileExtension({ type: '' }, undefined, 'digital_twin')).toBe('mp4')
      })

      it('createAvatar(photo) → create_by_image，映射 type=photo 到 image_url/file_id', async () => {
        const fetchMock = createFetchMock([createFetchResponse({ code: 0, task_id: 't-av-1' })])
        global.fetch = fetchMock

        const result = await createAdapter().createAvatar({
          type: 'photo', name: '我的照片数字人', fileId: 'file_img',
        })

        expect(fetchMock.calls[0].url).toBe(`${BASE}/avatar/create_by_image`)
        expect(result.taskId).toBe('t-av-1')
        const body = JSON.parse(fetchMock.calls[0].opts.body)
        expect(body).toMatchObject({ title: '我的照片数字人', file_id: 'file_img' })
      })

      it('createAvatar(digital_twin) → create_by_video', async () => {
        const fetchMock = createFetchMock([createFetchResponse({ code: 0, task_id: 't-av-2' })])
        global.fetch = fetchMock

        await createAdapter().createAvatar({
          type: 'digital_twin', name: '我的视频数字人', videoUrl: 'https://cdn/x.mp4',
        })

        expect(fetchMock.calls[0].url).toBe(`${BASE}/avatar/create_by_video`)
        const body = JSON.parse(fetchMock.calls[0].opts.body)
        expect(body).toMatchObject({ video_url: 'https://cdn/x.mp4' })
      })

      it('getAvatarStatus 读 /avatar/task，返回 avatar 标识', async () => {
        const fetchMock = createFetchMock([createFetchResponse({
          code: 0, status: 3, avatar: 'av_abc123xyz',
        })])
        global.fetch = fetchMock

        const result = await createAdapter().getAvatarStatus('t-av-1')

        expect(fetchMock.calls[0].url).toBe(`${BASE}/avatar/task?task_id=t-av-1`)
        expect(result.status).toBe('completed')
        expect(result.avatarId).toBe('av_abc123xyz')
      })

      it('deleteAvatar 用 DELETE /avatar?avatar=', async () => {
        const fetchMock = createFetchMock([createFetchResponse({ code: 0 })])
        global.fetch = fetchMock

        const result = await createAdapter().deleteAvatar('av_abc')

        expect(fetchMock.calls[0].url).toBe(`${BASE}/avatar?avatar=av_abc`)
        expect(fetchMock.calls[0].opts.method).toBe('DELETE')
        // 删除类响应体常无 data，成功只认 code===0（不拿 data 真值判）
        expect(result).toBe(true)
      })

      it('createAvatar 缺素材 ⇒ INVALID_CONFIG，不发请求', async () => {
        const fetchMock = createFetchMock()
        global.fetch = fetchMock
        await expect(createAdapter().createAvatar({ type: 'photo', name: 'x' })).rejects.toThrow(/fileId|imageUrl/i)
        expect(fetchMock).not.toHaveBeenCalled()
      })
    })

    describe('声音克隆', () => {
      it('cloneVoice 发 /voice/create，带 voice_type=8 与音频来源', async () => {
        const fetchMock = createFetchMock([createFetchResponse({ code: 0, task_id: 't-vc-1' })])
        global.fetch = fetchMock

        const result = await createAdapter().cloneVoice({
          name: '我的声音', fileId: 'file_audio', language: 'zh',
        })

        expect(fetchMock.calls[0].url).toBe(`${BASE}/voice/create`)
        expect(result.taskId).toBe('t-vc-1')
        const body = JSON.parse(fetchMock.calls[0].opts.body)
        // voice_type 必填且目前只支持 8（官方文档）
        expect(body.voice_type).toBe(8)
        expect(body).toMatchObject({ title: '我的声音', file_id: 'file_audio', languages: 'zh' })
      })

      it('cloneVoice 缺音频来源 ⇒ INVALID_CONFIG', async () => {
        const fetchMock = createFetchMock()
        global.fetch = fetchMock
        await expect(createAdapter().cloneVoice({ name: 'x' })).rejects.toThrow(/audio|fileId/i)
        expect(fetchMock).not.toHaveBeenCalled()
      })

      it('getVoiceCloneStatus 读 /voice/task', async () => {
        const fetchMock = createFetchMock([createFetchResponse({ code: 0, status: 3, voice: 'voice_abc' })])
        global.fetch = fetchMock

        const result = await createAdapter().getVoiceCloneStatus('t-vc-1')

        expect(fetchMock.calls[0].url).toBe(`${BASE}/voice/task?task_id=t-vc-1`)
        expect(result.status).toBe('completed')
        expect(result.voiceId).toBe('voice_abc')
      })
    })
  })

  describe('网络错误分类', () => {
    it('ETIMEDOUT → TIMEOUT', async () => {
      global.fetch = vi.fn(async () => { throw new Error('ETIMEDOUT') })
      try {
        await createAdapter().generateVideo({ character: 'c', voice: 'v', script: 's' })
        expect.fail('Should throw')
      } catch (e) { expect(e.code).toBe(ERROR_CODES.TIMEOUT) }
    })

    it('ECONNREFUSED → NETWORK_ERROR', async () => {
      global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })
      try {
        await createAdapter().generateVideo({ character: 'c', voice: 'v', script: 's' })
        expect.fail('Should throw')
      } catch (e) { expect(e.code).toBe(ERROR_CODES.NETWORK_ERROR) }
    })
  })

  // ── change: hifly-voice-edit —— 修改声音参数（官方 POST /voice/edit）────────
  describe('editVoice — 修改声音参数（change: hifly-voice-edit）', () => {
    // 官方契约：rate/volume/pitch 都是**字符串**，范围分别 0.5-2.0 / 0.1-2.0 / 0.1-2.0，默认 1.0。
    // 用字符串而非数字是官方原文（示例 "1.2"），adapter 必须原样传，不得自行转数字。
    it('三个参数以字符串透传到 /voice/edit', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ code: 0, message: '' })])
      global.fetch = fetchMock

      await createAdapter().editVoice({ voice: 'v-abc', rate: '1.2', volume: '1.0', pitch: '0.9' })

      expect(fetchMock.calls[0].url).toBe(`${BASE}/voice/edit`)
      expect(fetchMock.calls[0].opts.method).toBe('POST')
      expect(JSON.parse(fetchMock.calls[0].opts.body)).toEqual({
        voice: 'v-abc', rate: '1.2', volume: '1.0', pitch: '0.9',
      })
    })

    // 数据校验：三个字段都有界，越界必须在本地就拒，
    // 不能等服务端返回 400（那会消耗一次请求且错误信息不可控）。
    it('rate 越界（<0.5 或 >2.0）⇒ INVALID_CONFIG，不发请求', async () => {
      const fetchMock = createFetchMock()
      global.fetch = fetchMock
      await expect(createAdapter().editVoice({ voice: 'v', rate: '0.4' })).rejects.toThrow(/rate/)
      await expect(createAdapter().editVoice({ voice: 'v', rate: '2.1' })).rejects.toThrow(/rate/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('volume / pitch 越界（<0.1 或 >2.0）⇒ INVALID_CONFIG，不发请求', async () => {
      const fetchMock = createFetchMock()
      global.fetch = fetchMock
      await expect(createAdapter().editVoice({ voice: 'v', volume: '0.05' })).rejects.toThrow(/volume/)
      await expect(createAdapter().editVoice({ voice: 'v', pitch: '2.5' })).rejects.toThrow(/pitch/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    // 真实 Token 侧证（2026-10-24，账号 premium）：rate 传数字 1.2 被服务端以
    // 「参数格式不正确」拒绝 ⇒ 官方「字符串」要求是硬约束，不是文档笔误。
    it('参数必须是字符串（数字会被拒，官方硬约束）', async () => {
      const fetchMock = createFetchMock()
      global.fetch = fetchMock
      await expect(createAdapter().editVoice({ voice: 'v', rate: 1.2 })).rejects.toThrow(/rate/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('缺 voice ⇒ INVALID_CONFIG，不发请求', async () => {
      const fetchMock = createFetchMock()
      global.fetch = fetchMock
      await expect(createAdapter().editVoice({ rate: '1.0' })).rejects.toThrow(/voice/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('业务 code 非 0 ⇒ PROVIDER_ERROR 且带服务端 message', async () => {
      global.fetch = createFetchMock([createFetchResponse({ code: 40001, message: 'voice not found' })])
      try {
        await createAdapter().editVoice({ voice: 'v', rate: '1.0' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
        expect(e.message).toContain('voice not found')
      }
    })

    // ── 真实 Token 侧证的四类响应（2026-10-24，账号 premium，0 积分）────────
    //   公共音色（服务端拒）  → { code: 11, message: "声音编辑失败" }
    //   不存在的 voice        → { code: 11, message: "Voice不正确" }
    //   缺三个参数             → { code: 11, message: "参数格式不正确" }
    //   rate 传数字 1.2        → { code: 11, message: "参数格式不正确" }
    // 成功路径也验证过：对真实克隆音色传 1.2/1.0/1.0 等三组参数均返回 { ok: true }，0 积分消耗。
    it('服务端 code:11「声音编辑失败」⇒ PROVIDER_ERROR 且原文透出', async () => {
      global.fetch = createFetchMock([createFetchResponse({ code: 11, message: '声音编辑失败' })])
      try {
        await createAdapter().editVoice({ voice: 'v', rate: '1.0' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
        expect(e.message).toContain('声音编辑失败')
      }
    })

    it('服务端 code:11「Voice不正确」⇒ PROVIDER_ERROR（id 不存在同形）', async () => {
      global.fetch = createFetchMock([createFetchResponse({ code: 11, message: 'Voice不正确' })])
      try {
        await createAdapter().editVoice({ voice: 'bad', rate: '1.0' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
        expect(e.message).toContain('Voice不正确')
      }
    })

    // 这条锁「产品必须知道的事实」：公共音色不可编辑。
    // 服务端对公共音色返回通用「声音编辑失败」，与其它失败无法区分，
    // 所以应用不能在失败时猜原因，但 UI 上应只对克隆音色开放编辑入口。
    it('公共音色服务端拒（code:11）⇒ 原文透出，不猜原因', async () => {
      global.fetch = createFetchMock([createFetchResponse({ code: 11, message: '声音编辑失败' })])
      await expect(
        createAdapter().editVoice({ voice: 'public-voice', rate: '1.0' }),
      ).rejects.toThrow(/声音编辑失败/)
    })

    // edit 的响应只有 code/message/request_id，无 task 概念，提交即完成。
    it('code===0 ⇒ 返回 { ok: true }', async () => {
      global.fetch = createFetchMock([createFetchResponse({ code: 0, message: '', request_id: 'r1' })])
      await expect(createAdapter().editVoice({ voice: 'v', rate: '1.0' })).resolves.toEqual({ ok: true })
    })
  })

  // ── change: hifly-voice-edit —— capabilities 登记 ─────────────────────────
  describe('capabilities 登记（change: hifly-voice-edit）', () => {
    // 未登记的方法即便子类实现了也永远不会被 callAdapter 调到
    it('editVoice 已登记进 KNOWN_METHODS 且 supports() 为 true', () => {
      expect(createAdapter().supports('editVoice')).toBe(true)
      expect(createAdapter().capabilities()).toContain('editVoice')
    })

    // 反向锁：未实现该端点的 provider 不得泄漏能力，
    // 否则 UI 会给出一个点了必失败的入口。
    it('未实现 editVoice 的 adapter 不得泄漏该能力', () => {
      const { HeyGenAdapter } = require('./heygen.js')
      const heygen = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      expect(heygen.supports('editVoice')).toBe(false)
      expect(heygen.capabilities()).not.toContain('editVoice')
    })
  })

})

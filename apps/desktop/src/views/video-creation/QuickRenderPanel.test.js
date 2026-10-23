/**
 * QuickRenderPanel.test.js — 快速渲染面板（AI 视频生成）
 *
 * 覆盖：
 * - 模式 tab 按 **provider 能力**显示（能力描述缺失时保守只给文生视频）
 * - 分辨率档位按能力（单档位时控件禁用）
 * - 参数区：输出平台→画幅映射、时长 4–12、seed=0 透传
 * - 素材：参考图/参考音频数量上限在客户端拦截
 * - 提交载荷：mode / 素材 / 画幅 / 时长 / 种子
 * - 进度与结果：主进程 push 的进度如实呈现、完成可查看成片
 * - 取消：只停本地等待并如实告知远端可能仍在生成
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import QuickRenderPanel from './QuickRenderPanel.vue'

vi.mock('@/api/publisher', () => ({
  renderStart: vi.fn(),
  renderStartAiVideo: vi.fn(),
  renderCancel: vi.fn(),
  renderAiVideoCapabilities: vi.fn(),
  onRenderProgress: vi.fn(() => vi.fn()),
  onRenderComplete: vi.fn(() => vi.fn()),
  onRenderError: vi.fn(() => vi.fn()),
  aiGenerate: vi.fn().mockResolvedValue({ code: 0, data: { content: 'AI generated script' } }),
  modelProviderGetDefault: vi.fn().mockResolvedValue({ code: 0, data: { id: 'openai' } }),
}))

const AGNES_CAPS = {
  protocol: 'agnes-videos-2.5',
  modes: ['text', 'keyframe', 'reference'],
  sizes: ['720P'],
  defaultSize: '720P',
  maxImages: 5,
  maxAudios: 3,
  maxVideos: 0,
  supportsReferenceVideo: false,
  aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
}

async function mountPanel (caps = AGNES_CAPS) {
  const mocks = await import('@/api/publisher')
  mocks.renderAiVideoCapabilities.mockResolvedValue({ code: 0, data: { providerId: 'agnes-multimodal', model: 'agnes-video-2.5-flash', capabilities: caps } })
  mocks.renderStartAiVideo.mockResolvedValue({ code: 0, data: { success: true, outputPath: '/tmp/out.mp4' } })
  mocks.renderStart.mockResolvedValue({ code: 0, data: { success: true, outputPath: '/tmp/gallery.mp4' } })
  const w = mount(QuickRenderPanel, { global: { plugins: [i18n] } })
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
  return { w, mocks }
}

/**
 * 造一个 File 并触发隐藏 input 的 change。
 *
 * ⚠️ 必须**等 DOM 真正反映**这次选择，而不是固定 sleep：
 * 文件读取走 FileReader（异步），固定等待会在慢机器上偶发「素材还没进列」
 * ⇒ 后续断言随机失败（本次实测：同一文件连续两次运行，一次过一次挂）。
 * `until` 给出「这次选择已生效」的判据，由 vi.waitFor 轮询到成立为止。
 */
async function pickFiles (w, testid, files, until) {
  const input = w.find(`[data-testid="${testid}"]`)
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  if (typeof until === 'function') {
    await vi.waitFor(() => { expect(until()).toBe(true) }, { timeout: 3000, interval: 20 })
  }
  await nextTick()
}

/** 等待某个素材区出现 n 个缩略图 */
function thumbsIn (w, testid, n) {
  return () => w.find(`[data-testid="${testid}"]`).findAll('.image-thumb').length >= n
}

function makeFile (name, type, size = 1024) {
  const file = new File([new Uint8Array(size)], name, { type })
  return file
}

describe('QuickRenderPanel — 模式与能力', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('能力含 keyframe/reference 时渲染 4 个模式 tab（含图片轮播）', async () => {
    const { w } = await mountPanel()
    const tabs = w.findAll('.mode-tab')
    expect(tabs).toHaveLength(4)
    expect(w.find('[data-testid="quick-mode-keyframe"]').exists()).toBe(true)
    expect(w.find('[data-testid="quick-mode-reference"]').exists()).toBe(true)
    expect(w.find('[data-testid="quick-mode-gallery"]').exists()).toBe(true)
  })

  it('能力缺失时保守只给「文生视频 + 图片轮播」两个 tab', async () => {
    const { w } = await mountPanel({ protocol: 'generic', modes: ['text'] })
    const tabs = w.findAll('.mode-tab')
    expect(tabs).toHaveLength(2)
    expect(w.find('[data-testid="quick-mode-keyframe"]').exists()).toBe(false)
  })

  it('分辨率只有单一档位时控件禁用', async () => {
    const { w } = await mountPanel()
    const sizeSelect = w.find('[data-testid="quick-size"]')
    expect(sizeSelect.exists()).toBe(true)
    expect(sizeSelect.attributes('disabled')).toBeDefined()
  })

  it('时长可选 4–12 秒，默认 5 秒', async () => {
    const { w } = await mountPanel()
    const opts = w.find('[data-testid="quick-seconds"]').findAll('option')
    expect(opts).toHaveLength(9)
    expect(opts[0].element.value).toBe('4')
    expect(opts[8].element.value).toBe('12')
  })
})

describe('QuickRenderPanel — 提交载荷', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('文生视频：提交 prompt / 画幅 / 时长；画幅由输出平台映射', async () => {
    const { w, mocks } = await mountPanel()
    await w.find('[data-testid="quick-ai-prompt"]').setValue('a cat running')
    await w.find('[data-testid="quick-profile"]').setValue('xiaohongshu')
    await nextTick()
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    const payload = mocks.renderStartAiVideo.mock.calls[0][0]
    expect(payload.prompt).toBe('a cat running')
    expect(payload.mode).toBe('text')
    expect(payload.aspectRatio).toBe('3:4')
    expect(payload.seconds).toBe(5)
    expect(payload.seed).toBeUndefined()
  })

  it('YouTube 横屏映射为 16:9', async () => {
    const { w, mocks } = await mountPanel()
    await w.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await w.find('[data-testid="quick-profile"]').setValue('youtube-landscape')
    await nextTick()
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(mocks.renderStartAiVideo.mock.calls[0][0].aspectRatio).toBe('16:9')
  })

  it('分辨率档位随载荷下发（控件不是摆设）', async () => {
    const { w, mocks } = await mountPanel()
    await w.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    // Flash 只有 720P 一档 ⇒ 载荷带上它
    expect(mocks.renderStartAiVideo.mock.calls[0][0].size).toBe('720P')
  })

  it('seed=0 是合法值，照常提交（不被当作空值丢弃）', async () => {
    const { w, mocks } = await mountPanel()
    await w.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await w.find('[data-testid="quick-seed"]').setValue('0')
    await nextTick()
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(mocks.renderStartAiVideo.mock.calls[0][0].seed).toBe(0)
  })

  it('首尾帧模式：提交 firstFrame / lastFrame，不带参考素材', async () => {
    const { w, mocks } = await mountPanel()
    await w.find('[data-testid="quick-mode-keyframe"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await pickFiles(w, 'quick-frame-input', [makeFile('a.png', 'image/png')],
      () => w.find('[data-testid="quick-frame-remove-first"]').exists())
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    const payload = mocks.renderStartAiVideo.mock.calls[0][0]
    expect(payload.mode).toBe('keyframe')
    expect(typeof payload.firstFrame).toBe('string')
    expect(payload.firstFrame.startsWith('data:image/png')).toBe(true)
    expect(payload.images).toBeUndefined()
  })

  it('参考素材模式：提交 images / audios', async () => {
    const { w, mocks } = await mountPanel()
    await w.find('[data-testid="quick-mode-reference"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await pickFiles(w, 'quick-image-input', [makeFile('a.png', 'image/png')],
      thumbsIn(w, 'quick-ref-images-zone', 1))
    await pickFiles(w, 'quick-audio-input', [makeFile('a.mp3', 'audio/mpeg')],
      thumbsIn(w, 'quick-ref-audios-zone', 1))
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    const payload = mocks.renderStartAiVideo.mock.calls[0][0]
    expect(payload.mode).toBe('reference')
    expect(payload.images).toHaveLength(1)
    expect(payload.audios).toHaveLength(1)
  })

  it('切换模式后残留的素材不得让用户卡住（素材区不渲染 ⇒ 用户无从清理）', async () => {
    const { w, mocks } = await mountPanel()
    // 先在参考素材模式上传一张图
    await w.find('[data-testid="quick-mode-reference"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await pickFiles(w, 'quick-image-input', [makeFile('a.png', 'image/png')],
      thumbsIn(w, 'quick-ref-images-zone', 1))
    // 切到文生视频：参考图仍在状态里，但该模式下素材区不渲染
    await w.find('[data-testid="quick-mode-text"]').trigger('click')
    await nextTick()
    expect(w.find('[data-testid="quick-ref-images-zone"]').exists()).toBe(false)
    // 「开始渲染」必须可用，且载荷里**不含**残留的参考图
    expect(w.find('[data-testid="quick-start"]').attributes('disabled')).toBeUndefined()
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    const payload = mocks.renderStartAiVideo.mock.calls[0][0]
    expect(payload.mode).toBe('text')
    expect(payload.images).toBeUndefined()
  })

  it('首尾帧模式缺素材时「开始渲染」禁用（不发请求）', async () => {
    const { w, mocks } = await mountPanel()
    await w.find('[data-testid="quick-mode-keyframe"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await nextTick()
    expect(w.find('[data-testid="quick-start"]').attributes('disabled')).toBeDefined()
    expect(mocks.renderStartAiVideo).not.toHaveBeenCalled()
  })
})

describe('QuickRenderPanel — 素材上限与错误', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('参考图超过上限时在客户端拦截并提示，不发请求', async () => {
    const { w, mocks } = await mountPanel()
    await w.find('[data-testid="quick-mode-reference"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="quick-ai-prompt"]').setValue('x')
    const files = Array.from({ length: 6 }, (_, i) => makeFile(`a${i}.png`, 'image/png'))
    await pickFiles(w, 'quick-image-input', files, thumbsIn(w, 'quick-ref-images-zone', 5))
    expect(w.find('[data-testid="quick-error"]').exists()).toBe(true)
    // 超出部分不入列
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    const payload = mocks.renderStartAiVideo.mock.calls[0][0]
    expect(payload.images.length).toBeLessThanOrEqual(5)
  })

  it('服务端失败时展示错误并退出渲染态', async () => {
    const { w, mocks } = await mountPanel()
    mocks.renderStartAiVideo.mockResolvedValue({ code: -1, message: 'provider exploded' })
    await w.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    expect(w.find('[data-testid="quick-error"]').exists()).toBe(true)
  })

  it('领域错误码走本地化文案（不把英文码原样透给用户）', async () => {
    const { w, mocks } = await mountPanel()
    mocks.renderStartAiVideo.mockResolvedValue({ code: -1, message: 'keyframe-requires-frame' })
    await w.find('[data-testid="quick-mode-keyframe"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await pickFiles(w, 'quick-frame-input', [makeFile('a.png', 'image/png')],
      () => w.find('[data-testid="quick-frame-remove-first"]').exists())
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    const text = w.find('[data-testid="quick-error"]').text()
    expect(text).not.toContain('keyframe-requires-frame')
    expect(text.length).toBeGreaterThan(0)
  })
})

describe('QuickRenderPanel — 进度、结果与取消', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('主进程 push 的进度如实呈现（不自己往上加）', async () => {
    const { w, mocks } = await mountPanel()
    let progressCb = null
    mocks.onRenderProgress.mockImplementation((cb) => { progressCb = cb; return vi.fn() })
    // 提交保持 pending ⇒ 组件停留在渲染态（进度区才渲染）
    mocks.renderStartAiVideo.mockImplementation(() => new Promise(() => {}))
    const w2 = mount(QuickRenderPanel, { global: { plugins: [i18n] } })
    await nextTick()
    await w2.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await w2.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    progressCb({ percent: 10, stage: 'generating' })
    await nextTick()
    const text = w2.find('[data-testid="quick-progress"]').text()
    expect(text).toContain('10%')
    expect(text).toContain('generating')
    w.unmount()
    w2.unmount()
  })

  it('进度载荷按对象读取（历史实现按位置参数解构，导致进度条渲染成 [object Object]%）', async () => {
    const { w, mocks } = await mountPanel()
    let progressCb = null
    mocks.onRenderProgress.mockImplementation((cb) => { progressCb = cb; return vi.fn() })
    mocks.renderStartAiVideo.mockImplementation(() => new Promise(() => {}))
    const w2 = mount(QuickRenderPanel, { global: { plugins: [i18n] } })
    await nextTick()
    await w2.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await w2.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    progressCb({ percent: 42, stage: 'downloading' })
    await nextTick()
    const text = w2.find('[data-testid="quick-progress"]').text()
    expect(text).toContain('42%')
    expect(text).not.toContain('[object Object]')
    w.unmount()
    w2.unmount()
  })

  it('成功后展示完成横幅，点击「查看视频」回传成片路径', async () => {
    const { w } = await mountPanel()
    await w.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    expect(w.find('[data-testid="quick-view-result"]').exists()).toBe(true)
    await w.find('[data-testid="quick-view-result"]').trigger('click')
    expect(w.emitted('view-result')).toBeTruthy()
    expect(w.emitted('view-result')[0]).toEqual(['/tmp/out.mp4'])
  })

  it('取消：调用 renderCancel 并如实提示远端可能仍在生成', async () => {
    const { w, mocks } = await mountPanel()
    mocks.renderStartAiVideo.mockImplementation(() => new Promise(() => {}))
    const w2 = mount(QuickRenderPanel, { global: { plugins: [i18n] } })
    await nextTick()
    await w2.find('[data-testid="quick-ai-prompt"]').setValue('x')
    await w2.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await w2.find('[data-testid="quick-cancel"]').trigger('click')
    await nextTick()
    expect(mocks.renderCancel).toHaveBeenCalled()
    expect(w2.find('[data-testid="quick-error"]').exists()).toBe(true)
    w.unmount()
    w2.unmount()
  })

  it('图片轮播模式走本地 renderStart（不调 AI 视频）', async () => {
    const { w, mocks } = await mountPanel()
    await w.find('[data-testid="quick-mode-gallery"]').trigger('click')
    await nextTick()
    await pickFiles(w, 'quick-gallery-input', [makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')],
      thumbsIn(w, 'quick-gallery-zone', 2))
    await w.find('[data-testid="quick-start"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(mocks.renderStartAiVideo).not.toHaveBeenCalled()
    expect(mocks.renderStart).toHaveBeenCalled()
    const cuts = mocks.renderStart.mock.calls[0][0].props.cuts
    expect(cuts).toHaveLength(2)
    expect(cuts[0].type).toBe('anime_scene')
    expect(cuts[0].animation).toBe('ken-burns')
  })
})

// @ts-check
/**
 * publish-precondition 单元测试（publish-precondition-gate，2026-10-18）
 *
 * 用例来源：2026-10-17 批量发布的真实失败（头条 publish btn not found / 抖音 publish timeout），
 * 每条断言都对应一条「真因不能被下游症状掩盖」的判据。
 */
const {
  REASONS,
  describeFailure,
  evaluatePublishPreconditions,
  labelOf,
} = require('./publish-precondition')

/** 造一个「一切就绪」的基线，用例只在关心处改字段。 */
function baseInput (overrides = {}) {
  return {
    platform: 'douyin',
    article: { video_path: 'D:/v.mp4', title: '标题', content: '正文' },
    selectors: { file_input: ['input[type="file"]'] },
    fillReport: {
      upload: { ok: true },
      title: { ok: true },
      content: { ok: true },
    },
    ...overrides,
  }
}

describe('publish-precondition — 前置门禁判据', () => {
  it('全部就绪时放行（不产生任何 reason）', () => {
    const r = evaluatePublishPreconditions(baseInput())
    expect(r).toEqual({ ok: true })
  })

  it('P1 头条：有视频但平台没登记 file_input ⇒ 判「未实现」而非「失败」', () => {
    // 真实现场：日志 `file input hasVideo=true selectorCount=0`，
    // 上传整段被跳过，最后才在发布按钮上炸出 publish btn not found。
    const r = evaluatePublishPreconditions(baseInput({
      platform: 'toutiao',
      selectors: {}, // PLATFORM_PUBLISH_SELECTORS.toutiao 确实没有 file_input
      fillReport: {},
    }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe(REASONS.UPLOAD_SELECTOR_MISSING)
    expect(r.message).toContain('今日头条')
    expect(r.message).toContain('视频发布尚未支持')
    expect(r.message).toContain('西瓜视频上传页')
  })

  it('P1 未登记任何入口的其它平台也走同一条（不给平台特例开后门）', () => {
    const r = evaluatePublishPreconditions(baseInput({ platform: 'aiqiyi', selectors: {} }))
    expect(r.reason).toBe(REASONS.UPLOAD_SELECTOR_MISSING)
    expect(r.message).toContain('本仓尚未登记该平台的视频上传入口选择器')
  })

  it('P2 抖音：上传完成信号未确认 ⇒ 判上传未完成（不是 publish timeout）', () => {
    const r = evaluatePublishPreconditions(baseInput({
      fillReport: { upload: { ok: false, detail: '未检测到上传完成信号' }, title: { ok: true }, content: { ok: true } },
    }))
    expect(r.reason).toBe(REASONS.UPLOAD_NOT_COMPLETED)
    expect(r.message).toContain('抖音')
    expect(r.message).toContain('视频上传未完成')
  })

  it('P2 上传记录缺失（上传块被整段跳过）同样拦下 —— 「没记录」≠「成功」', () => {
    const r = evaluatePublishPreconditions(baseInput({ fillReport: { title: { ok: true }, content: { ok: true } } }))
    expect(r.reason).toBe(REASONS.UPLOAD_NOT_COMPLETED)
    expect(r.message).toContain('上传阶段未执行')
  })

  it('P2 上传过程抛错 ⇒ 归到 exception 族并带上原始错误', () => {
    const r = evaluatePublishPreconditions(baseInput({
      fillReport: { upload: { ok: false, error: 'setFileInput failed' }, title: { ok: true }, content: { ok: true } },
    }))
    expect(r.reason).toBe(REASONS.UPLOAD_EXCEPTION)
    expect(r.message).toContain('setFileInput failed')
  })

  it('P3 抖音：上传成功但标题 readback=0 ⇒ 判标题未写入', () => {
    const r = evaluatePublishPreconditions(baseInput({
      fillReport: { upload: { ok: true }, title: { ok: false, error: 'fill not applied (readback=0)' }, content: { ok: true } },
    }))
    expect(r.reason).toBe(REASONS.TITLE_NOT_FILLED)
    expect(r.message).toContain('标题未写入')
    expect(r.message).toContain('readback=0')
  })

  it('P3 no-title 平台（快手/视频号等）：标题并入描述，不因缺 title 记录而拦', () => {
    const r = evaluatePublishPreconditions(baseInput({
      platform: 'kuaishou',
      noTitlePlatform: true,
      fillReport: { upload: { ok: true }, content: { ok: true } },
    }))
    expect(r.ok).toBe(true)
  })

  it('P4 正文未写入 ⇒ 拦下', () => {
    const r = evaluatePublishPreconditions(baseInput({
      fillReport: { upload: { ok: true }, title: { ok: true }, content: { ok: false, error: 'editor not found' } },
    }))
    expect(r.reason).toBe(REASONS.CONTENT_NOT_FILLED)
    expect(r.message).toContain('正文未写入')
  })

  it('纯图文（无视频）不看 upload，只看标题与正文', () => {
    const r = evaluatePublishPreconditions({
      platform: 'zhihu',
      article: { title: '标题', content: '正文' },
      selectors: {},
      fillReport: { title: { ok: true }, content: { ok: true } },
    })
    expect(r.ok).toBe(true)
  })

  it('文案不变式：每条失败都写明「本次未提交 + 未占间隔」（definitelyNotSent 的语义依据）', () => {
    const reasons = [
      REASONS.UPLOAD_SELECTOR_MISSING,
      REASONS.UPLOAD_NOT_COMPLETED,
      REASONS.UPLOAD_EXCEPTION,
      REASONS.TITLE_NOT_FILLED,
      REASONS.CONTENT_NOT_FILLED,
      'unknown-reason',
    ]
    for (const reason of reasons) {
      const text = describeFailure(reason, 'douyin')
      expect(text).toContain('本次未向平台提交任何内容')
      expect(text).toContain('未占用发布间隔')
    }
  })

  it('平台显示名回落：未登记的平台 id 原样出现在文案里', () => {
    expect(labelOf('toutiao')).toBe('今日头条')
    expect(labelOf('some_new_platform')).toBe('some_new_platform')
    expect(describeFailure(REASONS.TITLE_NOT_FILLED, 'some_new_platform')).toContain('some_new_platform')
  })
})

// 2026-10-18 video-publish-4 第四轮（CCG 自扮演裁决 i1/i3）：
// `assertReady` 的取证旁路失败必须**可见**——旧实现 `catch(_){}` 静默吞掉，
// 使「取证通道断了」与「本平台不需要取证」在生产上完全同形，审计契约失效而无人知晓。
// 注意：取证默认关闭（`MP_DOM_DUMP` 未设时一次都不读页面），因此这些用例必须显式开开关，
// 否则测到的是「未开启」分支而不是「开启后失败」分支。
describe('publish-precondition — assertReady 取证旁路', () => {
  const { assertReady } = require('./publish-precondition')

  beforeAll(() => { process.env.MP_DOM_DUMP = '1' })
  afterAll(() => { delete process.env.MP_DOM_DUMP })

  function okInput (overrides = {}) {
    return {
      win: { webContents: {} },
      platform: 'douyin',
      article: { video_path: 'D:/v.mp4', title: '标题', content: '正文' },
      selectors: { file_input: ['input[type="file"]'] },
      fillReport: { upload: { ok: true }, title: { ok: true }, content: { ok: true } },
      logger: { warn: vi.fn(), info: vi.fn() },
      ...overrides,
    }
  }

  it('取证正常时不发声（无噪声）', async () => {
    const input = okInput()
    // 让 executeJavaScript 返回一个「像采集结果」的对象
    input.win.webContents.executeJavaScript = async () => ({
      urlPath: '/x', docTitle: 't', files: [], inputs: [], textareas: [], editables: [], buttons: [], uploadAreas: [], bodyTextLength: 1,
    })
    input.win.webContents.getURL = () => 'https://example.test/x'
    const r = await assertReady(input)
    expect(r.ok).toBe(true)
    expect(input.logger.warn).not.toHaveBeenCalled()
  })

  it('取证旁路本身抛错时：不抛、判定继续，且必须 warn 出声（不得静默）', async () => {
    // dumpDom 抛错 ⇒ assertReady 的 try 冒泡到 catch 分支（区别于「返回 null」分支）。
    // 用 spyOn 精确控制，避免依赖 executeJavaScript 的调用形态。
    const dump = require('./rpa-dom-dump')
    const spy = vi.spyOn(dump, 'dumpDom').mockRejectedValue(new Error('boom'))
    try {
      const input = okInput()
      await expect(assertReady(input)).resolves.toBeTruthy()
      expect(spy).toHaveBeenCalled()
      expect(input.logger.warn).toHaveBeenCalled()
      const msg = String(input.logger.warn.mock.calls[0][1])
      expect(msg).toContain('dom-dump')
      expect(msg).toContain('不影响发布判定')
      expect(msg).toContain('boom')
    } finally {
      spy.mockRestore()
    }
  })

  it('取证返回 null（通道无结果）时也必须 warn，且文案点名「缺页面形状证据」', async () => {
    const input = okInput({ win: { webContents: { executeJavaScript: async () => 'not-an-object' } } })
    const r = await assertReady(input)
    expect(r.ok).toBe(true)
    expect(input.logger.warn).toHaveBeenCalled()
    const msg = String(input.logger.warn.mock.calls[0][1])
    expect(msg).toContain('dom-dump')
    expect(msg).toContain('缺页面形状证据')
  })

  it('没有 logger 时也不抛（降级为静默，但不得崩）', async () => {
    const input = okInput({ logger: undefined })
    await expect(assertReady(input)).resolves.toBeTruthy()
  })

  it('门禁命中时仍返回带 definitelyNotSent 的失败结果（取证失败不影响判定）', async () => {
    const input = okInput({
      win: { webContents: { executeJavaScript: undefined } },
      fillReport: { upload: null, title: null, content: null },
    })
    const r = await assertReady(input)
    expect(r.ok).toBe(false)
    expect(r.result.preSubmitBlocked).toBe(true)
    expect(r.result.definitelyNotSent).toBe(true)
    // 两条 warn：一条取证旁路、一条门禁拦截
    expect(input.logger.warn.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

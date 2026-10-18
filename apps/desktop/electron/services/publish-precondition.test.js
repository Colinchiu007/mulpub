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

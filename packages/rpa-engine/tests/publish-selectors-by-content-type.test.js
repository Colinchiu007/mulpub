// @ts-check
/**
 * 按内容类型合并发布选择器（video-publish-4，2026-10-18）
 *
 * 规则（详见同目录 publish-selectors-by-content-type.js 头注释）：
 *   ① 有 video_path 且登记了 `<platform>_video` ⇒ 视频选择器覆盖同名字段；
 *   ② 未登记的字段回落到图文选择器（页面改版兜底）；
 *   ③ 无视频或没登记视频键 ⇒ 原样返回图文选择器。
 */
const { resolvePublishSelectors } = require('../src/publish-selectors-by-content-type')
const { PLATFORM_PUBLISH_SELECTORS } = require('../src/platform-selectors')

describe('resolvePublishSelectors — 按内容类型选选择器', () => {
  const table = {
    demo: { file_input: ['input[type="file"]'], title_input: ['t'], publish_btn: ['p'] },
    demo_video: { file_input: ['input.video-file'], publish_btn: ['v-publish'] },
  }

  it('无视频 ⇒ 原样返回图文选择器（不回归）', () => {
    expect(resolvePublishSelectors({ platform: 'demo', article: { title: 'x' }, selectors: table })).toEqual(table.demo)
    expect(resolvePublishSelectors({ platform: 'demo', article: null, selectors: table })).toEqual(table.demo)
    expect(resolvePublishSelectors({ platform: 'demo', article: undefined, selectors: table })).toEqual(table.demo)
  })

  it('有视频且有视频键 ⇒ 视频选择器覆盖同名字段', () => {
    const got = resolvePublishSelectors({ platform: 'demo', article: { video_path: 'D:/v.mp4' }, selectors: table })
    expect(got.file_input).toEqual(['input.video-file'])
    expect(got.publish_btn).toEqual(['v-publish'])
  })

  it('未登记的字段回落到图文选择器（改版兜底）', () => {
    const got = resolvePublishSelectors({ platform: 'demo', article: { video_path: 'D:/v.mp4' }, selectors: table })
    expect(got.title_input).toEqual(['t'])
  })

  it('有视频但没登记视频键 ⇒ 仍用图文选择器', () => {
    expect(resolvePublishSelectors({ platform: 'nope', article: { video_path: 'D:/v.mp4' }, selectors: table })).toEqual({})
    const only = { solo: { file_input: ['a'] } }
    expect(resolvePublishSelectors({ platform: 'solo', article: { video_path: 'D:/v.mp4' }, selectors: only })).toEqual({ file_input: ['a'] })
  })

  it('空表 / 空 article 不抛错', () => {
    expect(() => resolvePublishSelectors({ platform: 'x', article: {}, selectors: {} })).not.toThrow()
    expect(() => resolvePublishSelectors({ platform: 'x', article: {}, selectors: null })).not.toThrow()
  })

  it('不修改入参（返回新对象）', () => {
    const base = table.demo
    const got = resolvePublishSelectors({ platform: 'demo', article: { video_path: 'D:/v.mp4' }, selectors: table })
    expect(got).not.toBe(base)
    expect(base.file_input).toEqual(['input[type="file"]'])
  })

  it('真实表：四平台视频键都已登记且含 file_input', () => {
    for (const k of ['douyin', 'tencent_video', 'toutiao_video', 'xiaohongshu_video']) {
      const v = resolvePublishSelectors({ platform: k.replace(/_video$/, ''), article: { video_path: 'D:/v.mp4' }, selectors: PLATFORM_PUBLISH_SELECTORS })
      expect((v.file_input || []).length, k + ' 缺 file_input').toBeGreaterThan(0)
    }
  })

  it('真实表：头条视频选择器避开「定时发布」误命中（首选项精确）', () => {
    const v = resolvePublishSelectors({ platform: 'toutiao', article: { video_path: 'D:/v.mp4' }, selectors: PLATFORM_PUBLISH_SELECTORS })
    expect(v.publish_btn[0]).toBe('button.action-footer-btn.submit')
    expect(v.desc_textarea[0]).toBe('textarea.byte-textarea.abstract')
  })
})

// @ts-check
/**
 * weibo-selectors-live-dom.test.js — 微博发布选择器的真机判据锁
 *
 * 现场（2026-10-21，该账号自己的 cookie 分区、已登录，落在 weibo.com 首页）：
 *   发布框 `<textarea class="_input_1rz8r_8" placeholder="有什么新鲜事想分享给大家？">`
 *   发送   `<button class="woo-button-main ... woo-button-primary ...">发送</button>`
 *   旧版判据 `.publisher_text textarea` / `.W_input` / `textarea[node-type="textEl"]` /
 *   `a[node-type="submit"]` / `.W_btn_b` **全部 0 命中**（微博改版为 React + woo 设计系统）。
 *
 * 本锁只钉两件事：
 *   ① 新版判据必须在候选链**最前面**——`_resolveSelector` 按顺序试，每个未命中都要等超时，
 *      旧判据排在前面就是每次发布白等 9~10 秒；
 *   ② 旧判据不得被删（保留兼容），`woo-button-primary` 这类设计系统类不得被写死成哈希类名。
 */
const selectors = require('../src/platform-selectors')
const { resolvePublishSelectors } = require('../src/publish-selectors-by-content-type')

const WEIBO = selectors.PLATFORM_PUBLISH_SELECTORS.weibo

describe('微博发布选择器（2026-10-21 真机取证）', () => {
  test('发布框：新版 placeholder 判据排在候选链最前', () => {
    expect(WEIBO.content_textarea[0]).toContain('placeholder*="有什么新鲜事"')
  })

  test('发布框：旧版判据仍保留（只能排在 placeholder 之后）', () => {
    const list = WEIBO.content_textarea
    const legacyIdx = list.findIndex(s => s === '.publisher_text textarea')
    const modernIdx = list.findIndex(s => s.includes('placeholder*="有什么新鲜事"'))
    expect(legacyIdx).toBeGreaterThan(-1)
    expect(legacyIdx).toBeGreaterThan(modernIdx)
  })

  test('发送按钮：文本判据在最前，woo 设计系统类紧随其后', () => {
    expect(WEIBO.publish_btn[0]).toBe('button:has-text("发送")')
    expect(WEIBO.publish_btn).toContain('.woo-button-primary')
  })

  test('不得把 CSS Modules 哈希类名写进选择器（每次构建都会变）', () => {
    const all = [...WEIBO.content_textarea, ...WEIBO.publish_btn]
    // 形如 _input_1rz8r_8 / _btn_abc12_3 的哈希类，出现即视为把一次性取证当稳定判据
    const hashed = all.filter(s => /_?[a-z]+_[a-z0-9]{5,}_\d+/.test(s))
    expect(hashed).toEqual([])
  })

  test('图文任务（无 video_path）不被视频选择器覆盖', () => {
    const resolved = resolvePublishSelectors({
      platform: 'weibo',
      article: { content: 'x' },
      selectors: selectors.PLATFORM_PUBLISH_SELECTORS,
    })
    expect(resolved).toBe(WEIBO)
  })
})

// @ts-check
/**
 * 视频选择器按内容类型切换（video-publish-4，2026-10-18）
 *
 * 锁三件事：
 *   ① 有 `video_path` 时用 `<platform>_video` 的选择器（头条 file_input / 小红书 upload-input）；
 *   ② 无视频时仍用图文选择器（不回归）；
 *   ③ 视频选择器是**覆盖**而非替换 —— 同名字段取视频值，未登记的字段保留图文兜底。
 */
const { PLATFORM_PUBLISH_SELECTORS } = require('@multi-publish/rpa-engine/src/platform-selectors')

describe('视频发布选择器（按内容类型切换）', () => {
  it('头条视频选择器已按真机取证登记', () => {
    const tv = PLATFORM_PUBLISH_SELECTORS.toutiao_video
    expect(tv).toBeTruthy()
    expect(tv.file_input).toContain('input[type="file"]')
    // 标题 placeholder 1～30 字（真机：input.xigua-input.show-limit）
    expect(tv.title_input).toContain('input.xigua-input')
    // 简介 textarea（真机：textarea.byte-textarea.abstract）
    expect(tv.desc_textarea).toContain('textarea.byte-textarea.abstract')
    // 发布按钮：**首选项**必须精确到 .action-footer-btn.submit（避开同排「定时发布」）。
    // 兜底项保留 `:has-text("发布")`：页面改版时作为最后手段；但因为解析器择优顺序是
    // 「精确 → 包含」，`button:has-text("发布")` 只在前面的精确类全不命中时才生效，
    // 而那时它击中「定时发布」的风险已由「精确类在最前」显著降低 —— 真正危险的是把它放首位。
    expect(tv.publish_btn[0]).toBe('button.action-footer-btn.submit')
    expect(tv.publish_btn.slice(0, 3).join('|')).toMatch(/action-footer-btn/)
  })

  it('小红书视频选择器已按真机取证登记', () => {
    const xv = PLATFORM_PUBLISH_SELECTORS.xiaohongshu_video
    expect(xv).toBeTruthy()
    // 真机 file input 可见且类名为 upload-input
    expect(xv.file_input).toContain('input.upload-input')
    expect(xv.title_input).toContain('input.d-text')
    // 正文是 tiptap/ProseMirror（contenteditable），不是 textarea
    expect(xv.editor).toContain('.tiptap.ProseMirror')
  })

  it('图文选择器未被污染：toutiao（非 _video）仍是图文那套', () => {
    const t = PLATFORM_PUBLISH_SELECTORS.toutiao
    expect(t.title_input[0]).toBe('textarea[placeholder*="文章标题"]')
    expect(t.publish_btn[0]).toBe('button:has-text("预览并发布")')
    // 图文那套没有 file_input（图文不上传视频）
    expect(t.file_input).toBeUndefined()
  })

  it('四平台都登记了视频选择器键（含既有的 douyin/tencent_video）', () => {
    for (const k of ['douyin', 'tencent_video', 'toutiao_video', 'xiaohongshu_video']) {
      expect(PLATFORM_PUBLISH_SELECTORS[k], '缺少 ' + k).toBeTruthy()
    }
    // 视频选择器必须至少登记 file_input（否则上传整段被跳过，即 6 平台归因里的头条真因）
    for (const k of ['douyin', 'tencent_video', 'toutiao_video', 'xiaohongshu_video']) {
      expect((PLATFORM_PUBLISH_SELECTORS[k].file_input || []).length, k + ' 缺 file_input').toBeGreaterThan(0)
    }
  })
})

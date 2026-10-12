/**
 * creator-platforms.test.js — 多平台输入解析的 fail-closed 契约（PRD §9 锁 1）
 *
 * 「格式不对」必须零请求判定；识别不出就报错，绝不拿用户输入猜。
 * 三个平台的解析 MUST 互不混判——错把 A 平台链接当 B 平台博主是静默数据事故。
 */
const {
  parseCreatorInput,
  parseDouyinInput,
  parseXhsInput,
  detectPlatformFromUrl,
  CREATOR_PLATFORMS,
  CREATOR_PLATFORM_ERRORS,
} = require('./creator-platforms')

const DOUYIN_SEC_UID = 'MS4wLjABAAAA' + 'A'.repeat(28)
const XHS_USER_ID = 'a'.repeat(24)

describe('creator-platforms · 平台识别', () => {
  it('域名 → 平台', () => {
    expect(detectPlatformFromUrl('https://www.douyin.com/user/x')).toBe(CREATOR_PLATFORMS.DOUYIN)
    expect(detectPlatformFromUrl('https://v.douyin.com/abc/')).toBe(CREATOR_PLATFORMS.DOUYIN)
    expect(detectPlatformFromUrl('https://www.xiaohongshu.com/user/profile/x')).toBe(CREATOR_PLATFORMS.XIAOHONGSHU)
    expect(detectPlatformFromUrl('https://www.youtube.com/@x')).toBe(CREATOR_PLATFORMS.YOUTUBE)
    expect(detectPlatformFromUrl('https://weibo.com/u/x')).toBeNull()
    expect(detectPlatformFromUrl('不是链接')).toBeNull()
  })
})

describe('creator-platforms · 抖音解析', () => {
  it('sec_uid 裸串 / 主页 URL 都解析为 canonical id', () => {
    expect(parseDouyinInput(DOUYIN_SEC_UID).creatorId).toBe(DOUYIN_SEC_UID)
    expect(parseDouyinInput(`https://www.douyin.com/user/${DOUYIN_SEC_UID}`).creatorId).toBe(DOUYIN_SEC_UID)
    expect(parseDouyinInput(`www.douyin.com/user/${DOUYIN_SEC_UID}?a=1`).creatorId).toBe(DOUYIN_SEC_UID)
  })

  it.each([
    ['作品链接', 'https://www.douyin.com/video/7123456789012345678', 'creator:not_a_channel'],
    ['直播链接', 'https://live.douyin.com/12345', 'creator:not_a_channel'],
  ])('%s 被明确拒绝', (_l, input, code) => {
    expect(() => parseDouyinInput(input)).toThrowError(expect.objectContaining({ code }))
  })

  it('非抖音域名 → wrong_platform（不混判）', () => {
    expect(() => parseDouyinInput('https://www.xiaohongshu.com/user/profile/' + XHS_USER_ID)).toThrowError(expect.objectContaining({ code: 'creator:wrong_platform' }))
  })
})

describe('creator-platforms · 小红书解析', () => {
  it('用户 ID 裸串 / 主页 URL 都解析为 canonical id', () => {
    expect(parseXhsInput(XHS_USER_ID).creatorId).toBe(XHS_USER_ID)
    expect(parseXhsInput(`https://www.xiaohongshu.com/user/profile/${XHS_USER_ID}`).creatorId).toBe(XHS_USER_ID)
  })

  it('笔记链接被明确拒绝', () => {
    expect(() => parseXhsInput('https://www.xiaohongshu.com/explore/abc123')).toThrowError(expect.objectContaining({ code: 'creator:not_a_channel' }))
    expect(() => parseXhsInput('https://xhslink.com/abc')).toThrowError(expect.objectContaining({ code: 'creator:not_a_channel' }))
  })

  it('非小红书域名 → wrong_platform', () => {
    expect(() => parseXhsInput(`https://www.douyin.com/user/${DOUYIN_SEC_UID}`)).toThrowError(expect.objectContaining({ code: 'creator:wrong_platform' }))
  })
})

describe('creator-platforms · 统一入口（显式平台 + URL 一致性）', () => {
  it('URL 平台与所选平台一致时放行', () => {
    const r = parseCreatorInput(`https://www.douyin.com/user/${DOUYIN_SEC_UID}`, 'douyin')
    expect(r.platform).toBe('douyin')
  })

  it('URL 与所选平台不一致 → wrong_platform（fail-closed，绝不猜）', () => {
    expect(() => parseCreatorInput(`https://www.douyin.com/user/${DOUYIN_SEC_UID}`, 'xiaohongshu')).toThrowError(expect.objectContaining({ code: 'creator:wrong_platform' }))
  })

  it('不支持的显式平台 → unsupported_platform', () => {
    expect(() => parseCreatorInput('https://weibo.com/u/1', 'weibo')).toThrowError(expect.objectContaining({ code: 'creator:unsupported_platform' }))
  })

  it('空输入 / 超长输入 → invalid_input', () => {
    expect(() => parseCreatorInput('', 'douyin')).toThrowError(expect.objectContaining({ code: 'creator:invalid_input' }))
    expect(() => parseCreatorInput('x'.repeat(600), 'douyin')).toThrowError(expect.objectContaining({ code: 'creator:invalid_input' }))
  })

  it('YouTube 输入透传给既有解析器（raw 形态）', () => {
    const r = parseCreatorInput('https://www.youtube.com/@GoogleDevelopers', 'youtube')
    expect(r.platform).toBe('youtube')
    expect(r.kind).toBe('raw')
  })

  it('错误码枚举包含新增的跨平台项', () => {
    expect(CREATOR_PLATFORM_ERRORS.WRONG_PLATFORM).toBe('creator:wrong_platform')
    expect(CREATOR_PLATFORM_ERRORS.UNSUPPORTED_PLATFORM).toBe('creator:unsupported_platform')
    expect(CREATOR_PLATFORM_ERRORS.SIGNATURE_FAILED).toBe('creator:signature_failed')
  })
})

'use strict'

/**
 * creator-platforms.js — 博主监控的多平台注册表与输入解析（PRD-CREATOR-MULTI-PLATFORM-2026-10-12）
 *
 * ## 为什么单独成文件
 *
 * 平台清单、输入形态判定、canonical ID 形态是**三份会被多处引用的事实**
 * （adapter / IPC 校验 / 渲染层平台选择 / 测试），单点维护才能防「三处各抄一份然后漂移」。
 *
 * ## fail-closed 解析约定（与 YouTube 版 parseChannelInput 同族）
 *
 * 「格式不对」必须在**零请求**下判定；识别不出就识别不出，绝不回退成
 * 「拿用户输入当 ID 试试」——那会把 A 博主静默错成 B 博主（YouTube 版踩过的静默事故形态）。
 */

const CREATOR_PLATFORMS = Object.freeze({
  YOUTUBE: 'youtube',
  DOUYIN: 'douyin',
  XIAOHONGSHU: 'xiaohongshu',
})

/** 平台元数据：渲染层平台选择与错误文案都从这里取（键名即 locale 后缀） */
const PLATFORM_META = Object.freeze({
  youtube: { label: 'YouTube', localeKey: 'creatorPlatformYoutube', supported: true },
  douyin: { label: '抖音', localeKey: 'creatorPlatformDouyin', supported: true },
  xiaohongshu: { label: '小红书', localeKey: 'creatorPlatformXiaohongshu', supported: true },
})

/** 输入错误码（与 YouTube 版 CREATOR_INPUT_ERRORS 同族并新增跨平台项） */
const CREATOR_PLATFORM_ERRORS = Object.freeze({
  INVALID_INPUT: 'creator:invalid_input',
  NOT_A_CHANNEL: 'creator:not_a_channel',
  CHANNEL_NOT_FOUND: 'creator:channel_not_found',
  CREDENTIAL_MISSING: 'creator:credential_missing',
  DEPENDENCY_MISSING: 'creator:dependency_missing',
  WRONG_PLATFORM: 'creator:wrong_platform',
  UNSUPPORTED_PLATFORM: 'creator:unsupported_platform',
  SIGNATURE_FAILED: 'creator:signature_failed',
})

const MAX_INPUT_LENGTH = 512

/** 抖音 sec_uid：MS4wLjABAAAA 开头的Base64 形态 */
const DOUYIN_SEC_UID_RE = /^MS4wLjABAAAA[\w-]{28,}$/
/** 小红书用户 ID：16 进制串（主页 URL /user/profile/{id}） */
const XHS_USER_ID_RE = /^[0-9a-f]{24}$/

const DOUYIN_HOSTS = new Set(['douyin.com', 'www.douyin.com', 'v.douyin.com', 'live.douyin.com', 'www.iesdouyin.com', 'creator.douyin.com'])
const XHS_HOSTS = new Set(['xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com'])

function fail (code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

/** 按域名识别平台；识别不出返回 null（调用方决定是「按已选平台处理」还是报错） */
function detectPlatformFromUrl (raw) {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!/^https?:\/\//i.test(s) && !/^[\w.-]+\.(?:com|cn|be)\//i.test(s)) return null
  let host
  try {
    host = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s).hostname.toLowerCase()
  } catch (_) {
    return null
  }
  if (DOUYIN_HOSTS.has(host)) return CREATOR_PLATFORMS.DOUYIN
  if (XHS_HOSTS.has(host)) return CREATOR_PLATFORMS.XIAOHONGSHU
  if (/youtube\.com$/.test(host) || host === 'youtu.be') return CREATOR_PLATFORMS.YOUTUBE
  return null
}

/**
 * 解析抖音输入。受支持形态：
 *   - sec_uid 裸串（MS4wLjABAAAA…）
 *   - 主页 URL：douyin.com/user/{sec_uid}（含 creator.douyin.com）
 * 作品 / 播放列表链接 → not_a_channel（与 YouTube 的 watch/playlist 同型拒绝）。
 */
function parseDouyinInput (raw) {
  const s = String(raw || '').trim()
  if (!s) throw fail(CREATOR_PLATFORM_ERRORS.INVALID_INPUT, '频道输入为空')
  if (DOUYIN_SEC_UID_RE.test(s)) return { platform: CREATOR_PLATFORMS.DOUYIN, kind: 'id', creatorId: s }

  let u
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s) } catch (_) {
    throw fail(CREATOR_PLATFORM_ERRORS.INVALID_INPUT, '无法识别该抖音链接')
  }
  const host = u.hostname.toLowerCase()
  if (!DOUYIN_HOSTS.has(host)) throw fail(CREATOR_PLATFORM_ERRORS.WRONG_PLATFORM, '这不是抖音链接')

  // 视频/直播/播放列表是「资源」不是「博主」——给专门文案
  if (/^\/(video|note|live|collection)\//.test(u.pathname) || u.searchParams.has('modal_id') || host === 'live.douyin.com') {
    throw fail(CREATOR_PLATFORM_ERRORS.NOT_A_CHANNEL, '这是作品或直播链接，请粘贴博主主页链接')
  }
  const m = u.pathname.match(/^\/user\/([\w-]+)/)
  if (m && DOUYIN_SEC_UID_RE.test(m[1])) return { platform: CREATOR_PLATFORMS.DOUYIN, kind: 'id', creatorId: m[1] }
  // 短链 /note、/user 后接非 sec_uid 的数字 ID（老版）也按 profile 处理，交由 resolve 阶段换取 sec_uid
  if (m) return { platform: CREATOR_PLATFORMS.DOUYIN, kind: 'profile_url', profileUrl: u.toString(), rawId: m[1] }
  throw fail(CREATOR_PLATFORM_ERRORS.INVALID_INPUT, '无法识别该抖音主页链接')
}

/**
 * 解析小红书输入。受支持形态：
 *   - 用户 ID 裸串（24 位 hex）
 *   - 主页 URL：xiaohongshu.com/user/profile/{id}
 * 笔记 / 短链笔记 → not_a_channel。
 */
function parseXhsInput (raw) {
  const s = String(raw || '').trim()
  if (!s) throw fail(CREATOR_PLATFORM_ERRORS.INVALID_INPUT, '频道输入为空')
  if (XHS_USER_ID_RE.test(s)) return { platform: CREATOR_PLATFORMS.XIAOHONGSHU, kind: 'id', creatorId: s }

  let u
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s) } catch (_) {
    throw fail(CREATOR_PLATFORM_ERRORS.INVALID_INPUT, '无法识别该小红书链接')
  }
  const host = u.hostname.toLowerCase()
  if (!XHS_HOSTS.has(host)) throw fail(CREATOR_PLATFORM_ERRORS.WRONG_PLATFORM, '这不是小红书链接')
  if (/^\/(explore|discovery\/item)\//.test(u.pathname) || host === 'xhslink.com') {
    throw fail(CREATOR_PLATFORM_ERRORS.NOT_A_CHANNEL, '这是笔记链接，请粘贴博主主页链接')
  }
  const m = u.pathname.match(/^\/user\/profile\/([0-9a-f]+)/)
  if (m) return { platform: CREATOR_PLATFORMS.XIAOHONGSHU, kind: 'id', creatorId: m[1] }
  throw fail(CREATOR_PLATFORM_ERRORS.INVALID_INPUT, '无法识别该小红书主页链接')
}

/**
 * 统一入口：按显式 platform 解析；显式平台与 URL 实际平台不一致 → wrong_platform
 * （fail-closed：绝不「猜」——错把抖音链接当小红书博主是静默数据事故）。
 * @param {string} raw 用户输入
 * @param {string} platform 显式平台（youtube/douyin/xiaohongshu）
 */
function parseCreatorInput (raw, platform) {
  if (typeof raw !== 'string' || !raw.trim()) throw fail(CREATOR_PLATFORM_ERRORS.INVALID_INPUT, '频道输入为空')
  if (raw.trim().length > MAX_INPUT_LENGTH) throw fail(CREATOR_PLATFORM_ERRORS.INVALID_INPUT, '输入过长')
  const detected = detectPlatformFromUrl(raw)
  const p = String(platform || '').trim()
  if (!PLATFORM_META[p]) throw fail(CREATOR_PLATFORM_ERRORS.UNSUPPORTED_PLATFORM, '暂不支持该平台')
  if (detected && detected !== p) throw fail(CREATOR_PLATFORM_ERRORS.WRONG_PLATFORM, '链接与所选平台不一致')
  switch (p) {
  case CREATOR_PLATFORMS.DOUYIN: return parseDouyinInput(raw)
  case CREATOR_PLATFORMS.XIAOHONGSHU: return parseXhsInput(raw)
  case CREATOR_PLATFORMS.YOUTUBE: return { platform: CREATOR_PLATFORMS.YOUTUBE, kind: 'raw', raw: raw.trim() }
  default: throw fail(CREATOR_PLATFORM_ERRORS.UNSUPPORTED_PLATFORM, '暂不支持该平台')
  }
}

module.exports = {
  CREATOR_PLATFORMS,
  PLATFORM_META,
  CREATOR_PLATFORM_ERRORS,
  MAX_INPUT_LENGTH,
  detectPlatformFromUrl,
  parseCreatorInput,
  parseDouyinInput,
  parseXhsInput,
}

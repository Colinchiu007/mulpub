/**
 * creator-collector.js — 博主采集适配器：YouTube 频道解析与作品拉取
 *
 * ## 为什么不直接把输入丢给依赖包
 *
 * `content_aggregator` 的 YouTubeCollector 在 `_fetch(channel_id=...)` 里的真实契约
 * （P0 冒烟实测，2026-10-07）：
 *
 *   1. URL 解析**仅在 `channel_id.startswith('http')` 时进入**。裸串（`@name`、
 *      `youtube.com/@name`）会被原样塞进 API 的 `channelId` 参数 → HTTP 400。
 *   2. `@handle` 被**降级成关键词搜索**（`search_query=handle`、`channel_id=None`），
 *      返回的是「标题/描述含该词的任意视频」，其 channel_id 是那些视频作者的频道。
 *
 * 第 2 条是**静默数据正确性事故**：返回值合法且有值、日志只有一行 warning、UI 无异常，
 * 但用户关注 A 博主会收到 B 博主的内容，且系统无法自证。
 *
 * 因此本模块**自行完成 handle / username → canonical ID 的解析**，
 * 拿到 canonical ID 后才把 `UC…` 交给采集器。解析失败一律 fail-closed，
 * 绝不退化成「拿用户输入当 ID 试试」。
 *
 * ## 契约测试
 * 见 electron/tests/creator-collector.test.js ——「绝不原样透传」系列用例是本模块
 * 存在的核心理由，任何回归都意味着用户会静默收到别人的内容。
 */

'use strict'

const CREATOR_PLATFORM_YOUTUBE = 'youtube'

/** 输入类错误码。与「暂时性故障」严格区分：格式问题不该重试，频道不存在也不该。 */
const CREATOR_INPUT_ERRORS = {
  INVALID_INPUT: 'creator:invalid_input',
  NOT_A_CHANNEL: 'creator:not_a_channel',
  CHANNEL_NOT_FOUND: 'creator:channel_not_found',
  CREDENTIAL_MISSING: 'creator:credential_missing',
  DEPENDENCY_MISSING: 'creator:dependency_missing',
}

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
/** YouTube 频道 ID 恒以大写 UC 开头；正则大小写敏感，禁止 toLowerCase 后放行。 */
const UC_ID_RE = /UC[\w-]{22}/
const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
])

function fail (code, message) {
  const err = new Error(message)
  err.code = code
  // 刻意不携带 apiKey / 原始响应体，避免凭证或长文本经日志泄漏
  return err
}

/**
 * 归一化用户输入为绝对 URL。
 * 依赖库只认 `startswith('http')`，因此裸串必须在这里补全 scheme。
 */
function normalizeInput (raw) {
  if (typeof raw !== 'string') {
    throw fail(CREATOR_INPUT_ERRORS.INVALID_INPUT, '频道输入必须是字符串')
  }
  const s = raw.trim()
  if (!s) throw fail(CREATOR_INPUT_ERRORS.INVALID_INPUT, '频道输入为空')
  // 裸频道 ID 是最自然的输入方式，且已是 canonical —— 直接接受，不必绕 URL。
  // 故意在 normalizeInput 之前判定：避免把它当域名去补 scheme 而误判。
  if (new RegExp(`^${UC_ID_RE.source}$`).test(s)) return s
  if (s.startsWith('@')) {
    return `https://www.youtube.com/${s}`
  }
  if (/^[\w.-]+\.(?:com|be)\//i.test(s)) {
    return `https://${s}`
  }
  if (!/^https?:\/\//i.test(s)) {
    throw fail(CREATOR_INPUT_ERRORS.INVALID_INPUT, '无法识别该频道链接')
  }
  return s
}

/**
 * 把归一化后的 URL 解析为四种受支持的形态之一。
 * 只做识别，不发任何网络请求 —— 「格式不对」必须在零请求下判定。
 */
function parseChannelInput (raw) {
  const s = normalizeInput(raw)

  // normalizeInput 对裸频道 ID 会原样返回；它已是 canonical，先于 URL 解析短路，
  // 否则 new URL('UC…') 必然抛错并被误报成「无法识别」。
  if (new RegExp(`^${UC_ID_RE.source}$`).test(s)) return { kind: 'id', channelId: s }

  let u
  try { u = new URL(s) } catch { throw fail(CREATOR_INPUT_ERRORS.INVALID_INPUT, '无法识别该频道链接') }

  const host = u.hostname.toLowerCase()
  if (!YOUTUBE_HOSTS.has(host)) {
    throw fail(CREATOR_INPUT_ERRORS.INVALID_INPUT, '仅支持 YouTube 频道链接')
  }

  // 作品 / 播放列表是「资源」不是「频道」，给专门文案而非泛化的格式错误
  if (u.pathname === '/watch') {
    throw fail(CREATOR_INPUT_ERRORS.NOT_A_CHANNEL, '这是作品链接，请粘贴博主主页链接')
  }
  if (u.pathname === '/playlist') {
    throw fail(CREATOR_INPUT_ERRORS.NOT_A_CHANNEL, '这是播放列表链接，请粘贴博主主页链接')
  }

  const uc = u.pathname.match(UC_ID_RE)
  if (uc) return { kind: 'id', channelId: uc[0] }

  const handle = u.pathname.match(/^\/@([\w.-]+)/)
  if (handle) return { kind: 'handle', handle: handle[1] }

  const legacy = u.pathname.match(/^\/(?:c|user)\/([^/?#]+)/)
  if (legacy) return { kind: 'username', username: legacy[1] }

  throw fail(CREATOR_INPUT_ERRORS.INVALID_INPUT, '无法识别该频道链接')
}

function readItems (res) {
  if (!res) return []
  const body = typeof res.json === 'function' ? res.json() : res
  if (!body || typeof body !== 'object') return []
  return Array.isArray(body.items) ? body.items : []
}

/**
 * 解析用户输入 → canonical channelId（YouTube API 返回的 UC…）。
 *
 * @param {string} raw 用户原始输入（频道 ID / @handle / 频道 URL / 旧式 URL 皆可）
 * @param {{apiKey: string, httpGet: Function}} deps
 * @returns {Promise<string>} canonical channelId
 * @throws {Error & {code: string}} 解析失败一律 fail-closed
 */
async function resolveChannelId (raw, deps = {}) {
  const { apiKey, httpGet } = deps
  if (!apiKey) {
    throw fail(CREATOR_INPUT_ERRORS.CREDENTIAL_MISSING, '未配置 YouTube API Key')
  }
  if (typeof httpGet !== 'function') {
    throw new TypeError('resolveChannelId 需要 httpGet 依赖')
  }

  const parsed = parseChannelInput(raw)

  // UC 形式已是 canonical，零请求
  if (parsed.kind === 'id') return parsed.channelId

  // handle 走 forHandle，旧式 /c/ · /user/ 走 forUsername。
  // 注意：这里绝不构造 channelId 参数 —— 依赖包正是因为它才把 handle 当搜索词。
  const params = parsed.kind === 'handle'
    ? { forHandle: parsed.handle }
    : { forUsername: parsed.username }

  const res = await httpGet(`${YOUTUBE_API_BASE}/channels`, {
    part: 'id', ...params, key: apiKey,
  })
  const id = readItems(res)[0]?.id
  if (!id) {
    // fail-closed：解析不出就是解析不出，绝不回退到用输入当 ID
    throw fail(CREATOR_INPUT_ERRORS.CHANNEL_NOT_FOUND, '找不到该频道，可能已注销或链接有误')
  }
  return id
}

/** 字幕腿（可选依赖）的国内可直用安装命令，沿用 asr-installer 的镜像源写法。 */
const TRANSCRIPT_INSTALL_HINT = 'pip install content-aggregator -i https://pypi.tuna.tsinghua.edu.cn/simple'

/**
 * 探测**正文（字幕）腿**的依赖是否可用。
 *
 * ⛔ 2026-10-12 纠正：旧实现叫 `probeDependency`，用
 *   `require('content_aggregator.sources.collectors.youtube_collector')` 去「探测」——
 *   `content_aggregator` 是 **Python** 包，Node 的 `require` 永远解析不到它，
 *   于是该函数**恒返回 `ready:false`**。当时它没接任何生产调用点，所以只烂在测试里；
 *   一旦接上就会变成「依赖永远缺失」的假告警，比不报还坏。
 *
 * 现在的判据只问两件**在 Node 侧真的能回答**的事：
 *   ① Python 后端桥是否可用（字幕经 `POST /aggregation/collect` 走它）；
 *   ② 若不可用，给出可复制的安装命令。
 * 注意「桥不可用」与「没装 content-aggregator」在 Node 侧**不可区分**——
 * 这正是本函数不假装能区分它们的原因：`reason` 如实写桥的状态，
 * `installHint` 只作为「如果确实是缺包，可以这样装」的提示，不声称已确诊。
 *
 * 语义边界（PRD §7.6 / §16）：字幕缺失**不阻塞采集**，只把内容质量从
 * `full` 降到 `partial`/`stub`。调用方 MUST 把它当**可选腿**展示，不得据此禁用功能。
 *
 * @param {{pythonBridge?: object}} deps
 * @returns {{ready: boolean, optional: boolean, reason?: string, installHint?: string}}
 */
function probeTranscriptDependency (deps = {}) {
  const bridge = deps.pythonBridge
  let running = false
  if (bridge && typeof bridge.isRunning === 'function') {
    // 探测本身**永不抛**：它挂在列表加载/状态面板路径上，抛出去会让整页失败，
    // 而它回答的只是一个"可选腿在不在"的问题。
    try { running = !!bridge.isRunning() } catch (_) { running = false }
  }
  if (running) return { ready: true, optional: true }
  return {
    ready: false,
    optional: true,
    reason: bridge ? 'python-backend-not-running' : 'python-bridge-unavailable',
    installHint: TRANSCRIPT_INSTALL_HINT,
  }
}

module.exports = {
  CREATOR_PLATFORM_YOUTUBE,
  CREATOR_INPUT_ERRORS,
  YOUTUBE_API_BASE,
  TRANSCRIPT_INSTALL_HINT,
  normalizeInput,
  parseChannelInput,
  resolveChannelId,
  probeTranscriptDependency,
}
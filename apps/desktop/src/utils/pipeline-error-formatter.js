// @ts-check
import { defaultProviderName, resolveProviderDisplayName } from './provider-name-map'
import zhLocale from '../locales/zh'
import enLocale from '../locales/en'
/**
 * pipeline-error-formatter.js — 流水线错误 → 用户可见自然语言格式化
 *
 * 职责：把流水线运行中产生的原始错误文本，匹配为已知模式，
 * 返回对应的 locale 消息键 + 参数，供 UI 层用 i18n 渲染。
 *
 * 与 user-facing-error.js 的区别：
 *   - user-facing-error.js 处理 IPC 错误（{ code, errorCode, message }）；
 *   - 本模块处理流水线 stages 产生的自由文本错误（raw string）。
 *
 * 解析顺序（严格，首个匹配即返回）：
 *   1. 按特征模式逐条匹配（优先级从具体到宽泛）
 *   2. 无法匹配时返回 operation_failed 兜底
 */
// 流水线错误文案的 locale 命名空间
const PIPELINE_ERROR_NS = 'story2video'

/**
 * 模式规则表：每条 { pattern, key, extract }
 *   pattern — 正则（匹配 raw error text）
 *   key     — locale 键（相对于 PIPELINE_ERROR_NS）
 *   extract — 可选函数(rawText, match) → { scene?, detail?, provider? } 提取模板变量
 *
 * 规则从上到下匹配，首个命中即返回。
 */
const RULES = [
  // 402 余额不足
  {
    pattern: /insufficient_balance_error|Error code:\s*402|error.*402.*insufficient/i,
    key: 'quota_exceeded',
    extract (raw) {
      const sceneMatch = raw.match(/场景\s*(\d+)/) || raw.match(/scene\s*(\d+)/i)
      const provider = resolveProviderDisplayName(raw)
      return { scene: sceneMatch ? sceneMatch[1] : '', provider }
    },
  },
  // 内容政策 / 需要用户输入
  {
    pattern: /needs_user_input|content[_ -]?policy.*review|需要.*修改文案|内容政策.*需要输入/i,
    key: 'needs_user_input',
    extract () { return {} },
  },
  // 视频合成超时
  {
    pattern: /compose.*timeout|视频合成超时|视频合成.*超时|composit.*timed?\s*out/i,
    key: 'compose_timeout',
    extract () { return {} },
  },
  // 视频时长超限
  {
    pattern: /超过.*分钟上限|视频.*时长.*超|exceeds?\s+the\s+\d+.*minute/i,
    key: 'compose_duration_exceeded',
    extract (raw) {
      const m = raw.match(/(\d+)\s*分钟/) || raw.match(/(\d+).*minute/)
      return { limitMinutes: m ? m[1] : '30' }
    },
  },
  // 供应商明确表示用量窗口已耗尽（必须先于通用 429）
  {
    pattern: /GoUsageLimitError|usage\s+limit\s+(?:has\s+been\s+)?(?:reached|exhausted|exceeded)|(?:\d+\s*[- ]?hour|daily|weekly|monthly)\s+usage\s+limit\s+(?:has\s+been\s+)?(?:reached|exhausted|exceeded)/i,
    key: 'quota_exceeded',
    extract (raw) {
      const sceneMatch = raw.match(/场景\s*(\d+)/) || raw.match(/scene\s*(\d+)/i)
      const provider = resolveProviderDisplayName(raw)
      return { scene: sceneMatch ? sceneMatch[1] : '', provider }
    },
  },
  // 频率/配额限制
  {
    pattern: /rate.?limit|too many requests|429|限流|频率.*限制|Error\s+code:\s*429|rpm\s+exhausted|429\s+Too\s+Many/i,
    key: 'rate_limited',
    extract (raw) { return { provider: resolveProviderDisplayName(raw) } },
  },
  // 图片生成多次没有返回结果
  {
    pattern: /repeatedly returned no result|多次未返回结果/i,
    key: 'empty_result',
    extract (raw) {
      const sceneMatch = raw.match(/(?:场景|scene)\s*(\d+)/i)
      return { scene: sceneMatch ? sceneMatch[1] : '', provider: resolveProviderDisplayName(raw) }
    },
  },
  // prompt-engine 服务不可用
  {
    pattern: /prompt-engine.*未运行|prompt-engine.*不可达|PromptBridge.*未注入|ECONNREFUSED.*8013|无法连接.*prompt/i,
    key: 'optimize_service_unavailable',
    extract () { return {} },
  },
  // 图片提供商参数不支持
  {
    pattern: /UnsupportedParamsError|unsupported.*param|不支持的参数/i,
    key: 'provider_params_unsupported',
    extract (raw) {
      const provider = resolveProviderDisplayName(raw)
      const paramMatch = raw.match(/Setting\s*'([^']+)'/i) || raw.match(/setting\s*"([^"]+)"/i)
      const param = paramMatch ? paramMatch[1] : ''
      return { provider, param }
    },
  },
  // 所选克隆音色不可用（2026-10-18）：后端稳定前缀 VOICE_CLONE_UNAVAILABLE 或供应商原文
  // "you don't have access to this voice_id"。必须早于 asset_generation_failed —— 事故里的原始错误
  // 以 "Asset scene generation failed: …" 开头，若落到后者会被误判成素材/API 配额问题（不可操作）。
  {
    pattern: /VOICE_CLONE_UNAVAILABLE|(?:don'?t|do not|cannot|can'?t)\s+have\s+access\s+to\s+(?:this\s+)?voice|voice_id[^\n]{0,40}(?:no\s+access|not\s+found|not\s+accessible)/i,
    key: 'voice_clone_unavailable',
    extract () { return {} },
  },
  // 图片/旁白生成失败（通用）
  {
    pattern: /Asset scene generation failed|素材.*生成失败|场景.*生成失败|image generation failed|tts generation failed/i,
    key: 'asset_generation_failed',
    extract (raw) {
      const ratioMatch = raw.match(/(\d+)\/(\d+)\s*scenes?\s+have\s+both/i)
      const scenes = ratioMatch ? ratioMatch[1] + '/' + ratioMatch[2] : ''
      const hasImageFail = /Image #\d+:/.test(raw)
      const hasTtsFail = /TTS #\d+:/.test(raw)
      let detail = ''
      if (hasImageFail && !hasTtsFail) detail = '@story2video.labels.imageGeneration'
      else if (hasTtsFail && !hasImageFail) detail = '@story2video.labels.ttsGeneration'
      else if (hasImageFail && hasTtsFail) detail = '@story2video.labels.bothGeneration'
      const provider = resolveProviderDisplayName(raw)
      return { scene: scenes, detail, provider }
    },
  },
  // 提示词优化失败（笼统）
  {
    pattern: /optimize failed|优化失败|optimize.*failed/i,
    key: 'optimize_failed',
    extract () { return {} },
  },
  // compose 预检失败：输入媒体总大小超限（2026-10-20 事故 error-message-user-friendly-audit）。
  // ⛔ 位置契约（CCG 外部评审 i6）：本规则**必须**排在下面的 compose_failed 之前。
  // 理由是「具体先于泛化」：像 `compose failed: Input media exceeds the total size limit` 这种
  // 同时命中两条规则的文本，应当落到具体的那条（能给体积/场景细节），而不是被泛化的
  // 「视频合成失败」吞掉。事故现场里 run.error 是纯英文
  // `Input media exceeds the total size limit`，既不匹配 compose_failed（无 "fail" 字样），
  // 长度又 <120 且无技术标记，于是被「短自然语言直出」分支原样透出到历史卡片。
  // 现在主进程已返回稳定 errorCode，但历史库存量数据只有英文原文，两条通道都要认。
  // 排序有回归锁：pipeline-error-formatter.test.js 的「规则顺序」用例。
  {
    pattern: /Input media exceeds the total size limit|input media exceeds.*(?:size|limit)|媒体总大小超过|输入媒体.*超过.*(?:上限|限制)/i,
    key: 'compose_input_size_exceeded',
    extract (raw) {
      // 体积对（<实际> > <上限> 或 <上限>，<实际>）→ limitMb / actualMb。
      // 体积对提取（CCG 外部评审 i8，2026-10-20）：
      // 上一版纯按出现顺序取「首个=actual、第二个=limit」，遇到
      // `limit 512MB, actual 780MB` 这种语序就会把上下限**对调**，用户读到相反的结论。
      // 现改为「锚点优先、顺序兜底」：先看哪个数字附近出现上限语义词
      // （limit / max / 上限 / 允许 / allowed），只有一个带锚点时按它定 limit，
      // 另一个即 actual；两个都带或都不带时才退回出现顺序（actual 在前更常见）。
      const sizeMatches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(KB|MB|GB)/gi)]
      if (sizeMatches.length >= 2) {
        // 锚点必须**紧贴**数字（中间只允许空白）：
        //   `allowed limit 512MB` / `上限 512MB` / `512MB limit` ⇒ 是上限
        //   `total size limit: 780MB > 512MB` ⇒ 不是（limit 后有冒号且语义在讲「这个上限」而非该数值）
        // 宽窗口会把「size limit」这类泛指词当成数值标签，反而把上下限对调（实测踩过两次）。
        const BEFORE_LIMIT = /(?:limit|max(?:imum)?|allowed|上限|允许|不超过|最多)\s*$/i
        const AFTER_LIMIT = /^\s*(?:limit|max(?:imum)?|上限)/i
        const isLimitLabelled = (m) => {
          const idx = m.index ?? 0
          const before = raw.slice(Math.max(0, idx - 12), idx)
          const after = raw.slice(idx + m[0].length, idx + m[0].length + 8)
          return BEFORE_LIMIT.test(before) || AFTER_LIMIT.test(after)
        }
        const limitHits = sizeMatches.map((m, i) => (isLimitLabelled(m) ? i : -1)).filter((i) => i >= 0)
        const norm = (m) => (m[1] + m[2]).replace(/\s+/g, '').toUpperCase()
        if (limitHits.length === 1) {
          const li = limitHits[0]
          const ai = li === 0 ? 1 : 0
          return { actualMb: norm(sizeMatches[ai]), limitMb: norm(sizeMatches[li]) }
        }
        return { actualMb: norm(sizeMatches[0]), limitMb: norm(sizeMatches[1]) }
      }
      const sceneMatch = raw.match(/(?:scene|场景)\s*(\d+)/i)
      return { scene: sceneMatch ? sceneMatch[1] : '' }
    },
  },
  // 视频合成失败
  {
    pattern: /compose.*fail|视频合成.*失败|composit.*fail/i,
    key: 'compose_failed',
    extract () { return {} },
  },
  // 通用：模型 API 错误（4xx/5xx）
  {
    pattern: /Error code:\s*(\d{3})/,
    key: 'api_error',
    extract (raw) {
      return { provider: resolveProviderDisplayName(raw) }
    },
  },
]

/**
 * 把流水线原始错误文本格式化为用户可见信息。
 *
 * @param {string} rawError - 流水线存储的原始错误文本
 * @param {object} [options]
 * @param {string} [options.locale='zh'] - 当前语言
 * @returns {{ message: string, key: string, params: object }}
 */

function resolveLocaleRef (ref, locale, params) {
  if (typeof ref !== 'string' || !ref.startsWith('@')) return ref
  const keyPath = ref.slice(1).split('.')
  const trees = { zh: zhLocale, en: enLocale }
  let node = trees[locale] || trees.zh
  for (const seg of keyPath) {
    node = node?.[seg]
    if (node == null) return ref
  }
  const resolved = typeof node === 'string' ? node : ref
  if (params && resolved.includes('{')) {
    return resolved.replace(/\{([^{}]+)\}/g, (_, k) => String(params[k] ?? ''))
  }
  return resolved
}

function formatContext (locale, scene, detail) {
  const parts = []
  if (scene) {
    const labelKey = String(scene).includes('/') ? 'sceneRatio' : 'sceneLabel'
    parts.push(resolveLocaleRef('@story2video.labels.' + labelKey, locale, { scene }))
  }
  if (detail) parts.push(detail)
  if (parts.length === 0) return ''
  return locale === 'en' ? ' (' + parts.join(', ') + ')' : '（' + parts.join('，') + '）'
}

export function formatPipelineError (rawError, options = {}) {
  const raw = String(rawError || '').trim()
  const locale = String(options.locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  if (!raw) {
    return { message: '', key: '', params: {} }
  }

  for (const rule of RULES) {
    const match = raw.match(rule.pattern)
    if (match) {
      const params = typeof rule.extract === 'function' ? rule.extract(raw, match) : {}
      const key = PIPELINE_ERROR_NS + '.' + rule.key
      const resolved = {}
      for (const [k, v] of Object.entries(params)) {
        if (k === 'scene' || k === 'detail') continue
        resolved[k] = resolveLocaleRef(v, locale, params)
      }
      const detail = params.detail ? resolveLocaleRef(params.detail, locale, params) : ''
      const context = formatContext(locale, params.scene, detail)
      resolved.context = context
      if (['rate_limited', 'quota_exceeded', 'empty_result', 'asset_generation_failed', 'provider_params_unsupported'].includes(rule.key)) {
        resolved.provider = resolved.provider || resolveLocaleRef(defaultProviderName(locale), locale, params)
      }
      if (rule.key === 'api_error') resolved.provider = resolved.provider || resolveLocaleRef(defaultProviderName(locale), locale, params)
      return { message: '', key, params: resolved }
    }
  }

  if (raw.length <= 120 && !/[{}\[\]]|Error code|ENOENT|ECONNREFUSED|at\s+|line\s+\d+/i.test(raw)) {
    return { message: raw, key: '', params: {} }
  }
  return { message: '', key: PIPELINE_ERROR_NS + '.operation_failed', params: {} }
}

export { PIPELINE_ERROR_NS, RULES }

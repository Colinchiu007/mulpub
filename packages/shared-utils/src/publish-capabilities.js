'use strict'
/**
 * publish-capabilities.js — 发布能力注册表（CJS，主进程/Node 侧单一真源）
 *
 * 数据单一来源：publish-capabilities.json（本目录）。渲染进程消费
 * publish-capabilities.browser.js（ESM 孪生版，读同一份 JSON），两版本导出
 * 同名同构（导出完整性测试锁定，先例 platform-definitions.browser.js）。
 *
 * 覆盖（openspec/changes/publish-capability-registry）：
 *   - PLATFORM_PUBLISH_META：15 平台 titleMode（title | caption）+ 内容限制
 *   - 无标题平台（titleMode=caption）：标题必须合并进描述首行（composeNoTitleDescription）
 *   - 语义分类：≥3 平台 → common；=2 → semiCommon；=1 → unique（计算属性，非手写标签）
 *   - status：implemented（本仓已实现）/ platform-capable（平台支持但未暴露，参考产品取证）
 *
 * 修改字段/新增平台时只改 JSON；本文件的函数层保持纯计算。
 */

const data = require('./publish-capabilities.json')

const PLATFORM_PUBLISH_META = Object.freeze(
  Object.fromEntries(Object.entries(data.platforms).map(([id, meta]) => [
    id,
    Object.freeze({
      titleMode: meta.titleMode,
      limits: Object.freeze({ ...meta.limits }),
    }),
  ]))
)

const NO_TITLE_PLATFORMS = Object.freeze(
  Object.keys(data.platforms).filter(id => data.platforms[id].titleMode === 'caption')
)

const COMMON_FORM_FIELDS = Object.freeze(
  data.commonFormFields.map(field => Object.freeze({ ...field, platforms: Object.freeze([...field.platforms]) }))
)

const OVERRIDE_FIELDS = Object.freeze(
  Object.fromEntries(Object.entries(data.overrideFields).map(([id, fields]) => [
    id,
    Object.freeze(fields.map(field => Object.freeze({ ...field }))),
  ]))
)

const VALID_TITLE_MODES = Object.freeze(['title', 'caption'])
const VALID_STATUSES = Object.freeze(['implemented', 'platform-capable'])

/**
 * 返回平台发布元数据副本（titleMode + limits），未知平台返回 null。
 * @param {unknown} platformId
 * @returns {{ titleMode: string, limits: { titleMax?: number, titleMaxBytes?: number, contentMax: number } } | null}
 */
function getPlatformPublishMeta (platformId) {
  const meta = PLATFORM_PUBLISH_META[String(platformId || '')]
  if (!meta) return null
  return { titleMode: meta.titleMode, limits: { ...meta.limits } }
}

/**
 * 平台是否无独立标题字段（titleMode=caption）。无标题平台发布时
 * 标题文本必须作为正文/描述首行插入（composeNoTitleDescription）。
 * @param {unknown} platformId
 * @returns {boolean}
 */
function isNoTitlePlatform (platformId) {
  return NO_TITLE_PLATFORMS.includes(String(platformId || ''))
}

/**
 * 无标题平台清单（冻结副本）。
 * @returns {string[]}
 */
function getNoTitlePlatforms () {
  return [...NO_TITLE_PLATFORMS]
}

/**
 * 平台内容限制（titleMax / titleMaxBytes / contentMax），与
 * publish-contract.getPlatformContentLimit 同构。注册表全覆盖 15 平台，
 * 未知平台回落默认（titleMax 100 / contentMax 5000）。
 * @param {unknown} platformId
 * @returns {{ titleMax?: number, titleMaxBytes?: number, contentMax: number }}
 */
function getPlatformContentLimit (platformId) {
  const meta = getPlatformPublishMeta(platformId)
  if (!meta) return { titleMax: 100, contentMax: 5000 }
  return { ...meta.limits }
}

/**
 * 平台差异化字段定义（副本）。仅返回 uiExposed && status=implemented
 * 的字段给 UI 渲染；全量字段（含 platform-capable）用于能力矩阵文档。
 * @param {unknown} platformId
 * @param {{ uiOnly?: boolean }} [options] uiOnly=true 时只返回可渲染字段
 * @returns {object[]}
 */
function getPlatformOverrideFields (platformId, options = {}) {
  const fields = OVERRIDE_FIELDS[String(platformId || '')] || []
  const list = options.uiOnly
    ? fields.filter(field => field.uiExposed && field.status === 'implemented')
    : [...fields]
  // 深拷贝（options 选项对象与 default 数组一并复制）：浅拷贝会让调用方通过
  // 返回值突变污染冻结的全局注册表（CCG 评审 W5 实锤：options 共享引用可突变）。
  return list.map(field => ({
    ...field,
    ...(Array.isArray(field.options) ? { options: field.options.map(option => ({ ...option })) } : {}),
    ...(Array.isArray(field.default) ? { default: [...field.default] } : {}),
  }))
}

// ─── P1-5 语义级可见性（通用控件）────────────────────────────────────────────
// 5 平台的 visibility 语义字段值各不相同（youtube privacy / tiktok privacyLevel /
// douyin visibilityType / kuaishou visibilityType / weibo visible），用户不应逐平台
// 理解平台取值。注册表每个 visibility 字段的 semanticValues 声明该平台的语义档位
// 映射（public/friends/private → 平台值）；本层是映射的单一真源，UI 与 resolver
// 一律经此处取值，禁止各写一份映射表。
const VISIBILITY_SEMANTICS = Object.freeze(['public', 'friends', 'private'])

/**
 * 平台的 visibility 语义字段定义（含 semanticValues），无该语义返回 null。
 * @param {unknown} platformId
 * @returns {object|null}
 */
function getVisibilityField (platformId) {
  const fields = OVERRIDE_FIELDS[String(platformId || '')] || []
  return fields.find(field => field.semantic === 'visibility') || null
}

/**
 * 语义档位 → 平台字段值的运行时映射。该平台不支持该档位（如快手/YouTube 无
 * 好友档）或档位非法一律返回 null（fail-closed，调用点据此跳过该平台）。
 * @param {unknown} platformId
 * @param {unknown} semantic public | friends | private
 * @returns {unknown|null}
 */
function mapVisibilitySemantic (platformId, semantic) {
  const key = String(semantic || '')
  if (!VISIBILITY_SEMANTICS.includes(key)) return null
  const field = getVisibilityField(platformId)
  if (!field || !field.semanticValues) return null
  const value = field.semanticValues[key]
  return value === undefined ? null : value
}

/**
 * 语义档位 → { fieldKey, value }（通用控件写 override 模型的完整指令）。
 * 平台不支持该档位返回 null。
 * @param {unknown} platformId
 * @param {unknown} semantic
 * @returns {{ fieldKey: string, value: unknown } | null}
 */
function resolveVisibilityOverride (platformId, semantic) {
  const field = getVisibilityField(platformId)
  if (!field) return null
  const value = mapVisibilitySemantic(platformId, semantic)
  if (value === null) return null
  return { fieldKey: field.key, value }
}

/**
 * 各语义档位支持的平台清单（通用控件渲染与能力矩阵用）。
 * @returns {{ public: string[], friends: string[], private: string[] }}
 */
function getVisibilitySemanticSupport () {
  const result = {}
  for (const semantic of VISIBILITY_SEMANTICS) {
    result[semantic] = Object.keys(OVERRIDE_FIELDS).filter(
      platformId => mapVisibilitySemantic(platformId, semantic) !== null
    )
  }
  return result
}

/**
 * 通用主表单字段支持矩阵（冻结副本）。
 * @returns {object[]}
 */
function getCommonFormFields () {
  return COMMON_FORM_FIELDS.map(field => ({ ...field, platforms: [...field.platforms] }))
}

/**
 * 计算某语义能力的平台支持情况（跨 commonFormFields + overrideFields 聚合）。
 * @param {string} semanticKey
 * @returns {{ count: number, platforms: string[], statuses: string[] }}
 */
function getFieldSupport (semanticKey) {
  const platforms = []
  const statuses = []
  for (const field of COMMON_FORM_FIELDS) {
    if (field.semantic === semanticKey) {
      platforms.push(...field.platforms)
      statuses.push('implemented')
    }
  }
  for (const platformId of Object.keys(OVERRIDE_FIELDS)) {
    for (const field of OVERRIDE_FIELDS[platformId]) {
      if (field.semantic === semanticKey) {
        platforms.push(platformId)
        statuses.push(field.status)
      }
    }
  }
  // 去重：同一语义可能同时出现在通用矩阵与该平台的覆盖字段（如 topics），
  // count 按唯一平台数计，与 classifyPublishFields 的计数口径一致。
  const unique = [...new Set(platforms)]
  return { count: unique.length, platforms: unique, statuses }
}

/**
 * 按语义能力分类全部发布字段（计算属性）：
 *   ≥3 平台 → common；=2 → semiCommon；=1 → unique。
 * 分类按语义（非字段名）聚合：YouTube privacy 与 TikTok privacyLevel 同属
 * visibility 语义，计入同一计数（用户 2026-10-08 确认的判定规则）。
 * @returns {{ common: object[], semiCommon: object[], unique: object[] }}
 *   每条目：{ semantic, count, platforms, statuses, label? }
 */
function classifyPublishFields () {
  const semantics = new Map()
  for (const field of COMMON_FORM_FIELDS) {
    if (!semantics.has(field.semantic)) {
      semantics.set(field.semantic, { semantic: field.semantic, label: field.label, platforms: [], statuses: [] })
    }
    const entry = semantics.get(field.semantic)
    entry.platforms.push(...field.platforms)
    entry.statuses.push('implemented')
  }
  for (const platformId of Object.keys(OVERRIDE_FIELDS)) {
    for (const field of OVERRIDE_FIELDS[platformId]) {
      if (!semantics.has(field.semantic)) {
        semantics.set(field.semantic, { semantic: field.semantic, label: field.label, platforms: [], statuses: [] })
      }
      const entry = semantics.get(field.semantic)
      entry.platforms.push(platformId)
      entry.statuses.push(field.status)
    }
  }

  const common = []
  const semiCommon = []
  const unique = []
  for (const entry of semantics.values()) {
    const platforms = [...new Set(entry.platforms)]
    const item = {
      semantic: entry.semantic,
      label: entry.label,
      count: platforms.length,
      platforms,
      statuses: [...entry.statuses],
    }
    if (platforms.length >= 3) common.push(item)
    else if (platforms.length === 2) semiCommon.push(item)
    else unique.push(item)
  }
  const byCountDesc = (a, b) => b.count - a.count || String(a.semantic).localeCompare(String(b.semantic))
  common.sort(byCountDesc)
  semiCommon.sort(byCountDesc)
  unique.sort(byCountDesc)
  return { common, semiCommon, unique }
}

/**
 * 无标题平台的描述合成：标题作为首行，正文随后，超长按 maxLen 截断
 * （标题优先存活——与 DOM RPA _composeEditorCaption 语义一致）。
 * 截断按 Unicode 码点进行，不切断代理对（emoji）。
 * @param {unknown} title
 * @param {unknown} content
 * @param {{ maxLen?: number }} [options] maxLen 非正数或缺省时不截断
 * @returns {string}
 */
function composeNoTitleDescription (title, content, options = {}) {
  const parts = [title, content]
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(value => value.length > 0)
  const composed = parts.join('\n')
  const maxLen = Number(options && options.maxLen)
  if (!(maxLen > 0)) return composed
  const chars = Array.from(composed)
  return chars.length > maxLen ? chars.slice(0, maxLen).join('') : composed
}

/**
 * 注册表结构自检（供测试与启动期 fail-fast 使用）。返回问题清单，空数组即健康。
 * @returns {string[]}
 */
function validateRegistry () {
  const problems = []
  const platformIds = Object.keys(data.platforms)
  for (const platformId of platformIds) {
    const meta = data.platforms[platformId]
    if (!VALID_TITLE_MODES.includes(meta.titleMode)) {
      problems.push(`${platformId}: 非法 titleMode ${meta.titleMode}`)
    }
    if (!(Number(meta.limits && meta.limits.contentMax) > 0)) {
      problems.push(`${platformId}: contentMax 必须为正数`)
    }
  }
  for (const platformId of Object.keys(data.overrideFields)) {
    if (!platformIds.includes(platformId)) {
      problems.push(`overrideFields 含未知平台 ${platformId}`)
    }
    for (const field of data.overrideFields[platformId]) {
      if (!VALID_STATUSES.includes(field.status)) {
        problems.push(`${platformId}.${field.key}: 非法 status ${field.status}`)
      }
      if (field.status === 'platform-capable' && !field.note) {
        problems.push(`${platformId}.${field.key}: platform-capable 字段必须带 note 证据`)
      }
      // P1-5：semanticValues 声明的平台值必须真实存在于该字段 options 中
      // （映射到不存在的值会在发布时被归一化回落，用户选择静默失效）
      if (field.semanticValues) {
        const optionValues = (field.options || []).map(option => option.value)
        for (const [semantic, value] of Object.entries(field.semanticValues)) {
          if (!optionValues.some(optionValue => optionValue === value)) {
            problems.push(`${platformId}.${field.key}: semanticValues.${semantic} 值 ${JSON.stringify(value)} 不在 options 中`)
          }
        }
      }
    }
  }
  for (const field of data.commonFormFields) {
    for (const platformId of field.platforms) {
      if (!platformIds.includes(platformId)) {
        problems.push(`commonFormFields.${field.key}: 未知平台 ${platformId}`)
      }
    }
  }
  return problems
}

/**
 * oss-b1-rpa-hardening（2026-10-14）：RPA 窗口 stealth preload 变体解析。
 * enhanced = 主世界 evasions 注入（douyin/xiaohongshu/shipinhao 高风控平台）；
 * baseline = 现状（隔离世界 patch，对其他平台足够）。未登记平台回落 baseline。
 * @param {string} platformId
 * @returns {'enhanced' | 'baseline'}
 */
function getPreloadVariant (platformId) {
  const rc = (data && data.riskControl) || {}
  const table = rc.preloadVariant || {}
  const v = platformId && table[platformId]
  return v === 'enhanced' ? 'enhanced' : (rc.defaultPreloadVariant === 'enhanced' ? 'enhanced' : 'baseline')
}

/** 验证码自动破解白名单（默认关，PRD v1.1 §2 法务基线） */
function isCaptchaAutoSolveEnabled (platformId) {
  const rc = (data && data.riskControl) || {}
  const wl = rc.captchaAutoSolveWhitelist || []
  return !!(platformId && wl.includes(platformId))
}

module.exports = {
  PLATFORM_PUBLISH_META,
  NO_TITLE_PLATFORMS,
  getPlatformPublishMeta,
  isNoTitlePlatform,
  getNoTitlePlatforms,
  getPlatformContentLimit,
  getPlatformOverrideFields,
  getCommonFormFields,
  getFieldSupport,
  classifyPublishFields,
  composeNoTitleDescription,
  validateRegistry,
  // P1-5 语义级可见性
  getVisibilityField,
  mapVisibilitySemantic,
  resolveVisibilityOverride,
  getVisibilitySemanticSupport,
  // oss-b1-rpa-hardening 风控配置
  getPreloadVariant,
  isCaptchaAutoSolveEnabled,
}

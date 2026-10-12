/**
 * topic-tag-presets.js — 常用话题标签预设存储（topic-tag-unify，PRD §4.3-4.4 / §7）
 *
 * 单一真源：分组/话题的持久化结构、归一化与容错判据全部收在本模块，
 * 弹窗组件只做渲染与交互，不得自抄第二份校验（P4 DRY / publish-topic-inline 同例）。
 *
 * localStorage 结构 v1：
 *   { version: 1, groups: [{ id, name, topics: string[] }] }
 * 话题条目就是字符串（无 id/link——参考产品蚂参考产品的 {id,name,link} 是平台
 * API 联想结构，本地常用标签无平台绑定，不引入死字段）。
 */

export const STORAGE_KEY = 'mp_topic_tag_presets'
export const PRESETS_VERSION = 1

const MAX_GROUP_NAME_LEN = 30
const MAX_TOPIC_NAME_LEN = 30

/** 与 topic-inline 的 normalizeTopicName 同口径：剥 # 与全部空白 */
function stripTopicName (value) {
  return String(value == null ? '' : value).replace(/[#\s]+/g, '')
}

/**
 * 归一化分组名：trim、非空、截断 30 字符。
 * @param {unknown} name
 * @returns {string} 非法返回空串
 */
export function normalizeGroupName (name) {
  const text = String(name == null ? '' : name).trim()
  if (!text) return ''
  return Array.from(text).slice(0, MAX_GROUP_NAME_LEN).join('')
}

/**
 * 归一化组内话题列表：剥 # 与空白、过滤空值与非字符串、去重、单个截断 30。
 * @param {unknown} topics
 * @returns {string[]}
 */
export function normalizeGroupTopics (topics) {
  const list = Array.isArray(topics) ? topics : []
  const out = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const name = stripTopicName(raw)
    if (!name || out.includes(name)) continue
    out.push(Array.from(name).slice(0, MAX_TOPIC_NAME_LEN).join(''))
  }
  return out
}

/**
 * 生成分组 id（时间戳 + 随机段，本地唯一即可）。
 * @returns {string}
 */
export function createGroupId () {
  return 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

/**
 * 归一化分组数组（写入侧与读取侧共用同一条校验）：
 * 坏组逐个丢弃（缺 name / name 非法 / topics 非数组），同名组（trim+lowercase）
 * 保留先出现者，缺 id 的补新 id。
 * @param {unknown} groups
 * @returns {{ id: string, name: string, topics: string[] }[]}
 */
function normalizeGroups (groups) {
  const list = Array.isArray(groups) ? groups : []
  const out = []
  const seenNames = new Set()
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const name = normalizeGroupName(raw.name)
    if (!name || !Array.isArray(raw.topics)) continue
    const key = name.toLowerCase()
    if (seenNames.has(key)) continue
    seenNames.add(key)
    out.push({
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createGroupId(),
      name,
      topics: normalizeGroupTopics(raw.topics),
    })
  }
  return out
}

/**
 * 读取预设。任何异常（JSON 损坏 / 结构非法 / localStorage 不可用）都返回空结构，
 * 不向上抛错——坏数据不值得阻断发布页主流程（publish-fail-draft-guard 同哲学）。
 * @returns {{ version: number, groups: { id: string, name: string, topics: string[] }[] }}
 */
export function loadTopicTagPresets () {
  const EMPTY = { version: PRESETS_VERSION, groups: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY
    if (parsed.version !== PRESETS_VERSION) return EMPTY
    return { version: PRESETS_VERSION, groups: normalizeGroups(parsed.groups) }
  } catch (error) {
    console.warn('[topic-tag-presets] load failed:', error && error.message)
    return EMPTY
  }
}

/**
 * 写入预设。输入先归一（坏数据进不来），写失败（QuotaExceeded 等）静默 warn。
 * @param {{ name: string, topics: string[], id?: string }[]} groups
 * @returns {boolean} 是否写入成功
 */
export function saveTopicTagPresets (groups) {
  try {
    // normalizeGroups 已产出纯结构（无 proxy/undefined），直接序列化即可
    const payload = { version: PRESETS_VERSION, groups: normalizeGroups(groups) }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch (error) {
    console.warn('[topic-tag-presets] save failed:', error && error.message)
    return false
  }
}

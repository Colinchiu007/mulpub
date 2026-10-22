// @ts-check
/**
 * useCopyLibrary — 文案库数据层（采集正文 + 改写文案）
 *
 * 存储契约：
 * - 采集正文**不复制存储**：文案库列表由 `collected_items`（采集记录既有 settings key）
 *   在读取时实时合成，保持单一数据源，避免「双写漂移」与正文重复占用空间。
 * - 改写文案持久化在 settings key `copy_library_rewrites`，与采集记录同层，按登录用户隔离
 *   （store:get-setting / store:set-setting 自带 owner 命名空间）。
 * - 同一来源（fromKey）只保留最新一次改写结果：重复改写同一篇文案是「更新」而非「追加」，
 *   避免文案库被同一原文的多次改写刷屏。
 *
 * fromKey 形态：
 * - `collect:<采集记录 id>`   —— 由采集正文发起改写
 * - `rewrite:<改写记录 id>`   —— 由已有改写文案再次改写（链式改写）
 *
 * 改写记录字段：{ id, fromKey, fromTitle, title, content, wordCount, platform, sourceUrl, createdAt }
 */
import { ref } from 'vue'
import { storeGetSetting, storeSetSetting } from '@/api/publisher'
import { countRewriteChars } from '@/utils/rewrite-engine-limits'

/** 改写文案持久化键名（与采集记录 collected_items 分离存储） */
export const COPY_REWRITES_KEY = 'copy_library_rewrites'
/** 文案性质标识：采集 */
export const ORIGIN_COLLECT = 'collect'
/** 文案性质标识：改写 */
export const ORIGIN_REWRITE = 'rewrite'
/** 改写文案上限（超出时丢弃最旧记录，防止 settings 无限膨胀） */
export const MAX_COPY_REWRITES = 200

/**
 * M-5 修复：模块级写串行队列。
 *
 * 缺陷：upsertRewrite / removeRewrite 都是「读 → 内存构造 → 写」三步，
 * 中间无互斥。两个调用的读阶段一旦重叠，就会读到同一份 current，
 * 各自算出一个 next，后写者**静默覆盖**先写者 —— 用户保存的两条文案丢一条，
 * 界面毫无提示。采集页与文案库面板各持一份 composable 实例
 * （见 readCurrent 的注释），正是并发写的现实来源。
 *
 * 为什么放模块级而不是实例级：两个实例之间才是竞态双方，
 * 放实例级等于没加防护。
 *
 * 防链中毒：链节内部一律 catch 后返回固定结果，
 * 保证 writeChain 永不进入 rejected 态 —— 否则某次写入失败会让
 * 后续所有写入被静默跳过。
 */
let writeChain = Promise.resolve()
/** 标题/来源标题截断长度 */
const TITLE_LIMIT = 200

/**
 * 解析 settings 中的数组值。
 * @returns {Array|null} null 表示「读取不可用或无数据」（调用方应保留现有值）
 */
export function parseCopyRewriteRaw (raw) {
  if (raw == null) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function genId () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function truncate (value, limit) {
  return String(value == null ? '' : value).slice(0, limit)
}

/**
 * 合并采集正文与改写文案为统一的文案库列表。
 * 排序：有 createdAt 的按时间倒序在前；无时间的保持原相对顺序排在末尾（同 key 相对顺序稳定）。
 * @param {Array} collectedItems - 采集记录（collected_items）
 * @param {Array} rewrites - 改写记录（copy_library_rewrites）
 */
export function buildCopyLibraryItems (collectedItems, rewrites) {
  const collect = (Array.isArray(collectedItems) ? collectedItems : [])
    .filter((it) => it && it.id && (it.content || it.description))
    .map((it) => ({
      id: ORIGIN_COLLECT + ':' + it.id,
      sourceId: it.id,
      origin: ORIGIN_COLLECT,
      title: it.title || '',
      content: it.content || it.description || '',
      wordCount: Number(it.wordCount) || (it.content || '').length,
      platform: it.platform || '',
      sourceUrl: it.sourceUrl || '',
      createdAt: it.createdAt || it.collectedAt || it.created_at || '',
      fromTitle: '',
    }))

  const rewrite = (Array.isArray(rewrites) ? rewrites : [])
    .filter((it) => it && it.id && it.content)
    .map((it) => ({
      id: ORIGIN_REWRITE + ':' + it.id,
      sourceId: it.id,
      origin: ORIGIN_REWRITE,
      title: it.title || '',
      content: it.content,
      wordCount: Number(it.wordCount) || it.content.length,
      platform: it.platform || '',
      sourceUrl: it.sourceUrl || '',
      createdAt: it.createdAt || '',
      fromTitle: it.fromTitle || '',
    }))

  return [...rewrite, ...collect].sort(compareByCreatedAtDesc)
}

/** 按 createdAt 倒序比较（无时间的排末尾，保持稳定）；供文案库合并视图复用 */
export function compareByCreatedAtDesc (a, b) {
  const ka = a.createdAt || ''
  const kb = b.createdAt || ''
  if (!ka && !kb) return 0
  if (!ka) return 1
  if (!kb) return -1
  return kb.localeCompare(ka)
}

export function useCopyLibrary () {
  const rewrites = ref([])
  const loaded = ref(false)

  /** 从 settings 载入改写文案列表（读取不可用时保持现状） */
  async function load () {
    const parsed = parseCopyRewriteRaw(await storeGetSetting(COPY_REWRITES_KEY))
    if (parsed) rewrites.value = parsed
    loaded.value = true
    return rewrites.value
  }

  /**
   * 读取当前持久化列表：优先磁盘（避免跨组件内存副本互相覆盖——采集页与文案库面板
   * 各自持有一份 composable 实例，只用内存会丢对方的写入）。
   */
  async function readCurrent () {
    const parsed = parseCopyRewriteRaw(await storeGetSetting(COPY_REWRITES_KEY))
    if (parsed) return parsed
    return rewrites.value
  }

  /**
   * 写入/更新一条改写文案（同一 fromKey 覆盖）。
   * @param {{ fromKey?: string, fromTitle?: string, title?: string, content: string, platform?: string, sourceUrl?: string }} entry
   * @returns {Promise<object|null>} 落库后的记录；content 为空时返回 null（不写入）
   */
  async function upsertRewrite (entry) {
    const content = String((entry && entry.content) || '').trim()
    if (!content) return null
    const fromKey = String((entry && entry.fromKey) || '')
    // M-5：整段 read-modify-write 挂进写队列，保证两个实例的读不会重叠。
    // 链节内部 catch 后返回 null —— 失败不阻断后续写入，也不让链进入 rejected 态。
    const run = async () => {
      try {
        const current = await readCurrent()
        const existing = fromKey ? current.find((it) => it && it.fromKey === fromKey) : null
        const record = {
          id: (existing && existing.id) || (entry && entry.id) || genId(),
          fromKey,
          fromTitle: truncate(entry && entry.fromTitle !== undefined && entry.fromTitle !== null && entry.fromTitle !== "" ? entry.fromTitle : (existing && existing.fromTitle) || "", TITLE_LIMIT),
          title: truncate(entry && entry.title, TITLE_LIMIT),
          content,
          // 字数按**码点**计（feat-zhihu-fav-batch-wordcount，外部评审 i4）：与引擎/Python 口径一致，
          // 否则同一段带 emoji 的改写稿在文案库卡片与采集结果卡片上会显示不同数字。
          wordCount: countRewriteChars(content),
          platform: truncate(entry && entry.platform, 50),
          sourceUrl: truncate(entry && entry.sourceUrl, 2048),
          createdAt: new Date().toISOString(),
        }
        const kept = fromKey ? current.filter((it) => it && it.fromKey !== fromKey) : current.slice()
        const next = [record, ...kept].slice(0, MAX_COPY_REWRITES)
        await storeSetSetting(COPY_REWRITES_KEY, JSON.stringify(next))
        rewrites.value = next
        return record
      } catch (_) {
        return null
      }
    }
    writeChain = writeChain.then(run, run)
    return writeChain
  }

  /** 删除一条改写文案（按记录 id） */
  async function removeRewrite (id) {
    const run = async () => {
      try {
        const current = await readCurrent()
        const next = current.filter((it) => !it || it.id !== id)
        await storeSetSetting(COPY_REWRITES_KEY, JSON.stringify(next))
        rewrites.value = next
        return next
      } catch (_) {
        return rewrites.value
      }
    }
    writeChain = writeChain.then(run, run)
    return writeChain
  }

  /** 重置内存态（测试用） */
  function reset () {
    rewrites.value = []
    loaded.value = false
  }

  return { rewrites, loaded, load, upsertRewrite, removeRewrite, reset }
}

/** 采集正文改写时的 fromKey（供采集页与文案库面板共用，保证两端 key 一致） */
export function collectFromKey (collectItemId) {
  return ORIGIN_COLLECT + ':' + String(collectItemId == null ? '' : collectItemId)
}

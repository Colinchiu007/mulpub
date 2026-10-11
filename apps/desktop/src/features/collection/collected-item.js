/**
 * collected-item.js — 采集条目的统一归一化（2026-10-03）
 *
 * 为什么要有这个文件：Collection.vue 里有 **9 处**独立的
 * `collectedItems.value.unshift({...})` 构造条目，每处字段齐全程度不同（批量
 * 采集轮询那条最不完整）。加一个字段最容易漏掉其中几处 —— 漏了的表现是
 * 「这条采集内容打不了类别标签」，而用户无法区分是功能坏了还是自己没设置。
 *
 * 因此：**所有构造点必须走 normalizeCollectedItem**，本模块是唯一出口。
 *
 * 类别标签的存储字段沿用既有的 `tags`（不新增 `category`）：
 * Collection.vue:1671 的爆款库导出已经在读 `item.tags`，另起一个字段会让
 * 「采集库里的标签」与「导出到爆款库的标签」直接漂移。
 */

import { CATEGORY_KEY_RE } from '@/features/content/content-categories'

/** 单条目类别标签上限 */
export const MAX_ITEM_CATEGORY_TAGS = 5

/**
 * 归一类别标签：去重 + 丢弃非法 key + 截断。
 * 未知类别 key **保留**（与账号分组同策略）：运营后续新增该类别后引用自动恢复，
 * 渲染时若类别已删除则显示为「已删除类别」且不参与筛选。
 * @param {unknown} raw
 * @param {{ knownCategoryKeys?: string[] }} [ctx]
 * @returns {{ tags: string[], dropped: string[], unknown: string[] }}
 */
export function normalizeItemTags (raw, ctx = {}) {
  const dropped = []
  const unknown = []
  if (raw === undefined || raw === null) return { tags: [], dropped, unknown }

  if (!Array.isArray(raw)) {
    // 显式给了非数组：不当空处理就静默丢数据，故记一笔由调用方出声
    return { tags: [], dropped: [String(raw)], unknown, invalid: true }
  }

  const list = raw.filter((t) => typeof t === 'string')
  for (const t of raw) {
    if (typeof t !== 'string') dropped.push(String(t))
  }
  const tags = [...new Set(list.filter((t) => CATEGORY_KEY_RE.test(t)))]
  for (const t of list) {
    if (!CATEGORY_KEY_RE.test(t)) dropped.push(t)
  }
  if (tags.length > MAX_ITEM_CATEGORY_TAGS) {
    for (const t of tags.slice(MAX_ITEM_CATEGORY_TAGS)) dropped.push(t)
  }
  const kept = tags.slice(0, MAX_ITEM_CATEGORY_TAGS)
  if (Array.isArray(ctx.knownCategoryKeys)) {
    for (const t of kept) {
      if (!ctx.knownCategoryKeys.includes(t)) unknown.push(t)
    }
  }
  return { tags: kept, dropped, unknown, invalid: false }
}

/**
 * 归一采集条目：补齐必填字段，保证任何构造路径产出的条目形状一致。
 * @param {object|null} raw
 * @param {{ knownCategoryKeys?: string[] }} [ctx]
 */
export function normalizeCollectedItem (raw, ctx = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const tagResult = normalizeItemTags(src.tags, ctx)
  const content = String(src.content || '')
  return {
    id: src.id || newItemId(),
    title: String(src.title || ''),
    content,
    description: String(src.description || '').slice(0, 120) || content.slice(0, 120),
    coverImage: String(src.coverImage || ''),
    publishTime: String(src.publishTime || ''),
    source: String(src.source || 'url'),
    sourceUrl: String(src.sourceUrl || ''),
    wordCount: Number(src.wordCount) || Number(src.word_count) || content.length,
    platform: String(src.platform || ''),
    author: String(src.author || ''),
    engagement: (src.engagement && typeof src.engagement === 'object') ? src.engagement : undefined,
    createdAt: String(src.createdAt || src.collectedAt || src.created_at || ''),
    // 类别标签：沿用既有 tags 字段（爆款库导出已在读它，另起字段必然漂移）
    tags: tagResult.tags,
    _droppedTags: tagResult.dropped.length ? tagResult.dropped : undefined,
    // 2026-10-03 知乎收藏批量（PRD-ZHIHU-FAV-BATCH）：批量链路新增字段
    kind: String(src.kind || ''),
    favTime: Number(src.favTime) || 0,
    images: Array.isArray(src.images) ? src.images : [],
    imageFallbacks: Array.isArray(src.imageFallbacks) ? src.imageFallbacks : [],
    rewrittenContent: typeof src.rewrittenContent === 'string' && src.rewrittenContent ? src.rewrittenContent : undefined,
    rewriteFailed: src.rewriteFailed === true,
    // 快捷采集溯源（quick-collect，2026-10-11）：只读；落盘后仍可读用于展示"来自哪条指令"。
    // 非对象归一为 undefined —— 宁可少一个徽章，也不要把脏对象写进采集库。
    quickCollect: (src.quickCollect && typeof src.quickCollect === 'object') ? src.quickCollect : undefined,
  }
}

function newItemId () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * 读取条目的类别标签（兼容缺失字段的历史数据）。
 * @param {object} item
 */
export function itemTags (item) {
  return Array.isArray(item && item.tags) ? item.tags : []
}

// 博主监控页签按钮的 re-export：让 Collection.vue 一行 import 拿到目录内两个成员，
// 省下的那 1 行是它的 targets 零容差（2920/2920）唯一的腾挪空间。
export { default as CollectionCreatorTab } from './CollectionCreatorTab.vue'

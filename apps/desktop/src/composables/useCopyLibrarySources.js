// @ts-check
/**
 * useCopyLibrarySources — 文案库全来源聚合层（2026-09-19，一级菜单文案库）
 *
 * 聚合 4 个文案来源（均为只读聚合，不复制存储，保持各来源单一数据源）：
 * - collect ：采集正文（collected_items settings key，实时合成）
 * - rewrite ：改写文案（copy_library_rewrites settings key，复用 useCopyLibrary）
 * - draft   ：草稿（drafts settings key，含热门选题页文案创作产物）
 * - video   ：视频创作文案（story2video 项目 sourceText，经 story2videoListProjects）
 *
 * 统一条目形状（UNIFIED_ITEM）：
 * { id, origin, title, content, wordCount, platform, sourceUrl, createdAt, metadata }
 *
 * 边界：
 * - sourceText 预览截断 SOURCE_PREVIEW_LIMIT（500 字），全文按需走 story2videoGetProject
 * - 单源加载失败不阻塞其余来源（Promise.allSettled 语义）
 * - 不做内容级去重：同正文跨阶段（采集→草稿→发布）是不同业务实体，按来源独立展示
 */
import { ref } from 'vue'
import { storeGetSetting } from '@/api/publisher'
import { draftList, story2videoListProjects } from '@/api/publisher'
import {
  COPY_REWRITES_KEY,
  ORIGIN_COLLECT,
  ORIGIN_REWRITE,
  compareByCreatedAtDesc,
  parseCopyRewriteRaw,
} from './useCopyLibrary'

/** 文案性质标识：草稿（含热门选题创作产物） */
export const ORIGIN_DRAFT = 'draft'
/** 文案性质标识：视频创作文案（story2video sourceText） */
export const ORIGIN_VIDEO = 'video'
/** 视频文案预览截断长度（sourceText 单条可达 100KB，必须截断防渲染压力） */
export const SOURCE_PREVIEW_LIMIT = 500
/** 采集正文 settings key（与 Collection.vue 保持一致） */
const COLLECTED_ITEMS_KEY = 'collected_items'

/** 解析 settings 数组值：null 表示读取不可用（保留现有值），非数组回退 [] */
function parseSettingArray (raw) {
  if (raw == null) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 安全截断：null/undefined 归一空串 */
function truncateText (value, limit) {
  return String(value == null ? '' : value).slice(0, limit)
}

/**
 * 把 4 个来源的原始数据映射为统一条目形状。
 * 纯函数（不依赖 Vue），供 composable 与测试共用。
 * @param {{ collectedItems?: Array, rewrites?: Array, drafts?: Array, videoProjects?: Array }} sources
 * @returns {Array<object>} UNIFIED_ITEM 列表（createdAt 倒序）
 */
export function buildUnifiedCopyLibraryItems (sources = {}) {
  const collect = (Array.isArray(sources.collectedItems) ? sources.collectedItems : [])
    .filter((it) => it && it.id && (it.content || it.description))
    .map((it) => ({
      id: ORIGIN_COLLECT + ':' + it.id,
      origin: ORIGIN_COLLECT,
      title: truncateText(it.title, 200),
      content: String(it.content || it.description || ''),
      wordCount: Number(it.wordCount) || (it.content || '').length,
      platform: truncateText(it.platform, 50),
      sourceUrl: truncateText(it.sourceUrl, 2048),
      createdAt: it.createdAt || it.collectedAt || it.created_at || '',
      metadata: {},
    }))

  const rewrite = (Array.isArray(sources.rewrites) ? sources.rewrites : [])
    .filter((it) => it && it.id && it.content)
    .map((it) => ({
      id: ORIGIN_REWRITE + ':' + it.id,
      origin: ORIGIN_REWRITE,
      title: truncateText(it.title, 200),
      content: it.content,
      wordCount: Number(it.wordCount) || it.content.length,
      platform: truncateText(it.platform, 50),
      sourceUrl: truncateText(it.sourceUrl, 2048),
      createdAt: it.createdAt || '',
      metadata: { fromTitle: it.fromTitle || '' },
    }))

  const draft = (Array.isArray(sources.drafts) ? sources.drafts : [])
    .filter((it) => it && it.id && (it.content || it.title))
    .map((it) => ({
      id: ORIGIN_DRAFT + ':' + it.id,
      origin: ORIGIN_DRAFT,
      title: truncateText(it.title, 200),
      content: String(it.content || it.title || ''),
      wordCount: Number(it.wordCount) || (it.content || '').length,
      platform: truncateText(it.platform, 50),
      sourceUrl: '',
      createdAt: it.createdAt || it.created_at || '',
      metadata: {},
    }))

  const video = (Array.isArray(sources.videoProjects) ? sources.videoProjects : [])
    .filter((it) => it && it.projectId && (it.sourceText || it.title))
    .map((it) => {
      const fullText = String(it.sourceText || '')
      return {
        id: ORIGIN_VIDEO + ':' + it.projectId,
        origin: ORIGIN_VIDEO,
        title: truncateText(it.title, 200),
        content: fullText.slice(0, SOURCE_PREVIEW_LIMIT),
        wordCount: fullText.length,
        platform: '',
        sourceUrl: '',
        createdAt: it.updatedAt || it.createdAt || '',
        metadata: { videoProjectId: it.projectId, truncated: fullText.length > SOURCE_PREVIEW_LIMIT },
      }
    })

  return [...rewrite, ...collect, ...draft, ...video].sort(compareByCreatedAtDesc)
}

/**
 * 文案库全来源聚合 composable。
 * @returns {{ items: import('vue').Ref<Array>, loading: import('vue').Ref<boolean>, loadAll: Function }}
 */
export function useCopyLibrarySources () {
  const items = ref([])
  const loading = ref(false)

  /** 并行拉取 4 源；单源失败不阻塞（该源按空处理） */
  async function loadAll () {
    loading.value = true
    try {
      const [collectedRaw, rewritesRaw, draftsRes, videoRes] = await Promise.allSettled([
        storeGetSetting(COLLECTED_ITEMS_KEY),
        storeGetSetting(COPY_REWRITES_KEY),
        draftList(),
        story2videoListProjects(),
      ])

      const collectedItems = collectedRaw.status === 'fulfilled' ? (parseSettingArray(collectedRaw.value) || []) : []
      const rewrites = rewritesRaw.status === 'fulfilled' ? (parseCopyRewriteRaw(rewritesRaw.value) || []) : []

      let drafts = []
      if (draftsRes.status === 'fulfilled' && draftsRes.value && draftsRes.value.code === 0 && Array.isArray(draftsRes.value.data)) {
        drafts = draftsRes.value.data
      }

      let videoProjects = []
      if (videoRes.status === 'fulfilled' && videoRes.value && videoRes.value.code === 0 && Array.isArray(videoRes.value.data)) {
        videoProjects = videoRes.value.data
      }

      items.value = buildUnifiedCopyLibraryItems({ collectedItems, rewrites, drafts, videoProjects })
      return items.value
    } finally {
      loading.value = false
    }
  }

  return { items, loading, loadAll }
}

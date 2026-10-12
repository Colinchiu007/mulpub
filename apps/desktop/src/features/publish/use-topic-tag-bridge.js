/**
 * use-topic-tag-bridge.js — 话题标签统一（topic-tag-unify）发布页接线
 *
 * 从 Publish.vue 抽出（逐文件行数门禁点名还账，零增长容差）：
 * 弹窗开合与写入目标记录、#添加话题（描述末尾追加 # + 聚焦）、
 * 常用话题标签应用（单篇/批量目标各自经既有追加管道写入）。
 * 语义真源在 features/publish/topic-inline.js 与 topic-tag-presets.js，本层只做视图接线。
 */
import { ref, nextTick } from 'vue'
import { appendHashToContent } from '@/features/publish/topic-inline'
import { normalizePublishStringList } from '@/features/publish/publish-contract'

/**
 * @param {object} options
 * @param {Record<string, unknown>} options.article 单篇 article（reactive）
 * @param {{ value: Array }} options.articles 批量条目数组（ref）
 * @param {(prev: string[], next: string[]) => void} options.syncTopicsToContent 单篇追加管道
 * @param {(item: object, value: string) => void} options.setBatchTagsText 批量写入 setter
 * @param {(key: string, params?: object) => void} options.notifySuccess toast
 */
export function useTopicTagBridge ({
  article,
  articles,
  syncTopicsToContent,
  setBatchTagsText,
  notifySuccess,
}) {
  const showTopicTagManager = ref(false)
  const topicTagTarget = ref({ mode: 'single', idx: -1 })

  /** 打开管理弹窗并记录应用目标（single=单篇，batch=articles[idx]） */
  function openTopicTagManager (mode, idx = -1) {
    topicTagTarget.value = { mode, idx }
    showTopicTagManager.value = true
  }

  /**
   * 描述框聚焦 + 光标置尾：#添加话题 的动作反馈就是光标处出现 '#'（参考产品同款）。
   * 覆盖图文编辑器（ArticleEditor 内 textarea）与视频描述（data-testid=publish-desc）。
   */
  function focusContentEnd () {
    nextTick(() => {
      const el = document.querySelector(
        '[data-testid="publish-editor"] textarea, [data-testid="publish-desc"] textarea, [data-testid="publish-desc"]',
      )
      const target = el && (el.matches('textarea') ? el : el.querySelector?.('textarea')) || el
      if (!target || typeof target.focus !== 'function') return
      target.focus()
      const end = (target.value || '').length
      if (typeof target.setSelectionRange === 'function') target.setSelectionRange(end, end)
    })
  }

  /** #添加话题（单篇）：只在描述末尾追加 '#'，话题名由用户输入 */
  function appendHashToDescription () {
    article.content = appendHashToContent(article.content)
    focusContentEnd()
  }

  /** #添加话题（批量目标=该篇） */
  function appendBatchHash (batchArticle) {
    if (!batchArticle) return
    batchArticle.content = appendHashToContent(batchArticle.content)
  }

  /**
   * 常用话题标签「确定应用」：names 经既有追加管道写入目标
   * （normalizePublishStringList 去重防双份；描述同步 #话题 词边界去重）。
   */
  function applyTopicTagPreset (names) {
    const list = Array.isArray(names) ? names.filter(name => typeof name === 'string' && name.trim()) : []
    showTopicTagManager.value = false
    if (list.length === 0) return
    if (topicTagTarget.value.mode === 'batch') {
      const item = articles.value[topicTagTarget.value.idx]
      if (item) {
        const merged = normalizePublishStringList([...normalizePublishStringList(item.tagsText), ...list])
        setBatchTagsText(item, merged.join(','))
        notifySuccess('publishPage.topicTag.applied', { params: { count: list.length } })
      }
      return
    }
    const prev = normalizePublishStringList(article.tags)
    article.tags = normalizePublishStringList([...prev, ...list])
    syncTopicsToContent(prev, article.tags)
    notifySuccess('publishPage.topicTag.applied', { params: { count: list.length } })
  }

  return {
    showTopicTagManager,
    topicTagTarget,
    openTopicTagManager,
    appendHashToDescription,
    appendBatchHash,
    applyTopicTagPreset,
  }
}

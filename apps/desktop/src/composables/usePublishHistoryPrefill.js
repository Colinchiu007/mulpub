/**
 * usePublishHistoryPrefill — 历史视频跳转的 query 预填充（`?video_path=` 一族）
 *
 * 从 `Publish.vue` 原样搬出（该视图是逐文件行数门禁点名的超大文件，行数门禁要求零增长容差）。
 * 逻辑未改：query 双重编码（跳转方 encode + vue-router 再 encode）→ 循环解码到稳定 →
 * 写入 `article`；tags 为逗号分隔字符串。
 */
import { normalizePublishStringList } from '@/features/publish/publish-contract'

/**
 * @param {object} deps
 * @param {object} deps.route
 * @param {Record<string, unknown>} deps.article 发布表单（就地修改）
 * @param {{value: string}} deps.activeMode 图文/视频模式开关
 * @param {(prev: string[], next: string[]) => void} deps.syncTopicsToContent 话题追加管道
 */
export function usePublishHistoryPrefill (deps) {
  const { route, article, activeMode, syncTopicsToContent } = deps

  function decode (value) {
    if (typeof value !== 'string' || !value) return ''
    // 双重编码最多需 2 次解码（跳转方 encode + vue-router 序列化再 encode）。
    // 上限取 2：再多解一层会把单次编码值里合法的 %XX 序列（如真实标题 A%41B）
    // 过度解码成 AAB，损坏文案。相等即 break，天然终止，无死循环风险。
    let result = value
    for (let i = 0; i < 2; i++) {
      try {
        const next = decodeURIComponent(result)
        if (next === result) break
        result = next
      } catch {
        break
      }
    }
    return result
  }

  /** 无 `video_path` query 时自行早退，不会覆盖用户缓存中的既有草稿 */
  function applyHistoryVideoQuery () {
    const query = route.query || {}
    const videoPath = decode(query.video_path)
    if (!videoPath) return
    activeMode.value = 'video'
    article.video_path = videoPath
    const title = decode(query.title)
    if (title) article.title = title
    const content = decode(query.content)
    if (content) article.content = content
    const tags = decode(query.tags)
    if (tags) {
      const prev = normalizePublishStringList(article.tags)
      article.tags = normalizePublishStringList(tags)
      // 历史视频跳转携带的标签同样经追加管道带入描述
      syncTopicsToContent(prev, normalizePublishStringList(article.tags))
    }
    // 历史视频发布走视频首帧封面，不携带自定义封面（百家号 API 不支持）
    article.cover_url = ''
    article.cover_path = ''
    article.cover_file = null
  }

  return { applyHistoryVideoQuery, decodeHistoryVideoValue: decode }
}

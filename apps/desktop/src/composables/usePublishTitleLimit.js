// @ts-check
/**
 * usePublishTitleLimit — 发布标题的「20 字上限 + 实时计数」（2026-10-18）。
 *
 * 为什么抽出来：`Publish.vue` 是 `check-max-lines` 里**点名还账、零增长容差**的文件
 * （targets 钉死在 1773 行）。把上限/计数/截断 watcher 直接写进视图会撑破这条红线；
 * 抽成 composable 后视图侧只留一行调用。
 *
 * 口径统一在 `features/publish/title-limits`：
 *   - 计数与截断都按 **Unicode 码点**（emoji 算 1 字），避免「显示 19/20 却被拦」；
 *   - 不用原生 maxlength 作为唯一手段（它按 UTF-16 单元算，与码点口径不同）。
 *
 * @param {{title?: string}} article 发布表单的 reactive 对象（就地截断其 title）
 * @returns {{titleMaxLength: number, titleCharCount: import('vue').ComputedRef<number>}}
 */
import { computed, watch } from 'vue'
import { PUBLISH_TITLE_MAX, countTitleCodePoints, truncateTitleByCodePoints } from '@/features/publish/title-limits'

export function usePublishTitleLimit (article) {
  const titleCharCount = computed(() => countTitleCodePoints(article?.title))
  // 直接返回「可绑到 UiInput:hint」的成品文案：视图侧只需 :hint="titleHint"，
  // 不必在模板里多写一个 <p>（Publish.vue 零增长容差，省一行是一行）。
  const titleHint = computed(() => `${titleCharCount.value}/${PUBLISH_TITLE_MAX}`)

  watch(
    () => article?.title,
    (value) => {
      if (!article) return
      const text = typeof value === 'string' ? value : ''
      const clamped = truncateTitleByCodePoints(text, PUBLISH_TITLE_MAX)
      if (clamped !== text) article.title = clamped
    },
  )

  return { titleMaxLength: PUBLISH_TITLE_MAX, titleCharCount, titleHint }
}

/**
 * 视频模式「标题来源」提示（fix-hot-topics-genvideo-title）。
 *
 * 热门选题「生成视频 → 去发布」会在 query 带 `title_source` / `title_reason`
 * 说明标题怎么来的；本函数把三态映射成提示文案，无来源信息一律返回空串
 * （不渲染节点，避免污染其它入口）。
 *
 * 抽成 composable 的理由同 `usePublishTitleLimit`：`Publish.vue` 零增长容差，
 * 这段三态映射原本占了 12 行视图代码。
 *
 * @param {'video'|'article'} activeMode 当前发布模式
 * @param {{query?: object}} route vue-router 的 route
 * @param {(key: string) => string} t i18n 的 t
 * @returns {import('vue').ComputedRef<string>}
 */
export function usePublishVideoTitleHint (activeMode, route, t) {
  return computed(() => {
    if (activeMode.value !== 'video') return ''
    const source = String(route.query?.title_source || '')
    if (source !== 'ai' && source !== 'topic') return ''
    if (source === 'ai') return t('publishPage.videoTitleFromAi')
    const reason = String(route.query?.title_reason || '')
    if (reason === 'no-model') return t('publishPage.videoTitleFromTopicNoModel')
    // topic 但缺 reason（异常/手改 query）：按失败态提示，不静默
    return t('publishPage.videoTitleFromTopicFailed')
  })
}

// @ts-check
/**
 * 按内容类型合并发布选择器（video-publish-4，2026-10-18）
 *
 * ## 为什么抽这里
 *
 * `apps/desktop/electron/services/rpa-view-platforms.js` 在仓库「点名还账」清单内
 * （零增长容差，目标 1484 行），而这段合并逻辑要写清「为什么按内容类型选」的取证注释 ——
 * 放在那个文件里会直接把熔断顶穿。放在 `rpa-engine`（选择器的单一事实源旁边）
 * 既不放大学号文件，也让「图文选择器兜底 / 视频选择器覆盖」这条规则可被单测直击。
 *
 * ## 规则
 *
 * 1. `article.video_path` 存在且登记了 `<platform>_video` ⇒ 用视频选择器；
 * 2. 合并方式是**覆盖同名字段**：视频键优先，未登记的字段回落到图文选择器；
 * 3. 无视频或没登记视频键 ⇒ 原样返回图文选择器（不回归）。
 */

/**
 * @param {object} params
 * @param {string} params.platform
 * @param {object|null} params.article 发布物料（可能没有 video_path）
 * @param {object} params.selectors 表的全量映射（PLATFORM_PUBLISH_SELECTORS）
 * @returns {object} 该平台本次发布要用的选择器
 */
function resolvePublishSelectors ({ platform, article, selectors }) {
  const table = selectors || {}
  const base = table[platform] || {}
  const wantsVideo = !!(article && article.video_path)
  if (!wantsVideo) return base
  const video = table[platform + '_video']
  if (!video) return base
  return Object.assign({}, base, video)
}

module.exports = { resolvePublishSelectors }

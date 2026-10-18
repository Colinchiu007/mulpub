// @ts-check
import { PLATFORM_SOURCE_URLS, PLATFORM_NAMES } from '@multi-publish/shared-utils/src/platform-definitions'

/**
 * 采集页「素材来源」快捷入口的打开动作。
 *
 * ## 为什么不用 PLATFORM_DASHBOARD_URLS
 *
 * 那张表是「创作者后台 / 发布目的地」，同时被
 *   · Accounts.vue 卡片点击 → openCreatorCenter
 *   · electron/publishers/http-login-checker.js（登录态 DOM 校验的目标页）
 *   · electron/publishers/account-manager.js
 * 复用。采集页这三个按钮的语义是「去哪**找素材**」（看别人的热门内容挑选题），
 * 与「去哪**发内容**」是相反的，共用一张表必然有一边错。
 *
 * ## 2026-10-17 真机复核（真实 Chromium，独立无 Cookie context）
 *
 * | 卡片 | 来源 id | URL | 实测结论 |
 * |---|---|---|---|
 * | 微博热搜 | weibo | https://s.weibo.com/top/summary | 200，榜单 30 条渲染，可匿名浏览 |
 * | 百度热搜 | baidu | https://top.baidu.com/board?tab=realtime | 200，服务端直出榜单，可匿名浏览 |
 * | 今日头条 | toutiao | https://www.toutiao.com/ | 200，右侧「头条热榜」模块渲染 1-50 名 |
 *
 * 被替换掉的两条（**不得改回去**）：
 *   · 知乎 https://www.zhihu.com/hot —— 最终跳到 /account/unhuman?...&need_login=true
 *     （安全验证页），实名制强制登录才给看，采集页没有它的卡。
 *   · 头条 https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc —— 这是**数据接口**，
 *     浏览器直接打开是一屏 JSON 文本（2026-10-17 用户实测即此形态），不是可浏览页面；
 *     官方没有渲染版热榜页（/hot/、/trending/ 均 404）。
 *
 * ## 为什么单独维护显示名表（SOURCE_LABEL_KEYS）
 *
 * 来源 id 与「可发布平台 id」不是同一套：baidu 只是素材来源（没有发布链路），
 * PLATFORM_NAMES 里没有它。若直接用 PLATFORM_NAMES 拼标题/提示，百度那条会显示
 * 原始 id（「已打开 baidu 采集页面」）。
 */

/** 来源 id → 卡片显示名的 i18n 键（与 locales/collection 的四个键同源） */
export const SOURCE_LABEL_KEYS = {
  weibo: 'collection.sourceWeibo',
  baidu: 'collection.sourceBaidu',
  toutiao: 'collection.sourceToutiao',
}

/**
 * 解析来源显示名：优先 i18n 文案，缺键时回退平台表，最后回退原始 id。
 * @param {string} sourceId
 * @param {(key: string, params?: object) => string} t
 * @returns {string}
 */
function resolveSourceLabel (sourceId, t) {
  const key = SOURCE_LABEL_KEYS[sourceId]
  if (key) {
    const label = t(key)
    // 缺键时 vue-i18n 返回键本身；此时继续回退，避免把键名显示给用户
    if (label && label !== key) return label
  }
  return PLATFORM_NAMES[sourceId] || sourceId
}

/**
 * @param {object} deps
 * @param {(p: {url: string, platform: string, title: string}) => Promise<any>} deps.createTab
 * @param {(key: string, opts?: object) => void} deps.notifyWarning
 * @param {(key: string, opts?: object) => void} deps.notifySuccess
 * @param {(key: string, params?: object) => string} deps.t
 * @returns {(sourceId: string) => Promise<void>}
 */
export function createOpenSourceHandler ({
  createTab,
  notifyWarning,
  notifySuccess,
  t,
}) {
  return async function openCollection (sourceId) {
    const url = PLATFORM_SOURCE_URLS[sourceId]
    if (!url) {
      notifyWarning('collection.platformUnsupported')
      return
    }
    const label = resolveSourceLabel(sourceId, t)
    // 在顶部全局标签栏打开平台页（page-manager 体系承载渲染）
    const tabId = await createTab({
      url,
      platform: sourceId,
      title: t('collection.platformSourceTabTitle', { platform: label }),
    })
    if (tabId) {
      notifySuccess('collection.openedPlatform', { params: { platform: label } })
    }
  }
}

export { PLATFORM_SOURCE_URLS }

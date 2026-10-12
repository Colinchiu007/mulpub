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
 * ## 2026-10-12 实测口径（web_fetch 纯 HTTP，无 UA/无 Cookie/不执行 JS）
 *
 * | 平台 | 旧值（DASHBOARD） | 旧值实际是什么 | 新值（SOURCE） |
 * |---|---|---|---|
 * | weibo | https://weibo.com/ | 消费端信息流首页 | https://s.weibo.com/top/summary（热搜榜）|
 * | zhihu | https://www.zhihu.com/ | 消费端首页推荐流 | https://www.zhihu.com/hot（热榜）|
 * | toutiao | https://mp.toutiao.com/ | **头条号创作后台**（实测 200 → profile_v4）| https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc |
 *
 * 头条那条是**分类错误**而非"链接旧了"：mp.toutiao.com 是发布目的地，
 * 放在「素材采集来源」里从根上就是错的。
 *
 * 两条必须如实告知用户的边界（不得在代码里假装不存在）：
 *   · 微博：weibo.com 与 s.weibo.com/** 对无 Cookie 请求一律 302 →
 *     passport.weibo.com，属**服务端强制登录墙**。换 URL 只改变「登录后看到的是
 *     热搜榜还是信息流」，**不会**让用户免登录浏览 —— 不要指望换 URL 绕过登录。
 *   · 知乎：www.zhihu.com/hot 对抓取器返回 403（裸首页同样 403，故 403 是反爬
 *     而非失效）；/creator 已确证强制登录（302 → /signin?next=%2Fcreator）。
 *     真人浏览器下 /hot 是否免登录可浏览，本次工具未能证实。
 *
 * @param {object} deps
 * @param {(p: {url: string, platform: string, title: string}) => Promise<any>} deps.createTab
 * @param {(key: string, opts?: object) => void} deps.notifyWarning
 * @param {(key: string, opts?: object) => void} deps.notifySuccess
 * @param {(key: string, params?: object) => string} deps.t
 * @returns {(platform: string) => Promise<void>}
 */
export function createOpenSourceHandler ({
  createTab,
  notifyWarning,
  notifySuccess,
  t,
}) {
  return async function openCollection (platform) {
    const url = PLATFORM_SOURCE_URLS[platform]
    if (!url) {
      notifyWarning('collection.platformUnsupported')
      return
    }
    // 在顶部全局标签栏打开平台页（page-manager 体系承载渲染）
    const tabId = await createTab({
      url,
      platform,
      title: t('collection.platformSourceTabTitle', { platform: PLATFORM_NAMES[platform] || platform }),
    })
    if (tabId) {
      notifySuccess('collection.openedPlatform', { params: { platform } })
    }
  }
}

export { PLATFORM_SOURCE_URLS }

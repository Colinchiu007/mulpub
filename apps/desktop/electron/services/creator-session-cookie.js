'use strict'

/**
 * creator-session-cookie.js — 博主监控的会话 Cookie 提供者（多平台，PRD §3/§4）
 *
 * 复用「账号管理」里已登录的抖音/小红书账号：读 `persist:account-{id}` 分区中
 * 属于该平台的 Cookie（与 account-session-restore 同一读取口径），拼成请求用
 * Cookie 串。**不新增任何登录流程、不存储任何 Cookie 副本**——登录态的唯一
 * 真源仍是账号分区（重复落副本等于多一处泄密面与失效面）。
 *
 * 三条纪律：
 *   1. 无有效会话 → 返回 null（上层抛 credential_missing），**绝不**返回空 Cookie 串
 *      让请求裸发（裸发 = 必然 403 → 被误判成签名失败，污染排查方向）。
 *   2. 日志只记 platform/accountId/cookie 数量，**不记任何 Cookie 值**。
 *   3. 平台→会话 Cookie 域过滤复用 shared-utils 的 isPlatformCookieDomain（单一口径）。
 */

function cookieDomainMatchesUrl (cookie, url) {
  const d = String((cookie && cookie.domain) || '').replace(/^\.+/, '').toLowerCase()
  if (!d) return false
  let host
  try { host = new URL(url).hostname.toLowerCase() } catch (_) { return false }
  return host === d || host.endsWith('.' + d)
}

/** 平台 → 会话 Cookie 的宿主域（用于按 URL 过滤与排序，域内 Cookie 全量带上） */
const PLATFORM_COOKIE_URL = Object.freeze({
  douyin: 'https://www.douyin.com',
  xiaohongshu: 'https://www.xiaohongshu.com',
})

/**
 * @param {object} deps
 *   - listAccounts: async () => Account[]（平台内已登录账号，含 id/platform/enabled）
 *   - getAccountPartitionCookies: async (platform, accountId) => Cookie[]
 */
function createCreatorSessionProvider (deps = {}) {
  const { listAccounts, getAccountPartitionCookies, log } = deps

  return {
    /** 平台是否有可用会话（探测用，零副作用） */
    async hasSession (platform) {
      return !!(await this.getSession(platform))
    },

    /**
     * 取该平台的会话 Cookie。多账号时取「最近更新」的一个（监控按账号维度巡视
     * 是后续切片；本期单会话已满足「关注—监控—采集」）。
     * @returns {Promise<{cookieString:string, accountId:string, a1?:string}|null>}
     */
    async getSession (platform) {
      const accounts = typeof listAccounts === 'function' ? await listAccounts() : []
      const candidates = (Array.isArray(accounts) ? accounts : [])
        .filter((a) => a && a.platform === platform && a.enabled !== 0)
      for (const account of candidates) {
        const cookies = typeof getAccountPartitionCookies === 'function'
          ? await getAccountPartitionCookies(platform, account.id)
          : []
        const usable = (Array.isArray(cookies) ? cookies : [])
          .filter((c) => cookieDomainMatchesUrl(c, PLATFORM_COOKIE_URL[platform] || ''))
        if (!usable.length) continue
        const cookieString = usable
          .map((c) => `${c.name}=${c.value}`)
          .join('; ')
        if (log && log.info) log.info(`[creator-session] ${platform}:${account.id} cookies=${usable.length}`)
        const a1 = (usable.find((c) => c.name === 'a1') || {}).value || ''
        const b1 = (usable.find((c) => c.name === 'b1') || {}).value || ''
        return { cookieString, accountId: account.id, a1, b1 }
      }
      return null
    },
  }
}

module.exports = {
  createCreatorSessionProvider,
  PLATFORM_COOKIE_URL,
  cookieDomainMatchesUrl,
}

// @ts-check
/**
 * auth-partition — API-first 发布链的 Electron auth 分区凭证兜底（D1，kuaishou-w3-live-fix）
 *
 * 根因（01-docs/rpa-api-publish/evidence/api-w3-kuaishou/live-verdict-20260926.md）：
 * 生产 rpa_vm 路由下 authData.cookies 可能为空（快手等平台的登录态只落在登录时的
 * Electron auth 分区，未同步进凭证 store），API-first 分支拼出空串被 adapter
 * fail-closed，发布链 0 步未跑。
 *
 * 本模块只读 auth 分区补 cookie：
 * - findAuthPartitionDir：分区定位（与 rpa-view-session._restoreAuthPartitionCookies 同源，
 *   单一实现防两处规则漂移）
 * - collectAuthPartitionCookies：session.fromPartition 直读 + 平台域过滤（防跨平台串味）
 *   + 同名去重 + name=value 拼串
 *
 * 纪律：绝不写凭证 store；任何异常降级为空结果，由调用方保持既有 fail-closed 语义。
 */
const fs = require('fs')
const path = require('path')
const { session, app } = require('electron')
const log = require('./logger')
const { isPlatformCookieDomain } = require('@multi-publish/shared-utils/src/platform-definitions')

/**
 * 在 userData 的 Partitions 目录下定位该账号最新的 auth 分区名。
 * 分区命名兼容三种历史格式：auth-{accountId} / account-{accountId} /
 * auth-auth-{platform}-{ts} / auth-{platform}-{ts}（accountId 形如 auth-{platform}-{ts} 时会产生双 auth 前缀）。
 * @param {string} platform
 * @param {string|null|undefined} accountId
 * @param {string} [userDataPath] 测试注入点；默认 app.getPath('userData')
 * @returns {string|null} 分区目录 basename（拼 persist: 前缀用），无匹配为 null
 */
function findAuthPartitionDir (platform, accountId, userDataPath) {
  try {
    const rootBase = userDataPath || (app && app.getPath ? app.getPath('userData') : '')
    if (!rootBase) return null
    const roots = [
      path.join(rootBase, 'session', 'Partitions'),
      path.join(rootBase, 'Partitions'),
    ]
    const prefixes = []
    if (typeof accountId === 'string' && accountId) {
      prefixes.push('auth-' + accountId)
      prefixes.push('account-' + accountId)
    }
    prefixes.push('auth-auth-' + platform + '-')
    prefixes.push('auth-' + platform + '-')
    for (const root of roots) {
      if (!fs.existsSync(root)) continue
      let names = []
      try { names = fs.readdirSync(root) } catch (_) { continue }
      for (const prefix of prefixes) {
        const candidates = names
          .filter(function (name) { return name.startsWith(prefix) })
          .filter(function (name) {
            try { return fs.statSync(path.join(root, name)).isDirectory() } catch (_) { return false }
          })
          .sort()
        if (candidates.length > 0) return candidates[candidates.length - 1]
      }
    }
    return null
  } catch (e) {
    log.warn('AuthPartition', 'partition lookup failed: ' + (e && e.message))
    return null
  }
}

/**
 * 只读 auth 分区 cookie，按平台域过滤 + 同名去重后拼 name=value 串。
 * @param {string} platform
 * @param {string|null|undefined} accountId
 * @returns {Promise<{cookieString: string, partition: string|null, count: number}>}
 */
async function collectAuthPartitionCookies (platform, accountId) {
  const empty = { cookieString: '', partition: null, count: 0 }
  try {
    const partitionName = findAuthPartitionDir(platform, accountId)
    if (!partitionName) {
      log.warn('AuthPartition', '[' + platform + '] no auth partition found for accountId=' + (accountId || '(none)'))
      return empty
    }
    const authSession = session.fromPartition('persist:' + partitionName)
    const cookies = await authSession.cookies.get({})
    /** @type {Map<string, string>} */
    const byName = new Map()
    for (const c of cookies || []) {
      if (!c || typeof c.name !== 'string' || typeof c.value !== 'string') continue
      if (typeof c.domain !== 'string' || !c.domain) continue
      if (!isPlatformCookieDomain(platform, c.domain)) continue
      byName.set(c.name, c.value) // 同名去重：后出现（更具体域）的值优先
    }
    const cookieString = Array.from(byName.entries()).map(([k, v]) => k + '=' + v).join('; ')
    log.info('AuthPartition', '[' + platform + '] read ' + byName.size + ' cookies from auth partition ' + partitionName)
    return { cookieString, partition: partitionName, count: byName.size }
  } catch (e) {
    log.warn('AuthPartition', '[' + platform + '] auth partition cookie read failed: ' + (e && e.message))
    return empty
  }
}

module.exports = { findAuthPartitionDir, collectAuthPartitionCookies }

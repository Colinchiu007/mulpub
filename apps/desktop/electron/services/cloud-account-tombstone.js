// @ts-check
/**
 * 本机删除账号 → 向云端登记墓碑
 *
 * 为什么必须存在：同步侧的恢复逻辑只认「云端有而本机无且**无墓碑**」，
 * 如果删除时不写墓碑，被删账号会在下一次同步从云端原样复活（用户视角 = 删不掉）。
 * 只读不写的墓碑等于没有墓碑。
 *
 * 为什么必须在删除**之前**调用：uid 的二级来源是「带凭证调平台 user-info 接口」，
 * 而凭证就在本次要删的文件里。删完再解析就没有身份可解析了。
 *
 * 失败语义：best-effort。本机删除是用户强意图，云端补偿失败只 log.warn，
 * 不回滚本机删除，也不向用户报错（下一次同步遇到该键仍可能复活，属可接受的降级，
 * 且真源已无此账号，用户不会再在本机看到它）。
 */

const TOMBSTONES_PATH = '/api/v1/me/accounts/tombstones'

/**
 * @param {Object} deps
 * @property {(platform:string, cookies:any[]) => Promise<{supported:boolean, platformAccountId?:string}>} fetchAccountInfo
 * @property {{ loadCredential: Function }} credentialStore
 * @property {{ request: Function }|null} apiClient
 * @property {string} [userDataDir]
 * @property {{warn?:Function}} [log]
 */
function createCloudTombstoneRecorder (deps) {
  const { fetchAccountInfo, credentialStore, apiClient, userDataDir = '', log } = deps || {}

  function warn (stage, detail) {
    const sink = log && log.warn
    if (typeof sink !== 'function') return
    try { sink('CloudSync', `cloud-tombstone ${stage}${detail ? ' :: ' + detail : ''}`) } catch (_) { /* 日志不得影响删除 */ }
  }

  /**
   * @param {string} subject 登录身份 sub
   * @param {{id:string, platform:string, platform_account_id?:string}|null|undefined} account 删除前读到的本机账号
   * @returns {Promise<{recorded: boolean, reason?: string}>}
   */
  async function record (subject, account) {
    if (!account || !account.platform) return { recorded: false, reason: 'NO_ACCOUNT' }
    if (!subject || !apiClient || typeof apiClient.request !== 'function') return { recorded: false, reason: 'CLIENT_UNAVAILABLE' }

    let platformUid = typeof account.platform_account_id === 'string' ? account.platform_account_id.trim() : ''
    if (!platformUid) {
      // 二级补齐：凭证此刻仍在盘上，过了这一步就再也没有来源
      try {
        let stored = await Promise.resolve(credentialStore.loadCredential(account.id, userDataDir, subject))
        const cookies = stored && Array.isArray(stored.cookies) ? stored.cookies : []
        if (cookies.length) {
          const info = await Promise.resolve(fetchAccountInfo(account.platform, cookies))
          if (info && typeof info.platformAccountId === 'string') platformUid = info.platformAccountId.trim()
        }
      } catch (e) {
        warn('uid-resolve-failed', `platform=${account.platform} message=${e && e.message ? e.message : String(e)}`)
      }
    }
    if (!platformUid) return { recorded: false, reason: 'UID_UNAVAILABLE' }

    try {
      await apiClient.request({
        subject,
        path: TOMBSTONES_PATH,
        method: 'POST',
        body: { keys: [{ platform: account.platform, platformUid }] },
      })
      warn('recorded', `platform=${account.platform} uid=${platformUid}`)
      return { recorded: true }
    } catch (e) {
      warn('post-failed', `platform=${account.platform} code=${e && /** @type {any} */ (e).code ? e.code : (e && e.message) || String(e)}`)
      return { recorded: false, reason: 'POST_FAILED' }
    }
  }

  return { record, TOMBSTONES_PATH }
}

module.exports = { createCloudTombstoneRecorder, TOMBSTONES_PATH }

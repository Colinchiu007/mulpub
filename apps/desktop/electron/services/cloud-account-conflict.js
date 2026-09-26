// @ts-check
/**
 * 凭证冲突裁决（PRD §5.5 / docs/adr/0005 第 3 条）
 *
 * 单独成模块的理由：这是整个同步里唯一「必须问平台才能决定」的判断，
 * 也是唯一会**改写本机有效凭证**的路径。四类终态（本机胜出 / 云端胜出 / 两份都失效 /
 * 两份都无定论）的分支若混在编排器里，最容易被后来的改动顺手合并成
 * 「按时间戳覆盖」—— 那正是被否决的纯 LWW 形态，后果是用一份看着更新
 * 但已失效的钥匙覆盖本机刚刷新的有效钥匙，且用户无从得知是同步干的。
 */
const { OUTCOME, TIMEOUT_SENTINEL, raceWithTimeout } = require('./cloud-account-core')

/**
 * @param {Object} deps
 * @property {(platform:string, cookies:any[]) => Promise<{supported?:boolean, valid?:boolean, code?:string}>} checkLogin
 * @property {number} accountTimeoutMs
 * @property {(platform:string, credential:any) => Promise<'valid'|'invalid'|'inconclusive'>} [verdict] 可注入以便测裁决顺序
 */
function createConflictResolver (deps) {
  const { checkLogin, accountTimeoutMs } = deps || {}

  /** 判一份凭证在本机是否真能用；检测自身异常/超时都算「无定论」，不算反证 */
  async function verdict (platform, credential) {
    const cookies = credential && Array.isArray(credential.cookies) ? credential.cookies : null
    if (!cookies || !cookies.length) return 'invalid'
    const res = await raceWithTimeout(
      Promise.resolve(checkLogin(platform, cookies)).catch((e) => ({ __cloudSyncError: String((e && e.message) || e) })),
      accountTimeoutMs,
      TIMEOUT_SENTINEL,
    )
    if (res === TIMEOUT_SENTINEL) return 'inconclusive'
    if (res && res.__cloudSyncError) return 'inconclusive'
    if (res && res.valid === true) return 'valid'
    if (res && res.valid === false) return 'invalid'
    return 'inconclusive'
  }

  /**
   * 四分支裁决：较新的一份先测，有效即胜出；否则试另一份；两份都明确失效 → 标需重登；
   * 两份都无定论 → 保留本机且**不写任何负结论**（单向证据规则）。
   * `cloudNewer` 由服务端在 conflict 裁决里给出；拿不到时按本机较新处理。
   */
  async function resolveCredentialConflict (platform, localCredential, cloudCredential, cloudNewer) {
    const ordered = cloudNewer
      ? [{ which: 'cloud', cred: cloudCredential }, { which: 'local', cred: localCredential }]
      : [{ which: 'local', cred: localCredential }, { which: 'cloud', cred: cloudCredential }]

    const verdicts = []
    for (const cand of ordered) {
      const v = await verdict(platform, cand.cred)
      verdicts.push({ ...cand, verdict: v })
      if (v === 'valid') return { winner: cand.which, credential: cand.cred, verdicts }
    }
    const anyInconclusive = verdicts.some((v) => v.verdict === 'inconclusive')
    return {
      winner: 'keep-local',
      credential: localCredential,
      invalid: !anyInconclusive,
      verdicts,
    }
  }

  return { verdict, resolveCredentialConflict, OUTCOME }
}

module.exports = { createConflictResolver }

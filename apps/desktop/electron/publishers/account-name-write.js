/**
 * account-name-write.js — 账号「显示名」的写入侧
 *
 * 从 publishers/account-manager.js 拆出，两条理由：
 * 1) 关注点不同：本模块回答「这个显示名该不该写、以什么来源写」；account-manager 回答
 *    「怎么登录、怎么检测、怎么发布」。显示名与登录态是两条正交的写链路，混在同一个
 *    已挂账的超大文件里，每次改动都在继续推高 check-max-lines。
 * 2) 门禁：account-manager.js 在 .github/scripts/max-lines-baseline.json 挂账，
 *    新增能力再内联会撞增长容差。
 *
 * 依赖注入约定（对齐 ipc-handlers/account-active.js 的既有做法）：`pythonBridge` 传的是
 * **模块对象**而不是 `requestBackend` 函数引用 —— account-manager.js:13 那类
 * 「require 期解构成本地绑定」的写法会让测试里的 vi.spyOn(pythonBridge, 'requestBackend')
 * 拦不到，从而静默调用真实实现、测试假绿。保持经模块对象调用才拦得住。
 */
const { isNoiseAccountName } = require('@multi-publish/shared-utils/src/account-name-guard')
const { getPlatformName } = require('@multi-publish/shared-utils/src/platform-definitions')

/**
 * 解析账号显示名。`captured.name` 来自 auth-view-manager 的 `document.title`，
 * 它既是 POST/PATCH 直接写进真源 `name` 字段的值，又是 `profileForCreate` 的昵称兜底 ——
 * 不在这唯一一处入口过噪声守卫，等于给「网页标题冒充账号名」留一条绕过口
 * （2026-09-26 生产库的「小红书创作服务平台 / 快手创作者服务平台 / 抖音创作者中心」即此路径产物）。
 * 命中噪声一律回落平台名；判定与卡片展示端、采集写回端共用 account-name-guard 单一来源。
 * @param {unknown} rawName
 * @param {string} platform
 * @returns {string}
 */
function resolveAccountDisplayName (rawName, platform) {
  const trimmed = typeof rawName === 'string' ? rawName.trim() : ''
  return trimmed && !isNoiseAccountName(trimmed) ? trimmed : getPlatformName(platform)
}

/**
 * 资料回填的昵称保护判据：就地修改 patch。
 *
 * 判据是 `name_source`（用户是否显式命名），不是「现网名长得像不像噪声」。
 * 旧实现用后者，两个方向都会错：现网名是合法机器昵称时被无谓保护（永远更新不动），
 * 用户手改的名字恰好含 ` - ` / ` · ` / 省略号时被直接冲掉（2026-09-26 实测复现）。
 *
 * 顺带约束：只有真的写 account_name 时才同时下发 name_source='auto'，
 * 否则「保护住昵称」的请求会顺手把 manual 降级成 auto。
 * @param {object} patch buildProfilePatch 的产物（就地修改）
 * @param {object|null} current 后端当前账号对象
 */
function guardProfilePatchBySource (patch, current) {
  if (!patch || !patch.account_name) return
  if (current && current.name_source === 'manual') {
    delete patch.account_name
    return
  }
  patch.name_source = 'auto'
}

/**
 * 用户显式改名：写后端 accounts.json 真源，并把来源标为 manual。
 *
 * 为什么不用 accountUpdate：那条通道写 Electron SQLite，而账号列表读后端 JSON，
 * 写了不显示（见 src/api/publisher.js:103 的同款注释）。参照 setAccountActive 的写法。
 *
 * 为什么必须同时写 name_source：展示层靠它跳过噪声守卫。用户起的名字可能含
 * ` - ` / ` · ` / 省略号或以「服务平台」结尾，都会被形态规则判成抓取错误而藏掉。
 * @param {{
 *   isSafePathSegment: (s: unknown) => boolean,
 *   pythonBridge: { requestBackend: Function },
 *   log: { info: Function, warn: Function }
 * }} deps
 * @returns {Promise<{ok: boolean, account?: object, reason?: string, code?: number, message?: string}>}
 */
async function renameAccount (accountId, platform, newName, deps) {
  const { isSafePathSegment, pythonBridge, log } = deps
  if (!accountId || !isSafePathSegment(accountId)) return { ok: false, reason: 'invalid-account-id' }
  const name = typeof newName === 'string' ? newName.trim() : ''
  if (!name) return { ok: false, reason: 'empty-name' }
  try {
    const result = await pythonBridge.requestBackend('PATCH', '/api/accounts/' + accountId, {
      account_name: name,
      name_source: 'manual',
    })
    if (!result || result.code !== 0) {
      log.warn('AccountManager', 'renameAccount 写回后端失败 ' + platform + ':' + accountId + ' code=' + (result && result.code) + ' message=' + (result && result.message))
      return { ok: false, reason: 'backend-error', code: result && result.code, message: (result && result.message) || '改名失败' }
    }
    log.info('AccountManager', 'renameAccount 已固化用户命名 ' + platform + ':' + accountId)
    return { ok: true, account: result.data }
  } catch (e) {
    log.warn('AccountManager', 'renameAccount 异常 ' + platform + ':' + accountId + ' ' + (e && e.message ? e.message : String(e)))
    return { ok: false, reason: 'exception', message: (e && e.message) ? e.message : String(e) }
  }
}

module.exports = { resolveAccountDisplayName, guardProfilePatchBySource, renameAccount }

'use strict'

/**
 * 同步地址的三口径解析（手填 / 自动发现 / 生效值）——纯函数，独立成模块以便单测，
 * 并避免顶破本仓 max-lines 债务（`ops-center-sync.js` 已在登记清单上，见其文件头）。
 *
 * 为什么必须拆出「手填」与「生效值」两个口径：
 * `getConfig().url` 历史上把「用户手填的地址」与「部署层自动发现的地址」并入同一个字段，
 * 于是下游**无法据此判断用户到底手填了没有**。后果分两层：
 *   ① 误判：零配置态下 `!cfg.url` 恒为 false ⇒ 会被读成「已手填」；
 *   ② 真正的故障点：`_fetchJson` 内部重读该混装字段当请求 base，把**自动发现地址**当成了
 *      手填地址消费（`_fetchCatalog` / `_fetchRuntime` 早已接收 `baseUrl` 却没用它）。
 * 本模块把这三个口径变成单一可单测实现；`manualUrl` 是判「手动态」的唯一依据。
 *
 * @param {{storedUrl?: string, autoUrl?: string, autoAvailable?: boolean}} input
 * @returns {{manualUrl: string, autoUrl: string, effectiveUrl: string, autoConnected: boolean}}
 */
function resolveSyncUrls({ storedUrl, autoUrl, autoAvailable }) {
  const manual = storedUrl || ''
  const auto = autoUrl || ''
  return {
    manualUrl: manual,
    autoUrl: auto,
    effectiveUrl: manual || auto,
    // 零配置化标识：无手填 + 自动发现可用（有 token 回调）才算「自动连上」
    autoConnected: !manual && !!autoAvailable,
  }
}

/**
 * 固化护栏：零配置态（未手填 + 有自动地址）下把**自动发现地址原样写回手填**，会让该终端
 * 此后不再跟随部署层（`cfg.url` 非空 ⇒ `autoConnected` 恒 false），而且**不可逆** ——
 * 手填值一旦落盘，「未手填」这个事实就被抹掉了。返回 `true` 表示应拒绝该次保存。
 *
 * @param {{storedUrl?: string, autoUrl?: string, candidate?: string}} input
 * @returns {boolean}
 */
function shouldRefusePin({ storedUrl, autoUrl, candidate }) {
  const manual = storedUrl || ''
  const auto = autoUrl || ''
  return !!candidate && !manual && !!auto && candidate === auto
}

module.exports = { resolveSyncUrls, shouldRefusePin }

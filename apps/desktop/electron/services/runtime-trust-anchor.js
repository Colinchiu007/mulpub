'use strict'
/**
 * runtime-trust-anchor.js — 运行时策略验签「信任锚」解析（P0-1 收口）
 *
 * 背景：桌面端内置了一把 DEV Ed25519 公钥（`ops-center-sync.js::DEFAULT_RUNTIME_PUBLIC_KEY`），
 * 与 `ops-center/backend/.env.example` 标注的 DEV-ONLY 私钥配对，仅供开发/演示自验。
 * 打包版若继续吃这把内置公钥，等于「任何持有 DEV 私钥的人都能给生产客户端下发运行时策略」
 * （公告 / 版本发布策略 / 敏感词 / pipelineOptions / 应用菜单），因此判据必须是：
 *
 *   - 未打包（开发/演示，`app.isPackaged === false`）：允许回落内置 DEV 公钥；
 *   - 已打包（生产发行版）：**只认用户在「运营中心同步配置」里自定义的 runtimePublicKey**；
 *     没有自定义锚 → 返回 NO_PRODUCTION_TRUST_ANCHOR，由调用方 fail-closed（整份运行时策略不应用）。
 *
 * 打包态判定沿用仓内唯一权威 `app.isPackaged`（QM-5 合同：`ELECTRON_IS_DEV`/`NODE_ENV` 不得提权）。
 * 取不到 electron（纯 node 脚本、vitest 无 mock）一律按「未打包」处理，与 `path-utils.js` 同口径。
 */

/** @type {null | (() => boolean)} 测试注入点：null 时走真实 electron 探测 */
let _packagedProbe = null

/**
 * 注入/清除打包态探针（仅供单测覆盖两条分支，生产代码不得调用）。
 * @param {null | (() => boolean)} fn 传 null 恢复真实探测
 */
function configurePackagedProbe (fn) {
  _packagedProbe = typeof fn === 'function' ? fn : null
}

/** @returns {boolean} 当前是否运行在打包后的生产发行版 */
function isPackagedApp () {
  if (_packagedProbe) {
    try {
      return _packagedProbe() === true
    } catch {
      // 探针自身异常按最保守处理：视为生产态（不允许吃内置 DEV 公钥）
      return true
    }
  }
  try {
    const electron = require('electron')
    const app = electron && electron.app
    return !!(app && app.isPackaged === true)
  } catch {
    return false
  }
}

/**
 * 解析验签应使用的公钥 PEM。
 * @param {string} configuredPem 用户配置的 runtimePublicKey（可为空串/undefined）
 * @param {string} devFallbackKey 内置 DEV 公钥（仅未打包态可用）
 * @returns {{ pem: string } | { error: 'NO_PUBLIC_KEY' | 'NO_PRODUCTION_TRUST_ANCHOR' }}
 */
function resolveTrustAnchor (configuredPem, devFallbackKey) {
  const trimmed = configuredPem ? String(configuredPem).trim() : ''
  if (trimmed) return { pem: trimmed }
  if (isPackagedApp()) return { error: 'NO_PRODUCTION_TRUST_ANCHOR' }
  if (!devFallbackKey) return { error: 'NO_PUBLIC_KEY' }
  return { pem: devFallbackKey }
}

module.exports = { configurePackagedProbe, isPackagedApp, resolveTrustAnchor }

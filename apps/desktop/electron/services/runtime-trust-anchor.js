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
 *   - 已打包（生产发行版）：**只认部署层配置的 runtimePublicKey**（`config/identity-public.json`
 *     的 `runtimePublicKey`，或环境变量 `RUNTIME_PUBLIC_KEY`；历史设置项作为次优先兼容来源，
 *     见 `resolveRuntimePublicKey`）；没有任何锚 → 返回 NO_PRODUCTION_TRUST_ANCHOR，
 *     由调用方 fail-closed（整份运行时策略不应用）。
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
 * @param {string} configuredPem 已解析出的 runtimePublicKey（来自 resolveRuntimePublicKey）
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

/**
 * 解析验签公钥的**来源**（优先级：部署层 > 历史设置项）。
 *
 * 为什么要有「部署层」这一档（2026-10-14 实测）：信任锚原先只有设置存储一个来源，
 * 而写入只经 `ops-center-sync:save` IPC —— 该 IPC 的唯一调用方是渲染端那个
 * 「运营中心同步」表单，而该表单**早已从界面撤下**（`views/ModelProviders.vue` 注释：
 * 「运营同步对用户透明：配置卡片已隐藏」）。于是打包版**不存在任何可达的配置路径**，
 * `resolveTrustAnchor` 必然返回 NO_PRODUCTION_TRUST_ANCHOR ⇒ 生产版整份运行时策略
 * fail-closed 不应用。**这是既存的生产洞，不是新引入的问题。**
 * （2026-10-15 更新：该 IPC 连同 `ops-center-sync:get` / `:now` 一并删除 —— 渲染端对三个
 *  封装的调用数盘点为 0。写入路径自此只剩部署层，设置项降为「仅兼容既有安装与企业预置」。）
 *
 * 部署层来源与 `opsCenterUrl` 同机制：`config/identity-public.json` 的 `runtimePublicKey`
 * （打包进 `resources/config/`），可经环境变量 `RUNTIME_PUBLIC_KEY` 覆盖。设置项作为
 * **次优先**保留，仅为兼容既有安装与企业预置（已无用户界面可写）。
 *
 * @param {string} deploymentPem 部署层公钥（config/identity-public.json 或 env），可为空
 * @param {string} storedPem 历史设置项里的公钥，可为空
 * @returns {string} 选中的 PEM；都没有返回空串，交由 resolveTrustAnchor 按打包态决定回落或 fail-closed
 */
function resolveRuntimePublicKey (deploymentPem, storedPem) {
  for (const candidate of [deploymentPem, storedPem]) {
    const trimmed = candidate ? String(candidate).trim() : ''
    if (trimmed) return trimmed
  }
  return ''
}

module.exports = { configurePackagedProbe, isPackagedApp, resolveTrustAnchor, resolveRuntimePublicKey }

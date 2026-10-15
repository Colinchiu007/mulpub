// @ts-check
/**
 * core/preload-path.js — sandbox preload 的「bundle 优先」路径解析（单一实现）
 *
 * ## 为什么需要 bundle
 *
 * `sandbox: true` 的 preload **无法 require 相对路径文件**——2026-10-15 真机实测：
 * sandbox preload 内 `require('./probe-require-target.js')` 报
 * `failed: module not found: ./probe-require-target.js`（同一次实测中 `require('electron')`
 * 正常，故这不是"require 完全不可用"，而是"相对路径解析被沙箱裁掉"）。
 *
 * 因此凡需要复用 Node 模块的 sandbox preload，都必须先经 esbuild 打包为单文件
 * （入口登记在 `apps/desktop/scripts/build-preload.js`），运行时优先加载 `*.bundle.js`。
 *
 * ## 为什么解析器要公用
 *
 * 本仓已有两处同形实现（主窗口 `preload/index.bundle.js`、`_homeShellPreloadPath()`）。
 * 第三处若继续各写一份，则"bundle 缺失时回退源文件"这一降级语义会各自漂移；
 * 此处收敛为单一实现，新接入方一律调用本函数。
 */

const fs = require('fs')
const path = require('path')

/** bundle 产物后缀（esbuild outfile 约定） */
const BUNDLE_SUFFIX = '.bundle.js'

/**
 * 解析 preload 入口：存在 `*.bundle.js` 时返回它，否则回退未打包的源文件。
 *
 * 回退是**有损**的：源文件若含相对 require，在 sandbox 下会加载失败。调用方应在拿到
 * 回退路径时出声告警（本函数只负责解析，不持有 logger）。
 *
 * @param {string} basePath 不带扩展名的 preload 基路径（如 `<dir>/monitor-preload`）
 * @returns {{ path: string, bundled: boolean }}
 */
function resolveBundledPreloadPath (basePath) {
  if (typeof basePath !== 'string' || !basePath) {
    throw new Error('resolveBundledPreloadPath: basePath 必须是非空字符串')
  }
  const bundle = basePath + BUNDLE_SUFFIX
  try {
    if (fs.existsSync(bundle)) return { path: bundle, bundled: true }
  } catch (_error) {
    // 探测失败按"无 bundle"处理：不能因为一次 existsSync 异常就让建窗/建视图整体失败
  }
  return { path: basePath + '.js', bundled: false }
}

module.exports = { BUNDLE_SUFFIX, resolveBundledPreloadPath }

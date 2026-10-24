// @ts-check
'use strict'
/**
 * rpa-overseas/index.js — 海外平台发布 mixin
 *
 * ## 接线方式
 *
 * `rpa-view-manager.js` 的分发点是**动态方法名**：
 *
 * ```js
 * const mn = '_publish_' + platform
 * const publishFn = typeof this[mn] === 'function' ? this[mn](win, article) : this._publish_generic(...)
 * ```
 *
 * ⇒ 只要本 mixin 在 prototype 上提供 `_publish_<platform>`，该平台就走专属链，
 *   **不需要改分发点**（`rpa-view-manager.js` 只加 1 行 require + 1 行 Object.assign）。
 *
 * ## 为什么要独立成目录（而不是继续堆进 rpa-view-platforms.js）
 *
 * `rpa-view-platforms.js` 在本仓「点名还账」清单内（**零增长容差**），
 * 往里加行会直接顶穿熔断门禁、挡住全仓 PR。
 * 本目录是同一模式的延续（先例：`packages/rpa-engine/src/toutiao-direct-bridge.js`）。
 *
 * ## 挂载顺序
 *
 * `Object.assign(target, ..., platformsMixin, overseasMixin)` ⇒ **overseasMixin 在后**
 * ⇒ 海外平台的方法覆盖同名旧实现（当前 `_publish_youtube` 的旧实现已在本 PR 迁出，
 * 保留这条顺序是为了将来 platformsMixin 再出现同名方法时，行为仍然确定）。
 */

const { publishYoutube, dismissAutocomplete, waitForPublishedLink, UPLOAD_DONE_FN } = require('./youtube')
const {
  readMetaContent,
  readFirstText,
  readFirstHref,
  parseInstagramDeepLink,
  parseInstagramShortcode,
  verifyPublished,
} = require('./shared')
const { OVERSEAS_STEP_SELECTORS, getOverseasSelectors } = require('./selectors')

/**
 * 海外平台 mixin。
 * ⚠️ 方法内部通过 `this.` 访问 helpers/session mixin 提供的能力
 * （`_navigateAndWait` / `_waitForElement` / `_setElementContentSafe` / `_setFileInput` …），
 * 因此实现函数必须以 `call(this, ...)` 方式调用，不能脱离原型单独用。
 */
const overseasMixin = {
  /**
   * YouTube 发布（fail-closed）
   * @param {any} win
   * @param {any} article
   */
  async _publish_youtube (win, article) {
    return publishYoutube.call(this, win, article)
  },
}

module.exports = {
  overseasMixin,
  // 一并导出便于单测直击（不依赖原型接线）
  publishYoutube,
  dismissAutocomplete,
  waitForPublishedLink,
  UPLOAD_DONE_FN,
  readMetaContent,
  readFirstText,
  readFirstHref,
  parseInstagramDeepLink,
  parseInstagramShortcode,
  verifyPublished,
  OVERSEAS_STEP_SELECTORS,
  getOverseasSelectors,
}

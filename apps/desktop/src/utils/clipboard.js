// @ts-check
/**
 * clipboard.js — 剪贴板写入统一工具（renderer 侧）
 *
 * 背景（BUGFIX-REWRITE-QUALITY-UX / DRY）：
 * 全仓共有 **9 个**非测试源码文件直接使用剪贴板 API（`navigator.clipboard` / `execCommand`），
 * 行为各异且回退分支覆盖不一致。本模块收敛为唯一实现。
 *
 * 迁移进度（2026-09-16）：
 * - ✅ 已迁移：`views/RewriteView.vue`、`composables/useFilmEngineering.js`
 * - ⬜ 待迁移（7 处，登记为 P1 后续项）：`components/NavBar.vue`、`components/TagSuggester.vue`、
 *   `composables/usePublishFlow.js`、`views/Collection.vue`、`views/FilmEngineeringView.vue`、
 *   `views/PromptEvalView.vue`、`views/ResultView.vue`
 *
 * 行为契约：
 * 1. 优先使用异步 Clipboard API（navigator.clipboard.writeText）——安全上下文可用；
 * 2. Clipboard API 不可用或抛异常时，回退到隐藏 textarea + document.execCommand('copy')；
 * 3. 两条路径都失败返回 false（**不抛异常**），调用方据此展示失败文案；
 * 4. 空文本直接返回 false（避免把空串写进剪贴板覆盖用户已有内容）。
 *
 * 注意：execCommand 已被标记废弃，但在 Electron 旧内核 / 非安全上下文中仍是唯一可用回退，
 * 因此保留并做能力探测，不做强制移除。
 */

/**
 * 判断是否具备浏览器环境（SSR / 纯 Node 单测下安全降级）。
 * @returns {boolean}
 */
function hasDom () {
  return typeof document !== 'undefined' && typeof document.createElement === 'function'
}

/**
 * 异步 Clipboard API 路径。
 * @param {string} text
 * @returns {Promise<boolean>} 成功返回 true；不可用或失败返回 false（不抛异常）
 */
async function writeViaClipboardApi (text) {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') return false
  try {
    await nav.clipboard.writeText(text)
    return true
  } catch (_e) {
    return false
  }
}

/**
 * execCommand 回退路径（隐藏 textarea + 选中 + 复制）。
 * @param {string} text
 * @returns {boolean}
 */
function writeViaExecCommand (text) {
  if (!hasDom() || typeof document.execCommand !== 'function') return false
  const ta = document.createElement('textarea')
  ta.value = text
  // readonly 防止移动端弹出软键盘；移出视口避免影响滚动与布局
  ta.setAttribute('readonly', 'readonly')
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.left = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  try {
    ta.select()
    return document.execCommand('copy')
  } catch (_e) {
    return false
  } finally {
    // 无论成败都要移除临时节点，避免 DOM 泄漏
    document.body.removeChild(ta)
  }
}

/**
 * 把文本写入系统剪贴板。
 * @param {string} text 待复制文本
 * @returns {Promise<boolean>} 是否复制成功（失败不抛异常，由调用方决定提示文案）
 */
export async function writeClipboard (text) {
  const value = typeof text === 'string' ? text : String(text == null ? '' : text)
  if (!value) return false
  if (await writeViaClipboardApi(value)) return true
  return writeViaExecCommand(value)
}

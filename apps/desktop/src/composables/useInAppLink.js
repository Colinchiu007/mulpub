// @ts-check
/**
 * useInAppLink —— 让「查看文章」这类外链在**应用内新标签**打开，而不是弹到系统浏览器。
 *
 * 背景（2026-10-15）：发布成功后的结果区「查看文章 →」是原生 `<a target="_blank">`，
 * 点击由主进程 `webContents.setWindowOpenHandler` 接管并 `shell.openExternal()` 打开
 * 系统浏览器（apps/desktop/electron/window.js:265）。用户在应用内工作，一点就被弹出，
 * 上下文断裂。
 *
 * 口径（四条，缺一不可）：
 *  1. **只接管「最普通的那一次点击」**（左键 + 无修饰键）。Ctrl/⌘/Shift/Alt 点击与中/右键
 *     保持浏览器默认语义 —— 那是用户明确的「另开/新窗口」意图，不该被应用改写。
 *  2. **URL 必须过 `safeHttpUrl`**（只放行 http/https）。不通过就**不接管**：交给默认行为，
 *     与既有的「不产出锚点 ⇒ 降级纯文本」安全边界一致，绝不在这一层放宽协议。
 *  3. **先阻止默认，再尝试应用内打开**。顺序不可交换：若先尝试、失败后才阻止默认，降级
 *     路径会出现「系统浏览器 + 应用内标签」双开。
 *  4. **失败必须降级且不抛**：桥不可用 / 建标签返回 null / 抛异常 —— 一律回落到改造前的
 *     行为（系统浏览器），绝不出现「点了没反应」的静默失败。
 *
 * 非目标：不注入账号登录态（见 PRD「关键取舍」）；不改 URL 的生成与清洗。
 */
import { useTabStore } from '@/stores/tab'
import { safeHttpUrl } from '@multi-publish/shared-utils/src/safe-http-url'

/**
 * 是否「最普通的左键点击」：左键、且没有任何修饰键。
 * 中键/右键不触发 click 事件；键盘激活（Enter）时 button 为 0 且无修饰键，
 * 视同普通点击（与应用内其它按钮的可访问性行为一致）。
 * @param {{ button?: number, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, altKey?: boolean }|null|undefined} event
 * @returns {boolean}
 */
export function isPlainLeftClick (event) {
  if (!event || typeof event !== 'object') return false
  if (event.button !== 0) return false
  return !(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
}

/**
 * 降级：交给主进程 `setWindowOpenHandler` → `openExternalUrl` 开系统浏览器。
 * 这正是改造前的行为，保证失败路径不比改造前更差。
 * @param {string} url
 */
function defaultOpenExternal (url) {
  try {
    window.open(url, '_blank', 'noopener')
  } catch (_e) {
    // 极端环境下没有 window（非浏览器宿主）：静默放弃，绝不因降级路径自身再抛
  }
}

/**
 * @param {{ openExternal?: (url: string) => void }} [options] — 仅测试注入用；生产走默认实现
 */
export function useInAppLink (options = {}) {
  const tabStore = useTabStore()
  const openExternal = (options && typeof options.openExternal === 'function')
    ? options.openExternal
    : defaultOpenExternal

  /**
   * 在应用内新标签打开；**失败一律降级外开**（绝不静默死点击）。
   *
   * CCG 评审 r1-i2/i4：降级必须在本函数内闭环，而不是留给调用方——
   * 否则将来任何直接调用 `openInAppTab` 的代码都会「点了没反应」。
   * @param {unknown} url
   * @returns {Promise<boolean>} 是否成功在应用内打开（false 表示已降级外开或拒绝打开）
   */
  async function openInAppTab (url) {
    const safe = safeHttpUrl(url)
    // 非 http(s) 连降级都不做：不把危险协议交给系统浏览器（PRD §3.4）
    if (!safe) return false

    let tabId = null
    try {
      tabId = await tabStore.createTab({ url: safe })
    } catch (_e) {
      // 桥不可用 / store 未装 / createTab 同步抛错：落到下面的降级，绝不向上抛
      tabId = null
    }
    if (!tabId) {
      // 标签没建成：降级交主进程兜底，保证「调用它就会被打开」
      openExternal(safe)
      return false
    }
    try {
      await tabStore.switchToTab(tabId)
    } catch (_e) {
      // 标签**已建成**、仅切换失败：对用户而言「已打开」，让他自己点那个标签即可。
      // 这里**不降级**——否则会变成「应用内 + 系统浏览器」双开（比不切换更糟）。
    }
    return true
  }

  /**
   * 锚点 click 处理器：普通左键接管为应用内打开，其余情形一律不干预。
   * 接管路径的降级由 `openInAppTab` 内部闭环（C5 失败不变式）。
   * @param {any} event
   * @param {unknown} url
   * @returns {Promise<boolean>} 是否走了应用内打开
   */
  async function handleLinkClick (event, url) {
    if (!isPlainLeftClick(event)) return false
    const safe = safeHttpUrl(url)
    if (!safe) return false

    if (typeof event.preventDefault === 'function') event.preventDefault()

    return openInAppTab(safe)
  }

  return { openInAppTab, handleLinkClick }
}

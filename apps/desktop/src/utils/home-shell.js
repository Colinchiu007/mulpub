/**
 * home-shell 工具（PRD-TAB-INDEPENDENT-HOME-2026-09-22 §4 数据校验）
 *
 * 壳态判据：URL search 中含 mp-home-shell=1（值必须严格为字符串 '1'）。
 * 本项目使用 createWebHashHistory，hash 导航后 location.search 在部分环境
 * 呈 "?mp-home-shell=1#/route" 形态，必须先剥离 '#' 及其后内容再解析，
 * 否则参数值会被污染为 '1#/route' 导致误判。
 */

export const HOME_SHELL_PARAM = 'mp-home-shell'

/**
 * 判断给定 search 串是否命中内嵌主页壳态参数。
 * @param {string|null|undefined} search location.search（可能含 hash 尾巴）
 * @returns {boolean}
 */
export function isHomeShellSearch (search) {
  if (typeof search !== 'string' || !search) return false
  const queryPart = search.split('#')[0]
  if (!queryPart) return false
  try {
    const params = new URLSearchParams(
      queryPart.startsWith('?') ? queryPart.slice(1) : queryPart
    )
    return params.get(HOME_SHELL_PARAM) === '1'
  } catch (_) {
    return false
  }
}

/**
 * 判断当前文档是否运行在内嵌主页壳态（+ 新标签中的独立 SPA 实例）。
 * 仅渲染层展示逻辑使用；安全判定以主进程注入的 --mp-home-shell-url 为准
 * （见 electron/home-shell-preload.js 双判据）。
 * @param {string|null|undefined} search
 * @param {string|null|undefined} [href]
 * @returns {boolean}
 */
export function detectHomeShell (search, href) {
  return isHomeShellSearch(search) || isHomeShellSearch(
    typeof href === 'string' ? (href.split('?')[1] || '') : ''
  )
}

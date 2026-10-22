/**
 * 路由覆盖守卫的**纯函数实现**（ui-audit-scripts.lib.js）。
 *
 * 为什么要抽成 lib：
 *   守卫本身（"router 的每条路由都进了巡检清单"）只有一条"当前是绿的"断言 ——
 *   而一条可能因判据写错而恒绿的锁，等于没有锁（CCG 评审 i5 的原话：
 *   "zero unit coverage for route enumeration difference"）。
 *   抽成纯函数后，测试可以把**输入换掉**（塞一条假路由进去），
 *   断言守卫当场判红 —— 这就是本仓惯用的「变异反证」。
 *
 * 纯函数、无副作用、不读文件系统（输入由调用方给）。
 */

/**
 * @param {string} routerSource  apps/desktop/src/router/index.js 的源码
 * @param {string} scriptsSource 巡检脚本源码（可拼接多份）
 * @returns {string[]} 未被巡检覆盖、且不是重定向源的路由路径
 */
function computeUncoveredRoutes (routerSource, scriptsSource) {
  const routerPaths = new Set()
  for (const m of routerSource.matchAll(/path:\s*'([^']+)'/g)) {
    routerPaths.add(m[1])
  }

  const covered = new Set()
  for (const m of scriptsSource.matchAll(/route:\s*'([^']+)'/g)) {
    covered.add(m[1])
  }

  // 重定向**源**路由不需要单独巡检（其最终形态由目标路由的巡检覆盖）。
  // 判据：同一个 route 对象里带 redirect 字段。
  const redirectSources = new Set()
  for (const m of routerSource.matchAll(/path:\s*'([^']+)'[^{}]*?redirect:\s*'([^']+)'/g)) {
    redirectSources.add(m[1])
  }

  // 动态参数路由（`/board/:projectId`）由**具体实例**覆盖
  // （巡检清单里是 `/board/e2e-project` 这类真实可打开的地址）。
  const matchesParamRoute = (routerPath) => {
    const pattern = new RegExp('^' + routerPath.replace(/:[A-Za-z0-9_]+/g, '[^/]+') + '$')
    return [...covered].some(c => pattern.test(c))
  }

  return [...routerPaths].filter(p =>
    !covered.has(p) &&
    !redirectSources.has(p) &&
    !matchesParamRoute(p))
}

module.exports = { computeUncoveredRoutes }

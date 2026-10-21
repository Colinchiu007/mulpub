/**
 * UI 视觉巡检脚本的冒烟测试 + **路由覆盖守卫**。
 *
 * 为什么要有这条守卫（CCG 评审 i8）：
 * 巡检脚本的价值全在「覆盖完整」——如果有人新增了一条路由却没把它加进
 * 巡检清单，巡检报告会安静地漏掉这一页，而报告看起来仍然完整。
 * 这条测试把「router 里的每条路由」与「巡检脚本的 ROUTES 清单」对齐，
 * 让漏页变成一条红。
 *
 * 放在 `tests/visual-testing/` 根下而不是 `tests/visual-testing/scripts/`：
 * 后者被 vitest.config.js 的 exclude 排除（那里放的是长跑 Playwright 驱动）。
 *
 * 用法：CommonJS + vitest 全局 API（与 tests/ 下其它测试同风格）。
 */

const fs = require('fs')
const path = require('path')

const scriptsDir = path.join(__dirname, 'scripts')
const routerFile = path.join(__dirname, '..', '..', 'src', 'router', 'index.js')

const readScript = name => fs.readFileSync(path.join(scriptsDir, name), 'utf8')

describe('UI 视觉巡检脚本冒烟', () => {
  it('ui-audit-recon.js 可加载并导出枚举入口', () => {
    const mod = require(path.join(scriptsDir, 'ui-audit-recon.js'))
    expect(typeof mod.inspectSurfaces).toBe('function')
    expect(typeof mod.normalizeBaseUrl).toBe('function')
    expect(Array.isArray(mod.ROUTES)).toBe(true)
    expect(mod.ROUTES.length).toBeGreaterThan(20)
  })

  it('ui-audit-capture.js 可加载并导出采集入口', () => {
    const mod = require(path.join(scriptsDir, 'ui-audit-capture.js'))
    expect(typeof mod.detectOverlay).toBe('function')
    expect(typeof mod.listTabs).toBe('function')
    expect(typeof mod.listInteractive).toBe('function')
    expect(Array.isArray(mod.ROUTES)).toBe(true)
    expect(Array.isArray(mod.FLOW_SCENARIOS)).toBe(true)
    expect(mod.FLOW_SCENARIOS.length).toBeGreaterThan(0)
  })

  it('accept-baselines.js 可加载（正则转义后仍能正确映射文件名）', () => {
    const mod = require(path.join(scriptsDir, 'accept-baselines.js'))
    expect(typeof mod).toBe('object')
  })

  it('巡检清单覆盖 router 的全部路由（新增路由漏登记 = 红）', () => {
    const routerSource = fs.readFileSync(routerFile, 'utf8')
    const routerPaths = new Set()
    for (const m of routerSource.matchAll(/path:\s*'([^']+)'/g)) {
      routerPaths.add(m[1])
    }
    expect(routerPaths.size, 'router 解析失败，守卫会误判为「全部覆盖」').toBeGreaterThan(20)

    const covered = new Set()
    // 巡检清单分散在两个文件：编排入口（ui-audit-capture.js）与场景数据（ui-audit-scenes.js），
    // 侦察脚本（ui-audit-recon.js）也带一份 —— 三处都扫，任一处漏登记即红。
    for (const source of [
      readScript('ui-audit-capture.js'),
      readScript('ui-audit-scenes.js'),
      readScript('ui-audit-recon.js'),
    ]) {
      for (const m of source.matchAll(/route:\s*'([^']+)'/g)) {
        covered.add(m[1])
      }
    }

    // ① 重定向**源**路由不需要单独巡检（其最终形态由目标路由的巡检覆盖）。
    //    判据：同一个 route 对象里带 redirect 字段。
    const redirectSources = new Set()
    for (const m of routerSource.matchAll(/path:\s*'([^']+)'[^{}]*?redirect:\s*'([^']+)'/g)) {
      redirectSources.add(m[1])
    }

    // ② 动态参数路由（`/board/:projectId`）由**具体实例**覆盖
    //    （巡检清单里是 `/board/e2e-project` 这类真实可打开的地址）。
    const matchesParamRoute = (routerPath) => {
      const pattern = new RegExp(
        '^' + routerPath.replace(/:[A-Za-z0-9_]+/g, '[^/]+') + '$',
      )
      return [...covered].some(c => pattern.test(c))
    }

    const missing = [...routerPaths].filter(p =>
      !covered.has(p) &&
      !redirectSources.has(p) &&
      !matchesParamRoute(p))

    expect(
      missing,
      `以下路由没进视觉巡检清单（新增路由请同步加进 ui-audit-recon.js / ui-audit-capture.js）：${missing.join(' | ')}`,
    ).toEqual([])
  })

  it('每个巡检条目都带区域与名称（截图清单可读性守卫）', () => {
    const mod = require(path.join(scriptsDir, 'ui-audit-capture.js'))
    for (const item of mod.ROUTES) {
      expect(item.route, '巡检条目缺 route').toMatch(/^\//)
      expect(typeof item.name, '巡检条目缺 name').toBe('string')
      expect(item.name.length).toBeGreaterThan(0)
      expect(typeof item.area, `巡检条目 ${item.name} 缺 area（截图清单按区域分组）`).toBe('string')
      expect(item.area.length).toBeGreaterThan(0)
    }
  })
})

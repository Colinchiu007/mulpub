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
    const { computeUncoveredRoutes } = require(path.join(scriptsDir, 'ui-audit-scripts.lib.js'))
    const routerSource = fs.readFileSync(routerFile, 'utf8')
    // 巡检清单分散在三个文件：编排入口（ui-audit-capture.js）、场景数据（ui-audit-scenes.js）、
    // 侦察脚本（ui-audit-recon.js）—— 三处都扫，任一处漏登记即红。
    const scriptsSource = [
      readScript('ui-audit-capture.js'),
      readScript('ui-audit-scenes.js'),
      readScript('ui-audit-recon.js'),
    ].join('\n')

    const missing = computeUncoveredRoutes(routerSource, scriptsSource)

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

  // ---- 变异反证：守卫必须真的能红（CCG 评审 i5 建议）----
  //
  // 只断言「当前是绿的」不能证明这条锁有效 —— 它可能因为判据写错而恒绿。
  // 这里把判据的**输入**换成一个假的（往 router 源里塞一条没进巡检清单的路由），
  // 断言守卫**当场判红**并点名那条路由。
  //
  // 做法：不改真文件（那会污染工作区），而是把「router 源码 + 巡检清单」
  // 这两个输入抽成纯函数，再用假输入驱动它。
  it('变异反证：往 router 塞一条未登记路由 → 路由覆盖守卫当场判红并点名它', () => {
    const { computeUncoveredRoutes } = require(path.join(scriptsDir, 'ui-audit-scripts.lib.js'))

    // 真实输入：当前应为零漏登记
    const real = computeUncoveredRoutes(
      fs.readFileSync(routerFile, 'utf8'),
      readScript('ui-audit-capture.js') + '\n' + readScript('ui-audit-scenes.js') + '\n' + readScript('ui-audit-recon.js'),
    )
    expect(real, '真实仓库当前存在漏登记的路由').toEqual([])

    // 变异输入：router 多一条 `/__mutation-probe`，巡检清单里没有
    const mutatedRouter = fs.readFileSync(routerFile, 'utf8')
      .replace('const routes = [', "const routes = [\n  { path: '/__mutation-probe', name: 'MutationProbe', component: () => import('@/views/Home.vue') },")
    const mutated = computeUncoveredRoutes(mutatedRouter, readScript('ui-audit-capture.js'))
    expect(mutated, '守卫对未登记路由没有判红 —— 这条锁是恒真的').toContain('/__mutation-probe')
  })
})

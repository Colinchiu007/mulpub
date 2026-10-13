/**
 * 回归保护测试：platform-definitions.browser.js 导出完整性
 *
 * 背景（Bug 复盘 2026-09-05）：
 *   提交 c3c395570 在 Accounts.vue 中新增了 PLATFORM_LOGIN_URLS 导入，
 *   但 platform-definitions.browser.js 缺少该导出，导致 Vite 编译失败。
 *
 * 本测试确保 CJS 版（platform-definitions.js）中所有渲染端需要的数据导出
 * 在 ESM 浏览器版（platform-definitions.browser.js）中同步存在。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// CJS 版 — 渲染端可能消费的所有数据导出
import cjsModule from '../platform-definitions.js'

// ESM 浏览器版 — 渲染端实际使用的版本（Vite resolve.alias 映射）
import * as browserModule from '../platform-definitions.browser.js'

/**
 * 渲染端需要的数据导出清单。
 * 注意：isPlatformAuthHost / isPlatformLoginSuccessUrl / isPlatformCookieDomain
 * 等函数是 Node 主进程专用，不在此清单中。
 *
 * ⚠ 这份清单是**手工**维护的，只能保护「已被登记的名字」——2026-10-13 实测到它的
 * 盲区：Accounts.vue 新增 PLATFORM_CREATOR_HOME_URLS 导入时，本清单尚未登记它，
 * 而 browser 版也没加该导出，于是**单测全绿、真实 Vite 构建会拿到 undefined**。
 * 因此下方另有 'renderer consumer-derived' 锁：它从**真实消费方源码**推导需要哪些
 * 导出，不再依赖人手登记（登记表仍保留：它额外锁住「CJS 与 browser 两版 key 集合一致」）。
 */
const RENDERER_DATA_EXPORTS = [
  'PLATFORM_NAMES',
  'PLATFORM_ICONS',
  'PLATFORM_LOGIN_URLS',
  'PLATFORM_DASHBOARD_URLS',
  'PLATFORM_CREATOR_HOME_URLS',
]

describe('platform-definitions.browser.js 导出完整性', () => {
  for (const exportName of RENDERER_DATA_EXPORTS) {
    it(`浏览器版导出 ${exportName}`, () => {
      expect(browserModule).toHaveProperty(exportName)
      expect(browserModule[exportName]).toBeDefined()
      expect(typeof browserModule[exportName]).toBe('object')
    })

    it(`CJS 版和浏览器版的 ${exportName} 平台 key 集合一致`, () => {
      const cjsKeys = Object.keys(cjsModule[exportName] || {})
      const browserKeys = Object.keys(browserModule[exportName] || {})
      expect(browserKeys.sort()).toEqual(cjsKeys.sort())
    })
  }

  it('PLATFORM_LOGIN_URLS 中每个平台都有对应的 PLATFORM_DASHBOARD_URLS', () => {
    const loginPlatforms = Object.keys(browserModule.PLATFORM_LOGIN_URLS)
    const dashboardPlatforms = Object.keys(browserModule.PLATFORM_DASHBOARD_URLS)
    for (const p of loginPlatforms) {
      expect(dashboardPlatforms).toContain(p)
    }
  })

  it('PLATFORM_DASHBOARD_URLS 中每个平台都有对应的 PLATFORM_LOGIN_URLS', () => {
    const loginPlatforms = Object.keys(browserModule.PLATFORM_LOGIN_URLS)
    const dashboardPlatforms = Object.keys(browserModule.PLATFORM_DASHBOARD_URLS)
    for (const p of dashboardPlatforms) {
      expect(loginPlatforms).toContain(p)
    }
  })
})

/**
 * 消费方推导锁（2026-10-13，xhs-creator-home-url 事故反哺）
 *
 * 上面那份 RENDERER_DATA_EXPORTS 是**人手登记**的，只能保护已登记的名字。
 * 本锁换成机械推导：扫描 `apps/desktop/src` 下**真实源码**里对该模块的命名导入，
 * 逐个断言浏览器版存在同名导出。
 *
 * 它拦的是「单测绿、线上炸」这一类：`apps/desktop/vitest.config.js` 的 resolve.alias
 * **只登记了 `@`**，不含 platform-definitions，于是渲染端单测解析到的是 CJS 版；
 * 而真实构建（`vite.config.js` 的 alias）解析到 browser 版。两版不一致时，
 * 单测全绿而 Vite 侧拿到 `undefined`——2026-09-05（PLATFORM_LOGIN_URLS 缺失导致
 * 编译失败）与本日（PLATFORM_CREATOR_HOME_URLS 缺失，点击即 TypeError）同源。
 */
describe('platform-definitions.browser.js 消费方推导锁', () => {
  const SPECIFIER_RE = /import\s*\{([^}]*)\}\s*from\s*['"]@multi-publish\/shared-utils\/src\/platform-definitions(?:\.browser\.js)?['"]/g

  /** 从 __dirname 逐级上溯找 apps/desktop/src；找不到即红（禁止静默跳过） */
  function findRendererSrc () {
    let dir = path.dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 12; i++) {
      const candidate = path.join(dir, 'apps', 'desktop', 'src')
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    // 静默 return 会让本锁永久假绿（本仓已发生过同型事故），必须 fail closed
    throw new Error('找不到 apps/desktop/src，消费方推导锁无法执行')
  }

  function walk (dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        walk(full, out)
      } else if (/\.(js|ts|vue|mjs)$/.test(entry.name)) {
        out.push(full)
      }
    }
    return out
  }

  function parseNames (clause) {
    return clause
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
  }

  it('渲染端源码里对该模块的每个命名导入，浏览器版都必须存在同名导出', () => {
    const srcDir = findRendererSrc()
    const files = walk(srcDir)

    // 反失明：目录读空 / 解析退化成空集合都会让本锁恒绿
    expect(files.length).toBeGreaterThan(500)

    const sites = []
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      for (const m of text.matchAll(SPECIFIER_RE)) {
        sites.push({ file: path.relative(srcDir, file), names: parseNames(m[1]) })
      }
    }
    // 已登记消费方：Accounts / PublishHistory / PublishTypeDialog / CollectedResultsList /
    // PerformanceInsights / useSourceEntry —— 少于 5 处说明匹配逻辑已失效
    expect(sites.length).toBeGreaterThanOrEqual(5)

    const allNames = new Set()
    for (const site of sites) {
      for (const name of site.names) {
        allNames.add(name)
        expect(
          Object.prototype.hasOwnProperty.call(browserModule, name),
          `${site.file} 导入了 ${name}，但 platform-definitions.browser.js 没有该导出` +
            '（真实 Vite 构建会拿到 undefined；单测因 alias 缺失解析到 CJS 版而看不出问题）'
        ).toBe(true)
      }
    }
    // 反失明：命名导入的种类数必须成规模，否则说明上面 parseNames 解析成了空
    expect(allNames.size).toBeGreaterThanOrEqual(4)
    expect(allNames.has('PLATFORM_NAMES')).toBe(true)
  })
})
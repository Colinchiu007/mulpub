/**
 * publish-gate-help-parity.test.js — 「解法链接」三处一致性锁
 *
 * ## 为什么要锁
 *
 * 同一条失败码（如 `ACCOUNT_NOT_VERIFIED`）会出现在三个地方：
 *
 *   ① `packages/shared-utils/src/publish-gate-help.js`        （CJS，主进程）
 *   ② `packages/shared-utils/src/publish-gate-help.browser.js`（ESM，渲染进程）
 *   ③ `packages/api-publish-engine/.../toutiao-video-publish.js` 的 `ACCOUNT_FIX_URL`
 *
 * ①② 必须两份，因为浏览器不能执行 CJS（本仓既有先例）。
 * ③ 不能 require 本包 —— `packages/api-publish-engine` 是**零 workspace 依赖运行时**
 *    （见该包 `src/publish/category-resolver.js` 头注释、`package.json` 的 files 与 Docker COPY 清单），
 *    所以那边按同一批形态规则自带一份常量，与 `cloud-accounts/validate-account.js` 的先例同手法。
 *
 * 三处只要有一处漂移，用户就会被送到**错的页面**，而且**不会报错**（看起来一切正常）。
 * 所以这里用机械判据钉住，不靠人记得同步。
 */
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { PUBLISH_GATE_HELP, helpForCode } = require('../src/publish-gate-help')

const BROWSER_SRC = path.resolve(__dirname, '../src/publish-gate-help.browser.js')
const ENGINE_SRC = path.resolve(
  __dirname,
  '../../api-publish-engine/src/publish/platforms/toutiao-video-publish.js'
)

async function loadBrowserVariant () {
  return import(pathToFileURL(BROWSER_SRC).href)
}

/** 从引擎源码里取 `const ACCOUNT_FIX_URL = '<url>'` 的字面量（静态读，不 require） */
function engineFixUrl () {
  const src = fs.readFileSync(ENGINE_SRC, 'utf8')
  const m = src.match(/const ACCOUNT_FIX_URL = '([^']+)'/)
  if (!m) throw new Error('引擎源码里找不到 ACCOUNT_FIX_URL 字面量（判据自身故障，按未证实处理）')
  return m[1]
}

describe('publish-gate-help：CJS / ESM 两份保持一致', () => {
  it('两份的码集合完全相同', async () => {
    const esm = await loadBrowserVariant()
    const cjsCodes = Object.keys(PUBLISH_GATE_HELP).sort()
    const esmCodes = Object.keys(esm.PUBLISH_GATE_HELP).sort()
    expect(esmCodes).toEqual(cjsCodes)
    // 下界断言：表不能是空的，否则「一致」是空的真
    expect(cjsCodes.length).toBeGreaterThan(0)
  })

  it('每个码的 url / labelKey / fallbackLabel 逐字段相同', async () => {
    const esm = await loadBrowserVariant()
    for (const code of Object.keys(PUBLISH_GATE_HELP)) {
      expect(esm.PUBLISH_GATE_HELP[code]).toEqual(PUBLISH_GATE_HELP[code])
    }
  })

  it('两份的 helpForCode 行为相同（含未知码 / 空值 / 非字符串）', async () => {
    const esm = await loadBrowserVariant()
    for (const code of [...Object.keys(PUBLISH_GATE_HELP), 'NOT_A_REAL_CODE', '', null, undefined, 123]) {
      expect(esm.helpForCode(code)).toEqual(helpForCode(code))
    }
  })
})

describe('publish-gate-help：与引擎常量保持一致（引擎不可 require 本包，故静态读源码）', () => {
  it('引擎的 ACCOUNT_FIX_URL 必须等于本表的 ACCOUNT_NOT_VERIFIED.url', () => {
    expect(engineFixUrl()).toBe(PUBLISH_GATE_HELP.ACCOUNT_NOT_VERIFIED.url)
  })

  it('两个码指向同一个官方入口（同一问题的两种触发路径）', () => {
    expect(PUBLISH_GATE_HELP.NO_PUBLISH_PERMISSION.url).toBe(PUBLISH_GATE_HELP.ACCOUNT_NOT_VERIFIED.url)
  })
})

describe('publish-gate-help：值本身必须合规', () => {
  it('url 必须是 http/https 且不含 userinfo', () => {
    for (const [code, item] of Object.entries(PUBLISH_GATE_HELP)) {
      const u = new URL(item.url)
      expect(['http:', 'https:'], code + ' 的协议').toContain(u.protocol)
      expect(u.username, code + ' 不得带 userinfo').toBe('')
      expect(u.password, code + ' 不得带 userinfo').toBe('')
    }
  })

  it('labelKey 必须落在 publishPage 命名空间、fallbackLabel 非空', () => {
    for (const [code, item] of Object.entries(PUBLISH_GATE_HELP)) {
      expect(item.labelKey.startsWith('publishPage.'), code + ' 的 labelKey 命名空间').toBe(true)
      expect(String(item.fallbackLabel).length, code + ' 的 fallbackLabel').toBeGreaterThan(0)
    }
  })

  it('helpForCode 未知码返回 null（不抛错、不返回 undefined 形状）', () => {
    expect(helpForCode('NOPE')).toBeNull()
    expect(helpForCode('')).toBeNull()
    expect(helpForCode(null)).toBeNull()
    expect(helpForCode(undefined)).toBeNull()
    expect(helpForCode(123)).toBeNull()
  })
})

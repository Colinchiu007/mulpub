// @ts-check
/**
 * http-login-checker-uid-coverage.test.js — 八平台 platform_uid 提取覆盖结构锁
 *
 * 为什么存在（docs/adr/0004、PRD-CLOUD-ACCOUNT-SYNC §5.1、openspec add-cloud-account-sync tasks 3.5）：
 * 云端合并键是 `(platform, platform_uid)`，`platform_uid` 必须是平台原生主键。
 * 「4/8 平台能取 uid」这种缺口是**逐平台、按名字**才会暴露的沉默缺陷：普通单测只测已实现的
 * 平台，永远不会因为「少写了一个平台」而变红。本文件把「覆盖完整性」本身变成断言：
 *
 *  1. 平台集合真源 = `PLATFORM_ACCOUNT_INFO_SELECTORS`（platform-definitions 里的账号资料枚举），
 *     不在「已知不支持 uid 提取」白名单里的每个平台都**必须**在 `HTTP_CHECK_APIS` 登记 extract。
 *     → 枚举里新增平台却没补 uid 提取 = 立即变红（防漂移），把平台从枚举里删掉躲锁 = 也变红。
 *  2. 每个平台的 uid 提取在 `http-login-checker-info.test.js` 里必须**同时存在正例与负例**
 *     （命名约定见该文件头注释）。只有正例的 extract 会在平台风控/未登录页面上「猜」出一个 uid，
 *     那比取不到更糟——它会把两台设备的不同账号静默合成一条。
 *  3. `uidSource` 声明合法（json/html/cookie），且 cookie 型来源（快手）不得被登录检测当成支持，
 *     否则 `tryHttpLoginCheck` 会对不存在的端点发请求并污染登录态结论。
 *  4. HTML 身份属性清单与页面内 DOM 采集器（account-profile.js）的通用回退清单**同源**，
 *     两处漂移即红——禁止出现「HTTP 通道认 data-user，DOM 通道不认」这种第二套口径。
 *
 * 反证纪律（AGENTS.md「任何防再犯锁必须做一次把锁改成 no-op 立刻变红的变异」）：
 * 注释掉 HTTP_CHECK_APIS 里任一平台的 extract、或删掉 info 测试里任一负例，本文件必须立刻变红。
 *
 * 无真实出站网络：只读源码文本 + 遍历登记表（QM-3 / network-egress-guard）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import infoTestRaw from './http-login-checker-info.test.js?raw'

// shared-utils 是 CJS 包：与 account-profile-collector.test.js 同款 require 取法
// （命名 import 依赖打包器的 CJS 静态分析，仓库既有先例一律走 require）
// uid 取值原语已拆到 ./platform-uid；结构锁跟着代码搬，否则锁会对着旧落点假绿。
const uidPrimitives = require('./platform-uid')
const accountProfileModule = require('@multi-publish/shared-utils/src/account-profile')
const { PLATFORM_ACCOUNT_INFO_SELECTORS } = require('@multi-publish/shared-utils/src/platform-definitions')

/**
 * 已知「不支持 platform_uid 提取」的平台白名单（账号管理不承载这些平台，云端合并键用不到）。
 * 放在锁这一侧、而不是生产代码里：新增运行时代码平台时必须在这里**显式表态**
 * （补 extract，或说明为什么该平台不进账号管理），且八平台永远不得写进本表（有断言把守）。
 */
const UID_UNSUPPORTED_ALLOWLIST = [
  'weibo', 'baijiahao', 'youtube', 'tiktok', 'twitter', 'instagram', 'facebook',
]

/** PRD §5.1 点名的八个账号管理平台：白名单永远不得包含其中任何一个 */
const ACCOUNT_MANAGED_PLATFORMS = [
  'douyin', 'toutiao', 'wechat_mp', 'tencent_video', 'bilibili', 'kuaishou', 'xiaohongshu', 'zhihu',
]

const UID_SOURCE_VALUES = new Set(['json', 'html', 'cookie'])
const NEGATIVE_TITLE_RE = /未登录|login\s?page/i

/**
 * 推导出的「必须有 uid 提取」平台集合 = 平台枚举真源 − 白名单。
 * 模块级计算（`it.each` 在收集阶段就要用它）：真源一旦被清空/改名，下面的规模下界断言即红。
 */
const UID_PLATFORMS = Object.keys(PLATFORM_ACCOUNT_INFO_SELECTORS)
  .filter(p => !UID_UNSUPPORTED_ALLOWLIST.includes(p))

/**
 * 把测试文件源码切成 `it("标题", …)` 块。
 * 用源码文本而不是「跑测试统计结果」：本锁必须在实现缺失时变红，而不是在用例被删掉时静默少几条。
 * @param {string} source
 * @returns {Array<{title: string, body: string}>}
 */
function parseItBlocks (source) {
  const re = /^[ \t]*it\(\s*(["'`])([\s\S]*?)\1\s*,/gm
  /** @type {Array<{title: string, index: number, bodyStart: number}>} */
  const marks = []
  let m
  while ((m = re.exec(source)) !== null && marks.length < 500) {
    marks.push({ title: m[2], index: m.index, bodyStart: re.lastIndex })
  }
  return marks.map((mark, i) => ({
    title: mark.title,
    body: source.slice(mark.bodyStart, i + 1 < marks.length ? marks[i + 1].index : source.length),
  }))
}

/** 筛出「标题以该平台 key 开头」的用例块（命名约定的第一半，锁 2 用它定位平台） */
function blockOf (blocks, platform) {
  return blocks.filter(b => b.title === platform || b.title.startsWith(platform + ' '))
}

describe('八平台 platform_uid 提取覆盖结构锁', () => {
  /** @type {any} */
  let checker

  beforeEach(async () => {
    vi.resetModules()
    global.__enableElectronMock()
    global.__resetElectronMock()
    __registerMock('./logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
    checker = await import('./http-login-checker.js')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── 前提：平台集合来自真源，不是硬编码八个字符串 ───
  it('平台枚举真源非空且规模有下界（防「解析退化成空集合」把锁变成真空通过）', () => {
    expect(Object.keys(PLATFORM_ACCOUNT_INFO_SELECTORS).length).toBeGreaterThanOrEqual(15)
    expect(UID_PLATFORMS.length).toBeGreaterThanOrEqual(ACCOUNT_MANAGED_PLATFORMS.length)
  })
  it('八平台全部落在「枚举 − 白名单」的推导结果里（把平台从枚举删掉躲锁即红）', () => {
    for (const platform of ACCOUNT_MANAGED_PLATFORMS) {
      expect(Object.keys(PLATFORM_ACCOUNT_INFO_SELECTORS), '平台已从采集枚举里消失: ' + platform).toContain(platform)
      expect(UID_PLATFORMS, platform).toContain(platform)
    }
  })
  it('白名单自洽：只允许枚举内的平台，且永远不得包含八平台中的任何一个', () => {
    for (const platform of UID_UNSUPPORTED_ALLOWLIST) {
      expect(Object.keys(PLATFORM_ACCOUNT_INFO_SELECTORS), '白名单里有未知平台（枚举已改名/删除？）: ' + platform)
        .toContain(platform)
      expect(ACCOUNT_MANAGED_PLATFORMS, '八平台被放进了「不支持 uid」白名单: ' + platform).not.toContain(platform)
    }
  })

  // ─── 锁 1：逐个平台必须有 extract 实现 ───
  it.each(UID_PLATFORMS.length ? UID_PLATFORMS.map(p => [p]) : [['<枚举为空：必须处理>']])(
    'HTTP_CHECK_APIS[%s] 登记了 uid/资料 extract 实现',
    (platform) => {
      const api = checker.HTTP_CHECK_APIS[platform]
      expect(api, 'HTTP_CHECK_APIS 缺少平台: ' + platform).toBeTruthy()
      expect(typeof api.extract, platform + ' 必须实现 extract（uid 提取）').toBe('function')
    },
  )
  it('uidSource 声明合法，且 json/html 来源必须有端点 URL', () => {
    for (const platform of UID_PLATFORMS) {
      const api = checker.HTTP_CHECK_APIS[platform]
      expect(api, platform + ' 未登记 HTTP_CHECK_APIS').toBeTruthy()
      const source = api.uidSource || 'json'
      expect(UID_SOURCE_VALUES.has(source), platform + ' 的 uidSource 非法: ' + api.uidSource).toBe(true)
      if (source === 'cookie') {
        // cookie 型来源不得带端点：带了就会被登录检测当成可用通道（快手是雷区平台）
        expect(api.url, platform + ' uidSource:cookie 不得登记端点 URL').toBeFalsy()
        expect(checker.isHttpCheckSupported(platform), platform + ' 不得被当成 HTTP 登录检测支持').toBe(false)
      } else {
        expect(typeof api.url, platform + ' 的 uid 来源需要端点 URL').toBe('string')
        expect(/^https:\/\//.test(api.url), platform + ' 端点必须是 https: ' + api.url).toBe(true)
      }
    }
  })
  it('登记表里的每个平台都在平台枚举内（防出现第二套平台口径）', () => {
    for (const platform of Object.keys(checker.HTTP_CHECK_APIS)) {
      expect(Object.keys(PLATFORM_ACCOUNT_INFO_SELECTORS), '未知平台出现在 HTTP_CHECK_APIS: ' + platform)
        .toContain(platform)
    }
  })

  // ─── 锁 2：逐平台正例 + 负例齐备（源码结构断言）───
  it('info 测试文件可被解析出 it 块（解析退化即红，防止锁对空集合假绿）', () => {
    expect(parseItBlocks(infoTestRaw).length).toBeGreaterThan(ACCOUNT_MANAGED_PLATFORMS.length * 2)
  })
  it.each(ACCOUNT_MANAGED_PLATFORMS.map(p => [p]))(
    '%s 的 uid 提取同时存在正例（取到非空 platformAccountId）与负例（未登录/login page 不产出）',
    (platform) => {
      const blocks = blockOf(parseItBlocks(infoTestRaw), platform)
      const positives = blocks.filter(b => /platformAccountId:\s*["'][^"']+["']/.test(b.body))
      const negatives = blocks.filter(b =>
        NEGATIVE_TITLE_RE.test(b.title) &&
        /toEqual\(\{\s*supported:\s*(?:true|false)\s*\}\)/.test(b.body) &&
        !/platformAccountId:/.test(b.body))
      expect(positives.length, platform + ' 缺少正例：需一条断言非空 platformAccountId 的用例（标题以 "' + platform + ' " 开头）')
        .toBeGreaterThanOrEqual(1)
      expect(negatives.length, platform + ' 缺少负例：需一条标题含「未登录」或「login page」、整对象精确断言 supported（无 uid 键）的用例')
        .toBeGreaterThanOrEqual(1)
    },
  )

  // ─── 锁 3：HTML 身份属性清单与 DOM 采集器同源（禁止第二套口径）───
  it('UID_HTML_ATTRS 与 account-profile 采集器的通用身份属性清单逐项相等', () => {
    const collectorSrc = accountProfileModule.accountInfoCollector.toString()
    const listLiteral = collectorSrc.match(
      /withFallback\(platformSelectors && platformSelectors\.platformAccountId,\s*\[([\s\S]*?)\]\)/)
    expect(listLiteral, '采集器的通用身份属性清单结构已变，本锁需同步（不得静默跳过）').not.toBeNull()
    const generic = [...listLiteral[1].matchAll(/'\[([^\]]+)\]'/g)].map(m => m[1])
    expect(generic.length, '未从采集器源码解析出通用身份属性清单').toBeGreaterThan(0)
    // 采集器侧是 CSS 属性选择器（`[data-user-id]`），HTTP 侧是属性名（`data-user-id`）：
    // 去掉选择器括号后逐项相等（顺序无关），任一侧增删都要同步另一侧
    expect([...uidPrimitives.UID_HTML_ATTRS].sort(), 'HTTP 通道与 DOM 通道的身份属性清单漂移').toEqual(generic.slice().sort())
  })
  it('uid 形态白名单拒绝占位与超长文本（normalizeUid 是三条来源共用的唯一收口）', () => {
    for (const bad of ['', '   ', '0', 'null', 'undefined', '{{userId}}', '首页 - 知乎', 'x'.repeat(65), '<script>', 'a b']) {
      expect(uidPrimitives.normalizeUid(bad), '非法 uid 候选被放行: ' + JSON.stringify(bad)).toBe('')
    }
    expect(uidPrimitives.normalizeUid(' 5321009876543 ')).toBe('5321009876543')
    expect(uidPrimitives.normalizeUid(31000000)).toBe('31000000')
  })
  it('HTML 身份属性在页面内出现多个互不相同的值时不产出（访客身份不得当本机 uid）', () => {
    expect(uidPrimitives.extractUidFromHtml('<div data-user-id="a1"></div>')).toBe('a1')
    expect(uidPrimitives.extractUidFromHtml('<i data-user-id="a1"></i><b data-user-id="b2"></b>')).toBe('')
    expect(uidPrimitives.extractUidFromHtml('<div>登录知乎</div>')).toBe('')
  })
})

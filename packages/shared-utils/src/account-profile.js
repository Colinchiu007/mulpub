'use strict'
/**
 * account-profile.js — 账号资料（昵称/头像/平台ID/粉丝）采集与写回契约
 *
 * 存在理由（2026-09-23，PRD-ACCOUNT-PROFILE-INFO-2026-09-23）：
 * 1. 「能力存在但没人调用」的装饰性链路缺陷第三次复发——采集函数原本只在
 *    captureCookies()（唯一入口 account:add，渲染层零调用）里被用到，三条真实
 *    登录入口与登录态检测都不产出 accountInfo，昵称/头像因此永远为空。
 *    故把采集实现收敛到本模块，Playwright 与 Electron 双运行时共用同一份代码。
 * 2. 后端 PATCH 的语义是「字段缺席 = 不修改」（`... | None = None` + `is not None`
 *    才赋值）。旧实现把未命中字段算成空串下发，等于反向清空上一次已获取的昵称/头像。
 *    故写回一律经 buildProfilePatch()：只有命中且与真源不同的字段才出现在请求体里。
 *
 * 约束：accountInfoCollector 必须**完全自包含**——Playwright 会把它函数体序列化后
 * 注入页面执行，Electron 的 webContents.executeJavaScript 只能接受字符串。任何闭合
 * 外部变量的写法都会在其中一个运行时静默失败（历史 no-undef 即为此类）。
 */

const { PLATFORM_ACCOUNT_INFO_SELECTORS } = require('./platform-definitions')
const { isNoiseAccountName } = require('./account-name-guard')

/**
 * 页面内采集账号资料。参数为 { platformSelectors }，返回命中字段；未命中不产出键。
 * 必须在浏览器页面上下文中执行，禁止引用本模块之外的任何标识符。
 * @param {{platformSelectors?: object|null}} arg
 * @returns {object}
 */
function accountInfoCollector (arg) {
  const input = arg && typeof arg === 'object' ? arg : {}
  const platformSelectors = input.platformSelectors && typeof input.platformSelectors === 'object'
    ? input.platformSelectors
    : null
  const info = {}
  const textOf = (s) => (typeof s === 'string' ? s.trim() : '')
  // 昵称长度上限：超过这个长度的「文本」几乎必然是整块容器文本而非名字（容器 textContent
  // 会把统计块、菜单、占位文案一并吃进来）。放在采集端而非噪声守卫，因为用户手写的长名字
  // 不该被展示端判成垃圾并藏起来。
  const NICK_MAX_LEN = 30
  const trySelectors = (selectors, maxLen) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el) {
        const text = textOf(el.textContent)
        if (text && (!maxLen || text.length <= maxLen)) return text
      }
    }
    return null
  }
  const tryAttrSelectors = (selectors, attr) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el && el.getAttribute(attr)) return textOf(el.getAttribute(attr))
    }
    return null
  }
  // 平台专用选择器优先，未命中必须继续试通用选择器（只提供平台表的一行不会覆盖全部 DOM 形态）
  const withFallback = (specific, generic) => (Array.isArray(specific) && specific.length ? specific.concat(generic) : generic)

  // 昵称：平台专用 → 通用「名字节点」选择器。
  // 通用表刻意只留语义明确指向名字的选择器：历史上这里还有 .user-info、
  // [class*="profile"] h1/strong、[class*="creator"] h1/span，它们会命中页面上任意
  // 装饰容器，2026-09-26 生产库的「485.9万人看过」（统计块）与
  // 「分享此刻的想法...同步到圈子发想法」（输入框占位）就是这两条抓出来的。
  const nickSelectors = withFallback(platformSelectors && platformSelectors.nickname, [
    '[class*="nickname"]', '[class*="username"]', '[class*="user-name"]',
    '.profile-name', '#nickname', '#username', '[data-user-name]',
  ])
  // 昵称只认名字节点。曾经这里还有 og:title → twitter:title → document.title 三级兜底，
  // 把「网页标题」当昵称写进了 account_name（小红书创作服务平台 / 快手创作者服务平台 /
  // 抖音创作者中心 / 哔哩哔哩 (゜ —— 最后一条还因去后缀正则按首个连字符截断而残缺）。
  // 网页标题永远不是账号昵称，故不采纳任何标题类来源：未命中就不产出 nickName 键，
  // 由 buildProfilePatch 的「键缺席 = 不修改」保住上一次的真值，展示端回落平台名。
  const nickName = trySelectors(nickSelectors, NICK_MAX_LEN)
  if (nickName) info.nickName = nickName

  // 头像：img src 系列 → 背景图 url() → og:image
  const avatarEl = document.querySelector(
    '[class*="avatar"] img, .avatar img, [class*="avatar-img"], ' +
    'img[class*="avatar"], img[class*="profile"], img[class*="portrait"], ' +
    '[class*="avatar"] [style*="background"], [class*="user-icon"] img'
  )
  let avatar = ''
  if (avatarEl) {
    avatar = avatarEl.src || avatarEl.getAttribute('data-src') || avatarEl.getAttribute('data-original') || ''
    avatar = textOf(avatar)
    if (!avatar && avatarEl.style && avatarEl.style.backgroundImage) {
      const bgMatch = String(avatarEl.style.backgroundImage).match(/url\(["']?([^"')]+)["']?\)/)
      if (bgMatch) avatar = textOf(bgMatch[1])
    }
  }
  if (!avatar) {
    const metaImg = document.querySelector('meta[property="og:image"]')
    if (metaImg) avatar = textOf(metaImg.getAttribute('content'))
  }
  if (avatar) info.avatar = avatar

  // 平台用户 ID
  const idSelectors = withFallback(platformSelectors && platformSelectors.platformAccountId,
    ['[data-user-id]', '[data-account-id]', '[data-user]'])
  const platformAccountId = tryAttrSelectors(idSelectors, 'data-user-id') ||
    tryAttrSelectors(idSelectors, 'data-account-id') || ''
  if (platformAccountId) info.platformAccountId = platformAccountId

  // 粉丝数：「1.2万」/「1,234」折算为整数
  const followerSelectors = withFallback(platformSelectors && platformSelectors.followers,
    ['[class*="fans"]', '[class*="follower"]', '[class*="fan-count"]', '[class*="followers-count"]'])
  const followerText = trySelectors(followerSelectors)
  if (followerText) {
    const match = followerText.match(/([\d.,]+)\s*(万|w|W)?/)
    if (match) {
      const num = Number(String(match[1]).replace(/,/g, ''))
      if (Number.isFinite(num)) {
        const suffix = (match[2] || '').toLowerCase()
        info.followers = Math.round(num * (suffix === '万' || suffix === 'w' ? 10000 : 1))
      }
    }
  }
  return info
}

/** 取平台专用选择器；无平台或未知平台返回 null（采集器走通用回退）。 */
function selectorsFor (platform) {
  return (platform && PLATFORM_ACCOUNT_INFO_SELECTORS[platform]) || null
}

/**
 * 生成可直接交给 webContents.executeJavaScript 的自求值表达式。
 * Electron 侧不能给 executeJavaScript 传参，只能把选择器内联进脚本文本。
 */
function buildCollectorExpression (platformSelectors) {
  const arg = JSON.stringify({ platformSelectors: platformSelectors || null })
  return '(' + accountInfoCollector.toString() + ')(' + arg + ')'
}

function isPlainObject (v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function trimText (v) {
  return typeof v === 'string' ? v.trim() : ''
}

function toFiniteCount (v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v) : NaN)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

/**
 * Playwright 运行时采集（保持既有调用形状：page.evaluate(fn, { platformSelectors })）。
 * 失败一律降级 {}：昵称/头像是尽力而为的增强信息，不得让登录/保存流程因此中断。
 */
async function collectWithPlaywright (page, platform) {
  try {
    const info = await page.evaluate(accountInfoCollector, { platformSelectors: selectorsFor(platform) })
    return isPlainObject(info) ? info : {}
  } catch {
    return {}
  }
}

/**
 * Electron webview / BrowserView / WebContents 运行时采集。
 * @param {{executeJavaScript: Function}} webContents
 */
async function collectWithWebContents (webContents, platform) {
  try {
    if (!webContents || typeof webContents.executeJavaScript !== 'function') return {}
    const info = await webContents.executeJavaScript(buildCollectorExpression(selectorsFor(platform)), true)
    return isPlainObject(info) ? info : {}
  } catch {
    return {}
  }
}

/**
 * 创建（POST）用资料字段：新行没有旧值需要保护，未命中按空值落盘，昵称回落显示名。
 */
function profileForCreate (accountInfo, fallbackName) {
  const src = isPlainObject(accountInfo) ? accountInfo : {}
  const followers = toFiniteCount(src.followers)
  const nick = trimText(src.nickName)
  const cleanNick = nick && !isNoiseAccountName(nick) ? nick : ''
  return {
    account_name: cleanNick || trimText(fallbackName),
    platform_account_id: trimText(src.platformAccountId) || '',
    followers: followers === null ? null : followers,
    avatar: trimText(src.avatar) || '',
  }
}

/**
 * 更新（PATCH）用资料字段：只产出「命中且与真源不同」的键。
 * 键缺席 = 本次不修改（后端 `is not None` 语义）——这是防止提取失败反把
 * 上一次拿到的昵称/头像清空成空串的唯一防线。
 * @param {object} accountInfo 采集结果
 * @param {object|null} current 后端当前账号对象（用于跳过无变化写入）
 */
function buildProfilePatch (accountInfo, current) {
  const src = isPlainObject(accountInfo) ? accountInfo : {}
  const cur = isPlainObject(current) ? current : null
  const rawNick = trimText(src.nickName)
  const candidates = [
    ['account_name', rawNick && !isNoiseAccountName(rawNick) ? rawNick : ''],
    ['avatar', trimText(src.avatar)],
    ['platform_account_id', trimText(src.platformAccountId)],
    ['followers', src.followers === undefined || src.followers === null || src.followers === '' ? null : toFiniteCount(src.followers)],
  ]
  const patch = {}
  for (const [key, value] of candidates) {
    if (value === null || value === undefined || value === '') continue
    if (cur && cur[key] === value) continue
    patch[key] = value
  }
  return patch
}

module.exports = {
  accountInfoCollector,
  selectorsFor,
  buildCollectorExpression,
  collectWithPlaywright,
  collectWithWebContents,
  profileForCreate,
  buildProfilePatch,
}

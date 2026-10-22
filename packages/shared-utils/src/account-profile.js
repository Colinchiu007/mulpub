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
const { filterBrandImageUrls, isBrandImageUrl } = require('./account-avatar-guard')

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

  // 头像：**收集全部候选**（不是第一个），由 Node 侧剔除「站点品牌图」后择优。
  //
  // 为什么不再直接取第一个：平台 SPA 的导航栏/侧边栏常有品牌头像或运营位图片，
  // 第一个 `[class*="avatar"]` 未必是用户头像。
  // 为什么不再兜底 og:image：og:image 是**站点级**的品牌图（今日头条创作后台的
  // og:image = `obj/mp/logo-toutiao.png`），与「这是谁的账号」无关。2026-10-22 实测，
  // 它被落盘成了账号头像并因「值不变就不写」的语义再也不会被正确值覆盖。
  // 页面内不得引用本模块之外的任何标识符（函数体会被序列化注入页面），
  // 因此品牌图判定放在 Node 侧（./account-avatar-guard），页面内只负责「如实上报候选」。
  const avatarCandidates = []
  const pushAvatar = (value) => {
    const v = textOf(value)
    if (v && avatarCandidates.indexOf(v) === -1) avatarCandidates.push(v)
  }
  const avatarEls = document.querySelectorAll(
    '[class*="avatar"] img, .avatar img, [class*="avatar-img"], ' +
    'img[class*="avatar"], img[class*="profile"], img[class*="portrait"], ' +
    '[class*="avatar"] [style*="background"], [class*="user-icon"] img'
  )
  for (const el of Array.from(avatarEls)) {
    pushAvatar(el.src)
    pushAvatar(el.getAttribute('data-src'))
    pushAvatar(el.getAttribute('data-original'))
    if (el.style && el.style.backgroundImage) {
      const bgMatch = String(el.style.backgroundImage).match(/url\(["']?([^"')]+)["']?\)/)
      if (bgMatch) pushAvatar(bgMatch[1])
    }
  }
  if (avatarCandidates.length) info.avatarCandidates = avatarCandidates

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
 * 从页面采集到的头像候选里挑出「用户头像」：剔除站点品牌图后取第一个。
 * 全部候选都是品牌图时返回空串 —— 调用方据此**不产出头像**，
 * 而不是退回第一张品牌图（那正是 2026-10-22 生产事故的形态：账号卡显示平台 logo）。
 * @param {unknown} candidates
 * @returns {string}
 */
function pickUserAvatar (candidates) {
  const kept = filterBrandImageUrls(candidates)
  return kept.length ? kept[0] : ''
}

/**
 * 把页面内采集器的原始产物收口成对外资料对象。
 * 页面内只上报 `avatarCandidates`（它无法引用本模块的品牌图判定），
 * 品牌图剔除统一在 Node 侧做，保证「站点品牌图不算用户头像」这条判据只有一份实现。
 * @param {unknown} raw
 * @returns {object}
 */
function finalizeCollectedInfo (raw) {
  if (!isPlainObject(raw)) return {}
  const out = { ...raw }
  const hasCandidates = Array.isArray(out.avatarCandidates)
  const candidates = hasCandidates ? out.avatarCandidates : []
  delete out.avatarCandidates
  if (hasCandidates) {
    // 「本次确实看过页面并判过头像」这一事实要带出去：采集**失败**时不该动真源，
    // 而「页面上只有品牌图 ⇒ 该账号没有用户头像」是一个**结论**，需要能被下游区分。
    out.avatarResolved = true
    const avatar = pickUserAvatar(candidates)
    if (avatar) out.avatar = avatar
    else delete out.avatar
  }
  return out
}

/**
 * Playwright 运行时采集（保持既有调用形状：page.evaluate(fn, { platformSelectors })）。
 * 失败一律降级 {}：昵称/头像是尽力而为的增强信息，不得让登录/保存流程因此中断。
 */
async function collectWithPlaywright (page, platform) {
  try {
    const info = await page.evaluate(accountInfoCollector, { platformSelectors: selectorsFor(platform) })
    return finalizeCollectedInfo(info)
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
    return finalizeCollectedInfo(info)
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
  // 存量坏值治理（CCG 评审 i7，2026-10-22）：真源里已落的**站点品牌图**
  // （实测：头条号 `obj/mp/logo-toutiao.png`、百家号默认肖像、小红书默认头像）
  // 根本不是该账号的头像。若本次采集**确实看过页面**（avatarResolved）却仍拿不到
  // 真头像，说明页面上只有品牌图 ⇒ 该账号没有用户头像 ⇒ 把品牌图清掉。
  // 留着一张错图比显示灰色通用头像更糟（用户看到的正是本次报障的现象）。
  //
  // 边界（不得放宽）：
  // - 只在 `avatarResolved === true`（采集真的跑过并判过头像）时才清；
  //   采集失败（`avatarResolved` 缺席）一律不动真源。
  // - 只清**品牌图**；真源里若是真头像而本次没采到，保留它（键缺席 = 不修改）。
  if (src.avatarResolved === true && !patch.avatar && cur && isBrandImageUrl(cur.avatar)) {
    patch.avatar = ''
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
  pickUserAvatar,
  finalizeCollectedInfo,
}

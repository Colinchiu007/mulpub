/**
 * account-profile-refresh.js — 账号「资料刷新」侧
 *
 * 从 publishers/account-manager.js 拆出（第二刀，先例见同目录 account-session-restore.js），两条理由：
 * 1) 关注点不同：本模块回答「采到的昵称/头像/粉丝怎么回填进唯一真源」；account-manager 回答
 *    「怎么登录、怎么检测、怎么发布」。它与登录态判定只有一条边相连：检测有效之后顺手回填。
 * 2) 门禁：account-manager.js 在 .github/scripts/max-lines-baseline.json 挂账且余量持续被吃掉。
 *
 * 依赖注入约定：`isSafePathSegment` 由调用方在调用点注入，形态与同目录两份先例一致（都是 deps 对象：
 * `account-name-write.js` 的 `renameAccount(accountId, platform, newName, deps)`、
 * `account-session-restore.js` 的 `getAccountPartitionCookies(platform, accountId, deps)`）。
 * 本模块 **禁止** require('./account-manager') —— CJS 循环 require
 * 会拿到半初始化的导出对象，症状是只在加载顺序变化时偶发的 `is not a function`。无环的现场证据是
 * `pnpm exec madge --warning --circular apps/desktop/electron/main.js`（实跑：Processed 399 files、无环）；
 * 下面的成环锁只锁**直接** require，传递环由该 madge 证据覆盖。
 *
 * 四条纪律（拆分前后逐字不变，唯一例外是标了 C1 的那处）：
 * 1. 只在「有 DOM 且判定有效」的路径做 DOM 回填；HTTP 快速路径没有 DOM，不采。
 * 2. 只下发命中且与真源不同的字段（buildProfilePatch），未命中 = 键缺席 = 不修改。
 * 3. 任何失败都只记 warn 并返回 false —— 资料是增强信息，不得成为登录有效性证据。
 * 4. 用户显式命名（name_source=manual）一律不被采集结果覆盖（经 guardProfilePatchBySource）。
 *    **C1 是本刀唯一的行为修正**（QM-6 后端评审抓到）：HTTP 快速路径原先在真源 GET 失败时把当前值
 *    降级成 null 继续 PATCH，而 guard 在 current=null 时无条件把 name_source 标成 auto，等于用
 *    「取不到证据」覆盖用户显式命名；现改为与 DOM 路径同口径——读不到真源就一行不写。
 *
 * 日志 scope 刻意沿用 'AccountManager' 而不用新模块名：既有运维检索与历史日志都按该标签过滤，
 * 改名会让这条链路在日志里断档。
 */
const log = require('../services/logger')
const pythonBridge = require('../services/python-bridge')
const profileUtils = require('@multi-publish/shared-utils/src/account-profile')
// 持**模块对象**而不是解构出函数引用。account-manager.js 顶部那行 `const { tryHttpLoginCheck } =
// require('./http-login-checker')` 就是 require 期解构的形态：它会让测试里的
// vi.spyOn(checker, 'fetchAccountInfoViaHttpApi') 拦不到，只能靠「先装 spy、再清缓存、重新 require 消费方」
// 这一套顺序体操（见 account-manager-profile.test.js 里 runHttp 的注释）。本模块从拆出第一天就按调用点取属性，
// 把这条脆弱前提从根上去掉：新增消费方不必再复刻那段顺序。
const httpLoginChecker = require('./http-login-checker')
const accountNameWrite = require('./account-name-write')

/**
 * 从 Playwright 页面提取账号信息（昵称、头像、平台ID、粉丝数）。
 * 采集实现收敛在 @multi-publish/shared-utils/src/account-profile —— 同一份代码同时
 * 供 Playwright（函数体被序列化注入页面）与 Electron executeJavaScript（只接受字符串）使用，
 * 禁止在任何调用方复制第二份 DOM 采集（口径漂移正是本链路的历史病根）。
 * @param {object} page - Playwright page
 * @param {string} [platform] - 平台标识（可选）
 */
async function extractAccountInfo (page, platform = '') {
  return profileUtils.collectWithPlaywright(page, platform)
}

/**
 * 从 Electron WebContents（登录视图 / 内嵌 webview / 扫码视图）提取账号信息。
 * 三条真实登录入口都用它；采集失败返回 {}，绝不抛断登录流程。
 * @param {{executeJavaScript: Function}} webContents
 * @param {string} [platform]
 */
async function extractAccountInfoFromWebContents (webContents, platform = '') {
  return profileUtils.collectWithWebContents(webContents, platform)
}

/**
 * `isSafePathSegment` 由调用点注入（见 account-manager 的委托）。缺失时必须**响亮失败**：
 * 若把它留在 try 里，'undefined is not a function' 会被本模块自己的 catch 吞成 return false，
 * 表现为「资料永远不回填」这种无声缺陷，而不是接线错误。路径校验不得静默降级为不校验。
 */
function assertInjectedPathGuard (deps, section) {
  const isSafePathSegment = deps && deps.isSafePathSegment
  if (typeof isSafePathSegment !== 'function') {
    throw new TypeError(section + ' 缺少调用点注入的 isSafePathSegment（禁止静默降级为不校验）')
  }
  return isSafePathSegment
}

/**
 * 登录态检测已经停在「已登录的页面上」时，顺手补齐该账号缺失/变化的昵称与头像。
 *
 * 为什么放在检测里：存量账号是在接线修好之前登录的，真源里 account_name 往往是网页
 * 标题、avatar 为空；不给它们一条回填路径，用户就必须重新登录才能看到昵称/头像。
 *
 * 三条纪律：
 * 1. 只在「有 DOM 且判定有效」的路径调用（HTTP 快速路径没有 DOM，不做）。
 * 2. 只下发命中且与真源不同的资料字段（buildProfilePatch），未命中 = 键缺席 = 不修改。
 * 3. 任何失败都只记 warn 并返回 false —— 资料是增强信息，不是登录有效性的证据，
 *    绝不允许因为取不到昵称就把账号判成失效（那会把一次展示修复做成登录态回归）。
 * @returns {Promise<boolean>} 是否实际写回了资料字段
 */
async function refreshProfileFromPage (page, platform, accountId, deps) {
  const isSafePathSegment = assertInjectedPathGuard(deps, 'refreshProfileFromPage')
  try {
    if (!isSafePathSegment(platform) || !isSafePathSegment(accountId)) return false
    const info = await extractAccountInfo(page, platform)
    if (!info || Object.keys(info).length === 0) return false
    const current = await pythonBridge.requestBackend('GET', '/api/accounts/' + accountId)
    if (!current || current.code !== 0 || !current.data) return false
    const patch = profileUtils.buildProfilePatch(info, current.data)
    accountNameWrite.guardProfilePatchBySource(patch, current.data)
    if (Object.keys(patch).length === 0) return false
    const result = await pythonBridge.requestBackend('PATCH', '/api/accounts/' + accountId, patch)
    if (!result || result.code !== 0) {
      log.warn('AccountManager', 'refreshProfileFromPage: 资料回填写入失败 ' + platform + ':' + accountId + ' code=' + (result && result.code))
      return false
    }
    log.info('AccountManager', 'refreshProfileFromPage: 已回填资料字段 ' + platform + ':' + accountId + ' keys=' + Object.keys(patch).join(','))
    return true
  } catch (e) {
    log.warn('AccountManager', 'refreshProfileFromPage 忽略异常 ' + platform + ':' + accountId + ' err=' + (e && e.message ? e.message : String(e)))
    return false
  }
}

/**
 * HTTP 登录检测成功时的资料回填：用平台创作者 API（复用 http-login-checker 端点，
 * 对齐参考实现：不抓 DOM）拿昵称/粉丝，走 buildProfilePatch 只下发命中且变化的字段。
 * 昵称保护：见 guardProfilePatchBySource —— 按 name_source 判定，用户显式命名一律不覆盖。
 * 粉丝/平台ID/头像等增量字段照常回填。任何失败只 warn 返回 false，绝不影响登录态判定。
 * @returns {Promise<boolean>} 是否实际写回了资料字段
 */
async function refreshProfileFromHttpApi (platform, accountId, cookies, deps) {
  const isSafePathSegment = assertInjectedPathGuard(deps, 'refreshProfileFromHttpApi')
  try {
    if (!isSafePathSegment(platform) || !isSafePathSegment(accountId)) return false
    const info = await httpLoginChecker.fetchAccountInfoViaHttpApi(platform, cookies)
    if (!info || !info.supported) return false
    // 读不到真源就无法判断 name_source，此时任何写入都可能覆盖用户显式命名 —— 一律不写。
    // （此前该分支把 current 降级成 null 继续 PATCH：guard 在 current=null 时无条件把
    //   name_source 标成 auto，等于用「取不到证据」去覆盖 manual 命名。）
    const current = await pythonBridge.requestBackend('GET', '/api/accounts/' + accountId)
    if (!current || current.code !== 0 || !current.data) {
      log.warn('AccountManager', 'refreshProfileFromHttpApi: 真源读取失败，跳过回填 ' + platform + ':' + accountId + ' code=' + (current && current.code))
      return false
    }
    const curData = current.data
    const patch = profileUtils.buildProfilePatch(
      {
        nickName: info.nickname,
        // 头像：2026-10-22 起 HTTP 通道也产出头像（此前该字段在契约里根本没有位置，
        // 于是所有走 HTTP 快速路径的平台头像恒为空 —— 账号卡上显示灰色通用头像）。
        avatar: info.avatar,
        followers: info.followers,
        platformAccountId: info.platformAccountId,
      },
      curData
    )
    accountNameWrite.guardProfilePatchBySource(patch, curData)
    if (Object.keys(patch).length === 0) return false
    const result = await pythonBridge.requestBackend('PATCH', '/api/accounts/' + accountId, patch)
    if (!result || result.code !== 0) {
      log.warn('AccountManager', 'refreshProfileFromHttpApi: 资料回填写入失败 ' + platform + ':' + accountId + ' code=' + (result && result.code))
      return false
    }
    log.info('AccountManager', 'refreshProfileFromHttpApi: 已回填资料字段 ' + platform + ':' + accountId + ' keys=' + Object.keys(patch).join(','))
    return true
  } catch (e) {
    log.warn('AccountManager', 'refreshProfileFromHttpApi 忽略异常 ' + platform + ':' + accountId + ' err=' + (e && e.message ? e.message : String(e)))
    return false
  }
}

/**
 * 创建路径的资料兜底：DOM 采集没拿到真昵称时，用已捕获的 Cookie 调平台创作者 API 补字段。
 * 现场与完整推导见 `01-docs/PRD-ACCOUNT-PROFILE-FALLBACK-2026-10-21.md`，此处只留
 * **读代码时必须知道的判据与禁项**。
 *
 * **为什么需要它**：头条号等 SPA 后台，登录成功判据命中 URL 后 `_scheduleAutoCompletion`
 * 只等 3000ms 就采集，而页面渲染可持续数十秒（日志实测 56s）⇒ `collectWithWebContents`
 * 跑在空 DOM 上返回 `{}`，`profileForCreate` 遂把 `account_name` 回落成平台显示名。
 * 用户再点「保存账号」也已晚：attempt 早被 `_settleLogin` 消费并 `close()`。
 *
 * **判据**：`profile.account_name === name`（没有真昵称）。只此一条——
 * ⛔ 不得附加「头像也为空」：那会让「采到头像但没采到昵称」这个真实形态漏掉兜底
 * （本分支首版即如此，被自己的测试当场否证）。
 *
 * **判据的归一化安全性**（CCG i1 已逐行核实 + 测试锁定）：`name` 来自
 * `resolveCapturedDisplayName`（只 `.trim()`，非噪声则原样返回，否则返回平台显示名），
 * 回落值是 `trimText(name)` 而 `trimText(v) === v.trim()`（account-profile.js:139-141）
 * ⇒ `trimText(name) === name` 恒成立，两侧都不改大小写/标点 ⇒ **假阴性不可能**。
 * 唯一假阳性（无害）：DOM 采到的真昵称与平台显示名**同字**，后果仅多发一个请求。
 *
 * 四条纪律：
 * 1. **只补 DOM 没拿到的字段**，不覆盖已命中的值（昵称/ID/粉丝/头像逐个判空）。
 * 2. **任何失败只返回原 profile 的副本**，绝不抛错——资料是增强信息，不能把一次成功的
 *    登录保存变成失败（与 refreshProfileFromHttpApi 同向）。
 * 3. **不改变 `name`**：`name` 是 document.title 落盘位，兜底只作用于 account_name /
 *    platform_account_id / followers / avatar。
 * 4. **纯函数**：所有路径（含提前返回）都返回**新对象**，⛔ 绝不就地修改入参（CCG i2，有测试锁定）。
 *    实现用浅拷贝 `{ ...profile }`，**因此入参必须是扁平对象、四个字段必须是原始类型**
 *    （string / number / null，由 `profileForCreate` 的契约保证）——⛔ 本函数不承诺处理嵌套结构。
 *    若将来真要加嵌套字段，应在此处显式改成深拷贝并补测试，而不是指望浅拷贝能兜住（CCG i8）。
 *
 * **关于「网络请求在创建关键路径上」**（CCG i3，确认接受）：只在没采到真昵称时触发
 * （DOM 成功时零请求）；`fetchAccountInfoViaHttpApi` 自带 8s 超时（http-login-checker.js:269），
 * 最坏 +8s。改成「先入库后异步 PATCH」能消除这 8s，但会把「新账号首屏就是平台名」延续下去，
 * 与本修复要解决的问题冲突，故本次不做。
 *
 * @param {string} platform
 * @param {Array<{name:string, value:string}>} cookies 已按平台域过滤的 Cookie
 * @param {object} profile profileForCreate 的产物（**不被修改**，见纪律 4）
 * @param {string} name resolveCapturedDisplayName 的结果，用作「无真昵称」的比对基线
 * @returns {Promise<{profile: object, used: boolean}>} profile 是**新对象**；used=true 表示走了 HTTP 兜底
 */
async function fillProfileFromHttpApi (platform, cookies, profile, name) {
  // 纪律 4：**纯函数**——任何路径都返回新对象，绝不就地修改入参（CCG 深度审查 i2）。
  // 就地修改会让「调用方拿着 filled.profile」这件事依赖一个看不见的副作用；一旦将来
  // 有人把 profileForCreate 的结果复用/缓存/并行传递，别名污染不可控。复制成本可忽略。
  const base = { ...profile }
  // 拿到了真昵称（不等于回落值）⇒ DOM 采集成功，不必多发请求
  if (base.account_name !== name) return { profile: base, used: false }
  if (!Array.isArray(cookies) || cookies.length === 0) return { profile: base, used: false }

  let info
  try {
    info = await httpLoginChecker.fetchAccountInfoViaHttpApi(platform, cookies)
  } catch (e) {
    log.warn('AccountManager', 'fillProfileFromHttpApi 忽略异常 ' + platform + ' err=' + (e && e.message ? e.message : String(e)))
    return { profile: base, used: false }
  }
  if (!info || info.supported !== true) return { profile: base, used: false }

  // 逐个判空补位：DOM 已拿到的字段一律不动。
  if (!base.account_name || base.account_name === name) {
    if (typeof info.nickname === 'string' && info.nickname.trim()) base.account_name = info.nickname.trim()
  }
  if (!base.platform_account_id && typeof info.platformAccountId === 'string' && info.platformAccountId) {
    base.platform_account_id = info.platformAccountId
  }
  if (base.followers === null && typeof info.followers === 'number') {
    base.followers = info.followers
  }
  if (!base.avatar && typeof info.avatar === 'string' && info.avatar.trim()) {
    base.avatar = info.avatar.trim()
  }
  log.info('AccountManager', 'fillProfileFromHttpApi 已兜底 ' + platform + ' nickname=' + (info.nickname || '') + ' uid=' + (info.platformAccountId || ''))
  return { profile: base, used: true }
}

module.exports = {
  extractAccountInfo,
  extractAccountInfoFromWebContents,
  refreshProfileFromPage,
  refreshProfileFromHttpApi,
  fillProfileFromHttpApi,
}

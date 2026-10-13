'use strict'

/**
 * douyin-ticket-guard.js — 抖音 ticket-guard 本地签名（W2 tasks 2.2，D4：走进程内 registry）
 *
 * 逐字对齐 bundle 切片（design §3，@2671737/@2672895/@2673500）：
 *   clientSign($): 双层解码 security-sdk cookie → ec_privateKey(PEM) + {ticket, ts_sign}
 *     → EC(SHA256) 签 `ticket=..&path=/web/api/media/aweme/create_v2/&timestamp=..`
 *     → base64({ts_sign, req_content:"ticket,path,timestamp", req_sign, timestamp})
 *     任何异常 → throw「账号信息缺失，请重新授权此账号再试」（脱敏，不外泄私钥）
 *   extractReePublicKey($): plain bd_ticket_guard_client_data（键 "bd-ticket-guard-ree-public-key"）优先，
 *     否则 _v2（键 .ree_public_key），均无 → ""
 *   webVersionFromTicket(ticket): startsWith("hash") ? "2" : "1"（create_v2 头组 bd-ticket-guard-web-version）
 *
 * 合规红线：纯本地 crypto，无 HTTP 客户端、不读任何远程签名环境变量后门；私钥/ticket 只存内存与请求头，禁止日志序列化。
 *
 * 2026-10-13 修复（QM-5）：cookie 名由「硬编码 legacy 形态」改为
 * 「后缀锚定 + 前缀可选」的**单一事实源解析**。原实现取的
 * `security-sdk/s_sdk_crypt_sdk` 在真实账号上不存在（见下方常量区注释与
 * 取证报告 `关键缺陷-抖音签名cookie名不匹配.md`），导致 Step 0 恒抛。
 */

const crypto = require('crypto')

const CREATE_V2_PATH = '/web/api/media/aweme/create_v2/'
const FAIL_MSG = '账号信息缺失，请重新授权此账号再试'

// ──────────────────────────────────────────────────────────────────────────
// security-sdk 材料在 cookie 中的名字（**单一事实源**）
//
// 2026-10-13 事故修复：此前实现与测试 fixture 都按
//   security-sdk/s_sdk_crypt_sdk
//   security-sdk/s_sdk_sign_data_key/web_protect
// 取值。但**真实账号的 cookie 名不是这两个**——实测（本项目 + 参考产品共 3 个
// Electron 应用、948 条真实 cookie）为：
//   __security_mc_<N>_s_sdk_crypt_sdk
//   __security_mc_<N>_s_sdk_sign_data_key_web_protect
//
// 两处差异：
//   ① 前缀 `__security_mc_<N>_`（N 疑似代际号 → **不得硬编码具体数字**）
//   ② 名字里的 '/' 换成 '_'（cookie 名不允许含 '/'，RFC 6265 token；
//      948 条真实 cookie 中含 '/' 的为 0 条 ⇒ legacy 形态实际不可达）
//
// 因此按「**后缀锚定 + 前缀可选**」匹配，并保序尝试所有候选直到解出可用材料。
// 详见 01-docs/…/关键缺陷-抖音签名cookie名不匹配.md（取证报告）。
// ──────────────────────────────────────────────────────────────────────────
const CRYPT_KEY_RE = /(?:^|;\s*)((?:__security_mc_\d+_|security-sdk\/)?s_sdk_crypt_sdk)=/
const SIGN_DATA_KEY_RE = /(?:^|;\s*)((?:__security_mc_\d+_|security-sdk\/)?s_sdk_sign_data_key[_/]web_protect)=/

/** 取 cookie 中某 key 的原始值（split(";")[0].trim()），不存在返回 undefined。*/
function cookieValue (cookie, key) {
  const seg = String(cookie).split(key)[1]
  if (seg === undefined) return undefined
  return seg.split(';')[0].trim()
}

/** 按正则收集 cookie 中**所有**匹配项的原始值（保序）。用于多代命名并存时逐个尝试。*/
function cookieValues (cookie, re) {
  const s = String(cookie == null ? '' : cookie)
  const out = []
  const g = new RegExp(re.source, 'g')
  let m
  while ((m = g.exec(s)) !== null) {
    const start = m.index + m[0].length
    const end = s.indexOf(';', start)
    out.push((end === -1 ? s.slice(start) : s.slice(start, end)).trim())
    if (g.lastIndex <= m.index) g.lastIndex = m.index + 1 // 防零宽死循环
  }
  return out
}

/** 双层解码 security-sdk 字段：encodeURIComponent → {data:jsonStr} → jsonStr → obj。*/
function decodeSecuritySdk (raw) {
  return JSON.parse(JSON.parse(decodeURIComponent(raw)).data)
}

/**
 * 解析出可用的 crypt-sdk 载荷（含非空 ec_privateKey 的 PEM）。
 * 按出现顺序尝试全部候选，跳过解不出的（两代并存 / 同名垃圾值时仍能取到真材料）。
 * @returns {{ec_privateKey: string}|null}
 */
function resolveCryptPayload (cookie) {
  for (const raw of cookieValues(cookie, CRYPT_KEY_RE)) {
    try {
      const obj = decodeSecuritySdk(raw)
      if (obj && typeof obj.ec_privateKey === 'string' && obj.ec_privateKey) return obj
    } catch (_e) { /* 尝试下一个候选 */ }
  }
  return null
}

/**
 * 解析出可用的 sign-data 载荷（含非空 ticket）。
 * @returns {{ticket: string, ts_sign?: string}|null}
 */
function resolveSignDataPayload (cookie) {
  for (const raw of cookieValues(cookie, SIGN_DATA_KEY_RE)) {
    try {
      const obj = decodeSecuritySdk(raw)
      if (obj && typeof obj.ticket === 'string' && obj.ticket) return obj
    } catch (_e) { /* 尝试下一个候选 */ }
  }
  return null
}

/**
 * 四类签名材料中的「security-sdk 两类」是否齐备（**存在性判据，零解密**）。
 * 供各发布链的 Step 0 前置校验复用——**单一实现，禁止各链自抄 includes**。
 * @param {string} cookie
 * @returns {boolean}
 */
function hasSecurityMaterials (cookie) {
  const s = String(cookie == null ? '' : cookie)
  return CRYPT_KEY_RE.test(s) && SIGN_DATA_KEY_RE.test(s)
}

/** clientSign：返回 base64(client-data)。任一材料缺失/PEM 非法 → throw（脱敏）。*/
function clientSign (cookie) {
  try {
    const crypt = resolveCryptPayload(cookie)
    const sd = resolveSignDataPayload(cookie)
    const keyObj = crypto.createPrivateKey(crypt.ec_privateKey)
    const ts = parseInt(String(Date.now() / 1000))
    const str = `ticket=${sd.ticket}&path=${CREATE_V2_PATH}&timestamp=${ts}`
    const signer = crypto.createSign('SHA256')
    signer.update(str)
    signer.end()
    const reqSign = signer.sign(keyObj, 'base64')
    const payload = JSON.stringify({
      ts_sign: sd.ts_sign,
      req_content: 'ticket,path,timestamp',
      req_sign: reqSign,
      timestamp: ts,
    })
    return Buffer.from(payload).toString('base64')
  } catch (err) {
    // 脱敏：不回显原始错误（可能含私钥/cookie 片段），统一授权提示
    throw new Error(FAIL_MSG)
  }
}

/** 取 bd-ticket-guard-ree-public-key 头值。plain 优先，否则 _v2；均无 → ""。*/
function extractReePublicKey (cookie) {
  const $ = cookie == null ? '' : String(cookie)
  let K = ''
  if ($.includes('bd_ticket_guard_client_data=')) {
    const raw = cookieValue($, 'bd_ticket_guard_client_data=')
    K = JSON.parse(Buffer.from(decodeURIComponent(raw), 'base64').toString('utf-8'))['bd-ticket-guard-ree-public-key']
  } else if ($.includes('bd_ticket_guard_client_data_v2=')) {
    const raw = cookieValue($, 'bd_ticket_guard_client_data_v2=')
    K = JSON.parse(Buffer.from(decodeURIComponent(raw), 'base64').toString('utf-8')).ree_public_key
  }
  return K == null ? '' : K
}

/** create_v2 头组 bd-ticket-guard-web-version：ticket 以 "hash" 开头 → "2"，否则 "1"。*/
function webVersionFromTicket (ticket) {
  return (ticket != null && String(ticket).startsWith('hash')) ? '2' : '1'
}

module.exports = {
  clientSign,
  extractReePublicKey,
  webVersionFromTicket,
  CREATE_V2_PATH,
  FAIL_MSG,
  // 2026-10-13 新增：cookie 名解析的单一事实源（供各发布链 Step 0 复用）
  hasSecurityMaterials,
  resolveCryptPayload,
  resolveSignDataPayload,
  cookieValue,
  CRYPT_KEY_RE,
  SIGN_DATA_KEY_RE,
}

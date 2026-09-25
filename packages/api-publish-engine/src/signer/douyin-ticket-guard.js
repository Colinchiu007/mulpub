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
 */

const crypto = require('crypto')

const CREATE_V2_PATH = '/web/api/media/aweme/create_v2/'
const FAIL_MSG = '账号信息缺失，请重新授权此账号再试'

/** 取 cookie 中某 key 的原始值（split(";")[0].trim()），不存在返回 undefined。*/
function cookieValue (cookie, key) {
  const seg = String(cookie).split(key)[1]
  if (seg === undefined) return undefined
  return seg.split(';')[0].trim()
}

/** 双层解码 security-sdk 字段：encodeURIComponent → {data:jsonStr} → jsonStr → obj。*/
function decodeSecuritySdk (raw) {
  return JSON.parse(JSON.parse(decodeURIComponent(raw)).data)
}

/** clientSign：返回 base64(client-data)。任一材料缺失/PEM 非法 → throw（脱敏）。*/
function clientSign (cookie) {
  try {
    const pk = decodeSecuritySdk(cookieValue(cookie, 'security-sdk/s_sdk_crypt_sdk=')).ec_privateKey
    const sd = decodeSecuritySdk(cookieValue(cookie, 'security-sdk/s_sdk_sign_data_key/web_protect='))
    const keyObj = crypto.createPrivateKey(pk)
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

module.exports = { clientSign, extractReePublicKey, webVersionFromTicket, CREATE_V2_PATH }

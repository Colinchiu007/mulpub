'use strict'
/**
 * douyin-client-sign.test.js — clientSign 本地签名 TDD（W2 tasks 2.1）
 *
 * 逐字对齐 design §3（bundle @2671737/@2672895/@2673500）：
 *   - clientSign：双层解码 security-sdk cookie → EC(SHA256) 签 ticket&path&timestamp
 *     → base64(client-data {ts_sign, req_content:"ticket,path,timestamp", req_sign, timestamp})
 *   - extractReePublicKey：plain bd_ticket_guard_client_data（键 "bd-ticket-guard-ree-public-key"）优先，
 *     否则 _v2（键 .ree_public_key），均无 → ""
 *   - webVersionFromTicket：ticket.startsWith("hash") ? "2" : "1"
 *   - fail-closed：任一签名材料缺失 / PEM 非法 → throw「账号信息缺失，请重新授权此账号再试」
 * 零外发：纯本地计算，即使 MP_SIGNER_BASE 指向不可达端口亦不触发网络。
 */
const crypto = require('crypto')
const guard = require('../src/signer/douyin-ticket-guard')
const signer = require('../src/signer')

// ---- fixture：自生成 EC 私钥 + 构造 security-sdk cookie ----
function makeKeys () {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  return { pem, publicKey }
}
function encField (innerObj) {
  // 外层 {data: <innerJsonString>}，再 encodeURIComponent（转义 ; 等，split(";")[0] 可完整取回）
  return encodeURIComponent(JSON.stringify({ data: JSON.stringify(innerObj) }))
}
function encB64 (jsonStr) {
  return encodeURIComponent(Buffer.from(jsonStr).toString('base64'))
}
function makeCookie (opts = {}) {
  const { pem, ticket = 'hashABC123', tsSign = 'TSSIGN', ree = null, reeV2 = null, omitCrypt = false, omitSign = false } = opts
  const parts = ['sid_tt=SESS', 'msToken=MT']
  if (!omitCrypt) parts.push('security-sdk/s_sdk_crypt_sdk=' + encField({ ec_privateKey: pem }))
  if (!omitSign) parts.push('security-sdk/s_sdk_sign_data_key/web_protect=' + encField({ ticket, ts_sign: tsSign }))
  if (ree) parts.push('bd_ticket_guard_client_data=' + encB64(JSON.stringify({ 'bd-ticket-guard-ree-public-key': ree })))
  if (reeV2) parts.push('bd_ticket_guard_client_data_v2=' + encB64(JSON.stringify({ ree_public_key: reeV2 })))
  return parts.join('; ')
}

describe('douyin clientSign（ticket-guard-client-data，本地签名）', () => {
  test('clientSign 输出为 base64 字符串', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, ticket: 'hashXYZ', tsSign: 'TS9' })
    const out = guard.clientSign(cookie)
    expect(typeof out).toBe('string')
    expect(() => Buffer.from(out, 'base64').toString('utf8')).not.toThrow()
  })

  test('clientSign base64 三层结构 + req_content 契约 + ts_sign 透传', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, ticket: 'hashXYZ', tsSign: 'TS9' })
    const out = guard.clientSign(cookie)
    expect(typeof out).toBe('string')
    // 第一层：base64 → JSON
    const decoded = JSON.parse(Buffer.from(out, 'base64').toString('utf-8'))
    expect(Object.keys(decoded).sort()).toEqual(['req_content', 'req_sign', 'timestamp', 'ts_sign'])
    expect(decoded.req_content).toBe('ticket,path,timestamp')
    expect(decoded.ts_sign).toBe('TS9')
    expect(typeof decoded.req_sign).toBe('string')
    expect(decoded.req_sign.length).toBeGreaterThan(0)
  })

  test('req_sign 是用私钥对 ticket&path&timestamp 的真实 EC 签名（公钥可验证）', () => {
    const { pem, publicKey } = makeKeys()
    const ticket = 'hashVERIFY'
    const cookie = makeCookie({ pem, ticket, tsSign: 'TS' })
    const decoded = JSON.parse(Buffer.from(guard.clientSign(cookie), 'base64').toString('utf-8'))
    const str = `ticket=${ticket}&path=/web/api/media/aweme/create_v2/&timestamp=${decoded.timestamp}`
    const ok = crypto.createVerify('SHA256').update(str).verify(publicKey, decoded.req_sign, 'base64')
    expect(ok).toBe(true)
  })

  test('timestamp 为秒级整数且单调不减', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem })
    const t1 = JSON.parse(Buffer.from(guard.clientSign(cookie), 'base64').toString('utf-8')).timestamp
    const t2 = JSON.parse(Buffer.from(guard.clientSign(cookie), 'base64').toString('utf-8')).timestamp
    const nowSec = Math.floor(Date.now() / 1000)
    expect(Number.isInteger(t1)).toBe(true)
    expect(t1).toBeGreaterThanOrEqual(nowSec - 5)
    expect(t1).toBeLessThanOrEqual(nowSec + 5)
    expect(t2).toBeGreaterThanOrEqual(t1)
  })

  test('webVersionFromTicket：hash 前缀 → "2"，否则 "1"', () => {
    expect(guard.webVersionFromTicket('hashABC')).toBe('2')
    expect(guard.webVersionFromTicket('plain')).toBe('1')
    expect(guard.webVersionFromTicket('')).toBe('1')
  })

  test('fail-closed：缺 s_sdk_crypt_sdk → throw 重新授权', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, omitCrypt: true })
    expect(() => guard.clientSign(cookie)).toThrow('账号信息缺失，请重新授权此账号再试')
  })

  test('fail-closed：缺 s_sdk_sign_data_key → throw 重新授权', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, omitSign: true })
    expect(() => guard.clientSign(cookie)).toThrow('账号信息缺失，请重新授权此账号再试')
  })

  test('fail-closed：PEM 非法 → throw 重新授权且错误信息不泄露私钥', () => {
    const cookie = makeCookie({ pem: 'NOT-A-REAL-PEM' })
    let msg = ''
    try { guard.clientSign(cookie) } catch (e) { msg = e.message }
    expect(msg).toBe('账号信息缺失，请重新授权此账号再试')
    expect(msg).not.toMatch(/BEGIN|PRIVATE|ec_privateKey/i)
  })

  test('clientSign 纯本地：MP_SIGNER_BASE 指向不可达端口亦成功（零外发）', () => {
    const prev = process.env.MP_SIGNER_BASE
    process.env.MP_SIGNER_BASE = 'http://127.0.0.1:1'
    try {
      const { pem } = makeKeys()
      const out = guard.clientSign(makeCookie({ pem }))
      expect(typeof out).toBe('string')
      expect(out.length).toBeGreaterThan(0)
    } finally {
      if (prev === undefined) delete process.env.MP_SIGNER_BASE
      else process.env.MP_SIGNER_BASE = prev
    }
  })
})

describe('douyin ree-public-key 提取', () => {
  test('plain bd_ticket_guard_client_data → 取 "bd-ticket-guard-ree-public-key" 键', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, ree: 'REE_PLAIN_VAL' })
    expect(guard.extractReePublicKey(cookie)).toBe('REE_PLAIN_VAL')
  })

  test('_v2 bd_ticket_guard_client_data_v2 → 取 .ree_public_key 键', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, reeV2: 'REE_V2_VAL' })
    expect(guard.extractReePublicKey(cookie)).toBe('REE_V2_VAL')
  })

  test('plain 优先于 _v2（同时存在时按 bundle 取 plain）', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, ree: 'PLAIN', reeV2: 'V2' })
    expect(guard.extractReePublicKey(cookie)).toBe('PLAIN')
  })

  test('两者皆无 → 空串（上层链步骤 0 fail-closed）', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem })
    expect(guard.extractReePublicKey(cookie)).toBe('')
  })
})

describe('douyin ticket-guard 注册进进程内 signer/registry', () => {
  test('registry 暴露 douyin.ticket-guard-client-data 与 -ree-public-key', () => {
    expect(signer.registry.has('douyin.ticket-guard-client-data')).toBe(true)
    expect(signer.registry.has('douyin.ticket-guard-ree-public-key')).toBe(true)
  })

  test('经 registry.sign 调用 client-data（payload={cookie}）等价直调', async () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem })
    const viaReg = await signer.registry.sign('douyin.ticket-guard-client-data', { cookie })
    const d = JSON.parse(Buffer.from(viaReg, 'base64').toString('utf-8'))
    expect(d.req_content).toBe('ticket,path,timestamp')
  })

  test('经 registry.sign 调用 ree-public-key（payload={cookie}）', async () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, ree: 'REGREE' })
    expect(await signer.registry.sign('douyin.ticket-guard-ree-public-key', { cookie })).toBe('REGREE')
  })
})

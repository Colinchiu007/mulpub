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
  // keyStyle: 'legacy'（默认，历史假设）| 'live'（真实账号实测形态）| 'bare'（无前缀兜底）
  const { keyStyle = 'legacy', gen = 1 } = opts
  const nameTable = {
    legacy: { crypt: 'security-sdk/s_sdk_crypt_sdk', sign: 'security-sdk/s_sdk_sign_data_key/web_protect' },
    live: { crypt: `__security_mc_${gen}_s_sdk_crypt_sdk`, sign: `__security_mc_${gen}_s_sdk_sign_data_key_web_protect` },
    bare: { crypt: 's_sdk_crypt_sdk', sign: 's_sdk_sign_data_key_web_protect' },
  }
  const names = nameTable[keyStyle]
  if (!names) throw new Error('makeCookie: unknown keyStyle ' + keyStyle)
  const parts = ['sid_tt=SESS', 'msToken=MT']
  if (!omitCrypt) parts.push(names.crypt + '=' + encField({ ec_privateKey: pem }))
  if (!omitSign) parts.push(names.sign + '=' + encField({ ticket, ts_sign: tsSign }))
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

// ══════════════════════════════════════════════════════════════════════════
// 2026-10-13 新增：security-sdk cookie 名的两代形态
//
// 事故背景：实现与 fixture 都按 `security-sdk/s_sdk_crypt_sdk` 构造，而真实账号
// 的 cookie 是 `__security_mc_<N>_s_sdk_crypt_sdk`（前缀不同 + '/' 变 '_'）。
// 且 cookie 名**不允许含 '/'**（RFC 6265 token）——948 条真实 cookie 中 0 条含 '/'，
// 故 legacy 形态实际上是**不可达**的命名。
//
// 本组用例把「真实形态」钉进回归，避免实现再次以单一来源假设为准。
// ══════════════════════════════════════════════════════════════════════════
describe('douyin security-sdk cookie 名的两代形态', () => {
  test('live 形态（__security_mc_1_*）可签出，且签名可被公钥验证', () => {
    const { pem, publicKey } = makeKeys()
    const ticket = 'hashLIVE1'
    const cookie = makeCookie({ pem, keyStyle: 'live', gen: 1, ticket, tsSign: 'TSL' })
    const decoded = JSON.parse(Buffer.from(guard.clientSign(cookie), 'base64').toString('utf-8'))
    expect(decoded.req_content).toBe('ticket,path,timestamp')
    expect(decoded.ts_sign).toBe('TSL')
    const str = `ticket=${ticket}&path=/web/api/media/aweme/create_v2/&timestamp=${decoded.timestamp}`
    expect(crypto.createVerify('SHA256').update(str).verify(publicKey, decoded.req_sign, 'base64')).toBe(true)
  })

  test('代际号可变（gen=3 / gen=12）——不得硬编码 mc_1', () => {
    for (const gen of [3, 12]) {
      const { pem } = makeKeys()
      const cookie = makeCookie({ pem, keyStyle: 'live', gen })
      const decoded = JSON.parse(Buffer.from(guard.clientSign(cookie), 'base64').toString('utf-8'))
      expect(decoded.req_content).toBe('ticket,path,timestamp')
    }
  })

  test('legacy 形态仍可用（向后兼容，不破坏既有账号快照）', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, keyStyle: 'legacy' })
    const decoded = JSON.parse(Buffer.from(guard.clientSign(cookie), 'base64').toString('utf-8'))
    expect(decoded.req_content).toBe('ticket,path,timestamp')
  })

  test('bare 形态（无前缀）可用——兜底容忍', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, keyStyle: 'bare' })
    const decoded = JSON.parse(Buffer.from(guard.clientSign(cookie), 'base64').toString('utf-8'))
    expect(decoded.req_content).toBe('ticket,path,timestamp')
  })

  test('真实 cookie 串形态：51 条噪声中夹带 live 材料仍可签出', () => {
    const { pem } = makeKeys()
    const noise = []
    for (let i = 0; i < 24; i++) noise.push(`noise_${i}=v${i}`)
    const cookie = [
      ...noise,
      makeCookie({ pem, keyStyle: 'live', gen: 1, ticket: 'hashMIXED', tsSign: 'TSM' }),
      ...noise.map((_, i) => `tail_${i}=t${i}`),
    ].join('; ')
    const decoded = JSON.parse(Buffer.from(guard.clientSign(cookie), 'base64').toString('utf-8'))
    expect(decoded.ts_sign).toBe('TSM')
  })

  test('两代并存时取可解码者（legacy 占位垃圾 + live 真材料）', () => {
    const { pem } = makeKeys()
    const junk = 'security-sdk/s_sdk_crypt_sdk=NOT_JSON; security-sdk/s_sdk_sign_data_key/web_protect=ALSO_NOT_JSON'
    const live = makeCookie({ pem, keyStyle: 'live', gen: 2, ticket: 'hashTWO', tsSign: 'TS2' })
    const decoded = JSON.parse(Buffer.from(guard.clientSign(`${junk}; ${live}`), 'base64').toString('utf-8'))
    expect(decoded.ts_sign).toBe('TS2')
  })

  test('hasSecurityMaterials：三种形态均为 true，缺任一为 false', () => {
    const { pem } = makeKeys()
    expect(guard.hasSecurityMaterials(makeCookie({ pem, keyStyle: 'live' }))).toBe(true)
    expect(guard.hasSecurityMaterials(makeCookie({ pem, keyStyle: 'legacy' }))).toBe(true)
    expect(guard.hasSecurityMaterials(makeCookie({ pem, keyStyle: 'bare' }))).toBe(true)
    expect(guard.hasSecurityMaterials(makeCookie({ pem, omitCrypt: true, keyStyle: 'live' }))).toBe(false)
    expect(guard.hasSecurityMaterials(makeCookie({ pem, omitSign: true, keyStyle: 'live' }))).toBe(false)
    expect(guard.hasSecurityMaterials('sid_tt=ONLY')).toBe(false)
    expect(guard.hasSecurityMaterials('')).toBe(false)
    expect(guard.hasSecurityMaterials(null)).toBe(false)
  })

  test('真实命名不含 "/"：live 形态的名字必须无斜杠（cookie 名约束）', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, keyStyle: 'live' })
    const names = cookie.split('; ').map((p) => p.slice(0, p.indexOf('=')))
    expect(names.some((n) => n.includes('/'))).toBe(false)
    expect(names).toContain('__security_mc_1_s_sdk_crypt_sdk')
    expect(names).toContain('__security_mc_1_s_sdk_sign_data_key_web_protect')
  })

  test('fail-closed：两代皆缺仍抛脱敏错误', () => {
    const { pem } = makeKeys()
    const noCrypt = makeCookie({ pem, omitCrypt: true, keyStyle: 'live' })
    expect(() => guard.clientSign(noCrypt)).toThrow('账号信息缺失，请重新授权此账号再试')
    const noSign = makeCookie({ pem, omitSign: true, keyStyle: 'live' })
    expect(() => guard.clientSign(noSign)).toThrow('账号信息缺失，请重新授权此账号再试')
  })

  test('脱敏：错误信息不得回显 cookie 片段', () => {
    const { pem } = makeKeys()
    const cookie = makeCookie({ pem, omitSign: true, keyStyle: 'live' })
    try {
      guard.clientSign(cookie)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e.message).not.toContain('s_sdk')
      expect(e.message).not.toContain('BEGIN')
      expect(e.message.length).toBeLessThan(40)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 防再犯结构锁（QM-5 第 ⑤ 步「预防措施」）
//
// 事故根因不是「一个字符串写错」，而是**知识被复制到多处**：
// 实现里 3 个文件各写一遍、测试夹具 3 个文件各抄一遍，于是同一个错误假设被复制 6 次，
// 而单测与实现共享它 → 自证自洽、永远绿。
//
// 因此这里的机械判据是：**cookie 名的解析知识只准存在于 signer 单一事实源**。
//   - 发布链（douyin-video / douyin-image）不得再出现裸 `includes('s_sdk` 或字面量名
//   - 发布链必须从 signer 导入 hasSecurityMaterials / resolveSignDataPayload
//
// 这不是风格约束：漏一处就重现本次事故（Step 0 恒抛）。
// ══════════════════════════════════════════════════════════════════════════
describe('防再犯结构锁：cookie 名知识只存在于 signer 单一事实源', () => {
  const fsx = require('fs')
  const pathx = require('path')
  const SRC = pathx.join(__dirname, '..', 'src')
  const CHAINS = ['publish/platforms/douyin-video.js', 'publish/platforms/douyin-image.js']
  const SIGNER = pathx.join(SRC, 'signer', 'douyin-ticket-guard.js')

  test('发布链不得内联 security-sdk cookie 名的裸字面量 / 裸 includes 判据', () => {
    const offenders = []
    for (const rel of CHAINS) {
      const p = pathx.join(SRC, rel)
      const lines = fsx.readFileSync(p, 'utf8').split(/\r?\n/)
      lines.forEach((ln, i) => {
        const code = ln.replace(/^\s*(\/\/|\*|\/\*).*$/, '') // 忽略纯注释行
        if (!code.trim()) return
        if (/includes\(\s*['"]s_sdk/.test(code)) offenders.push(`${rel}:${i + 1} 裸 includes 判据`)
        if (/['"](?:__security_mc_\d+_|security-sdk\/)s_sdk/.test(code)) offenders.push(`${rel}:${i + 1} 内联名字字面量`)
      })
    }
    expect(offenders).toEqual([])
  })

  test('发布链必须从 signer 导入共享解析器（而非自实现）', () => {
    for (const rel of CHAINS) {
      const src = fsx.readFileSync(pathx.join(SRC, rel), 'utf8')
      expect(src).toMatch(/require\(['"][^'"]*signer\/douyin-ticket-guard['"]\)/)
      expect(src).toContain('hasSecurityMaterials')
    }
  })

  test('signer 是唯一保留 legacy 形态回落位置的文件（可含两代正则）', () => {
    const src = fsx.readFileSync(SIGNER, 'utf8')
    expect(src).toContain('__security_mc_')
    expect(src).toContain('security-sdk\\/')
    // 代际号必须是 \d+，不得硬编码具体数字（否则 mc_2 出现即再次失配）
    expect(src).toMatch(/__security_mc_\\d\+_/)
    expect(src).not.toMatch(/__security_mc_\d+_s_sdk_crypt_sdk['"]\s*\)/) // 不得作为字面量出现在解析路径
  })

  test('两条链的 Step 0 判据同源（同一函数，非两份实现）', () => {
    const v = fsx.readFileSync(pathx.join(SRC, CHAINS[0]), 'utf8')
    const i = fsx.readFileSync(pathx.join(SRC, CHAINS[1]), 'utf8')
    for (const src of [v, i]) {
      expect(src).toMatch(/if \(!hasSecurityMaterials\(c\)\)/)
    }
  })
})

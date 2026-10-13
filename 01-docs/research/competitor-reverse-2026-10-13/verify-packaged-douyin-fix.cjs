/**
 * QM-1 取证：从打包产物（asar 解包）实跑，证明修复真的到达交付产物。
 * 用法：node verify-packaged-douyin-fix.cjs <解包目录>
 */
const path = require('node:path')
const crypto = require('node:crypto')

const root = process.argv[2]
const mod = path.join(root, 'node_modules', '@multi-publish', 'api-publish-engine', 'src', 'signer', 'douyin-ticket-guard.js')
const guard = require(mod)

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const enc = (o) => encodeURIComponent(JSON.stringify({ data: JSON.stringify(o) }))

function mk (style, gen) {
  const c = style === 'live' ? '__security_mc_' + gen + '_s_sdk_crypt_sdk' : 'security-sdk/s_sdk_crypt_sdk'
  const s = style === 'live' ? '__security_mc_' + gen + '_s_sdk_sign_data_key_web_protect' : 'security-sdk/s_sdk_sign_data_key/web_protect'
  return ['sid_tt=SESS', c + '=' + enc({ ec_privateKey: pem }), s + '=' + enc({ ticket: 'hashPKG', ts_sign: 'TSPKG' }), 'bd_ticket_guard_client_data=x'].join('; ')
}

console.log('模块来源: ' + mod)
console.log('=== 从打包产物实跑（asar 解包模块）===')
const cases = [['live gen=1', mk('live', 1)], ['live gen=5', mk('live', 5)], ['live gen=12', mk('live', 12)], ['legacy', mk('legacy')]]
let ok = 0
for (const [label, cookie] of cases) {
  try {
    const d = JSON.parse(Buffer.from(guard.clientSign(cookie), 'base64').toString('utf-8'))
    console.log('  ' + label.padEnd(12) + ' -> OK   ts_sign=' + d.ts_sign + '  req_content=' + d.req_content)
    ok++
  } catch (e) {
    console.log('  ' + label.padEnd(12) + ' -> THROW ' + e.message)
  }
}
try {
  guard.clientSign('sid_tt=ONLY')
  console.log('  缺材料        -> 未抛错  [!] 不合格')
} catch (e) {
  console.log('  缺材料        -> THROW(预期) ' + e.message)
  ok++
}
console.log('  hasSecurityMaterials(live)   = ' + guard.hasSecurityMaterials(mk('live', 1)))
console.log('  hasSecurityMaterials(legacy) = ' + guard.hasSecurityMaterials(mk('legacy')))
console.log('  hasSecurityMaterials(empty)  = ' + guard.hasSecurityMaterials('sid_tt=ONLY'))
console.log('')
console.log(ok === cases.length + 1 ? '结论: 打包产物中修复已生效（' + ok + '/' + (cases.length + 1) + ' 项符合预期）' : '结论: 打包产物验证未通过 [!]')
process.exitCode = ok === cases.length + 1 ? 0 : 1

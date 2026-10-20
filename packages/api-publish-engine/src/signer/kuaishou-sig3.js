'use strict'

/**
 * kuaishou-sig3.js — 快手 `__NS_sig3` 的 Tier-A 纯 JS 实现
 *
 * ── 背景：为什么替换掉旧的 Tier-A ────────────────────────────────
 * 旧实现（signer-local.getKuaishouSign）产出 `MD5(api_ph + "|" + JSON(body))`，
 * 是 **32 位裸 MD5**。2026-09-25 的 W3 spike（S0）已判定它结构上不等于真签名
 * （真 sig3 是 56 字符的 VM 产物），本地近似路线作废；此后主链路一直走 Tier-B
 * 页面签名器（`kuaishou.ns-sig3-browser` + Playwright/CEF）。
 *
 * 本模块是那个结论的**修订**：不是"近似公式"，而是把 VM 算法**完整还原**成纯 JS。
 * 复原依据与逐字节对拍证据：
 *   - `04-rea-evidence/sig3-纯JS完整实现对拍.json`（与竞品 VM 10/10 一致）
 *   - `04-rea-evidence/sig3-purejs-live-result.json`（真实服务端 A 拒 / B·C·D 通过）
 *
 * ── 算法（全部为逆向所得，非猜测）────────────────────────────────
 *   dg1  = SHA256_compress( pad(utf8(payload)), IV1 )   ← 私有 IV
 *   dg2  = SHA256_compress( pad(latin1Of(dg1)), IV2 )   ← 私有 IV
 *   f    = "5445" + "0130" + j(sr,LE) + j(count,LE) + j(dg2[0],BE)
 *          + j(1653548225,LE) + "01000100" + "000000"      （54 字符）
 *   sig  = s( f + g(f) )                                   （56 个 hex）
 *
 * ── 输入构造（与快手页面 `PJ({url,type,params})` 同构）──────────
 *   input = md5( 按 key 排序的 query 串 + JSON.stringify(params) )
 *   query 从入参 url 中析出；无 query 时为 ""。
 *   实测样例：url 无 query + params={} ⇒ md5("" + "{}") = 99914b93…ae93b
 *
 * ── 状态变量（进程内，与竞品同构）──────────────────────────────
 *   startupRandom  首次签名时取 Math.floor(Date.now()/1000)，进程内冻结
 *   count          初值 100，每次签名自增
 *   ⇒ 二者均可由调用方显式覆盖（便于测试与对拍）
 *
 * 合规：本模块只做纯计算，不 require 任何网络模块，不读取任何外部服务。
 */

const crypto = require('crypto')

// ── 私有 IV：不是标准 SHA-256 初值（这正是"标准 SHA-256 对不上"的根因）
const IV1 = [
  0x4797257d, 0x2b64fbac, 0xb5a77267, 0xe9a2a1d4,
  0x938339c8, 0x17917364, 0x58641db2, 0x8e7b5db6,
]
const IV2 = [
  0xc86426e7, 0xcdf0aea3, 0x3567a003, 0x1343f246,
  0x71c52f9e, 0x2e6a357c, 0x876e5119, 0xbf10744f,
]

// 标准 SHA-256 K 表（64 项，已与竞品字节码逐项核对 64/64）
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

/** 固定常量段（来自竞品主脚本字符串表） */
const HEAD = '5445'
const TAIL_HEAD = '0130'
const TAIL_REQ = '01000100'
const TAIL_ZERO = '000000'
/** t() 中硬编码的常量，语义未考证，固定照抄 */
const MAGIC = 1653548225

/** 真 sig3 固定长度（56 个 hex 字符 = 28 字节） */
const SIG_LENGTH = 56
/** 计数器初值（与竞品一致） */
const COUNT_INIT = 100

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0

// ── 原语 ──────────────────────────────────────────────

/** UTF-8 编码：JS 字符串 → 每字符一字节的 Latin-1 串 */
function utf8 (str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00)
        i++
      }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return String.fromCharCode.apply(null, out)
}

function hexToBytes (h) {
  const a = []
  for (let i = 0; i < h.length; i += 2) a.push(parseInt(h.substr(i, 2), 16))
  return a
}

function bytesToHex (a) {
  return a.map((b) => (b & 255).toString(16).padStart(2, '0')).join('')
}

/**
 * SHA-256 消息填充与分块。
 *
 * ⚠ 与标准的两处差异（都是竞品的真实行为，不能"修正"）：
 *   1) 长度字段 = `(len - 1) * 8 + 512`，即标准 bitLen **再 +512**
 *   2) 字保持**有符号** 32 位（不加 `>>> 0`）
 */
function pad (s) {
  s = s + String.fromCharCode(0x80)
  const len = s.length
  const blocks = Math.ceil((len + 8) / 64)
  const total = blocks * 64
  const words = []
  for (let i = 0; i < total; i += 4) {
    const c0 = i < len ? s.charCodeAt(i) : 0
    const c1 = i + 1 < len ? s.charCodeAt(i + 1) : 0
    const c2 = i + 2 < len ? s.charCodeAt(i + 2) : 0
    const c3 = i + 3 < len ? s.charCodeAt(i + 3) : 0
    words.push((c0 << 24) | (c1 << 16) | (c2 << 8) | c3)
  }
  words[words.length - 1] = (len - 1) * 8 + 512
  const out = []
  for (let b = 0; b < blocks; b++) out.push(words.slice(b * 16, b * 16 + 16))
  return out
}

/**
 * 标准 SHA-256 压缩函数，IV 由调用方给出。
 * ⚠ 不修改传入的 IV 数组（竞品会就地改写，复用常量会让后续全错）。
 */
function compress (blocks, IV) {
  const H = IV.slice()
  for (const bw of blocks) {
    const w = new Array(64)
    for (let i = 0; i < 16; i++) w[i] = bw[i] >>> 0
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = H[0]; let b = H[1]; let c = H[2]; let d = H[3]
    let e = H[4]; let f = H[5]; let g = H[6]; let h = H[7]
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e
      e = (d + t1) >>> 0
      d = c; c = b; b = a
      a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  return H
}

function u32be (v) {
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
}

/** number[8] → 32 字符 Latin-1 串 */
function latin1Of (arr) {
  return arr.map(u32be)
    .reduce((x, y) => x.concat(y), [])
    .map((b) => String.fromCharCode(b))
    .join('')
}

/** u32 → 8 位 hex；bigEndian=true 大端 / false 小端 */
function j (v, bigEndian) {
  const b = u32be(v >>> 0)
  return bytesToHex(bigEndian ? b : b.slice().reverse())
}

/** 校验位：字节和；>255 时取负；再 &255 */
function checksum (hex) {
  const n = hexToBytes(hex)
  let t = 0
  for (const x of n) t += (x & 255)
  if (t > 255) t = -t
  return (t & 255).toString(16).padStart(2, '0')
}

/** 自逆 XOR 置换：out[i] = i ^ in[i] ^ in[last]；out[last] = in[last] */
function permute (hex) {
  const t = hexToBytes(hex)
  const a = t[t.length - 1]
  const n = []
  let e
  for (e = 0; e < t.length - 1; e++) n[e] = (e ^ t[e] ^ a) & 255
  n[e] = a
  return bytesToHex(n)
}

// ── 输入构造 ──────────────────────────────────────────

/**
 * 按快手页面 `PJ({url,type,params})` 的契约构造 sig3 输入。
 *
 * @param {{url?:string, params?:object}} args
 * @returns {string} 32 位小写 md5 hex
 */
function buildSignatureInput (args = {}) {
  const url = typeof args.url === 'string' ? args.url : ''
  const params = args.params === undefined || args.params === null ? {} : args.params

  // 从 url 析出 query（页面传的是 path 形态，可能带 query）
  const qi = url.indexOf('?')
  const qs = qi >= 0 ? url.slice(qi + 1).split('#')[0] : ''
  const queryObj = {}
  if (qs) {
    for (const pair of qs.split('&')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      const rawK = eq >= 0 ? pair.slice(0, eq) : pair
      const rawV = eq >= 0 ? pair.slice(eq + 1) : ''
      let k; let v
      try { k = decodeURIComponent(rawK) } catch (e) { k = rawK }
      try { v = decodeURIComponent(rawV) } catch (e) { v = rawV }
      queryObj[k] = v
    }
  }
  // 按 key 排序后拼 query 串（与页面一致）
  const sortedQuery = Object.keys(queryObj).sort().map((k) => k + '=' + queryObj[k]).join('&')
  const bodyStr = JSON.stringify(params)
  return crypto.createHash('md5').update(sortedQuery + bodyStr, 'utf8').digest('hex')
}

// ── 核心签名 ──────────────────────────────────────────

/**
 * 对给定 payload 字符串计算 sig3。
 *
 * @param {string} payload        通常是 buildSignatureInput 的结果
 * @param {number} startupRandom  秒级时间戳
 * @param {number} count          计数器
 * @returns {string} 56 个 hex
 */
function signPayload (payload, startupRandom, count) {
  const str = typeof payload === 'string' ? payload : ''
  const dg1 = compress(pad(utf8(str)), IV1)
  const dg2 = compress(pad(latin1Of(dg1)), IV2)
  const f = HEAD + TAIL_HEAD +
    j(startupRandom, false) +
    j(count, false) +
    j(dg2[0], true) +
    j(MAGIC, false) +
    TAIL_REQ + TAIL_ZERO
  return permute(f + checksum(f))
}

// ── 进程内状态（与竞品同构）──────────────────────────

let startupRandomState = null
let countState = COUNT_INIT

function _ensureStartupRandom () {
  if (startupRandomState === null) {
    startupRandomState = Math.floor(Date.now() / 1000)
  }
  return startupRandomState
}

/** 仅供测试：重置状态 */
function __resetState (opts = {}) {
  startupRandomState = opts.startupRandom === undefined ? null : opts.startupRandom
  countState = opts.count === undefined ? COUNT_INIT : opts.count
}

/** 仅供测试/诊断：读取当前状态 */
function __getState () {
  return { startupRandom: startupRandomState, count: countState }
}

/**
 * Tier-A 签名入口 —— 接受与页面签名器完全相同的 payload 形状。
 *
 * @param {{url?:string, params?:object, startupRandom?:number, count?:number}} payload
 * @returns {string} 56 个 hex（__NS_sig3 的值，不含 `__NS_sig3=` 前缀）
 */
function sign (payload) {
  const p = payload || {}
  const input = buildSignatureInput({ url: p.url, params: p.params })

  const sr = p.startupRandom === undefined || p.startupRandom === null
    ? _ensureStartupRandom()
    : (p.startupRandom >>> 0)
  const cnt = p.count === undefined || p.count === null
    ? countState++
    : (p.count >>> 0)

  return signPayload(input, sr, cnt)
}

module.exports = {
  sign,
  signPayload,
  buildSignatureInput,
  __resetState,
  __getState,
  // 原语（便于独立验证）
  utf8,
  pad,
  compress,
  latin1Of,
  j,
  checksum,
  permute,
  // 常量
  IV1,
  IV2,
  MAGIC,
  SIG_LENGTH,
  COUNT_INIT,
}

'use strict'
/**
 * ccg-delivery-digest.js —— `delivery@<sha256>` 的规范化摘要（单一实现）
 *
 * 为什么只准有一份：写回器用它生成 `evidence`，判据用它就地重算做验证。
 * 两边各写一份规范化，就会各算一个哈希 ⇒ 「写回器写的」与「判据认的」永远对不上，
 * 而那正是本片要消掉的形状（跨家族设计评审 i2）。
 *
 * 规范化口径（design §3-D3）：
 *  - 对象：**递归**按键名**码点**升序重排（不用 `String.prototype` 的 UTF-16 码元序，
 *    代理对与 U+E000–U+FFFF 的相对次序在两种序下不同）；
 *  - 数组：**保持原序**（findings 的条目顺序是语义的一部分）；
 *  - 序列化 `JSON.stringify(v, null, 0)`；
 *  - sha256，输出 64 位小写十六进制。
 *
 * ⚠ 强度边界：摘要只哈希本记录自己的 `findings`，**任何填写方都能一条命令自算**。
 *   它提供的是"多一个可就地验证的形态"与"写回器与判据可互验"，
 *   **不是**签名、不是不可否认的绑定、也不是防伪造（tasks 8.5）。
 */
const crypto = require('node:crypto')
const fs = require('node:fs')

const DELIVERY_PREFIX = 'delivery@'
const HEX64 = /^[0-9a-f]{64}$/

/** 码点升序比较（`Array.from` 按码点迭代，代理对不会被拆成两个单元）。 */
function cmpCodePoints (a, b) {
  const ac = Array.from(a)
  const bc = Array.from(b)
  const n = Math.min(ac.length, bc.length)
  for (let i = 0; i < n; i++) {
    const d = ac[i].codePointAt(0) - bc[i].codePointAt(0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  if (ac.length === bc.length) return 0
  return ac.length < bc.length ? -1 : 1
}

function canonicalize (v) {
  if (Array.isArray(v)) return v.map(canonicalize)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort(cmpCodePoints)) out[k] = canonicalize(v[k])
    return out
  }
  return v
}

function deliveryDigest (findings) {
  if (!Array.isArray(findings)) {
    throw new Error('findings 必须是数组（实得 ' + (findings === null ? 'null' : typeof findings) + '）')
  }
  return sha256Hex(JSON.stringify(canonicalize(findings), null, 0))
}

function deliveryEvidence (findings) {
  return DELIVERY_PREFIX + deliveryDigest(findings)
}

/** 只看形状：`delivery@` + 64 位小写 hex。语义验证走 matchesDeliveryEvidence。 */
function isDeliveryEvidenceShape (evidence) {
  return typeof evidence === 'string' && evidence.startsWith(DELIVERY_PREFIX) && HEX64.test(evidence.slice(DELIVERY_PREFIX.length))
}

/** 就地重算比对。取不到 findings 或非数组时返回 false（不抛）——判据侧不得因一条坏记录整跑中止。 */
function matchesDeliveryEvidence (findings, evidence) {
  if (!isDeliveryEvidenceShape(evidence)) return false
  if (!Array.isArray(findings)) return false
  try {
    return evidence.slice(DELIVERY_PREFIX.length) === deliveryDigest(findings)
  } catch {
    return false
  }
}

/**
 * `deepReview` 的语义指纹：**去掉 `at`** 再规范化哈希。
 * 动因（跨家族评审 i1，Critical）：引擎每个写回站点都写 `at: new Date().toISOString()`，
 * 所以"字节变了"只证明"写过一次"，不证明"有新交付"。条件④必须有这条才能把
 * "只有时间戳在动"与"真的交付了一次评审"分开。
 */
function deepReviewFingerprint (dr) {
  if (!dr || typeof dr !== 'object' || Array.isArray(dr)) {
    throw new Error('deepReview 必须是对象（实得 ' + (dr === null ? 'null' : typeof dr) + '）')
  }
  const rest = {}
  for (const k of Object.keys(dr)) if (k !== 'at') rest[k] = dr[k]
  return sha256Hex(JSON.stringify(canonicalize(rest), null, 0))
}

/**
 * Buffer 按**原始字节**哈希、字符串按 utf8 字节哈希。
 * 为什么要把两档写开：调用方之一是 shell 的 `sha256sum`（量原始字节）。
 * 若把 Buffer 先 `toString('binary')` 再交给下面这条 utf8 分支，非 ASCII 字节会被
 * 重新编码成两字节序列 ⇒ 两侧永远不等，"字节没变"这一格判据永久点不到火。
 */
function sha256Hex (s) {
  if (Buffer.isBuffer(s)) return crypto.createHash('sha256').update(s).digest('hex')
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
}

module.exports = {
  DELIVERY_PREFIX,
  canonicalize,
  cmpCodePoints,
  deliveryDigest,
  deliveryEvidence,
  deepReviewFingerprint,
  sha256Hex,
  isDeliveryEvidenceShape,
  matchesDeliveryEvidence,
  printFingerprintCli
}

/**
 * 命令行出口：`--print-fingerprint=<记录路径>` —— 把这把记录的 `deepReview` 去掉 `at`
 * 后的语义指纹打到 stdout（取不到就打印空串并以 rc=0 退出，由调用方的合取去判缺失）。
 *
 * 为什么要有这个出口（外部深审 round 2 i1，Critical）：入口 `deep-review.sh` 是 shell，
 * 它需要一个"动手前的指纹"透传给写回器。若在 shell 里重抄一遍规范化算法，就是第二份事实——
 * 而指纹的两边必须逐字相同，否则 ④ 的第二半永远判不出"没变"。
 * 所以指纹只由**这一份实现**计算，shell 只负责调用与传参。
 */
function printFingerprintCli (argv, io) {
  const out = io || { read: (f) => fs.readFileSync(f, 'utf8'), write: (s) => process.stdout.write(s) }
  const hit = argv.find((a) => a.startsWith('--print-fingerprint='))
  if (!hit) return 2
  const file = hit.slice('--print-fingerprint='.length)
  let fp = ''
  try {
    const rec = JSON.parse(out.read(file))
    if (rec && rec.deepReview) fp = deepReviewFingerprint(rec.deepReview)
  } catch { fp = '' }
  out.write(fp + '\n')
  return 0
}

if (require.main === module) process.exitCode = printFingerprintCli(process.argv.slice(2))

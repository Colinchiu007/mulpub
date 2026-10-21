'use strict'
/**
 * ccg-review-writeback.js —— 本仓唯一会写 `deepReview.tier` 的生产方
 *
 * 为什么需要它（现场证据，不是修辞）：收口矩阵要求高危面 `tier=external` + 可核 `evidence`，
 * 而**全仓没有任何组件写这两个字段**——引擎的 `writeBack` 是整体替换（`:520`），
 * 会把 `buildDeepReviewInit` 初始化的 `tier`/`evidence` 直接吃掉；判定器只在**新建**时写 `unknown`。
 * 于是"跑了真评审"在结构上比"什么都没做"更差，人只能手写。#3987 / #4071 的 `tier` 都是会话手写的。
 * 本模块的存在就是为了让合规路径不需要手写。
 *
 * 五条合取（正文真源在 specs/qm6-closure-writeback/spec.md，这里只实现不复述规则）：
 *  ① status ∈ 闭环白名单        ② findings 是非空数组
 *  ③ performedBy === 上层透传的期望后端
 *  ④ 本次驱动刚产出：**字节变了** 且 **去掉 at 的语义指纹变了**（两条并立、各自出声）；
 *     动手前的状态取不到时按 **before-state-missing** 拒绝——没对照就等于没验证，
 *     而"上一轮就闭环"的记录在本机字节层面与"本次刚交付"完全同形
 *  ⑤ 记录路径由上层显式透传（缺路径当场抛错，不许猜）
 * 任一不成立 ⇒ **不写、不猜、不改 status**，只点名缺哪一条。
 *
 * ⚠ 强度边界：`delivery@` 摘要任何填写方都能一条命令自算（它只哈希本记录的 findings）。
 *   本模块提供的是"写回器与判据可互验"，**不是**签名、不是防伪造。
 *
 * 用法（供 scripts/deep-review.sh 调用）：
 *   node scripts/ccg-review-writeback.js --record=<path> --expected-critic=<name> --before-sha256=<hex>
 * 退出码：**恒 0**（旁路）。写回成功与否都不得改变评审的 rc —— 评审失败仍是失败。
 */
const fs = require('node:fs')
const path = require('node:path')

const { CLOSED_DEEP_REVIEW_STATUSES } = require('./check-pr-exec-record.js')
const { buildDeepReviewInit } = require('./ccg-review-decider.js')
const {
  deliveryEvidence,
  deepReviewFingerprint,
  sha256Hex
} = require('./lib/ccg-delivery-digest.js')

const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_ATTEMPTS = 5
const RENAME_BACKOFF_MS = 40

function argOf (argv, name) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : ''
}

function sleep (ms) {
  const until = Date.now() + ms
  while (Date.now() < until) { /* 有界退避：Windows 上 rename 撞防病毒/索引器时的短暂冲突 */ }
}

/** 原子替换：临时文件 + rename；只对 EPERM/EACCES/EBUSY 做**有界**退避，其它错误原样抛。 */
function atomicWrite (file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, data)
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (e) {
      const retryable = e && RENAME_RETRY_CODES.has(e.code)
      if (!retryable || attempt === RENAME_ATTEMPTS) {
        try { fs.unlinkSync(tmp) } catch { /* 清不掉就把原样保留的既有产物交给上层出声 */ }
        throw e
      }
      sleep(RENAME_BACKOFF_MS * attempt)
    }
  }
}

/**
 * @param {{recordPath?: string, expectedCritic?: string, beforeBytes?: Buffer, beforeSha256?: string, log?: {warn?: Function}}} opts
 */
function applyWriteback (opts) {
  const o = opts || {}
  const log = o.log || console
  const recordPath = o.recordPath
  if (typeof recordPath !== 'string' || recordPath.trim() === '') {
    throw new Error('missing-record-path: 记录文件路径必须由上层显式透传。'
      + '不给就回退「按 sha 猜文件名」或「扫 .ccg/reviews 取最新」都是猜 —— 猜中一次就静默写错产物，猜不中则写回永不发生且无人知晓')
  }
  const expected = o.expectedCritic
  if (typeof expected !== 'string' || expected.trim() === '') {
    throw new Error('expectedCritic: 期望后端必须由上层从 scripts/ccg-review-backends.list 真源透传，'
      + '缺它则「谁做的评审」这一格只能由填写方自述（本仓实测：换后端曾只是终端滚过的一行字）')
  }

  let rawBuf
  try {
    rawBuf = fs.readFileSync(recordPath)
  } catch (e) {
    return { wrote: false, reason: 'record-unreadable', spoke: [], detail: `读取失败：${e.code || e.message}` }
  }
  const currentBytes = rawBuf
  let rec
  try {
    rec = JSON.parse(rawBuf.toString('utf8'))
  } catch (e) {
    return { wrote: false, reason: 'record-unreadable', spoke: [], detail: 'JSON 解析失败' }
  }
  if (!rec || typeof rec !== 'object' || !rec.deepReview || typeof rec.deepReview !== 'object') {
    return { wrote: false, reason: 'record-unreadable', spoke: [], detail: '记录里没有 deepReview 段' }
  }
  const dr = rec.deepReview
  // 语义指纹必须在**任何本模块自己的改动之前**取。
  // 顺序错了就永远测不出"只有时间戳在动"：D6 往 dr 上补的 tier/evidence 两个键本身就会改指纹，
  // 于是 ④-b 拿"补键后的现在"去比"补键前的过去"，必然判成"有新交付"——这是我自己写出来的假阳性。
  let fingerprintNow = null
  try { fingerprintNow = deepReviewFingerprint(dr) } catch { fingerprintNow = null }
  // D6：整体替换会吃掉 init 给的两个键 ⇒ 按**同一口径**补齐再判定（require，不重抄字段表）
  const init = buildDeepReviewInit(rec.mode)
  for (const k of ['tier', 'evidence']) if (!(k in dr)) dr[k] = init[k]

  const spoke = []
  if (CLOSED_DEEP_REVIEW_STATUSES.has(dr.status)) spoke.push('closed-status')
  else return { wrote: false, reason: 'not-closed', spoke, detail: `status=${JSON.stringify(dr.status)}` }

  if (Array.isArray(dr.findings)) spoke.push('findings-present')
  if (Array.isArray(dr.findings) && dr.findings.length > 0) spoke.push('nonempty-findings')
  else return { wrote: false, reason: 'empty-findings', spoke, detail: `findings=${typeof dr.findings}` }

  if (dr.performedBy === expected) spoke.push('backend-matches')
  else return { wrote: false, reason: 'backend-mismatch', spoke, detail: `performedBy=${JSON.stringify(dr.performedBy)} 期望 ${JSON.stringify(expected)}` }

  // ④ 两条并立，各自出声
  // ⚠ 必须直接把 **Buffer** 交给哈希函数：入口侧（deep-review.sh）用 `sha256sum` 取动手前的
  //   哈希，量的是原始字节。若先 `bytes.toString('binary')` 再哈希，Buffer 会被按 utf8
  //   **重新编码**（每个 ≥0x80 的字节变两字节），非 ASCII 记录（中文 finding 很常见）两侧
  //   永远不等 ⇒ no-write 这一格永久点不到火，"驱动没写过"被读成"写过"。
  const nowSha = sha256Hex(currentBytes)
  const beforeSha = typeof o.beforeBytes !== 'undefined' ? sha256Hex(o.beforeBytes) : String(o.beforeSha256 || '')
  // ④ 的两条前置都必须**拿到动手前的状态**才能成立。取不到时一律 fail-closed：
  //   "上一轮就闭环了"的那份记录，与本模块要证明的"本次驱动刚产出"在字节层面完全同形，
  //   少了这个对照，写回器就是在给一个没验证过的条件打勾（实测原实现正是如此）。
  let beforeFp = String(o.beforeFingerprint || '')
  if (!beforeFp && typeof o.beforeBytes !== 'undefined') {
    try {
      const prev = JSON.parse(Buffer.from(o.beforeBytes).toString('utf8'))
      if (prev && prev.deepReview) beforeFp = deepReviewFingerprint(prev.deepReview)
    } catch { beforeFp = '' }
  }
  // ④ 的两半都必须**拿得到动手前的状态**才能成立。取不到时一律 fail-closed：
  //   "上一轮就闭环了"的那份记录，与本模块要证明的"本次驱动刚产出"在字节层面完全同形，
  //   少了这个对照，写回器就是在给一个没验证过的条件打勾。
  // ⚠ 两半**缺一半都不放行**（外部深审 round 2 i1，Critical）：生产入口只传十六进制串，
  //   原实现只在拿到 Buffer 时才计算 beforeFp ⇒ 真跑路径上「只有 at 变了」这一格永远不触发。
  if (!beforeSha || !beforeFp) {
    return {
      wrote: false,
      reason: 'before-state-missing',
      spoke,
      detail: `动手前状态缺一半（beforeSha256=${beforeSha ? '有' : '无'} / beforeFingerprint=${beforeFp ? '有' : '无'}）⇒ ④ 无法证明，不写`
    }
  }
  if (nowSha === beforeSha) {
    return { wrote: false, reason: 'no-write', spoke, detail: '调用前后字节相同 ⇒ 本次驱动根本没写过这条记录' }
  }
  if (!fingerprintNow) {
    return { wrote: false, reason: 'before-state-missing', spoke, detail: '动手后的 deepReview 读不出一把可比对的指纹 ⇒ ④ 无法证明，不写' }
  }
  if (beforeFp === fingerprintNow) {
    return { wrote: false, reason: 'no-new-delivery', spoke, detail: '字节变了但去掉 at 的语义指纹没变（只有时间戳在动）' }
  }
  spoke.push('delivery-changed')

  dr.tier = 'external'
  dr.evidence = deliveryEvidence(dr.findings)
  try {
    atomicWrite(recordPath, JSON.stringify(rec, null, 2) + '\n')
  } catch (e) {
    // 静默配置失败必须留日志：写回没发生而无人知晓，比少一个字段更糟
    if (typeof log.warn === 'function') log.warn(`[ccg-review-writeback] 写回失败，既有产物保持原样：${e.code || ''} ${e.message}`)
    return { wrote: false, reason: 'write-failed', spoke, detail: e.code || e.message }
  }
  return { wrote: true, reason: null, spoke, tier: dr.tier, evidence: dr.evidence }
}

function main (argv) {
  // spec「写回器抛错不改退出码 / MUST NOT 以裸栈收尾」：CLI 层必须把抛错接成一行 reason。
  // 单元层仍按抛错断言（applyWriteback 的契约是"缺键当场抛"），两档不冲突——抛错是 API 语义，
  // 出声是 CLI 语义；把两者合并成"返回 false"会让调用方分不清"缺参数"与"缺交付"。
  let res
  try {
    res = applyWriteback({
      recordPath: argOf(argv, 'record'),
      expectedCritic: argOf(argv, 'expected-critic'),
      beforeSha256: argOf(argv, 'before-sha256'),
      beforeFingerprint: argOf(argv, 'before-fingerprint')
    })
  } catch (e) {
    console.log(`[ccg-review-writeback] 未写回 reason=throw detail=${e && e.message ? e.message : String(e)}`)
    return 0
  }
  const line = res.wrote
    ? `[ccg-review-writeback] 已写回 tier=external evidence=${res.evidence} spoke=${res.spoke.join('|')}`
    : `[ccg-review-writeback] 未写回 reason=${res.reason} spoke=${res.spoke.join('|') || '-'}${res.detail ? ' detail=' + res.detail : ''}`
  console.log(line)
  // 旁路语义：本模块的成败**绝不**改变评审的 rc（评审失败照旧是失败）。
  return 0
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))

module.exports = { applyWriteback, atomicWrite, RENAME_ATTEMPTS }

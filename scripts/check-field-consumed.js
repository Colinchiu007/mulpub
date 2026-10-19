#!/usr/bin/env node
/**
 * check-field-consumed.js — 「死观测字段」门禁（UX 审计阶段 5.4）
 *
 * 判据：store 里被**写入**却从不被**读取**的 ref ⇒ 装饰性状态（audit 现场：`lastEventAt`
 * 写 4 次读 0 次）。这类字段骗人两次：写的人以为在维护可观测性，读代码的人以为
 * 「有字段 = 有消费方」，于是基于它设计 UI 或排障路径。本仓把这一类记作「装饰性链路」。
 *
 * 四条不显然的口径（都有现场理由）：
 *  ① 读 = 同文件内出现 `X.value` 且**不是**赋值左值 / `++`/`--`；或**其它生产文件**里出现裸 `X`。
 *  ② **store 自己的 return/export 清单不算消费** —— 那只是"暴露"。粗判据（"名字在文件里出现过"）
 *     会被这一行喂饱，于是判据永远不红；这是本门禁与"扫到 0 命中"型探针的根本差别。
 *  ③ 其它文件里的 `X: something`（`storeToRefs` 的重命名解构）**必须算消费** ——
 *     判据第一版在这里加了 `(?!\s*:)` 型 lookahead，当场把 `useBacklot.js:69` 的
 *     `{ currentBoard: board } = storeToRefs(store)` 判成零读取（假阳性 1 条，已用测试钉住）。
 *  ④ 测试文件不算消费者（同 5.3 的理由：夹具自己喂的数据不构成生产接线）。
 *
 * 退出码：0 合规 / 1 发现死字段（含陈旧登记、缺 reason）/ 2 判据自身读不到。
 */
'use strict'
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '..')
const SRC_DIR = path.join(REPO, 'apps/desktop/src')
const STORE_DIR = path.join(SRC_DIR, 'stores')
const DEBT_PATH = path.join(__dirname, 'field-consumed-debt.json')

function walk (dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(vue|js|ts)$/.test(ent.name)) out.push(p)
  }
  return out
}

function isTest (rel) {
  const r = rel.replace(/\\/g, '/')
  return /\.test\.[jt]s$/.test(r) || /\.spec\.[jt]s$/.test(r) || r.startsWith('tests/') || r.includes('/tests/')
}

const ASSIGN_AFTER = /^\s*(?:=[^=]|\+=|-=|\*=|\/=|\+\+|--)/

/**
 * 单字段分类。`otherTexts` 必须是**非测试生产文件**的源码列表（调用方负责过滤），
 * 且**不得包含**本 store 自己的源码 —— 否则 return 清单那一行会被当成跨文件消费。
 */
function classifyField (storeText, name, otherTexts) {
  const esc = name.replace(/[$]/g, '\\$')
  const writes = (storeText.match(new RegExp('\\b' + esc + '\\.value\\s*(?:=[^=]|\\+\\+|--|\\+=|-=|\\*=|/=)', 'g')) || []).length
  let reads = 0
  for (const m of storeText.matchAll(new RegExp('\\b' + esc + '\\.value\\b', 'g'))) {
    if (ASSIGN_AFTER.test(storeText.slice(m.index + m[0].length))) continue
    reads++
  }
  let crossUses = 0
  const bareRe = new RegExp('\\b' + esc + '\\b')
  for (const other of otherTexts) if (bareRe.test(other)) crossUses++
  return { writes, reads, crossUses, dead: writes > 0 && reads === 0 && crossUses === 0 }
}

function main (argv) {
  const args = new Set(argv)
  if (!fs.existsSync(SRC_DIR) || !fs.existsSync(STORE_DIR)) {
    console.error('[field-consumed] 扫描根缺失：' + STORE_DIR)
    return 2
  }
  const all = walk(SRC_DIR, [])
  if (all.length === 0) { console.error('[field-consumed] 扫描域为空，拒绝报合规'); return 2 }
  const src = new Map()
  for (const f of all) {
    try { src.set(f, fs.readFileSync(f, 'utf8')) } catch (e) {
      console.error('[field-consumed] 文件读不到，判据自身故障：' + f)
      return 2
    }
  }
  const storeFiles = all.filter((f) => f.startsWith(STORE_DIR))
  if (storeFiles.length === 0) { console.error('[field-consumed] 没有任何 store 文件，判据失明'); return 2 }
  const productionFiles = all.filter((f) => !isTest(path.relative(REPO, f)))

  const findings = []
  let refsSeen = 0
  for (const f of storeFiles) {
    const text = src.get(f)
    const names = new Set()
    for (const m of text.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*ref\s*[<(]/g)) names.add(m[1])
    for (const m of text.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*shallowRef\s*[<(]/g)) names.add(m[1])
    const others = productionFiles.filter((g) => g !== f).map((g) => src.get(g))
    for (const name of names) {
      refsSeen++
      const r = classifyField(text, name, others)
      if (r.dead) findings.push({ file: path.relative(REPO, f).replace(/\\/g, '/'), field: name, writes: r.writes })
    }
  }

  let debt = {}
  try { debt = JSON.parse(fs.readFileSync(DEBT_PATH, 'utf8')) } catch (e) {
    console.error('[field-consumed] 欠账清单读不到或不是合法 JSON：' + e.message)
    return 2
  }
  const keys = Object.keys(debt)
  for (const k of keys) {
    if (!debt[k] || typeof debt[k].reason !== 'string' || !debt[k].reason.trim()) {
      console.error('[field-consumed] DEBT_NO_REASON ' + k)
      return 1
    }
  }
  const hitKeys = findings.map((x) => x.file + '#' + x.field)
  const unregistered = hitKeys.filter((k) => !keys.includes(k))
  const stale = keys.filter((k) => !hitKeys.includes(k))

  console.log('[field-consumed] 域=' + all.length + ' 文件 / store=' + storeFiles.length +
    ' / ref 候选=' + refsSeen + ' / 死字段=' + findings.length + ' / 登记=' + keys.length)
  for (const k of unregistered) console.log('  DEAD_FIELD ' + k)
  for (const k of stale) console.log('  STALE_DEBT ' + k + '（已不再命中，必须删掉这条登记）')
  if (args.has('--json')) console.log(JSON.stringify({ findings, unregistered, stale, domain: all.length, refsSeen }))
  if (unregistered.length || stale.length) return 1
  console.log('[field-consumed] PASS')
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { main, classifyField, isTest, walk }

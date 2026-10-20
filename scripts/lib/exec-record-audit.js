'use strict'

/**
 * .ccg/reviews 的**只读审计**（`check-pr-exec-record.js --audit`）。
 *
 * 为什么需要它：判据只在「本 PR 差量」内看记录，于是主干上累积的未闭环记录
 * （2026-10-20 实测 433 条 dual 里 277 条未闭环）既不会拦住任何 PR，也没有任何
 * 地方能看见它们。这个模块给出一份可复跑的读数。
 *
 * ── 设计上唯一条不能让步的约束：**不判定「已修 / 未修」** ──
 * 记录里只有 `sha` / `stagedDiffHash` / `deepReview.findings`，**没有** branch/PR 字段，
 * 也没有「某条 finding → 哪个提交修好了它」的链接。因此「已修好」在记录层面是**不可判定**的。
 * 任何据此批量改写状态词的实现，都会把真债洗成漂亮话 —— 这正是 qm6 判据自己的注释里
 * 点名的失效模式（「判据挡不住认真编一段带轮次和处置的话」）。
 *
 * ── 落地归因为什么不比 commit sha ──
 * 本仓合并惯例是 squash：主干上的 commit 是**新对象**，feature 分支的 sha 永远不在主干
 * 历史里。按 sha 判会把每个已合并 PR 都算成「未落地」（实测形态：记录里的 sha 与主干
 * `git rev-list` 集合的交集为空）。唯一可靠的判据是「这份记录文件有没有随某次合并进过
 * 主干树」，即 `git ls-tree origin/main -- .ccg/reviews` 的集合成员关系。
 *
 * 本模块**不写任何文件**、不改任何记录、不参与判定：它只打印。
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

/** 判据认可的闭环状态词 —— **不再本地定义**，与判据本体共用同一真源（外部评审第 2 轮 i2） */
const { CLOSED_DEEP_REVIEW_STATUSES: CLOSED_STATUSES } = require('./exec-record-statuses')

const REVIEWS_DIR = path.join('.ccg', 'reviews')

function readRecords(repo) {
  const dir = path.join(repo, REVIEWS_DIR)
  let names
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const full = path.join(dir, name)
    let body
    try { body = JSON.parse(fs.readFileSync(full, 'utf8')) } catch { continue }
    out.push({ name, rel: `${REVIEWS_DIR}/${name}`.split(path.sep).join('/'), body })
  }
  return out
}

/**
 * origin/main 树里的记录文件集合。
 * 取不到（无 origin/main、浅克隆、非 git 目录）时返回 null，由调用方标成「不可判定」。
 */
function mainTreeSet(repo) {
  try {
    const raw = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', 'origin/main', '--', '.ccg/reviews'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return new Set(raw.split('\n').map(s => s.trim()).filter(Boolean))
  } catch { return null }
}

/**
 * @param {{repo: string, limit?: number}} opts
 * @returns {object} 结构化报告（--json 的产物；文本档由 formatText 渲染同一份数据）
 */
function auditHistoricalDebt({ repo, limit = 20 } = {}) {
  const records = readRecords(repo)
  const inMain = mainTreeSet(repo)

  const byStatus = new Map()
  let dual = 0
  let closed = 0
  let open = 0
  let findingsTotal = 0
  const landed = { open: 0, closed: 0, unknown: 0 }
  const notLanded = { open: 0, closed: 0 }
  const unknownLanding = { open: 0, closed: 0 }
  const openSamples = []

  for (const rec of records) {
    const body = rec.body || {}
    if (body.mode !== 'dual') continue
    dual++
    const dr = body.deepReview || {}
    const status = typeof dr.status === 'string' && dr.status ? dr.status : '(missing)'
    const isClosed = CLOSED_STATUSES.has(status)
    if (isClosed) closed++
    else {
      open++
      byStatus.set(status, (byStatus.get(status) || 0) + 1)
      if (Array.isArray(dr.findings)) findingsTotal += dr.findings.length
      if (openSamples.length < limit) {
        openSamples.push({
          file: rec.rel,
          status,
          decidedAt: body.decidedAt || '',
          findings: Array.isArray(dr.findings) ? dr.findings.length : 0,
          performedBy: dr.performedBy || null,
        })
      }
    }
    if (!inMain) {
      if (isClosed) unknownLanding.closed++
      else unknownLanding.open++
      continue
    }
    if (inMain.has(rec.rel)) {
      if (isClosed) landed.closed++
      else landed.open++
    } else if (isClosed) notLanded.closed++
    else notLanded.open++
  }

  const statusRows = [...byStatus.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const shaStats = shaResolvability(repo, records)
  return {
    readOnly: true,
    repo,
    total: records.length,
    dual,
    closed,
    open,
    byStatus: Object.fromEntries(statusRows),
    statusRows,
    findingsTotal,
    landed: { open: landed.open, closed: landed.closed },
    notLanded,
    unknownLanding,
    landingDeterminable: inMain !== null,
    shaResolvability: shaStats,
    samples: openSamples,
    limit,
  }
}

/**
 * 记录里 `sha` 的可解析性。**1 次 spawn**（`git cat-file --batch-check` 批量喂）。
 *
 * 为什么要有这一项（外部评审第 2 轮 i1 提到 Critical）：判定记录是 pre-commit 写的，
 * 而那一刻新 commit 尚未生成 ⇒ 记录里的 `sha` 是**父提交**。这条契约此前只存在于
 * 驱动脚本的一句打印里，工具侧完全看不见，于是"记录 sha 与 PR head 不符"这类判断
 * 只能靠人记着。把它变成读数之后：① 契约被工具自证；② 真有不可解析的 sha 时能点名。
 * @returns {{resolvable: number, unresolvable: number, unresolvableFiles: string[]}}
 */
function shaResolvability(repo, records) {
  const shas = []
  for (const rec of records) {
    const s = rec.body && rec.body.sha
    if (typeof s === 'string' && /^[0-9a-f]{7,64}$/i.test(s)) shas.push({ sha: s, file: rec.rel })
  }
  if (shas.length === 0) return { resolvable: 0, unresolvable: 0, unresolvableFiles: [] }
  let out = ''
  try {
    out = execFileSync('git', ['-C', repo, 'cat-file', '--batch-check'], {
      input: shas.map(x => x.sha).join('\n') + '\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch { return { resolvable: 0, unresolvable: 0, unresolvableFiles: [] } }
  const lines = out.split('\n')
  let resolvable = 0
  const unresolvableFiles = []
  shas.forEach((x, i) => {
    const line = lines[i] || ''
    // 存在的对象形如 "<sha> <type> <size>"；缺失是 "<sha> missing"
    if (/\b(missing|ambiguous)\b/.test(line)) unresolvableFiles.push(x.file)
    else resolvable++
  })
  return { resolvable, unresolvable: unresolvableFiles.length, unresolvableFiles: unresolvableFiles.slice(0, 8) }
}

function formatText(r) {
  const L = []
  L.push('[exec-record-audit] 只读审计（不写任何文件、不改任何状态词、不参与判定）')
  L.push('')
  L.push('汇总')
  L.push(`  记录总数        : ${r.total}`)
  L.push(`  dual 判定       : ${r.dual}`)
  L.push(`  已闭环          : ${r.closed}`)
  L.push(`  未闭环          : ${r.open}`)
  L.push('')
  L.push('未闭环按 status 分档（只列记录里真实存在的状态；不推断「是否已修」）')
  if (r.statusRows.length === 0) L.push('  （无）')
  for (const [status, n] of r.statusRows) {
    L.push(`  ${status.padEnd(24)} ${n}`)
  }
  L.push('')
  L.push('落地归因（判据 = 记录文件是否在 origin/main 树里；不比 commit sha —— squash 后主干是新对象）')
  if (!r.landingDeterminable) {
    L.push('  不可判定        : 全部（取不到 origin/main，如浅克隆/无远端）')
  } else {
    L.push(`  已落地          : ${r.landed.open + r.landed.closed}`)
    L.push(`  未落地          : ${r.notLanded.open + r.notLanded.closed}`)
  }
  L.push('')
  L.push(`待人工看的 findings 条数（未闭环 dual 累加）: ${r.findingsTotal}`)
  L.push('')
  L.push('记录 sha 可解析性（判定记录由 pre-commit 写，那一刻新 commit 尚未生成 ⇒ sha 是**父提交**；')
  L.push('这是引擎既有契约，本行把它自证出来，而不是让人记着）')
  L.push(`  可解析          : ${r.shaResolvability.resolvable}`)
  L.push(`  不可解析        : ${r.shaResolvability.unresolvable}`)
  if (r.shaResolvability.unresolvableFiles.length > 0) {
    for (const f of r.shaResolvability.unresolvableFiles) L.push(`    缺失对象: ${f}`)
  }
  if (r.total === 0) {
    // 外部评审 i5：空结果必须能自证「我找的是哪个目录」，否则用户无从判断是仓库里
    // 真的没有记录、还是路径给错了（静默「0 条」是最坏的可诊断性）。
    // 路径一律用正斜杠展示：与仓库文档/日志的写法一致，也不受宿主 path.sep 影响。
    L.push(`  未找到任何记录文件：${r.repo}/.ccg/reviews（若路径给错，用 --repo=<仓库根> 重试）`)
  }
  if (r.samples.length > 0) {
    L.push('')
    L.push(`未闭环记录样例（前 ${r.samples.length} 条，按文件序）`)
    for (const s of r.samples) {
      L.push(`  ${s.file}  status=${s.status}  findings=${s.findings}  decidedAt=${s.decidedAt}`)
    }
  }
  L.push('')
  L.push('结论')
  L.push('  记录里没有 branch/PR 字段，也没有「finding → 修复提交」的链接，因此「已修好」')
  L.push('  不可从记录判定；本审计只把它们分成可证伪的几类。任何据此批量改写状态词的做法')
  L.push('  都会把真债洗成漂亮话。要真正关闭，只能改「判定写入方」让它能表达「已在后续')
  L.push('  提交修复」，见 openspec/changes/ccg-convergence-exit 与 ccg-review-degradation-ladder。')
  return L.join('\n')
}

module.exports = { auditHistoricalDebt, formatText, readRecords, mainTreeSet, CLOSED_STATUSES }

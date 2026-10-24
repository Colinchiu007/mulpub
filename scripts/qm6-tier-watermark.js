#!/usr/bin/env node
'use strict'
/**
 * QM-6 外部出处覆盖率的水位计（change: qm6-tier-watermark）。
 *
 * 为什么存在：用户裁决「advisory→enforce 暂不翻，等水位」，但"水位"此前没有可重取落点——
 * check-pr-exec-record.js 的 TIER-COVERAGE 只统计**本次变更集**（分母通常个位数），
 * 且只在跑的那一瞬间存在于 stdout。没有尺，裁决就只能靠感觉。
 *
 * 三条承重口径（每条对应 design.md 一节，改动前先读那节）：
 *  - D2 扫描域由判据的 AUDIT_ARTIFACT_RE 持有，**不是**目录 readdir；且必须自报域外条数。
 *    本刀的初版探针就是按目录扫，把 .ccg/reviews 里别的工作会话提交的任务书当成
 *    "该解析却解析失败"的产物，造出一个纯属口径错的假故障数。
 *  - D3 tier 分类只允许一份实现：一律 require 判据本体的 classifyEvidenceTier /
 *    summarizeTierCoverage，不得自己看字段值。
 *  - D4 取对象只能单进程批量（一次 cat-file --batch），帧按头部声明的**字节长度**切；
 *    判定产物是多行 JSON，按行切会把一条记录劈成十几帧。逐文件取 blob 实测不可用
 *    （2041 次进程创建 >5 分钟不完成 vs 批量 1.5 秒）。
 *
 * 本文件不写任何状态文件，也不改任何判定语义：每次现算（design D1）。
 */

const { spawnSync } = require('node:child_process')
const { gitSafeEnv, envDefectNotice } = require('./lib/debt-recheck-live.js')
const {
  AUDIT_ARTIFACT_RE, CLOSED_DEEP_REVIEW_STATUSES, classifyEvidenceTier, summarizeTierCoverage,
  evidenceForm, makeEvidenceProbe, repoObjectPath,
} = require('./check-pr-exec-record.js')

const DOMAIN_DIR = '.ccg/reviews'
const SHA_LEN = 10
const UNIT = String.fromCharCode(31) // git log --format 的分隔符

function makeGit (repo, say) {
  let warned = false
  return function run (args) {
    // 宿主带着 GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE 时会**压过** -C，整轮读的是别人的仓库，
    // 而产物长得完全一样。剔除之外必须出声。
    const child = gitSafeEnv()
    if (child.stripped.length && !warned) { warned = true; envDefectNotice(child.stripped, say) }
    const r = spawnSync('git', ['-C', repo].concat(args), { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    return { rc: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') }
  }
}

function parseArgs (argv) {
  const out = { repo: process.cwd(), ref: 'origin/main', probe: true }
  for (const a of argv) {
    if (a === '--no-probe') out.probe = false
    else if (a.startsWith('--repo=')) out.repo = a.slice(7) || process.cwd()
    else if (a.startsWith('--ref=')) out.ref = a.slice(6)
    else throw new Error('未知旗标 ' + a + '（本工具只认 --repo= / --ref= / --no-probe）')
  }
  return out
}

/** ls-tree → 域内 / 域外两个集合。"域外"的定义就是"目录里有、但判据不看"。 */
function splitDomain (lsTreeOut) {
  const inDomain = []
  const outDomain = []
  for (const line of String(lsTreeOut || '').split('\n')) {
    const m = line.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/)
    if (!m) continue
    const p = m[2]
    if (!p.startsWith(DOMAIN_DIR + '/')) continue
    if (AUDIT_ARTIFACT_RE.test(p)) inDomain.push({ path: p, oid: m[1] })
    else outDomain.push(p)
  }
  return { inDomain, outDomain }
}

/**
 * cat-file --batch 帧解析：头行 `<sha> blob <size>` → 随后**恰好 size 字节** → 一个分隔换行。
 * 禁止"按行读到下一个头行"：判定产物是多行 JSON，那样会把一条记录劈成十几帧（design D4）。
 */
function parseBatch (buf) {
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ''))
  const frames = []
  let missing = 0
  let malformed = 0
  let pos = 0
  while (pos < raw.length) {
    const nl = raw.indexOf(0x0a, pos)
    if (nl < 0) break
    const hdr = raw.slice(pos, nl).toString('utf8')
    pos = nl + 1
    const m = hdr.match(/^([0-9a-f]{40}) blob (\d+)$/)
    if (!m) {
      if (/MISSING/.test(hdr)) missing += 1
      else malformed += 1
      continue
    }
    const size = Number(m[2])
    frames.push({ oid: m[1], size, body: raw.slice(pos, pos + size) })
    pos += size + 1
  }
  return { frames, missing, malformed }
}

/** 只取"mode=dual 且 deepReview 已闭环"这批 —— 资格判据与判据的债务扫描同集合，不另立一份。 */
function collectClosed (frames, oidToPath) {
  const closed = []
  let parseFail = 0
  let notDual = 0
  for (const f of frames) {
    let rec = null
    try { rec = JSON.parse(f.body.toString('utf8')) } catch { parseFail += 1; continue }
    if (!rec || rec.mode !== 'dual' || !rec.deepReview || !CLOSED_DEEP_REVIEW_STATUSES.has(rec.deepReview.status)) { notDual += 1; continue }
    closed.push({ path: oidToPath.get(f.oid) || '', dr: rec.deepReview })
  }
  return { closed, parseFail, notDual }
}

/**
 * `unknown` 桶按判据语义把「字段缺席」与「字面值写成 unknown」合并（那是刻意的，本刀不改）。
 * 但两档成因不同（历史产物 vs 有人显式声明不作保证），enforce 裁决要分得开 ⇒ 按**键存在性**拆两个
 * 子读数，并要求 `子1 + 子2 == 判据的 unknown`。判据以后改了这档语义，等式会先红，
 * 而不是悄悄被换掉解释（这就是"复用"与"另算一份"的区别：等式是可见的）。
 */
function splitUnknown (closed, unknownBucket) {
  const literal = closed.filter((dr) => typeof dr.tier === 'string' && dr.tier.trim() === 'unknown').length
  const missingField = unknownBucket - literal
  if (missingField < 0) {
    return { literal, missingField, defect: 'unknown 子读数不自洽（字面值 ' + literal + ' > 判据桶 ' + unknownBucket + '）⇒ 判据分桶口径已变，先核对再信本行' }
  }
  return { literal, missingField, defect: null }
}

/**
 * log --diff-filter=A 输出 → 每个路径**最早那次加入**的 committer 月份 + 月度分桶（design D5）。
 * 取 committer 而非 author：squash 合并会把 author 日期留在原始编写时刻，按它分桶会错位。
 * git log 走新→旧，所以同一文件多次"删了再加"时，最后写进表的那次才是最早加入。
 */
function buildTrend (logOut) {
  const monthOfPath = new Map()
  let month = ''
  for (const line of String(logOut || '').split('\n')) {
    const h = line.match(/^([0-9a-f]{40})\u001f(\d{4}-\d{2})/)
    if (h) { month = h[2]; continue }
    if (!line.startsWith(DOMAIN_DIR + '/') || !AUDIT_ARTIFACT_RE.test(line) || !month) continue
    monthOfPath.set(line, month)
  }
  const counts = new Map()
  for (const m of monthOfPath.values()) counts.set(m, (counts.get(m) || 0) + 1)
  const buckets = Array.from(counts.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([m, added]) => ({ month: m, added }))
  return { monthOfPath, buckets }
}

/** 月度桶里"该月加入且现为 external"的条数（外部出处占比按加入月看趋势用）。 */
function addExternal (buckets, closed, monthOfPath, tierOf) {
  for (const c of closed) {
    const m = monthOfPath.get(c.path)
    if (!m) continue
    const b = buckets.find((x) => x.month === m)
    if (!b) continue
    b.closedInMonth = (b.closedInMonth || 0) + 1
    if (tierOf(c.dr) === 'external') b.external = (b.external || 0) + 1
  }
  return buckets
}

function main (argv) {
  const t0 = Date.now()
  const args = parseArgs(argv)
  const out = (s) => process.stdout.write(s + '\n')
  const run = makeGit(args.repo, (m) => process.stderr.write('[qm6-tier-watermark] ' + m + '\n'))

  const head = run(['rev-parse', args.ref])
  if (head.rc !== 0 || !/^[0-9a-f]{40}$/.test(head.stdout.trim())) {
    out('WATERMARK-SELF-FAULT ref=' + args.ref + ' 解析失败（rc=' + head.rc + '）：' + String(head.stderr).split('\n')[0])
    out('  ⇒ 不出读数行。"取不到对象"与"零份产物"必须可区分（design D9）。')
    return 2
  }
  const mainSha = head.stdout.trim().slice(0, SHA_LEN)

  const ls = run(['ls-tree', '-r', args.ref, '--', DOMAIN_DIR])
  if (ls.rc !== 0) {
    out('WATERMARK-SELF-FAULT ls-tree rc=' + ls.rc + ' :: ' + String(ls.stderr).split('\n')[0])
    return 2
  }
  const { inDomain, outDomain } = splitDomain(ls.stdout)
  if (inDomain.length === 0) {
    out('WATERMARK-SELF-FAULT 域内为空（列到 ' + (inDomain.length + outDomain.length) + ' 个文件，命中 AUDIT_ARTIFACT_RE 的是 0 个）'
      + ' ⇒ 要么产物命名形态又变了一次，要么这个 ref 上确实没有判定产物。两者都不得读成"覆盖率 0%"。')
    out('  AUDIT_ARTIFACT_RE = ' + String(AUDIT_ARTIFACT_RE))
    return 2
  }

  const batch = spawnSync('git', ['-C', args.repo, 'cat-file', '--batch'], {
    input: inDomain.map((e) => e.oid).join('\n') + '\n', maxBuffer: 512 * 1024 * 1024,
  })
  if (batch.status !== 0) {
    out('WATERMARK-SELF-FAULT cat-file --batch rc=' + batch.status + ' :: ' + String(batch.stderr).split('\n')[0])
    return 2
  }
  const { frames, missing, malformed } = parseBatch(batch.stdout)
  // 帧数必须等于请求数：不等 ⇒ 取数与请求不同源，整轮读数作废（不得只数"有没有 MISSING"）。
  if (frames.length !== inDomain.length) {
    out('WATERMARK-SELF-FAULT 帧数 ' + frames.length + ' != 域内对象数 ' + inDomain.length
      + '（missing=' + missing + ' malformed=' + malformed + '）⇒ 整轮读数作废')
    return 2
  }
  const oidToPath = new Map(inDomain.map((e) => [e.oid, e.path]))
  const { closed, parseFail } = collectClosed(frames, oidToPath)

  // 存在性探针：把"被引用的路径"交给判据自己的探针工厂，于是"该 revision 里到底有没有这个对象"
  // 由同一份实现回答。不传探针时必须出声（probe=off），不得把"没验"读成"验过了"。
  const referenced = []
  for (const c of closed) {
    const ev = c.dr && c.dr.evidence
    if (evidenceForm(ev) !== 'path') continue
    const p = repoObjectPath(ev)
    if (p) referenced.push({ status: 'A', file: p })
  }
  const existsAt = args.probe ? makeEvidenceProbe({ statuses: referenced, repo: args.repo, head: args.ref }) : undefined

  const sum = summarizeTierCoverage(closed.map((c) => c.dr), existsAt)
  const u = splitUnknown(closed.map((c) => c.dr), sum.by.unknown)
  const tierOf = (dr) => classifyEvidenceTier(dr, existsAt)
  const trend = buildTrend(run(['log', '--diff-filter=A', '--format=%H' + UNIT + '%cI', '--name-only', args.ref, '--', DOMAIN_DIR]).stdout)
  const buckets = addExternal(trend.buckets, closed, trend.monthOfPath, tierOf)

  out('TIER-WATERMARK main=' + mainSha + ' ref=' + args.ref + ' total=' + sum.total +
    ' external=' + sum.by.external + ' external-unverified=' + sum.by['external-unverified'] +
    ' self-play=' + sum.by['self-play'] + ' none=' + sum.by.none +
    ' unknown=' + sum.by.unknown + ' unrecognized=' + sum.by.unrecognized +
    ' unknown-字段缺席=' + u.missingField + ' unknown-字面值=' + u.literal +
    ' external-直签=' + sum.by['external(直签)'] +
    ' external-自扮演复核=' + sum.by['external(自扮演+公开复核)'] +
    ' 域外=' + outDomain.length + ' 域由=AUDIT_ARTIFACT_RE' +
    ' probe=' + (args.probe ? 'on' : 'off') + ' elapsed_ms=' + (Date.now() - t0))
  if (u.defect) out('  WATERMARK-DEFECT ' + u.defect)
  // 合取③ 的第二条出口（2026-10-24 授权放宽）改的是"这一格算不算外部出处"，
  // 所以分档必须在派生工具里也看得见：两子读数之和 != external 就是分档在撒谎。
  const extSplit = sum.by['external(直签)'] + sum.by['external(自扮演+公开复核)']
  if (extSplit !== sum.by.external) {
    out('  WATERMARK-DEFECT external 分档不等式破了：直签=' + sum.by['external(直签)'] +
      ' + 自扮演+公开复核=' + sum.by['external(自扮演+公开复核)'] + ' != external=' + sum.by.external +
      ' ⇒ 派生工具与判据的口径分裂，别把这份读数当覆盖率')
  }
  if (parseFail) out('  WATERMARK-PARSE-FAIL 无法解析=' + parseFail + '（命中域但读不出 JSON ⇒ 不进 total；别把它们读成"没产物"）')
  out('  口径：unknown 桶按判据语义合并（字段缺席 与 字面写 unknown 等效），子读数已拆开；'
    + '域外=N 不进分母（多为别的工作会话提交的任务书）。')
  out('  趋势边界：只认"加入"，且产物名是内容寻址的 ⇒ amend/rebase 会换名。'
    + '本行表达"当前主干上这批对象各自何时首次出现"，不是外部评审的发生次数。')
  for (const b of buckets) {
    out('WATERMARK-TREND 月=' + b.month + ' added=' + b.added +
      ' closedInMonth=' + (b.closedInMonth || 0) + ' external=' + (b.external || 0))
  }
  out('  重取：node scripts/qm6-tier-watermark.js --repo=<仓或 worktree 根> --ref=' + args.ref +
    (args.probe ? '' : ' --no-probe') + '（全量实测秒级；写成一次性的量测就等于没尺）')
  return 0
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)) } catch (e) {
    process.stdout.write('WATERMARK-SELF-FAULT 判据自身故障：' + String((e && e.message) || e).split('\n')[0] + '\n')
    process.exitCode = 2
  }
}

module.exports = { parseArgs, splitDomain, parseBatch, collectClosed, splitUnknown, buildTrend, addExternal, main, DOMAIN_DIR, SHA_LEN }

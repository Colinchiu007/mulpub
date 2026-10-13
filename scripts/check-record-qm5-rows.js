'use strict'
/*
 * check-record-qm5-rows.js —— 执行记录的"QM-5 行集"结构棘轮
 *
 * 要防的事故（本会话实测，PR #3477 的记录里真实发生过）：一份记录在多次改写中把
 * 「防止再次发生（QM-5 ⑤）」的**行标题吞掉**、正文并入上一行末尾 ⇒ 五步只剩四步有名有姓，
 * 而 check-pr-exec-record.js 只判"本 PR 携带执行记录或带原因的豁免"、不校验行集，于是全程全绿。
 * 摸底：全仓 254 份记录里，用了 QM-5 标记却缺 ⑤ 的有 25 份。
 *
 * 三条口径（都有对应锁）：
 *  A. 必需集**从 `openspec/records/_TEMPLATE.md` 的行题派生**，代码里不写死五个字面。
 *     实测模板只声明 ①②④⑤（不含 ③ 系统性漏洞）—— 手抄五个会让模板自己当场红。
 *  B. 只采**表格行题**里的标记（`| …（QM-5 ①） |`），正文/注释里出现的字样不算，
 *     否则一句解释就能把缺失的行"补"出来。
 *  C. 阻断三类，且**欠账清单只能缩小**：
 *     - violations：本 PR 改动的记录里缺行且未登记
 *     - unregistered：全仓缺行但未登记的（新增即红，逼人来登记而不是默默扩清单）
 *     - stale：登记了却已补齐（键漂移不许静默）
 *
 * CLI rc：0 合规 / 1 发现违规 / 2 判据自己读不到东西（fail closed，git 取证失败、模板缺失都走这里）
 *
 * ⚠️ 边界，必须与结论一起读：这是**结构判据**。它只能证"那一行在不在"，
 *    证不了"那一行写了东西且内容属实"——把 ⑤ 写成空单元格照样通过。
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const RECORDS_DIR = 'openspec/records'
const TEMPLATE_REL = 'openspec/records/_TEMPLATE.md'

// 域外：模板是判据来源不是被审对象；_exempt/ 是带原因的豁免载体；_legacy-absent 是哨兵文件
const OUT_OF_DOMAIN = [
  /^openspec\/records\/_TEMPLATE\.md$/,
  /^openspec\/records\/_exempt\//,
  /^openspec\/records\/_legacy-absent\.md$/,
]

// 表格行题里的步骤标记：第一个单元格内含「（QM-5 ①）」。整行匹配，正文里的同名串不算。
const ROW_TITLE_STEP = /^\|[ \t]*([^|\n]*?（QM-5\s*([①②③④⑤])）[^|\n]*?)[ \t]*\|/gm
const TITLE_LABEL = { '①': '第一性原因', '②': '逃逸分析', '③': '系统性漏洞', '④': '修复 + 回归保护', '⑤': '防止再次发生' }

function stepsFromText(text) {
  // 两条预处理，各对应一条实测到的形状：
  //  ① CRLF 归一：本仓 openspec/records/*.md 的工作副本实测 **254/254 含 CRLF**
  //    （`attr=text=auto` 的 checkout 转换）。实测本正则对 CRLF 不敏感（`\r` 落在行尾的
  //    最后一个单元格之外），但归一化把"依赖这个巧合"变成显式保证。
  //  ② 剥掉围栏代码块：markdown 里的 ``` 块常用来**演示**表格行；不剥就会把示例
  //    当成真行题采集（实测：围栏里写 `| 第一性原因（QM-5 ①） |` 会被算进 present，
  //    于是"整份记录只有示例、没有真行"能骗过判据）。当前全仓受影响文件=0，
  //    所以这条不改变现状计数，只封死未来的绕过路径。
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/^```[\s\S]*?^```[ \t]*$/gm, '')
  const out = []
  for (const m of normalized.matchAll(ROW_TITLE_STEP)) {
    if (!out.includes(m[2])) out.push(m[2])
  }
  return out
}

function requiredStepsFromTemplate(templateText) {
  return stepsFromText(templateText)
}

function stepsPresentInRecord(text) {
  return new Set(stepsFromText(text))
}

function isRecordPath(f) {
  return f.startsWith(RECORDS_DIR + '/') && f.endsWith('.md')
}

function inDomain(f) {
  return isRecordPath(f) && !OUT_OF_DOMAIN.some((re) => re.test(f))
}

function listRecordFiles(root) {
  const dir = path.join(root, RECORDS_DIR)
  if (!fs.existsSync(dir)) throw new Error('记录目录不存在: ' + dir)
  const out = []
  const walk = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, ent.name)
      const r = rel + '/' + ent.name
      if (ent.isDirectory()) { walk(a, r); continue }
      if (r.endsWith('.md')) out.push(r)
    }
  }
  walk(dir, RECORDS_DIR)
  return out.sort()
}

/**
 * @param {object} o
 * @param {string} o.root 仓库根（可注入，便于测试喂 fixture）
 * @param {string[]} o.changed 本 PR 改动的文件路径（相对仓库根，POSIX 分隔）
 * @param {string} [o.templateText] 模板正文；缺省时从 root 读
 * @param {object} [known] 欠账清单 file -> reason；缺省用 KNOWN_MISSING_QM5
 */
function collect(o) {
  const root = o.root
  const changed = o.changed || []
  const known = o.known || KNOWN_MISSING_QM5
  const templateText = typeof o.templateText === 'string' ? o.templateText
    : fs.readFileSync(path.join(root, TEMPLATE_REL), 'utf8')
  const required = requiredStepsFromTemplate(templateText)

  const inDomainFiles = []
  const violations = []
  const unregistered = []
  for (const rel of listRecordFiles(root)) {
    if (!inDomain(rel)) continue
    const text = fs.readFileSync(path.join(root, rel), 'utf8')
    const present = stepsPresentInRecord(text)
    if (present.size === 0) continue // 未采用 QM-5 行题约定（历史记录）⇒ 不进域
    inDomainFiles.push(rel)
    const missing = required.filter((s) => !present.has(s))
    if (missing.length === 0) continue
    const registered = Object.prototype.hasOwnProperty.call(known, rel)
    if (!registered) unregistered.push({ file: rel, missing })
    if (changed.includes(rel) && !registered) {
      violations.push({
        file: rel,
        missing,
        hint: missing.map((s) => `${s}=${TITLE_LABEL[s] || '?'}（QM-5 ${s}）`).join(' '),
      })
    }
  }

  const stale = []
  for (const rel of Object.keys(known)) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue // 文件已不存在（记录被归档/删除）由别的门禁管，这里不判
    const text = fs.readFileSync(abs, 'utf8')
    const present = stepsPresentInRecord(text)
    if (!text || present.size === 0) continue // 未采用约定的登记项：不缺行也无从判"补齐"
    const missing = required.filter((s) => !present.has(s))
    if (missing.length === 0) stale.push(rel)
  }

  return { required, inDomain: inDomainFiles, violations, unregistered, stale, knownCount: Object.keys(known).length }
}

function git(args, root) {
  return execFileSync('git', ['-C', root].concat(args), { encoding: 'utf8', maxBuffer: 1 << 26 })
}

// 欠账清单：2026-10-13 摸底实测的 25 篇「用了 QM-5 行题约定、却缺 ⑤ 防止再次发生」。
// 口径与 KNOWN_UNWIRED / KNOWN_NON_FAIL_FAST 一致 —— **只能缩小**，新增缺行一律当场红。
const KNOWN_MISSING_QM5 = {
// 由判据自身测量登记，共 27 条；新增缺行一律当场红。
  'openspec/records/asar-loose-resources-tests.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/audit-writeback-key-fix.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/batch-teleport-fix.md': '历史缺口：缺 ①②⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/bilibili-buckets-backfill.md': '历史缺口：缺 ②④⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/budget-probe-form-split.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/changelog-dedup-v2.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/collection-drafts-tab.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/coverage-gate-electron-prepare.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/dep-audit-baseline-2026-10.md': '历史缺口：缺 ②（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/dep-audit-opscenter-domain.md': '历史缺口：缺 ①④⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/desktop-shard-flag.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/fix-article-body-format.md': '历史缺口：缺 ④（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/fix-stage-runtime-flatten.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/fix-xhs-draft-false-success.md': '历史缺口：缺 ④⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/gate-budget-reprobe.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/gate-debt-status-field.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/gui-test-workflow-structure.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/publish-draft-keepalive.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/publish-frequency-control.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/publish-history-engagement.md': '历史缺口：缺 ②④⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/publish-tab-state-keepalive.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/test-egress-runtime-ledger-baseline.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/upgrade-electron-43-5.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/wechat-mp-api-track.md': '历史缺口：缺 ①②⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/wxmp-publish-masssend.md': '历史缺口：缺 ①②⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/xhs-creator-home-url.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
  'openspec/records/xhs-draft-box-restore.md': '历史缺口：缺 ⑤（2026-10-13 由本门禁自身测量登记；口径=表格行题里是否出现「（QM-5 N）」行，正文提法不算；清单只能缩小）',
}

function main(argv) {
  const args = {}
  argv.forEach((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a)
    if (m) args[m[1]] = m[2]
    else if (/^--/.test(a)) args[a.slice(2)] = true
  })
  const root = args.root ? path.resolve(args.root) : process.cwd()
  const base = args.base
  const head = args.head || 'HEAD'

  let changed
  if (base) {
    try {
      changed = git(['diff', '--name-only', `${base}...${head}`], root)
        .split(/\r?\n/).filter(Boolean)
    } catch (e) {
      console.log('SCANNER_ERROR git diff 取证失败：' + String(e.message || e).slice(0, 160))
      return 2
    }
  } else {
    changed = []
  }

  let r
  try {
    r = collect({ root, changed })
  } catch (e) {
    console.log('SCANNER_ERROR 判据自身读不到东西：' + String(e.message || e).slice(0, 160))
    return 2
  }

  console.log(`必需步骤（从 ${TEMPLATE_REL} 派生）= ${r.required.join(' ')}`)
  console.log(`检查域内记录=${r.inDomain.length}  欠账登记=${r.knownCount}  全仓未登记缺行=${r.unregistered.length}`)
  const bad = []
  if (r.violations.length) {
    console.log(`FAIL：本 PR 改动的记录缺行且未登记（${r.violations.length} 条）`)
    r.violations.forEach((v) => console.log(`  - ${v.file} 缺 ${v.hint}`))
    bad.push('violations')
  }
  if (r.unregistered.length) {
    console.log(`FAIL：全仓存在未登记的缺行（${r.unregistered.length} 条）—— 新增缺行必须登记欠账或补齐，清单只能缩小`)
    r.unregistered.slice(0, 20).forEach((v) => console.log(`  · ${v.file} 缺 ${v.missing.join('')}`))
    bad.push('unregistered')
  }
  if (r.stale.length) {
    console.log(`FAIL：欠账清单有陈旧登记（${r.stale.length} 条）—— 已补齐就删掉登记项`)
    r.stale.forEach((f) => console.log(`  · ${f}`))
    bad.push('stale')
  }
  if (bad.length) return 1
  console.log('OK: 本 PR 改动的执行记录行集齐全（按模板派生的必需步骤），欠账清单无新增、无陈旧')
  return 0
}

module.exports = { requiredStepsFromTemplate, stepsPresentInRecord, collect, main, KNOWN_MISSING_QM5, ROW_TITLE_STEP }

if (require.main === module) process.exit(main(process.argv.slice(2)))

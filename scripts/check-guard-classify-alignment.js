'use strict'
/*
 * Guard ⇄ classify allow-list alignment lock.
 *
 * The invariant this repo keeps re-breaking: two hand-written lists answer the same
 * question ("may this path be edited in the shared main workspace?") from two files,
 * and nothing compares them.
 *   - scripts/classify-docs-only.js  CI_IGNORED_PATHS   (what counts as docs-only)
 *   - scripts/guard-shared-root-writes.ps1  $allowedTop / $allowedRootFiles
 * When a path is docs-only but not guard-allowed, the guard does NOT report an error:
 * it moves the file into the quarantine and restores HEAD's copy, so the edit looks
 * like "I changed it and nothing happened". Measured 2026-10-14 on .gitignore
 * (violations.jsonl: quarantined-tracked @ .gitignore, 2026-10-14T11:07:20Z). The same
 * shape was fixed once for .adversarial (2b5db77b8 / PR #3272) without adding this
 * comparison, which is why it recurred.
 *
 * Scope discipline (why "tracked" is part of the predicate):
 *   untracked + gitignored  -> released by the guard at :167, no drift by construction
 *   untracked + NOT ignored -> *should* keep being quarantined (stray file in main),
 *                              so allow-listing it would weaken the guard
 * Only a TRACKED, docs-whitelisted path that the guard still quarantines is a defect.
 * LICENSE and .editorconfig are in CI_IGNORED_PATHS but are not tracked at all, so
 * they are deliberately not added to the guard's lists (no dead entries).
 *
 * The debt list is shrink-only: a new uncovered tracked path is red, and a debt entry
 * that stops being uncovered is red too (stale registration), so deleting the litter is
 * the only way to make this list shorter.
 *
 * Exit codes: 0 compliant | 1 drift found | 2 the checker itself could not read the
 * inputs (mixed bands would let "the gate is blind" be read as "the repo has a problem"
 * or, worse, as "clean").
 *
 * Requires node builtins only: this runs in the `changes` job, which has no install
 * step (precedent: quality-rhythm-spec-mirror.test.js pins that dependency surface).
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const GUARD_REL = 'scripts/guard-shared-root-writes.ps1'
const CLASSIFY_REL = 'scripts/classify-docs-only.js'

// Root-level tracked .md files that classify treats as docs-only but the guard does
// not allow. Every entry is one-off litter or a duplicate of a document that belongs
// under 01-docs/ | docs/. They are registered here INSTEAD OF being allow-listed,
// because allow-listing would entrench litter as "editable in the main workspace".
// This list may only shrink; adding to it requires a reason and is a deliberate act.
const DEBT = {
  '.ccg-plan-client-injection.md': '一次性 CCG 计划产物，正解是删除或迁入 01-docs/',
  '.quality-gates-record-publish-api-complete.md': '执行记录的历史副本，正本在 .quality-gates.md / openspec/records/',
  '.quality-gates-record-publish-api-media.md': '执行记录的历史副本，正本在 .quality-gates.md / openspec/records/',
  '.quality-gates-record-publish-capabilities.md': '执行记录的历史副本，正本在 .quality-gates.md / openspec/records/',
  '.quality-gates-record-publish-fail-draft-guard.md': '执行记录的历史副本，正本在 .quality-gates.md / openspec/records/',
  '.quality-gates-record-rewrite-paragraph-preserve.md': '执行记录的历史副本，正本在 .quality-gates.md / openspec/records/',
  'ADR-002-dashboard-ui-refresh.md': 'ADR 的重复副本，docs/adr/ 已有同编号条目',
  'CI-ANALYSIS-PR-2066.md': 'PR #2066 的一次性 CI 排障报告',
  'CI-FINAL-REPORT-20260920.md': '2026-09-20 的一次性 CI 报告',
  'CI-FIX-FINAL-REPORT-20260920.md': '2026-09-20 的一次性 CI 报告',
  'CI-FIX-FINAL-SUCCESS-REPORT-20260920.md': '2026-09-20 的一次性 CI 报告',
  'CI-FIX-PLAN-UPDATED-20260920.md': '2026-09-20 的一次性 CI 计划',
  'CI-ZERO-FAILURE-REPORT-20260920.md': '2026-09-20 的一次性 CI 报告',
  'HEALTH-REPORT.md': '一次性体检报告产物',
  'PR-2066-CI-INVESTIGATION.md': 'PR #2066 的一次性调查记录',
  'PR-2066-CI-MONITORING.md': 'PR #2066 的一次性监控记录',
  'SKILL.md': '技能说明残留，与 .agents/skills 下的正本重复',
  'pr-body-dashboard-ui.md': 'PR 正文临时稿，本不该入库',
  'pr-body-temp.md': 'PR 正文临时稿，本不该入库',
  'requirements.md': '早期需求文档，正本在 01-docs/PRD.md',
  'review.md': '一次性评审产物',
}

class SelfFailure extends Error {}

function readOrThrow(root, rel) {
  const file = path.join(root, rel.split('/').join(path.sep))
  if (!fs.existsSync(file)) throw new SelfFailure('missing file: ' + file)
  return fs.readFileSync(file, 'utf8')
}

function loadClassify(root) {
  let mod
  try {
    mod = require(path.join(root, CLASSIFY_REL.split('/').join(path.sep)))
  } catch (err) {
    // A fixture root without the real classifier, or a classifier that no longer
    // exports what this lock depends on, is a blind gate - not a clean verdict.
    throw new SelfFailure('could not load ' + CLASSIFY_REL + ' from ' + root + ': ' + err.message)
  }
  if (!Array.isArray(mod.CI_IGNORED_PATHS) || mod.CI_IGNORED_PATHS.length === 0) {
    throw new SelfFailure('classify-docs-only.js did not export CI_IGNORED_PATHS')
  }
  if (typeof mod.matchesPattern !== 'function') {
    throw new SelfFailure('classify-docs-only.js did not export matchesPattern')
  }
  return mod
}

function extractGuardArray(source, name) {
  // Anchor on the line start so an array that only appears inside a comment is never read
  // as the live list. The list body is then taken across lines until a line ends with the
  // closing paren, and items come out of quote pairs. The first version demanded one line
  // and no ')' inside an item, so reformatting $allowedTop one-item-per-line - or adding a
  // path containing a paren - turned this lock into an exit-2 self-failure that gates every
  // PR. Fail-closed stays, but only for a genuinely missing or degraded list.
  const openRe = new RegExp('^\\$' + name + ' = @\\(', 'm')
  const m = source.match(openRe)
  if (!m) throw new SelfFailure('could not locate the live $' + name + ' assignment in ' + GUARD_REL)
  const after = source.slice((m.index || 0) + m[0].length).split('\n')
  const collected = []
  let closed = false
  for (const rawLine of after) {
    const line = rawLine.replace(/\r$/, '')
    collected.push(line)
    if (/\)\s*$/.test(line)) { closed = true; break }
  }
  if (!closed) throw new SelfFailure('$' + name + ' has no line ending with the closing paren in ' + GUARD_REL)
  const body = collected.join('\n').replace(/\)\s*$/, '')
  const items = [...body.matchAll(/'([^']*)'/g)].map((x) => x[1])
  if (items.length === 0) throw new SelfFailure('$' + name + ' parsed to an empty list (degraded parse)')
  return items
}

function listTracked(root) {
  let out
  try {
    out = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    throw new SelfFailure('git ls-files failed: ' + err.message)
  }
  const files = out.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (files.length === 0) throw new SelfFailure('git ls-files returned nothing - an empty traversal must not read as "zero drift"')
  return files
}

function collect({ root = process.cwd(), debt = DEBT } = {}) {
  // `debt` is injectable on purpose. The live list names 22 real repo files; a fixture
  // repository that never contains them would be judged "22 stale registrations" on
  // every case, which is how a hardcoded exception list turns a lock into a machine
  // that only ever reports one answer (this repo has been bitten by exactly that).
  const classify = loadClassify(root)
  const guardSrc = readOrThrow(root, GUARD_REL)
  const allowedTop = extractGuardArray(guardSrc, 'allowedTop')
  const allowedRootFiles = extractGuardArray(guardSrc, 'allowedRootFiles')
  const tracked = listTracked(root)

  const docsTracked = tracked.filter((f) => classify.CI_IGNORED_PATHS.some((p) => classify.matchesPattern(f, p)))
  const uncovered = docsTracked.filter((f) => {
    const parts = f.split('/')
    return parts.length === 1 ? !allowedRootFiles.includes(f) : !allowedTop.includes(parts[0])
  })

  const violations = uncovered.filter((f) => !Object.prototype.hasOwnProperty.call(debt, f)).sort()
  const stale = Object.keys(debt).filter((f) => !uncovered.includes(f)).sort()
  const acknowledged = uncovered.filter((f) => Object.prototype.hasOwnProperty.call(debt, f)).sort()

  return {
    patterns: classify.CI_IGNORED_PATHS.length,
    allowedTop,
    allowedRootFiles,
    tracked: tracked.length,
    docsTracked: docsTracked.length,
    uncovered,
    uncoveredCount: uncovered.length,
    acknowledged,
    violations,
    stale,
    debtSize: Object.keys(debt).length,
  }
}

function formatSummary(r) {
  return (
    '[guard-classify-align] patterns=' + r.patterns +
    ' tracked=' + r.tracked +
    ' docsOnlyTracked=' + r.docsTracked +
    ' uncovered=' + r.uncoveredCount +
    ' (acknowledged=' + r.acknowledged.length +
    ' NEW=' + r.violations.length +
    ' stale=' + r.stale.length +
    ' debtList=' + r.debtSize + ')'
  )
}

function main(argv) {
  const rootArg = argv.find((a) => a.startsWith('--repo='))
  const root = rootArg ? rootArg.slice('--repo='.length) : process.cwd()
  let report
  try {
    report = collect({ root })
  } catch (err) {
    if (err instanceof SelfFailure) {
      process.stderr.write('[guard-classify-align] SELF-FAILURE (exit 2, not a drift verdict): ' + err.message + '\n')
      return 2
    }
    throw err
  }
  process.stdout.write(formatSummary(report) + '\n')
  for (const f of report.violations) {
    process.stdout.write('  UNCOVERED: ' + f + '  (docs-only per classify, but the guard will quarantine edits to it)\n')
  }
  for (const f of report.stale) {
    process.stdout.write('  STALE DEBT: ' + f + '  (no longer uncovered - delete its debt entry; the list must shrink)\n')
  }
  if (report.violations.length > 0 || report.stale.length > 0) {
    process.stderr.write(
      '[guard-classify-align] FAIL: ' + report.violations.length + ' new drift, ' + report.stale.length + ' stale registrations\n'
    )
    return 1
  }
  process.stdout.write('[guard-classify-align] OK: every tracked docs-only path is either guard-allowed or a shrinking debt entry\n')
  return 0
}

module.exports = { collect, formatSummary, DEBT, GUARD_REL, CLASSIFY_REL, SelfFailure, extractGuardArray }

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2))
}

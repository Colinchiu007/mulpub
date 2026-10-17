#!/usr/bin/env node
// 合并账本与记录归属的唯一取源（change: gate-record-sync-derived-status）。
//
// 为什么要有这个模块：执行记录的「远程同步」收口原先靠人在合并后再开一个 PR 把状态改成
// PASS + merge SHA，而 merge SHA 只有合并之后才存在——这是个循环依赖，于是每条交付都要两趟 PR。
// 改成由主干历史现场推导之后，"哪次已合并的提交把这篇记录带进 main" 就是 git 的一等事实：
// 合并后可知、合并前必然不可知，**没法提前伪写**。
//
// 三条口径都是实测钉出来的，改动任何一条都会让判据静默错判：
//   1) 只认行尾 `(#NNNN)`：gh 的 squash 会在标题行尾加这个尾注；同一行靠前出现的编号是正文引用。
//   2) `--no-renames`：临时仓库实测 —— a.md(#100) 经 git mv 成 b.md(#200) 后，
//      `--diff-filter=A` 会为 b.md 报出 #200。所以改名是把归属**重指**到改名提交，
//      而不是"解析不到"。新路径带着自己的 A 出现，旧路径只剩 D。
//   3) 取"最近一次新增"而不是"首次新增"：main 上现存的这份内容就是最近那次 A 带进来的；
//      取首次会把"删除后由另一 PR 重新加回"的内容归给一次已不在主干历史里的交付。
//
// 不可用的三种形态必须与"账本里没有这个 PR"区分开：前者是取证失败（判据须退回断言档并出声），
// 后者是真未收口。**绝不允许返回空账本冒充"一个已合并 PR 都没有"**——那会让派生档静默退化成装饰。

const { execFileSync } = require('node:child_process')

const FOOTER_RE = /\(#(\d{3,})\)\s*$/
const HEADER_RE = /^([0-9a-f]{40})\t([^\t]*)\t(.*)$/
const RECORDS_PATH_PREFIX = 'openspec/records/'

const LEDGER_UNAVAILABLE = {
  refUnresolvable: 'ref-unresolvable',
  gitFailed: 'git-failed',
  emptyLedger: 'empty-ledger',
}

function runGit(cwd, args) {
  // 路径必须按字面读：quotepath 开着时 git 会把非 ASCII 路径输出成带引号的转义串，
  // 键就永久对不上，表现为"这条记录永远派生不出收口"，且不报任何错。
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function unavailable(reason, detail) {
  return { ok: false, reason, detail: String(detail || '').split('\n')[0].slice(0, 200) }
}

function buildLedger({ baseRef = 'origin/main', cwd = process.cwd() } = {}) {
  // 先分清"这个目录不是仓库"和"这个 ref 不存在"：两者都让 git 非零退出，
  // 混成一种就会把"判据跑错了地方"报成"分支还没建好"。
  try {
    runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  } catch (e) {
    return unavailable(LEDGER_UNAVAILABLE.gitFailed, e.message)
  }
  let baseSha = ''
  try {
    baseSha = runGit(cwd, ['rev-parse', '--verify', `${baseRef}^{commit}`]).trim()
  } catch (e) {
    return unavailable(LEDGER_UNAVAILABLE.refUnresolvable, e.message)
  }

  const mergedPrs = new Map()
  let dupFooters = 0
  let commits = 0
  try {
    const subjects = runGit(cwd, ['log', baseRef, '--format=%H\t%cI\t%s'])
    for (const line of subjects.split('\n')) {
      const m = HEADER_RE.exec(line)
      if (!m) continue
      commits += 1
      const footer = FOOTER_RE.exec(m[3])
      if (!footer) continue
      const pr = Number(footer[1])
      if (mergedPrs.has(pr)) { dupFooters += 1; continue } // 同尾注重复出现：留最近一次，但必须计数出声
      mergedPrs.set(pr, { sha: m[1], iso: m[2] })
    }
  } catch (e) {
    return unavailable(LEDGER_UNAVAILABLE.gitFailed, e.message)
  }

  const addedBy = new Map()
  let addedPaths = 0
  try {
    const addLog = runGit(cwd, [
      'log', baseRef, '--diff-filter=A', '--name-only', '--no-renames', '--format=%H\t%cI\t%s',
    ])
    let currentPr = null
    let seenHeader = false
    for (const line of addLog.split('\n')) {
      if (!line) continue
      const m = HEADER_RE.exec(line)
      if (m) {
        const footer = FOOTER_RE.exec(m[3])
        currentPr = footer ? Number(footer[1]) : null
        seenHeader = true
        continue
      }
      if (!seenHeader) continue
      const rel = line.trim()
      if (!rel) continue
      addedPaths += 1
      // git log 默认新→旧，第一个遇到的 A 即"最近一次新增"；后来者（更早的新增）不覆盖。
      if (!addedBy.has(rel)) addedBy.set(rel, currentPr)
    }
  } catch (e) {
    return unavailable(LEDGER_UNAVAILABLE.gitFailed, e.message)
  }

  if (mergedPrs.size === 0) {
    return unavailable(LEDGER_UNAVAILABLE.emptyLedger,
      `baseRef=${baseRef} 可解析、扫了 ${commits} 个提交，但一个 ${'#'}NNNN 尾注都没读到`)
  }

  const addedRecordPaths = [...addedBy.keys()].filter((p) => p.startsWith(RECORDS_PATH_PREFIX)).length
  return {
    ok: true,
    baseRef,
    baseSha,
    mergedPrs,
    addedBy,
    stats: { commits, mergedPrs: mergedPrs.size, dupFooters, addedPaths, addedRecordPaths },
  }
}

// 归属三态。塌成两态会把两种相反语义共用一个出口：
// NOT_IN_BASE（从未进过基线，例如本次变更集新写的记录、或改名后的旧路径）与
// NO_FOOTER（进了基线但那次提交没有可解析的尾注）。
function classifyAttribution(ledger, relPath) {
  if (!ledger || !ledger.addedBy || !ledger.addedBy.has(relPath)) {
    return { state: 'NOT_IN_BASE', pr: null, merged: false }
  }
  const pr = ledger.addedBy.get(relPath)
  if (pr === null || pr === undefined) return { state: 'NO_FOOTER', pr: null, merged: false }
  const merged = Boolean(ledger.mergedPrs && ledger.mergedPrs.has(pr))
  return { state: 'PR', pr, merged }
}

module.exports = { buildLedger, classifyAttribution, LEDGER_UNAVAILABLE, FOOTER_RE, RECORDS_PATH_PREFIX }

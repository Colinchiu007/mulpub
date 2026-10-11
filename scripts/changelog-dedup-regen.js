#!/usr/bin/env node
'use strict';
/*
 * changelog-dedup-regen.js — 从**当前 merge-base** 重新生成"清理后的 CHANGELOG + 一次性授权文件"
 *
 * 为什么需要它：授权通路要求 `applies_to_base` 等于本次 CI 实际用的 merge-base，而 main 每约 37 分钟
 * 前进一次、一轮 CI 要 25–30 分钟 ⇒ 清理 PR 必然会被 re-sync 撞上。如果"重算 sha 与两个期望数字"
 * 只存在于某个人的手工步骤里，下一个撞车的人就得在一份 4.8 万行删除的文件上手解冲突 —— 那正是
 * 当初造成这批副本的形态（拿陈旧 base 算"我的块"再 prepend）。所以重新生成必须是**一条可复跑的命令**。
 *
 * 做法（幂等，不做任何"对齐位置"的猜测）：
 *   1. 取 merge-base 的 CHANGELOG blob（原始字节，blob 域）；
 *   2. 从当前工作树的 CHANGELOG 里取出**本 PR 自己的那条条目**（按标题识别，标题在 base 里不存在）；
 *   3. 结果 = 我的条目 + dedupe(那条条目 + baseBlob)；
 *   4. 重写授权文件：applies_to_base = 本次 merge-base 的 sha，expected_* 由同一次计算得出。
 *
 * 用法：
 *   node scripts/changelog-dedup-regen.js --base=<merge-base sha> [--root=<dir>] [--dry-run]
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const entries = require('./changelog-entries.js')

const FILE = 'CHANGELOG.md'
const AUTH_PATH = 'scripts/changelog-dedup-authorization.json'

function parseArgs (argv) {
  const opts = { base: '', root: process.cwd(), dryRun: false }
  for (const a of argv) {
    if (a.startsWith('--base=')) opts.base = a.slice(7)
    else if (a.startsWith('--root=')) opts.root = a.slice(7)
    else if (a === '--dry-run') opts.dryRun = true
    else if (a.startsWith('--')) { console.error('unknown option: ' + a); process.exit(2) }
  }
  if (!/^[0-9a-f]{7,40}$/.test(opts.base)) {
    console.error('必须给 --base=<merge-base sha>（授权坐标系只认 sha，不认 ref 名）')
    process.exit(2)
  }
  return opts
}

function git (root, args) {
  return execFileSync('git', ['-C', root, ...args], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8')
}

function regenerate ({ root, base }) {
  const baseSha = git(root, ['rev-parse', base]).trim()
  if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new Error(`--base 解析不出 40 位 sha（实得 ${JSON.stringify(baseSha.slice(0, 60))}）`)
  const baseBlob = git(root, ['cat-file', 'blob', `${baseSha}:${FILE}`])
  const worktreeText = fs.readFileSync(path.join(root, FILE), 'utf8')

  const baseTitles = new Set(entries.splitEntries(baseBlob).blocks.map(entries.titleOf))
  const mine = entries.splitEntries(worktreeText).blocks.filter((b) => !baseTitles.has(entries.titleOf(b)))
  if (mine.length === 0) throw new Error('工作树里找不到"base 没有的条目" —— 无从确定本 PR 自己那条台账，拒绝生成')
  if (mine.length > 1) {
    throw new Error(`工作树里有 ${mine.length} 条 base 没有的条目，本工具只服务"一条自己的台账"的重生成：`
      + mine.map((b) => entries.titleOf(b).slice(0, 50)).join(' / '))
  }
  const myEntry = mine[0]

  const merged = entries.dedupe(myEntry + baseBlob)
  const a = entries.analyze(merged.text)
  if (a.redundant !== 0) throw new Error(`生成结果仍有 ${a.redundant} 份冗余，拒绝落盘`)
  const b2 = entries.dedupe(merged.text)
  if (b2.removed !== 0) throw new Error('生成结果不幂等，拒绝落盘')
  // 每条幸存块都必须能在 base∪我的条目里逐字节找到出处
  const sources = new Set([...entries.splitEntries(baseBlob).blocks, ...entries.splitEntries(myEntry + baseBlob).blocks])
  const orphan = entries.splitEntries(merged.text).blocks.filter((x) => !sources.has(x))
  if (orphan.length) throw new Error(`生成结果有 ${orphan.length} 块无出处，拒绝落盘：${entries.titleOf(orphan[0]).slice(0, 60)}`)

  const auth = {
    applies_to_base: baseSha,
    reason: '清理 re-sync 型解冲突造成的历史副本（canonical 口径实测冗余 ' + (a.entries ? (entries.analyze(baseBlob).redundant) : 0) + ' 份），见 issue #3037 与 openspec/changes/archive/2026-10-10-dedup-changelog-history/',
    owner_pr: 'branch:changelog-history-dedup (issue #3037)',
    expected_titles_reduced: entries.dedupe(myEntry + baseBlob).titlesReduced,
    expected_entries_after: a.entries,
  }
  return { text: merged.text, auth, base_sha: baseSha, stats: { base_entries: entries.analyze(baseBlob).entries, base_redundant: entries.analyze(baseBlob).redundant, after_entries: a.entries, after_distinct: a.distinct, titles_reduced: auth.expected_titles_reduced, lines: merged.text.split('\n').length, bytes: Buffer.byteLength(merged.text) } }
}

function main (argv) {
  const o = parseArgs(argv)
  let r
  try { r = regenerate({ root: o.root, base: o.base }) } catch (e) { console.error('[changelog-dedup-regen] FAIL：' + e.message); return 1 }
  if (o.dryRun) {
    console.log('[changelog-dedup-regen] dry-run（未写盘）' + JSON.stringify(r.stats))
    return 0
  }
  fs.writeFileSync(path.join(o.root, FILE), r.text, 'utf8')
  fs.writeFileSync(path.join(o.root, AUTH_PATH), JSON.stringify(r.auth, null, 2) + '\n', 'utf8')
  const back = fs.readFileSync(path.join(o.root, FILE), 'utf8')
  if (back !== r.text) { console.error('[changelog-dedup-regen] FAIL：写盘回读不一致'); return 1 }
  console.log('[changelog-dedup-regen] OK ' + JSON.stringify(Object.assign({ applies_to_base: r.base_sha }, r.stats)))
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { FILE, AUTH_PATH, regenerate, main }

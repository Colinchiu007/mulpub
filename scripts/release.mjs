#!/usr/bin/env node
// 一键发版：bump → 门禁自检 → 提交版本变更 + CHANGELOG → 打 tag → 提示推送。
// 注意：本脚本只做本地提交与打 tag，不自动推送（遵循仓库分支保护策略，推送走 PR 或直接 push 由你决定）。
//
// 用法：node scripts/release.mjs <patch|minor|major>
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const LEVEL = process.argv[2]
const VALID = new Set(['patch', 'minor', 'major'])
if (!VALID.has(LEVEL)) {
  console.error('用法: node scripts/release.mjs <patch|minor|major>')
  process.exit(1)
}

function run (cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
}
function readRootVersion () {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
}

const before = readRootVersion()
run(`node scripts/bump-version.mjs ${LEVEL}`)
const after = readRootVersion()
console.log(`\n📌 版本 ${before} -> ${after}（${LEVEL}）`)

console.log('\n🔍 运行 release-gate 自检（要求 CHANGELOG 已收口为 ## [v' + after + ']）...')
try {
  run(`node scripts/release-gate.mjs --tag v${after}`)
} catch {
  console.error(
    `\n❌ 发版自检未通过。最常见原因：CHANGELOG.md 顶部尚未把 "## [未发布]" 条目收口为 "## [v${after}] - <日期>"。\n` +
    `   请先完成 CHANGELOG 收口，再重新运行：pnpm version:release ${LEVEL}。`
  )
  process.exit(1)
}

const tag = `v${after}`
run(`git add package.json apps/desktop/package.json CHANGELOG.md`)
run(`git commit -m "chore(release): ${tag}"`)
run(`git tag -a ${tag} -m "${tag}"`)

console.log(`\n✅ 已创建提交与 tag ${tag}（版本变更 + CHANGELOG 已纳入本次提交）。`)
console.log('下一步：按仓库分支保护策略推送（可能需走 PR 或直接 push）：')
console.log(`  git push origin HEAD --tags`)
console.log(`  或仅推送 tag：git push origin ${tag}`)

#!/usr/bin/env node
// 发版门禁（release gate）—— 把「必须 bump + CHANGELOG 收口」做成强制机制。
//
// 用法：
//   node scripts/release-gate.mjs                  # 本地自检：CHANGELOG 含当前版本小节 + root/desktop 一致
//   node scripts/release-gate.mjs --tag vX.Y.Z     # CI/发版：额外要求 root package.json version === tag
//
// 退出码：0 通过；1 硬性失败（未 bump / CHANGELOG 未收口 / root 与 desktop 不一致）。
// 软警告：检测到破坏性变更标记但本次仅 patch 级时打印警告（不阻断，属人工判断）。
//
// 纯函数 runGate() 与 CLI 分离，便于 node --test 单测（见 release-gate.test.mjs）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const ROOT_PKG = path.join(ROOT, 'package.json')
const DESKTOP_PKG = path.join(ROOT, 'apps', 'desktop', 'package.json')
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md')

export function parseVersion (v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec((v || '').trim())
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], raw: `${m[1]}.${m[2]}.${m[3]}` }
}

// 比较两个版本，返回本次 bump 的级别（无 prev 时按 patch 处理）。
export function compareLevel (target, prev) {
  if (!prev) return 'patch'
  if (target.major > prev.major) return 'major'
  if (target.minor > prev.minor) return 'minor'
  if (target.patch > prev.patch) return 'patch'
  return 'patch'
}

// 纯函数：给定已读取的数据，返回门禁结果。不触碰文件系统，便于测试。
//   rootVersion:   根 package.json 的 version 字符串
//   desktopVersion: apps/desktop/package.json 的 version 字符串（可为 null）
//   changelog:     CHANGELOG.md 全文
//   tag:           tag 名（如 "v0.2.0"），本地自检时为 null
export function runGate ({ rootVersion, desktopVersion = null, changelog = '', tag = null }) {
  const errors = []
  const warnings = []

  const rootVer = parseVersion(rootVersion)
  if (!rootVer) errors.push(`根 package.json 的 version "${rootVersion}" 不是合法 semver`)

  let target = rootVer
  if (tag) {
    const tagVer = parseVersion(tag)
    if (!tagVer) {
      errors.push(`tag "${tag}" 不是合法的 vX.Y.Z 格式`)
    } else if (rootVer && tagVer.raw !== rootVer.raw) {
      errors.push(
        `版本号未更新：根 package.json 是 ${rootVer.raw}，但本次 tag 是 ${tagVer.raw}。` +
        `请先运行 pnpm version:bump <级别> 提交版本变更，再打 tag。`
      )
    }
    if (tagVer) target = tagVer
  }

  if (desktopVersion && rootVer) {
    const deskVer = parseVersion(desktopVersion)
    if (deskVer && deskVer.raw !== rootVer.raw) {
      errors.push(`root(${rootVer.raw}) 与 apps/desktop(${deskVer.raw}) 版本不一致，请先 pnpm version:sync`)
    }
  }

  if (rootVer) {
    const escaped = rootVer.raw.replace(/\./g, '\\.')
    const headingRe = new RegExp(`^#+\\s*\\[?v?${escaped}\\]?\\b`, 'm')
    if (!headingRe.test(changelog)) {
      errors.push(`CHANGELOG 未收口：缺少 "## [v${rootVer.raw}]" 小节。请先把顶部 "## [未发布]" 条目收口为该版本段落后再发版。`)
    }
  }

  // 软警告：破坏性变更标记 vs 本次级别（0.x 基线：破坏性应 bump minor，不得 patch）
  // 只扫描「目标版本小节」内部，避免被更早的 [未发布]/历史小节里的标记误触发。
  const breakingRe = /BREAKING\s*CHANGE:|破坏性变更|破坏性改动|breaking change/i
  if (target) {
    const lines = changelog.split(/\r?\n/)
    const escapedT = target.raw.replace(/\./g, '\\.')
    const targetHeadingRe = new RegExp(`^#+\\s*\\[?v?${escapedT}\\]?\\b`)
    const startIdx = lines.findIndex((l) => targetHeadingRe.test(l))
    if (startIdx !== -1) {
      let endIdx = lines.length
      // 仅以「下一条版本/未发布条目级标题」为小节边界；子标题（### BREAKING 等）计入本节内
      for (let i = startIdx + 1; i < lines.length; i++) {
        if (/^#+\s*(\[?v?\d+\.\d+\.\d+|未发布)/.test(lines[i])) { endIdx = i; break }
      }
      const sectionText = lines.slice(startIdx, endIdx).join('\n')
      if (breakingRe.test(sectionText)) {
        const released = [...changelog.matchAll(/^#+\s*\[?v?(\d+\.\d+\.\d+)\]?/gm)]
          .map((m) => m[1])
          .filter((v) => v !== target.raw)
        const prev = released.length ? parseVersion(released[0]) : null
        const level = compareLevel(target, prev)
        // 仅当能判定级别（存在上一版本）且本次为 patch 时才警告，避免无历史版本时误报
        if (prev && level === 'patch') {
          warnings.push(
            `检测到破坏性变更标记，但本次发布级别为 patch（${prev.raw} -> ${target.raw}）。` +
            `0.x 基线下破坏性变更应至少 bump minor（pnpm version:bump minor）。请人工确认版本级别与改动规模匹配。`
          )
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

function main () {
  const tagIdx = process.argv.indexOf('--tag')
  const tagArg = tagIdx !== -1 ? process.argv[tagIdx + 1] : undefined
  const tagEnv = process.env.GITHUB_REF_NAME || ''
  const tag = tagArg || (tagEnv.startsWith('v') ? tagEnv : '')

  let rootPkg
  try {
    rootPkg = JSON.parse(fs.readFileSync(ROOT_PKG, 'utf8'))
  } catch (e) {
    console.error(`❌ release-gate: 无法读取根 package.json: ${e.message}`)
    process.exit(1)
  }

  let desktopVersion = null
  try {
    desktopVersion = JSON.parse(fs.readFileSync(DESKTOP_PKG, 'utf8')).version
  } catch { /* desktop 缺失则跳过一致性检查 */ }

  let changelog = ''
  try {
    changelog = fs.readFileSync(CHANGELOG, 'utf8')
  } catch (e) {
    console.error(`❌ release-gate: 无法读取 CHANGELOG.md: ${e.message}`)
    process.exit(1)
  }

  const result = runGate({
    rootVersion: rootPkg.version,
    desktopVersion,
    changelog,
    tag: tag || null
  })

  for (const e of result.errors) console.error(`❌ release-gate: ${e}`)
  for (const w of result.warnings) console.warn(`⚠️  release-gate: ${w}`)

  if (result.ok) {
    const v = parseVersion(rootPkg.version)
    console.log(`✅ release-gate: v${v.raw} 通过（版本一致 + CHANGELOG 收口${desktopVersion ? ' + root/desktop 同步' : ''}）。`)
    process.exit(0)
  }
  process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()

export default { parseVersion, compareLevel, runGate }

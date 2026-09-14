#!/usr/bin/env node
// 版本号 bump：按级别更新根 package.json 的 version，并同步 apps/desktop。
// 用法：node scripts/bump-version.mjs <patch|minor|major>
//   - patch: Z+1
//   - minor: Y+1, Z=0
//   - major: 若当前 <1.0.0（0.x 约定）则 Y+1, Z=0；否则 X+1, Y=0, Z=0
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const LEVEL = process.argv[2]
const VALID = new Set(['patch', 'minor', 'major'])
if (!VALID.has(LEVEL)) {
  console.error('用法: node scripts/bump-version.mjs <patch|minor|major>')
  process.exit(1)
}

const ROOT_PKG = path.join(ROOT, 'package.json')
const DESKTOP_PKG = path.join(ROOT, 'apps', 'desktop', 'package.json')

function readVersion (file) {
  const text = fs.readFileSync(file, 'utf8')
  const m = text.match(/"version":\s*"([^"]*)"/)
  if (!m) throw new Error(`[bump-version] 未在 ${file} 中找到 "version" 字段`)
  return { text, version: m[1] }
}

function bump (v, level) {
  const [ma, mi, pa] = v.split('.').map((n) => parseInt(n, 10) || 0)
  let major = ma
  let minor = mi
  let patch = pa
  if (level === 'patch') {
    patch += 1
  } else if (level === 'minor') {
    minor += 1
    patch = 0
  } else {
    if (major === 0) {
      // 0.x 约定：破坏性变更只涨 minor
      minor += 1
      patch = 0
    } else {
      major += 1
      minor = 0
      patch = 0
    }
  }
  return `${major}.${minor}.${patch}`
}

function writeVersion (text, next) {
  return text.replace(/"version":\s*"[^"]*"/, `"version": "${next}"`)
}

const rootPkg = readVersion(ROOT_PKG)
const next = bump(rootPkg.version, LEVEL)
const desktopPkg = readVersion(DESKTOP_PKG)

fs.writeFileSync(ROOT_PKG, writeVersion(rootPkg.text, next))
fs.writeFileSync(DESKTOP_PKG, writeVersion(desktopPkg.text, next))
console.log(`[bump-version] ${rootPkg.version} -> ${next} (${LEVEL})`)

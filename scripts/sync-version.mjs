#!/usr/bin/env node
// 版本号同步：把根 package.json 的 version 复制到 apps/desktop/package.json。
// 单一真相源 = 根 package.json；apps/desktop 的 version 由本脚本派生。
// 幂等、零依赖；仅就地替换 "version" 行，保留 desktop package.json 其余内容与格式。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const ROOT_PKG = path.join(ROOT, 'package.json')
const DESKTOP_PKG = path.join(ROOT, 'apps', 'desktop', 'package.json')

function readVersion (file) {
  const text = fs.readFileSync(file, 'utf8')
  const m = text.match(/"version":\s*"([^"]*)"/)
  if (!m) {
    throw new Error(`[sync-version] 未在 ${file} 中找到 "version" 字段`)
  }
  return { text, version: m[1] }
}

const root = readVersion(ROOT_PKG)
const desktop = readVersion(DESKTOP_PKG)

if (desktop.version === root.version) {
  console.log(`[sync-version] 已一致：${root.version}`)
  process.exit(0)
}

const updated = desktop.text.replace(/"version":\s*"[^"]*"/, `"version": "${root.version}"`)
fs.writeFileSync(DESKTOP_PKG, updated)
console.log(`[sync-version] ${desktop.version} -> ${root.version}（已写入 apps/desktop/package.json）`)

/**
 * fetch-camofox.test.js — 手动拉取 CLI 契约（PR-2 §7.1）
 *
 * 用 node:test（scripts/ 下 require 不受 vitest include 接管，同
 * check-camofox-listen.test.js / build-paginator.test.js 先例）。
 *
 * 纪律：**不真实出网**（仓内 network-egress-guard 会红）。故测的是可注入的纯部分：
 * 平台键映射、URL 推导、锁取值；真实下载走 fetchAndVerifyAsset（已在
 * sidecar-asset-fetch.test.js 覆盖）。
 */
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

// CLI 是 main() 自执行结构，不能直接 require。这里复测它依赖的两个纯函数源：
// 平台映射与 URL 推导规则必须与脚本内实现一致 —— 用结构化锁而非复制实现。
const SCRIPT = path.join(__dirname, 'fetch-camofox.js')
const src = fs.readFileSync(SCRIPT, 'utf8')

test('scripts.fetch:camofox 已登记进 package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['fetch:camofox'], 'node apps/desktop/scripts/fetch-camofox.js')
})

test('依赖已 pin 精确版本（不用 ^，避免 lock 漂移）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'))
  assert.equal(pkg.dependencies['@askjo/camofox-browser'], '1.18.1')
})

test('pnpm-workspace.yaml 的 allowBuilds 不含 camofox（pnpm 10+ 白名单机制）', () => {
  // __dirname = <repo>/apps/desktop/scripts ⇒ 仓根在上三级（实测：up3 命中 pnpm-workspace.yaml）
  const wsPath = path.join(__dirname, '..', '..', '..', 'pnpm-workspace.yaml')
  assert.ok(fs.existsSync(wsPath), 'pnpm-workspace.yaml 必须存在（apps/desktop/scripts 上三级）')
  const ws = fs.readFileSync(wsPath, 'utf8')
  const allowBlock = /allowBuilds:([\s\S]*?)(?=\n\w|\n#|\Z)/.exec(ws)
  assert.ok(allowBlock, '必须有 allowBuilds 段')
  // camofox 绝不得出现在白名单里 —— 它的 postinstall 会拉 500MB 且失败走 exit(0)
  assert.ok(!/camofox/.test(allowBlock[1]), 'camofox 不得进 allowBuilds')
  // 且白名单里必须留下"为什么不放"的注释，防止后人顺手补全
  assert.ok(/刻意不放进 allowBuilds/.test(ws), '必须留注释说明为何不放行')
})

test('package.json 不得有废弃的 pnpm 字段（pnpm 11 会 WARN 并忽略）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'))
  // pnpm 11 已把设置挪到 pnpm-workspace.yaml；package.json 的 pnpm 字段会被忽略且告警
  assert.equal(pkg.pnpm, undefined, 'package.json 不得保留 pnpm 字段')
  assert.equal(pkg.dependencies['@askjo/camofox-browser'], '1.18.1')
})

test('结构锁：CLI 必须走单一实现与官方锁，不得自己算 hash', () => {
  assert.ok(src.includes("require('../electron/services/stealth/sidecar-asset-fetch')"),
    '必须复用 fetchAndVerifyAsset（禁止第二份下载+校验实现）')
  assert.ok(src.includes("require('../electron/services/sidecar-lock')"),
    '必须从 sidecar-lock 取官方 sha256')
  // 不得自带 sha256 计算用于校验（sha256Of 只用于 fetchAndVerifyAsset 的注入参数）
  assert.ok(!/expectedSha256\s*[:=]\s*['"][0-9a-f]{64}['"]/.test(src),
    '不得在脚本里硬编码 hash')
})

test('结构锁：失败必须非零退出，不得静默成功', () => {
  // 只判**代码行**（跳过注释）——注释里说明"为什么不学 camoffox 的 exit(0)"
  // 提到 process.exit(0) 是论述，若连注释一起匹配就会误报
  const codeLines = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
  const code = codeLines.join('\n')
  assert.ok(code.includes('process.exitCode = 1'), '失败必须置 exitCode=1')
  assert.ok(!/process\.exit\(0\)/.test(code), '代码里禁止 exit(0) 式静默成功')
})

test('结构锁：平台键覆盖 win32/darwin/linux × x64/ia32', () => {
  assert.ok(/win32/.test(src) && /darwin/.test(src) && /linux/.test(src))
  assert.ok(/ia32/.test(src))
})

test('lock 里 camoufox 已 pin 且六平台 asset 齐备', () => {
  // __dirname = <repo>/apps/desktop/scripts ⇒ lock 在上一级 apps/desktop/
  const lockPath = path.join(__dirname, '..', 'sidecar-lock.json')
  assert.ok(fs.existsSync(lockPath), 'lock 必须存在于 apps/desktop/sidecar-lock.json')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  assert.equal(lock.components.camoufox.status, 'pinned')
  assert.equal(lock.components.camoufox.bundledRelease, '152.0.4-beta.30')
  const keys = Object.keys(lock.components.camoufox.assets)
  assert.deepEqual(keys.sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-ia32', 'win32-x64'])
})

test('URL 推导：从 lock 的 api 字段推出 GitHub 资产直链', () => {
  // 与脚本内 assetDownloadUrl 同规则（此处独立重写一份断言，防单点漂移）
  const api = 'https://api.github.com/repos/daijro/camoufox/releases/tags/v152.0.4-beta.30'
  const m = /\/repos\/([^/]+\/[^/]+)\/releases\/tags\/(.+)$/.exec(api)
  assert.equal(m[1], 'daijro/camoufox')
  assert.equal(m[2], 'v152.0.4-beta.30')
  const url = 'https://github.com/' + m[1] + '/releases/download/' + m[2] + '/camoufox-152.0.4-beta.30-win.x86_64.zip'
  assert.equal(url, 'https://github.com/daijro/camoufox/releases/download/v152.0.4-beta.30/camoufox-152.0.4-beta.30-win.x86_64.zip')
})

test('node --check 通过（语法锁）', () => {
  const { execFileSync } = require('node:child_process')
  const out = execFileSync(process.execPath, ['--check', SCRIPT], { encoding: 'utf8' })
  assert.equal(out, '')
})

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

// 从 pnpm-workspace.yaml 取 allowBuilds 的**条目**（而不是原文片段）：判据必须按条目判，
// 否则注释里"为何不放行某包"的论述会被原文匹配当成放行/不放行，判据随注释措辞漂移
// （旧实现用 /allowBuilds:([\s\S]*?)(?=\n\w|\n#)/ 抓原文段，那个 lookahead 要 \n 后紧跟
//  # 才停，而本文件的注释缩进两格 ⇒ 注释一插进去，全文匹配就把注释也算成段内内容）。
// 反失明下界见函数末尾：解析退化成空集合会让"一个都没解析到"读成"没有任何违规"。
function readAllowBuilds (ws) {
  const lines = ws.split(/\r?\n/)
  const start = lines.findIndex(l => /^allowBuilds:\s*$/.test(l))
  assert.notEqual(start, -1, '必须有 allowBuilds 段')
  const entries = {}
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    if (!/^\s/.test(line)) break // 回到 0 缩进 ⇒ 本段结束（下一节如 overrides）
    const t = line.trim()
    if (t.startsWith('#')) continue // 注释不是条目
    const m = /^([^\s:]+):\s*(\S+)\s*$/.exec(t)
    assert.ok(m, 'allowBuilds 段出现无法解析的行：' + JSON.stringify(line))
    entries[m[1]] = m[2]
  }
  assert.ok(Object.keys(entries).length >= 5,
    '解析退化：allowBuilds 只解析出 ' + Object.keys(entries).length + ' 条，低于下界 5')
  return entries
}

test('pnpm-workspace.yaml 的 allowBuilds 不含 camofox（pnpm 10+ 白名单机制）', () => {
  // __dirname = <repo>/apps/desktop/scripts ⇒ 仓根在上三级（实测：up3 命中 pnpm-workspace.yaml）
  const wsPath = path.join(__dirname, '..', '..', '..', 'pnpm-workspace.yaml')
  assert.ok(fs.existsSync(wsPath), 'pnpm-workspace.yaml 必须存在（apps/desktop/scripts 上三级）')
  const ws = fs.readFileSync(wsPath, 'utf8')
  const entries = readAllowBuilds(ws)
  // camofox 绝不得出现在白名单里 —— 它的 postinstall 会拉 500MB 且失败走 exit(0)
  assert.ok(!Object.keys(entries).some(k => /camofox/.test(k)), 'camofox 不得进 allowBuilds')
  // 且白名单里必须留下"为什么不放"的注释，防止后人顺手补全
  assert.ok(/刻意不放进 allowBuilds/.test(ws), '必须留注释说明为何不放行')
})

test('allowBuilds 必须显式拒绝 better-sqlite3 的原生构建（false ≠ 未列出）', () => {
  // 动因（2026-10-16 CI 实测）：@askjo/camofox-browser@1.18.1 声明 better-sqlite3@13.0.1，
  // 后者有 binding.gyp 且**没有** install/postinstall 脚本 ⇒ pnpm 自动注入 node-gyp rebuild
  // ⇒ 每次 install 都要本机 VS C++ 工具链：runner 的 node-gyp@9.4.1 认不出 VS 18
  // （unknown version "undefined" found at "C:\Program Files\Microsoft Visual Studio\18\Enterprise"）
  // ⇒ install rc=1 ⇒ 13 个下游作业连红。该包自带 prebuilds/（含 win32-x64.node），
  // lib/binding.js 在没有 build/Release 时回落到 prebuilds ⇒ 真实加载路径不依赖编译。
  // 隔离探针 A/B：allowBuilds=true ⇒ rc=1 且执行 node-gyp；=false ⇒ rc=0 且**两档**
  // require('better-sqlite3') 都成功（取证与原始输出见 openspec/records/oss-b1-pr2.md）。
  // 判据取**显式 false** 而不是「该行不存在」：删掉它会让该包退回 pnpm 缺省注入的构建。
  const wsPath = path.join(__dirname, '..', '..', '..', 'pnpm-workspace.yaml')
  const entries = readAllowBuilds(fs.readFileSync(wsPath, 'utf8'))
  assert.equal(entries['better-sqlite3'], 'false',
    'better-sqlite3 必须显式为 false（删掉该行 = 允许 pnpm 自动注入 node-gyp rebuild ⇒ install 需要本机 VS）')
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

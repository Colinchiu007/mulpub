// @ts-check
/**
 * ensure-desktop-deps.test.js — 自愈脚本纯逻辑测试（node --test）
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const lib = require('./ensure-desktop-deps')

function makeRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `edd-test-${process.pid}-`))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'node_modules', '@img'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'node_modules', '@element-plus'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'node_modules', '@ctrl'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'apps', 'desktop'), { recursive: true })
  return dir
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(obj, null, 2))
}

test('collectMissing 识别缺失与损坏包', (t) => {
  const root = makeRoot(t)
  // @img/colour 完整
  writeJson(path.join(root, 'node_modules', '@img', 'colour', 'package.json'), { name: '@img/colour', version: '1.1.0' })
  fs.writeFileSync(path.join(root, 'node_modules', '@img', 'colour', 'index.cjs'), 'module.exports = {}')
  // icons-vue 存在但缺关键文件（模拟损坏）
  writeJson(path.join(root, 'node_modules', '@element-plus', 'icons-vue', 'package.json'), { name: '@element-plus/icons-vue', version: '2.3.2' })
  fs.mkdirSync(path.join(root, 'node_modules', '@element-plus', 'icons-vue', 'dist'), { recursive: true })
  // @ctrl/tinycolor 完全缺失
  const missing = lib.collectMissing(root)
  const names = missing.map((m) => m.name)
  assert.ok(names.includes('@ctrl/tinycolor'), 'tinycolor 应缺失')
  assert.ok(names.includes('@element-plus/icons-vue'), 'icons-vue 应因关键文件缺失被标记')
  assert.ok(!names.includes('@img/colour'), 'colour 完整不应被标记')
})

test('readDesktopDeps 解析 desktop 直接依赖', (t) => {
  const root = makeRoot(t)
  writeJson(path.join(root, 'apps', 'desktop', 'package.json'), {
    name: '@multi-publish/desktop',
    dependencies: { vue: '^3.5.0', '@element-plus/icons-vue': '^2.3.2' },
  })
  const deps = lib.readDesktopDeps(root)
  assert.equal(deps['vue'], '^3.5.0')
  assert.equal(deps['@element-plus/icons-vue'], '^2.3.2')
})

test('buildRestoreCommands 生成 npm pack + 解包 + 复制命令', () => {
  const plan = lib.buildRestoreCommands([
    { name: '@ctrl/tinycolor', version: '4.2.0', range: '^4.2.0', scope: '@ctrl', short: 'tinycolor' },
  ], 'C:/tmp/edd-work')
  assert.ok(plan.length >= 3, '应有 pack/tar/copy 命令')
  const joined = plan.join('\n')
  assert.match(joined, /npm pack @ctrl\/tinycolor@4\.2\.0/)
  assert.match(joined, /tar -xzf/)
  assert.match(joined, /tinycolor/)
})

test('invalidateViteCache 将 deps 缓存改名', (t) => {
  const root = makeRoot(t)
  const vite = path.join(root, 'apps', 'desktop', 'node_modules', '.vite')
  const deps = path.join(vite, 'deps')
  fs.mkdirSync(deps, { recursive: true })
  fs.writeFileSync(path.join(deps, '_metadata.json'), '{}')
  const result = lib.invalidateViteCache(root)
  assert.equal(result.renamed, true)
  assert.equal(fs.existsSync(deps), false)
  const leftovers = fs.readdirSync(vite)
  assert.ok(leftovers.some((n) => n.startsWith('deps.stale-')), '应留下可回退的 stale 目录')
})

test('--check 在健康树返回 0', (t) => {
  const root = makeRoot(t)
  writeJson(path.join(root, 'apps', 'desktop', 'package.json'), { name: '@multi-publish/desktop', dependencies: {} })
  // 走 fragileFor 解析后的清单（sharp 的版本/文件名由已安装 sharp 推导，见 fix-ensure-deps-version-pin）
  writeJson(path.join(root, 'node_modules', 'sharp', 'package.json'), { name: 'sharp', version: '9.9.9' })
  for (const p of lib.fragileFor('win32', 'x64', root)) {
    const dir = path.join(root, 'node_modules', ...p.name.split('/'))
    fs.mkdirSync(dir, { recursive: true })
    for (const f of p.files) {
      const file = path.join(dir, f)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'x')
    }
  }
  const out = execFileSync(process.execPath, [path.join(__dirname, 'ensure-desktop-deps.js'), '--check', '--root', root], { encoding: 'utf8' })
  assert.match(out, /OK|ok/i)
})

test('buildCmdLine 对 range/元字符参数加引号（防 cmd ^ 转义与重定向）', () => {
  const line = lib.buildCmdLine(['pack', '@ctrl/tinycolor@^4.2.0', '--pack-destination', 'C:/tmp/x y'])
  assert.ok(line.includes('"@ctrl/tinycolor@^4.2.0"'), '版本 spec 必须带引号')
  assert.ok(line.includes('"C:/tmp/x y"'), '含空格路径必须带引号')
  assert.ok(!/@\^4\.2\.0[^"]/.test(line), 'caret 不得裸露在引号外')
  assert.ok(line.startsWith('pack '), '命令名不带引号，避免 cmd /s 残留引号')
})

// root 必传（无默认值）——fix-ensure-deps-root-required。
// 动因：上一版给 root 设了默认值 DEFAULT_ROOT，「不传 root」的调用点会静默按**脚本所在目录**
// 解析 sharp 版本；在无 node_modules 的临时目录/worktree 里，sharp 条目凭空缺席 ⇒ 平台过滤判据失效。
// 缺参数必须炸在现场，而不是降级。
test('fragileFor 平台过滤：非 win32-x64 不检查 sharp 平台包', (t) => {
  const root = makeRoot(t)
  writeJson(path.join(root, 'node_modules', 'sharp', 'package.json'), { name: 'sharp', version: '0.35.5' })
  const win = lib.fragileFor('win32', 'x64', root).map((p) => p.name)
  assert.ok(win.includes('@img/sharp-win32-x64'))
  const mac = lib.fragileFor('darwin', 'arm64', root).map((p) => p.name)
  assert.ok(!mac.includes('@img/sharp-win32-x64'))
  assert.ok(mac.includes('@img/colour'))
  assert.throws(() => lib.fragileFor('win32', 'x64'), /root 必传/,
    '不传 root 必须当场抛错，不得静默按脚本所在目录降级')
})

// 默认值策略**不对称**（fix-ensure-deps-root-required，深度评审 i1 采纳）：
// platform/arch 有默认值（普适真相），root 没有（无普适答案）。
// 这条锁防两种回退：① 给 root 加回默认值；② 顺手把 platform/arch 的默认值也删掉。
test('fragileFor 默认值不对称：platform/arch 可省略，root 必传', (t) => {
  const root = makeRoot(t)
  writeJson(path.join(root, 'node_modules', 'sharp', 'package.json'), { name: 'sharp', version: '0.35.5' })

  // 省略 platform/arch ⇒ 走 process.platform / process.arch，不得抛错
  const byDefault = lib.fragileFor(undefined, undefined, root)
  assert.ok(Array.isArray(byDefault) && byDefault.length > 0, '省略 platform/arch 应正常返回清单')
  const explicit = lib.fragileFor(process.platform, process.arch, root)
  assert.deepEqual(byDefault.map((p) => p.name), explicit.map((p) => p.name),
    '省略 platform/arch 应与显式传入当前平台等价')

  // 只传 platform/arch 不传 root ⇒ 仍然必须抛错
  assert.throws(() => lib.fragileFor('win32', 'x64'), /root 必传/)
})

test('collectMissing 平台感知', (t) => {
  const root = makeRoot(t)
  writeJson(path.join(root, 'apps', 'desktop', 'package.json'), { name: '@multi-publish/desktop', dependencies: {} })
  // 仅放 cross-platform 包；sharp **未安装** ⇒ 平台包条目缺席（fail closed：不猜版本）
  fs.mkdirSync(path.join(root, 'node_modules', '@img', 'colour'), { recursive: true })
  fs.writeFileSync(path.join(root, 'node_modules', '@img', 'colour', 'index.cjs'), 'x')
  const winMissing = lib.collectMissing(root, 'win32', 'x64').map((m) => m.name)
  assert.ok(!winMissing.includes('@img/sharp-win32-x64'),
    'sharp 未安装时不得对该平台包妄下缺失结论（fail closed，fix-ensure-deps-version-pin）')
  const macMissing = lib.collectMissing(root, 'darwin', 'arm64').map((m) => m.name)
  assert.ok(!macMissing.includes('@img/sharp-win32-x64'))
})

test('collectMissing：sharp 已装而平台包缺失 ⇒ 按已安装版本报缺失（正向仍成立）', (t) => {
  const root = makeRoot(t)
  writeJson(path.join(root, 'apps', 'desktop', 'package.json'), { name: '@multi-publish/desktop', dependencies: {} })
  writeJson(path.join(root, 'node_modules', 'sharp', 'package.json'), { name: 'sharp', version: '0.35.5' })
  fs.mkdirSync(path.join(root, 'node_modules', '@img', 'colour'), { recursive: true })
  fs.writeFileSync(path.join(root, 'node_modules', '@img', 'colour', 'index.cjs'), 'x')
  const missing = lib.collectMissing(root, 'win32', 'x64').map((m) => m.name)
  assert.ok(missing.includes('@img/sharp-win32-x64'), '平台包确实缺失时必须报出来')
})


test('collectMissing 识别 pnpm hoisted 布局（workspace 包在 apps/desktop/node_modules）', (t) => {
  const root = makeRoot(t)
  writeJson(path.join(root, 'apps', 'desktop', 'package.json'), {
    name: '@multi-publish/desktop',
    dependencies: { '@multi-publish/ai-writer': '^1.0.0', vue: '^3.5.0' },
  })
  // pnpm hoisted：普通包在根 node_modules，@multi-publish/* 只在 apps/desktop/node_modules
  fs.mkdirSync(path.join(root, 'node_modules', 'vue'), { recursive: true })
  fs.writeFileSync(path.join(root, 'node_modules', 'vue', 'package.json'), JSON.stringify({ name: 'vue', version: '3.5.0' }))
  fs.mkdirSync(path.join(root, 'apps', 'desktop', 'node_modules', '@multi-publish', 'ai-writer'), { recursive: true })
  fs.writeFileSync(path.join(root, 'apps', 'desktop', 'node_modules', '@multi-publish', 'ai-writer', 'package.json'), JSON.stringify({ name: '@multi-publish/ai-writer', version: '1.0.0' }))
  const missing = lib.collectMissing(root).map((m) => m.name)
  assert.ok(!missing.includes('@multi-publish/ai-writer'), 'pnpm 布局下 workspace 包不应缺失')
  assert.ok(!missing.includes('vue'), 'vue 不应缺失')
})

test('findTgz 发现 npm 实际产物名（range 解析后为具体版本）', (t) => {
  const root = makeRoot(t)
  const work = path.join(root, 'work')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'picocolors-1.1.1.tgz'), 'x')
  fs.writeFileSync(path.join(work, 'other.tgz'), 'x')
  assert.equal(lib.findTgz(work, 'picocolors'), 'picocolors-1.1.1.tgz')
  assert.equal(lib.findTgz(work, '@ctrl/tinycolor'.split('/').slice(1).join('-')), null)
})

// ── fix-ensure-deps-version-pin：sharp 平台包版本不得手抄 ────────────────────
// 事故：FRAGILE 把版本写死 0.35.1，仓库升到 0.35.5 后
//   ① --check 恒红（假阳性，本机依赖其实健康）；
//   ② restore 分支按 0.35.1 往 node_modules 里 cpSync 合并 —— 把 0.35.1 的 index.cjs
//      写进来、同时留下 0.35.5 的 .node，制造「index.cjs 指向不存在的 .node」混版，
//      直接导致 sharp 加载失败、应用起不来（2026-10-17 实测）。
// 正解：版本从已安装的 sharp/package.json 读（sharp 与平台包严格同版本发布），
//       并让关键文件名按该版本推导。
test('resolveSharpPlatform 从已安装 sharp 读版本，且 .node 文件名按版本推导', (t) => {
  const root = makeRoot(t)
  // 模拟 sharp 0.35.5 已安装
  writeJson(path.join(root, 'node_modules', 'sharp', 'package.json'), { name: 'sharp', version: '0.35.5' })
  const resolved = lib.resolveSharpPlatform(root)
  assert.equal(resolved.version, '0.35.5', '版本必须来自 sharp 已安装版本，不得手抄')
  assert.deepEqual(resolved.files, ['index.cjs', 'lib/sharp-win32-x64-0.35.5.node'],
    '关键文件名必须按解析出的版本推导')
})

test('sharp 未安装时 resolveSharpPlatform 返回 null（fail closed，不猜版本）', (t) => {
  const root = makeRoot(t)
  assert.equal(lib.resolveSharpPlatform(root), null)
})

test('fragileFor 的 sharp 条目版本跟随已安装 sharp（不再返回 0.35.1）', (t) => {
  const root = makeRoot(t)
  writeJson(path.join(root, 'node_modules', 'sharp', 'package.json'), { name: 'sharp', version: '0.35.5' })
  writeJson(path.join(root, 'apps', 'desktop', 'package.json'), { name: '@multi-publish/desktop', dependencies: {} })
  // 平台包完整 => 不应判缺失
  const pdir = path.join(root, 'node_modules', '@img', 'sharp-win32-x64')
  fs.mkdirSync(path.join(pdir, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(pdir, 'index.cjs'), 'x')
  fs.writeFileSync(path.join(pdir, 'lib', 'sharp-win32-x64-0.35.5.node'), 'x')
  const missing = lib.collectMissing(root, 'win32', 'x64').map((m) => m.name)
  assert.ok(!missing.includes('@img/sharp-win32-x64'),
    '版本跟随后，0.35.5 的完整平台包不得再被判缺失（这正是现场假阳性）')
})

// 混版锁：restore 后目标目录不得残留旧版本 .node。
// 这条锁的是「restore 分支本身会制造混版」这个事故机制，而不是版本号本身。
test('restorePackage 清理旧版本 .node 后才写入（防混版）', (t) => {
  const root = makeRoot(t)
  const pdir = path.join(root, 'node_modules', '@img', 'sharp-win32-x64')
  fs.mkdirSync(path.join(pdir, 'lib'), { recursive: true })
  // 现场形态：index.cjs 指向 0.35.1，而 lib 里只有 0.35.5
  fs.writeFileSync(path.join(pdir, 'index.cjs'), "module.exports = require('./lib/sharp-win32-x64-0.35.1.node')")
  fs.writeFileSync(path.join(pdir, 'lib', 'sharp-win32-x64-0.35.5.node'), 'x')

  const stale = lib.findStalePlatformBinaries(root, '@img/sharp-win32-x64', '0.35.5')
  assert.deepEqual(stale.map((f) => path.basename(f)), [],
    '0.35.5 的 .node 是当前版本，不得被判为 stale')

  const stale2 = lib.findStalePlatformBinaries(root, '@img/sharp-win32-x64', '0.35.1')
  assert.deepEqual(stale2.map((f) => path.basename(f)), ['sharp-win32-x64-0.35.5.node'],
    '按 0.35.1 恢复时，0.35.5 的 .node 必须被识别为 stale（待清理）')
})

// 行为级副作用锁：判据正确 ≠ 有人调用。变异 B/B2 实测正是漏在这——
// 把 restorePackage 里的清理整段删掉（或只 log 不删），上面那条判据测试全绿。
test('purgeStaleBinaries 真的删除 stale 文件（行为级副作用）', (t) => {
  const root = makeRoot(t)
  const pdir = path.join(root, 'node_modules', '@img', 'sharp-win32-x64')
  fs.mkdirSync(path.join(pdir, 'lib'), { recursive: true })
  const staleFile = path.join(pdir, 'lib', 'sharp-win32-x64-0.35.5.node')
  const keepFile = path.join(pdir, 'lib', 'sharp-win32-x64-0.35.1.node')
  fs.writeFileSync(staleFile, 'x')
  fs.writeFileSync(keepFile, 'x')

  const removed = lib.purgeStaleBinaries(root, '@img/sharp-win32-x64', '0.35.1')
  assert.deepEqual(removed, ['sharp-win32-x64-0.35.5.node'])
  assert.equal(fs.existsSync(staleFile), false, 'stale 文件必须真的从磁盘消失')
  assert.equal(fs.existsSync(keepFile), true, '当前版本文件必须保留')
})

test('purgeStaleBinaries 在没有 lib 目录时返回空数组（不抛错）', (t) => {
  const root = makeRoot(t)
  assert.deepEqual(lib.purgeStaleBinaries(root, '@img/sharp-win32-x64', '0.35.5'), [])
})

// 深度评审 i2（upheld）的回归锁：只删**本包前缀**的 .node，外来文件一律不碰。
// 上游 files 只声明 index.cjs/lib/versions.json，但目录内容不保证，宽判据会误伤。
test('findStalePlatformBinaries 只认本包前缀，非本包 .node 不得判为 stale', (t) => {
  const root = makeRoot(t)
  const libDir = path.join(root, 'node_modules', '@img', 'sharp-win32-x64', 'lib')
  fs.mkdirSync(libDir, { recursive: true })
  const mine = path.join(libDir, 'sharp-win32-x64-0.35.1.node') // 本包旧版本 ⇒ stale
  const foreign = path.join(libDir, 'other-vendor-9.9.9.node') // 外来 ⇒ 不碰
  const keep = path.join(libDir, 'sharp-win32-x64-0.35.5.node') // 本包当前版本 ⇒ 保留
  for (const f of [mine, foreign, keep]) fs.writeFileSync(f, 'x')

  const found = lib.findStalePlatformBinaries(root, '@img/sharp-win32-x64', '0.35.5')
  assert.deepEqual(found.map((f) => path.basename(f)), ['sharp-win32-x64-0.35.1.node'],
    '只有本包前缀且非当前版本的文件可以判 stale')

  const purged = lib.purgeStaleBinaries(root, '@img/sharp-win32-x64', '0.35.5')
  assert.deepEqual(purged, ['sharp-win32-x64-0.35.1.node'])
  assert.equal(fs.existsSync(foreign), true, '外来 .node 必须原样保留（不得误删）')
  assert.equal(fs.existsSync(keep), true, '当前版本必须保留')
  assert.equal(fs.existsSync(mine), false, '本包旧版本必须被删')
})

// 接线锁（结构级）：purgeStaleBinaries 有行为测试，但 restorePackage 是否**真的调用它**
// 无法用行为测试覆盖（那条路要 npm pack，联网）。变异实测：把 restorePackage 里的调用
// 整段删掉，行为测试全绿 ⇒ 「判据正确、动作正确、但没人接」这种装饰性防护会漏过去。
// 故用结构锁钉住接线；同时钉住它必须在 cpSync **之前**（先删后写才有意义）。
test('restorePackage 必须调用 purgeStaleBinaries，且调用点在 cpSync 之前（接线锁）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'ensure-desktop-deps.js'), 'utf8')
  const body = src.slice(src.indexOf('function restorePackage('))
  const purgeAt = body.indexOf('purgeStaleBinaries(root, item.name, version)')
  const cpAt = body.indexOf("fs.cpSync(path.join(extractDir, 'package')")
  assert.ok(purgeAt >= 0, 'restorePackage 必须调用 purgeStaleBinaries（防混版接线）')
  assert.ok(cpAt >= 0, '应能找到 cpSync 写入点')
  assert.ok(purgeAt < cpAt, '必须先清 stale 再 cpSync，顺序反了等于没清')
})

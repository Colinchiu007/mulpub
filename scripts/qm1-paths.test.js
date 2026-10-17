/**
 * 回归锁：QM-1 打包验证脚本的路径解析（scripts/lib/qm1-paths.js）。
 *
 * 为什么值得一条锁：`scripts/qm1-scheduled-publish-verify.cjs` 自 #2985 起把
 * `path.resolve(__dirname)` 当成 apps/desktop —— 脚本住在仓库根 `scripts/`，于是它从
 * 引入起到 2026-10-17 一直在 `<repo>/scripts/dist-electron/...` 找产物，首步即失败。
 * 它没有 CI / 包脚本调用方，AGENTS.md 却把它写成「三层判据的脚本侧同源实现」，
 * 所以这个缺陷既不会被执行发现，也不会被评审看见。
 *
 * 本文件钉住三件事：
 *   ① 解析结果必须是 `<repo>/apps/desktop`（绝不是脚本所在目录）；
 *   ② 解析不依赖 cwd、也不依赖脚本在仓库内的深度；
 *   ③ 真机脚本必须**接线**到本模块（改回 `path.resolve(__dirname)` 当场红）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  resolveDesktopDir,
  artifactPaths,
  assertDesktopDir,
  DESKTOP_PACKAGE_NAME,
} = require('./lib/qm1-paths.js')

const SCRIPT_PATH = path.join(__dirname, 'qm1-scheduled-publish-verify.cjs')

/** 真实布局夹具：<root>/{package.json, pnpm-workspace.yaml, apps/desktop/package.json, scripts}。 */
function makeRepoFixture (options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-qm1-paths-'))
  const desktop = path.join(root, 'apps', 'desktop')
  const scripts = path.join(root, 'scripts')
  fs.mkdirSync(scripts, { recursive: true })
  // 仓库根标记：resolver 向上查找到此即停（防止越界命中父目录里的另一份 checkout）。
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'multi-publish', private: true }))
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
  if (options.desktop !== false) {
    fs.mkdirSync(desktop, { recursive: true })
    const name = options.packageName === undefined ? DESKTOP_PACKAGE_NAME : options.packageName
    fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ name }))
  }
  return { root, desktop, scripts }
}

test('resolveDesktopDir：脚本在 <repo>/scripts 时解析到 <repo>/apps/desktop（不是 scripts 自身）', (t) => {
  const fx = makeRepoFixture()
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }))
  const got = resolveDesktopDir(fx.scripts)
  assert.equal(got, fx.desktop)
  // 这条是本缺陷的形状：返回脚本目录会让「路径不对」伪装成「产物没打包」。
  assert.notEqual(got, fx.scripts, '绝不能退回脚本所在目录')
  assert.equal(path.basename(got), 'desktop')
})

test('resolveDesktopDir：脚本深度不敏感（<repo>/scripts/lib 也解析到同一目录）', (t) => {
  const fx = makeRepoFixture()
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }))
  const nested = path.join(fx.scripts, 'lib')
  fs.mkdirSync(nested, { recursive: true })
  assert.equal(resolveDesktopDir(nested), fx.desktop)
})

test('resolveDesktopDir：不依赖 cwd（从任意目录解析真实仓库脚本位置都得到同一结果）', (t) => {
  const realDesktop = resolveDesktopDir(__dirname)
  const before = process.cwd()
  t.after(() => process.chdir(before))
  process.chdir(os.tmpdir())
  assert.equal(resolveDesktopDir(__dirname), realDesktop)
  assert.equal(path.basename(realDesktop), 'desktop')
})

test('resolveDesktopDir：仓库根下缺 apps/desktop 时抛错（fail closed，不静默退回脚本目录）', (t) => {
  const fx = makeRepoFixture({ desktop: false })
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }))
  assert.throws(
    () => resolveDesktopDir(fx.scripts),
    (e) => /判定为仓库根/.test(e.message) && /fail closed/.test(e.message),
  )
})

test('resolveDesktopDir：不得越过本仓根去命中父目录里的另一份 checkout（外部评审 finding 3）', (t) => {
  // 外层 = 另一份完整的 Multi-Publish checkout；内层 = 本次 checkout 但 apps/desktop 缺失。
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-qm1-outer-'))
  t.after(() => fs.rmSync(outer, { recursive: true, force: true }))
  fs.mkdirSync(path.join(outer, 'apps', 'desktop'), { recursive: true })
  fs.writeFileSync(path.join(outer, 'apps', 'desktop', 'package.json'), JSON.stringify({ name: DESKTOP_PACKAGE_NAME }))
  fs.writeFileSync(path.join(outer, 'package.json'), JSON.stringify({ name: 'multi-publish', private: true }))
  fs.writeFileSync(path.join(outer, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
  const inner = path.join(outer, 'inner-checkout')
  fs.mkdirSync(path.join(inner, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(inner, 'package.json'), JSON.stringify({ name: 'multi-publish', private: true }))
  fs.writeFileSync(path.join(inner, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")

  assert.throws(
    () => resolveDesktopDir(path.join(inner, 'scripts')),
    (e) => /判定为仓库根/.test(e.message) && /不再向上越界/.test(e.message),
    '内层根缺 apps/desktop 时，绝不能返回外层 checkout 的 apps/desktop（那会把别人的产物树当成本仓的）',
  )
})

test('resolveDesktopDir：空值/非字符串入参抛 TypeError（不做隐式猜测）', () => {
  assert.throws(() => resolveDesktopDir(''), TypeError)
  assert.throws(() => resolveDesktopDir(undefined), TypeError)
})

test('artifactPaths：产物落在 <desktop>/dist-electron/win-unpacked 下', () => {
  const desktop = path.join(os.tmpdir(), 'mp-qm1-paths-artifacts', 'apps', 'desktop')
  const { asar, exe } = artifactPaths(desktop)
  assert.equal(path.relative(desktop, asar), path.join('dist-electron', 'win-unpacked', 'resources', 'app.asar'))
  assert.equal(path.relative(desktop, exe), path.join('dist-electron', 'win-unpacked', 'Multi-Publish.exe'))
})

test('assertDesktopDir：name 不符时报「不是桌面应用」，而不是让人去查产物', (t) => {
  const fx = makeRepoFixture({ packageName: 'some-other-app' })
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }))
  assert.throws(() => assertDesktopDir(fx.desktop), /不是桌面应用/)
})

test('真仓自证：本仓库 scripts 目录解析到真实 apps/desktop（package.json name 对得上）', () => {
  const desktop = assertDesktopDir(resolveDesktopDir(__dirname))
  assert.equal(path.basename(desktop), 'desktop')
  assert.equal(path.basename(path.dirname(desktop)), 'apps')
})

/**
 * 接线锁：真机脚本里 `DESKTOP` 的**每一处赋值**都必须是
 * `assertDesktopDir(resolveDesktopDir(__dirname))`。
 *
 * 为什么用「逐条赋值做正匹配」而不是「黑名单里找一行旧写法」：负向正则的宽度就是
 * 已知写法的枚举，`path.resolve(__dirname, '.')` / `path.join(__dirname)` /
 * `path.dirname(__filename)` 都能绕过同一个黑名单 —— 与本仓反复出现的「黑名单之外
 * 一律放行」同型。这里改成不变量：**除了那一句，任何别的右值都红**。
 *
 * 另：本测试**不剥注释**。上一版先剥注释再匹配，结果 `//` 剥除正则会吃掉字符串
 * 字面量里的 `//`（如 `'http://…'`）后把同行其余代码一并删掉，反而给负向断言开了
 * 一条假绿通道。改用「行首锚定 + 逐条赋值白名单」后，注释里的旧写法（以 `//` 开头）
 * 天然不会匹配 `^[ \t]*DESKTOP =`，无需剥注释。
 */
test('接线锁：DESKTOP 只能由 resolveDesktopDir(__dirname) 解析，产物路径只能由 artifactPaths 派生', () => {
  const script = fs.readFileSync(SCRIPT_PATH, 'utf8')
  assert.match(script, /require\(['"]\.\/lib\/qm1-paths\.js['"]\)/, '必须 require ./lib/qm1-paths.js')
  const assignments = [...script.matchAll(/^[ \t]*(?:const\s+|let\s+|var\s+)?DESKTOP\s*=\s*([^\n]*)$/gm)]
    .map((m) => m[1].trim())
  assert.ok(assignments.length > 0, '脚本里必须存在 DESKTOP 的赋值（找不到说明锁的取源失效了）')
  for (const rhs of assignments) {
    assert.equal(
      rhs,
      'assertDesktopDir(resolveDesktopDir(__dirname))',
      `DESKTOP 的赋值必须且只能是 assertDesktopDir(resolveDesktopDir(__dirname))，实测：${rhs}`,
    )
  }
  assert.match(script, /artifactPaths\(\s*DESKTOP\s*\)/, '产物路径必须经 artifactPaths(DESKTOP) 派生')
  assert.doesNotMatch(script, /process\.cwd\(\)/, '不得用 cwd 推导应用目录（换个目录运行就错，且同样不可单测）')
})

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

/** 真实布局夹具：<root>/{pnpm-workspace.yaml, apps/desktop/package.json, scripts}。 */
function makeRepoFixture (options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-qm1-paths-'))
  const desktop = path.join(root, 'apps', 'desktop')
  const scripts = path.join(root, 'scripts')
  fs.mkdirSync(scripts, { recursive: true })
  if (options.desktop !== false) {
    fs.mkdirSync(desktop, { recursive: true })
    const name = options.packageName === undefined ? DESKTOP_PACKAGE_NAME : options.packageName
    fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ name }))
  }
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
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

test('resolveDesktopDir：向上找不到 apps/desktop 时抛错（fail closed，不静默退回脚本目录）', (t) => {
  const fx = makeRepoFixture({ desktop: false })
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }))
  assert.throws(
    () => resolveDesktopDir(fx.scripts),
    (e) => /无法从/.test(e.message) && /不退回脚本所在目录/.test(e.message),
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
 * 只保留代码：剥掉行注释与块注释。
 *
 * 为什么必须剥：本锁的否定断言要找的正是「`const DESKTOP = path.resolve(__dirname)`」
 * 这一行，而脚本头部的**注释**会引用这行旧写法来解释缺陷（第一次实现就被自己的文档骗红）。
 * 与 `scripts/check-unwired-tests.js` 的「注释里的命令不算执行」同一条口径：
 * 结构锁只认代码，不认注释。
 *
 * 顺序很重要：**先剥行注释、再剥块注释**。反过来的话，行注释里出现的 `scripts/*.js`
 * 会提供一个假的 `/*` 起点，让块注释正则一路吞到文件末尾（实测把整份源码吃成两段）。
 */
function codeOnly (src) {
  return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

test('接线锁：真机脚本必须用 resolveDesktopDir(__dirname)，不得再把 __dirname 直接当 DESKTOP', () => {
  const script = codeOnly(fs.readFileSync(SCRIPT_PATH, 'utf8'))
  assert.match(script, /require\(['"]\.\/lib\/qm1-paths\.js['"]\)/, '必须 require ./lib/qm1-paths.js')
  assert.match(script, /resolveDesktopDir\(\s*__dirname\s*\)/, 'DESKTOP 必须经 resolveDesktopDir(__dirname) 解析')
  assert.match(script, /artifactPaths\(\s*DESKTOP\s*\)/, '产物路径必须经 artifactPaths(DESKTOP) 派生')
  // 本缺陷的原写法：脚本目录 = 应用目录。这一行改回来即红。
  assert.doesNotMatch(
    script,
    /const\s+DESKTOP\s*=\s*path\.resolve\(\s*__dirname\s*\)/,
    '不得把 path.resolve(__dirname) 当作 apps/desktop（#2985 的原缺陷）',
  )
  assert.doesNotMatch(
    script,
    /path\.resolve\(\s*process\.cwd\(\)\s*\)/,
    '也不得改用 cwd 推导应用目录（换个目录运行就错，且同样不可单测）',
  )
})

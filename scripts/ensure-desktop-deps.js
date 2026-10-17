// @ts-check
/**
 * ensure-desktop-deps.js — 桌面开发启动依赖自检/自愈工具（零依赖，Node >= 20）
 *
 * 用途：
 *   - 校验关键原生/平台依赖（sharp 平台包、@img/colour、@element-plus/icons-vue、
 *     @ctrl/tinycolor）与 apps/desktop 的全部直接依赖是否完整；
 *   - 缺失时用 `npm pack` 旁路补装（绕过被 ETARGET 阻塞的整树 npm install），
 *     不修改 package.json / package-lock.json；
 *   - 失效陈旧的 Vite optimize 缓存（apps/desktop/node_modules/.vite/deps），
 *     避免 `504 (Outdated Optimize Dep)` 空白页。
 *
 * 用法：
 *   node scripts/ensure-desktop-deps.js --check                  # 只检查，缺失返回非零
 *   node scripts/ensure-desktop-deps.js --restore                # 检查 + 旁路补装（默认）
 *   node scripts/ensure-desktop-deps.js --invalidate-vite-cache  # 失效 Vite 缓存
 *   node scripts/ensure-desktop-deps.js --json --root <repo>     # JSON 输出（工具/测试）
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const SCRIPT_DIR = __dirname
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..')

/**
 * 脆弱依赖清单：平台包必须带关键文件校验。
 *
 * ⚠️ sharp 平台包的**版本与关键文件名一律不得在此手抄**（fix-ensure-deps-version-pin，2026-10-17）：
 * 曾写死 `version: '0.35.1'` + `lib/sharp-win32-x64-0.35.1.node`，仓库升到 0.35.5 后：
 *   ① `--check` 恒报缺失（假阳性——本机依赖其实健康，纯噪音）；
 *   ② 更糟：restore 分支按 0.35.1 往 node_modules 里 cpSync **合并**，把 0.35.1 的
 *      index.cjs 写进来却留下 0.35.5 的 .node ⇒ 「index.cjs 指向不存在的文件」混版，
 *      直接导致 `Could not load the "sharp" module`、应用起不来（本机实测复现）。
 * 正解：版本从**已安装的 sharp/package.json** 读（npm 发布模型里 sharp 与平台包严格同版本，
 * 已实测：sharp 0.35.5 ↔ @img/sharp-win32-x64 0.35.5），关键文件名按该版本推导。
 * sharp 未安装时该条目**缺席**（fail closed：不猜版本、不伪造文件名）。
 */
const FRAGILE = [
  { name: '@img/sharp-win32-x64', dynamic: 'sharp', files: null, platformArch: 'win32-x64' },
  { name: '@img/colour', version: '1.1.0', files: ['index.cjs'] },
  { name: '@element-plus/icons-vue', version: '2.3.2', files: ['dist/index.js'] },
  { name: '@ctrl/tinycolor', version: '4.2.0', files: ['dist/public_api.js'] },
]

/**
 * 从已安装的 sharp/package.json 解析平台包的版本与关键文件清单。
 * @param {string} root 仓库根
 * @returns {{version: string, files: string[]}|null} sharp 未安装或版本不可解析 ⇒ null
 */
function resolveSharpPlatform(root) {
  const pkgPath = path.join(root, 'node_modules', 'sharp', 'package.json')
  if (!fs.existsSync(pkgPath)) return null
  let version
  try {
    version = readJson(pkgPath).version
  } catch { return null }
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) return null
  return {
    version,
    files: ['index.cjs', `lib/sharp-win32-x64-${version}.node`],
  }
}

/** 平台相关清单：sharp 平台包只在本平台/架构上校验，避免 mac/linux 误报 */
function fragileFor(platform = process.platform, arch = process.arch, root = DEFAULT_ROOT) {
  const tag = `${platform}-${arch}`
  const list = []
  for (const p of FRAGILE) {
    if (p.platformArch && p.platformArch !== tag) continue
    if (p.dynamic === 'sharp') {
      const resolved = resolveSharpPlatform(root)
      if (!resolved) continue // sharp 未安装：本条缺席，不猜版本
      list.push({ name: p.name, version: resolved.version, files: resolved.files })
      continue
    }
    list.push(p)
  }
  return list
}

/**
 * 列出目标目录下**不属于当前版本**的平台二进制（混版残留）。
 * restore 走 cpSync 合并而非替换，旧版本 .node 会被留下来 ⇒ 必须先删再写。
 *
 * 只删 basename 以本包短名开头的 .node（`<short>-<version>.node`）。这是必要的收窄：
 * lib/ 私有目录理论上可能出现非本包的 .node（上游 files 只声明 index.cjs/lib/versions.json，
 * 但目录内容不保证），一律按「不匹配当前版本」删会误伤外来文件。
 * @param {string} root 仓库根
 * @param {string} name 平台包名
 * @param {string} version 当前（要恢复成的）版本
 * @returns {string[]} 待清理的绝对路径
 */
function findStalePlatformBinaries(root, name, version) {
  const libDir = path.join(nodeModulesPath(root, name), 'lib')
  let entries = []
  try { entries = fs.readdirSync(libDir) } catch { return [] }
  const short = name.split('/')[1]
  const prefix = `${short}-`
  const keep = `${prefix}${version}.node`
  return entries
    .filter((f) => f.endsWith('.node') && f.startsWith(prefix) && f !== keep)
    .map((f) => path.join(libDir, f))
}

/**
 * 删除混版残留的平台二进制，返回被删文件名（可断言副作用）。
 * 与 findStalePlatformBinaries 分开：前者是判据，本函数是动作，测试必须分别验证
 * ——只测判据不测动作，就会漏掉「判据正确但没人调用」这种装饰性防护。
 */
function purgeStaleBinaries(root, name, version) {
  return findStalePlatformBinaries(root, name, version).map((f) => {
    fs.rmSync(f, { force: true })
    return path.basename(f)
  })
}

function splitName(name) {
  const parts = name.split('/')
  return parts.length === 2 ? { scope: parts[0], short: parts[1] } : { scope: null, short: parts[0] }
}

function nodeModulesPath(root, name) {
  return path.join(root, 'node_modules', ...name.split('/'))
}

function isInstalled(root, name, files) {
  // npm/hoisted 布局在根 node_modules；pnpm hoisted 下 workspace 包落在 apps/desktop/node_modules
  const candidates = [
    nodeModulesPath(root, name),
    path.join(root, 'apps', 'desktop', 'node_modules', ...name.split('/')),
  ]
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue
    if (!files || files.length === 0) return true
    if (files.every((f) => fs.existsSync(path.join(dir, f)))) return true
  }
  return false
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** 解析 apps/desktop 的直接依赖声明 */
function readDesktopDeps(root) {
  const desktopPkg = path.join(root, 'apps', 'desktop', 'package.json')
  if (!fs.existsSync(desktopPkg)) return {}
  const pkg = readJson(desktopPkg)
  return Object.assign({}, pkg.dependencies)
}

/** 返回缺失/损坏包清单 [{ name, version, range }]；FRAGILE 优先（精确版本）并去重 */
function collectMissing(root, platform = process.platform, arch = process.arch) {
  const seen = new Set()
  const missing = []
  const push = (name, version, range, files) => {
    if (seen.has(name)) return
    seen.add(name)
    if (!isInstalled(root, name, files)) {
      missing.push({ name, version, range })
    }
  }
  for (const p of fragileFor(platform, arch, root)) push(p.name, p.version, p.version, p.files)
  const deps = readDesktopDeps(root)
  for (const [name, range] of Object.entries(deps)) push(name, null, range, [])
  return missing
}

function tgzPrefix(name) {
  const { scope, short } = splitName(name)
  return scope ? scope.slice(1) + '-' + short : short
}

function tgzFileName(name, version) {
  return `${tgzPrefix(name)}-${version}.tgz`
}

/** npm pack 对 range 解析后产物名是具体版本（如 picocolors-1.1.1.tgz），按前缀从 workDir 发现实际文件 */
function findTgz(workDir, prefix) {
  let files = []
  try { files = fs.readdirSync(workDir) } catch { return null }
  const tgz = files.filter((f) => f.startsWith(prefix) && f.endsWith('.tgz'))
  if (tgz.length === 0) return null
  return tgz.map((f) => ({ f, m: fs.statSync(path.join(workDir, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0].f
}

/** 构造恢复步骤（字符串形式，供测试/文档；执行走 restorePackage 的结构化命令） */
function buildRestoreCommands(plan, workDir) {
  const commands = []
  for (const item of plan) {
    const version = item.version || item.range
    const tgz = tgzFileName(item.name, version)
    commands.push(`npm pack ${item.name}@${version} --pack-destination ${workDir}`)
    commands.push(`tar -xzf ${path.join(workDir, tgz)} -C ${path.join(workDir, 'extract')}`)
    commands.push(`copy ${path.join(workDir, 'extract', 'package')} -> ${nodeModulesPath(DEFAULT_ROOT, item.name)}`)
  }
  return commands
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}

function runError(result) {
  if (result.error) return result.error.message
  const text = (result.stderr || '').trim() || (result.stdout || '').trim()
  return text || `exit ${result.status}`
}

/**
 * Windows 上 .cmd 不能直接 spawnSync（EINVAL），统一走 cmd /c。
 * cmd 元字符（^ < > & |）在双引号内按字面处理，因此所有参数一律加引号，
 * 避免 `^4.0.484` 的 ^ 被吃掉、`>=1.0.0` 变成重定向（杂散文件）。
 */
function buildCmdLine(args) {
  return args.map((a) => (/[\s"^<>&|()]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(' ')
}

let _npmCli = null

/** 解析 npm-cli.js（node 直跑，绕开 Windows cmd 引号/元字符问题）；解析失败返回 null 走 fallback */
function resolveNpmCli() {
  if (_npmCli) return _npmCli
  if (process.platform !== 'win32') return null
  const found = run('where.exe', ['npm.cmd'])
  if (found.status !== 0) return null
  const line = (found.stdout || '').trim().split(/\r?\n/)[0]
  if (!line) return null
  const candidate = path.join(path.dirname(line), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (fs.existsSync(candidate)) _npmCli = candidate
  return _npmCli
}

function runNpm(args) {
  if (process.platform === 'win32') {
    const cli = resolveNpmCli()
    if (cli) return run(process.execPath, [cli, ...args])
    return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${buildCmdLine(args)}`])
  }
  return run('npm', args)
}

/** 用 npm pack 旁路补装单个缺失包；返回 { ok, log } */
function restorePackage(root, item, workDir) {
  const version = item.version || item.range
  const tgz = tgzFileName(item.name, version)
  const log = []

  const pack = runNpm(['pack', `${item.name}@${version}`, '--pack-destination', workDir])
  if (pack.status !== 0) return { ok: false, log: [...log, `npm pack failed: ${runError(pack)}`] }
  const actualTgz = findTgz(workDir, tgzPrefix(item.name))
  if (!actualTgz) return { ok: false, log: [...log, `npm pack 完成但未找到 tgz（前缀 ${tgzPrefix(item.name)}）`] }
  log.push(`packed ${actualTgz}`)

  const extractDir = path.join(workDir, `extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  fs.mkdirSync(extractDir, { recursive: true })
  const untar = run('tar', ['-xzf', path.join(workDir, actualTgz), '-C', extractDir])
  if (untar.status !== 0) return { ok: false, log: [...log, `tar extract failed: ${runError(untar)}`] }
  log.push(`extracted to ${extractDir}`)

  const target = nodeModulesPath(root, item.name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  // 混版防护（fix-ensure-deps-version-pin）：cpSync 是**合并**而非替换，旧版本平台二进制
  // （如 0.35.5 的 .node）会被留下来，与新版 index.cjs 构成「指向不存在文件」的混版。
  // 先删 stale 再写，恢复动作才不会自己制造故障。
  for (const removed of purgeStaleBinaries(root, item.name, version)) {
    log.push(`removed stale binary ${removed}`)
  }
  fs.cpSync(path.join(extractDir, 'package'), target, { recursive: true, force: true })
  log.push(`restored ${item.name} -> ${target}`)

  const files = fragileFor(process.platform, process.arch, root).find((f) => f.name === item.name)
  if (files && files.files.length > 0 && !isInstalled(root, item.name, files.files)) {
    return { ok: false, log: [...log, `restored but key files still missing: ${files.files.join(', ')}`] }
  }
  return { ok: true, log }
}

/** 失效 Vite optimize 缓存（改名保留可回退） */
function invalidateViteCache(root) {
  const deps = path.join(root, 'apps', 'desktop', 'node_modules', '.vite', 'deps')
  if (!fs.existsSync(deps)) return { renamed: false, oldPath: deps }
  const newPath = `${deps}.stale-${new Date().toISOString().replace(/[:.]/g, '-')}`
  fs.renameSync(deps, newPath)
  return { renamed: true, oldPath: deps, newPath }
}

function main(argv) {
  const args = argv.slice(2)
  const opt = { root: DEFAULT_ROOT, json: false, checkOnly: false, invalidate: false }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--check') opt.checkOnly = true
    else if (a === '--restore') opt.checkOnly = false
    else if (a === '--invalidate-vite-cache') opt.invalidate = true
    else if (a === '--json') opt.json = true
    else if (a === '--root') opt.root = path.resolve(args[++i])
  }

  const root = opt.root
  const report = { root, checkedAt: new Date().toISOString(), missing: [] }
  if (opt.invalidate) report.viteCache = invalidateViteCache(root)

  const missing = collectMissing(root)
  report.missing = missing

  let exitCode = 0
  let workDir = null
  if (!opt.checkOnly && missing.length > 0) {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edd-restore-'))
    const results = missing.map((item) => {
      const r = restorePackage(root, item, workDir)
      report.restore = report.restore || []
      report.restore.push({ name: item.name, ok: r.ok, log: r.log })
      return r.ok
    })
    if (results.some((ok) => !ok)) exitCode = 1
    const still = collectMissing(root)
    report.stillMissing = still
    if (still.length > 0) exitCode = 1
  } else if (missing.length > 0) {
    exitCode = 1
  }

  if (workDir) {
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* 清理失败不阻断 */ }
  }

  if (opt.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    console.log(`repo: ${root}`)
    console.log(`missing: ${missing.length}${missing.length ? ' -> ' + missing.map((m) => m.name).join(', ') : ''}`)
    if (report.restore) {
      for (const r of report.restore) console.log(`  [${r.ok ? 'OK' : 'FAIL'}] ${r.name}`)
    }
    if (report.viteCache) console.log(`vite cache: ${report.viteCache.renamed ? 'invalidated -> ' + report.viteCache.newPath : 'nothing to invalidate'}`)
    console.log(exitCode === 0 ? 'DESKTOP_DEPS_OK' : 'DESKTOP_DEPS_MISSING')
  }
  process.exit(exitCode)
}

module.exports = {
  FRAGILE,
  fragileFor,
  resolveSharpPlatform,
  findStalePlatformBinaries,
  purgeStaleBinaries,
  splitName,
  nodeModulesPath,
  isInstalled,
  readJson,
  readDesktopDeps,
  collectMissing,
  tgzFileName,
  tgzPrefix,
  findTgz,
  buildRestoreCommands,
  buildCmdLine,
  invalidateViteCache,
  DEFAULT_ROOT,
}

if (require.main === module) {
  main(process.argv)
}






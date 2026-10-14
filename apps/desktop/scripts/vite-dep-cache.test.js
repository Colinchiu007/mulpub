// @ts-check
/**
 * vite-dep-cache.test.js — Vite optimizeDeps 预构建缓存过期检测回归保护（node --test）
 *
 * 背景（2026-10-13 事故）：`packages/shared-utils/src/platform-definitions` 新增导出
 * `PLATFORM_CREATOR_HOME_URLS`（commit dbe8e0fa2）后，mp-app-live2 worktree 的
 * `apps/desktop/node_modules/.vite/deps` 缓存仍生成于 10-11 —— linked workspace 包的
 * 源码变化不会触发 optimizeDeps 重建，渲染层 import 新名字即报
 * “does not provide an export named 'X'”（真实症状：/accounts 页面白屏报错页）。
 * dev server 在源码之后重启也没用：缓存指纹只含 lockfile + config，不含 workspace 源码。
 *
 * 本模块把「判 stale → 清 .vite」做成 spawn vite 前的机械预检（dev.js 唯一收口点），
 * 这些用例钉住：判据方向（双向：切新/切旧提交都算 stale）、相等边界、不清洗 src 之外
 * 的目录、解析退化不能恒 fresh（反失明下界）、真实 fs 往返、日志 fail-loud。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  checkViteDepCacheStaleness,
  ensureFreshViteDepCache,
  collectWorkspaceSourceRoots,
  VITE_CACHE_DIR_REL,
} = require('./vite-dep-cache')

const REAL_REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

// ─── 假 fs：与真实 fs 同形（readdirSync(withFileTypes) + statSync + rmSync）───
// 关键纪律：mock 必须按输入区分。本案判据恰是「同一假 fs 喂两个不同 mtime」，
// 对所有输入返回同一数据的夹具对这类缺陷结构性免疫。

function fakeFs({ files = [], dirs = [] }) {
  const fileMap = new Map(files.map(([p, ms]) => [p, ms]))
  const dirSet = new Set(dirs)
  // 真实 fs 的语义：注册一个深层路径时其中间层目录必然存在。假 fs 必须同样补齐祖先，
  // 否则「忘了登记包目录」会让 readdir(packages) 空转——夹具对「按输入区分」的判据
  // 结构性失明，正是本项目反复强调的 mock 陷阱（本案自己踩了一次）。
  const ancestors = (p) => {
    let cur = path.dirname(p)
    while (cur && cur !== path.parse(cur).root) {
      dirSet.add(cur)
      cur = path.dirname(cur)
    }
  }
  for (const p of fileMap.keys()) ancestors(p)
  for (const d of [...dirSet]) ancestors(d)
  const removed = []
  return {
    removed,
    existsSync(p) {
      return fileMap.has(p) || dirSet.has(p)
    },
    statSync(p) {
      if (fileMap.has(p)) {
        return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, mtimeMs: fileMap.get(p) }
      }
      if (dirSet.has(p)) {
        return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, mtimeMs: 0 }
      }
      const err = new Error('ENOENT: ' + p)
      err.code = 'ENOENT'
      throw err
    },
    readdirSync(p, opts) {
      if (!dirSet.has(p)) {
        const err = new Error('ENOENT: ' + p)
        err.code = 'ENOENT'
        throw err
      }
      const names = new Set()
      for (const f of fileMap.keys()) if (f.startsWith(p + path.sep) && f.slice(p.length + 1).indexOf(path.sep) === -1) names.add(path.basename(f))
      for (const d of dirSet) if (d.startsWith(p + path.sep) && d.slice(p.length + 1).indexOf(path.sep) === -1) names.add(path.basename(d))
      const out = [...names].map((name) => {
        const full = path.join(p, name)
        const isDir = dirSet.has(full)
        const isLink = false
        const isFile = fileMap.has(full)
        return {
          name,
          isDirectory: () => isDir,
          isFile: () => isFile,
          isSymbolicLink: () => isLink,
        }
      })
      return opts && opts.withFileTypes ? out : out.map((e) => e.name)
    },
    rmSync(p, opts) {
      removed.push(p)
    },
  }
}

/** 常见目录布局：<repo>/packages/<pkg>/src/*.js + <repo>/apps/desktop/node_modules/.vite/deps/*.js */
function layoutRoot(repo) {
  return {
    packagesDir: path.join(repo, 'packages'),
    desktopDir: path.join(repo, 'apps', 'desktop'),
    viteDir: path.join(repo, 'apps', 'desktop', 'node_modules', '.vite'),
    depsDir: path.join(repo, 'apps', 'desktop', 'node_modules', '.vite', 'deps'),
  }
}

// ─── 判据方向（双向）───

test('cache 新于所有 source → fresh，不清除', () => {
  const repo = '/repo'
  const { depsDir, viteDir, packagesDir } = layoutRoot(repo)
  const sharedSrc = path.join(packagesDir, 'shared-utils', 'src')
  const fsImpl = fakeFs({
    dirs: [viteDir, depsDir, packagesDir, sharedSrc],
    files: [
      [path.join(depsDir, '@multi-publish_shared-utils_src_platform-definitions.js'), 2000],
      [path.join(sharedSrc, 'platform-definitions.js'), 1000],
    ],
  })
  const r = checkViteDepCacheStaleness(repo, fsImpl)
  assert.equal(r.state, 'fresh')
  assert.equal(fsImpl.removed.length, 0)
})

test('source 新于 cache → stale（事故形态：checkout 新提交后缓存未重建）', () => {
  const repo = '/repo'
  const { depsDir, viteDir, packagesDir } = layoutRoot(repo)
  const sharedSrc = path.join(packagesDir, 'shared-utils', 'src')
  const fsImpl = fakeFs({
    dirs: [viteDir, depsDir, packagesDir, sharedSrc],
    files: [
      [path.join(depsDir, '@multi-publish_shared-utils_src_platform-definitions.js'), 1000],
      [path.join(sharedSrc, 'platform-definitions.js'), 5000],
    ],
  })
  const r = checkViteDepCacheStaleness(repo, fsImpl)
  assert.equal(r.state, 'stale')
  assert.equal(r.cacheMs, 1000)
  assert.equal(r.sourceMs, 5000)
  assert.ok(r.newestSourceRoot.endsWith(path.join('shared-utils', 'src')), '应点名 newest 的 source 根')
})

test('切到更旧提交也算 stale（回滚/分支跳转：commit 时间判据会漏判，mtime 不会）', () => {
  const repo = '/repo'
  const { depsDir, viteDir, packagesDir } = layoutRoot(repo)
  const sharedSrc = path.join(packagesDir, 'shared-utils', 'src')
  // cache 是"今天 10:00 从 commit A 构建"，source 被 checkout 刷成"今天 12:00 的 commit B（B 比 A 旧）"
  const fsImpl = fakeFs({
    dirs: [viteDir, depsDir, packagesDir, sharedSrc],
    files: [
      [path.join(depsDir, 'dep.js'), 1000],
      [path.join(sharedSrc, 'platform-definitions.js'), 2000],
    ],
  })
  assert.equal(checkViteDepCacheStaleness(repo, fsImpl).state, 'stale')
})

test('sourceMs 与 cacheMs 相等 → fresh（严格大于才 stale，避免浮点/同秒抖动误删）', () => {
  const repo = '/repo'
  const { depsDir, viteDir, packagesDir } = layoutRoot(repo)
  const sharedSrc = path.join(packagesDir, 'shared-utils', 'src')
  const fsImpl = fakeFs({
    dirs: [viteDir, depsDir, packagesDir, sharedSrc],
    files: [
      [path.join(depsDir, 'dep.js'), 2000],
      [path.join(sharedSrc, 'platform-definitions.js'), 2000],
    ],
  })
  assert.equal(checkViteDepCacheStaleness(repo, fsImpl).state, 'fresh')
  assert.equal(fsImpl.removed.length, 0)
})

// ─── absent / 退化防护 ──

test('.vite/deps 不存在 → absent，不清除（vite 首次启动本就会 optimize）', () => {
  const repo = '/repo'
  const { packagesDir } = layoutRoot(repo)
  const fsImpl = fakeFs({ dirs: [packagesDir], files: [] })
  const r = checkViteDepCacheStaleness(repo, fsImpl)
  assert.equal(r.state, 'absent')
  assert.equal(r.cacheMs, 0)
  assert.equal(fsImpl.removed.length, 0)
})

test('packages 目录不存在 → 不误判 stale（解析退化不得把每次启动都变成冷优化）', () => {
  const repo = '/repo'
  const { depsDir, viteDir } = layoutRoot(repo)
  const fsImpl = fakeFs({ dirs: [viteDir, depsDir], files: [[path.join(depsDir, 'dep.js'), 1000]] })
  const r = checkViteDepCacheStaleness(repo, fsImpl)
  assert.equal(r.state, 'fresh', 'source 根为空时必须按 fresh 放行（保守方向）')
  assert.equal(r.sourceMs, 0)
})

test('反失明下界：真实仓库的 source 根数 ≥ 10（解析退化成空 ⇒「零 source ⇒ 零 stale」恒 fresh）', () => {
  const roots = collectWorkspaceSourceRoots(REAL_REPO_ROOT, fs)
  assert.ok(roots.length >= 10, `source 根只有 ${roots.length} 个——解析退化或 packages 布局变更：` + roots.join(','))
  assert.ok(roots.some((r) => r.endsWith(path.join('shared-utils', 'src'))), 'shared-utils/src 必须被扫描')
  // 只扫 packages/*/src 与 packages/*/dist，不得把 apps/desktop/src 卷进来（渲染层源码热更新，非预构建产物）
  assert.ok(!roots.some((r) => r.includes(path.join('apps', 'desktop', 'src'))), '不得把 apps/desktop/src 当缓存判据')
})

// ─── dist 也算 source（package.json main 指向 dist 的 workspeace 包）───

test('src 旧但 dist 新 → stale（只盯 src 会漏掉 dist 型包）', () => {
  const repo = '/repo'
  const { depsDir, viteDir, packagesDir } = layoutRoot(repo)
  const pkg = path.join(packagesDir, 'ui')
  const fsImpl = fakeFs({
    dirs: [viteDir, depsDir, packagesDir, path.join(pkg, 'dist'), path.join(pkg, 'src')],
    files: [
      [path.join(depsDir, 'dep.js'), 1000],
      [path.join(pkg, 'src', 'index.js'), 900],
      [path.join(pkg, 'dist', 'index.js'), 3000],
    ],
  })
  assert.equal(checkViteDepCacheStaleness(repo, fsImpl).state, 'stale')
})

// ─── 清除动作的边界 ──

test('ensureFresh 在 stale 时删除的是 node_modules/.vite 整目录（metadata+deps 一起，防指纹残留）', () => {
  const repo = '/repo'
  const { depsDir, viteDir, packagesDir } = layoutRoot(repo)
  const sharedSrc = path.join(packagesDir, 'shared-utils', 'src')
  const fsImpl = fakeFs({
    dirs: [viteDir, depsDir, packagesDir, sharedSrc],
    files: [
      [path.join(depsDir, 'dep.js'), 1000],
      [path.join(sharedSrc, 'platform-definitions.js'), 5000],
    ],
  })
  const logs = []
  const r = ensureFreshViteDepCache(repo, { fsImpl, log: (m) => logs.push(m) })
  assert.deepEqual(fsImpl.removed, [viteDir], '只允许删 .vite 这一个目录')
  assert.equal(r.cleared, true)
  // fail-loud：日志必须同时给出判据、结果与动作
  assert.ok(logs.some((l) => l.includes('state=stale') && l.includes('cleared') && l.includes('cacheMs=1000') && l.includes('sourceMs=5000')),
    'stale 日志必须含判据时间戳与动作：' + logs.join(' | '))
})

test('rmSync 失败 → cleared=false 且带 clearError（不得静默报成功）', () => {
  const repo = '/repo'
  const { depsDir, viteDir, packagesDir } = layoutRoot(repo)
  const sharedSrc = path.join(packagesDir, 'shared-utils', 'src')
  const fsImpl = fakeFs({
    dirs: [viteDir, depsDir, packagesDir, sharedSrc],
    files: [
      [path.join(depsDir, 'dep.js'), 1000],
      [path.join(sharedSrc, 'platform-definitions.js'), 5000],
    ],
  })
  fsImpl.rmSync = () => { throw new Error('EBUSY: resource busy') }
  const logs = []
  const r = ensureFreshViteDepCache(repo, { fsImpl, log: (m) => logs.push(m) })
  assert.equal(r.state, 'stale')
  assert.equal(r.cleared, false)
  assert.ok(r.clearError && /EBUSY/.test(r.clearError), '失败原因必须透出')
})

test('fresh 时也打点（无动作也要留痕，供下次排歧判「这次走没走预检」）', () => {
  const repo = '/repo'
  const { depsDir, viteDir, packagesDir } = layoutRoot(repo)
  const sharedSrc = path.join(packagesDir, 'shared-utils', 'src')
  const fsImpl = fakeFs({
    dirs: [viteDir, depsDir, packagesDir, sharedSrc],
    files: [
      [path.join(depsDir, 'dep.js'), 5000],
      [path.join(sharedSrc, 'platform-definitions.js'), 1000],
    ],
  })
  const logs = []
  const r = ensureFreshViteDepCache(repo, { fsImpl, log: (m) => logs.push(m) })
  assert.equal(r.cleared, false)
  assert.equal(fsImpl.removed.length, 0)
  assert.ok(logs.some((l) => l.includes('state=fresh') && l.includes('action=none')), 'fresh 也要打点：' + logs.join(' | '))
})

// ─── 真实 fs 往返（os.tmpdir 隔离路径，真 mtime）───

test('真实 fs 往返：旧 cache + 新 source → 清；重建新 cache → fresh（不用假 mtime 自证）', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-dep-cache-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const { depsDir, viteDir } = layoutRoot(tmp)
  const sharedSrc = path.join(tmp, 'packages', 'shared-utils', 'src')
  fs.mkdirSync(sharedSrc, { recursive: true })
  fs.mkdirSync(depsDir, { recursive: true })
  fs.writeFileSync(path.join(depsDir, 'dep.js'), 'old')
  fs.writeFileSync(path.join(sharedSrc, 'platform-definitions.js'), 'new')
  // 让 source 明确更新：deno —— 用 utimesSync 把 source 推到未来 10s
  const future = new Date(Date.now() + 10000)
  fs.utimesSync(path.join(sharedSrc, 'platform-definitions.js'), future, future)

  const r1 = ensureFreshViteDepCache(tmp, { fsImpl: fs, log: () => {} })
  assert.equal(r1.state, 'stale')
  assert.equal(r1.cleared, true)
  assert.equal(fs.existsSync(viteDir), false, 'stale 判定后 .vite 必须真的消失')

  // 重建 cache（比 source 新）→ fresh
  fs.mkdirSync(depsDir, { recursive: true })
  fs.writeFileSync(path.join(depsDir, 'dep.js'), 'fresh')
  const future2 = new Date(Date.now() + 20000)
  fs.utimesSync(path.join(depsDir, 'dep.js'), future2, future2)
  const r2 = ensureFreshViteDepCache(tmp, { fsImpl: fs, log: () => {} })
  assert.equal(r2.state, 'fresh')
  assert.equal(fs.existsSync(viteDir), true, 'fresh 不得删缓存')
})

// ─── dev.js 接线结构锁（判据本身也得被守着）───

test('dev.js 必须在 spawn vite 之前完成缓存预检（结构锁，缺失即红不允许 skip）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'dev.js'), 'utf8')
  const callAt = src.indexOf('ensureFreshViteDepCache(')
  const requireAt = src.indexOf("require('./vite-dep-cache')")
  const spawnAt = src.indexOf('spawnNodeScript(viteScript')
  assert.notEqual(callAt, -1, 'dev.js 必须调用 ensureFreshViteDepCache')
  assert.notEqual(requireAt, -1, 'dev.js 必须 require vite-dep-cache 模块')
  assert.notEqual(spawnAt, -1, 'dev.js 必须仍走 spawnNodeScript(viteScript) 启动 vite')
  assert.ok(callAt < spawnAt, '预检必须发生在 spawn vite 之前（之后清缓存毫无意义）')
})

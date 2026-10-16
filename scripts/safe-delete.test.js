// Regression tests for scripts/safe-delete.js
//
// Why this lock exists: 2026-10-07 单日误删 `.ccg/` 五次，五次的「写法」都不同，
// 但根因同一条：把「目录里的临时文件」放大成了「整个目录」。写进记忆、文档、
// 提交信息都没能阻止第 5 次 —— 所以判据必须**机械执行**，而机械执行必须有锁：
// 哪天有人把某道闸「优化掉」，这条测试立刻红。
//
//   node --test scripts/safe-delete.test.js

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')

const { judge, isInside } = require('./safe-delete.js')

let REPO

before(() => {
  // 真实的临时 git 仓库：tracked / 未跟踪 / 目录三种形态都要真的存在于盘上，
  // 否则「is a directory」与「tracked」两闸测的就是构造出来的假象。
  REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'safedel-'))
  const g = (args) => cp.spawnSync('git', args, { cwd: REPO, encoding: 'utf8', windowsHide: true })
  g(['init', '-q'])
  g(['config', 'user.email', 't@t'])
  g(['config', 'user.name', 't'])

  fs.writeFileSync(path.join(REPO, 'tracked.txt'), 'x')
  fs.mkdirSync(path.join(REPO, 'dir'))
  fs.writeFileSync(path.join(REPO, 'dir', 'inner.txt'), 'x')
  g(['add', '-A'])
  g(['commit', '-qm', 'init'])

  fs.writeFileSync(path.join(REPO, 'untracked.txt'), 'y')
  fs.mkdirSync(path.join(REPO, 'untracked-dir'))
  fs.writeFileSync(path.join(REPO, 'untracked-dir', 'a.txt'), 'y')
})

after(() => { fs.rmSync(REPO, { recursive: true, force: true }) })

const j = (rel, opts) => judge(path.join(REPO, rel), REPO, opts)

// ── 闸 1：目录 ────────────────────────────────────────────────────────────
test('闸1：目标是目录时必须拒绝（这正是 5 次误删的形态）', () => {
  const r = j('untracked-dir')
  assert.equal(r.isDir, true)
  assert.equal(r.ok, false)
  assert.match(r.reason, /目录/)
})

test('闸1：被跟踪的目录同样先被目录闸拦下', () => {
  const r = j('dir')
  assert.equal(r.ok, false)
  assert.match(r.reason, /目录/)
})

// ── 闸 2：tracked ─────────────────────────────────────────────────────────
test('闸2：被 git 跟踪的文件必须拒绝', () => {
  const r = j('tracked.txt')
  assert.equal(r.tracked, true)
  assert.equal(r.ok, false)
  assert.match(r.reason, /git 跟踪/)
})

test('闸2：tracked 判定不是靠路径形状猜的 —— 改名为「像临时文件」后不再受管', () => {
  // 若实现退化成「文件名像临时产物就放行」，这条会暴露。
  // **但请注意这里的真实语义**：改名后该路径在 git 里已无「受管」身份
  // （索引里记的是旧名），内容仍完整保存在 HEAD 的旧路径下 ——
  // 删掉工作副本**不构成数据丢失**，所以放行是可辩护的。
  // 守卫拦的是「删掉 git 正在管的东西」，不是「猜这个文件将来会不会被提交」。
  const p = path.join(REPO, 'tracked.txt')
  fs.renameSync(p, path.join(REPO, 'looks-temp-9931.log'))
  const r = j('looks-temp-9931.log')
  assert.equal(r.tracked, false, 'git ls-files 按索引路径判定，改名后不再是受管路径')
  fs.renameSync(path.join(REPO, 'looks-temp-9931.log'), p)
  // 反向确认：换回原名立刻恢复受管身份
  assert.equal(j('tracked.txt').tracked, true, '原路径必须仍判 tracked，否则闸2是假的')
})

// ── 闸 3：必须在 git status 的 ?? 列表里 ────────────────────────────────────
test('闸3：未跟踪文件放行（唯一允许删除的形态）', () => {
  const r = j('untracked.txt')
  assert.equal(r.tracked, false)
  assert.equal(r.untrackedListed, true)
  assert.equal(r.ok, true, '守卫必须**能放行**，否则会被绕开而不是被遵守')
})

test('闸3：被 ignore 规则吞掉的文件不得删除（ls-files 说没有、status 也不列）', () => {
  fs.writeFileSync(path.join(REPO, '.gitignore'), 'ignored.log\n')
  cp.spawnSync('git', ['add', '.gitignore'], { cwd: REPO, windowsHide: true })
  fs.writeFileSync(path.join(REPO, 'ignored.log'), 'z')
  const r = j('ignored.log')
  assert.equal(r.tracked, false)
  assert.equal(r.untrackedListed, false, '被 gitignore 命中时 status 不列 ??')
  assert.equal(r.ok, false, '看不见的东西不许删')
})

// ── 闸 4：工作区边界 ───────────────────────────────────────────────────────
test('闸4：仓库外路径默认拒绝', () => {
  // 必须挑**非目录**：目录会先被闸1 拦下，那样测到的是闸1 而不是边界闸。
  const outside = path.join(os.tmpdir(), 'safedel-outside-probe.json')
  fs.writeFileSync(outside, '{}')
  try {
    const r = judge(outside, REPO, {})
    assert.equal(r.isDir, false)
    assert.equal(r.insideRepo, false)
    assert.equal(r.ok, false)
    assert.match(r.reason, /之外/)
  } finally {
    fs.rmSync(outside, { force: true })
  }
})

test('闸4：显式 --allow-outside 才放行仓库外，且仍要过 tracked 闸', () => {
  const outside = path.join(os.tmpdir(), 'safedel-outside-allowed.json')
  fs.writeFileSync(outside, '{}')
  try {
    const ok = judge(outside, REPO, { allowOutside: true })
    assert.equal(ok.insideRepo, false)
    assert.equal(ok.ok, true,
      '显式放行后应通过 —— 闸3 只在工作区内有意义，若它仍拦仓库外路径，--allow-outside 就是个死开关')

    // 但 tracked 闸不能被 --allow-outside 顺带关掉
    const trackedInside = judge(path.join(REPO, 'tracked.txt'), REPO, { allowOutside: true })
    assert.equal(trackedInside.ok, false)
    assert.match(trackedInside.reason, /git 跟踪/)
  } finally {
    fs.rmSync(outside, { force: true })
  }
})

// ── isInside：路径前缀陷阱 ────────────────────────────────────────────────
// 「C:\a\repo-extra」不以「C:\a\repo」为父目录，但字符串前缀看起来像。
test('isInside 不得用字符串前缀判断（防 C:\\a\\repo-extra 逃逸）', () => {
  assert.equal(isInside('C:\\a\\repo\\x.txt', 'C:\\a\\repo'), true)
  assert.equal(isInside('C:\\a\\repo-extra\\x.txt', 'C:\\a\\repo'), false)
  assert.equal(isInside('C:\\a\\repo', 'C:\\a\\repo'), true)
})

// ── 反向锁：守卫不能变成「什么都不许删」 ──────────────────────────────────
test('反向锁：对真正未跟踪的临时文件必须放行，否则守卫会被绕开', () => {
  const p = path.join(REPO, 'scratch.tmp')
  fs.writeFileSync(p, 'q')
  assert.equal(j('scratch.tmp').ok, true)
  fs.rmSync(p)
})

test('反向锁：被跟踪文件一旦 commit 就不再是删除对象（防止误判成"反正要删"）', () => {
  const p = path.join(REPO, 'newly-added.txt')
  fs.writeFileSync(p, 'n')
  assert.equal(j('newly-added.txt').ok, true, '未跟踪期间可删')
  cp.spawnSync('git', ['add', '-A'], { cwd: REPO, windowsHide: true })
  cp.spawnSync('git', ['commit', '-qm', 'add it'], { cwd: REPO, windowsHide: true })
  assert.equal(j('newly-added.txt').ok, false, '一旦入库立刻转为受管，守卫必须改口')
})

// ── 结构锁：CLI 不得出现绕过开关 ──────────────────────────────────────────
test('结构锁：脚本不得提供 --force / --skip-tracked 之类绕过开关', () => {
  const src = fs.readFileSync(path.join(__dirname, 'safe-delete.js'), 'utf8')
  assert.doesNotMatch(src, /--force\b/, '不得有绕过 tracked 闸的强制开关')
  assert.doesNotMatch(src, /skip[-_]?tracked/i)
  assert.doesNotMatch(src, /ignore[-_]?tracked/i)
  // 删除动作必须走 mavis-trash（可恢复），不得直接 rm
  assert.match(src, /mavis-trash/, '删除必须走可恢复通道')
  assert.doesNotMatch(src, /\brm\s+-rf\b/, '不得出现 rm -rf')
  assert.doesNotMatch(src, /Remove-Item[^\n]*-Recurse/, '不得出现递归删除')
})

// ── 删除后端解析链（2026-10-16 补）────────────────────────────────────────
// 上面那条结构锁只锁「源码里出现了 mavis-trash 这个名字」，**不锁这个命令在
// 本机/CI 上存在**。实测后果：四道闸全过、--dry-run 报「允许删除」，实跑一律
// `'mavis-trash' 不是内部或外部命令` ⇒ 审计日志写 FAILED；本仓 ≥11 处记录
// 从 2026-10-09 起登记过这个环境事实，而 12 例测试始终全绿。
// 根因是「可恢复删除」这个 R0 核心能力被外包给一个未随仓库交付的外部命令。
// 下面的锁补上缺失的那一层：能力必须自足，不可用时必须**失败**而非静默。

test('后端链：每个平台都必须给出 ≥2 个候选，且至少一个不依赖外部 PATH', () => {
  const { trashBackends } = require('./safe-delete.js')
  assert.equal(typeof trashBackends, 'function', '必须可测地暴露后端解析，否则这层只能靠人肉验证')
  for (const platform of ['win32', 'darwin', 'linux']) {
    const list = trashBackends(platform)
    assert.ok(Array.isArray(list) && list.length >= 2,
      `${platform} 至少要 2 个候选（外部命令 + 平台内置），实际 ${list && list.length}`)
    assert.ok(list.some((b) => b.kind === 'builtin'),
      `${platform} 必须含一个不依赖外部命令的 builtin 后端 —— 只依赖 PATH 里的外部命令正是本缺陷`)
    for (const b of list) {
      assert.ok(typeof b.id === 'string' && b.id, 'backend 需要稳定 id')
      assert.ok(['external', 'builtin'].includes(b.kind), `unknown kind: ${b.kind}`)
    }
  }
})

test('后端链：mavis-trash 仍排第一（向后兼容已装该命令的机器）', () => {
  const { trashBackends } = require('./safe-delete.js')
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.equal(trashBackends(platform)[0].id, 'mavis-trash')
  }
})

test('后端链：全部不可用时必须失败，且**文件必须仍在**（绝不静默当成功）', () => {
  const { deleteRecoverable } = require('./safe-delete.js')
  assert.equal(typeof deleteRecoverable, 'function')
  const p = path.join(REPO, 'recoverable-probe.tmp')
  fs.writeFileSync(p, 'keep me')
  try {
    const r = deleteRecoverable(p, { backends: [] })
    assert.equal(r.ok, false, '没有可用后端时必须返回失败')
    assert.ok(r.error, '失败必须带原因')
    assert.ok(fs.existsSync(p), '失败路径下文件必须原样存在 —— 删不掉就必须承认删不掉')
  } finally { fs.rmSync(p, { force: true }) }
})

test('结构锁：删除路径不得使用不可恢复原语（rm / unlink 一律视为绕过可恢复通道）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'safe-delete.js'), 'utf8')
  assert.doesNotMatch(src, /fs\.(rm|rmSync|unlink|unlinkSync)\s*\(/,
    'FS 层删除不可恢复，会绕过 R0 的可恢复语义')
  assert.doesNotMatch(src, /(?:^|[^\w.])rm\s+-[rf]{1,2}\b/, '不得出现 rm -r / rm -f')
  assert.doesNotMatch(src, /shutil\.rmtree|Remove-Item[^\n]*-Recurse/, '不得递归删除')
})

test('结构锁：后端必须按平台区分（防「只加一个 win32 分支」又退化成单点）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'safe-delete.js'), 'utf8')
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.match(src, new RegExp(platform), `后端解析必须覆盖 ${platform}`)
  }
})
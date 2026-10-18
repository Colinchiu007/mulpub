/**
 * mask-coverage-ab.test.js — A/B 覆盖对比工具自身的回归锁（2026-10-18）
 *
 * 本文件锁三件事：
 * ① **能检出回归**：候选实现把某些文件掩得更多时必须落进 `decreased`（否则这条判据是装饰品）；
 * ② **能检出等长性破坏**：掩码不等长是硬缺陷，必须单独归类而不是被当成"变化"；
 * ③ 剪枝面与源码根不许被悄悄改宽/改窄（`.agent_context` 必须留在剪枝里 —— 它是未跟踪的本地归档，
 *    留在外面会让共享根上的读数失真，见 `check-unwired-tests` 同款理由）。
 *
 * 夹具设计要点：**三个实现都是确定性的纯函数**，不依赖 git —— `loadMaskFromGit` 只在 CLI 路径用，
 * 单测里直接注入 baseline/candidate，避免测试依赖工作区状态。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ab = require('./mask-coverage-ab')
const { maskNonCode } = require('./code-mask')

function makeTree (files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mask-ab-test-'))
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body, 'utf8')
  }
  return root
}

function cleanup (root) {
  try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
}

/**
 * 一个「瞎」的实现：模拟**修复前的 code-mask** —— 除了正则字面量缺陷以外，
 * 其余行为与真实现一致，因此必须用真实现输出打底、再把命中行**额外**掩掉。
 * （教训：第一版直接"什么都不掩"，结果它比真实现看得**更多** ——
 *   连字符串都不掩 —— 于是被误判成"修复造成回归"。夹具必须只差一个维度。）
 */
function blindMask (src) {
  const base = maskNonCode(src)
  const out = base.split('')
  let offset = 0
  for (const line of src.split('\n')) {
    // 命中 `/[..."]...` 形态的整行掩掉（等长）。判据是"斜杠 + 方括号 + 引号"，
    // 正是修复前会把 `"` 当字符串起点吞掉后续代码的那种正则。
    if (/\/\[[^\]]*["'][^\]]*\]/.test(line)) {
      for (let k = 0; k < line.length; k++) out[offset + k] = ' '
    }
    offset += line.length + 1
  }
  return out.join('')
}

/** 过度掩的实现：在真实现基础上再多掩一些字符（等长），用于验证回归能被检出。 */
function overMask (src) {
  const m = maskNonCode(src)
  const out = m.split('')
  for (let i = 0; i < out.length; i++) {
    if (/[A-Za-z]/.test(out[i]) && i % 7 === 0) out[i] = ' ' // 每 7 个字母掩一个
  }
  return out.join('')
}

/** 破坏等长性的实现。 */
function shortMask (src) {
  return maskNonCode(src).slice(0, -1)
}

const FIXTURE = {
  'scripts/a.js': 'const re = /["\']/g\nconst x = 1\nfunction after () { return 42 }\n',
  'scripts/b.js': 'const y = 2\n',
  'apps/desktop/src/c.vue': '<script>\nconst z = "s"\n</script>\n',
  '.agent_context/worktree-archive-x/scripts/orphan.js': 'const w = /["\']/\nconst keep = 1\n',
}

test('相同实现对比：0 增 0 减（基线自检）', () => {
  const root = makeTree(FIXTURE)
  try {
    const r = ab.compareCoverage({ root, baseline: maskNonCode, candidate: maskNonCode })
    assert.equal(r.increased.length, 0, '同一实现不应有增益')
    assert.equal(r.decreased.length, 0, '同一实现不应有回归')
    assert.equal(r.unequal.length, 0)
  } finally { cleanup(root) }
})

test('回归检出：候选掩得更多必须落进 decreased（否则这条判据是装饰品）', () => {
  const root = makeTree(FIXTURE)
  try {
    const r = ab.compareCoverage({ root, baseline: maskNonCode, candidate: overMask })
    assert.ok(r.decreased.length > 0,
      'overMask 明显掩掉更多字母，必须被判为回归；实际 decreased=' + JSON.stringify(r.decreased))
    for (const row of r.decreased) {
      assert.ok(row.now < row.base, '回归项的 now 必须小于 base：' + JSON.stringify(row))
    }
  } finally { cleanup(root) }
})

test('增益检出：候选比基线看得更多必须落进 increased（修复生效的形态）', () => {
  const root = makeTree(FIXTURE)
  try {
    const r = ab.compareCoverage({ root, baseline: blindMask, candidate: maskNonCode })
    assert.ok(r.increased.length > 0,
      '盲实现会掩掉含引号正则的整行，真实现应看见更多；实际 increased=' + JSON.stringify(r.increased))
    assert.equal(r.decreased.length, 0, '修复不应造成任何回归')
  } finally { cleanup(root) }
})

test('等长性破坏必须单独归类，不得混进 decreased/increased', () => {
  const root = makeTree(FIXTURE)
  try {
    const r = ab.compareCoverage({ root, baseline: maskNonCode, candidate: shortMask })
    assert.ok(r.unequal.length > 0, '返回短一字符的实现必须被认成等长性失败')
    assert.equal(r.increased.length + r.decreased.length, 0, '等长性失败的条目不得混进增/减分类')
    assert.match(r.unequal[0].why, /等长性失败/)
  } finally { cleanup(root) }
})

test('剪枝：.agent_context 与 node_modules 不进源码面', () => {
  assert.ok(ab.PRUNE_DIRS.has('.agent_context'),
    '.agent_context 是未跟踪的本地归档，必须留在剪枝里（摘掉会让读数失真）')
  assert.ok(ab.PRUNE_DIRS.has('node_modules'))
  assert.ok(ab.PRUNE_DIRS.has('dist'))
  const root = makeTree(FIXTURE)
  try {
    const files = ab.listSourceFiles(root).map((f) => path.relative(root, f).replace(/\\/g, '/'))
    assert.ok(files.includes('scripts/a.js'))
    assert.ok(!files.some((f) => f.startsWith('.agent_context/')),
      '归档目录文件不得进入源码面：' + JSON.stringify(files))
  } finally { cleanup(root) }
})

test('源码根恰好是 apps/packages/scripts/.github（改宽会默默扩大扫描面）', () => {
  assert.deepEqual(ab.SOURCE_ROOTS.slice().sort(), ['.github', 'apps', 'packages', 'scripts'])
})

test('loadMaskFromGit 对不存在的 ref 必须抛错而不是静默返回空', () => {
  const root = path.resolve(__dirname, '..', '..')
  assert.throws(
    () => ab.loadMaskFromGit(root, 'definitely-not-a-real-ref-9f8e7d'),
    /取不到/,
    'ref 不存在时必须抛出可诊断错误，不得静默降级',
  )
})

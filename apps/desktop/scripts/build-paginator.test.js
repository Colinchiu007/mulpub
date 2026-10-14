/**
 * build-paginator 的测试（P2-2 验收判据）。
 *
 * ★ 判据刻意**强于**设计文：设计文只要求「grep 断言产物含 paginate / CLAUSE_ENDERS」，
 *   但"含这个字符串"与"注入后能用"是两回事 —— 一个被注释掉的 paginate 也能通过 grep。
 *   本测试在 **vm 沙箱里真正执行产物**并断言导出成员可用，这才等价于渲染进程注入后的情形。
 *
 * 与 build-preload 的既有测试同形：都从 `scripts/` 里 require 构建函数，**不重跑子进程**。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const {
  ENTRY_FILE, OUTPUT_FILE, GLOBAL_NAME, BANNER, buildPaginator,
} = require(path.join(DESKTOP_ROOT, 'scripts', 'build-paginator.js'))

test('判据①：构建 exit=0 且产物存在', async () => {
  await buildPaginator({ logLevel: 'silent' })
  assert.ok(fs.existsSync(OUTPUT_FILE), `产物不存在: ${OUTPUT_FILE}`)
  assert.ok(fs.statSync(OUTPUT_FILE).size > 0, '产物为空')
})

test('判据②：产物是合法 JS（node --check 等价：能被 V8 解析）', () => {
  const src = fs.readFileSync(OUTPUT_FILE, 'utf8')
  assert.doesNotThrow(() => new vm.Script(src), '产物无法被解析')
})

test('判据③：产物含 paginate 与 CLAUSE_ENDERS（grep 级断言，设计文原判据）', () => {
  const src = fs.readFileSync(OUTPUT_FILE, 'utf8')
  assert.ok(src.includes('paginate'), '产物不含 paginate')
  assert.ok(src.includes('CLAUSE_ENDERS'), '产物不含 CLAUSE_ENDERS')
  assert.ok(src.includes(GLOBAL_NAME), '产物不含 globalName')
})

test('★ 判据③+：产物在 vm 沙箱里**真正执行**并导出可用成员', () => {
  const src = fs.readFileSync(OUTPUT_FILE, 'utf8')
  const sandbox = {}
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox)
  const P = sandbox[GLOBAL_NAME]
  assert.ok(P, `沙箱里没有 ${GLOBAL_NAME}`)
  // 决策层的核心导出必须都在（与源模块的导出面对齐）
  for (const k of ['paginate', 'snapToPunctuation', 'SENTENCE_ENDERS', 'CLAUSE_ENDERS', 'CJK_ENDERS', 'WARNINGS']) {
    assert.ok(k in P, `产物导出缺 ${k}`)
  }
  assert.equal(typeof P.paginate, 'function')
  assert.equal(P.CLAUSE_ENDERS.length, 4, 'CLAUSE_ENDERS 长度应为 4')
})

test('★ 产物行为与源一致（同一输入同一输出，非仅"能跑"）', async () => {
  const src = fs.readFileSync(OUTPUT_FILE, 'utf8')
  const sandbox = {}
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox)
  const bundled = sandbox[GLOBAL_NAME]

  const source = require(path.resolve(DESKTOP_ROOT, '..', '..', 'packages', 'shared-utils', 'src', 'card-paginator-core.js'))

  // 用确定性假 measure：高度 = 字符数 × 每字像素
  const measure = async (it) => ({ heightPx: String(it.value).length * 10 })
  const items = [
    { id: 'a', value: 'x'.repeat(20) },
    { id: 'b', value: 'y'.repeat(20) },
    { id: 'c', value: 'z'.repeat(20) },
  ]
  const opts = { availableHeightPx: 250, measure, maxPages: 5 }
  const rBundled = await bundled.paginate(items, opts)
  const rSource = await source.paginate(items, opts)

  assert.deepEqual(
    JSON.parse(JSON.stringify(rBundled.pages)),
    JSON.parse(JSON.stringify(rSource.pages)),
    '产物与源的分页结果不一致 —— 构建过程改变了行为'
  )
  assert.equal(rBundled.pageCount, rSource.pageCount)
})

test('产物带 @generated 头（防手改；重新构建应字节一致）', async () => {
  const before = fs.readFileSync(OUTPUT_FILE, 'utf8')
  assert.ok(before.startsWith(BANNER.slice(0, 20)), '产物缺少 @generated 头')
  await buildPaginator({ logLevel: 'silent' })
  const after = fs.readFileSync(OUTPUT_FILE, 'utf8')
  assert.equal(after, before, '重新构建产物字节不一致 —— 构建不确定或产物被手改')
})

test('ENTRY_FILE 指向决策层唯一实现（不是复制品）', () => {
  assert.ok(fs.existsSync(ENTRY_FILE), `源不存在: ${ENTRY_FILE}`)
  assert.ok(ENTRY_FILE.endsWith(path.join('shared-utils', 'src', 'card-paginator-core.js')),
    `源路径异常: ${ENTRY_FILE}`)
})

test('产物落在 electron/** 下（随 app.asar 打包）', () => {
  const rel = path.relative(DESKTOP_ROOT, OUTPUT_FILE).split(path.sep).join('/')
  assert.ok(rel.startsWith('electron/'), `产物不在 electron/ 下: ${rel}`)
  assert.ok(rel.endsWith('.iife.js'), `产物扩展名异常: ${rel}`)
})

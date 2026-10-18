'use strict'

/**
 * check-ops-seed.js 的夹具回归测试。
 *
 * 覆盖 design.md §4.4 的 7 条判据，外加两条本仓门禁通用纪律：
 *  - **接线锁**：脚本没挂进 quality-gate.yml 时必须变红（否则是"看起来在守、实际恒绿"）；
 *  - **fail-closed**：种子读不到 / 解析失败必须抛错，绝不返回"通过"。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const { checkWiring, loadSeed, SEED_REL } = require('./check-ops-seed.js')
const { computeConfigHash, RUNTIME_BLOCKS } = require(
  path.join(REPO_ROOT, 'apps', 'desktop', 'electron', 'services', 'ops-runtime-snapshot'),
)

/** 造一份结构合法的种子（13 块齐全 + 正确的 hash），再由用例各自破坏一处。 */
function makeSeed (overrides = {}) {
  const seed = {
    _meta: { config_version: 3, config_hash: '', exported_at: new Date().toISOString(), source: 'test' },
    announcements: [],
    update_policy: { channel: 'stable' },
    content_policy: { name: '默认内容安全策略', enabled: true, replacement: '***' },
    feature_flags: {},
    platform_defs: [],
    content_templates: [],
    keyword_watchlist: [],
    rewrite_strategies: [],
    rewrite_hard_constraints: null,
    rewrite_ai_taste_map: [],
    pipelineOptions: {},
    appMenu: null,
    contentCategories: { items: [{ category_key: 'general', name: '综合', sort_order: 0 }], count: 1 },
    // 字数控制（story-text-limit-control）：契约 object-or-null，缺省下发 null（fail-open）
    storyTextLimit: null,
  }
  Object.assign(seed, overrides)
  if (!overrides._meta) {
    const meta = { ...seed._meta }
    meta.config_hash = computeConfigHash(seed)
    seed._meta = meta
  }
  return seed
}

function writeSeed (tmpDir, obj, { raw } = {}) {
  const p = path.join(tmpDir, 'runtime-bootstrap.json')
  fs.writeFileSync(p, raw !== undefined ? raw : JSON.stringify(obj, null, 2), 'utf8')
  return p
}

function validateFile (p, extra = {}) {
  const { raw, bytes, hasBom, hasReplacementChar } = loadSeed(p)
  // 复用被测模块的校验器（与 CI 跑的是同一份实现），这里只做薄封装
  const { validateSeedPayload } = require(
    path.join(REPO_ROOT, 'apps', 'desktop', 'electron', 'services', 'ops-runtime-snapshot'),
  )
  return validateSeedPayload(raw, { bytes, hasBom, hasReplacementChar, file: p, ...extra })
}

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-seed-test-'))
}

test('合法种子零错误零警告', () => {
  const dir = tmp()
  const p = writeSeed(dir, makeSeed())
  const r = validateFile(p)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, [])
})

test('第 1 条：缺任一数据块即失败', () => {
  const dir = tmp()
  const seed = makeSeed()
  delete seed.keyword_watchlist
  const r = validateFile(writeSeed(dir, seed))
  assert.ok(r.errors.some((e) => e.includes('SEED_BLOCK_MISSING') && e.includes('keyword_watchlist')))
})

test('14 个数据块全部参与 hash（漏一个就说明白名单不全）', () => {
  const { SEED_BLOCK_TYPES } = require(
    path.join(REPO_ROOT, 'apps', 'desktop', 'electron', 'services', 'ops-runtime-snapshot'),
  )
  assert.equal(RUNTIME_BLOCKS.length, 14)
  const seed = makeSeed()
  // 逐块对照「null」与「非 null 哨兵」两种取值：hash 必须不同。
  // （不能写成「把块改成 X 再比」——某些块本身就是 null，改成 null 等于没改，
  //   会得到一个恒真断言，白名单漏块时反而测不出来。）
  for (const block of RUNTIME_BLOCKS) {
    const sentinel = SEED_BLOCK_TYPES[block] === 'array' ? [block] : { marker: block }
    const asNull = computeConfigHash({ ...seed, [block]: null })
    const asSentinel = computeConfigHash({ ...seed, [block]: sentinel })
    assert.notEqual(asNull, asSentinel, `改动 ${block} 后 hash 必须变化，否则该块漏出了 hash 白名单`)
  }
})

test('第 2 条：类型与运行时不符即失败（数组位塞对象）', () => {
  const dir = tmp()
  const seed = makeSeed({ announcements: { nope: true } })
  const r = validateFile(writeSeed(dir, seed))
  assert.ok(r.errors.some((e) => e.includes('SEED_BLOCK_TYPE') && e.includes('announcements')))
})

test('第 2 条：object-or-null 块接受 null，不接受裸数组', () => {
  const dir = tmp()
  // null 是服务端合法的下发形态（rewrite_hard_constraints 可为 None）
  assert.deepEqual(validateFile(writeSeed(dir, makeSeed({ rewrite_hard_constraints: null }))).errors, [])
  const bad = makeSeed({ appMenu: [] })
  assert.ok(validateFile(writeSeed(dir, bad)).errors.some((e) => e.includes('SEED_BLOCK_TYPE') && e.includes('appMenu')))
})

test('第 2 条：contentCategories 同时接受裸数组与 {items}', () => {
  const dir = tmp()
  assert.deepEqual(validateFile(writeSeed(dir, makeSeed({ contentCategories: [] }))).errors, [])
  assert.deepEqual(validateFile(writeSeed(dir, makeSeed({ contentCategories: { items: [] } }))).errors, [])
})

test('第 4 条：UTF-8 BOM 即失败（且报出可操作原因，不是笼统解析错误）', () => {
  const dir = tmp()
  const p = path.join(dir, 'bom.json')
  fs.writeFileSync(p, '﻿' + JSON.stringify(makeSeed()), 'utf8')
  // BOM 让 JSON.parse 抛错 —— 这正是它必须在**读取层**被识别出来的理由
  let bomDetected = false
  try {
    loadSeed(p)
  } catch (e) {
    bomDetected = /BOM/.test(e.message)
  }
  assert.ok(bomDetected, '含 BOM 的种子必须报出 BOM 相关原因')
})

test('第 4 条：U+FFFD 替换字符即失败', () => {
  const dir = tmp()
  // 用 String.fromCharCode 而非字面量：CI Gate 12b 扫本次变更文件里的裸 U+FFFD，
  // 夹具里写一个字面量就等于让门禁永远红（与被测判据同义，却与仓库门禁互斥）。
  const BAD = String.fromCharCode(0xfffd)
  const seed = makeSeed({ announcements: [{ title: `坏${BAD}字符` }] })
  const r = validateFile(writeSeed(dir, seed))
  assert.ok(r.errors.some((e) => e.includes('SEED_REPLACEMENT_CHAR')))
})

test('第 5 条：_meta.config_hash 与实算不符即失败', () => {
  const dir = tmp()
  const seed = makeSeed()
  seed._meta.config_hash = '0000000000000000'
  const r = validateFile(writeSeed(dir, seed))
  assert.ok(r.errors.some((e) => e.includes('SEED_HASH_MISMATCH')))
})

test('第 6 条（安全硬约束）：content_policy.word_list 进包即失败，并点名文件与字段', () => {
  const dir = tmp()
  const seed = makeSeed()
  seed.content_policy = { name: 'x', enabled: true, word_list: ['违禁词甲', '违禁词乙'] }
  seed._meta.config_hash = computeConfigHash(seed)
  const r = validateFile(writeSeed(dir, seed))
  const err = r.errors.find((e) => e.includes('SEED_WORD_LIST_PRESENT'))
  assert.ok(err, '词库残留必须被拦')
  assert.ok(err.includes('content_policy.word_list'), '错误信息必须点名字段')
  assert.ok(err.includes('runtime-bootstrap.json'), '错误信息必须点名文件')
})

test('第 7 条：超 90 天只警告不阻塞（发版忘更新不该卡构建）', () => {
  const dir = tmp()
  const seed = makeSeed()
  seed._meta.exported_at = new Date(Date.now() - 120 * 86400000).toISOString()
  seed._meta.config_hash = computeConfigHash(seed)
  const r = validateFile(writeSeed(dir, seed))
  assert.deepEqual(r.errors, [], '过期不得变成阻塞错误')
  assert.ok(r.warnings.some((w) => w.includes('SEED_STALE')))
})

test('fail-closed：种子文件不存在必须抛错，不得静默通过', () => {
  assert.throws(
    () => loadSeed(path.join(tmp(), 'nope.json')),
    /读取种子文件失败/,
  )
})

test('fail-closed：不是合法 JSON 必须抛错', () => {
  const dir = tmp()
  assert.throws(() => loadSeed(writeSeed(dir, null, { raw: '{ not json' })), /不是合法 JSON/)
})

test('接线锁：真实 quality-gate.yml 必须已挂上本门禁', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  const r = checkWiring(text)
  assert.deepEqual(r.missing, [], '本门禁尚未接线：' + r.missing.join('；'))
})

test('接线锁：只有注释里提到不算接线', () => {
  // 夹具刻意只满足「夹具回归点名」一条，把执行行留在注释里 ——
  // 这样断言缺的**恰好 1 项**且就是执行行，精确证明「注释掉的调用不算接线」。
  const fake = [
    '      node --test .github/scripts/check-ops-seed.test.js',
    '      # node .github/scripts/check-ops-seed.js',
  ].join('\n')
  const r = checkWiring(fake)
  assert.equal(r.ok, false)
  assert.equal(r.missing.length, 1, '只应缺执行行，实际：' + r.missing.join('；'))
  assert.ok(r.missing[0].includes('执行行'), '缺项应指向执行行，实际：' + r.missing[0])
})

test('接线锁：quality-gate 正文为空必须抛错，不得判为已接线', () => {
  assert.throws(() => checkWiring(''), /拒绝判定为已接线/)
})

test('仓库里的真实种子文件本身通过校验（防止门禁只对夹具有效）', () => {
  const p = path.join(REPO_ROOT, SEED_REL)
  const r = validateFile(p)
  assert.deepEqual(r.errors, [], '仓库中的种子未通过校验：' + r.errors.join('；'))
})
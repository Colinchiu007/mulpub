/**
 * same-type-risk-locks-r3.test.js — R7/R11 锁的回归测试 + 共享库抽取的等价性锁
 *
 * 三层（与前两批一致）：
 * ① 红夹具：R7 独立映射表 / R11 有写无清 ⇒ 必须出现；
 * ② 绿夹具：真源文件自身豁免、配对完整的模块级集合、函数内局部集合 ⇒ 不出声；
 * ③ 共享库抽取的**行为等价锁**（本批的工程主体）：code-mask 与两批旧实现的 maskNonCode
 *    在同一夹具集上逐字节相等 —— 抽库最怕「顺手改语义」，这条锁把「等价」变成可回归验证的断言。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { scanIndependentMimeMaps, scanModuleStateGrowth, scanAllR3 } = require('./lib/same-type-risk-locks-r3')
const shared = require('./lib/code-mask')
const batch1 = require('./lib/same-type-risk-locks')
const batch2 = require('./lib/same-type-risk-locks-r2')

const REPO = path.join(__dirname, '..')
const src = (p, text) => [{ path: p, text }]

// ── R7 ──

test('R7 红：同对象内 image/jpeg 与 .jpg 共现 ⇒ 独立映射表必须报', () => {
  const code = [
    'const MIME = {',
    "  '.jpg': 'image/jpeg',",
    "  '.png': 'image/png',",
    '}',
  ].join('\n')
  const r = scanIndependentMimeMaps(src('svc.js', code))
  assert.equal(r.ok, false)
  assert.equal(r.findings[0].rule, 'R7-independent-mime-map')
})

test('R7 绿：真源文件自身豁免（否则锁自我报警）', () => {
  const text = fs.readFileSync(path.join(REPO, 'scripts', 'lib', 'image-mime.js'), 'utf8')
  const r = scanIndependentMimeMaps(src('scripts/lib/image-mime.js', text))
  assert.equal(r.ok, true, '真源文件的 FORMATS 表不得判红')
  assert.equal(r.stats.hits, 0)
})

test('R7 绿：与 mime 无关的对象（含 .png 无 image/png）不报', () => {
  const code = "const conf = { 'a.png': 'icon', output: 'out.png' }"
  const r = scanIndependentMimeMaps(src('svc.js', code))
  assert.equal(r.ok, true)
})

// ── R11 ──

test('R11 出声：模块级 Map 有写无清 ⇒ visible 面出现（不进红面）', () => {
  const code = [
    'const cache = new Map()',
    'function put (k, v) { cache.set(k, v) }',
    'function get (k) { return cache.get(k) }',
  ].join('\n')
  const r = scanModuleStateGrowth(src('svc.js', code))
  assert.equal(r.ok, true, 'R11 只出声不拦截')
  assert.equal(r.stats.writeOnly, 1)
  assert.match(r.visible[0].detail, /只增/)
})

// ── R11 审计依据可查性（2026-10-18）──
// 审计面的意义是「逼作者写一句为什么只增」。但"写没写"此前只能靠人读，
// 于是每轮会话都要把 11 条重读一遍（本轮实测：关键词粗筛报 4 条缺理由，
// 逐条读后发现那 4 条其实都有依据，只是表述不在关键词表里 —— 如
// `livePartitions` 的理由是「跨进程回收」、两个 *Cache 的理由是「注册表数据冻结」）。
//
// 这把锁不试图用关键词判定「理由写得好不好」（那会引入假阳），只判一件可机械化的事：
// **紧邻声明的上一行非空行必须是注释**（`//` 或 JSDoc 的 `*`/`/*`）。
//
// 判据从「上方 6 行内有任意注释」**收窄**到「紧邻」是实测逼出来的：第一版用 6 行窗口，
// 变异验证（删掉 registry 的理由注释）后仍全绿 —— 因为 6 行内还有**别的**注释
// （该文件的重构历史），宽判据测的是"附近有注释"而不是"解释了这个声明"。
// 收窄后 11/11 真实条目全部成立（先取证再定判据），且删掉任一条的理由都会当场红。
// 理由质量仍由人读，`derived/竞品缺陷同型风险清单.md` §4.2 已逐条登记判定。

test('R11 审计依据可查：紧邻声明的上一行非空行必须是注释', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { collectSources } = require('./check-same-type-risk-locks')
  const sources = collectSources(path.resolve(__dirname, '..'))
  const r = scanAllR3(sources)
  const missing = []
  for (const v of r.visible) {
    if (v.kind !== 'module-state-write-only') continue
    const lines = fs.readFileSync(path.resolve(__dirname, '..', v.path), 'utf8').split('\n')
    const name = v.name.replace(/[$]/g, '\\$')
    let decl = -1
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp('\\b' + name + '\\s*=\\s*new\\s+(Map|Set)').test(lines[i])) { decl = i; break }
    }
    if (decl < 0) { missing.push(v.path + ' :: ' + v.name + '（找不到声明行）'); continue }
    // 紧邻：从声明行往上跳过空行，第一个非空行必须是注释
    let i = decl - 1
    while (i >= 0 && lines[i].trim() === '') i--
    const prev = i >= 0 ? lines[i].trim() : ''
    if (!/^(\/\/|\/\*\*?|\*)/.test(prev)) {
      missing.push(v.path + ' :: ' + v.name + '（紧邻行不是注释 ⇒ 没写「为什么只增」）: ' + JSON.stringify(prev.slice(0, 50)))
    }
  }
  assert.deepEqual(missing, [],
    '每条 R11 审计项的紧邻行都必须是注释（解释为什么只增）；缺据：\n  ' + missing.join('\n  '))
})


test('R11 绿：写清配对完整 ⇒ 不出声', () => {
  const code = [
    'const lock = new Map()',
    'function lockIt (k) { lock.set(k, 1) }',
    'function unlock (k) { lock.delete(k) }',
  ].join('\n')
  const r = scanModuleStateGrowth(src('svc.js', code))
  assert.equal(r.stats.writeOnly, 0)
  assert.equal(r.visible.length, 0)
})

// ── R11 回归锁（2026-10-18）：声明正上方是注释或空行时，旧实现会把该声明
//    误判成「缩进声明」而整条跳过（根因：MODULE_SET_RE 以 `(?:^|\n)` 开头，
//    m.index 指向那个 \n，`slice(0, m.index).split('\n').pop()` 取到的是**上一行**；
//    上一行掩码后是纯空白 ⇒ `/^\s/` 为真 ⇒ 漏检）。实测伤害：给两条声明各加一段注释后
//    moduleSets 11→9、writeOnly 2→0，看上去像"豁免生效"，实际是它们从审计面消失了。

test('R11 回归：声明正上方是注释不得让集合从审计面消失', () => {
  const code = [
    '// 上面这行注释曾让下面的声明被判成「缩进」而整条漏检',
    'const cache = new Map()',
    'function put (k, v) { cache.set(k, v) }',
  ].join('\n')
  const r = scanModuleStateGrowth(src('svc.js', code))
  assert.equal(r.stats.moduleSets, 1, '有注释在上方时模块级集合仍必须计入审计面')
  assert.equal(r.stats.writeOnly, 1, '有注释在上方时仍必须出声（旧实现这里会静默为 0）')
})

test('R11 回归：声明正上方是空行不得让集合从审计面消失', () => {
  const code = [
    '',
    '',
    'const buckets = new Map()',
    'function bump (k) { buckets.set(k, 1) }',
  ].join('\n')
  const r = scanModuleStateGrowth(src('svc.js', code))
  assert.equal(r.stats.moduleSets, 1, '有空行在上方时模块级集合仍必须计入审计面')
  assert.equal(r.stats.writeOnly, 1)
})

test('R11 绿：真正缩进的声明本来就不命中（删守卫后不得回退成误报）', () => {
  const code = [
    'function f () {',
    '  const local = new Map()',
    '  local.set(1, 2)',
    '}',
  ].join('\n')
  const r = scanModuleStateGrowth(src('svc.js', code))
  assert.equal(r.stats.moduleSets, 0, '缩进声明不是模块顶层，正则本身就不该命中')
})

test('R11 绿：函数内局部集合不在审计面（只看模块顶层）', () => {
  const code = [
    'function f () {',
    '  const local = new Set()',
    '  local.add(1)',
    '  return local',
    '}',
  ].join('\n')
  const r = scanModuleStateGrowth(src('svc.js', code))
  assert.equal(r.stats.moduleSets, 0)
})

test('R11（评审驱动 acefedf1-i4）：let/var 声明的模块级集合也在审计面', () => {
  // 首版 MODULE_SET_RE 只认 const ⇒ let/var 的模块级集合被静默漏掉（覆盖缺口）。
  const code = [
    'let cache = new Map()',
    'cache.set(1, 1)',
  ].join('\n')
  const r = scanModuleStateGrowth(src('svc.js', code))
  assert.equal(r.stats.writeOnly, 1, 'let 声明的只增集合必须出声')
})


// ── 共享库抽取的行为等价锁（本批工程主体） ──

const EQUIV_CASES = [
  '// while (true)',
  "const s = 'x = 90'",
  '/* comment */',
  'const t = `tpl ${a}`',
  's.replace(/[&<>"\']/g, m)',
  'a // trailing',
  'let r = /regex/g',
  'x = 1; // y = 2',
  "str = \"it's\"",
  '`multi\nline`',
  '// 中文注释 this.loading = true 「引号」',
  'const zh = "中文字符串"',
  'const nested = { a: { b: { c: 1 } } }',
]

test('code-mask：与第一批 maskNonCode 行为逐字节等价（12/12 夹具）', () => {
  for (const code of EQUIV_CASES) {
    assert.equal(
      shared.maskNonCode(code),
      batch1.maskNonCode(code),
      'mask 形态差异: ' + JSON.stringify(code.slice(0, 30))
    )
    assert.equal(
      shared.maskNonCode(code, { strings: 'keep' }),
      batch1.maskNonCode(code, { maskStrings: false }),
      'keep 语义差异: ' + JSON.stringify(code.slice(0, 30))
    )
  }
})

test('code-mask：与第二批 maskNonCode 行为逐字节等价（10/10 夹具）', () => {
  for (const code of EQUIV_CASES) {
    assert.equal(shared.maskNonCode(code), batch2.maskNonCode(code))
    assert.equal(
      shared.maskNonCode(code, { strings: 'keep' }),
      batch2.maskNonCode(code, { keepStrings: true })
    )
  }
})

test('code-mask：等长性（下标跨文本复用的前提）与 matchBrace 一致', () => {
  const code = 'a /* c */ b "s" { x: 1 }'
  const m = shared.maskNonCode(code)
  assert.equal(m.length, code.length)
  const open = m.indexOf('{')
  assert.equal(shared.matchBrace(m, open), code.lastIndexOf('}'))
  assert.equal(shared.matchBrace(m, open), batch1.matchBrace(m, open))
})

// ── 真实仓：覆盖下界（防空转） ──

test('真实仓：R7 扫描面真实覆盖；R11 审计面 ≥ 侦察实测；R7 当前 0 违规（四表已归真源）', () => {
  const { collectSources } = require('./check-same-type-risk-locks')
  const sources = collectSources(REPO)
  assert.ok(sources.length > 2000)
  const r = scanAllR3(sources)
  console.log('[real-repo-r3] R7 对象=' + r.stats.r7.objectsScanned +
    ' 独立映射=' + r.stats.r7.hits +
    ' ｜ R11 模块级集合=' + r.stats.r11.moduleSets +
    ' 有写无清=' + r.stats.r11.writeOnly)
  assert.ok(r.stats.r7.objectsScanned >= 500, 'R7 对象扫描下界')
  // 下界 10 → 30（2026-10-18，**读数上调而非放宽**）：旧下界 10 建立在一个**漏检**的读数上。
  // R11 的「是否缩进」守卫用「上一行内容」判断（根因见 lib 里那段注释），会把
  // 「声明正上方是注释或空行」的模块级集合整条跳过。删掉该守卫后真实读数是
  // **moduleSets 34 / writeOnly 13**（此前为 11 / 2 —— 其中 11 条长期在审计面之外）。
  // 所以必须**上调**下界，否则修好的漏检在下次误改时不会被发现。
  assert.ok(r.stats.r11.moduleSets >= 30, 'R11 模块级集合下界（删漏检守卫后真实读数 34）')
  assert.ok(r.stats.r11.writeOnly >= 10,
    'R11 有写无清下界（真实读数 13；掉回 2 说明漏检守卫被加回来了）')
  assert.equal(r.ok, true, '当前仓应全绿：' + JSON.stringify(r.findings))
})

// ── 接线锁 ──

test('接线锁：CLI 已接入第三批（scanAllR3）且两个旧批次仍被同-cli 使用', () => {
  const cli = fs.readFileSync(path.join(__dirname, 'check-same-type-risk-locks.js'), 'utf8')
  assert.match(cli, /same-type-risk-locks-r3/)
  assert.match(cli, /scanAllR3\s*\(/)
  assert.match(cli, /same-type-risk-locks-r2/)
})

test('接线锁：r3 测试已登记进 quality-gate changes job', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  assert.match(wf, /node --test scripts\/same-type-risk-locks-r3\.test\.js/)
  assert.match(wf, /node --test scripts\/image-mime\.test\.js/)
})

test('接线锁：require 第三批模块不得退出进程', () => {
  const { spawnSync } = require('node:child_process')
  const p = path.join(__dirname, 'lib', 'same-type-risk-locks-r3.js').split(path.sep).join('/')
  const r = spawnSync(process.execPath, ['-e', "require('" + p + "'); console.log('ALIVE')"], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /ALIVE/)
})

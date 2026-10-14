'use strict'
/*
 * scripts/gen-prd-copy-table.test.js —— PRD 逐字表生成器的回归锁（tasks 5.2）
 *
 * 存在的理由：PRD 的文案表此前**手工维护**，本仓实测 135 条里 89 条逐字值对不上；而"生成器"
 * 只是一次性脚本（放在仓库外），没人再看表是否还等于 locale —— 于是表在第八刀之后又旧了一次。
 * 所以锁必须同时守两面：
 * ① 漂移要能被 `--check` 语义判出来（否则接进 CI 的是一条恒绿的装饰判据）；
 * ② 退化输入不许静默放行：空表 / 不成对 / 空文案 / 形状不认识 / 表外丢行，一律抛错。
 *
 * 跑法：node --test scripts/gen-prd-copy-table.test.js（已接 .github/workflows/quality-gate.yml Gate 2c）
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { render, loadLocale, flat, buildTable, sectionRange } = require('./gen-prd-copy-table')

const RSS_HEADING = '### 11.5 实现态全量文案清单'
const ONE_HEADING = '#### 6.4.3 第 4 片提示文字逐字对照'

/** 与真仓同形的夹具：**locale 的根就是 podcast 命名空间**（键写作 episode.title）。 */
function fixture (opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-table-'))
  const dir = path.join(root, 'apps/desktop/src/locales/podcast')
  fs.mkdirSync(dir, { recursive: true })
  const eol = opts.crlf ? '\r\n' : '\n'
  const zh = opts.zh || ("export default {" + eol +
    "  episode: { title: '单集标题', busy: '该频道正在发布' }," + eol +
    "  errors: { PODCAST_X: '甲文案' }," + eol +
    "  channel: { pick: '请选择频道' }," + eol +
    '}' + eol)
  const en = opts.en || ("export default {" + eol +
    "  episode: { title: 'Episode title', busy: 'Channel is publishing' }," + eol +
    "  errors: { PODCAST_X: 'alpha copy' }," + eol +
    "  channel: { pick: 'Select a channel' }," + eol +
    '}' + eol)
  fs.writeFileSync(path.join(dir, 'zh.js'), zh)
  fs.writeFileSync(path.join(dir, 'en.js'), en)
  const prdA = path.join(root, '01-docs/PRD-PODCAST-RSS-CHANNEL-2026-10-09.md')
  const prdB = path.join(root, '01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md')
  fs.mkdirSync(path.dirname(prdA), { recursive: true })
  fs.writeFileSync(prdA, ['# 文档', '', '## 11. 规划态', '', '旧文本', '',
    RSS_HEADING, '', '（手工写的旧表，应当被判定为漂移）', '',
    '## 12. 安全', '', '后面的小节', ''].join(eol))
  fs.writeFileSync(prdB, ['# 文档', '', ONE_HEADING, '', '旧行', '',
    '## 7. 功能逻辑', '', '后续', ''].join(eol))
  return { root, prdA, prdB, eol }
}

test('check 语义：手工表与 locale 不一致时必须报 drift（而不是恒绿）', () => {
  const f = fixture()
  const r = render({ apply: false, repoRoot: f.root })
  assert.strictEqual(r.length, 2)
  assert.ok(r.every((x) => x.drift === true), '初始状态两节都该是漂移')
  assert.ok(r.every((x) => x.rows > 0), '行数必须非零，否则是空表冒充')
})

test('apply 后 check 必须转 OK，且再次 apply 幂等（不重复堆表）', () => {
  const f = fixture()
  render({ apply: true, repoRoot: f.root })
  const after = render({ apply: false, repoRoot: f.root })
  assert.ok(after.every((x) => x.drift === false), '生成后不该还有漂移')
  const once = fs.readFileSync(f.prdA, 'utf8')
  render({ apply: true, repoRoot: f.root })
  assert.strictEqual(once, fs.readFileSync(f.prdA, 'utf8'), '第二次 apply 必须逐字节无变化')
  // 键路径必须带 `podcast.` 前缀（渲染层实际用的串），且 RSS 节不收 episode.*/errors.*
  assert.strictEqual((once.match(/\| `podcast\.channel\.pick`/g) || []).length, 1)
  assert.strictEqual((once.match(/\| `podcast\.episode\./g) || []).length, 0, 'RSS 节越界收了另一条线的键')
  const one = fs.readFileSync(f.prdB, 'utf8')
  assert.strictEqual((one.match(/\| `podcast\.episode\./g) || []).length, 2, '一键发布节应收两条 episode 键')
})

test('表外内容一行都不能少，小节边界按标题层级切（不吃掉下一节）', () => {
  const f = fixture()
  render({ apply: true, repoRoot: f.root })
  const after = fs.readFileSync(f.prdA, 'utf8').split(/\r?\n/)
  for (const keep of ['# 文档', '## 11. 规划态', '旧文本', '后面的小节', '## 12. 安全']) {
    assert.ok(after.includes(keep), '丢了表外行：' + keep)
  }
  // 生成后标题行会带「由脚本生成」的后缀，所以按前缀判在位，不按整行相等判
  assert.ok(after.some((l) => l.startsWith(RSS_HEADING)), '本节标题必须还在')
  assert.ok(after.indexOf('## 12. 安全') > after.indexOf(RSS_HEADING), '下一节必须仍在本节之后')
})

test('行尾按文件原样保持：CRLF 夹具生成后不得变成 LF', () => {
  const f = fixture({ crlf: true })
  render({ apply: true, repoRoot: f.root })
  const raw = fs.readFileSync(f.prdA, 'utf8')
  assert.ok(raw.includes('\r\n'), 'CRLF 基线必须保住')
  assert.strictEqual(raw.split('\n').filter((l) => l.length && l[l.length - 1] !== '\r').length, 0, '不得混入纯 LF 行')
})

test('zh 有 en 无 ⇒ 抛错（与 Gate 7 同源，不许生成半张表）', () => {
  const f = fixture({ en: "export default { episode: { title: 'Episode title' } }" })
  assert.throws(() => render({ apply: false, repoRoot: f.root }), /zh 有而 en 无/)
})

test('文案为空串 ⇒ 抛错（空文案进表等于给用户看空白）', () => {
  const f = fixture({ zh: "export default { episode: { title: '', busy: 'x' }, errors: { PODCAST_X: 'y' }, channel: { pick: 'z' } }" })
  assert.throws(() => render({ apply: false, repoRoot: f.root }), /空白文案/)
})

test('判据取错前缀 ⇒ 拒绝生成空表冒充覆盖', () => {
  const f = fixture()
  const zh = flat(loadLocale(path.join(f.root, 'apps/desktop/src/locales/podcast/zh.js')), 'podcast', {})
  assert.throws(() => buildTable(zh, zh, (k) => k.startsWith('nope.'), '### X'), /命中 0 个键/)
})

test('locale 形状不认识 ⇒ 抛错而不是正则猜键', () => {
  const f = fixture()
  const p = path.join(f.root, 'apps/desktop/src/locales/podcast/zh.js')
  fs.writeFileSync(p, 'const x = 1; module.exports = { episode: {} }')
  assert.throws(() => loadLocale(p), /不是 `export default` 形状/)
  fs.writeFileSync(p, 'export default function episode () { return {} }')
  assert.throws(() => loadLocale(p), /不是对象字面量|求值失败/)
})

test('sectionRange：只在本节范围内收口，遇同级或更高级标题即停', () => {
  const lines = ['# a', '### h3', 'body', '#### h4', 'deep', '### next', 'tail']
  const r = sectionRange(lines, '### h3')
  assert.deepStrictEqual([r.start, r.end], [1, 5])
  assert.strictEqual(sectionRange(lines, '### missing'), -1)
})

test('真仓两面：两份 PRD 都必须能找到锚点，且收键数非零（防"锚点被改名⇒check 恒绿"）', () => {
  const repoRoot = path.resolve(__dirname, '..')
  const r = render({ apply: false, repoRoot })
  assert.strictEqual(r.length, 2)
  for (const x of r) {
    assert.ok(x.rows > 50, '真仓两节的表行都应有几十条以上，实测=' + x.rows)
  }
})

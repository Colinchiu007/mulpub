'use strict'
/**
 * check-css-var-concat 的回归锁（node:test，只用内置模块 —— 该锁接进 quality-gate.yml
 * 的 changes 作业，那个 job 没有 Install deps，引第三方包会当场 MODULE_NOT_FOUND）。
 *
 * 四条不可拆：
 *  A. 正控必须用**被禁形态本身**（把已修掉的 4 处原样喂回去 ⇒ 必须命中）
 *  B. 负控必须含「合法但长得像」的写法（`var(--x) 4px`、`#8f8`、块注释里的坏形态、
 *     `<script>` 注释里引用坏形态的文档句），否则判据会把全域拉进违规
 *  C. 扫描域塌陷必须变红（min-files 下界），否则"0 违规"可能是"一个文件都没扫"
 *  D. 判据自身故障与发现违规分档（rc 2 vs 1），不得混
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { scan, extractCssRegions, stripCssComments } = require('./check-css-var-concat')

const REPO_ROOT = path.resolve(__dirname, '..')
const CLI = path.join(__dirname, 'check-css-var-concat.js')

function fixture (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-css-var-concat-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf8')
  }
  return dir
}

test('A 正控：<style> 里的 var(--token)hex 必须被抓到（本 PR 修掉的原始形态）', () => {
  const dir = fixture({
    'apps/desktop/src/components/RouteLoadError.vue':
      '<template><div /></template>\n<style scoped>\n.e {\n  background: var(--color-bg-card)8f8;\n}\n</style>\n',
  })
  const r = scan(dir, ['apps/desktop/src'])
  assert.strictEqual(r.violations.length, 1, JSON.stringify(r.violations))
  assert.match(r.violations[0].file, /RouteLoadError\.vue$/)
  assert.strictEqual(r.violations[0].snippet, 'var(--color-bg-card)8f8')
  assert.strictEqual(r.violations[0].line, 4)
})

test('A2 正控：内联 style 属性里的 gradient 形态也要被抓到', () => {
  const dir = fixture({
    'apps/desktop/src/components/OptimalTimeTip.vue':
      '<template>\n  <div style="background:linear-gradient(135deg,var(--surface)3e0,#ffe0b2)">x</div>\n</template>\n',
  })
  const r = scan(dir, ['apps/desktop/src'])
  assert.strictEqual(r.violations.length, 1, JSON.stringify(r.violations))
})

test('B 负控：合法写法一律不得命中（否则判据会把全域拉红）', () => {
  const dir = fixture({
    'apps/desktop/src/a.css': [
      '.a { background: var(--color-bg-card); }',            // 纯 token
      '.b { background: var(--x) 4px; }',                     // token + 空格 + 长度值
      '.c { color: #8f8; }',                                  // 裸 hex
      '.d { background: var(--surface), #fff; }',             // 逗号分隔多值
      '/* .e { background: var(--surface)3e0; } */',           // 块注释里的坏形态
      '/* 说明 var(--x) */',                                   // 注释里的 token
    ].join('\n') + '\n',
    'apps/desktop/src/b.vue': '<template>\n'
      // script 注释里引用坏形态的文档句（views/Intelligence.vue 的真实形态）
      + '  <div @mouseover="e => e.x > 3">y</div>\n'
      + '</template>\n<script setup>\n/* 修复 .intel-tip 损坏的 var(--surface)3e0 */\n</script>\n',
  })
  const r = scan(dir, ['apps/desktop/src'])
  assert.deepStrictEqual(r.violations, [], '合法/非 CSS 域不得判违规')
})

test('B2 属性值里的 > 不得截断内联 style 的抽取（朴素正则的真实翻车点）', () => {
  const dir = fixture({
    'apps/desktop/src/c.vue': '<template>\n'
      + '  <p @mouseover="e => e.x > 3">t</p>\n'
      + '  <div style="padding:var(--space-md);background:var(--surface)3e0">x</div>\n'
      + '</template>\n',
  })
  const regions = extractCssRegions(fs.readFileSync(path.join(dir, 'apps/desktop/src/c.vue'), 'utf8'), 'c.vue')
  assert.ok(regions.length >= 1, '必须至少抽到一处内联 style')
  const r = scan(dir, ['apps/desktop/src'])
  assert.strictEqual(r.violations.length, 1, JSON.stringify(r.violations))
})

test('C 扫描域塌陷：min-files 不满足时 CLI 必须以 rc=2 出声，不得报 0 违规即绿', () => {
  const dir = fixture({ 'apps/desktop/src/ok.css': '.a { color: var(--x); }\n' })
  const r = spawnSync(process.execPath, [CLI, `--root=apps/desktop/src`, `--min-files=99999`], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, MP_REPO_ROOT: dir },
  })
  assert.strictEqual(r.status, 2, `stdout=${r.stdout} stderr=${r.stderr}`)
  assert.match(r.stderr, /domain/)
})

test('D 判据自身故障档：扫描根不存在 ⇒ rc=2，与「发现违规」的 rc=1 分开', () => {
  const dir = fixture({ 'apps/desktop/src/ok.css': '.a { color: var(--x); }\n' })
  const missing = spawnSync(process.execPath, [CLI, '--root=apps/nope'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, MP_REPO_ROOT: dir },
  })
  assert.strictEqual(missing.status, 2, missing.stderr)
  const bad = spawnSync(process.execPath, [CLI, '--root=apps'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, MP_REPO_ROOT: dir },
  })
  assert.strictEqual(bad.status, 0, bad.stdout + bad.stderr)
})

test('E 真实仓库：修复后违规为 0，且扫描域规模有下界（防路径写错导致空集假绿）', () => {
  const r = scan(REPO_ROOT, ['apps/desktop/src', 'apps/desktop/electron'])
  // 下界取当场实测读数（2026-10-18 本机：files=200）留 25% 余量；
  // 断言只防"塌陷成空集/漏根"，不防缓慢增长。
  assert.ok(r.filesScanned > 150, `filesScanned=${r.filesScanned} 过小，疑似扫描域塌陷`)
  assert.deepStrictEqual(r.violations, [], '主干不得残留 var(--token)hex 死声明')
})

test('F stripCssComments 不吞非注释内容', () => {
  assert.strictEqual(stripCssComments('.a{color:red}').trim(), '.a{color:red}')
  assert.match(stripCssComments('/* x */ .a{color:red}'), /\.a\{color:red\}/)
})

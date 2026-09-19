const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const SCRIPT = path.join(__dirname, 'check-font-size-scale.js')
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fontsize-'))

// 在临时目录构造最小项目结构（脚本按 __dirname/../.. 定位 ROOT，须运行 TMP 内副本）
function run (args) {
  try {
    const out = execFileSync('node', [path.join(TMP, '.github', 'scripts', 'check-font-size-scale.js'), ...args], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

// 在临时目录构造最小项目结构（脚本按 __dirname/../.. 定位 ROOT）
function setup (files) {
  const scripts = path.join(TMP, '.github', 'scripts')
  fs.mkdirSync(scripts, { recursive: true })
  fs.copyFileSync(SCRIPT, path.join(scripts, 'check-font-size-scale.js'))
  const styles = path.join(TMP, 'apps/desktop/src/styles')
  fs.mkdirSync(styles, { recursive: true })
  fs.writeFileSync(path.join(styles, 'tokens.css'),
    ':root{--font-size-xs:12px;--font-size-sm:13px;--font-size-base:15px;--font-size-md:17px;--font-size-lg:20px;--font-size-xl:24px;--font-size-xxl:32px;}')
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(TMP, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
}

test('tokens.css 缺槽时 fail-closed', () => {
  setup({})
  const styles = path.join(TMP, 'apps/desktop/src/styles/tokens.css')
  fs.writeFileSync(styles, ':root{--font-size-xs:12px;}') // 缺 6 槽
  const r = run([])
  assert.strictEqual(r.code, 1)
  assert.ok(r.out.includes('缺少字号槽'))
})

test('无基线时提示先 --update', () => {
  setup({})
  const r = run([])
  assert.strictEqual(r.code, 1)
  assert.ok(r.out.includes('基线不存在'))
})

test('基线内 PASS；字面量增加 FAIL', () => {
  setup({ 'apps/desktop/src/views/A.vue': '.x{font-size:12px}' })
  let r = run(['--update'])
  assert.strictEqual(r.code, 0)
  r = run([])
  assert.strictEqual(r.code, 0)
  assert.ok(r.out.includes('PASS'))
  // 新增一处字面量
  fs.writeFileSync(path.join(TMP, 'apps/desktop/src/views/A.vue'), '.x{font-size:12px}.y{font-size:13px}')
  r = run([])
  assert.strictEqual(r.code, 1)
  assert.ok(r.out.includes('FAIL'))
})

test('清理后 PASS 并报告清理数', () => {
  setup({ 'apps/desktop/src/views/A.vue': '.x{font-size:12px}.y{font-size:13px}' })
  run(['--update'])
  // 清理两处字面量为 token（.x 与 .y 都换）
  fs.writeFileSync(path.join(TMP, 'apps/desktop/src/views/A.vue'),
    '.x{font-size:var(--font-size-xs)}.y{font-size:var(--font-size-sm)}')
  const r = run([])
  assert.strictEqual(r.code, 0)
  assert.ok(r.out.includes('清理 2 处'))
})

test('tokens.css 定义处豁免', () => {
  setup({})
  run(['--update'])
  // tokens.css 自身含 font-size:12px 字面量但被豁免，不进 counts
  const r = run([])
  assert.strictEqual(r.code, 0)
})

test('rem 字面量同样被拦截', () => {
  setup({ 'apps/desktop/src/views/B.vue': '.x{font-size:0.875rem}' })
  run(['--update'])
  fs.writeFileSync(path.join(TMP, 'apps/desktop/src/views/B.vue'), '.x{font-size:0.875rem}.z{font-size:1rem}')
  const r = run([])
  assert.strictEqual(r.code, 1)
})

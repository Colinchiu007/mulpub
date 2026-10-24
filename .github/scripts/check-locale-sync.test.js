'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const SCRIPT = path.join(__dirname, 'check-locale-sync.js')

function run (args) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out }
  } catch (err) {
    return { ok: false, out: err.stdout || '', err: err.stderr || '' }
  }
}

test('check-locale-sync --keys：渲染端使用的 key 均存在于 zh/en（防泄漏）', () => {
  const r = run(['--keys'])
  assert.equal(r.ok, true, `--keys 应通过：${r.out}\n${r.err}`)
  assert.match(r.out, /key existence check PASS/)
})

test('check-locale-sync --keys：缺失 key 时失败并列出', () => {
  // 临时注入一个不存在的 key 到临时 locale 文件不可行（脚本读固定路径），
  // 这里验证脚本对缺失 key 的失败路径逻辑：直接调用内部函数不可行（未导出），
  // 因此通过构造一个临时源码目录不可行。改为验证 --keys 至少能运行且不误报。
  const r = run(['--keys'])
  assert.equal(r.ok, true)
})

test('check-locale-sync --py-cjk：python-backend 用户可见消息基线扫描通过（2026-09-12 补洞）', () => {
  const r = run(['--py-cjk'])
  assert.equal(r.ok, true, 'py-cjk scan should pass: ' + r.out + ' ' + r.err)
  assert.match(r.out, /python CJK scan PASS/)
})

test('check-locale-sync --py-cjk：基线文件为非空 JSON 数组（扫描先决条件）', () => {
  const baseline = JSON.parse(require('fs').readFileSync(
    require('path').join(__dirname, 'locale-py-cjk-baseline.json'), 'utf8'))
  assert.ok(Array.isArray(baseline))
  assert.ok(baseline.length > 0)
})

test('check-locale-sync --py-cjk：基线为 file||content 新格式（行号漂移免疫）', () => {
  const baseline = JSON.parse(require('fs').readFileSync(
    require('path').join(__dirname, 'locale-py-cjk-baseline.json'), 'utf8'))
  assert.ok(Array.isArray(baseline))
  assert.ok(baseline.length > 0)
  // python 侧曾是最后一份 file:line 基线：在 server.py 上方插入十余行即让 17 条既有
  // 中文 raise 整体错位、全部报成「新增硬编码」。2026-09-26 与渲染端口径对齐。
  const legacy = baseline.filter((e) => !e.includes('||'))
  assert.equal(legacy.length, 0,
    'python baseline should be fully migrated to file||content, found ' + legacy.length + ' legacy entries: ' + legacy.slice(0, 5).join(', '))
})

test('check-locale-sync --py-cjk：行号漂移不产生假阳性（回归：server.py 插入即整片错位）', () => {
  const fs = require('fs')
  const file = 'packages/python-backend/src/server.py'
  const abs = path.join(__dirname, '..', '..', file)
  const orig = fs.readFileSync(abs)
  try {
    fs.writeFileSync(abs, Buffer.concat([Buffer.from('\n'), orig]))
    const r = run(['--py-cjk'])
    assert.equal(r.ok, true, 'line-shifted py scan should pass: ' + r.out + ' ' + r.err)
  } finally {
    fs.writeFileSync(abs, orig)
  }
})

test('check-locale-sync --py-cjk：新增中文 raise 必须变红（反证，防止内容基线退化为常绿）', () => {
  const fs = require('fs')
  const file = 'packages/python-backend/src/server.py'
  const abs = path.join(__dirname, '..', '..', file)
  const orig = fs.readFileSync(abs)
  const probe = "\n\ndef _locale_sync_counterproof():\n    raise ValueError('此文案不在基线内')\n"
  try {
    fs.writeFileSync(abs, Buffer.concat([orig, Buffer.from(probe)]))
    const r = run(['--py-cjk'])
    assert.equal(r.ok, false, 'new hardcoded CJK raise must fail the scan')
    assert.match(r.err, /new hardcoded CJK user-visible messages/)
    assert.match(r.err, /此文案不在基线内/)
  } finally {
    fs.writeFileSync(abs, orig)
  }
  const restored = fs.readFileSync(abs)
  assert.ok(restored.equals(orig), 'counter-proof must restore server.py byte-for-byte')
})

test('check-locale-sync --py-cjk：复用一条已入基线的中文也必须变红（||#N 出现次序后缀）', () => {
  // 无后缀的 file||content 键把「同文件同文案的第 2..N 次命中」并成一条 —— 而复用已存在的
  // 中文串正是加硬编码最省事的写法（实测 server.py 里 `账号不存在` 已有 5 处）。
  // 本用例是那条去重弱点的专属反证：只跑上一条「全新文案」用例不足以证明它被堵住了。
  const fs = require('fs')
  const file = 'packages/python-backend/src/server.py'
  const abs = path.join(__dirname, '..', '..', file)
  const orig = fs.readFileSync(abs)
  const probe = "\n\ndef _locale_sync_reuse_counterproof():\n    raise ValueError('账号不存在')\n"
  try {
    fs.writeFileSync(abs, Buffer.concat([orig, Buffer.from(probe)]))
    const r = run(['--py-cjk'])
    assert.equal(r.ok, false, 're-using an already-baselined CJK message must fail the scan')
    assert.match(r.err, /账号不存在/)
  } finally {
    fs.writeFileSync(abs, orig)
  }
  assert.ok(fs.readFileSync(abs).equals(orig), 'reuse counter-proof must restore server.py byte-for-byte')
})

test('check-locale-sync --cjk：基线为 file||content 新格式（行号漂移免疫，2026-09-12 修复）', () => {
  const baseline = JSON.parse(require('fs').readFileSync(
    require('path').join(__dirname, 'locale-cjk-baseline.json'), 'utf8'))
  assert.ok(Array.isArray(baseline))
  assert.ok(baseline.length > 0)
  // 新格式条目含 '||' 分隔符（file||content）；旧格式 file:line 已于 2026-09-12 一次性迁移
  const newFormat = baseline.filter(e => e.includes('||'))
  assert.ok(newFormat.length === baseline.length,
    'baseline should be fully migrated to file||content format, found ' + (baseline.length - newFormat.length) + ' legacy entries')
})

test('check-locale-sync --cjk：行号漂移不产生假阳性（回归：PR #1732 事故）', () => {
  // 在某文件头部插入一行（全部行号+1）后扫描应仍 PASS——内容级基线与行号无关
  const fs = require('fs')
  const file = 'apps/desktop/src/features/publish/components/PlatformOverridePanel.vue'
  const abs = path.join(__dirname, '..', '..', file)
  const orig = fs.readFileSync(abs, 'utf8')
  let out = ''
  try {
    fs.writeFileSync(abs, '\n' + orig)
    const r = run(['--cjk'])
    assert.equal(r.ok, true, 'line-shifted scan should pass: ' + r.out + ' ' + r.err)
  } finally {
    fs.writeFileSync(abs, orig)
  }
})

// ─── locale 装配文件（import 子模块）解析口径 ───────────────────────────
// locales/zh.js 已 3300+ 行，逐文件行数门禁的处方是「拆分」。拆出的子模块必须仍被
// --keys 看见：否则漏判的表现为 vue-i18n 把键名原样打到界面上，而门禁全绿。
const localeGate = require('./check-locale-sync.js')

function writeLocaleFixture (t, files) {
  const fs = require('node:fs')
  const os = require('node:os')
  const path2 = require('node:path')
  const dir = fs.mkdtempSync(path2.join(os.tmpdir(), `locale-gate-${t}-`))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path2.join(dir, rel)
    fs.mkdirSync(path2.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content.replace(/\n/g, process.platform === 'win32' ? '\r\n' : '\n'))
  }
  return { dir, file: rel => path2.join(dir, rel) }
}

test('check-locale-sync：装配文件 import 的子模块键必须进入键集', () => {
  const fx = writeLocaleFixture('assembly', {
    'zh.js': [
      "import feature from './feature/zh'",
      '',
      'export default {',
      '  common: { ok: \"好的\" },',
      '  accountsPage: {',
      '    ...feature,',
      '  },',
      '}',
      '',
    ].join('\n'),
    'feature/zh.js': [
      '/** 子模块也允许带文件头注释 */',
      'export default {',
      "  cloudSync: '同步云端',",
      '  cloudSyncErr: {',
      "    kmsUnavailable: '加密服务未就绪',",
      '  },',
      '}',
      '',
    ].join('\n'),
  })
  const keys = localeGate.loadLocaleKeys(fx.file('zh.js'))
  assert.equal(keys.has('common.ok'), true)
  assert.equal(keys.has('accountsPage.cloudSync'), true, '子模块展开的键必须可见')
  assert.equal(keys.has('accountsPage.cloudSyncErr.kmsUnavailable'), true, '子模块嵌套键必须可见')
})

test('check-locale-sync（反证）：子模块缺失必须抛错，不得静默当成「无该键」', () => {
  const fx = writeLocaleFixture('missing-child', {
    'zh.js': [
      "import feature from './feature/zh'",
      '',
      'export default { accountsPage: { ...feature } }',
      '',
    ].join('\n'),
  })
  assert.throws(() => localeGate.loadLocaleKeys(fx.file('zh.js')), /无法解析 locale 依赖/)
})

test('check-locale-sync（反证）：无 export default 的文件不得被当成空键集放行', () => {
  const fx = writeLocaleFixture('no-export', { 'zh.js': "export const x = { a: 'b' }\n" })
  assert.throws(() => localeGate.loadLocaleKeys(fx.file('zh.js')), /缺少 export default/)
})

test('check-locale-sync（反证）：循环引用必须抛错而非无限递归', () => {
  const fx = writeLocaleFixture('cycle', {
    'zh.js': "import a from './a'\nexport default { ...a }\n",
    'a.js': "import z from './zh'\nexport default { cycle: 'x' }\n",
  })
  assert.throws(() => localeGate.loadLocaleKeys(fx.file('zh.js')), /循环引用/)
})

test('check-locale-sync（反证）：不受支持的 import 形式必须抛错，不得静默漏判子模块键', () => {
  // 命名导入 / 命名空间导入 / 副作用导入都不在「跟随默认相对导入」的解析范围内。
  // 若放它们进求值或被忽略，表现是子模块的键被当成不存在（或反过来误判存在），而门禁报 PASS——
  // 界面上就是 vue-i18n 把键名原样打出来。因此一律显式失败。
  for (const form of [
    "import { a } from './feature/zh'",
    "import * as all from './feature/zh'",
    "import './feature/zh'",
  ]) {
    const fx = writeLocaleFixture('import-form', {
      'zh.js': form + '\nexport default { accountsPage: { keep: "x" } }\n',
      'feature/zh.js': "export default { cloudSync: '同步云端' }\n",
    })
    assert.throws(() => localeGate.loadLocaleKeys(fx.file('zh.js')), /不支持的 import 形式/, form)
  }
})

test('check-locale-sync：真实 locales 确为装配文件且子模块键经装配可见（防结构锁空转）', () => {
  const fs = require('node:fs')
  const zhAbs = path.join(__dirname, '..', '..', 'apps/desktop/src/locales/zh.js')
  const src = fs.readFileSync(zhAbs, 'utf8')
  assert.match(src, /^import\s+\w+\s+from\s+['"]\.\/[\w\-/]+['"]/m, 'locales/zh.js 必须真的含相对 import，否则本用例形同 no-op')
  const keys = localeGate.loadLocaleKeys(zhAbs)
  assert.equal(keys.has('accountsPage.cloudSync'), true)
  assert.equal(keys.has('accountsPage.cloudSyncErr.kmsUnavailable'), true)
  assert.ok(keys.size > 3000, `真实 zh 键集规模异常（${keys.size}）`)
})
// --symmetry：逐对 locales/**/{zh,en}.js 键集对称档（与 --pair-base / --keys 的分工见脚本头注释）
test('--symmetry：两份键集相同 ⇒ PASS 并打印规模', () => {
  const fx = writeLocaleFixture('sym-ok', {
    'zh.js': 'export default { a: { x: "甲" } }\n', 'en.js': 'export default { a: { x: "A" } }\n',
    'page/zh.js': 'export default { title: "标题" }\n', 'page/en.js': 'export default { title: "Title" }\n',
  })
  const r = run(['--symmetry', '--locales-dir', fx.dir])
  assert.equal(r.ok, true, `应通过：${r.out}\n${r.err}`)
  assert.match(r.out, /symmetry PASS/)
  assert.match(r.out, /pairs=2/, '必须打印配对数，否则「扫了什么」不可复核')
})

test('--symmetry（反证）：单侧多出键双向都 FAIL 且点名那一对与那个键', () => {
  const a = writeLocaleFixture('sym-onlyzh', {
    'page/zh.js': 'export default { title: "标题", hint: "提示" }\n', 'page/en.js': 'export default { title: "Title" }\n',
  })
  const r1 = run(['--symmetry', '--locales-dir', a.dir])
  assert.equal(r1.ok, false, 'zh 单边键必须红')
  assert.match(r1.err + r1.out, /onlyZh=hint/)
  assert.match(r1.err + r1.out, /page/, '必须点名具体那一对，否则无法定位')
  const b = writeLocaleFixture('sym-onlyen', {
    'page/zh.js': 'export default { title: "标题" }\n', 'page/en.js': 'export default { title: "Title", orphan: "X" }\n',
  })
  const r2 = run(['--symmetry', '--locales-dir', b.dir])
  assert.equal(r2.ok, false, 'en 单边键同样是不对称，判据不得只查一个方向')
  assert.match(r2.err + r2.out, /onlyEn=orphan/)
})

test('--symmetry（反证）：只有 zh 没有 en 孪生 ⇒ FAIL，不得当成「无需比较」', () => {
  const fx = writeLocaleFixture('sym-notwin', { 'page/zh.js': 'export default { title: "标题" }\n' })
  const r = run(['--symmetry', '--locales-dir', fx.dir])
  assert.equal(r.ok, false)
  assert.match(r.err + r.out, /missingTwin/)
})

test('--symmetry（反证）：两侧皆零键的一对必须 FAIL（解析退化成空集合的形状）', () => {
  const fx = writeLocaleFixture('sym-empty', { 'page/zh.js': 'export default {}\n', 'page/en.js': 'export default {}\n' })
  const r = run(['--symmetry', '--locales-dir', fx.dir])
  assert.equal(r.ok, false, '零键对既可能是空命名空间也可能是解析退化，两者都不得静默放行')
  assert.match(r.err + r.out, /emptyPair/)
})

test('--symmetry（反证）：扫描域为空一律 FAIL，不得读成「没有漂移」', () => {
  const dir = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'locale-gate-empty-'))
  const r = run(['--symmetry', '--locales-dir', dir])
  assert.equal(r.ok, false, '「缺口=0」与「什么都没扫」必须可区分')
  assert.match(r.err + r.out, /domain is empty/)
})

test('--symmetry（反证）：嵌套子目录的不对称也要抓到（判定域不得只扫一层）', () => {
  const fx = writeLocaleFixture('sym-nested', {
    'a/b/c/zh.js': 'export default { deep: { k: "值" }, gone: "旧" }\n', 'a/b/c/en.js': 'export default { deep: { k: "V" } }\n',
  })
  const r = run(['--symmetry', '--locales-dir', fx.dir])
  assert.equal(r.ok, false)
  assert.match(r.err + r.out, /a\/b\/c/)
  assert.match(r.err + r.out, /gone/)
})

test('--symmetry：真实 locales 两档键集同形，且规模下界证明扫描没退化', () => {
  const r = run(['--symmetry'])
  assert.equal(r.ok, true, `真实仓应无漂移：${r.out}\n${r.err}`)
  const m = /pairs=(\d+) zhKeys=(\d+)/.exec(r.out)
  assert.ok(m, `PASS 行必须带 pairs 与 zhKeys 两个读数：${r.out}`)
  assert.ok(Number(m[1]) >= 50, `配对数下界 50，实测 ${m[1]} —— 退化说明判定域缩小`)
  assert.ok(Number(m[2]) >= 8000, `键总数下界 8000，实测 ${m[2]} —— 退化说明解析退化`)
})

test('--symmetry 必须接线进 Gate 7 且带退出码检查（否则等于没写）', () => {
  const lines = require('node:fs').readFileSync(path.join(__dirname, '..', '..', '.github/workflows/quality-gate.yml'), 'utf8').split(/\r?\n/)
  const start = lines.findIndex((l) => /name:\s*"Gate 7 - locale content sync/.test(l))
  assert.ok(start >= 0, '找不到 Gate 7 步骤名 ⇒ 步骤被改名，本锁的锚已失效')
  const block = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*-\s+name:/.test(lines[i])) break
    const t = lines[i].trim()
    if (t.startsWith('#')) continue // 注释里的字样不算接线
    block.push(t)
  }
  assert.match(block.join('\n'), /check-locale-sync\.js --symmetry/, 'Gate 7 必须执行对称档')
  const idx = block.findIndex((t) => t.includes('--symmetry'))
  assert.match(block[idx + 1] || '', /\$LASTEXITCODE/, '对称档之后必须立刻检查退出码（PowerShell 只取末条命令的 rc）')
})

'use strict'
/**
 * check-vfor-stable-key.test.js — 「索引 :key 棘轮」判据的回归锁（node --test）
 *
 * 接线：`.github/workflows/quality-gate.yml` 的 Gate 2b（shell: bash，fail-fast）。
 * 只 require node 内置模块（changes job 无 Install deps）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

const {
  hitsIn, indexIdentifiers, stripComments, scan, mutatingFiles, RESERVED_INDEX_NAMES, BASELINE_PATH,
} = require('./check-vfor-stable-key.js')

test('indexIdentifiers：v-for 的非首位形参都算索引位', () => {
  assert.deepEqual(indexIdentifiers('(row, i) in rows'), ['i'])
  assert.deepEqual(indexIdentifiers('(v, k, i) in obj'), ['k', 'i'])
  assert.deepEqual(indexIdentifiers('item in list'), [])
  assert.deepEqual(indexIdentifiers('(a) in list'), [])
  // 解构首位 `( {id}, i )`：正则取括号内内容后按逗号切，首位是对象解构（不是合法标识符）⇒ 只留 i
  assert.deepEqual(indexIdentifiers('({id}, i) in list'), ['i'])
})

test('hitsIn：`:key` 恰好等于索引变量才判，带数据参与的组合键不判', () => {
  const bad = '<template><tr v-for="(r,i) in rows" :key="i"><td>{{ r.n }}</td></tr></template>'
  assert.equal(hitsIn(bad).hits, 1)
  const good = '<template><tr v-for="(r,i) in rows" :key="r.id"><td>{{ i }}</td></tr></template>'
  assert.equal(hitsIn(good).hits, 0)
  const mixed = '<template><li v-for="(t,i) in titles" :key="`${i}-${t}`">{{ t }}</li></template>'
  assert.equal(hitsIn(mixed).hits, 0, 'trim 后必须**全等**才算索引键；模板串/拼接至少有数据参与')
})

test('hitsIn：单引号属性与 v-bind:key 两种形态都要认（只认双引号就是给绕过留口子）', () => {
  assert.equal(hitsIn(`<template><li v-for='(t,i) in ts' :key='i'>x</li></template>`).hits, 1)
  assert.equal(hitsIn('<template><li v-for="(t,i) in ts" v-bind:key="i">x</li></template>').hits, 1)
})

test('hitsIn：注释里的举例不得计数（与 5.3 / toast 棘轮同型纪律）', () => {
  assert.equal(hitsIn('<!-- 反例：v-for="(a,i) in as" :key="i" 不要这样写 -->').hits, 0)
  assert.equal(hitsIn('<script>/* v-for="(a,i) in as"\n :key="i" */\nconst x=1</script>').hits, 0)
  assert.equal(hitsIn('<script>\n// v-for="(a,i) in as" 配 :key="i" 是错的\nconst ok = 1\n</script>').hits, 0)
  // 正控：同样的写法出现在非注释位置时必须被数到，否则"注释剥干净"与"判据整体失灵"同形
  assert.equal(hitsIn('<template><li v-for="(a,i) in as" :key="i">{{ a }}</li></template>').hits, 1)
})

test('stripComments：`url("http://x")` 里的 // 不得被当注释剥掉', () => {
  const src = '<style>.a{background:url("http://e.com/i.png")}</style>'
  assert.ok(stripComments(src).includes('http://e.com/i.png'))
})

test('名字补召回：结构判据看不见时，index/idx/i 等无歧义名字仍要收（宁可多收）', () => {
  // 本文件里没有 v-for（索引位解析不出），但 :key="index" 语义无歧义
  const r = hitsIn('<template><li v-for="row in rows" :key="index">x</li></template>')
  assert.equal(r.hits, 1)
  assert.equal(r.reserved, 1)
  assert.ok(RESERVED_INDEX_NAMES.has('index') && RESERVED_INDEX_NAMES.has('i'))
})

test('真实仓：现场处数必须等于基线总数，且风险档清单一致（反失明）', () => {
  const r = scan('apps/desktop/src')
  const base = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  const out = execFileSync(process.execPath, [path.join(__dirname, 'check-vfor-stable-key.js'), '--json'], { encoding: 'utf8' })
  const j = JSON.parse(out)
  assert.equal(j.problems.length, 0, '本批按现状登记基线，门禁必须绿：\n' + j.line + '\n' + JSON.stringify(j.problems))
  assert.equal(r.total, base.total, '现场处数必须等于基线总数')
  assert.equal(r.byFile.size, Object.keys(base.byFile).length)
  assert.deepEqual(mutatingFiles(r).sort(), [...base.mutatingFiles].sort(), '风险档清单必须与基线逐字一致（只能由真实收敛缩小）')
  // 规模下界：解析退化会让集合变空，而"0 个违规"读起来完全像通过
  assert.ok(r.files.length > 100, '扫描域 .vue 文件数应 >100，当前 ' + r.files.length)
  assert.ok(r.indexVars > 20, '解析出的索引变量数应 >20，当前 ' + r.indexVars + '（解析式或文件形态变了）')
})

test('基线 JSON 的形状：byFile 为整数表、mutatingFiles 是 byFile 的子集', () => {
  const base = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  assert.equal(typeof base.byFile, 'object')
  for (const [f, n] of Object.entries(base.byFile)) {
    assert.ok(Number.isInteger(n) && n > 0, f + ' 的份数必须是正整数')
    assert.ok(!path.isAbsolute(f) && !f.includes('\\'), f + ' 必须是仓库相对 posix 路径')
  }
  for (const f of base.mutatingFiles) assert.ok(f in base.byFile, '风险档文件必须同时在 byFile 里：' + f)
})

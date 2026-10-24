'use strict'
/**
 * check-label-association.test.js — 「label 必须关联控件」棘轮判据的回归锁（node --test）
 *
 * 接线：.github/workflows/quality-gate.yml 的 Gate 2c（shell: bash，fail-fast）。
 * 只 require node 内置模块（changes job 无 Install deps）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { scanSource, scan, readTag, FOR_ATTR, NATIVE_CONTROLS, BASELINE_PATH } = require('./check-label-association.js')

test('① 显式 for 三种写法都认；空值与只有空白不算关联', () => {
  assert.equal(scanSource('<template><label for="n1">名字</label><input id="n1"></template>').bad, 0)
  assert.equal(scanSource('<template><label :for="idRef">名字</label></template>').bad, 0)
  assert.equal(scanSource('<template><label v-bind:for="idRef">名字</label></template>').bad, 0)
  assert.equal(scanSource('<template><label for="">名字</label></template>').bad, 1, '空 for 是失效关联，必须仍判红')
  assert.equal(scanSource('<template><label for="   ">名字</label></template>').bad, 1,
    '只有空白的 for 同属失效关联（这条是变异 L2 的靶：把 `forVal && forVal.trim()` 写成 `!!forVal` 时只有这里会红）')
  assert.equal(scanSource('<template><label :for="undefined">名字</label></template>').bad, 0, '表达式非空串即按"作者声明了关联"放过（判据不做值求解）')
})

test('② 隐式关联只认**原生**表单控件；自定义组件与 el-* 不算', () => {
  assert.equal(scanSource('<template><label>名字 <input type="text"></label></template>').bad, 0)
  assert.equal(scanSource('<template><label>级别 <select><option>a</option></select></label></template>').bad, 0)
  assert.equal(scanSource('<template><label>模式 <textarea/></label></template>').bad, 0)
  // 这是判据的主要"抓人"处，也是最容易被写宽的一处：
  assert.equal(scanSource('<template><label>标题 <el-input v-model="t" /></label></template>').bad, 1,
    'capturing label 只认 form-associated 元素；<el-input> 在解析期不是控件')
  assert.equal(scanSource('<template><label>标题 <UiField :model-value="t" /></label></template>').bad, 1)
})

test('③ 正向对偶：原生控件词表必须是**白名单形态**，且不得被写成兜底匹配', () => {
  assert.ok(NATIVE_CONTROLS.source.includes('textarea'), '词表必须含 textarea 等原生控件')
  assert.ok(!/el-/.test(NATIVE_CONTROLS.source), '把 el-* 放进词表等于把 139 处判成 0 —— 禁令')
  // 正向对偶：词表**必须**抓得住真实形态（否则"不含 el-"是空话）
  assert.ok(NATIVE_CONTROLS.test('<input>'), '白名单必须真能匹配原生控件')
})

test('④ 属性值里的 `>` 不得截断标签（朴素 [^>]* 会在这里静默漏扫）', () => {
  const src = `<template>
    <label :class="count > 0 ? 'hot' : 'cold'" class="x">标题</label>
  </template>`
  const r = scanSource(src)
  assert.equal(r.total, 1, '必须解析到 1 个 label —— 解析在属性里截断就是漏扫')
  assert.equal(r.bad, 1)
  assert.equal(r.unclosed, 0, '出现 unclosed 计数说明状态机没走完')
})

test('⑤ 注释里的举例不计数；`</label>` 跨行与嵌套控件都要走通', () => {
  assert.equal(scanSource('<!-- 反例：<label>名字</label> 不要这样写 -->').bad, 0)
  assert.equal(scanSource('<template>\n<label>\n  名字\n  <input id="a">\n</label>\n</template>').bad, 0)
  assert.equal(scanSource('<template><label>包两层 <span><input id="b"></span></label></template>').bad, 0)
})

test('⑥ readTag 在引号内不认 `>`（同一个状态机被两处判据共用的前提）', () => {
  const s = '<label title="a>b">x</label>'
  const t = readTag(s, s.indexOf('label') + 5)
  assert.ok(t.attrs.includes('a>b'), '属性串必须完整含 a>b，实际=' + JSON.stringify(t.attrs))
})

test('⑦ 真实仓：现场处数必须等于基线总数、分母存在、清单无陈旧（反失明）', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'check-label-association.js'), '--json'], { encoding: 'utf8' })
  const j = JSON.parse(out)
  assert.equal(j.problems.length, 0, '本批按现状登记基线，门禁必须绿：\n' + j.line + '\n' + JSON.stringify(j.problems))
  const base = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  assert.equal(j.total, base.total, '现场处数必须等于基线总数')
  assert.ok(base.totalLabels > 100, '全域 label 数必须远大于 0（分母），当前 ' + base.totalLabels)
  assert.ok(j.total > 50, '现场"未关联"数必须远大于 0，否则这条判据无从判读，当前 ' + j.total)
  assert.equal(j.totalLabels, base.totalLabels, '分母变了说明扫描域或解析式变了，必须一起 re-sync')
})

test('⑧ 基线 JSON 形状：整数份数 + 仓库相对 posix 路径 + 不含绝对路径', () => {
  const base = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  for (const [f, n] of Object.entries(base.byFile)) {
    assert.ok(Number.isInteger(n) && n > 0, f + ' 必须是正整数')
    assert.ok(!path.isAbsolute(f) && !f.includes('\\') && !/^[A-Za-z]:/.test(f), f + ' 必须是仓库相对 posix 路径')
  }
  assert.ok(typeof base._comment === 'string' && base._comment.includes('原生'),
    '基线必须自带计数口径说明（否则下一个会话只能猜 139 是怎么来的）')
})

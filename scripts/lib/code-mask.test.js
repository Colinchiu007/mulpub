/**
 * code-mask.test.js — 结构锁共享库自身的回归锁（2026-10-18 新建）
 *
 * ## 为什么单独建这个文件
 * 第三批把 maskNonCode 抽成共享库（`scripts/lib/code-mask.js`）时，只在
 * `same-type-risk-locks-r3.test.js` 里放了「与两批旧实现等价」的间接断言，
 * **没有为本库的行为边界建测试**。结果本批实测暴露一个真缺陷：
 *
 * 源码面 3089 个文件里 **311 个**含「正则字面量内出现引号」，其中 **164 个**掩码后
 * 可见字符保留率 < 0.55（最坏 `packages/rewrite-engine/src/knowledge-base.js` 只剩 **0.03**，
 * 522/17196）。根因：`const re = /["']/g` 里的 `"` 被当成字符串起点，一路扫到下一个引号。
 * 后果是 8 条结构锁在这些文件上**几乎全盲**，锁报「0 违规」只是因为它看不见 ——
 * 这正是本仓反复记录的「0 命中会让解析失败伪装成全部合规」的同型。
 *
 * ## 本文件锁什么
 * ① 噪声屏蔽的基本职责：注释/字符串必须被掩、且**等长**（下标可跨文本复用）；
 * ② 正则字面量的边界识别：引号/字符类内 `/`/转义 `\/` 都不得提前结束，
 *    且**正则内容要保留**（L1 转义表锁依赖字符类原文）；
 * ③ 反向：除法不得被误判成正则（误判比漏判更糟 —— 会吃掉更多代码）。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { maskNonCode, matchBrace } = require('./code-mask')

// ---------------------------------------------------------------- 基本职责
test('注释被掩、且总长度不变（下标可跨文本复用）', () => {
  const src = 'const a = 1 // note\n/* block */ const b = 2\n'
  const m = maskNonCode(src)
  assert.equal(m.length, src.length, '掩码必须等长')
  assert.ok(!/note/.test(m), '行注释内容必须被掩')
  assert.ok(!/block/.test(m), '块注释内容必须被掩')
  assert.ok(/const a = 1/.test(m) && /const b = 2/.test(m), '代码必须保留')
})

test('字符串内容被掩、结构保留', () => {
  const src = "const s = 'hello' + \"world\"\n"
  const m = maskNonCode(src)
  assert.equal(m.length, src.length)
  assert.ok(!/hello|world/.test(m), '字符串内容必须被掩')
  assert.ok(/const s =/.test(m) && /\+/.test(m), '结构与运算符必须保留')
})

test("strings: 'keep' 时字符串内容保留（字符类含引号的判据需要）", () => {
  const src = "const ch = '\"'\n"
  assert.ok(/"/.test(maskNonCode(src, { strings: 'keep' })), "keep 模式必须保留引号字符")
  assert.ok(!/"/.test(maskNonCode(src)), '默认模式必须掩掉')
})

test('模板串按字符串内容处理（含多行）', () => {
  const src = 'const t = `line1\nline2 ${x}`\nconst after = 1\n'
  const m = maskNonCode(src)
  assert.equal(m.length, src.length)
  assert.ok(!/line1|line2/.test(m), '模板串内容被掩')
  assert.ok(/const after = 1/.test(m), '模板串之后的代码必须可见')
})

test('转义引号不得提前结束字符串', () => {
  const src = "const s = 'it\\'s fine'\nconst after = 2\n"
  const m = maskNonCode(src)
  assert.ok(!/fine/.test(m), '整个字面量都属字符串内容')
  assert.ok(/const after = 2/.test(m), '后续代码必须可见')
})

// ---------------------------------------------------------------- 正则字面量（2026-10-18 修复）
// 动因见文件头：311 个文件含此类正则，164 个掩码被打穿。

test('正则字面量里的引号不得吃掉后续代码（本批核心修复）', () => {
  const src = [
    'const re = /["\']/g',
    'function after () { return 42 }',
    'const s = "secret"',
  ].join('\n')
  const m = maskNonCode(src)
  assert.equal(m.length, src.length)
  assert.ok(/function after/.test(m), '正则之后的函数声明必须仍然可见：' + JSON.stringify(m))
  assert.ok(/return 42/.test(m), '正则之后的函数体必须仍然可见')
  assert.ok(!/secret/.test(m), '真正的字符串内容仍必须被掩掉（修复不能顺手关掉屏蔽）')
})

test('正则边界：字符类内的 / 与转义 \\/ 都不得提前结束', () => {
  const src = [
    'const a = /[/]/g',
    'const b = /a\\/b/g',
    'const c = "str"',
  ].join('\n')
  const m = maskNonCode(src)
  assert.ok(/const a/.test(m) && /const b/.test(m), '两个正则都必须被正确跳过：' + JSON.stringify(m))
  assert.ok(!/str/.test(m), '后续字符串仍被掩掉')
})

test('除法不得被误判为正则（反向：误判会吃掉更多代码）', () => {
  const src = [
    'const x = total / count',
    'const y = "hidden"',
    'function later () { return 1 }',
  ].join('\n')
  const m = maskNonCode(src)
  assert.ok(/total \/ count/.test(m), '除法表达式必须原样保留：' + JSON.stringify(m))
  assert.ok(!/hidden/.test(m), '后续字符串必须仍被掩掉')
  assert.ok(/function later/.test(m), '后续代码不得被吃掉')
})

test('回归：replace(/[&<>"\']/g) 的字符类必须仍可见（L1 转义表锁依赖它）', () => {
  const src = 'const ESC = (s) => s.replace(/[&<>"\']/g, (c) => MAP[c])'
  const m = maskNonCode(src)
  assert.ok(/\[&<>"'\]/.test(m), 'L1 依赖字符类原文，正则内容必须保留而不是掩掉：' + JSON.stringify(m))
  assert.ok(/MAP\[c\]/.test(m), 'map 取值也必须可见')
})

test('正则出现在对象字面量 / 赋值 / 返回位置都正确', () => {
  const src = [
    'const cfg = { pattern: /\\d{4}-\\d{2}/, label: "日期" }',
    'const r = cond ? /a/g : /b/g',
    'function f () { return /x/.test(y) }',
    'const ok = 1',
  ].join('\n')
  const m = maskNonCode(src)
  assert.equal(m.length, src.length)
  assert.ok(/pattern:/.test(m) && /label:/.test(m), '对象字面量两侧都必须可见：' + JSON.stringify(m))
  assert.ok(!/日期/.test(m), '中文字符串仍被掩掉')
  assert.ok(/const ok = 1/.test(m), '后续代码不得被吃掉')
})

test('全局正则：不得因正则跨行/含换行字符类而吃掉整个文件', () => {
  // 真实形态：check-locale-sync.js 的 /^['"]([\s\S]*?)['"]$/
  const src = [
    "const RE = /^['\"]([\\s\\S]*?)['\"]$/",
    'const after = true',
  ].join('\n')
  const m = maskNonCode(src)
  assert.ok(/const after = true/.test(m), '[\\s\\S] 与成对引号不得打穿掩码：' + JSON.stringify(m))
})

// ---------------------------------------------------------------- matchBrace
test('matchBrace：正常配对与嵌套', () => {
  const s = 'a{b{c}d}e'
  assert.equal(matchBrace(s, 1), 7, '外层 }')
  assert.equal(matchBrace(s, 3), 5, '内层 }')
})

test('matchBrace：未闭合返回 -1（不得猜）', () => {
  assert.equal(matchBrace('a{b', 1), -1)
})

test('matchBrace + 掩码：正则与字符串里的花括号不参与配对', () => {
  const src = 'fn({ a: "}" }, /[{}]/){}'
  const m = maskNonCode(src)
  // 最后一个 { 是真正的函数体起点
  const open = m.lastIndexOf('{')
  assert.ok(open > 0)
  assert.equal(matchBrace(m, open), m.length - 1, '必须配到末尾的 }')
})

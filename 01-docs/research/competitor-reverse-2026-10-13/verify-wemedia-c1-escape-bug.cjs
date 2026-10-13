/**
 * 独立复验 融媒宝 view-ai-clip 的 C1 缺陷（TTS 转义 bug）。
 *
 * 断言来源：子代理报告称 `Asset/dist/js/tools.js` 的 escapeSpecialChars 字符类含 '/'，
 * 但 escapeMap 无 '/' 键 ⇒ 替换函数返回 undefined ⇒ 字面量 "undefined" 被插入。
 * 本脚本**不采信转述**，直接从磁盘读取源码、抽出该纯函数、真实执行并打印结果。
 *
 * 只读。用法: node verify-wemedia-c1-escape-bug.cjs
 */
const fs = require('node:fs')

const P = 'D:/Program Files (x86)/融媒宝/Asset/dist/js/tools.js'
const src = fs.readFileSync(P, 'utf8')

const m = src.match(/const escapeSpecialChars = str => \{[\s\S]*?\n\}/)
if (!m) { console.error('  [中止] 未能从源码中匹配到 escapeSpecialChars'); process.exit(1) }

console.log('  源文件:', P, `(${src.length} B)`)
console.log('\n  ── 抽取到的源码 ──')
for (const l of m[0].split('\n')) console.log('    ' + l)

// 只求值这一个纯函数（不 require 整个模块，避免执行任何其他代码）
const fn = eval('(' + m[0].replace('const escapeSpecialChars = ', '') + ')')

console.log('\n  ── 字符类 vs escapeMap 键的静态对照 ──')
// ── 取 escapeMap 的**权威键集**：直接求值对象字面量，不用正则提键 ──
// 事故记录：首版用 /^\s*"(.)":/gm 提键，只匹配双引号形态，于是漏掉源码里
// `'"': "&quot;"` 这个**单引号包裹的键**，把「只缺 /」误报成「缺 " 和 /」。
// 教训同根：正则匹配不到 ⇒ 我判定它不存在。故改为求值 —— 键集由 JS 引擎给出，
// 不再依赖我写对正则。求值范围严格限定在 escapeMap 这一个纯字面量。
const mapLit = m[0].match(/const escapeMap = (\{[\s\S]*?\n\s*\})/)
if (!mapLit) { console.error('  [中止] 未能匹配到 escapeMap 字面量'); process.exit(1) }
const escapeMap = eval('(' + mapLit[1] + ')')
const mapKeys = Object.keys(escapeMap)
if (!mapKeys.length) { console.error('  [中止] escapeMap 求值后为空 —— 提取逻辑失效，拒绝继续'); process.exit(1) }
// ── 权威取法二：不解析正则，**实测**哪些字符真的被这个函数改变 ──
// 把全部可打印 ASCII 逐个喂进去，比对输入输出。这是唯一不依赖「我写对正则」的取法：
// 引擎说它变了就是变了，说没变就是没变。首版用正则提「字符类」与「键集」两处，
// 两处都可能漏形态；此处把字符集改成实测，键集改成求值，正则只剩定位函数体这一个用途。
const changed = []
const unchanged = []
for (let c = 32; c < 127; c++) {
  const ch = String.fromCharCode(c)
  let out
  try { out = fn(ch) } catch { out = null }
  if (out === null) continue
  if (out !== ch) changed.push({ ch, out })
  else unchanged.push(ch)
}
console.log(`    实测被改变的字符（共 ${changed.length} 个）:`)
console.log('      ' + changed.map((x) => `${JSON.stringify(x.ch)}→${JSON.stringify(x.out)}`).join('  '))
const changedChars = changed.map((x) => x.ch)
console.log(`    escapeMap 的键（求值取得，共 ${mapKeys.length} 个）: ${JSON.stringify(mapKeys.join(''))}`)

// 交叉校验（**单向**）：只有当「键集里存在实测不会用到的键」时才可能是提取逻辑失效。
// 反方向 **不是** 提取问题 —— 「实测被改变但键集里没有」正是本次要调查的缺陷本身
// （被正则命中 ⇒ 走替换 ⇒ 取到 undefined ⇒ 被转成字面量 "undefined"）。
// 首版把两个方向都判成失败，于是在**成功复现缺陷**时中止了 —— 判据把"发现"误判成"故障"。
const orphanKeys = mapKeys.filter((k) => !changedChars.includes(k))
if (orphanKeys.length) {
  console.error(`\n  [中止] 键集里存在实测不会用到的键 —— 提取逻辑可能失效，拒绝给出结论：`)
  console.error(`    ${JSON.stringify(orphanKeys.join(''))}`)
  process.exit(1)
}
console.log(`    ✓ 键集 ${JSON.stringify(mapKeys.join(''))} 全部在实测集内（无孤儿键）`)

// 缺键 = 被正则命中但 map 里没有对应项 ⇒ 替换成 undefined ⇒ 字面量 "undefined" 进入产物
const missing = changedChars.filter((c) => escapeMap[c] === undefined)
console.log(`    ★ 会被替换成字面量 undefined 的字符: ${JSON.stringify(missing.join(''))}`)
if (!missing.length) console.log('    （无缺键 ⇒ 该处无缺陷）')

console.log('\n  ── 实测行为（真实执行该函数）──')
const cases = ['纯文本', 'a/b', '1/2 决赛', 'a & b', '<script>', "it's", '2025/2/23', 'https://a.com/b', '速度 100km/h']
let bad = 0
for (const c of cases) {
  let out
  try { out = fn(c) } catch (e) { out = 'THROW ' + e.message }
  const dirty = String(out).includes('undefined')
  if (dirty) bad++
  console.log('    ' + JSON.stringify(c).padEnd(20) + ' → ' + JSON.stringify(out) + (dirty ? '   ← [!] 出现字面量 undefined' : ''))
}

console.log('\n  ── 结论 ──')
console.log(`    ${cases.length} 个输入中 ${bad} 个产生 "undefined" 字面量`)
console.log(bad > 0
  ? '    ✅ 复验通过：C1 缺陷真实存在 —— 含 "/" 的文本被转义后会插入字面量 "undefined"'
  : '    ❌ 复验失败：未能重现该缺陷，子代理报告可能有误')
process.exitCode = bad > 0 ? 0 : 1

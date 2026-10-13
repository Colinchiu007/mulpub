/**
 * 报告引用密度度量 —— 带**双界交叉校验**，专治「我的正则漏了一种形态，于是我把
 * 『我测不到』当成『它不存在』」。
 *
 * 事故背景（2026-10-13，同一会话内犯了两次同型错误）：
 *   1. 用 /^\s*"(.)":/gm 提 escapeMap 的键，漏掉单引号形态 `'"': "&quot;"`，
 *      于是误报「缺两个键」（实为只缺 '/'）。
 *   2. 用 /\w+\.(js|html|css):\d+/ 数引用，漏掉简写形态 `:51-61`，
 *      于是把一份密度 41% 的报告量成 16%，并准备据此「修复」一份没问题的报告。
 *   两次都是：匹配不到 ⇒ 判定不存在。
 *
 * 本脚本的机械防线：**同时算松/紧两界，并对每个 `:数字` 出现处做形态归类**。
 *   * 松界(loose) ：凡含 `:数字` 的行 —— 几乎不可能是漏网，只会多算
 *   * 紧界(strict)：已登记形态（file:line / 裸 :line / :line-line）
 *   * 未分类桶     ：既非 URL、非时间、非已登记形态的 `:数字` ⇒ **这才是警报**
 * 若「未分类 > 0」或「松界比紧界高出阈值以上」，脚本**非零退出**并逐条点名，
 * 要求人工确认是否还有第三种形态没登记 —— 而不是静默用一个偏小的数字。
 *
 * 只读。用法: node measure-report-citations.cjs <报告.md> [<报告.md> ...]
 */
const fs = require('node:fs')

const files = process.argv.slice(2)
if (!files.length) { console.error('用法: node measure-report-citations.cjs <报告.md> [更多报告.md ...]'); process.exit(2) }

// ── 已登记的引用形态 ──
// 分两档：**确定**（计入下界）与**歧义**（只进上界，不进下界）。
// 歧义档的存在本身就是结论的一部分：它证明「引用数」在这类报告里只能是区间，不是单值。
const FORMS = [
  { name: 'A file:line', tier: '确定', re: /[\w\u4e00-\u9fa5.\-]+\.(?:js|mjs|cjs|html|css|json|txt|ini|csv|md|yml|yaml|vue|ts):\d+(?:-\d+)?/g },
  { name: 'B 裸 :line', tier: '确定', re: /(?<![\w:.\d]):\d+(?:-\d+)?(?![:\d])/g },
  // 形态 C：`deepClone:517` / `removeAllTags:787` —— 标识符+行号，是本类报告的**第三种引用写法**。
  // 但它与属性赋值 `type:3` / `left:189` / `weight:500` **语法同形**，纯正则不可区分 ⇒ 只算歧义上界。
  { name: 'C 标识符:数字（歧义）', tier: '歧义', re: /[A-Za-z_$][\w$]*:\d+(?:-\d+)?/g },
]
// 明确排除：不是代码引用的 `:数字`
const NOT_CITATION = [
  { name: 'URL 协议端口', re: /:\/\//g },
  { name: '时刻 HH:MM', re: /\b\d{1,2}:\d{2}(?::\d{2})?\b/g },
  { name: '纯数字比值/宽高比', re: /^\d+\s*:\s*\d+/g },
]

const LOOSE_RE = /:\d/ // 松界：最宽，只为给上界

let fail = 0
for (const f of files) {
  if (!fs.existsSync(f)) { console.log(`\n【${f}】不存在`); fail++; continue }
  const text = fs.readFileSync(f, 'utf8')
  const lines = text.split(/\r?\n/)

  // 松界：含 `:数字` 的行数（上界）
  const looseLines = lines.filter((l) => LOOSE_RE.test(l)).length

  // 紧界：命中**确定**档已登记形态的行数（下界）
  const perForm = {}
  const defLineIdx = new Set()   // 确定档命中
  const ambLineIdx = new Set()   // 歧义档命中（且未被确定档命中）
  for (const form of FORMS) {
    let c = 0
    for (let i = 0; i < lines.length; i++) {
      form.re.lastIndex = 0
      if (form.re.test(lines[i])) {
        c++
        if (form.tier === '确定') defLineIdx.add(i); else if (!defLineIdx.has(i)) ambLineIdx.add(i)
      }
    }
    perForm[`${form.tier} ${form.name}`] = c
  }
  const strictLines = defLineIdx.size
  const ambOnly = [...ambLineIdx].filter((i) => !defLineIdx.has(i)).length
  const upperLines = new Set([...defLineIdx, ...ambLineIdx]).size

  // 逐处分类：把所有 `:数字` 抓出来，看有没有落在「已登记 ∪ 已排除」之外的
  const all = [...text.matchAll(/[^\s]*:\d[\d-]*/g)].map((m) => m[0])
  const buckets = { 确定引用: 0, 歧义引用: 0, 未分类: [] }
  for (const ex of NOT_CITATION) buckets[ex.name] = 0
  const seenUnclassified = new Set()
  for (const tok of all) {
    // 唯一真值来源：用 NOT_CITATION 数组判定排除项。
    // （首版在循环里硬编码了三条内联判据，导致 NOT_CITATION 成了**死配置** ——
    //   改数组不生效，`9:16/16:9` 一直被误报。同一事实两处实现 = 必然漂移。）
    let excluded = false
    for (const ex of NOT_CITATION) {
      ex.re.lastIndex = 0
      // 锚定整串判定用 ^...$ 语义：把 re 的 lastIndex 归零后按 test 即可（各 re 已按需锚定）
      if (ex.re.test(tok)) { buckets[ex.name] = (buckets[ex.name] || 0) + 1; excluded = true; break }
    }
    if (excluded) continue
    let hit = null
    for (const form of FORMS) { form.re.lastIndex = 0; if (form.re.test(tok)) { hit = form; break } }
    if (hit) { buckets[hit.tier === '确定' ? '确定引用' : '歧义引用']++ }
    else if (!seenUnclassified.has(tok)) { seenUnclassified.add(tok); buckets.未分类.push(tok) }
  }

  console.log(`\n══════ ${f} ══════`)
  console.log(`  行数 ${lines.length}   字节 ${fs.statSync(f).size}`)
  console.log(`  ── 双界（区间，不是单值）──`)
  console.log(`    下界（确定档命中行）        : ${strictLines}   → 密度 ${(strictLines * 100 / lines.length).toFixed(1)}%`)
  console.log(`    上界（=下界 + 歧义档独有行） : ${upperLines}   → 密度 ${(upperLines * 100 / lines.length).toFixed(1)}%`)
  console.log(`    歧义档独有行                : ${ambOnly}（形态 C：标识符:数字，与属性赋值同形，无法正则区分）`)
  console.log(`    松界（含 ':数字' 的行）      : ${looseLines}   ← 更宽上界，只会多算`)
  console.log(`  ── 每形态 ──`)
  for (const [k, v] of Object.entries(perForm)) console.log(`    ${k.padEnd(28)} ${v} 行`)
  console.log(`  ── ':' 出现处归类（共 ${all.length} 处）──`)
  console.log(`    确定 ${buckets.确定引用}   歧义 ${buckets.歧义引用}   `
    + NOT_CITATION.map((ex) => `${ex.name} ${buckets[ex.name]}`).join('   ')
    + `   未分类 ${buckets.未分类.length}`)

  // ── 判定：只有"未分类"才是真警报 —— 必须显式登记，不得静默采信任一数字 ──
  let alarm = false
  if (buckets.未分类.length) {
    alarm = true
    console.log(`\n  ❌ 未分类形态 ${buckets.未分类.length} 种 —— 必须先判定它们属于哪一档，`)
    console.log(`     是引用 ⇒ 登记进 FORMS（并声明 tier）；不是 ⇒ 登记进 NOT_CITATION。`)
    console.log(`     **在登记完成前，本报告的引用密度不得引用任何单值。**`)
    for (const t of buckets.未分类.slice(0, 12)) console.log(`       · ${JSON.stringify(t)}`)
    if (buckets.未分类.length > 12) console.log(`       … 另 ${buckets.未分类.length - 12} 种`)
  }
  if (!alarm) {
    console.log(`\n  ✅ 无未分类形态 —— 可采信区间：${(strictLines * 100 / lines.length).toFixed(0)}% ~ ${(upperLines * 100 / lines.length).toFixed(0)}%`)
    console.log(`     口径：下界只含确定档（file:line / 裸 :line）；上界另含歧义档（标识符:数字）。`)
  }
  console.log(`  判定: ${alarm ? '需人工登记形态（数字不可采信）' : 'OK（区间可采信）'}`)
  fail += alarm ? 1 : 0
}

console.log(`\n${'═'.repeat(50)}`)
console.log(fail ? `总判定: ${fail} 份报告存在未识别形态 —— 非零退出，请先登记形态` : '总判定: 全部通过')
process.exitCode = fail ? 1 : 0

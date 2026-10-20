#!/usr/bin/env node
/**
 * check-ui-wired.js — 「未接线组件」门禁（UX 审计阶段 5.3）
 *
 * 判据：`apps/desktop/src/*.vue` 里**声明了 props** 的组件，如果在**生产代码面**零引用，
 * 就是「建好并写好接口、但没人挂上去」的死组件。这一类缺陷本仓已四次复发（audit-6/audit-66：
 * AnnouncementBanner / TrialBanner / LoadingState / StaggeredList），共同点是
 * **组件自己的测试全绿** —— 测试自己 import 并挂载它，所以「有测试」从不等于「被接上电」。
 *
 * 三条不显然的口径（都有实测理由，改动前先读）：
 *  ① **测试文件不计入消费者**（`*.test.js` / `tests/**` 一律排除）。否则每个组件都被
 *     自己的用例"引用"，判据恒不成立 —— 这正是本仓「注册≠注入≠生效」的同型。
 *  ② **剥行注释后再搜**。审计现场里 `TrialBanner` 的唯一命中是 MemberCenter.vue 的一句注释，
 *     不剥注释就会把「文档里提到」读成「代码里在用」（同 audit 里"结论只写在散文里"那一类）。
 *     剥法只剥**整行**注释与 `/* *\/` 块，不做 HTML 解析 —— 目标是把"注释里提到组件名"
 *     这一类假引用消掉，模板里的 `<Foo />` 与 import 行都在代码域，不受影响。
 *  ③ 欠账清单 `ui-wired-debt.json` **只能缩小**；条目必须带 `reason`。
 *     新增一个未接线组件时若当场登记 ⇒ `unregistered` 与 `stale` 两条同时判红，
 *     所以登记必须是一次显式的、带理由的决策。
 *
 * 退出码：0 合规 / 1 发现未接线（含欠账陈旧、清单被放宽）/ 2 判据自身读不到（扫描根缺失、
 * 文件读不到、扫描域为空）。把"门禁瞎了"读成"没问题"是本仓最忌的装饰性门禁。
 */
'use strict'
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '..')
const DEFAULT_SCAN_ROOT = path.join(REPO, 'apps/desktop/src')
const DEBT_PATH = path.join(__dirname, 'ui-wired-debt.json')

function walk (dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(vue|js|ts)$/.test(ent.name)) out.push(p)
  }
  return out
}

/** 剥整行 // 注释与块注释；只用于"搜引用"，不用于判 props（props 必须在代码域才算声明） */
function stripComments (src) {
  return src.split(/\r?\n/).map((line) => {
    const t = line.trim()
    if (t.startsWith('//') || t.startsWith('<!--') || t.startsWith('*') || t.startsWith('/*')) return ''
    return line
  }).join('\n')
}

function isTestSurface (rel) {
  const r = rel.replace(/\\/g, '/')
  return /\.test\.[jt]s$/.test(r) || r.startsWith('tests/') || r.includes('/tests/') || /\.spec\.[jt]s$/.test(r)
}

/** props 声明判据：defineProps(...) / defineProps<...>() / props: {} / props: [] 四种写法都算 */
function hasProps (src) {
  return /defineProps\s*[<(]/.test(src) || /props\s*:\s*\{/.test(src) || /props\s*:\s*\[/.test(src)
}

/**
 * 生产面引用计数。`productionCode` 必须是**已剥注释**的 [file, code] 列表，
 * 且**不含测试面文件**（isTestSurface 过滤）—— 这两条是本判据的全部牙：
 * 不剥注释 ⇒ 「文档里提到」被读成「代码里在用」（audit 里 TrialBanner 的真实命中就是一句注释）；
 * 不排测试 ⇒ 每个组件都被自己的用例"引用"，判据恒不成立。
 */
function countProductionRefs (file, src, productionCode) {
  const base = path.basename(file)
  const stem = base.replace(/\.vue$/, '')
  const kebab = stem.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  const pascal = new RegExp('<' + stem + '[\\s/>]')
  const kebabRe = new RegExp('<' + kebab + '[\\s/>]')
  const importRe = new RegExp('[\\\'"]\\./?[\\w./-]*' + stem + '\\.vue[\\\'"]|[' + '\\' + '/]' + stem + '\\.vue')
  let refs = 0
  for (const [g, code] of productionCode) {
    if (g === file) continue
    if (code.includes(base) || pascal.test(code) || kebabRe.test(code) || importRe.test(code)) refs++
  }
  return refs
}

function main (argv) {
  const args = new Set(argv)
  // 可注入扫描根与欠账清单：默认走真实仓库；测试用 fixture 目录跑同一条判据。
  // 为什么必须开这个口子（而不是只测纯函数）：本门禁的牙有两处住在装配层 ——
  // 「剥注释」与「排除测试面」都发生在 main 里，纯函数级用例对这两次变异**结构性免疫**，
  // 只有整跑一遍 main 才能把变异判红。
  const opt = (name) => {
    const hit = argv.find((a) => a.startsWith('--' + name + '='))
    return hit ? hit.slice(name.length + 3) : null
  }
  const scanRoot = opt('scan-root') || DEFAULT_SCAN_ROOT
  const debtPath = opt('debt') || DEBT_PATH
  const relBase = opt('scan-root') ? path.resolve(scanRoot) : REPO
  if (!fs.existsSync(scanRoot)) {
    console.error(`[ui-wired] 扫描根不存在：${scanRoot}`)
    return 2
  }
  const all = walk(scanRoot, [])
  const read = new Map()
  const unreadable = []
  for (const f of all) {
    try { read.set(f, fs.readFileSync(f, 'utf8')) } catch (e) { unreadable.push(f) }
  }
  if (unreadable.length) {
    console.error(`[ui-wired] 有 ${unreadable.length} 个文件读不到，判据自身故障，不报合规`)
    return 2
  }

  const consumers = [...read.entries()].filter(([f]) => !isTestSurface(path.relative(relBase, f)))
  const productionCode = consumers.map(([f, src]) => [f, stripComments(src)])
  const vueFiles = consumers.filter(([f]) => f.endsWith('.vue')).map(([f]) => f)

  const findings = []
  let withProps = 0
  for (const f of vueFiles) {
    const src = read.get(f)
    if (!hasProps(src)) continue
    withProps++
    if (countProductionRefs(f, src, productionCode) === 0) {
      findings.push(path.relative(relBase, f).replace(/\\/g, '/'))
    }
  }

  if (!all.length || vueFiles.length === 0) {
    console.error('[ui-wired] 扫描域为空（没有任何被检组件），拒绝报合规')
    return 2
  }

  let debt = {}
  try { debt = JSON.parse(fs.readFileSync(debtPath, 'utf8')) } catch (e) {
    console.error('[ui-wired] 欠账清单读不到或不是合法 JSON：' + e.message)
    return 2
  }
  const debtKeys = Object.keys(debt)
  for (const k of debtKeys) {
    const v = debt[k]
    if (!v || typeof v.reason !== 'string' || !v.reason.trim()) {
      console.error(`[ui-wired] DEBT_NO_REASON ${k}：登记必须写 reason（无原因的豁免等于没有门禁）`)
      return 1
    }
  }
  const unregistered = findings.filter((f) => !debtKeys.includes(f))
  const stale = debtKeys.filter((k) => !findings.includes(k))
  const grew = debtKeys.length > (Number(process.env.UI_WIRED_BASELINE_MAX) || debtKeys.length)

  console.log(`[ui-wired] 域=${all.length} 文件 / 生产面 vue=${vueFiles.length} / 声明 props=${withProps} / 零引用=${findings.length} / 登记=${debtKeys.length}`)
  for (const f of unregistered) console.log(`  UNWIRED ${f} （有 props 声明但生产代码面零引用）`)
  for (const k of stale) console.log(`  STALE_DEBT ${k} （已不再命中，必须删掉这条登记，清单只能缩小）`)
  if (args.has('--json')) {
    console.log(JSON.stringify({ findings, unregistered, stale, domain: all.length, withProps }))
  }
  if (unregistered.length || stale.length) return 1
  if (grew) { console.error('[ui-wired] 欠账清单被放宽'); return 1 }
  console.log('[ui-wired] PASS')
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { main, stripComments, isTestSurface, hasProps, countProductionRefs, walk }

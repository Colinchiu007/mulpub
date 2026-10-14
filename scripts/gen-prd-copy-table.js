#!/usr/bin/env node
'use strict'
/*
 * scripts/gen-prd-copy-table.js —— PRD「提示文字逐字表」的唯一生成器（tasks 5.2）
 *
 * 为什么要有这个文件：PRD 里手工誊抄的文案表一定会被打旧。本仓实测过两次——
 * RSS PRD §11.5 建表时就有 135 条里 89 条逐字值对不上，而第八刀之后又新增/改写了
 * 一批 `podcast.*` 键（含 §7.9 固化、§7.10 文本出期与 `podcast.errors.*` 逐码文案），
 * 现在那两张表再次过期，且没有任何东西在看「表 == locale」。
 *
 * 两条命令，同一个真源：
 *   node scripts/gen-prd-copy-table.js --apply            生成/替换表（幂等）
 *   node scripts/gen-prd-copy-table.js --check            漂移即 rc=1（接在 CI，防止再次手工漂移）
 *
 * 判据一律 fail closed：locale 形状不认识就抛错，禁止"解析不到 ⇒ 生成空表"（空表会让
 * check 恒绿，比没表更糟）。行尾逐文件原样保持，表外一行不得少。
 */
const fs = require('fs')
const path = require('path')

const TARGETS = [
  {
    prd: '01-docs/PRD-PODCAST-RSS-CHANNEL-2026-10-09.md',
    heading: '### 11.5 实现态全量文案清单',
    // 本节收 RSS 线全部键（前缀 podcast.，扁平化后的键名保留末两段以上）
    // RSS 线收全部键，只排除 `episode.*`（那几条是一键发布线的显示项）。
    // `podcast.errors.*` 两条链都会 surface，所以两边都列：同一键出现在两份 PRD 是事实，
    // 且两处都由本脚本从**同一份 locale** 生成，不构成第二份真源。
    pick: (k) => k !== 'podcast' && !k.startsWith('podcast.episode.'),
  },
  {
    prd: '01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md',
    heading: '#### 6.4.3 第 4 片提示文字逐字对照',
    pick: (k) => k.startsWith('podcast.episode.') || k.startsWith('podcast.errors.'),
  },
]

function loadLocale (file) {
  const src = fs.readFileSync(file, 'utf8')
  const i = src.indexOf('export default')
  if (i < 0) throw new Error(file + ' 不是 `export default` 形状；解析器要按真实结构调整，不得硬解析')
  const body = src.slice(i + 'export default'.length).trim().replace(/;+\s*$/, '')
  if (!/^\{[\s\S]*\}$/.test(body)) throw new Error(file + ' 的默认导出不是对象字面量，拒绝用正则猜键')
  let obj
  try {
    obj = (0, eval)('(' + body + ')')
  } catch (e) {
    throw new Error(file + ' 求值失败（locale 文件必须是无副作用的字面量）：' + e.message)
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(file + ' 解析结果不是对象')
  return obj
}

function flat (node, prefix, out) {
  for (const k of Object.keys(node)) {
    const v = node[k]
    const key = prefix ? prefix + '.' + k : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out)
    else out[key] = String(v)
  }
  return out
}

function esc (s) { return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, '⏎') }

function buildTable (zhMap, enMap, pick, heading) {
  const keys = Object.keys(zhMap).filter(pick).sort()
  if (!keys.length) throw new Error('命中 0 个键：判据取错或文案尚未落地，禁止生成空表冒充覆盖')
  const unpaired = keys.filter((k) => !(k in enMap))
  if (unpaired.length) throw new Error('zh 有而 en 无（Gate 7 会红）：' + unpaired.slice(0, 5).join(', '))
  const empty = keys.filter((k) => !zhMap[k].trim() || !enMap[k].trim())
  if (empty.length) throw new Error('存在空白文案：' + empty.slice(0, 5).join(', '))
  const lines = [
    heading + '（**由 `scripts/gen-prd-copy-table.js` 从 `apps/desktop/src/locales/podcast/{zh,en}.js` 生成，改文案必须重新生成，禁止手工维护本节**）',
    '',
    '- 生成口径：解析两份 locale 的 `export default` 字面量 → 扁平化键名 → 按本节的收录前缀取键并**按字典序**排列。',
    '- `--check` 已接进 `.github/workflows/quality-gate.yml`（Gate 2c）：本节与 locale 不一致即红，所以「文档比代码旧」不再是可能状态。',
    '- 两处不一致时的裁决方向：以本节（即代码）为准，回改规划态小节，而不是反过来改文案去迁就文档。',
    '',
    '| 键路径 | zh（用户可见，逐字） | en（用户可见，逐字） |',
    '| --- | --- | --- |',
  ]
  for (const k of keys) lines.push('| `' + k + '` | ' + esc(zhMap[k]) + ' | ' + esc(enMap[k]) + ' |')
  lines.push('')
  lines.push('共 ' + keys.length + ' 键；逐键 zh/en 成对且均为非空串。')
  lines.push('')
  return lines
}

function sectionRange (lines, heading) {
  const start = lines.findIndex((l) => l.startsWith(heading))
  if (start < 0) return -1
  const level = heading.match(/^#+/)[0].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/)
    if (m && m[1].length <= level) { end = i; break }
  }
  return { start, end }
}

function render (opts) {
  const repoRoot = opts.repoRoot
  // 仓内约定：locale 文件的**根就是 podcast 命名空间**（键写作 `episode.title`、`errors.X`），
  // 渲染层取用时才带 `podcast.` 前缀。这里统一补前缀，表里的键路径才与界面实际用的串一致。
  const zhMap = flat(loadLocale(path.join(repoRoot, 'apps/desktop/src/locales/podcast/zh.js')), 'podcast', {})
  const enMap = flat(loadLocale(path.join(repoRoot, 'apps/desktop/src/locales/podcast/en.js')), 'podcast', {})
  const report = []
  for (const t of TARGETS) {
    const file = path.join(repoRoot, t.prd)
    if (!fs.existsSync(file)) throw new Error('PRD 不存在：' + t.prd)
    const raw = fs.readFileSync(file, 'utf8')
    const eol = raw.indexOf('\r\n') >= 0 ? '\r\n' : '\n'
    const lines = raw.split(/\r?\n/)
    const range = sectionRange(lines, t.heading)
    const body = buildTable(zhMap, enMap, t.pick, t.heading)
    if (range < 0) throw new Error(t.prd + ' 里找不到小节锚点：' + t.heading)
    const same = lines.slice(range.start, range.end).join('\n') === body.join('\n').replace(/\n$/, '') + '\n' ||
      lines.slice(range.start, range.end).join('\n').trim() === body.join('\n').trim()
    if (opts.apply) {
      const out = lines.slice(0, range.start).concat(body, lines.slice(range.end))
      const outside = lines.slice(0, range.start).concat(lines.slice(range.end))
    const keptBefore = outside.filter((l) => l.trim() && l.startsWith('| `'))
      const keptAfter = out.filter((l) => l.trim() && l.startsWith('| `'))
      const lost = keptBefore.filter((l) => keptAfter.indexOf(l) < 0)
      if (lost.length) throw new Error(t.prd + ' 替换时丢了**本节之外**的表行 ' + lost.length + '：' + lost[0].slice(0, 60))
      fs.writeFileSync(file, out.join(eol))
      report.push({ prd: t.prd, drift: !same, rows: body.length - 7 })
    } else {
      report.push({ prd: t.prd, drift: !same, rows: body.length - 7 })
    }
  }
  return report
}

if (require.main === module) {
  const argv = process.argv.slice(2)
  const apply = argv.indexOf('--apply') >= 0
  const check = argv.indexOf('--check') >= 0
  if (!apply && !check) {
    console.log('用法：node scripts/gen-prd-copy-table.js --apply | --check')
    process.exit(2)
  }
  const repoRoot = path.resolve(__dirname, '..')
  let r
  try {
    r = render({ apply, repoRoot })
  } catch (e) {
    console.error('[copy-table] 失败：' + e.message)
    process.exit(1)
  }
  for (const x of r) console.log((x.drift ? 'DRIFT ' : 'OK    ') + x.prd + ' 表行=' + x.rows + (apply && x.drift ? '（已重写）' : ''))
  if (check && r.some((x) => x.drift)) {
    console.error('[copy-table] 与 locale 不一致 ⇒ 跑 `node scripts/gen-prd-copy-table.js --apply` 后一并提交（本节禁止手工维护）')
    process.exit(1)
  }
  process.exit(0)
}

module.exports = { render, loadLocale, flat, buildTable, sectionRange, TARGETS }

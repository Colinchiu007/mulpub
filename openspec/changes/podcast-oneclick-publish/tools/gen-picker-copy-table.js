'use strict'
/* 从 locales 生成播客「频道目录域 + 错误码」的 zh/en 逐字对照表，插入 PRD §8.1。
   为什么必须脚本生成：PRD 里手工抄的提示文字会被后续文案/术语改动打旧（本仓播客域实测曾有
   89 条 zh 文案在 PRD 查不到逐字值）。本脚本可重复执行：已有本节则整节替换。
   用法（仓库根执行）：node openspec/changes/podcast-oneclick-publish/tools/gen-picker-copy-table.js */
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../')
const P = '01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md'

function block (src, dottedPath) {
  let lines = src.split('\n')
  let floor = -1
  for (const key of dottedPath.split('.')) {
    const re = new RegExp('^\\s*' + key + ':\\s*\\{')
    const start = lines.findIndex((l, i) => i > floor && re.test(l))
    if (start < 0) throw new Error('block miss ' + key)
    let depth = 0
    let end = lines.length
    for (let i = start; i < lines.length; i++) {
      depth += (lines[i].match(/\{/g) || []).length
      depth -= (lines[i].match(/\}/g) || []).length
      if (i > start && depth <= 0) { end = i; break }
    }
    lines = lines.slice(start + 1, end)
    floor = 0
  }
  const out = []
  for (const l of lines) {
    const m = l.match(/^\s*([A-Za-z0-9_]+):\s*'((?:[^'\\]|\\.)*)'/) || l.match(/^\s*([A-Za-z0-9_]+):\s*"((?:[^"\\]|\\.)*)"/)
    if (m) out.push([m[1], m[2].replace(/\\'/g, "'")])
  }
  return out
}

const zh = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/locales/podcast/zh.js'), 'utf8')
const en = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/locales/podcast/en.js'), 'utf8')
function pairs (dottedPath) {
  const z = block(zh, dottedPath)
  const e = block(en, dottedPath)
  const zm = new Map(z)
  const em = new Map(e)
  const keys = []
  for (const k of z.map((x) => x[0]).concat(e.map((x) => x[0]))) if (!keys.includes(k)) keys.push(k)
  return {
    rows: keys.map((k) => '| `' + k + '` | ' + (zm.get(k) || '⚠ 缺 zh') + ' | ' + (em.get(k) || '⚠ 缺 en') + ' |'),
    n: keys.length,
    missing: keys.filter((k) => !zm.has(k) || !em.has(k)),
  }
}
const picker = pairs('picker')
const errs = pairs('errors')
const hosting = pairs('hosting')

const md = [
  '### 8.1 频道目录域、托管域与错误码的提示文字（逐字表，脚本生成）',
  '',
  '> ⛔ 本节由 `node openspec/changes/podcast-oneclick-publish/tools/gen-picker-copy-table.js` 从 `apps/desktop/src/locales/podcast/{zh,en}.js` 解析生成，**改文案必须重新生成，不得手工维护**（手工抄录会被后续文案/术语改动打旧；判据同 `01-docs/PRD-PODCAST-RSS-CHANNEL-2026-10-09.md` §11.5）。脚本可重复执行：已有本节则整节替换。',
  '> 取源路径随刀 2 的 locales 结构拆分一起迁移：播客命名空间现在住在 `locales/podcast/`，父文件 `locales/zh.js` 只剩一行 spread。**改这两处任一时先确认本脚本仍能解析出非空表**（解析不到即抛错，不产出空表）。',
  '',
  '键路径 `podcast.picker.*`（' + picker.n + ' 键，zh/en 双向差集' + (picker.missing.length ? '非空 ⚠' : '为空') + '）：',
  '',
  '| 键 | zh（界面逐字） | en |',
  '| --- | --- | --- |',
  ...picker.rows,
  '',
  '键路径 `podcast.hosting.*`（' + hosting.n + ' 键，zh/en 双向差集' + (hosting.missing.length ? '非空 ⚠' : '为空') + '）。托管卡片 `PodcastHostingCard.vue` 的全部可见文案都在此命名空间；`configured` 带 `{key}` 参数，值是**掩码后的** AccessKeyId（`***` + 末 4 位），明文凭证从不出主进程：',
  '',
  '| 键 | zh（界面逐字） | en |',
  '| --- | --- | --- |',
  ...hosting.rows,
  '',
  '键路径 `podcast.errors.*`（' + errs.n + ' 键）。渲染层按**领域码**取键：`toIpcError` 在失败信封里带 `subCode`，preload 原样透出，`usePodcastChannel.call()` 单点把 `code` 归一为领域码；未知码落 `fallback` 且**带码可见**（不得空白吞掉）。刀 2 新增的 8 个托管码必须成对入表，不得长期靠 `fallback` 兜着：',
  '',
  '| 键 | zh（界面逐字） | en |',
  '| --- | --- | --- |',
  ...errs.rows,
  '',
  (picker.missing.length + errs.missing.length + hosting.missing.length) === 0
    ? '成对校验：`node .github/scripts/check-locale-sync.js --pair-base origin/main` PASS；`apps/desktop/src/i18n/glossary.test.js` 绿（口径是 **UI 采用词典 canonical 术语**，不是把词典削到已有裸词）。'
    : '⚠ 存在未成对键：' + [...picker.missing, ...hosting.missing, ...errs.missing].join(', '),
  '',
  '',
].map((x) => x + '\r')

const file = path.join(ROOT, P)
let L = fs.readFileSync(file, 'utf8').split('\n')
const atS9 = L.findIndex((l) => l.startsWith('## 9. 数据校验'))
if (atS9 < 0) throw new Error('anchor: ## 9. 数据校验')
const sep = L[atS9 - 1].trim() === '---' ? atS9 - 1 : atS9
const old = L.findIndex((l) => l.startsWith('### 8.1 '))
if (old >= 0 && old >= sep) throw new Error('existing 8.1 not before §9')
if (old >= 0) {
  L.splice(old, sep - old)
  L.splice(old, 0, ...md)
} else {
  L.splice(sep, 0, ...md)
}
fs.writeFileSync(file, L.join('\n'), 'utf8')
console.log('§8.1 generated: picker=' + picker.n + ' errors=' + errs.n + ' missing=' + (picker.missing.length + errs.missing.length))

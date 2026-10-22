/**
 * 把视觉巡检的「改造前 / 改造后」对照截图挑出一组关键页，落到可入库的文档资产目录。
 *
 * 为什么只挑一组：
 *   全量 387 张截图共 48 MB，且 `tests/visual-testing/screenshots/` 按仓库约定是 gitignored
 *   （原始渲染不入库，只留 base-screenshots 里的评审基线）。
 *   但报告需要「肉眼可证」的证据，所以按 `01-docs/assets/` 的既有惯例挑一组代表性页面入库。
 *
 * 用法：node scripts/curate-ui-audit-evidence.js
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../../../../..')
const SHOTS = path.join(ROOT, 'apps/desktop/tests/visual-testing/screenshots')
const OUT = path.join(ROOT, '01-docs/assets/ui-visual-audit-2026-10-20')

/** 关键页面（路由默认态，改造前 / 改造后对照） */
const PICKED = [
  { id: 'a-home', name: '01-home', label: '首页工作台' },
  { id: 'a-dashboard', name: '02-dashboard', label: '数据看板' },
  { id: 'a-publish', name: '03-publish', label: '一键发布' },
  { id: 'a-accounts', name: '04-accounts', label: '账号管理' },
  { id: 'a-collection', name: '05-collection', label: '素材采集' },
  { id: 'a-performanceinsights', name: '06-performance-insights', label: '效能洞察' },
  { id: 'a-hottopics', name: '07-hot-topics', label: '热点选题' },
  { id: 'a-knowledgebase', name: '08-knowledge-base', label: '知识库' },
  { id: 'a-podcastchannel', name: '09-podcast-channel', label: '播客频道' },
  { id: 'a-create', name: '10-video-create', label: '视频创作' },
]

function findShot (dir, id) {
  if (!fs.existsSync(dir)) return null
  const file = fs.readdirSync(dir).find(f => f.endsWith(`-${id}.png`) || f === `${id}.png`)
  return file ? path.join(dir, file) : null
}

function main () {
  fs.mkdirSync(OUT, { recursive: true })
  const copied = []
  const missing = []
  for (const item of PICKED) {
    for (const [variant, dir] of [['before', path.join(SHOTS, 'ui-audit-before')], ['after', path.join(SHOTS, 'ui-audit')]]) {
      const source = findShot(dir, item.id)
      if (!source) {
        missing.push(`${variant}:${item.id}`)
        continue
      }
      const target = path.join(OUT, `${item.name}-${variant}.png`)
      fs.copyFileSync(source, target)
      copied.push(target)
    }
  }
  const manifest = copied.map(file => ({
    file: path.relative(ROOT, file).split(path.sep).join('/'),
    sizeKb: Math.round(fs.statSync(file).size / 1024),
  }))
  fs.writeFileSync(
    path.join(OUT, 'README.md'),
    [
      '# UI 视觉巡检 · 改造前后对照（2026-10-20）',
      '',
      '本目录是 [UI 视觉巡检与高级感升级方案](../../../UI-VISUAL-AUDIT-2026-10-20.md) 的视觉证据。',
      '',
      '每组两张：`-before.png` = 改造前，`-after.png` = 改造后（同一视口 1440×900、',
      '同一份 fixture 数据、同一套渲染稳定化参数，差异只来自视觉层改动）。',
      '',
      '| 对照 | 页面 | before | after |',
      '|---|---|---|---|',
      ...PICKED.map((item, i) => `| ${String(i + 1).padStart(2, '0')} | ${item.name.slice(3)} | \`-before.png\` | \`-after.png\` |`),
      '',
      '> 全量 177 张界面面截图（含标签页 / 交互态 / 浮层 / 暗色对照）不在库内，',
      '> 按仓库约定留在 `apps/desktop/tests/visual-testing/screenshots/ui-audit/`（gitignored），',
      '> 其清单见 `apps/desktop/tests/visual-testing/reports/ui-audit-manifest.md`。',
      '',
      '## 证据清单',
      '',
      ...manifest.map(m => `- \`${m.file}\`（${m.sizeKb} KB）`),
      '',
    ].join('\n'),
    'utf8',
  )
  console.log(`已挑出对照证据 ${copied.length} 张 → ${path.relative(ROOT, OUT)}`)
  if (missing.length) console.log(`未命中：${missing.join(', ')}`)
}

main()

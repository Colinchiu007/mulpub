/**
 * PublishHistory.row-view.test.js — 行内函数缓存的两条形状约束（UX 审计 2.2②）
 *
 * 本文件不测"有没有变快"（那要基准跑，且 CI 机器噪声大于收益），它测**会让缓存变成缺陷的两条形状**：
 *  1. **不得跨渲染持久化**：`platformName` / `platformIcon` 读的是 `platformStore`，
 *     平台标签与图标是**异步加载**的（先用默认值、store 到货后再变）。
 *     若有人把它从 `computed` 改成模块级 `new Map()`（性能"优化"的常见写法），
 *     默认标签会被永久钉住 —— 视觉上看就是"平台名一直不对"，而单测、构建全绿。
 *  2. **模板里不得再出现裸的昂贵调用**：行内 35 次/行的调用收敛到 `rowView(record)` 之后，
 *     任何回退（把 `thumbnailUrl(record)` 再写回模板）都会让这一行重新付 2–3 倍成本。
 *
 * 行为等价性不在这里测：既有 `PublishHistory.test.js`（该视图的全量渲染用例）在本次改造后
 * 一字未改仍全绿，那才是"渲染结果没变"的证据。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PublishHistory.vue'), 'utf8').replace(/\r\n/g, '\n')
const TEMPLATE = SRC.slice(0, SRC.indexOf('\n<script'))

describe('PublishHistory · 行视图缓存的形状约束（审计 2.2②）', () => {
  it('缓存必须是 computed（随依赖重算），不得是跨渲染的持久 Map', () => {
    const m = /const rowViews = computed\(\(\) => \{[\s\S]*?\n\}\)/.exec(SRC)
    expect(m, '取不到 rowViews 的 computed 定义 ⇒ 缓存形状已变，判据必须问一句为什么').toBeTruthy()
    expect(m[0]).toMatch(/for \(const record of filteredRecords\.value\)/)
    // 反串：模块级/函数级的常驻 Map 一旦出现即为陈旧缓存
    expect(SRC).not.toMatch(/^const\s+\w*[Cc]ache\w*\s*=\s*new Map\(\s*\)\s*$/m)
    expect(SRC).not.toMatch(/rowViews\s*=\s*new Map\(\)/)
  })

  it('兜底路径与建表路径必须共用同一份实现（Map 未命中不得让行内容消失）', () => {
    expect(SRC).toMatch(/function rowView \(record\) \{\s*return rowViews\.value\.get\(record\) \|\| buildRowView\(record\)\s*\}/)
    const built = /function buildRowView \(record\) \{[\s\S]*?\n\}/.exec(SRC)
    expect(built).toBeTruthy()
    for (const key of ['thumb', 'icon', 'platformLabel', 'errorText']) {
      expect(built[0], 'buildRowView 必须产出 ' + key).toContain(key + ':')
    }
  })

  it('模板内不得再出现 record 作用域的裸昂贵调用（含缩略图、平台图标/名、错误文本）', () => {
    const bare = /(thumbnailUrl|platformIcon|platformName|recordErrorText)\(record(?:\.platform)?\)/g
    const hits = TEMPLATE.match(bare) || []
    expect(hits, '模板回退成裸调用：' + hits.join(', ')).toEqual([])
    // 正向对偶：禁令单独存在时"删掉缓存"与"删掉需求"同形 —— 这里必须看见 rowView 真在被用
    expect((TEMPLATE.match(/rowView\(record\)\.\w+/g) || []).length).toBeGreaterThanOrEqual(6)
  })

  it('metricValue 不得进缓存（键域无上界 = 长会话无界增长，与 useNotify 去重集合同型缺陷）', () => {
    // 判据必须**限定在函数体内**：`[\s\S]*?metricValue` 不加右边界会一路吞到文件里
    // 后面任意一处 metricValue（模板、导出行都用它），于是"函数体里没有"也被读成"有"。
    const body = /function buildRowView \(record\) \{([\s\S]*?)\n\}/.exec(SRC)
    expect(body, '取不到 buildRowView 函数体 ⇒ 判据失明').toBeTruthy()
    expect(body[1], '把 metricValue 塞进行视图缓存会引入无上界的键域').not.toMatch(/metricValue/)
    // 正向对偶：它确实还在模板里被直接调用（否则这条禁令是在保护一个不存在的东西）
    expect(TEMPLATE).toMatch(/metricValue\(/)
  })
})

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// 本文件是 PublishHistory 卡片渲染路径的**源码契约锁**（阶段 2.2 / audit-61）。
// 单独成文件的原因不是分类偏好，而是门禁：`apps/desktop/src/views/PublishHistory.test.js`
// 已被 .github/scripts/check-max-lines.js 的 testLimit=1500 卡住，任何新增都必须落在
// 新文件里，否则只能靠调高上限让它不红 —— 那是拆锁。
// 这些锁不挂载组件（纯读源码），因此不需要主测试文件里的 mountView 夹具。
// 阶段 2.2（audit-61）b) 的**接线锁**：行内派生函数必须真的收敛进 `rowMeta` 查表。
// 为什么行为用例不够：把 `metaFor(record).audit` 改回 `auditLabel(record)` 后，
// 渲染结果**逐字相同**（函数还在、还正确），93 条行为用例一条都不会红 ——
// 而性能收益已经没了。这类「改了不坏」的收敛只能靠读模板原文来锁。
// 锚点纪律（AGENTS.md「结构锁锚点静默失效」）：起止两个锚点都先断言存在、缺失即红，
// 不得用 indexOf 的 -1 当终点（那会把判定域静默放大到接近整份文件）。
describe('PublishHistory — 卡片渲染路径必须查表而非逐行重算（2.2 接线锁）', () => {
  const SOURCE = fs.readFileSync(path.resolve(process.cwd(), 'src/views/PublishHistory.vue'), 'utf8')

  /** 卡片 v-for 块的原文；锚点缺失时**抛错**（不得返回空串——空串会让 below 变成恒真） */
  function cardBlock () {
    const startNeedle = 'v-for="record in visibleRecords"'
    const start = SOURCE.indexOf(startNeedle)
    if (start < 0) throw new Error(`锚点缺失：${startNeedle}`)
    const end = SOURCE.indexOf('</article>', start)
    if (end < 0) throw new Error('锚点缺失：卡片块的 </article>')
    return SOURCE.slice(start, end)
  }

  // 允许在渲染路径上直接拿 record 调用的名字：**闭合清单，只能缩小**。
  // metaFor = 查表本身；其余三个是事件处理器（点击时才跑，不参与每次渲染）。
  const ALLOWED_RENDER_CALLS = new Set(['metaFor', 'openRecord', 'retryRecord', 'republishRecord'])

  it('卡片块内除查表与点击处理器外，不得再有 (record) 形式的逐行函数调用', () => {
    const block = cardBlock()
    const found = [...block.matchAll(/\b([A-Za-z_$][\w$]*)\(\s*record\s*\)/g)].map((m) => m[1])
    // 反失明：解析退化/域为空时必须出声，否则「零违规」与「什么都没扫」同形
    expect(found.length).toBeGreaterThan(10)
    const offenders = [...new Set(found.filter((name) => !ALLOWED_RENDER_CALLS.has(name)))]
    expect(offenders).toEqual([])
  })

  it('模板用到的每个 metaFor 键都在 rowMeta 里产出（死键锁）', () => {
    const block = cardBlock()
    const usedKeys = [...new Set([...block.matchAll(/metaFor\(record\)\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))]
    expect(usedKeys.length).toBeGreaterThan(10)
    const builderStart = SOURCE.indexOf('const rowMeta = computed(')
    if (builderStart < 0) throw new Error('锚点缺失：const rowMeta = computed(')
    const builderEnd = SOURCE.indexOf('\n})', builderStart)
    if (builderEnd < 0) throw new Error('锚点缺失：rowMeta 的收尾括号')
    const builder = SOURCE.slice(builderStart, builderEnd)
    // 两种写法都要认：`key: value` 与 ES6 简写 `icon,`。
    // （本锁第一版只认冒号形态，于是把 `icon,` 报成死键 —— 锁的解析盲区必须自己吃掉，
    //   不得反过来把生产代码改成迎合锁的形状。）
    const produced = new Set([
      ...[...builder.matchAll(/^\s{6}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]),
      ...[...builder.matchAll(/^\s{6}([A-Za-z_$][\w$]*),\s*$/gm)].map((m) => m[1])
    ])
    expect(usedKeys.filter((k) => !produced.has(k))).toEqual([])
  })

  it('封面缩略图只喂 visibleRecords，未渲染的行不去取封面', () => {
    // 阶段 2.1 的前置：`useHistoryCoverThumbnails` 的输入必须是渲染上限内的列表，
    // 否则 200 条上限只减少了 DOM，IPC 次数一条没少。
    const call = SOURCE.match(/useHistoryCoverThumbnails\(([^)]*)\)/)
    expect(call, 'useHistoryCoverThumbnails 调用点缺失').not.toBeNull()
    expect(call[1].trim()).toBe('visibleRecords')
  })
})

// 阶段 2.2 抽出后的**装配锁**：注册 ≠ 注入 ≠ 生效。
// 把函数搬进 composable 只完成了一半；如果视图里既没有 import 也没有解构调用，
// 组件会退回「自带一份实现」的状态，而行为用例一条都不会红（两份实现等价）。
describe('PublishHistory — 展示值映射确实由 composable 提供（装配锁）', () => {
  const VUE = fs.readFileSync(path.resolve(process.cwd(), 'src/views/PublishHistory.vue'), 'utf8')
  const ACTIONS = fs.readFileSync(path.resolve(process.cwd(), 'src/composables/usePublishRecordActions.js'), 'utf8')

  it('视图 import 并解构调用 usePublishHistoryRowFormat', () => {
    expect(VUE).toContain("import { usePublishHistoryRowFormat } from '@/composables/usePublishHistoryRowFormat'")
    expect(VUE).toMatch(/\}\s*=\s*usePublishHistoryRowFormat\(\{\s*t,\s*platformStore\s*\}\)/)
  })

  it('视图内不得再自带被抽出的函数实现（只允许一份真源）', () => {
    for (const name of ['recordTitle', 'publisherName', 'contentTypeValue', 'deliveryModeLabel', 'metricValue', 'contentPreview']) {
      // 注意 `\\s` / `\\(`：模板字面量里单反斜杠会被 JS 吃掉（\\s → s），
      // 于是 RegExp 变成未闭合分组、当场 SyntaxError —— 锁自己坏了必须红，不能当成"视图没问题"。
      expect(VUE, `视图仍自带 function ${name}`).not.toMatch(new RegExp(`function ${name}\\s*\\(`))
    }
  })

  it('状态判据收敛到 utils/publish-record-status，两个消费者各引一次', () => {
    const UTIL = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/publish-record-status.js'), 'utf8')
    expect(UTIL).toMatch(/export function statusValue/)
    expect(UTIL).toMatch(/export function normalizedStatusGroup/)
    expect(ACTIONS).toContain("from '@/utils/publish-record-status'")
    // usePublishRecordActions 不得再自带第二份（注释里提到不算，按函数声明形态判）
    expect(ACTIONS).not.toMatch(/const statusValue\s*=\s*\(/)
    expect(ACTIONS).not.toMatch(/const normalizedStatusGroup\s*=\s*\(/)
  })

  it('rowFormat 必须在 contentLink 之前解构（recordTitle 被后者当作依赖消费）', () => {
    // TDZ 回归：这个顺序不是风格问题。`usePublishHistoryContentLink({ t, recordTitle, ... })`
    // 在 setup 期**求值**就取用了 recordTitle；一旦 rowFormat 的解构排到它后面，
    // 挂载即抛 `Cannot access 'recordTitle' before initialization`（本仓实测发生过一次）。
    const rowIdx = VUE.indexOf('= usePublishHistoryRowFormat(')
    const linkIdx = VUE.indexOf('= usePublishHistoryContentLink(')
    expect(rowIdx).toBeGreaterThan(-1)
    expect(linkIdx).toBeGreaterThan(-1)
    expect(rowIdx).toBeLessThan(linkIdx)
  })
})

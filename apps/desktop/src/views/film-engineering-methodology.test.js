// @vitest-environment jsdom
/**
 * 影视工程 v2 · F-H / F-I 前端契约测试（openspec change: film-pipeline-prompt-triple-and-guards）
 *
 * 两条：
 *   ① **方法论分区补全**（F-H）：`FilmEngineeringView.vue` 的方法论标签页此前只渲染
 *      blocks / rules / glossary，**配方（recipes）与失败台账（failureLedger）在 kit 数据里却没渲染**
 *      ⇒ 补两个**只读**分区（源码级契约：分区存在 + 绑定的是对的字段 + **无写操作**）。
 *   ② **i18n 清单与计数对账**（第 4 轮评审 i1）：方案里写「20 个 key」，
 *      就必须**数一遍 locale 文件里实际有几个** —— 清单与文件对不上就是欠账。
 *
 * 为什么用源码级契约而不是整页 mount：`FilmEngineeringView` 依赖整套分镜库/方法论 IPC，
 * 整页 mount 的成本与噪声远大于这两条断言要锁的东西（仓内同型先例：
 * `RiskSuspendedBanner.source.test.js`、`icon-usage.test.js`、`locales/model-providers-copy.test.js`）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(process.cwd(), 'src')
const VIEW = path.join(SRC, 'views/FilmEngineeringView.vue')
const PANEL = path.join(SRC, 'views/film-auto/FilmAutoPanel.vue')
const ZH = path.join(SRC, 'locales/film-engineering/zh.js')
const EN = path.join(SRC, 'locales/film-engineering/en.js')

const viewSrc = fs.readFileSync(VIEW, 'utf8')
const panelSrc = fs.readFileSync(PANEL, 'utf8')
const zhSrc = fs.readFileSync(ZH, 'utf8')
const enSrc = fs.readFileSync(EN, 'utf8')

/**
 * 本次新增的 **27** 个 i18n key（与方案 §四末的清单逐条对应）。
 *
 * 20 → 24 的由来（第 9 轮 i6 / i7）：
 *   - `methodologyDeliverable` / `methodologyAssets` / `methodologyFrame`：**行标签**。
 *     此前面板的三行（可否直送 / 资产完整性 / 尾帧约束）**复用了「任务模板」作行标签** ——
 *     自检断言只查「key 存不存在」，查不出「行标签被复用」。
 *   - `methodologyNotDeliverableAssets`：聚合提示**按 reason 分流**的第二态
 *     （有真·资产缺口时要说「或补齐对应资产」；只剩 byDesign 时只说「人工补齐」）。
 */
const NEW_KEYS = [  // ①-③ 方法论分区（doctrine 命名空间）
  'filmEngineering.doctrine.recipes',
  'filmEngineering.doctrine.recipeBlocks',
  'filmEngineering.doctrine.failureLedger',
  'filmEngineering.doctrine.failureCause',
  'filmEngineering.doctrine.failureFix',
  // ④-⑧ 失败台账的行标签
  'filmEngineering.doctrine.failureSymptom',
  'filmEngineering.doctrine.failureTags',
  // ⑨-⑳ 接入状态面板（auto 命名空间）
  'filmEngineering.auto.methodology',
  'filmEngineering.auto.methodologyTask',
  'filmEngineering.auto.methodologyHit',
  'filmEngineering.auto.methodologyBlocked',
  'filmEngineering.auto.methodologyDeliverable',
  'filmEngineering.auto.methodologyAssets',
  'filmEngineering.auto.methodologyFrame',
  'filmEngineering.auto.methodologyNotDeliverable',
  'filmEngineering.auto.methodologyNotDeliverableAssets',
  'filmEngineering.auto.methodologyAssetsIncomplete',
  'filmEngineering.auto.methodologyFramePending',
  'filmEngineering.auto.methodologyAssetHash',
  'filmEngineering.auto.methodologyNoLibrary',
  'filmEngineering.auto.methodologyReasonByDesign',
  'filmEngineering.auto.methodologyReasonAssetMissing',
  'filmEngineering.auto.methodologyReasonTemplateVar',
  'filmEngineering.auto.methodologyReasonBadVarName',
  'filmEngineering.auto.methodologyReasonOversizeVar',
  'filmEngineering.auto.methodologyStale',
  'filmEngineering.auto.methodologyTruncated',
]

/** 从 locale 源文件里读某个 key 的字面量值（模块作用域：多个 describe 共用） */
const readValue = (src, leaf) => {
  const m = src.match(new RegExp('"' + leaf + '"\\s*:\\s*"([^"]*)"'))
  return m ? m[1] : null
}

describe('F-H · 方法论分区补全（只读）', () => {
  it('方法论标签页渲染 recipes 与 failureLedger 两个分区', () => {
    expect(viewSrc).toContain('data-testid="fe-doctrine-recipes"')
    expect(viewSrc).toContain('data-testid="fe-doctrine-failure-ledger"')
    expect(viewSrc).toContain('doctrine.recipes || []')
    expect(viewSrc).toContain('doctrine.failureLedger || []')
  })

  it('配方区渲染 blockKeys（配方含哪些块）', () => {
    expect(viewSrc).toContain('r.blockKeys || []')
    expect(viewSrc).toContain('filmEngineering.doctrine.recipeBlocks')
  })

  it('失败台账渲染 symptom / cause / fix / tags', () => {
    expect(viewSrc).toContain('f.symptom')
    expect(viewSrc).toContain('f.cause')
    expect(viewSrc).toContain('f.fix')
    expect(viewSrc).toContain('f.tags || []')
  })

  it('两个分区**只读**：不得含写操作（@click / v-model / el-input / el-button）', () => {
    const slice = (from, to) => viewSrc.slice(viewSrc.indexOf(from), viewSrc.indexOf(to))
    const recipes = slice('data-testid="fe-doctrine-recipes"', 'data-testid="fe-doctrine-failure-ledger"')
    const ledger = slice('data-testid="fe-doctrine-failure-ledger"', 'filmEngineering.doctrine.glossary')
    for (const block of [recipes, ledger]) {
      expect(block).not.toContain('@click')
      expect(block).not.toContain('v-model')
      expect(block).not.toContain('<el-input')
      expect(block).not.toContain('<el-button')
    }
  })
})

describe('F-I · 接入状态面板（只读，plan 级）', () => {
  it('面板渲染方法论接入状态分区', () => {
    expect(panelSrc).toContain('data-testid="fa-methodology"')
    expect(panelSrc).toContain('methodology.hitVars')
    expect(panelSrc).toContain('methodology.totalVars')
  })

  /**
   * 第 9 轮 i4（Warning / feasibility）：这块面板此前**只挂在规划结果**上
   * （`v-if="plan.methodology"`）⇒ **重开一个已规划的项目时整块不显示**，
   * 而落盘的 `promptContext` + 逐镜 `promptMissing` 没人重新汇总。
   *
   * ⇒ 面板改为读一个**计算属性**（规划结果优先、其次项目投影），
   * 且服务端在 `projectView` 里用**同一个** `buildMethodologySummary` 重新汇总。
   */
  it('面板从**计算属性**读方法论状态（规划结果优先、其次项目投影 ⇒ 重开项目也可见）', () => {
    expect(panelSrc).toContain('const methodology = computed(')
    expect(panelSrc).toContain('plan.value && plan.value.methodology')
    expect(panelSrc).toContain('project.value && project.value.methodology')
    // 面板**不得**再直接读 plan.methodology（否则重开项目就没有数据源）
    expect(panelSrc).not.toContain('plan.methodology.hitVars')
    expect(panelSrc).not.toContain('v-if="plan.methodology"')
  })

  it('面板显示命中数、未接入变量、不可直送、资产不完整、尾帧待派生', () => {
    for (const id of [
      'fa-methodology-hit',
      'fa-methodology-blocked',
      'fa-methodology-not-deliverable',
      'fa-methodology-assets-incomplete',
      'fa-methodology-frame-pending',
    ]) {
      expect(panelSrc).toContain('data-testid="' + id + '"')
    }
  })

  it('面板**只读**：不得含写操作（@click / v-model）', () => {
    const block = panelSrc.slice(panelSrc.indexOf('data-testid="fa-methodology"'), panelSrc.indexOf('fa-shot-preview'))
    expect(block).not.toContain('@click')
    expect(block).not.toContain('v-model')
  })
})

describe('F-I · i18n 清单与计数对账（第 4 轮评审 i1）', () => {
  it('清单条数 = 27（方案里写几个，代码里就得是几个）', () => {
    expect(NEW_KEYS.length).toBe(27)
  })

  it('27 个 key 在 zh / en **都存在**（成对）', () => {
    for (const key of NEW_KEYS) {
      const leaf = key.split('.').pop()
      expect(zhSrc, 'zh 缺 ' + key).toContain('"' + leaf + '"')
      expect(enSrc, 'en 缺 ' + key).toContain('"' + leaf + '"')
    }
  })

  it('zh / en 的新 key **数量一致**（不得一边多一边少）', () => {
    const count = (src) => NEW_KEYS.filter(k => src.includes('"' + k.split('.').pop() + '"')).length
    expect(count(zhSrc)).toBe(count(enSrc))
    expect(count(zhSrc)).toBe(27)
  })
})

/**
 * 第 10 轮 i1（Critical/consistency）：**三处计数同源** ——
 * 方案简报（§〇 FINAL / §四末清单 / 改动量段 / §七速查表）、本 PRD（§8.b）、
 * 本测试的 `NEW_KEYS` 长度，**说的必须是同一个数**。
 *
 * 这条判据的由来：第 10 轮 critic 抓到「§〇 与 §四末写 24、改动量段与 §七D 还写 20」——
 * **正是简报自己警告的「计数欠账」同型**，而且**人手维护十来个章节的同一个数字必然漏**。
 * ⇒ 把它变成**机器断言**：文档里出现「N 个 key」「编号 1-N」「清单条数 == N」的地方，
 *   N 必须都等于 `NEW_KEYS.length`。
 */
describe('F-I · 三处计数同源（第 10 轮 i1）', () => {
  const BRIEF = path.resolve(process.cwd(), '../../openspec/changes/film-pipeline-prompt-triple-and-guards/review-brief-pr3.md')
  const PRD = path.resolve(process.cwd(), '../../01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md')

  const numbersIn = (text) => {
    const out = []
    // 只认「总数」性质的表述；**不**认分组编号（"编号 1-7 / 8-19 / …" 里的 7 不是总数）
    for (const re of [
      /(\d+)\s*个\**\s*i18n\s*key/gi,
      /zh\/en\s*各\s*(\d+)/g,
      /清单条数\s*==\s*(\d+)/g,
      /总数\s*(\d+)/g,
      /i18n\s*key\s*数\s*\|\s*\*\*(\d+)\s*个/g,
    ]) {
      let m
      while ((m = re.exec(text)) !== null) {
        // 行内上下文限定：只在**提到 key 的那一行**算数 ——
        // 否则「§六 引用旧断言原文『命中数 + 清单条数 == 7』」这类散文会被误判成 key 计数。
        const lineStart = text.lastIndexOf('\n', m.index) + 1
        let lineEnd = text.indexOf('\n', m.index)
        if (lineEnd < 0) lineEnd = text.length
        const line = text.slice(lineStart, lineEnd)
        if (!/key/i.test(line)) continue
        out.push(Number(m[1]))
      }
    }
    return out
  }

  /** 文档里**逐条列出的** key 行号（"| 12 | `filmEngineering.…` |"） */
  const listedRowNumbers = (text) => {
    const out = []
    const re = /^\|\s*(\d+)\s*\|\s*`filmEngineering\./gm
    let m
    while ((m = re.exec(text)) !== null) out.push(Number(m[1]))
    return out
  }

  it('方案简报与 PRD 里出现的 key 计数，**全部等于** NEW_KEYS.length', () => {
    const n = NEW_KEYS.length
    for (const p of [BRIEF, PRD]) {
      const text = fs.readFileSync(p, 'utf8')
      const nums = numbersIn(text)
      expect(nums.length, p + ' 里没找到任何 key 计数（判据可能已失效）').toBeGreaterThan(0)
      const bad = nums.filter(x => x !== n)
      expect(bad, p + ' 里的 key 计数与清单长度 ' + n + ' 不一致：' + JSON.stringify(bad)).toEqual([])
    }
  })

  /**
   * 第 14 轮 i4 的延伸：简报里的**交叉引用**（`§五之三 i4` / `§六-1` / `§四末` …）也会漂 ——
   * 引用一个**不存在**的章节，实施者会照着找了半天。
   *
   * 这条判据把「引用能解析」变成机器事实：简报里出现的每一个 `§<章节号>`，
   * 都必须能在同一份文档里找到对应标题。
   */
  it('断言表的**条目 id 唯一**、且**行数 == 最大编号**（第 15 轮 i4：文档自称计数同源，自身却重复了一整行）', () => {
    const BRIEF = path.resolve(process.cwd(), '../../openspec/changes/film-pipeline-prompt-triple-and-guards/review-brief-pr3.md')
    const text = fs.readFileSync(BRIEF, 'utf8')
    const start = text.indexOf('| # | 断言 | 类别 | 测试文件 | 用例名（拟） |')
    const rows = text.slice(start).split('\n').filter(l => /^\|\s*[①-㊲]/.test(l))
    const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲'
    const ids = rows.map(l => {
      const cell = l.trim().split('|')[1].trim()
      const m = cell.match(/^([①-㊲])(b?)$/)
      return m ? CIRCLED.indexOf(m[1]) + 1 + (m[2] === 'b' ? 0.5 : 0) : -1
    })
    for (const n of ids) expect(n).toBeGreaterThan(0)
    // ①b 与 ① 同号（子项）⇒ 允许 0.5 的小数
    const max = Math.round(Math.max(...ids))
    const distinct = new Set(ids.map(n => Math.round(n)))
    const subCount = ids.filter(n => n % 1 !== 0).length
    // **不重号**：不同编号数 == 最大编号（子项不占新编号），且子项数 == 行数 - 不同编号数
    expect(distinct.size, '断言表的编号有重复或缺号（' + distinct.size + ' 个不同编号，最大 ' + max + '）').toBe(max)
    expect(ids.length, '断言表行数(' + ids.length + ') 应等于不同编号数(' + distinct.size + ') + 子项数(' + subCount + ')')
      .toBe(distinct.size + subCount)
  })

  it('映射表里的 **(文件, 用例名)** 组合唯一（第 15 轮 i7：同名用例无法定位归属）', () => {
    const BRIEF = path.resolve(process.cwd(), '../../openspec/changes/film-pipeline-prompt-triple-and-guards/review-brief-pr3.md')
    const text = fs.readFileSync(BRIEF, 'utf8')
    const start = text.indexOf('| # | 断言 | 类别 | 测试文件 | 用例名（拟） |')
    const rows = text.slice(start).split('\n').filter(l => /^\|\s*[①-㊲]/.test(l))
    const pairs = []
    for (const l of rows) {
      const cells = l.trim().split('|').map(s => s.trim())
      // 行形态：| 编号 | 断言 | 类别 | 测试文件 | 用例名 |
      const file = cells[4]
      const names = cells[5] || ''
      for (const m of names.matchAll(/「([^」]+)」/g)) pairs.push(file + ' → ' + m[1])
    }
    expect(pairs.length).toBeGreaterThan(10)
    const dup = pairs.filter((p, i) => pairs.indexOf(p) !== i)
    expect(dup, '同一 (文件, 用例名) 出现在多条断言里：' + JSON.stringify(dup)).toEqual([])
  })

  it('简报里的**章节交叉引用**都能解析（不指向不存在的章节）', () => {
    const text = fs.readFileSync(BRIEF, 'utf8')
    // 文档里真实存在的章节标题
    const headings = []
    for (const line of text.split('\n')) {
      const m = line.match(/^#{2,3}\s+(.+?)\s*$/)
      if (m) headings.push(m[1].replace(/[*`]/g, '').trim())
    }
    // 引用形如 §一 / §二 / §四末 / §五之三 / §六-1
    const refs = new Set()
    const re = /§([〇一二三四五六七八九十]+(?:之[一二三四五六七八九十]+)?)(末)?(?:-(\d+))?/g
    let m
    while ((m = re.exec(text)) !== null) refs.add(m[1] + (m[3] ? '-' + m[3] : ''))
    expect(refs.size).toBeGreaterThan(3)
    const dangling = []
    for (const r of refs) {
      const base = r.replace(/-\d+$/, '')
      const ok = headings.some(h => h.startsWith(base) || h.startsWith(base + '、') || h.startsWith(base + ' '))
      if (!ok) dangling.push(r)
    }
    expect(dangling, '指向不存在章节的引用：' + JSON.stringify(dangling)).toEqual([])
  })

  it('**验收条目的编号按出现顺序连续、无重号**（第 14 轮 i4：编号本身也会漂）', () => {
    const BRIEF = path.resolve(process.cwd(), '../../openspec/changes/film-pipeline-prompt-triple-and-guards/review-brief-pr3.md')
    const text = fs.readFileSync(BRIEF, 'utf8')
    // 只取 §四 的验收表（表头以「| # | 断言 |」开头）
    const start = text.indexOf('| # | 断言 | 类别 | 测试文件 | 用例名（拟） |')
    expect(start).toBeGreaterThan(-1)
    const rows = text.slice(start).split('\n').filter(l => /^\|\s*[①-㊲]/.test(l))
    expect(rows.length).toBeGreaterThan(20)
    const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲'
    // 单元格可能是「①」或「①b」（① 的子项）⇒ 取**圆圈数字**部分
    const nums = rows.map(l => {
      const cell = l.trim().split('|')[1].trim()
      const m = cell.match(/^([①-㊲])/)
      if (!m) return -1
      return CIRCLED.indexOf(m[1]) + 1
    })
    for (const n of nums) expect(n).toBeGreaterThan(0)
    // ①b 是 ① 的**子项** ⇒ 允许 delta 0；其余必须 delta 1（连续、无重号）
    for (let i = 1; i < nums.length; i++) {
      const delta = nums[i] - nums[i - 1]
      expect(delta === 0 || delta === 1, '编号不连续：' + rows[i - 1].slice(0, 10) + ' → ' + rows[i].slice(0, 10)).toBe(true)
    }
  })

  it('key **分组数**与清单对得上（doctrine 7 + methodology* 15 + reason 5 = 27）', () => {
    const doctrine = NEW_KEYS.filter(k => k.includes('.doctrine.'))
    const reason = NEW_KEYS.filter(k => k.includes('methodologyReason'))
    const other = NEW_KEYS.filter(k => !k.includes('.doctrine.') && !k.includes('methodologyReason'))
    expect(doctrine.length).toBe(7)
    expect(reason.length).toBe(5)
    expect(other.length).toBe(15)
    expect(doctrine.length + reason.length + other.length).toBe(NEW_KEYS.length)
    // 第 13 轮 i2：**reason 枚举条数 == 5**（五类缺失，一类一个 key）
    const REASON_ENUM = ['ByDesign', 'AssetMissing', 'TemplateVar', 'BadVarName', 'OversizeVar']
    for (const r of REASON_ENUM) {
      expect(NEW_KEYS.some(k => k.endsWith('methodologyReason' + r)), '缺 reason key: ' + r).toBe(true)
    }
    expect(NEW_KEYS.filter(k => k.includes('methodologyReason')).length).toBe(REASON_ENUM.length)
  })

  /**
   * 第 13 轮 i8（Warning / clarity）：聚合文案只有两态，
   * 但「byDesign 与 assetMissing **同时存在**」时用哪一态必须**有确定结果**。
   *
   * 实现的优先级：只要存在 `assetMissing` ⇒ 用第二态（带「或补齐对应资产」）。
   * 这条判据锁住「优先级是确定的」—— 否则同一份阻断清单可能渲染出两种文案。
   */
  it('聚合文案的**混合态**有确定结果：存在 assetMissing ⇒ 用第二态（含「或补齐对应资产」）', () => {
    expect(panelSrc).toContain("b.reason === 'assetMissing'")
    expect(panelSrc).toContain('filmEngineering.auto.methodologyNotDeliverableAssets')
    expect(panelSrc).toContain('filmEngineering.auto.methodologyNotDeliverable')
    // 第二态的文案必须真的提到「补齐对应资产」
    const v = readValue(zhSrc, 'methodologyNotDeliverableAssets')
    expect(v).toContain('补齐对应资产')
  })

  it('方案简报与 PRD 的 key 清单**逐条编号**都是 1..N（不留空号、不重复）', () => {
    const n = NEW_KEYS.length
    for (const p of [BRIEF, PRD]) {
      const text = fs.readFileSync(p, 'utf8')
      const rows = listedRowNumbers(text)
      expect(rows.length, p + ' 里没找到 key 清单行（判据可能已失效）').toBe(n)
      expect(rows, p + ' 的 key 清单编号不是连续的 1..' + n).toEqual(
        Array.from({ length: n }, (_, i) => i + 1)
      )
    }
  })
})

/**
 * 第 9 轮 i6（Warning / completeness）：面板的**行标签**此前三行都复用了「任务模板」
 * （可否直送 / 资产完整性 / 尾帧约束 三行的 `<dt>` 都是 `methodologyTask`）。
 *
 * 「key 存不存在」的自检断言**查不出**这类缺口（key 都在，只是被复用了）⇒
 * 这条判据直接扫**面板源码里的行标签**：每一行的 `<dt>` 必须是**互不相同**的 key。
 */
describe('F-I · 面板行标签互不相同（第 9 轮 i6）', () => {
  it('「资产已变」是**区块级**警告（不含 <dt>）—— 否则它会复用别行的行标签', () => {
    expect(panelSrc).toContain('data-testid="fa-methodology-stale"')
    const start = panelSrc.indexOf('data-testid="fa-methodology-stale"')
    const line = panelSrc.slice(panelSrc.lastIndexOf('\n', start) + 1, panelSrc.indexOf('\n', start))
    expect(line).not.toContain('<dt>')
  })

  it('方法论分区内每一行的 <dt> 都是不同的 key', () => {
    // 分区在独立的 `fa-methodology-card` 段里（规划结果与重开项目都渲染这一段）
    const start = panelSrc.indexOf('data-testid="fa-methodology-card"')
    const end = panelSrc.indexOf('</section>', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = panelSrc.slice(start, end)
    const labels = []
    const re = /<dt>\{\{ t\('([^']+)'\) \}\}<\/dt>/g
    let m
    while ((m = re.exec(block)) !== null) labels.push(m[1])
    expect(labels.length).toBeGreaterThanOrEqual(5)
    // 行标签**不得复用**（此前「可否直送 / 资产完整性 / 尾帧约束」三行都用了 methodologyTask）
    expect(new Set(labels).size).toBe(labels.length)
    // 三行各自的行标签必须真的存在（key 不得写错）
    for (const key of labels) {
      expect(zhSrc, 'zh 缺行标签 ' + key).toContain('"' + key.split('.').pop() + '"')
      expect(enSrc, 'en 缺行标签 ' + key).toContain('"' + key.split('.').pop() + '"')
    }
  })
})

/**
 * 第 7 轮 i7（Warning / feasibility）：「不可直送」这条**聚合**提示若写成
 * 「需人工补齐**或先接上缺失资产**」，对 `style_prefix` 就是误导 ——
 * byDesign 的变量**本就没有资产源**（不是「资产还没接上」）。
 *
 * 逐变量原因已经分开了（4 个 `methodologyReason*` key），这条锁的是**聚合**文案别把两类混回去。
 */
describe('F-I · 聚合提示文案不得误导（第 7 轮 i7）', () => {
  it('zh 的「不可直送」文案只说人工补齐，**不暗示接上缺失资产**', () => {
    const v = readValue(zhSrc, 'methodologyNotDeliverable')
    expect(v).toBeTruthy()
    expect(v).not.toContain('缺失资产')
    expect(v).not.toContain('导入')
    expect(v).toContain('人工补齐')
  })

  it('en 的「不可直送」文案同样不提 import the missing assets', () => {
    const v = readValue(enSrc, 'methodologyNotDeliverable')
    expect(v).toBeTruthy()
    expect(v.toLowerCase()).not.toContain('import the missing assets')
    expect(v.toLowerCase()).not.toContain('missing assets')
    expect(v.toLowerCase()).toContain('fill in')
  })

  /**
   * 第 9 轮 i7：第 7 轮把「或先接上缺失资产」整句删掉是**矫枉过正** ——
   * 对 `palette_line` / `character_descriptors` 这类**真·assetMissing**，
   * 「补资产」正是正解，删掉反而把用户引向错误的处置。
   * ⇒ 聚合文案**按 reason 分流**成两态：有 assetMissing 时说「或补齐对应资产」，
   *    只剩 byDesign 时只说「人工补齐」。
   */
  it('「有资产缺口」的第二态：说「或补齐对应资产」（第 9 轮 i7）', () => {
    const v = readValue(zhSrc, 'methodologyNotDeliverableAssets')
    expect(v).toBeTruthy()
    expect(v).toContain('人工补齐')
    expect(v).toContain('补齐对应资产')
    const en = readValue(enSrc, 'methodologyNotDeliverableAssets')
    expect(en).toBeTruthy()
    expect(en.toLowerCase()).toContain('fill in')
    expect(en.toLowerCase()).toContain('supply the missing assets')
  })

  /**
   * 第 9 轮 i1（Critical/consistency）：`assetsIncomplete` 的文案不能写「请重新导入」——
   * 方案自己 §一-3 已证**产品里没有任何导入入口**（没人写 `userData/film-kit`）。
   * 指向不存在的功能，与当初驳回「导出已阻断」是同一条理由。
   */
  it('「资产不完整」文案**不指向不存在的导入入口**（第 9 轮 i1）', () => {
    const v = readValue(zhSrc, 'methodologyAssetsIncomplete')
    expect(v).toBeTruthy()
    expect(v).not.toContain('重新导入')
    expect(v).not.toContain('导入')
    // 如实说明缺什么 + 能力未接入
    expect(v).toContain('资产不完整')
    expect(v).toContain('未接入')
    const en = readValue(enSrc, 'methodologyAssetsIncomplete')
    expect(en.toLowerCase()).not.toContain('re-import')
    expect(en.toLowerCase()).not.toContain('import')
  })
})

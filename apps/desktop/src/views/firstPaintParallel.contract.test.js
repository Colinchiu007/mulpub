import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 阶段 2.3（audit-63）首屏并行化的**源码契约锁**。
 *
 * 为什么是源码锁而不是行为锁：`Publish.test.js`(1901 行) 与 `Collection.test.js`(1783 行)
 * 都已在 `check-max-lines.js` 的 testLimit=1500 之上挂账，往它们里加用例即触发
 * TEST_LEDGER_GREW；而把两个重量级夹具在第三个文件里重建一遍，得到的是"另一套 mock
 * 说了算"的第二真源。所以这里锁**结构**（哪些源进了同一个 allSettled 批、还有没有裸串行
 * await），行为级并行判据放在能挂组件的地方（PodcastChannelView.test.js 那两条）。
 *
 * 结构锁抓不住什么（如实写）：把某个源从批里挪出去再单独 await —— 这条锁会红（清单是精确
 * 集合）；但"并行后单个源内部又串行"它看不见。
 *
 * 锚点纪律：起止锚点都先断言存在、缺失即抛错；不得用 indexOf 的 -1 当区间终点
 * （那会让判定域静默放大到接近整份文件，AGENTS.md 记过这一型）。
 */

function readView (rel) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** 取 `onMounted(async () => { … })` 的原文块；锚点缺失即抛 */
function onMountedBlock (src, file) {
  const start = src.indexOf('onMounted(async () => {')
  if (start < 0) throw new Error(`${file}: 锚点缺失 onMounted(async () => {`)
  // 终点取该块的顶层闭合：`\n})` 且其后紧跟换行或文件尾（工作区真实行尾先归一）
  const body = src.slice(start).replace(/\r\n/g, '\n')
  const end = body.indexOf('\n})')
  if (end < 0) throw new Error(`${file}: 锚点缺失 onMounted 的顶层闭合 \\n})`)
  return body.slice(0, end)
}

/**
 * 取"去掉整行注释"的那一份文本，只用于**否定式**断言。
 * 动因（本锁第一跑就撞上）：Collection.vue 的 WHY 注释里写着「原先 `await loadCollectedItems()`
 * 独占首屏」，判据扫到的是散文而不是代码，于是"修好了"被自己的注释判红。
 * 只剥整行注释、不剥行尾注释与字符串，是因为 `https://` 这类字面量会被后者误伤。
 */
function codeOnly (block) {
  return block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
}

describe('Publish.vue 首屏并行化契约（audit-63）', () => {
  const FILE = 'src/views/Publish.vue'
  // 所有断言都跑在 codeOnly(...) 上：正例与负例同一个域，否则注释能把正例喂饱、也能把负例点红
  const block = codeOnly(onMountedBlock(readView(FILE), FILE))

  it('账号目录 / 预检偏好 必须同处一个 Promise.allSettled 批', () => {
    const batch = block.match(/Promise\.allSettled\(([\s\S]*?)\)\s*\n/)
    expect(batch, `${FILE}: onMounted 内已不存在 Promise.allSettled 批`).not.toBeNull()
    // 两个源以 [名称, 任务] 形态登记在 sources 数组里（批的输入由它 map 出来）
    expect(block).toMatch(/\['loadAccounts',\s*loadAccounts\(\)\]/)
    expect(block).toMatch(/\['loadPrecheckPreference',\s*loadPrecheckPreference\(\)\]/)
    expect(block).toMatch(/sources\.map\(\(s\) => s\[1\]\)/)
  })

  it('草稿页签的 loadDrafts 也在同一批里按条件入批，不是另起一次 await', () => {
    expect(block).toMatch(/if \(draftsTab\) sources\.push\(\['loadDrafts',\s*loadDrafts\(\)\]\)/)
  })

  it('onMounted 里不得再出现这三个源的独占串行 await', () => {
    // 允许的形式只有"入批"；`await loadAccounts()` / `await loadPrecheckPreference()`
    // 一旦出现就是退回串行（`?draft=` 路径里的 loadDrafts/loadDraft 属另一条语义，不在禁列）
    for (const name of ['loadAccounts', 'loadPrecheckPreference']) {
      expect(block, `${FILE}: 又退化成 await ${name}()`).not.toMatch(new RegExp(`await ${name}\\(\\)`))
    }
  })

  it('失败必须逐条出声（allSettled 不抛 ⇒ 不检查 rejected 就是把失败读成"没有数据"）', () => {
    // 前缀用 ASCII：渲染端 src 非 locales 文件不得新增中文字面量（locale-sync --cjk 实测会点名，
    // 本仓第一次跑这条判据时正是被自己新加的 console.warn 撞红的）
    expect(block).toMatch(/r\.status === 'rejected'/)
    expect(block).toMatch(/console\.warn\(`\[publish\] first-paint data source failed/)
  })
})

describe('Collection.vue 首屏并行化契约（audit-63）', () => {
  const FILE = 'src/views/Collection.vue'
  const block = codeOnly(onMountedBlock(readView(FILE), FILE))

  it('六个互不依赖的源同处一个 Promise.allSettled 批', () => {
    const batch = block.match(/Promise\.allSettled\(\[([\s\S]*?)\]\)/)
    expect(batch, `${FILE}: onMounted 内已不存在 Promise.allSettled 数组批`).not.toBeNull()
    for (const name of ['loadCollectedItems()', 'loadCopyRewrites()', 'loadRewriteStrategies()', 'categoriesReady', 'platformReady', 'accountsReady']) {
      expect(batch[1], `${FILE}: ${name} 不在批内`).toContain(name)
    }
  })

  it('采集列表不得再独占一个 await（它是当时首屏最长的一个 IPC）', () => {
    // 批内形态是 `loadCollectedItems(),`（已由上一条精确断言在数组里）；
    // 出现任何 `await loadCollectedItems()` 即退回串行。
    expect(block).not.toMatch(/await\s+loadCollectedItems\(\)/)
    expect(block).toMatch(/Promise\.allSettled\(\[[\s\S]*?loadCollectedItems\(\),/)
  })

  it('策略预览必须在策略回包之后触发（原先与 fire-and-forget 的加载抢跑）', () => {
    const refresh = block.indexOf('refreshStrategyPreview()')
    const batch = block.indexOf('Promise.allSettled([')
    expect(refresh).toBeGreaterThan(-1)
    expect(batch).toBeGreaterThan(-1)
    expect(refresh).toBeGreaterThan(batch)
  })

  it('账号/平台目录的桩可能返回 undefined，必须继续被 Promise.resolve 包裹', () => {
    // 这条不是风格：测试桩与真实 store 的返回类型不同源时，直接 .catch 会抛
    // "Cannot read properties of undefined (reading 'catch')"（QG Unit unhandled rejection 既有修复）
    expect(block).toMatch(/Promise\.resolve\(platformStore\.load\(\)\)\.catch/)
    expect(block).toMatch(/Promise\.resolve\(accountStore\.load\(\)\)\.catch/)
  })
})

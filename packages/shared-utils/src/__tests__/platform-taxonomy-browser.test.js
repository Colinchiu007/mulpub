/**
 * platform-taxonomy 孪生 parity 锁 —— CJS（主进程）vs ESM（渲染端）必须**同输入同输出**。
 *
 * 对齐先例：`platform-schedule-capability-parity.test.js`、`account-name-guard.test.js`、
 * `platform-definitions-browser.test.js`、`publish-capabilities.test.js`。
 *
 * ## 为什么必须有这条锁
 *
 * 两个文件各自实现同一套语义。**它们会漂移**：有人改了 CJS 的某个 reason 分支忘了改 ESM，
 * 渲染端就会给出与主进程不同的判定 —— 而这类漂移在两边各自的单测里**都看不出来**（各自自洽）。
 *
 * **本锁首次运行即抓出 7 处漂移**，全部源于「ESM 版按假设写而非照 CJS 读」：
 *   - 误以为第二参是位置参数 `contentType`（真实是 `opts = {}`）
 *   - 误以为 `getTaxonomyCoverage` 判据是「指定 contentType 有数据」（真实是 `anyBlock` 任一）
 *   - **完全漏了 `article:xxx` 多来源表键**（`blockOf` 的前缀匹配分支）
 *   - 误以为 `searchCategories` 也匹配 ID（真实只匹配名称）
 *   - 误以为 `resolveCategoryId` 返回 `depth`（真实返回 `path`）
 *
 * 设计要点（吃过教训，见 AGENTS.md「枚举式黑名单必须配结构化正向契约」）：
 *   - **不比源码文本**，比**行为**：同一批输入喂给两侧，逐字段比结果。
 *   - 输入集**从真实产物派生**（真实平台 + 真实分类名），不手写死名单。
 *   - 加**结构锁**：ESM 版不得出现 `fs` / `path` / `require(`（它就是为浏览器写的）。
 *
 * 用法: npx vitest run packages/shared-utils/src/__tests__/platform-taxonomy-browser.test.js
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import * as esm from '../platform-taxonomy.browser.js'

const require = createRequire(import.meta.url)
const cjs = require('../platform-taxonomy.js')
// 本文件在 src/__tests__/，到仓库根是四级：.. = src，../.. = shared-utils，
// ../../.. = packages，../../../.. = 仓库根
const TAXONOMY = require('../../../../config/platform-taxonomy.json')

/** 真实产物里出现过的平台（含仅登记、无数据的），加上数据集里完全没有的 */
const ALL_PLATFORMS = [
  ...Object.keys(TAXONOMY.platforms),
  ...(TAXONOMY.platformsWithoutIdData || []),
  'youtube', 'xiaohongshu', 'tiktok', 'twitter', 'instagram', 'facebook', 'nope_platform',
]

/** 每个 (平台, 真实块键) 取真实分类名与 ID 当样本 —— 从产物派生，不手写 */
function realSamples () {
  const out = []
  for (const pid of Object.keys(TAXONOMY.platforms)) {
    for (const [blockKey, block] of Object.entries(TAXONOMY.platforms[pid])) {
      const nodes = (block && block.nodes) || []
      if (!nodes.length) continue
      // blockKey 可能是 `article` / `video` / `article:qutoutiao`
      const inner = block.contentType || blockKey.split(':')[0]
      for (const n of [nodes[0], nodes[Math.floor(nodes.length / 2)], nodes[nodes.length - 1]]) {
        if (n) out.push({ pid, ct: inner, probe: n.name })
      }
      for (const n of nodes.slice(0, 3)) out.push({ pid, ct: inner, probe: String(n.id) })
    }
  }
  return out
}

/** 归一化：只留契约字段；hint 文案允许不同但必须两侧同「有无」 */
function shape (r) {
  if (!r || typeof r !== 'object') return r
  const out = {
    ok: r.ok, reason: r.reason, id: r.id, name: r.name,
    contentType: r.contentType, path: r.path,
    hasHint: typeof r.hint === 'string' && r.hint.length > 0,
    available: r.available,
  }
  if (r.candidates) out.candidates = r.candidates.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, depth: c.depth }))
  return out
}

/** 去掉值为 undefined 的键，避免 `{a:1}` vs `{a:1,b:undefined}` 的伪差异 */
function clean (o) {
  return JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? undefined : v)))
}

describe('★ parity：CJS 与 ESM 孪生同输入同输出', () => {
  it('getTaxonomyCoverage 在全部平台 × 全部 contentType 上一致', () => {
    for (const pid of ALL_PLATFORMS) {
      for (const ct of ['article', 'video', undefined]) {
        expect(esm.getTaxonomyCoverage(pid, ct ? { contentType: ct } : {}), `getTaxonomyCoverage(${pid}, ${ct}) 不一致`)
          .toBe(cjs.getTaxonomyCoverage(pid, ct ? { contentType: ct } : {}))
      }
    }
  })

  it('hasPlatformCategories 在全部平台上一致', () => {
    for (const pid of ALL_PLATFORMS) {
      expect(esm.hasPlatformCategories(pid), `hasPlatformCategories(${pid}) 不一致`).toBe(cjs.hasPlatformCategories(pid))
    }
  })

  it('★ resolveCategoryId 在真实分类样本上一致（样本从产物派生）', () => {
    const samples = realSamples()
    // 实测真实数据集产出 60 个样本（6 平台 × 各块 × 首/中/末名 + 前 3 个 id）。
    // 阈值取 50：既容忍快照小幅变化，又守住「样本集退化成空/极少 ⇒ 锁假绿」这个洞。
    expect(samples.length, '真实样本过少 ⇒ 本锁会假绿，必须让它红').toBeGreaterThanOrEqual(50)
    let compared = 0
    for (const { pid, ct, probe } of samples) {
      const a = clean(shape(esm.resolveCategoryId(pid, probe, { contentType: ct })))
      const b = clean(shape(cjs.resolveCategoryId(pid, probe, { contentType: ct })))
      expect(a, `${pid}/${ct}/「${probe}」不一致`).toEqual(b)
      compared++
    }
    expect(compared).toBe(samples.length)
  })

  it('★ 失败路径也要一致：查不到 / 缺 contentType / 无数据平台 / 跨 contentType', () => {
    const cases = [
      ['bilibili', 'video', '不存在的分类名xyz', { contentType: 'video' }],
      ['bilibili', '日常', '日常', {}],                                  // 缺 contentType
      ['kuaishou', 'video', '游戏', { contentType: 'video' }],           // platform-name-only
      ['youtube', 'video', 'Tech', { contentType: 'video' }],            // platform-absent
      ['toutiao', 'article', '不存在的分类名xyz', { contentType: 'article' }],
      ['baijiahao', 'article', '教学', { contentType: 'article' }],      // 该平台只有 video ⇒ mismatch
      ['nope_platform', 'video', 'x', { contentType: 'video' }],
      ['bilibili', 'video', '', { contentType: 'video' }],
    ]
    for (const [pid, ct, probe, opts] of cases) {
      const a = clean(shape(esm.resolveCategoryId(pid, probe, opts)))
      const b = clean(shape(cjs.resolveCategoryId(pid, probe, opts)))
      expect(a, `${pid}/${ct}/「${probe}」失败路径不一致`).toEqual(b)
    }
  })

  it('★ 歧义项两侧同判（B站视频 tid=36 在源数据里既是知识也是科技）', () => {
    const a = clean(shape(esm.resolveCategoryId('bilibili', '36', { contentType: 'video' })))
    const b = clean(shape(cjs.resolveCategoryId('bilibili', '36', { contentType: 'video' })))
    expect(a).toEqual(b)
    expect(a.reason).toBe('ambiguous')
    expect(a.candidates.length).toBeGreaterThan(1)
  })

  it('★ blockOf 的 `article:xxx` 多来源表键两侧同判（头条系），这是首轮漏掉的分支', () => {
    // toutiao 的 article 有 qutoutiao 变体；两者都应能被 article 取到
    const a = clean(esm.getCategories('toutiao', { contentType: 'article' }))
    const b = clean(cjs.getCategories('toutiao', { contentType: 'article' }))
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })

  it('getCategories 在全部真实平台 × 块键上逐节点一致（含深拷贝语义）', () => {
    for (const pid of Object.keys(TAXONOMY.platforms)) {
      for (const blockKey of Object.keys(TAXONOMY.platforms[pid])) {
        const ct = blockKey.split(':')[0]
        const a = esm.getCategories(pid, { contentType: ct })
        const b = cjs.getCategories(pid, { contentType: ct })
        expect(a, `getCategories(${pid}, ${ct}) 长度不一致`).toHaveLength(b.length)
        for (let i = 0; i < a.length; i++) {
          expect(a[i].id).toBe(b[i].id)
          expect(a[i].name).toBe(b[i].name)
          expect(a[i].depth).toBe(b[i].depth)
        }
      }
    }
  })

  it('getCategories 缺 contentType 时两侧都抛错（图文/视频两套命名空间，不猜）', () => {
    expect(() => esm.getCategories('bilibili')).toThrow()
    expect(() => cjs.getCategories('bilibili')).toThrow()
  })

  it('searchCategories 在同一批关键词上一致（含未指定 contentType 的跨块去重分支）', () => {
    for (const kw of ['生活', '日常', '知识', '教学', '', '   ']) {
      for (const opts of [{ contentType: 'video' }, { contentType: 'article' }, {}]) {
        const a = clean(esm.searchCategories('bilibili', kw, opts))
        const b = clean(cjs.searchCategories('bilibili', kw, opts))
        expect(a, `searchCategories(bilibili, ${JSON.stringify(kw)}, ${JSON.stringify(opts)}) 不一致`).toEqual(b)
      }
    }
    // 头条跨块去重分支
    expect(clean(esm.searchCategories('toutiao', '教学'))).toEqual(clean(cjs.searchCategories('toutiao', '教学')))
  })

  it('深拷贝语义一致：改返回值不影响后续调用', () => {
    const first = esm.getCategories('bilibili', { contentType: 'video' })
    if (first.length) first[0].name = '__MUTATED__'
    expect(esm.getCategories('bilibili', { contentType: 'video' })[0].name).not.toBe('__MUTATED__')
    const resolved = esm.resolveCategoryId('bilibili', '日常', { contentType: 'video' })
    if (resolved.ok && resolved.path) resolved.path.push('__MUTATED__')
    expect(esm.resolveCategoryId('bilibili', '日常', { contentType: 'video' }).path).not.toContain('__MUTATED__')
  })
})

describe('★ 结构锁：ESM 版必须是纯浏览器可打包的', () => {
  const RAW = fs.readFileSync(path.join(__dirname, '../platform-taxonomy.browser.js'), 'utf8')
  // 只对**代码行**判据，注释里的字样不算（首轮就是被自己注释里的 setTaxonomyPathForTest 误伤）
  const CODE = RAW.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  it('不得出现 fs / path / require( —— 它就是为浏览器写的', () => {
    expect(CODE).not.toMatch(/require\(/)
    expect(CODE).not.toMatch(/from\s+['"](node:)?fs['"]/)
    expect(CODE).not.toMatch(/from\s+['"](node:)?path['"]/)
  })

  it('不得实现 CJS 版的测试注入口（Node 侧专用，浏览器无对应需求）', () => {
    expect(CODE).not.toMatch(/setTaxonomyPathForTest|__resetTaxonomyCacheForTest|__clearTaxonomyOverrideForTest|__loadError/)
  })

  it('数据必须是**构建期静态引入**的 JSON，不得复制任何分类数据', () => {
    expect(RAW).toMatch(/import\s+\w+\s+from\s+['"][^'"]*platform-taxonomy\.json['"]/)
    // 不得内联平台名当数据（那是「复制数据」的形态）
    expect(CODE).not.toMatch(/^\s*(bilibili|douyin|toutiao|baijiahao|weibo|zhihu)\s*:/m)
  })

  it('导出面覆盖 CJS 版的全部业务函数（validateTaxonomy 为**显式登记**的例外）', () => {
    // 显式排除 validateTaxonomy，理由（不是「懒得写」，是有意为之）：
    //   它是**结构性自检**（字段存在 / id 块内唯一 / parentId 不悬空 / 深度自洽），
    //   服务于「运行期读文件可能读到坏文件」这个 CJS 侧风险。
    //   渲染端的表是**构建期静态引入**：JSON 坏了打包当场失败；即便语法合法但结构错，
    //   也有 CI 的转换器测试 + platform-taxonomy.test.js 的真实产物契约测试守着。
    //   在渲染端复刻一份只增加 bundle 体积，不增加保障。
    //   若将来渲染端真需要（例如支持运行期热换表）⇒ **加实现并从此清单移除**；
    //   不要改成宽过滤 —— 那会让「忘了同步新函数」重新沦为静默漂移。
    const KNOWN_ESM_ABSENT = ['validateTaxonomy']
    const cjsFns = Object.keys(cjs).filter((k) =>
      typeof cjs[k] === 'function' && !k.startsWith('__') && !k.startsWith('set') && !k.startsWith('resolveTaxonomy'))
    expect(cjsFns.length, '解析出的 CJS 业务函数过少 ⇒ 判据失灵').toBeGreaterThan(3)
    for (const fn of cjsFns) {
      if (KNOWN_ESM_ABSENT.includes(fn)) {
        expect(typeof esm[fn], `${fn} 已登记为「刻意不实现」，若已补上请从 KNOWN_ESM_ABSENT 移除`).toBe('undefined')
        continue
      }
      expect(typeof esm[fn], `CJS 有 ${fn} 而 ESM 没有（若刻意不实现，请登记进 KNOWN_ESM_ABSENT 并写明理由）`).toBe('function')
    }
  })
})

describe('真实产物契约（孪生侧）', () => {
  it('构建期数据与磁盘上的 config/platform-taxonomy.json 同源同内容', () => {
    expect(esm.TAXONOMY_DATA.version).toBe(TAXONOMY.version)
    expect(Object.keys(esm.TAXONOMY_DATA.platforms).sort()).toEqual(Object.keys(TAXONOMY.platforms).sort())
  })

  it('数据来源信息可被 UI 读取（快照日期必须可显示，见 PRD §14.2）', () => {
    expect(esm.TAXONOMY_SOURCE.snapshotDate).toBe(TAXONOMY.source.snapshotDate)
    expect(esm.TAXONOMY_SOURCE.verifiedOnline).toBe(false)
  })

  it('B站图文 38 节点 / 视频 142 节点（与 P0-1 基线一致）', () => {
    expect(esm.getCategories('bilibili', { contentType: 'article' })).toHaveLength(38)
    expect(esm.getCategories('bilibili', { contentType: 'video' })).toHaveLength(142)
  })

  it('browser 孪生能给出分类路径（供 UI 面包屑）', () => {
    const r = esm.resolveCategoryId('bilibili', '日常', { contentType: 'video' })
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.path)).toBe(true)
    expect(r.path[r.path.length - 1]).toBe('日常')
  })
})

// @ts-check
/**
 * shot-library 真实语料回归锁（fix-film-engineering-defects，2026-10-19）
 *
 * 动因：一键复制的 blocks / characters / geo 三个模式在**真实 kit 语料**上基本退化——
 * 随包 153 镜中只有 3 镜能被切块、GEO 精确命中 0、CHARACTER 命中 0。
 *
 * 为什么既有 shot-library.test.js 拦不住：它的 blocks/characters/geo 三个用例用的是
 * **自造的理想化夹具**（块标题就是纯 `GEO SPATIAL LAYOUT`）。那种夹具在「整行精确比较」
 * 和「行首前缀匹配」两种实现下都会通过 —— 它测的是算法意图，不是算法对真实输入的有效性。
 *
 * 因此本文件刻意锚定**真实语料的形态与统计特征**：
 *   ① 真实提示词的块标题带后缀/修饰与结尾冒号（如
 *      `GEO SPATIAL LAYOUT (locked across every CO shot — pure spatial map):`）
 *   ② 真实 kit 中必须至少有一镜能提取出带内容的 GEO 块（防整行精确比较回归）
 *   ③ BLOCK_HEADINGS 必须与随包方法论的块标签同源（7 项，防 5/7 漂移）
 * 只要有人把匹配改回整行精确相等，① 与 ② 立刻红；只要两处标签再次漂移，③ 立刻红。
 */

const fs = require('fs')
const path = require('path')

const {
  extractBlocks,
  extractCharacterLines,
  extractGeoBlock,
  buildBlocksText,
  BLOCK_HEADINGS,
} = require('./shot-library')

/** 定位随包 kit 目录（从 services/film-engineering 上溯到 apps/desktop/electron/film-kit） */
function kitDir () {
  const electronDir = path.resolve(__dirname, '..', '..') // apps/desktop/electron
  const candidates = [
    path.join(electronDir, 'film-kit'),
    path.join(electronDir, '..', '..', 'electron', 'film-kit'),
  ]
  for (const d of candidates) {
    if (fs.existsSync(path.join(d, 'shot-library.json'))) return d
  }
  return null
}

function loadRealPrompts () {
  const d = kitDir()
  if (!d) return null
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(d, 'shot-library.json'), 'utf8'))
  } catch {
    return null
  }
  const arr = Array.isArray(parsed) ? parsed : Object.values(parsed || {})
  return arr.map((s) => String((s && s.prompt) || '')).filter(Boolean)
}

const prompts = loadRealPrompts()

function hasHeading (prompt, heading) {
  return extractBlocks(prompt).some((b) => b.heading === heading)
}

describe('shot-library 真实语料回归锁', () => {
  it('真实语料可用（否则本文件其余断言无意义）', () => {
    expect(prompts).toBeTruthy()
    expect(prompts.length).toBeGreaterThan(0)
  })

  // ── ① 形态锁：真实语料里的块标题带后缀，必须仍能识别 ────────────────
  it('块标题带括号后缀与结尾冒号时仍应识别（真实语料形态）', () => {
    // 该样例逐字复刻真实 kit 中观察到的标题形态
    const prompt = [
      'EXT. ALLEY — NIGHT',
      'GEO SPATIAL LAYOUT (locked across every CO shot — pure spatial map):',
      '  Roko center frame, dumpster left, camera at chest height.',
      'ACTION TIMING:',
      '  0.0-2.0s Roko steps forward.',
    ].join('\n')
    expect(hasHeading(prompt, 'GEO SPATIAL LAYOUT')).toBe(true)
    expect(hasHeading(prompt, 'ACTION TIMING')).toBe(true)
  })

  it('块标题为小写且带前导空白与结尾冒号时仍应识别', () => {
    const blocks = extractBlocks('  geo spatial layout :\n  Roko center frame.')
    expect(blocks.length).toBe(1)
    expect(blocks[0].heading).toBe('GEO SPATIAL LAYOUT')
  })

  it('正文行中偶然出现标题字样不得误判为块', () => {
    expect(extractBlocks('Roko says: the AUDIO in this scene matters.').length).toBe(0)
  })

  // ── ② 统计锁：真实 kit 上切块率必须显著 ─────────────────────────────
  it('真实 kit 语料：带内容的 GEO 块命中数必须 > 0（防整行精确比较回归）', () => {
    const hit = prompts.filter((pr) => extractGeoBlock(pr) !== '')
    expect(hit.length).toBeGreaterThan(0)
  })

  it('真实 kit 语料：切块率应显著（> 10%）', () => {
    const withBlocks = prompts.filter((pr) => extractBlocks(pr).length > 0)
    const ratio = withBlocks.length / prompts.length
    expect(ratio).toBeGreaterThan(0.1)
  })

  // ── ③ 同源锁：BLOCK_HEADINGS 必须与方法论块标签同源 ─────────────────
  // v7 批次一后方法论从 7 块扩到 11 块（长台词/动作戏/首尾帧/介质掩护），
  // 但 BLOCK_HEADINGS 的作用是「从随包 153 镜语料里抽取块」，语料只含原先 7 块。
  // 两者不再是 1:1，故判据改为**真实的那个不变量**：
  //   ① 抽取器认识的每个标题，都必须是方法论里声明过的块（不许凭空造标题）；
  //   ② 方法论新增的块确实存在（防「改了 JSON 却没生效」）。
  // 这样既保留「防 5/7 漂移」的原意，又不会因为方法论合理扩容而误判为漂移。
  it('BLOCK_HEADINGS 必须全部是 prompt-doctrine.json 声明的块（防凭空造标题）', () => {
    const d = kitDir()
    expect(d).toBeTruthy()
    const doctrine = JSON.parse(fs.readFileSync(path.join(d, 'prompt-doctrine.json'), 'utf8'))
    const labels = doctrine.blocks.map((b) => String(b.label).toUpperCase())
    for (const h of BLOCK_HEADINGS) {
      expect(labels).toContain(String(h).toUpperCase())
    }
    // 原先 7 块必须仍在方法论里（删块属破坏性变更）
    for (const required of ['SCENE CONTEXT', 'GEO SPATIAL LAYOUT', 'ACTION TIMING', 'AUDIO', 'CHARACTER ACTING', 'STYLE', 'POSITIVE CONSTRAINTS']) {
      expect(labels).toContain(required)
    }
  })

  it('方法论 v7 新增的四块确实存在（长台词/动作戏/首尾帧/介质掩护）', () => {
    const d = kitDir()
    const doctrine = JSON.parse(fs.readFileSync(path.join(d, 'prompt-doctrine.json'), 'utf8'))
    const keys = doctrine.blocks.map((b) => b.key)
    for (const k of ['long_dialogue_split', 'action_choreography', 'frame_constraint', 'transition_medium_cover']) {
      expect(keys).toContain(k)
    }
  })

  // ── ④ 行为锁：修好后各模式的产出必须符合契约 ────────────────────────
  it('characters 模式：含 [CHARACTER: 行时必须提出来（防正则被改坏）', () => {
    const lines = extractCharacterLines(
      '[CHARACTER: ROKO] determined street kid\n[CHARACTER: JAXX] reckless kid'
    )
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain('ROKO')
  })

  it('buildBlocksText 对无法切块的文本回退全文而非空串', () => {
    const text = 'plain prompt without headings'
    expect(buildBlocksText(text)).toBe(text)
  })
})

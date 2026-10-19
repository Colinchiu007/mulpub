// @ts-check
'use strict'
/**
 * v7 新增数据资产的校验器契约测试（从 kit-loader.test.js 拆出，见债务预算 FILES_OVER_500）
 * 覆盖：镜头语法枚举 / 合规清单 / 色盘上限与注入串 / doctrine 增补结构 /
 *       缺失 vs 损坏二分 / schemaVersion 接线 / 字面 null / 语义字段闭集 / 空 tasks 目录
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const { loadFilmKit, loadFilmKitChain, validateDoctrine } = require('./kit-loader')
const {
  checkSchemaVersion, validateShotGrammar, validateComplianceChecklist, validatePalette,
} = require('./kit-asset-validators')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'film-asset-test-'))
}

const UUID = '3caa2f3a-52b5-4293-9237-0c8f76c7158a'

function makeShotGrammar () {
  return {
    schemaVersion: 1,
    shotSizes: [{ key: 'wide', zh: '远景', en: 'Wide shot', abbr: 'WS', chain: 'wide' }],
    cameraMoves: [{ key: 'static', zh: '固定', en: 'Static', risk: 'low' }],
    cameraAngles: [{ key: 'eye_level', zh: '平视', en: 'Eye level', emotion: 'neutral' }],
    lightingSetups: [{ key: 'natural', zh: '自然光', en: 'Natural light' }],
    vfxPresets: [{ key: 'none', zh: '无特效', en: 'None', risk: 'low' }],
    emotionTiers: [{ key: 'normal', zh: '常规', en: 'Normal', zhCharsPerSecond: 8 }],
    durationTiers: { supportedSec: [5, 8, 10, 12], maxSec: 12 },
  }
}

function makeCompliance () {
  return {
    schemaVersion: 1,
    categories: [{ key: 'content', zh: '内容合规', en: 'Content compliance' }],
    items: [{
      id: 'CC-01', category: 'content', severity: 'blocker',
      zhQuestion: '是否包含禁止内容？', enQuestion: 'Forbidden content?',
      zhPass: '不包含', enPass: 'None', zhFix: '改写', enFix: 'Rewrite',
    }],
  }
}

function makePalette () {
  const hexes = ['#0E1A24', '#1F4E5F', '#C9A227', '#8C3A2E']
  const line = 'Palette: ' + hexes.join(' / ')
  return {
    schemaVersion: 1,
    limits: { maxPrimary: 4, maxExtended: 2 },
    primary: hexes.map((hex, i) => ({ key: 'primary_' + (i + 1), hex, zhName: '主色' + (i + 1), enName: 'Primary ' + (i + 1) })),
    extended: [],
    paletteLine: { zh: line, en: line },
    emotionColorMap: [],
  }
}

function makePrompts () {
  const out = {}
  for (const loc of ['zh', 'en']) {
    out['adapt_script/' + loc + '/system.md'] = 'system adapt_script ' + loc
    out['adapt_script/' + loc + '/user.md'] = 'user adapt_script ' + loc
  }
  return out
}

function writePrompts (dir, prompts) {
  for (const [rel, content] of Object.entries(prompts || {})) {
    const full = path.join(dir, 'prompts', 'tasks', rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
}

function makeKit () {
  return {
    manifest: {
      schemaVersion: 1,
      filmMeta: {
        title: 'Hell Grind', durationSec: 5706, logline: 'Street kids gain powers.',
        characters: [{ name: 'ROKO', descriptor: 'Determined street kid' }],
      },
      scenes: [{ id: 'cold-open', name: '1. COLD OPEN', count: 12, parentId: null, level: 0 }],
    },
    shots: [{
      shotId: '11111111-1111-4111-8111-111111111111',
      sceneId: 'cold-open',
      prompt: 'EXT. CITY STREET - NIGHT\n[CHARACTER: ROKO] runs toward camera.',
      model: 'seedance_2_0',
      refTokens: [UUID],
    }],
    references: { [UUID]: { kind: 'character', name: 'ROKO', imageUrls: ['https://cdn.example.com/roko.png'] } },
    doctrine: {
      blocks: [{ key: 'geo_spatial_layout', label: 'GEO SPATIAL LAYOUT', zh: '地理空间布局', en: 'Geo spatial layout' }],
      rules: [{ key: 'batch-10-15', title: 'Batch iteration 10-15', zh: '批量迭代 10-15 法则', en: 'Batch 10-15 rule' }],
      glossary: [{ term: 'seedance', zh: '种子舞', en: 'Seedance' }],
    },
    shotGrammar: makeShotGrammar(),
    compliance: makeCompliance(),
    palette: makePalette(),
    prompts: makePrompts(),
  }
}

function writeKit (dir, kit) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'film-manifest.json'), JSON.stringify(kit.manifest))
  fs.writeFileSync(path.join(dir, 'shot-library.json'), JSON.stringify(kit.shots))
  fs.writeFileSync(path.join(dir, 'reference-registry.json'), JSON.stringify(kit.references))
  fs.writeFileSync(path.join(dir, 'prompt-doctrine.json'), JSON.stringify(kit.doctrine))
  fs.writeFileSync(path.join(dir, 'shot-grammar.json'), JSON.stringify(kit.shotGrammar))
  fs.writeFileSync(path.join(dir, 'compliance-checklist.json'), JSON.stringify(kit.compliance))
  fs.writeFileSync(path.join(dir, 'palette.json'), JSON.stringify(kit.palette))
  writePrompts(dir, kit.prompts)
}

// ===== v7 批次一新增校验器 =====

describe('validateShotGrammar: 镜头语言枚举', () => {
  it('完整枚举通过', () => {
    expect(validateShotGrammar(makeShotGrammar()).ok).toBe(true)
  })

  it('缺组 → 拒绝', () => {
    const g = makeShotGrammar()
    delete g.shotSizes
    const r = validateShotGrammar(g)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('shotSizes')
  })

  it('空组 → 拒绝（空枚举等于没枚举）', () => {
    const g = makeShotGrammar()
    g.cameraMoves = []
    expect(validateShotGrammar(g).ok).toBe(false)
  })

  it('key 重复 → 拒绝', () => {
    const g = makeShotGrammar()
    g.cameraMoves = [{ key: 'static', zh: '固定', en: 'Static' }, { key: 'static', zh: '固定2', en: 'Static2' }]
    const r = validateShotGrammar(g)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('key 重复')
  })

  it('缺 zh 或 en → 拒绝（中英成对是硬契约）', () => {
    const g1 = makeShotGrammar()
    delete g1.shotSizes[0].zh
    expect(validateShotGrammar(g1).ok).toBe(false)
    const g2 = makeShotGrammar()
    g2.shotSizes[0].en = ''
    expect(validateShotGrammar(g2).ok).toBe(false)
  })

  it('maxSec 超过 supportedSec 最大档 → 拒绝（否则上限形同虚设）', () => {
    const g = makeShotGrammar()
    g.durationTiers.maxSec = 20
    const r = validateShotGrammar(g)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('maxSec')
  })

  it('supportedSec 含非正数 → 拒绝', () => {
    const g = makeShotGrammar()
    g.durationTiers.supportedSec = [0, 5]
    expect(validateShotGrammar(g).ok).toBe(false)
  })
})

describe('validateComplianceChecklist: 剧本合规清单', () => {
  it('完整清单通过', () => {
    expect(validateComplianceChecklist(makeCompliance()).ok).toBe(true)
  })

  it('severity 非法 → 拒绝', () => {
    const c = makeCompliance()
    c.items[0].severity = 'error'
    const r = validateComplianceChecklist(c)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('severity')
  })

  it('id 重复 → 拒绝', () => {
    const c = makeCompliance()
    c.items.push({ ...c.items[0] })
    expect(validateComplianceChecklist(c).ok).toBe(false)
  })

  it('缺 zhFix / enFix → 拒绝（只报问题不给修法等于没清单）', () => {
    const c = makeCompliance()
    delete c.items[0].zhFix
    expect(validateComplianceChecklist(c).ok).toBe(false)
  })

  it('category 引用不存在的分类 → 拒绝', () => {
    const c = makeCompliance()
    c.items[0].category = 'ghost'
    const r = validateComplianceChecklist(c)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('category')
  })
})

describe('validatePalette: 色盘上限与注入串一致性', () => {
  it('完整色盘通过', () => {
    expect(validatePalette(makePalette()).ok).toBe(true)
  })

  it('主色超过 4 个 → 拒绝（色盘失控）', () => {
    const p = makePalette()
    p.primary.push({ key: 'primary_5', hex: '#000000', zhName: '黑', enName: 'Black' })
    const r = validatePalette(p)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('上限 4')
  })

  it('扩展色超过 2 个 → 拒绝', () => {
    const p = makePalette()
    p.extended = [
      { key: 'e1', hex: '#111111', zhName: 'a', enName: 'a' },
      { key: 'e2', hex: '#222222', zhName: 'b', enName: 'b' },
      { key: 'e3', hex: '#333333', zhName: 'c', enName: 'c' },
    ]
    expect(validatePalette(p).ok).toBe(false)
  })

  it('hex 非 #RRGGBB → 拒绝', () => {
    const p = makePalette()
    p.primary[0].hex = '#FFF'
    expect(validatePalette(p).ok).toBe(false)
  })

  it('paletteLine 未包含某个主色 → 拒绝（机械注入会漏色）', () => {
    const p = makePalette()
    p.paletteLine.zh = 'Palette: #0E1A24 / #1F4E5F'
    const r = validatePalette(p)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未包含主色')
  })

  it('paletteLine 缺 en → 拒绝（中英成对）', () => {
    const p = makePalette()
    delete p.paletteLine.en
    expect(validatePalette(p).ok).toBe(false)
  })

  it('primary 为空 → 拒绝', () => {
    const p = makePalette()
    p.primary = []
    expect(validatePalette(p).ok).toBe(false)
  })
})

describe('validateDoctrine: v7 增补结构（recipes / failureLedger）', () => {
  it('带 recipes 且 blockKeys 引用真实块 → 通过', () => {
    const d = {
      blocks: [{ key: 'style', label: 'STYLE', zh: '风格', en: 'Style' }],
      rules: [{ key: 'r1', title: 't', zh: '中', en: 'en' }],
      glossary: [],
      recipes: [{ key: 'full', label: 'FULL', blockKeys: ['style'] }],
    }
    expect(validateDoctrine(d).ok).toBe(true)
  })

  it('recipes 引用不存在的块 → 拒绝', () => {
    const d = {
      blocks: [{ key: 'style', label: 'STYLE', zh: '风格', en: 'Style' }],
      rules: [{ key: 'r1', title: 't', zh: '中', en: 'en' }],
      glossary: [],
      recipes: [{ key: 'full', label: 'FULL', blockKeys: ['ghost'] }],
    }
    const r = validateDoctrine(d)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('ghost')
  })

  it('failureLedger 缺 symptom/cause/fix 任一 → 拒绝', () => {
    for (const field of ['symptom', 'cause', 'fix']) {
      const d = {
        blocks: [{ key: 'style', label: 'STYLE', zh: '风格', en: 'Style' }],
        rules: [{ key: 'r1', title: 't', zh: '中', en: 'en' }],
        glossary: [],
        failureLedger: [{ id: 'FL-01', symptom: 's', cause: 'c', fix: 'f' }],
      }
      delete d.failureLedger[0][field]
      expect(validateDoctrine(d).ok).toBe(false)
    }
  })

  it('failureLedger id 重复 → 拒绝', () => {
    const d = {
      blocks: [{ key: 'style', label: 'STYLE', zh: '风格', en: 'Style' }],
      rules: [{ key: 'r1', title: 't', zh: '中', en: 'en' }],
      glossary: [],
      failureLedger: [
        { id: 'FL-01', symptom: 's', cause: 'c', fix: 'f' },
        { id: 'FL-01', symptom: 's2', cause: 'c2', fix: 'f2' },
      ],
    }
    const r = validateDoctrine(d)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('id 重复')
  })

  it('声明为空的 recipes / failureLedger → 拒绝（半张台账比没有更危险）', () => {
    const base = {
      blocks: [{ key: 'style', label: 'STYLE', zh: '风格', en: 'Style' }],
      rules: [{ key: 'r1', title: 't', zh: '中', en: 'en' }],
      glossary: [],
    }
    expect(validateDoctrine({ ...base, recipes: [] }).ok).toBe(false)
    expect(validateDoctrine({ ...base, failureLedger: [] }).ok).toBe(false)
  })
})

describe('loadFilmKit: 新资产的两种失败形态（缺失 vs 损坏）', () => {
  it('缺 shot-grammar.json → 非严格模式可用，但 assetWarnings 点名（可见不静默）', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit())
    fs.rmSync(path.join(dir, 'shot-grammar.json'))
    const r = loadFilmKit({ kitDir: dir })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.kit.shotGrammar).toBeNull()
    expect(r.kit.grammarIndex).toBeNull()
    expect(r.kit.assetWarnings.join()).toContain('shot-grammar.json')
  })

  it('缺 shot-grammar.json + requireAssets → 硬失败并点名文件', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit())
    fs.rmSync(path.join(dir, 'shot-grammar.json'))
    const r = loadFilmKit({ kitDir: dir, requireAssets: true })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('shot-grammar.json')
  })

  it('shot-grammar.json 损坏 → 无论是否严格模式都 fail-closed（绝不用半份数据）', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit())
    fs.writeFileSync(path.join(dir, 'shot-grammar.json'), '{ broken')
    const soft = loadFilmKit({ kitDir: dir })
    expect(soft.ok).toBe(false)
    if (!soft.ok) expect(soft.error).toContain('shot-grammar.json')
    const strict = loadFilmKit({ kitDir: dir, requireAssets: true })
    expect(strict.ok).toBe(false)
  })

  it('palette.json 结构非法 → fail-closed（主色超限）', () => {
    const dir = tmpDir()
    const kit = makeKit()
    kit.palette.primary.push({ key: 'p5', hex: '#000000', zhName: '黑', enName: 'Black' })
    writeKit(dir, kit)
    const r = loadFilmKit({ kitDir: dir })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('palette.json')
  })

  it('缺 prompts/tasks → 非严格模式可用 + 告警；严格模式失败', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit())
    fs.rmSync(path.join(dir, 'prompts'), { recursive: true, force: true })
    const soft = loadFilmKit({ kitDir: dir })
    expect(soft.ok).toBe(true)
    if (soft.ok) {
      expect(soft.kit.promptLibrary).toBeNull()
      expect(soft.kit.assetWarnings.join()).toContain('prompts/tasks')
    }
    const strict = loadFilmKit({ kitDir: dir, requireAssets: true })
    expect(strict.ok).toBe(false)
    if (!strict.ok) expect(strict.error).toContain('prompts/tasks')
  })

  it('prompts/tasks 存在但缺 en 语种 → 严格与否都 fail-closed（半个库比没有更危险）', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit())
    fs.rmSync(path.join(dir, 'prompts', 'tasks', 'adapt_script', 'en'), { recursive: true, force: true })
    const r = loadFilmKit({ kitDir: dir })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('prompts/tasks')
  })

  it('老版 kit（缺新四件）非严格模式能加载并带 4 条告警；严格模式回退到下一级', () => {
    const oldDir = tmpDir()
    writeKit(oldDir, makeKit())
    for (const f of ['shot-grammar.json', 'compliance-checklist.json', 'palette.json']) fs.rmSync(path.join(oldDir, f))
    fs.rmSync(path.join(oldDir, 'prompts'), { recursive: true, force: true })
    const goodDir = tmpDir()
    writeKit(goodDir, makeKit())

    const soft = loadFilmKitChain({ dirs: [{ dir: oldDir, label: 'userData-full' }, { dir: goodDir, label: 'asar-bundled' }], log: { warn () {} } })
    expect(soft.ok).toBe(true)
    if (soft.ok) {
      expect(soft.kit.source).toBe('userData-full')
      expect(soft.kit.assetWarnings.length).toBe(4)
    }

    const strict = loadFilmKitChain({ dirs: [{ dir: oldDir, label: 'userData-full' }, { dir: goodDir, label: 'asar-bundled' }], log: { warn () {} }, requireAssets: true })
    expect(strict.ok).toBe(true)
    if (strict.ok) {
      expect(strict.kit.source).toBe('asar-bundled')
      expect(strict.fallbacks.length).toBe(1)
      expect(strict.kit.assetWarnings).toEqual([])
    }
  })

  it('加载成功后 kit 上挂载枚举索引与 prompt 库', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit())
    const r = loadFilmKit({ kitDir: dir })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.kit.grammarIndex.cameraMoves.get('static').zh).toBe('固定')
    expect(r.kit.promptLibrary.taskNames).toContain('adapt_script')
    expect(r.kit.palette.primary.length).toBe(4)
    expect(r.kit.compliance.items.length).toBe(1)
    expect(r.kit.assetWarnings).toEqual([])
  })
})

// ===== v7 对抗评审修复的回归锁 =====

describe('checkSchemaVersion（i4：版本号不再是装饰）', () => {
  it('声明的版本必须受支持', () => {
    expect(checkSchemaVersion({ schemaVersion: 1 }, 'x', [1]).ok).toBe(true)
    expect(checkSchemaVersion({ schemaVersion: 2 }, 'x', [1]).ok).toBe(false)
    expect(checkSchemaVersion({ schemaVersion: 0 }, 'x', [1]).ok).toBe(false)
  })

  it('缺失时默认拒绝；allowMissing 时放行', () => {
    expect(checkSchemaVersion({}, 'x', [1]).ok).toBe(false)
    expect(checkSchemaVersion({}, 'x', [1], { allowMissing: true }).ok).toBe(true)
  })

  it('非整数拒绝', () => {
    expect(checkSchemaVersion({ schemaVersion: '1.5' }, 'x', [1]).ok).toBe(false)
    expect(checkSchemaVersion({ schemaVersion: 'a' }, 'x', [1]).ok).toBe(false)
  })

  it('不受支持时的错误文案指向「重新导入配套资产」而不是「改版本号」', () => {
    const r = checkSchemaVersion({ schemaVersion: 9 }, 'palette', [1])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('palette')
      expect(r.error).toContain('重新导入配套资产')
    }
  })
})

describe('validate* 读取 schemaVersion（i4 接线）', () => {
  it('shot-grammar 版本不符 → 拒绝', () => {
    const g = makeShotGrammar()
    g.schemaVersion = 2
    const r = validateShotGrammar(g)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('schemaVersion')
  })

  it('compliance-checklist 版本不符 → 拒绝', () => {
    const c = makeCompliance()
    c.schemaVersion = 7
    expect(validateComplianceChecklist(c).ok).toBe(false)
  })

  it('palette 版本不符 → 拒绝', () => {
    const p = makePalette()
    p.schemaVersion = 0
    expect(validatePalette(p).ok).toBe(false)
  })

  it('prompt-doctrine 缺版本按 v1 兼容，声明 2 通过，声明 3 拒绝', () => {
    const base = { blocks: [{ key: 'style', label: 'STYLE', zh: '风格', en: 'Style' }], rules: [{ key: 'r1', title: 't', zh: '中', en: 'e' }], glossary: [] }
    expect(validateDoctrine(base).ok).toBe(true)
    expect(validateDoctrine({ ...base, schemaVersion: 2 }).ok).toBe(true)
    expect(validateDoctrine({ ...base, schemaVersion: 3 }).ok).toBe(false)
  })
})

describe('readOptionalJsonFile 的字面 null（i7）', () => {
  it('文件内容为 JSON null → 按损坏处理，不当缺失放行', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit())
    fs.writeFileSync(path.join(dir, 'palette.json'), 'null')
    const r = loadFilmKit({ kitDir: dir })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('palette.json')
      expect(r.error).toContain('空值')
    }
  })
})

// ===== v7 对抗评审第二轮 =====

describe('validateShotGrammar 语义字段取值域（第二轮 i6）', () => {
  it('risk 拼错 → 拒绝', () => {
    const g = makeShotGrammar()
    g.cameraMoves[0].risk = 'hihg'
    const r = validateShotGrammar(g)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('risk')
  })

  it('chain 拼错 → 拒绝', () => {
    const g = makeShotGrammar()
    g.shotSizes[0].chain = 'wdie'
    expect(validateShotGrammar(g).ok).toBe(false)
  })

  it('emotion 拼错 → 拒绝', () => {
    const g = makeShotGrammar()
    g.cameraAngles[0].emotion = 'powr'
    expect(validateShotGrammar(g).ok).toBe(false)
  })

  it('未声明语义字段时不强制（向后兼容）', () => {
    const g = makeShotGrammar()
    delete g.cameraMoves[0].risk
    expect(validateShotGrammar(g).ok).toBe(true)
  })

  it('合法取值通过', () => {
    const g = makeShotGrammar()
    g.cameraMoves[0].risk = 'high'
    expect(validateShotGrammar(g).ok).toBe(true)
  })
})

describe('prompts/tasks 存在但为空（第二轮 i8）', () => {
  it('非严格模式：空目录与缺失同处置，只记告警', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit())
    fs.rmSync(path.join(dir, 'prompts', 'tasks'), { recursive: true, force: true })
    fs.mkdirSync(path.join(dir, 'prompts', 'tasks'), { recursive: true })
    const r = loadFilmKit({ kitDir: dir })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.kit.promptLibrary).toBeNull()
    expect(r.kit.assetWarnings.join()).toContain('存在但没有任务目录')
  })

  it('严格模式：空目录仍按失败处理（导入校验要拦）', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit())
    fs.rmSync(path.join(dir, 'prompts', 'tasks'), { recursive: true, force: true })
    fs.mkdirSync(path.join(dir, 'prompts', 'tasks'), { recursive: true })
    const r = loadFilmKit({ kitDir: dir, requireAssets: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('prompts/tasks')
  })
})

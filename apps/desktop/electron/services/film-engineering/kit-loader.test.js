// @ts-check
'use strict'
/**
 * film-kit loader 契约测试
 * 覆盖：正常加载 / 缺文件 / 坏 JSON / schema 非法 / token 格式错 → fail-closed
 * 测试固定使用 os.tmpdir() 下随机隔离目录，禁止触碰仓库内共享文件。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const { loadFilmKit, loadFilmKitChain, validateManifest, validateShotLibrary, validateReferences, validateDoctrine, validateShotSceneRefs, validateShotGrammar, validateComplianceChecklist, validatePalette, FILM_PROMPT_MAX_LEN } = require('./kit-loader')

const UUID = '3caa2f3a-52b5-4293-9237-0c8f76c7158a'

function makeKit () {
  return {
    manifest: {
      schemaVersion: 1,
      filmMeta: {
        title: 'Hell Grind',
        durationSec: 5706,
        logline: 'Street kids gain powers to fight ancient evil.',
        characters: [
          { name: 'ROKO', descriptor: 'Determined street kid with glowing fist' },
          { name: 'JAXX', descriptor: 'Reckless street kid' },
          { name: 'LULU', descriptor: 'Clever street kid' },
          { name: 'REIN', descriptor: 'Mysterious street kid' },
        ],
      },
      scenes: [
        { id: 'cold-open', name: '1. COLD OPEN', count: 12, parentId: null, level: 0 },
        { id: 'scene-25', name: 'Scene 25 Roko vs Robots', count: 4555, parentId: null, level: 0 },
      ],
    },
    shots: [
      {
        shotId: '11111111-1111-4111-8111-111111111111',
        sceneId: 'scene-25',
        prompt: 'EXT. CITY STREET - NIGHT\n[CHARACTER: ROKO] runs toward camera.\nGEO SPATIAL LAYOUT: ...',
        model: 'seedance_2_0',
        refTokens: [UUID],
        resultUrl: 'https://cdn.example.com/raw/abc.mp4',
        width: 1920,
        height: 1080,
      },
    ],
    references: {
      [UUID]: { kind: 'character', name: 'ROKO', imageUrls: ['https://cdn.example.com/roko.png'] },
    },
    doctrine: {
      blocks: [
        { key: 'geo_spatial_layout', label: 'GEO SPATIAL LAYOUT', zh: '地理空间布局', en: 'Geo spatial layout' },
      ],
      rules: [{ key: 'batch-10-15', title: 'Batch iteration 10-15', zh: '批量迭代 10-15 法则', en: 'Batch 10-15 rule' }],
      glossary: [{ term: 'seedance', zh: '种子舞', en: 'Seedance' }],
    },
    // v7 批次一新增的三份数据资产与任务化 prompt 库：夹具必须与 KIT_FILES 契约同步，
    // 否则「kit 可用」与「资产齐全」两个概念会脱钩。
    shotGrammar: makeShotGrammar(),
    compliance: makeCompliance(),
    palette: makePalette(),
    prompts: makePrompts(),
  }
}

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
      id: 'CC-01',
      category: 'content',
      severity: 'blocker',
      zhQuestion: '是否包含禁止内容？',
      enQuestion: 'Forbidden content?',
      zhPass: '不包含',
      enPass: 'None',
      zhFix: '改写',
      enFix: 'Rewrite',
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
  for (const task of ['adapt_script']) {
    for (const loc of ['zh', 'en']) {
      out[task + '/' + loc + '/system.md'] = 'system ' + task + ' ' + loc
      out[task + '/' + loc + '/user.md'] = 'user ' + task + ' ' + loc
    }
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

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'film-kit-test-'))
}

it('kit-loader: 正常加载返回完整 kit', () => {
  const dir = tmpDir()
  writeKit(dir, makeKit())
  const result = loadFilmKit({ kitDir: dir })
  expect(result.ok).toBe(true)
  expect(result.kit.manifest.filmMeta.title).toBe('Hell Grind')
  expect(result.kit.shots.length).toBe(1)
  expect(result.kit.references[UUID].kind).toBe('character')
  expect(result.kit.doctrine.blocks.length > 0).toBeTruthy()
  expect(Array.isArray(result.kit.errors)).toBeTruthy()
  expect(result.kit.errors.length).toBe(0)
})

it('kit-loader: 缺文件 fail-closed', () => {
  const dir = tmpDir()
  const kit = makeKit()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'film-manifest.json'), JSON.stringify(kit.manifest))
  fs.writeFileSync(path.join(dir, 'shot-library.json'), JSON.stringify(kit.shots))
  fs.writeFileSync(path.join(dir, 'reference-registry.json'), JSON.stringify(kit.references))
  // 缺 prompt-doctrine.json
  const result = loadFilmKit({ kitDir: dir })
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/prompt-doctrine\.json/)
})

it('kit-loader: 坏 JSON fail-closed', () => {
  const dir = tmpDir()
  const kit = makeKit()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'film-manifest.json'), '{broken json')
  fs.writeFileSync(path.join(dir, 'shot-library.json'), JSON.stringify(kit.shots))
  fs.writeFileSync(path.join(dir, 'reference-registry.json'), JSON.stringify(kit.references))
  fs.writeFileSync(path.join(dir, 'prompt-doctrine.json'), JSON.stringify(kit.doctrine))
  const result = loadFilmKit({ kitDir: dir })
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/film-manifest\.json/)
})

it('kit-loader: schema 非法 fail-closed（manifest 场景重复）', () => {
  const dir = tmpDir()
  const kit = makeKit()
  kit.manifest.scenes.push({ id: 'scene-25', name: 'duplicate', count: 1, parentId: null, level: 0 })
  writeKit(dir, kit)
  const result = loadFilmKit({ kitDir: dir })
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/scenes id 重复/)
})

it('kit-loader: 分镜 prompt 为空 fail-closed', () => {
  const dir = tmpDir()
  const kit = makeKit()
  kit.shots[0].prompt = ''
  writeKit(dir, kit)
  const result = loadFilmKit({ kitDir: dir })
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/prompt/i)
})

it('kit-loader: 分镜 prompt 超长 fail-closed', () => {
  const dir = tmpDir()
  const kit = makeKit()
  kit.shots[0].prompt = 'x'.repeat(50001)
  writeKit(dir, kit)
  const result = loadFilmKit({ kitDir: dir })
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/50000/)
})

it('kit-loader: refTokens 非字符串 fail-closed', () => {
  const dir = tmpDir()
  const kit = makeKit()
  kit.shots[0].refTokens = [12345]
  writeKit(dir, kit)
  const result = loadFilmKit({ kitDir: dir })
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/refTokens/i)
})

it('kit-loader: reference-registry imageUrls 仅 https', () => {
  const dir = tmpDir()
  const kit = makeKit()
  kit.references[UUID].imageUrls = ['http://insecure.example.com/a.png']
  writeKit(dir, kit)
  const result = loadFilmKit({ kitDir: dir })
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/https/i)
})

it('kit-loader: 目录不存在 fail-closed', () => {
  const result = loadFilmKit({ kitDir: path.join(tmpDir(), 'nope') })
  expect(result.ok).toBe(false)
})

it('validateManifest: 树无环 + 层级校验', () => {
  const kit = makeKit()
  expect(validateManifest(kit.manifest).ok).toBe(true)
  const cyclic = JSON.parse(JSON.stringify(kit.manifest))
  cyclic.scenes.push({ id: 'c1', name: 'child', count: 1, parentId: 'scene-25', level: 1 })
  cyclic.scenes.push({ id: 'c2', name: 'child2', count: 1, parentId: 'c1', level: 2 })
  cyclic.scenes.push({ id: 'c3', name: 'child3', count: 1, parentId: 'c2', level: 3 })
  cyclic.scenes.push({ id: 'c4', name: 'child4', count: 1, parentId: 'c3', level: 4 })
  cyclic.scenes.push({ id: 'c5', name: 'child5', count: 1, parentId: 'c4', level: 5 })
  cyclic.scenes.push({ id: 'c6', name: 'child6', count: 1, parentId: 'c5', level: 6 })
  const result = validateManifest(cyclic)
  expect(result.ok).toBe(true)
})

it('validateShotLibrary: shotId 重复 fail-closed', () => {
  const kit = makeKit()
  const dup = JSON.parse(JSON.stringify(kit.shots))
  dup.push({ ...dup[0], sceneId: 'other' })
  const result = validateShotLibrary(dup)
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/shotId/)
})

it('validateReferences: token 非法 fail-closed', () => {
  const kit = makeKit()
  const bad = { 'not-a-token': { kind: 'character', name: 'X', imageUrls: ['https://x.com/a.png'] } }
  const result = validateReferences(bad)
  expect(result.ok).toBe(false)
})

it('validateDoctrine: 块/规则/词汇表非空', () => {
  const kit = makeKit()
  expect(validateDoctrine(kit.doctrine).ok).toBe(true)
  expect(validateDoctrine({ blocks: [], rules: [], glossary: [] }).ok).toBe(false)
})


// ---------- film-full-corpus-production L1：两级 kit 回退链与扩展 schema（任务 3.1/3.3） ----------

it('FILM_PROMPT_MAX_LEN 导出为单一常量 50000（D4 四处同源）', () => {
  const loader = require('./kit-loader')
  expect(FILM_PROMPT_MAX_LEN).toBe(50000)
  expect(loader.MAX_PROMPT_LENGTH).toBe(FILM_PROMPT_MAX_LEN) // 兼容别名同值
})

it('chain：userData 全量优先于精简包', () => {
  const full = tmpDir()
  const bundled = tmpDir()
  writeKit(full, makeKit())
  writeKit(bundled, makeKit())
  const warns = []
  const r = loadFilmKitChain({ dirs: [{ dir: full, label: 'userData-full' }, { dir: bundled, label: 'asar-bundled' }], log: { warn: (m) => warns.push(m) } })
  expect(r.ok).toBe(true)
  expect(r.kit.source).toBe('userData-full')
  expect(r.kit.dir).toBe(full)
  expect(r.fallbacks).toEqual([])
  expect(warns.length).toBe(0)
})

it('chain：全量损坏回退精简——错误可见（log.warn）非静默', () => {
  const full = tmpDir()
  const bundled = tmpDir()
  writeKit(full, makeKit())
  writeKit(bundled, makeKit())
  fs.writeFileSync(path.join(full, 'shot-library.json'), '{ broken json')
  const warns = []
  const r = loadFilmKitChain({ dirs: [{ dir: full, label: 'userData-full' }, { dir: bundled, label: 'asar-bundled' }], log: { warn: (m) => warns.push(m) } })
  expect(r.ok).toBe(true)
  expect(r.kit.source).toBe('asar-bundled')
  expect(r.fallbacks.length).toBe(1)
  expect(r.fallbacks[0].reason).toContain('shot-library.json')
  expect(warns.some((w) => String(w).includes('FILM_KIT_FALLBACK'))).toBe(true)
})

it('chain：全量目录缺失（未导入）→ 直接用精简，不算 fallback 错误', () => {
  const bundled = tmpDir()
  writeKit(bundled, makeKit())
  const r = loadFilmKitChain({ dirs: [{ dir: path.join(tmpDir(), 'nope'), label: 'userData-full' }, { dir: bundled, label: 'asar-bundled' }] })
  expect(r.ok).toBe(true)
  expect(r.kit.source).toBe('asar-bundled')
  expect(r.missing.length).toBe(1)
  expect(r.fallbacks).toEqual([])
})

it('chain：两级均不可用 → ok:false 且 error 含 FILM_KIT_UNAVAILABLE', () => {
  const bad = tmpDir()
  writeKit(bad, makeKit())
  fs.writeFileSync(path.join(bad, 'film-manifest.json'), '[]')
  const r = loadFilmKitChain({ dirs: [{ dir: bad, label: 'userData-full' }, { dir: path.join(tmpDir(), 'nope'), label: 'asar-bundled' }] })
  expect(r.ok).toBe(false)
  expect(r.error).toContain('FILM_KIT_UNAVAILABLE')
  expect(r.error).toContain('film-manifest.json') // 校验错误含文件与条目索引
})

it('chain：dirs 为空 → fail-closed', () => {
  const r = loadFilmKitChain({ dirs: [] })
  expect(r.ok).toBe(false)
  expect(r.error).toContain('FILM_KIT_UNAVAILABLE')
})

it('扩展字段校验：durationSec/aspectRatio/iterationCount/adoptedJobAt 非法值拒绝', () => {
  const badD = [{ ...makeKit().shots[0], durationSec: -3 }]
  expect(validateShotLibrary(badD).ok).toBe(false)
  const badA = [{ ...makeKit().shots[0], aspectRatio: 916 }]
  expect(validateShotLibrary(badA).ok).toBe(false)
  const badI = [{ ...makeKit().shots[0], iterationCount: 1.5 }]
  expect(validateShotLibrary(badI).ok).toBe(false)
  const badT = [{ ...makeKit().shots[0], adoptedJobAt: 'yesterday' }]
  expect(validateShotLibrary(badT).ok).toBe(false)
  const good = [{ ...makeKit().shots[0], durationSec: 12, aspectRatio: '21:9', iterationCount: 3, adoptedJobAt: 1778180608.86 }]
  expect(validateShotLibrary(good).ok).toBe(true)
})

it('prompt 边界：恰为 FILM_PROMPT_MAX_LEN 通过，超一字符拒绝', () => {
  const atLimit = [{ ...makeKit().shots[0], prompt: 'x'.repeat(FILM_PROMPT_MAX_LEN) }]
  expect(validateShotLibrary(atLimit).ok).toBe(true)
  const over = [{ ...makeKit().shots[0], prompt: 'x'.repeat(FILM_PROMPT_MAX_LEN + 1) }]
  const r = validateShotLibrary(over)
  expect(r.ok).toBe(false)
  expect(r.error).toContain('50000')
})

it('shotId-sceneId 交叉引用：sceneId 不在 manifest 中拒绝', () => {
  const kit = makeKit()
  expect(validateShotSceneRefs(kit.shots, kit.manifest).ok).toBe(true)
  const orphan = [{ ...kit.shots[0], sceneId: 'no-such-scene' }]
  const r = validateShotSceneRefs(orphan, kit.manifest)
  expect(r.ok).toBe(false)
  expect(r.error).toContain('no-such-scene')
})

it('loadFilmKit 集成交叉引用：孤儿 shot 使整级校验失败', () => {
  const dir = tmpDir()
  const kit = makeKit()
  kit.shots[0].sceneId = 'ghost-scene'
  writeKit(dir, kit)
  const r = loadFilmKit({ kitDir: dir })
  expect(r.ok).toBe(false)
  expect(r.error).toContain('ghost-scene')
})

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

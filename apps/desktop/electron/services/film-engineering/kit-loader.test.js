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

const { loadFilmKit, loadFilmKitChain, validateManifest, validateShotLibrary, validateReferences, validateDoctrine, validateShotSceneRefs, FILM_PROMPT_MAX_LEN } = require('./kit-loader')

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
  }
}

function writeKit (dir, kit) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'film-manifest.json'), JSON.stringify(kit.manifest))
  fs.writeFileSync(path.join(dir, 'shot-library.json'), JSON.stringify(kit.shots))
  fs.writeFileSync(path.join(dir, 'reference-registry.json'), JSON.stringify(kit.references))
  fs.writeFileSync(path.join(dir, 'prompt-doctrine.json'), JSON.stringify(kit.doctrine))
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

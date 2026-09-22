// @ts-check
'use strict'
/**
 * FilmEngineeringService 聚合服务契约测试
 * 覆盖：status / 懒加载 / fail-closed / 复制 / 套用 / 导出 / 勾选生成
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const { FilmEngineeringService } = require('./film-engineering-service')

const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function makeKitDir () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-service-test-'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'film-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    filmMeta: {
      title: 'Hell Grind',
      durationSec: 5706,
      logline: 'logline',
      characters: [{ name: 'ROKO', descriptor: 'd' }, { name: 'JAXX', descriptor: 'd' }, { name: 'LULU', descriptor: 'd' }, { name: 'REIN', descriptor: 'd' }],
    },
    scenes: [{ id: 'cold-open', name: '1. COLD OPEN', count: 12, parentId: null, level: 0 }],
  }))
  fs.writeFileSync(path.join(dir, 'shot-library.json'), JSON.stringify([
    {
      shotId: '11111111-1111-4111-8111-111111111111',
      sceneId: 'cold-open',
      prompt: 'EXT. STREET\n[CHARACTER: ROKO] walks.\n\nGEO SPATIAL LAYOUT\nRoko center.\n\nACTION TIMING\n0-4s walk.',
      model: 'seedance_2_0',
      refTokens: [],
    },
  ]))
  fs.writeFileSync(path.join(dir, 'reference-registry.json'), JSON.stringify({
    [UUID_B]: { kind: 'character', name: 'JAXX', imageUrls: ['https://cdn.example.com/jaxx.png'] },
  }))
  fs.writeFileSync(path.join(dir, 'prompt-doctrine.json'), JSON.stringify({
    blocks: [{ key: 'geo', label: 'GEO SPATIAL LAYOUT', zh: '布局', en: 'Layout' }],
    rules: [{ key: 'r1', title: 'rule', zh: '法则', en: 'Rule' }],
    glossary: [],
  }))
  return dir
}

const log = { info () {}, warn () {}, error () {} }

describe('FilmEngineeringService', () => {
  it('status: kit 可用时返回元数据与计数', () => {
    const svc = new FilmEngineeringService({ kitDir: makeKitDir(), log })
    const status = svc.getStatus()
    expect(status.available).toBe(true)
    expect(status.filmMeta.title).toBe('Hell Grind')
    expect(status.sceneCount).toBe(1)
    expect(status.shotCount).toBe(1)
  })

  it('status: kit 不可用时 fail-closed', () => {
    const svc = new FilmEngineeringService({ kitDir: path.join(os.tmpdir(), 'nope-' + Date.now()), log })
    const status = svc.getStatus()
    expect(status.available).toBe(false)
    expect(status.error).toMatch(/FILM_KIT_UNAVAILABLE/)
  })

  it('查询类接口在 kit 不可用时抛 FILM_KIT_UNAVAILABLE', () => {
    const svc = new FilmEngineeringService({ kitDir: path.join(os.tmpdir(), 'nope2-' + Date.now()), log })
    expect(() => svc.listScenes()).toThrow(/FILM_KIT_UNAVAILABLE/)
    expect(() => svc.buildCopyText('x', 'full')).toThrow(/FILM_KIT_UNAVAILABLE/)
  })

  it('listShots / getShot / buildCopyText 正常', () => {
    const svc = new FilmEngineeringService({ kitDir: makeKitDir(), log })
    expect(svc.listScenes().length).toBe(1)
    const shots = svc.listShots('cold-open')
    expect(shots.length).toBe(1)
    const detail = svc.getShot('11111111-1111-4111-8111-111111111111')
    expect(detail.prompt).toMatch(/GEO SPATIAL LAYOUT/)
    const text = svc.buildCopyText('11111111-1111-4111-8111-111111111111', 'blocks')
    expect(text).toMatch(/GEO SPATIAL LAYOUT/)
    const merged = svc.buildCopyTexts(['11111111-1111-4111-8111-111111111111'], 'full')
    expect(merged).toMatch(/EXT\. STREET/)
  })

  it('doctrine 返回中英双语块/规则/词汇表', () => {
    const svc = new FilmEngineeringService({ kitDir: makeKitDir(), log })
    const doctrine = svc.getDoctrine()
    expect(doctrine.blocks.length).toBe(1)
    expect(doctrine.blocks[0].zh).toBe('布局')
    expect(doctrine.rules.length).toBe(1)
  })

  it('adaptScript 委托引擎并返回同构结果', async () => {
    const svc = new FilmEngineeringService({ kitDir: makeKitDir(), log })
    const result = await svc.adaptScript({
      script: '第一场 废墟\n\n小强走在废墟中。',
      characterMap: { ROKO: '小强' },
    })
    expect(result.ok).toBe(true)
    expect(result.adaptedShots.length).toBe(1)
    expect(result.adaptedShots[0].prompt).toMatch(/废墟/)
  })

  it('exportPrompts 返回 JSON/Markdown', () => {
    const svc = new FilmEngineeringService({ kitDir: makeKitDir(), log })
    const shots = svc.listShots('cold-open')
    const out = svc.exportPrompts(shots, 'json')
    expect(out.export.json).toContain('shotId')
    expect(out.export.markdown).toMatch(/GEO SPATIAL LAYOUT/)
    expect(out.fileName).toMatch(/\.json$/)
  })

  it('generateSelected 复用 assetGenerator 并返回结果', async () => {
    const assetGenerator = {
      generateImage: async (prompt, opts) => {
        expect(prompt).toMatch(/GEO SPATIAL LAYOUT/)
        expect(opts.aspect_ratio).toBe('16:9')
        return { code: 0, data: { path: 'img_0001.png' } }
      },
    }
    const svc = new FilmEngineeringService({ kitDir: makeKitDir(), log, assetGenerator })
    const shots = svc.listShots('cold-open')
    const result = await svc.generateSelected(shots, { aspectRatio: '16:9' })
    expect(result.ok).toBe(true)
    expect(result.results.length).toBe(1)
    expect(result.results[0].code).toBe(0)
  })

  it('generateSelected 无 assetGenerator 时明确报错', async () => {
    const svc = new FilmEngineeringService({ kitDir: makeKitDir(), log, assetGenerator: null })
    const shots = svc.listShots('cold-open')
    const result = await svc.generateSelected(shots, {})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/生成能力不可用|未配置/)
  })

  it('generateSelected 一次最多 20 个分镜', async () => {
    const svc = new FilmEngineeringService({ kitDir: makeKitDir(), log, assetGenerator: { generateImage: async () => ({ code: 0 }) } })
    const many = Array.from({ length: 21 }, (_, i) => ({ shotId: 's' + i, sceneId: 'x', prompt: 'p' + i, model: 'm', refTokens: [] }))
    const result = await svc.generateSelected(many, {})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/20/)
  })
})

// ---------- film-full-corpus-production 任务 3.2：两级 kit 回退链接线 ----------

it('链接线：userData 全量优先，status.kitSource=userData-full', () => {
  const full = makeKitDir()
  const bundled = makeKitDir()
  const svc = new FilmEngineeringService({ kitDir: bundled, userDataKitDir: full, log })
  const status = svc.getStatus()
  expect(status.available).toBe(true)
  expect(status.kitSource).toBe('userData-full')
})

it('链接线：userData 损坏回退精简包，FILM_KIT_FALLBACK 告警可见', () => {
  const full = makeKitDir()
  const bundled = makeKitDir()
  fs.writeFileSync(path.join(full, 'shot-library.json'), '{ broken')
  const warns = []
  const svc = new FilmEngineeringService({ kitDir: bundled, userDataKitDir: full, log: { info () {}, warn: (m) => warns.push(m), error () {} } })
  const status = svc.getStatus()
  expect(status.available).toBe(true)
  expect(status.kitSource).toBe('asar-bundled')
  expect(warns.some((w) => String(w).includes('FILM_KIT_FALLBACK'))).toBe(true)
})

it('链接线：userData 未导入（目录不存在）→ 直接用精简包且不告警', () => {
  const bundled = makeKitDir()
  const warns = []
  const svc = new FilmEngineeringService({ kitDir: bundled, userDataKitDir: path.join(os.tmpdir(), 'no-such-kit-' + Date.now()), log: { info () {}, warn: (m) => warns.push(m), error () {} } })
  const status = svc.getStatus()
  expect(status.available).toBe(true)
  expect(status.kitSource).toBe('asar-bundled')
  expect(warns.length).toBe(0)
})

it('链接线：两级均不可用 → status fail-closed 含 FILM_KIT_UNAVAILABLE', () => {
  const full = makeKitDir()
  fs.writeFileSync(path.join(full, 'film-manifest.json'), '[]')
  const svc = new FilmEngineeringService({ kitDir: path.join(os.tmpdir(), 'nope3-' + Date.now()), userDataKitDir: full, log })
  const status = svc.getStatus()
  expect(status.available).toBe(false)
  expect(status.error).toMatch(/FILM_KIT_UNAVAILABLE/)
  expect(status.error).toMatch(/film-manifest\.json/)
})

it('listShots 分页透传：opts 达 ShotLibrary 返回页封装', () => {
  const svc = new FilmEngineeringService({ kitDir: makeKitDir(), log })
  const page = svc.listShots('cold-open', { limit: 5, offset: 0 })
  expect(page.total).toBe(1)
  expect(page.shots.length).toBe(1)
  expect(Array.isArray(svc.listShots('cold-open'))).toBe(true)
})

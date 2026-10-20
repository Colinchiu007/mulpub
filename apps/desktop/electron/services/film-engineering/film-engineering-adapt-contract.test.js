// @ts-check
'use strict'
/**
 * script-adapt 输出契约测试
 * 保证 adaptedShots 与 kit shot 同构：可被勾选生成（assetGenerator.generateImage）与导出消费。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const { loadFilmKit } = require('./kit-loader')
const { ScriptAdapter } = require('./script-adapt')

function makeKitDir () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-contract-test-'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'film-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    filmMeta: {
      title: 'Film Project Case',
      durationSec: 5706,
      logline: 'logline',
      characters: [{ name: 'ROKO', descriptor: 'd' }],
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
      resultUrl: 'https://cdn.example.com/raw/a.mp4',
      width: 1920,
      height: 1080,
    },
  ]))
  fs.writeFileSync(path.join(dir, 'reference-registry.json'), JSON.stringify({'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee': {kind: 'character', name: 'ROKO', imageUrls: ['https://cdn.example.com/roko.png']}}))
  fs.writeFileSync(path.join(dir, 'prompt-doctrine.json'), JSON.stringify({
    blocks: [{ key: 'geo', label: 'GEO SPATIAL LAYOUT', zh: '布局', en: 'Layout' }],
    rules: [{ key: 'r1', title: 'rule', zh: '法则', en: 'Rule' }],
    glossary: [],
  }))
  return dir
}

it('契约: adaptedShots 与 kit shot 公共字段同构', async () => {
  const loaded = loadFilmKit({ kitDir: makeKitDir() })
  expect(loaded.ok).toBe(true)
  const kitShot = loaded.kit.shots[0]
  const adapter = new ScriptAdapter({ kit: loaded.kit, llm: null })
  const result = await adapter.adaptScript({
    script: '第一场 废墟\n\n小强走在废墟中。',
    characterMap: { ROKO: '小强' },
  })
  expect(result.ok).toBe(true)
  const adapted = result.adaptedShots[0]
  // 公共字段存在且类型一致
  for (const field of ['shotId', 'sceneId', 'prompt', 'model', 'refTokens']) {
    expect(field in adapted, 'adaptedShot 缺字段: ' + field).toBeTruthy()
    expect(typeof adapted[field]).toBe(typeof kitShot[field], '字段类型不一致: ' + field)
  }
  expect(typeof adapted.prompt).toBe('string')
  expect(adapted.prompt.length > 0).toBeTruthy()
  // generate-selected 消费所需：prompt 可作 generateImage 输入
  expect(adapted.prompt.length <= 50000).toBeTruthy()
})

it('契约: 勾选生成输入（selectedShots）可被导出消费', async () => {
  const loaded = loadFilmKit({ kitDir: makeKitDir() })
  const adapter = new ScriptAdapter({ kit: loaded.kit, llm: null })
  const result = await adapter.adaptScript({ script: '第一场\n\n测试剧情。', characterMap: {} })
  expect(result.ok).toBe(true)
  const selected = [loaded.kit.shots[0], result.adaptedShots[0]]
  const json = JSON.stringify(selected)
  const parsed = JSON.parse(json)
  expect(parsed.length).toBe(2)
  expect(parsed.every((s) => typeof s.prompt === 'string' && s.prompt.length > 0)).toBe(true)
})

// @ts-check
'use strict'
/**
 * film-engineering stages 契约测试
 * 覆盖：4 阶段执行链 / checkpoint / 上下文传递 / 失败上报
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const { loadFilmKit } = require('./kit-loader')
const { registerFilmEngineeringStages, FILM_STAGE_TYPES } = require('./film-engineering-stages')

const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function makeKitDir () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-stages-test-'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'film-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    filmMeta: {
      title: 'Film Project Case',
      durationSec: 5706,
      logline: 'logline',
      characters: [{ name: 'ROKO', descriptor: 'd' }, { name: 'JAXX', descriptor: 'd' }, { name: 'LULU', descriptor: 'd' }, { name: 'REIN', descriptor: 'd' }],
    },
    scenes: [
      { id: 'cold-open', name: '1. COLD OPEN', count: 12, parentId: null, level: 0 },
      { id: 'scene-25', name: 'Scene 25', count: 10, parentId: null, level: 0 },
    ],
  }))
  fs.writeFileSync(path.join(dir, 'shot-library.json'), JSON.stringify([
    {
      shotId: '11111111-1111-4111-8111-111111111111',
      sceneId: 'cold-open',
      prompt: 'EXT. STREET\n[CHARACTER: ROKO] walks.\n\nGEO SPATIAL LAYOUT\nRoko center.',
      model: 'seedance_2_0',
      refTokens: [],
    },
    {
      shotId: '22222222-2222-4222-8222-222222222222',
      sceneId: 'scene-25',
      prompt: 'EXT. FACTORY\n[CHARACTER: JAXX] dodges.\n\nGEO SPATIAL LAYOUT\nJaxx right.',
      model: 'nano_banana_2',
      refTokens: [UUID_B],
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

/** 简易 PipelineEngine stub：支持 registerStageExecutor 与执行 */
function makeEngine () {
  const executors = new Map()
  const engine = {
    stageExecutor: {
      register (type, fn) { executors.set(type, fn) },
    },
    registerStageExecutor (type, fn) {
      this.stageExecutor.register(type, fn)
      return { success: true }
    },
    container: { get: () => null },
    log: { info () {}, warn () {}, error() {}, notify() {} },
    _executors: executors,
  }
  return engine
}

async function runStage (engine, type, input) {
  const fn = engine._executors.get(type)
  expect(fn, 'stage executor not registered: ' + type).toBeTruthy()
  return fn(input)
}

it('film-stages: 注册 4 个阶段', () => {
  const engine = makeEngine()
  const result = registerFilmEngineeringStages(engine)
  expect(result.success).toBe(true)
  expect(result.registered.sort()).toEqual([
    FILM_STAGE_TYPES.LOAD_TEMPLATE,
    FILM_STAGE_TYPES.ADAPT_SCRIPT,
    FILM_STAGE_TYPES.SELECT_SHOTS,
    FILM_STAGE_TYPES.EXPORT_PROMPTS,
  ].sort())
})

it('film-stages: load_template 加载 kit 并输出模板上下文', async () => {
  const engine = makeEngine()
  registerFilmEngineeringStages(engine)
  const result = await runStage(engine, FILM_STAGE_TYPES.LOAD_TEMPLATE, {
    params: { kitDir: makeKitDir() },
  })
  expect(result.success).toBe(true)
  expect(result.output.template).toBeTruthy()
  expect(result.output.template.shots.length >= 2).toBeTruthy()
  expect(result.output.template.manifest.filmMeta.title).toBeTruthy()
  expect(result.output.template.doctrine.blocks.length > 0).toBeTruthy()
})

it('film-stages: load_template 失败时 fail-closed', async () => {
  const engine = makeEngine()
  registerFilmEngineeringStages(engine)
  const result = await runStage(engine, FILM_STAGE_TYPES.LOAD_TEMPLATE, {
    params: { kitDir: path.join(os.tmpdir(), 'no-such-kit-' + Date.now()) },
  })
  expect(result.success).toBe(false)
  expect(result.error).toMatch(/kit|KIT/i)
})

it('film-stages: adapt_script 生成 adaptedShots', async () => {
  const engine = makeEngine()
  registerFilmEngineeringStages(engine)
  const loaded = await runStage(engine, FILM_STAGE_TYPES.LOAD_TEMPLATE, {
    params: { kitDir: makeKitDir() },
  })
  const result = await runStage(engine, FILM_STAGE_TYPES.ADAPT_SCRIPT, {
    context: { template: loaded.output.template },
    params: {
      script: '第一场 废墟\n\n小强独自走在废墟中。\n\n第二场 工厂\n\n阿杰躲在传送带下。',
      characterMap: { ROKO: '小强', JAXX: '阿杰' },
    },
  })
  expect(result.success).toBe(true)
  expect(Array.isArray(result.output.adaptedShots)).toBeTruthy()
  expect(result.output.adaptedShots.length >= 2).toBeTruthy()
  expect(typeof result.output.llmEnhanced).toBe('boolean')
})

it('film-stages: adapt_script 空剧本失败', async () => {
  const engine = makeEngine()
  registerFilmEngineeringStages(engine)
  const loaded = await runStage(engine, FILM_STAGE_TYPES.LOAD_TEMPLATE, {
    params: { kitDir: makeKitDir() },
  })
  const result = await runStage(engine, FILM_STAGE_TYPES.ADAPT_SCRIPT, {
    context: { template: loaded.output.template },
    params: { script: '', characterMap: {} },
  })
  expect(result.success).toBe(false)
  expect(result.error).toMatch(/剧本/)
})

it('film-stages: select_shots 过滤选中分镜（kit + adapt）', async () => {
  const engine = makeEngine()
  registerFilmEngineeringStages(engine)
  const loaded = await runStage(engine, FILM_STAGE_TYPES.LOAD_TEMPLATE, {
    params: { kitDir: makeKitDir() },
  })
  const adapted = await runStage(engine, FILM_STAGE_TYPES.ADAPT_SCRIPT, {
    context: { template: loaded.output.template },
    params: { script: '第一场 废墟\n\n小强走在废墟中。', characterMap: {} },
  })
  const result = await runStage(engine, FILM_STAGE_TYPES.SELECT_SHOTS, {
    context: { template: loaded.output.template, adaptedShots: adapted.output.adaptedShots },
    params: { selectedShotIds: ['11111111-1111-4111-8111-111111111111', 'adapt-001'] },
  })
  expect(result.success).toBe(true)
  expect(result.output.selectedShots.length).toBe(2)
})

it('film-stages: select_shots 未知 id 报错', async () => {
  const engine = makeEngine()
  registerFilmEngineeringStages(engine)
  const loaded = await runStage(engine, FILM_STAGE_TYPES.LOAD_TEMPLATE, {
    params: { kitDir: makeKitDir() },
  })
  const result = await runStage(engine, FILM_STAGE_TYPES.SELECT_SHOTS, {
    context: { template: loaded.output.template, adaptedShots: [] },
    params: { selectedShotIds: ['bogus-id'] },
  })
  expect(result.success).toBe(false)
  expect(result.error).toMatch(/bogus-id/)
})

it('film-stages: export_prompts 生成 JSON/Markdown', async () => {
  const engine = makeEngine()
  registerFilmEngineeringStages(engine)
  const loaded = await runStage(engine, FILM_STAGE_TYPES.LOAD_TEMPLATE, {
    params: { kitDir: makeKitDir() },
  })
  const selected = await runStage(engine, FILM_STAGE_TYPES.SELECT_SHOTS, {
    context: { template: loaded.output.template, adaptedShots: [] },
    params: { selectedShotIds: ['11111111-1111-4111-8111-111111111111'] },
  })
  const result = await runStage(engine, FILM_STAGE_TYPES.EXPORT_PROMPTS, {
    context: { template: loaded.output.template, selectedShots: selected.output.selectedShots },
    params: { format: 'json' },
  })
  expect(result.success).toBe(true)
  expect(result.output.export).toBeTruthy()
  const parsed = JSON.parse(result.output.export.json)
  expect(Array.isArray(parsed)).toBeTruthy()
  expect(parsed.length).toBe(1)
  expect(result.output.export.markdown).toMatch(/GEO SPATIAL LAYOUT/)
})

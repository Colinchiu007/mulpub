// @ts-check
'use strict'
/**
 * script-adapt 契约测试
 * 覆盖：分场正确性 / 模板映射 / 角色绑定 / 超长拒绝 / LLM 不可用降级
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const { loadFilmKit } = require('./kit-loader')
const { ScriptAdapter, splitScript, buildTemplatePrompt, MAX_SCRIPT_LENGTH } = require('./script-adapt')

const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function makeKitData () {
  return {
    manifest: {
      schemaVersion: 1,
      filmMeta: {
        title: 'Film Project Case',
        durationSec: 5706,
        logline: 'logline',
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
        sceneId: 'cold-open',
        prompt: [
          'EXT. CITY STREET - NIGHT',
          '[CHARACTER: ROKO] Roko walks through the ruins.',
          '',
          'GEO SPATIAL LAYOUT',
          'Roko center frame, ruins around.',
          '',
          'ACTION TIMING',
          '0-4s: slow walk.',
          '',
          'AUDIO',
          'Wind.',
          '',
          'CHARACTER ACTING',
          'Tired but defiant.',
          '',
          'POSITIVE CONSTRAINTS',
          'Cinematic lighting.',
        ].join('\n'),
        model: 'seedance_2_0',
        refTokens: [],
      },
      {
        shotId: '22222222-2222-4222-8222-222222222222',
        sceneId: 'scene-25',
        prompt: [
          'EXT. FACTORY - NIGHT',
          '[CHARACTER: JAXX] Jaxx dodges a robot arm.',
          '',
          'GEO SPATIAL LAYOUT',
          'Jaxx right third, robot arm left.',
          '',
          'POSITIVE CONSTRAINTS',
          'High contrast.',
        ].join('\n'),
        model: 'nano_banana_2',
        refTokens: [UUID_B],
      },
    ],
    references: {
      [UUID_B]: { kind: 'character', name: 'JAXX', imageUrls: ['https://cdn.example.com/jaxx.png'] },
    },
    doctrine: {
      blocks: [{ key: 'geo', label: 'GEO SPATIAL LAYOUT', zh: '布局', en: 'Layout' }],
      rules: [{ key: 'r1', title: 'rule', zh: '法则', en: 'Rule' }],
      glossary: [],
    },
  }
}

function makeAdapter (llm) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-adapt-test-'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'film-manifest.json'), JSON.stringify(makeKitData().manifest))
  fs.writeFileSync(path.join(dir, 'shot-library.json'), JSON.stringify(makeKitData().shots))
  fs.writeFileSync(path.join(dir, 'reference-registry.json'), JSON.stringify(makeKitData().references))
  fs.writeFileSync(path.join(dir, 'prompt-doctrine.json'), JSON.stringify(makeKitData().doctrine))
  const loaded = loadFilmKit({ kitDir: dir })
  expect(loaded.ok).toBe(true)
  return new ScriptAdapter({ kit: loaded.kit, llm: llm || null })
}

const SCRIPT = [
  '第一场 城市废墟',
  '',
  'ROKO 独自走在废墟中，拳头发出红光。',
  '远处传来机器人的脚步声，他握紧拳头。',
  '',
  '第二场 工厂对峙',
  '',
  'JAXX 躲在传送带下，机械臂擦着他的头顶扫过。',
  '他翻滚到墙角，寻找反击的机会。',
].join('\n')

it('script-adapt: 分场正确（空行分段）', () => {
  const beats = splitScript(SCRIPT)
  expect(beats.length >= 2).toBeTruthy()
  expect(beats[0].text.includes('废墟')).toBeTruthy()
  expect(beats[1].text.includes('传送带')).toBeTruthy()
})

it('script-adapt: 空剧本拒绝', async () => {
  const adapter = makeAdapter()
  const result = await adapter.adaptScript({ script: '   ', characterMap: {} })
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/剧本/)
})

it('script-adapt: 超长剧本拒绝', async () => {
  const adapter = makeAdapter()
  const result = await adapter.adaptScript({ script: 'x'.repeat(MAX_SCRIPT_LENGTH + 1), characterMap: {} })
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/10000/)
})

it('script-adapt: 非法角色映射拒绝', async () => {
  const adapter = makeAdapter()
  const result = await adapter.adaptScript({ script: SCRIPT, characterMap: { A: '1', B: '2', C: '3', D: '4', E: '5', F: '6', G: '7', H: '8', I: '9', J: '10', K: '11' } })
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/10/)
  const emptyVal = await adapter.adaptScript({ script: SCRIPT, characterMap: { ROKO: '  ' } })
  expect(emptyVal.ok).toBe(false)
})

it('script-adapt: 正常套用生成同构分镜', async () => {
  const adapter = makeAdapter()
  const result = await adapter.adaptScript({
    script: SCRIPT,
    characterMap: { ROKO: '小强', JAXX: '阿杰' },
  })
  expect(result.ok).toBe(true)
  expect(Array.isArray(result.adaptedShots)).toBeTruthy()
  expect(result.adaptedShots.length >= 2).toBeTruthy()
  for (const shot of result.adaptedShots) {
    expect(typeof shot.shotId).toBe('string')
    expect(shot.shotId.startsWith('adapt-')).toBeTruthy()
    expect(typeof shot.sceneId).toBe('string')
    expect(typeof shot.prompt).toBe('string')
    expect(shot.prompt.length > 0).toBeTruthy()
    expect(typeof shot.model).toBe('string')
    expect(Array.isArray(shot.refTokens)).toBeTruthy()
    expect(typeof shot.llmEnhanced === 'boolean').toBeTruthy()
    // 剧情来自用户剧本
    expect(shot.prompt).toMatch(/废墟|传送带|红光|机械臂/)
    // 方法复刻：模板结构保留
    expect(shot.prompt).toMatch(/GEO SPATIAL LAYOUT/)
  }
})

it('script-adapt: 角色绑定注入', async () => {
  const adapter = makeAdapter()
  const result = await adapter.adaptScript({
    script: SCRIPT,
    characterMap: { ROKO: '小强', JAXX: '阿杰' },
  })
  expect(result.ok).toBe(true)
  const first = result.adaptedShots[0]
  expect(first.roleBindings).toBeTruthy()
  expect(first.roleBindings.ROKO).toBe('小强')
})

it('script-adapt: LLM 可用时润色并标记', async () => {
  const llm = {
    enhance: async ({ draftPrompt }) => 'POLISHED: ' + draftPrompt,
  }
  const adapter = makeAdapter(llm)
  const result = await adapter.adaptScript({
    script: SCRIPT,
    characterMap: {},
    llmEnabled: true,
  })
  expect(result.ok).toBe(true)
  expect(result.llmEnhanced).toBe(true)
  expect(result.adaptedShots[0].prompt.startsWith('POLISHED:')).toBeTruthy()
})

it('script-adapt: LLM 不可用降级（不阻塞）', async () => {
  const llm = {
    enhance: async () => { throw new Error('LLM down') },
  }
  const adapter = makeAdapter(llm)
  const result = await adapter.adaptScript({
    script: SCRIPT,
    characterMap: {},
    llmEnabled: true,
  })
  expect(result.ok).toBe(true)
  expect(result.llmEnhanced).toBe(false)
  expect(result.adaptedShots[0].prompt.length > 0).toBeTruthy()
  expect(result.adaptedShots[0].prompt).toMatch(/GEO SPATIAL LAYOUT/)
})

it('script-adapt: 无 LLM 时本地模板结果并标记 llmEnhanced=false', async () => {
  const adapter = makeAdapter()
  const result = await adapter.adaptScript({
    script: SCRIPT,
    characterMap: {},
    llmEnabled: true,
  })
  expect(result.ok).toBe(true)
  expect(result.llmEnhanced).toBe(false)
})

it('script-adapt: buildTemplatePrompt 复用模板结构', () => {
  const template = makeKitData().shots[0]
  const prompt = buildTemplatePrompt({
    template,
    beatText: '小强在雨中奔跑。',
    characterMap: { ROKO: '小强' },
  })
  expect(prompt).toMatch(/小强在雨中奔跑/)
  expect(prompt).toMatch(/GEO SPATIAL LAYOUT/)
  expect(prompt).toMatch(/Roko center frame/)
  expect(prompt).toMatch(/\[CHARACTER: ROKO\]/)
})

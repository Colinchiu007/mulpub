// @ts-check
'use strict'
/**
 * auto-plan 契约测试（openspec change: film-auto-mode，design D8/D10/D11/D26）
 *
 * 覆盖：
 *  - 时长规划：N = clamp(round(T/s), 1, 120) 的边界与非法输入
 *  - 分场与句级拆分（**只拆**）与相邻合并（**只并**）：不丢字
 *  - 角色检出：用户标注优先 > 显式标记 > 对话动词 > 频次；停用词不误判；空检出占位
 *  - 槽位映射：按频次降序填 ROKO/JAXX/LULU/REIN
 *  - 参考绑定：命中才注入、场景按场景轮转共享、单镜 ≤2 张、越界拒绝、provider 不支持→W1
 *  - 主入口 planAutoShots：镜数/字段/提示词块结构/错误码/警告 W1/W3/W4/W5
 *  - 指纹与哈希（D26）：shot 指纹、payload 哈希、planId 参与位
 * 全部为纯函数测试，零 IO（auto-project 的落盘测试另见 auto-project.test.js）。
 */
const {
  MAX_AUTO_SHOTS, MAX_AUTO_SCRIPT_LENGTH, MIN_AUTO_DURATION_SEC, MAX_AUTO_DURATION_SEC,
  AUTO_ASPECTS, AUTO_SHOT_SECONDS,
  planShotCount, validateAutoInputs,
  splitAutoBeats, expandBeatsToCount, mergeBeatsToCount,
  detectCharacters, buildCharacterMap,
  bindReferencePaths, buildReferenceWarnings,
  buildShotFingerprint, buildPayloadHash, buildPlanId,
  planAutoShots,
} = require('./auto-plan')
const { buildShotTaskPrompt, REASON_BY_DESIGN } = require('./shot-prompt-task')

const MEDIA_ROOT = require('path').join(require('os').tmpdir(), 'film-engineering')
const refPath = (n) => require('path').join(MEDIA_ROOT, 'references', 'ref-' + n + '.png')

/** 合成模板分镜：含七大块中的五个（与 kit 真实提示词同构的关键块标题） */
function templateShot (i) {
  return {
    shotId: 'tpl-' + i,
    sceneId: 'scene-' + i,
    prompt: [
      'INT. STREET - NIGHT',
      '',
      'EXACT 2 CHARACTERS — NO DUPLICATES',
      'The street is wet.',
      '[CHARACTER: ROKO] Determined street kid; crystal arm.',
      '',
      'GEO SPATIAL LAYOUT',
      'Alley on the left, museum on the right. Camera at eye level.',
      '',
      'ACTION TIMING',
      '0.0-2.0s: ROKO steps forward.',
      '',
      'AUDIO',
      'Rain ambience. ROKO (London street voice): "Move."',
      '',
      'CHARACTER ACTING',
      'Roko: tense, wants the coordinates, hides fear.',
      '',
      'POSITIVE CONSTRAINTS',
      '8K detail, no flicker.',
    ].join('\n'),
    model: 'seedance_2_0',
    refTokens: ['3caa2f3a-52b5-4293-9237-0c8f76c7158a'],
  }
}
const TEMPLATES = [templateShot(0), templateShot(1), templateShot(2)]

describe('auto-plan · 时长规划', () => {
  it('N = clamp(round(T/s), 1, 120)', () => {
    expect(planShotCount(60, 5)).toBe(12)
    expect(planShotCount(120, 5)).toBe(24)
    expect(planShotCount(600, 10)).toBe(60)
    expect(planShotCount(600, 5)).toBe(MAX_AUTO_SHOTS)
    expect(planShotCount(10, 10)).toBe(1)
  })

  it('四舍五入边界', () => {
    expect(planShotCount(7, 5)).toBe(1)   // 1.4
    expect(planShotCount(8, 5)).toBe(2)   // 1.6
    expect(planShotCount(12, 5)).toBe(2)  // 2.4
  })

  it('非法输入回落到 1（fail-closed，不抛）', () => {
    expect(planShotCount(NaN, 5)).toBe(1)
    expect(planShotCount(60, 0)).toBe(1)
    expect(planShotCount(60, -5)).toBe(1)
    expect(planShotCount(undefined, undefined)).toBe(1)
  })

  it('常量与输入域一致：模板/上限/枚举', () => {
    expect(MAX_AUTO_SCRIPT_LENGTH).toBe(10000)
    expect(MIN_AUTO_DURATION_SEC).toBe(10)
    expect(MAX_AUTO_DURATION_SEC).toBe(600)
    expect(AUTO_ASPECTS).toEqual(['16x9', '9x16'])
    expect(AUTO_SHOT_SECONDS).toEqual([5, 8, 10])
    // 上界一致性：round(600/5) 恰好等于 MAX_AUTO_SHOTS（避免上限成为死码）
    expect(planShotCount(MAX_AUTO_DURATION_SEC, 5)).toBe(MAX_AUTO_SHOTS)
  })
})

describe('auto-plan · 输入校验', () => {
  const base = { script: '第一场\n他推开门。', characterRefs: [], sceneRefs: [], aspect: '16x9', seconds: 5, targetDurationSec: 60 }

  it('空/空白剧本 → AUTO_SCRIPT_EMPTY', () => {
    expect(validateAutoInputs({ ...base, script: '   \n  ' }).errorCode).toBe('AUTO_SCRIPT_EMPTY')
  })

  it('超长剧本 → AUTO_SCRIPT_TOO_LONG', () => {
    expect(validateAutoInputs({ ...base, script: 'x'.repeat(10001) }).errorCode).toBe('AUTO_SCRIPT_TOO_LONG')
  })

  it('画幅/单镜秒数/时长越界 → AUTO_BAD_PARAM', () => {
    expect(validateAutoInputs({ ...base, aspect: 'source' }).errorCode).toBe('AUTO_BAD_PARAM')
    expect(validateAutoInputs({ ...base, seconds: 7 }).errorCode).toBe('AUTO_BAD_PARAM')
    expect(validateAutoInputs({ ...base, targetDurationSec: 9 }).errorCode).toBe('AUTO_BAD_PARAM')
    expect(validateAutoInputs({ ...base, targetDurationSec: 601 }).errorCode).toBe('AUTO_BAD_PARAM')
    expect(validateAutoInputs({ ...base, targetDurationSec: 60.5 }).errorCode).toBe('AUTO_BAD_PARAM')
  })

  it('参考图超上限或形状非法 → AUTO_BAD_PARAM', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: 'c' + i, path: refPath(i) }))
    expect(validateAutoInputs({ ...base, characterRefs: many }).errorCode).toBe('AUTO_BAD_PARAM')
    expect(validateAutoInputs({ ...base, characterRefs: [{ name: '', path: refPath(1) }] }).errorCode).toBe('AUTO_BAD_PARAM')
    expect(validateAutoInputs({ ...base, sceneRefs: ['not-absolute.png'] }).errorCode).toBe('AUTO_BAD_PARAM')
  })

  it('合法输入通过', () => {
    expect(validateAutoInputs(base).ok).toBe(true)
  })
})

describe('auto-plan · 分场与拆分（只拆）', () => {
  it('空行分段；第X场/SCENE/INT./EXT. 标题行并入下一段', () => {
    const beats = splitAutoBeats('第1场\n他推开门。\n\nSCENE 2\n灯灭了。')
    expect(beats).toHaveLength(2)
    expect(beats[0].title).toBe('第1场')
    expect(beats[0].text).toContain('他推开门')
    expect(beats[1].title).toBe('SCENE 2')
  })

  it('无空行的长段落 → 句级拆分补齐到目标数且不丢字', () => {
    const script = '他推开门。走廊很长！灯灭了？他停下。'
    const beats0 = splitAutoBeats(script)
    expect(beats0).toHaveLength(1)
    const beats = expandBeatsToCount(beats0, 4)
    expect(beats.length).toBe(4)
    const joined = beats.map((b) => b.text).join('')
    expect(joined.replace(/\s/g, '')).toBe(script.replace(/\s/g, ''))
  })

  it('拆分不可达目标数时如实返回（不造空镜）', () => {
    const beats = expandBeatsToCount(splitAutoBeats('只有一句话。'), 5)
    expect(beats.length).toBe(1)
  })

  it('expandBeatsToCount 只增不减（已达标时原样返回）', () => {
    const beats = splitAutoBeats('A场景\n一。\n\nB场景\n二。')
    expect(expandBeatsToCount(beats, 2)).toHaveLength(2)
  })
})

describe('auto-plan · 合并（只并）', () => {
  it('段落多于目标数 → 相邻合并且不丢字', () => {
    const script = Array.from({ length: 6 }, (_, i) => '第' + (i + 1) + '场\n剧情' + (i + 1) + '。').join('\n\n')
    const beats = splitAutoBeats(script)
    expect(beats).toHaveLength(6)
    const merged = mergeBeatsToCount(beats, 2)
    expect(merged).toHaveLength(2)
    const joined = merged.map((b) => b.text).join('')
    for (let i = 1; i <= 6; i++) expect(joined).toContain('剧情' + i)
  })

  it('已达标或少于目标数时原样返回（不复制内容）', () => {
    const beats = splitAutoBeats('A\n一。\n\nB\n二。')
    expect(mergeBeatsToCount(beats, 5)).toHaveLength(2)
    expect(mergeBeatsToCount(beats, 2)).toHaveLength(2)
  })
})

describe('auto-plan · 角色检出与映射', () => {
  it('用户标注优先（source=labeled）', () => {
    const r = detectCharacters({ script: '小强说道：“走。”', labeledRefs: [{ name: '小强', path: refPath(1) }] })
    expect(r.characters[0]).toMatchObject({ name: '小强', source: 'labeled' })
  })

  it('显式标记【角色：X】可检出', () => {
    const r = detectCharacters({ script: '【角色：阿明】他转身离开。' })
    expect(r.characters.map((c) => c.name)).toContain('阿明')
  })

  it('对话动词前名词可检出', () => {
    const r = detectCharacters({ script: '小强说道：“走。”\n小强又问了一次。' })
    expect(r.characters.map((c) => c.name)).toContain('小强')
  })

  it('频次 <2 且无其他证据的候选不入选', () => {
    const r = detectCharacters({ script: '天空中飞过一只鸟。' })
    expect(r.characters).toHaveLength(0)
  })

  it('停用词/常见词不误判为角色', () => {
    const r = detectCharacters({ script: '他们说道。然后他们又说道。这个说道。那个说道。' })
    expect(r.characters.map((c) => c.name)).not.toContain('他们')
    expect(r.characters.map((c) => c.name)).not.toContain('这个')
    expect(r.characters.map((c) => c.name)).not.toContain('那个')
  })

  it('空检出时给出占位与 W4 警告', () => {
    const r = detectCharacters({ script: '没有角色的一段描述性文字。' })
    expect(r.characters).toHaveLength(0)
    expect(r.warnings.map((w) => w.code)).toContain('W4')
  })

  it('槽位映射按频次降序填 ROKO/JAXX/LULU/REIN（不足则只填前 K）', () => {
    const map1 = buildCharacterMap([{ name: '小强', count: 3 }])
    expect(map1).toEqual({ ROKO: '小强' })
    const map4 = buildCharacterMap([
      { name: 'A', count: 9 }, { name: 'B', count: 5 }, { name: 'C', count: 3 }, { name: 'D', count: 1 },
    ])
    expect(map4).toEqual({ ROKO: 'A', JAXX: 'B', LULU: 'C', REIN: 'D' })
  })
})

describe('auto-plan · 参考图绑定', () => {
  const beats = [
    { index: 1, title: '第1场', text: '小强推开门。' },
    { index: 2, title: '第1场', text: '他抬头看灯。' },
    { index: 3, title: '第2场', text: '阿明说道：“走。”' },
  ]

  it('命中角色名才注入该角色图', () => {
    const bound = bindReferencePaths({
      beats,
      characterRefs: [{ name: '小强', path: refPath('a') }, { name: '阿明', path: refPath('b') }],
      sceneRefs: [],
    })
    expect(bound[0].refPaths).toEqual([refPath('a')])
    expect(bound[1].refPaths).toEqual([])
    expect(bound[2].refPaths).toEqual([refPath('b')])
  })

  it('场景图按场景轮转且同场景共享同一张', () => {
    const bound = bindReferencePaths({
      beats,
      characterRefs: [],
      sceneRefs: [refPath('s1'), refPath('s2')],
    })
    // 第1场的两镜共享 s1；第2场用 s2
    expect(bound[0].refPaths).toEqual([refPath('s1')])
    expect(bound[1].refPaths).toEqual([refPath('s1')])
    expect(bound[2].refPaths).toEqual([refPath('s2')])
  })

  it('单镜注入 ≤2 张且同图不重复', () => {
    const bound = bindReferencePaths({
      beats: [{ index: 1, title: 'T', text: '小强与阿明同行。' }],
      characterRefs: [{ name: '小强', path: refPath('a') }, { name: '阿明', path: refPath('a') }],
      sceneRefs: [refPath('s1')],
    })
    expect(bound[0].refPaths).toHaveLength(2)
    expect(new Set(bound[0].refPaths).size).toBe(2)
  })

  it('越界路径被拒绝且不进入 refPaths', () => {
    const bound = bindReferencePaths({
      beats: [{ index: 1, title: 'T', text: '小强。' }],
      characterRefs: [{ name: '小强', path: 'C:/evil/secret.png' }],
      sceneRefs: ['C:/evil/scene.png'],
      mediaRoot: MEDIA_ROOT,
    })
    expect(bound[0].refPaths).toEqual([])
    expect(bound[0].warnings.map((w) => w.reason)).toContain('outside-media-root')
  })

  it('provider 不在参考能力表 → W1 警告（不阻断）', () => {
    const w = buildReferenceWarnings({ providerId: 'seedance', shotsWithReferences: 3 })
    expect(w.map((x) => x.code)).toContain('W1')
    const w2 = buildReferenceWarnings({ providerId: 'minimax', shotsWithReferences: 3 })
    expect(w2.map((x) => x.code)).not.toContain('W1')
    const w3 = buildReferenceWarnings({ providerId: 'seedance', shotsWithReferences: 0 })
    expect(w3.map((x) => x.code)).not.toContain('W1')
  })
})

describe('auto-plan · 指纹与哈希（D26）', () => {
  const shots = [
    { shotId: 'auto-000', prompt: 'P0', seconds: 5, refPaths: [refPath('a')] },
    { shotId: 'auto-001', prompt: 'P1', seconds: 5, refPaths: [] },
  ]

  it('shot 指纹稳定；改 prompt 或顺序即变化', () => {
    const a = buildShotFingerprint(shots)
    expect(buildShotFingerprint(shots)).toBe(a)
    const changed = [{ ...shots[0], prompt: 'P0x' }, shots[1]]
    expect(buildShotFingerprint(changed)).not.toBe(a)
    expect(buildShotFingerprint([shots[1], shots[0]])).not.toBe(a)
  })

  it('payload 哈希纳入 aspect/seconds/providerId', () => {
    const base = buildPayloadHash({ shots, aspect: '16x9', seconds: 5, providerId: 'minimax' })
    expect(buildPayloadHash({ shots, aspect: '16x9', seconds: 5, providerId: 'minimax' })).toBe(base)
    expect(buildPayloadHash({ shots, aspect: '9x16', seconds: 5, providerId: 'minimax' })).not.toBe(base)
    expect(buildPayloadHash({ shots, aspect: '16x9', seconds: 8, providerId: 'minimax' })).not.toBe(base)
    expect(buildPayloadHash({ shots, aspect: '16x9', seconds: 5, providerId: 'agnes-video' })).not.toBe(base)
  })

  it('planId 参与位：taskId/scriptHash/refs/时长方位/provider 任一变化即变化', () => {
    const base = { taskId: 'auto-1', scriptHash: 'h1', refsFingerprint: 'r1', aspect: '16x9', seconds: 5, targetDurationSec: 60, providerId: 'minimax' }
    const id = buildPlanId(base)
    expect(id.startsWith('plan-')).toBe(true)
    expect(buildPlanId(base)).toBe(id)
    expect(buildPlanId({ ...base, taskId: 'auto-2' })).not.toBe(id)
    expect(buildPlanId({ ...base, scriptHash: 'h2' })).not.toBe(id)
    expect(buildPlanId({ ...base, refsFingerprint: 'r2' })).not.toBe(id)
    expect(buildPlanId({ ...base, aspect: '9x16' })).not.toBe(id)
    expect(buildPlanId({ ...base, seconds: 8 })).not.toBe(id)
    expect(buildPlanId({ ...base, targetDurationSec: 90 })).not.toBe(id)
    expect(buildPlanId({ ...base, providerId: 'agnes-video' })).not.toBe(id)
  })
})

/** 生成 n 个带标题的段落（主入口用例需要足量分镜；实现按设计"不凭空造镜"） */
function scriptWithBeats (n, texts = ['小强推开门。', '阿明说道：“走。”']) {
  return Array.from({ length: n }, (_, i) => '第' + (i + 1) + '场\n' + texts[i % texts.length]).join('\n\n')
}

describe('auto-plan · 主入口 planAutoShots', () => {
  const baseArgs = {
    script: scriptWithBeats(12),
    characterRefs: [{ name: '小强', path: refPath('a') }, { name: '阿明', path: refPath('b') }],
    sceneRefs: [],
    aspect: '16x9',
    seconds: 5,
    targetDurationSec: 20,
    templateShots: TEMPLATES,
    providerId: 'minimax',
  }

  it('产出 N 镜、字段齐备、提示词复用模板块结构', () => {
    const r = planAutoShots(baseArgs)
    expect(r.ok).toBe(true)
    expect(r.shots).toHaveLength(4) // round(20/5)
    expect(r.plannedDurationSec).toBe(20)
    const s0 = r.shots[0]
    expect(s0.shotId).toBe('auto-000')
    expect(s0.seconds).toBe(5)
    expect(typeof s0.prompt).toBe('string')
    expect(s0.prompt).toContain('GEO SPATIAL LAYOUT')
    expect(s0.prompt).toContain('ACTION TIMING')
    expect(s0.prompt).toContain('[CHARACTER: ROKO]')
    expect(s0.prompt).toContain('（小强）')
  })

  it('角色映射按检出结果填入槽位', () => {
    const r = planAutoShots(baseArgs)
    expect(Object.keys(r.characterMap).length).toBe(2)
    expect(Object.values(r.characterMap)).toEqual(expect.arrayContaining(['小强', '阿明']))
  })

  it('镜头数与实际时长如实反映目标差异（W3）', () => {
    const r = planAutoShots({ ...baseArgs, targetDurationSec: 22, seconds: 5 }) // N=4 → 20s ≠ 22s
    expect(r.plannedDurationSec).toBe(20)
    expect(r.warnings.map((w) => w.code)).toContain('W3')
  })

  it('镜数 >10 给出 W2（将自动分批）', () => {
    const r = planAutoShots({ ...baseArgs, targetDurationSec: 60, seconds: 5 })
    expect(r.shots.length).toBe(12)
    expect(r.warnings.map((w) => w.code)).toContain('W2')
  })

  it('墙钟预估 >2 小时给出 W5', () => {
    // 60 镜 × 300s = 5h；需要足量段落（不凭空造镜）
    const r = planAutoShots({ ...baseArgs, script: scriptWithBeats(60), targetDurationSec: 300, seconds: 5 })
    expect(r.shots.length).toBe(60)
    expect(r.warnings.map((w) => w.code)).toContain('W5')
  })

  it('provider 不支持参考图时给出 W1', () => {
    const r = planAutoShots({ ...baseArgs, providerId: 'seedance' })
    expect(r.warnings.map((w) => w.code)).toContain('W1')
  })

  it('无参考图时纯文本出片且无参考类警告', () => {
    const r = planAutoShots({ ...baseArgs, characterRefs: [], sceneRefs: [] })
    expect(r.ok).toBe(true)
    expect(r.shots.every((s) => s.refPaths.length === 0)).toBe(true)
    expect(r.warnings.map((w) => w.code)).not.toContain('W1')
  })

  it('预估载荷：批数/磁盘/墙钟口径与既有常量一致', () => {
    const r = planAutoShots({ ...baseArgs, targetDurationSec: 60, seconds: 5 })
    expect(r.estimates.batchCount).toBe(2)          // 12 镜 → 2 批（每批 10）
    expect(r.estimates.diskEstimateBytes).toBe(12 * 8 * 1024 * 1024)
    expect(r.estimates.wallclockEstimateSeconds).toBe(12 * 300)
  })

  it('非法输入直接 fail-closed 且不产出 shots', () => {
    const r = planAutoShots({ ...baseArgs, script: '' })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('AUTO_SCRIPT_EMPTY')
    expect(r.shots).toBeUndefined()
  })

  it('模板为空时 fail-closed（AUTO_NO_TEMPLATES）', () => {
    const r = planAutoShots({ ...baseArgs, templateShots: [] })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('AUTO_NO_TEMPLATES')
  })

  it('maxShots 覆盖可触发 AUTO_TOO_MANY_SHOTS 兜底分支', () => {
    const r = planAutoShots({ ...baseArgs, targetDurationSec: 60, seconds: 5, maxShots: 10 })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('AUTO_TOO_MANY_SHOTS')
  })

  it('产出 shots 可用于指纹与哈希（确定性）', () => {
    const a = planAutoShots(baseArgs)
    const b = planAutoShots(baseArgs)
    expect(buildShotFingerprint(a.shots)).toBe(buildShotFingerprint(b.shots))
  })

  it('整篇只有场景标题行 → 空文案分镜给出 W7（不阻断，但必须可见）', () => {
    // 单行 'INT.' 会被 splitScript 当成标题行，产出一段 text:''——该镜提示词不含用户文案，
    // 而确认卡只显示字数，用户看不出差异，故规划层必须显式提示。
    const r = planAutoShots({ ...baseArgs, script: 'INT.' })
    const w7 = r.warnings.find((w) => w.code === 'W7')
    expect(w7).toBeTruthy()
    expect(w7.message).toContain('#1')
    // 仍照常产出分镜（非阻断）
    expect(r.shots.length).toBeGreaterThanOrEqual(1)
  })

  it('正常剧本不产生 W7', () => {
    const r = planAutoShots(baseArgs)
    expect(r.warnings.map((w) => w.code)).not.toContain('W7')
  })
})


describe('F-I · auto-plan · 方法论接线（plan 级 + 逐镜）', () => {
  const USER_TPL = [
    '## 分镜记录',
    '{{shot_json}}',
    '- 色盘：{{palette_line}}',
    '- 风格前缀：{{style_prefix}}',
    '- 本场 GEO 平面图：{{geo_block}}',
    '- 角色：{{character_descriptors}}',
    '- 时长：{{duration_sec}}',
    '- 模型：{{model}}',
  ].join('\n')
  const SYSTEM_TPL = '你是 AI 视频提示词工程师。'

  function kitCtx (opts) {
    const o = opts || {}
    const task = { zh: { system: SYSTEM_TPL, user: USER_TPL } }
    if (o.noLibrary !== true) task.en = { system: SYSTEM_TPL, user: USER_TPL }
    return {
      doctrine: o.noDoctrine === true ? null : {
        blocks: [
          { key: 'style', label: 'STYLE', zh: 'z', en: 'e' },
          { key: 'frame_constraint', label: 'FIRST / LAST FRAME CONSTRAINT', zh: '尾帧必须是可继续的稳定姿态。', en: 'tail' },
        ],
        rules: [{ key: 'r', title: 't', zh: 'z', en: 'e' }],
        glossary: [{ term: 'g', zh: 'z', en: 'e' }],
      },
      palette: o.noPalette === true ? null : { paletteLine: { zh: '色盘：夜色近黑。', en: 'Palette: night.' } },
      promptLibrary: o.noLibrary === true ? null : { root: '/x', tasks: { generate_shot_prompt: task }, taskNames: ['generate_shot_prompt'] },
      manifest: { filmMeta: { characters: [{ name: 'ROKO', descriptor: 'Determined street kid.' }] } },
    }
  }

  function planArgs (extra) {
    return Object.assign({
      script: '一场\n小强推开门。',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 10,
      templateShots: [templateShot(0)],
      providerId: 'minimax',
    }, extra || {})
  }

  it('传 kit ⇒ plan 级有 promptContext，逐镜有 promptVars / promptMissing / promptRenderHash', () => {
    const r = planAutoShots(planArgs({ kit: kitCtx() }))
    expect(r.ok).toBe(true)
    expect(r.promptContext).toBeTruthy()
    expect(r.promptContext.taskId).toBe('generate_shot_prompt')
    expect(r.promptContext.promptAssetHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.promptContext.frameConstraint.available).toBe(true)
    // 尾帧约束**只留哈希与长度**，不留原文（design D22）
    expect(r.promptContext.frameConstraint.text).toBeUndefined()
    expect(r.promptContext.frameConstraint.length).toBeGreaterThan(0)
    expect(r.promptContext.assetsIncomplete).toBe(false)
    const s = r.shots[0]
    expect(s.promptVars).toBeTruthy()
    expect(Array.isArray(s.promptMissing)).toBe(true)
    expect(s.promptRenderHash).toMatch(/^[0-9a-f]{64}$/)
    // 逐镜 endFramePrompt 仍为空（不逐镜派生）
    expect(s.endFramePrompt).toBe('')
  })

  it('缺 doctrine ⇒ W10 且 assetsIncomplete', () => {
    const r = planAutoShots(planArgs({ kit: kitCtx({ noDoctrine: true }) }))
    expect(r.ok).toBe(true)
    expect(r.warnings.some(w => w.code === 'W10')).toBe(true)
    expect(r.promptContext.assetsIncomplete).toBe(true)
    expect(r.promptContext.frameConstraint.available).toBe(false)
  })

  it('缺 promptLibrary ⇒ W11 且 assetsIncomplete', () => {
    const r = planAutoShots(planArgs({ kit: kitCtx({ noLibrary: true }) }))
    expect(r.ok).toBe(true)
    expect(r.warnings.some(w => w.code === 'W11')).toBe(true)
    expect(r.promptContext.assetsIncomplete).toBe(true)
  })

  it('不传 kit ⇒ 既有字段逐字不变，且不产出任何方法论字段', () => {
    const base = planAutoShots(planArgs())
    const withKit = planAutoShots(planArgs({ kit: kitCtx() }))
    expect(base.ok).toBe(true)
    expect(base.promptContext).toBeNull()
    expect(base.shots[0].promptVars).toBeUndefined()
    expect(base.shots[0].promptMissing).toBeUndefined()
    // 第 16 轮 i4：**无 kit 时逐镜也不写** `promptRenderHash`（否则 ⑨「三分字段逐字不变」不可判）
    expect(base.shots[0].promptRenderHash).toBeUndefined()
    // 既有字段（prompt / 三分）逐字不变
    expect(base.shots[0].prompt).toBe(withKit.shots[0].prompt)
    expect(base.shots[0].imagePrompt).toBe(withKit.shots[0].imagePrompt)
    expect(base.shots[0].videoPrompt).toBe(withKit.shots[0].videoPrompt)
    expect(base.shots[0].endFramePrompt).toBe(withKit.shots[0].endFramePrompt)
  })

  /**
   * 第 8 轮 i7（Warning / feasibility）：①b「生产路径」原先**只存在于简报里**，
   * 没有任何测试实现它；而真实 kit 巡检在 CI 上全部 SKIP
   * ⇒ **真实资产面在流水线上零信号**（与 AGENTS.md 反对的「装饰性门禁」同型）。
   *
   * 这条用**合成夹具**实现同一语义（不依赖 film-kit）⇒ **CI 恒跑**；
   * 真实 kit 巡检保持本地/手工门禁（只打印读数）。
   */
  it('生产路径：style_prefix 恒 byDesign ⇒ 进清单 + deliverable=false（**合成夹具，CI 恒跑**）', () => {
    const kit = kitCtx()
    const r = planAutoShots(planArgs({ kit }))
    expect(r.ok).toBe(true)
    const s = r.shots[0]
    const miss = Array.isArray(s.promptMissing) ? s.promptMissing : []
    const sp = miss.find(m => m.name === 'style_prefix')
    expect(sp).toBeTruthy()
    expect(sp.reason).toBe(REASON_BY_DESIGN)

    // 用**同一份合成库**重渲染 ⇒ 必须拦住直送，且占位符原样保留
    const rendered = buildShotTaskPrompt({
      library: kit.promptLibrary,
      vars: s.promptVars,
      missing: miss,
      locale: 'zh',
    })
    expect(rendered.ok).toBe(true)
    expect(rendered.deliverable).toBe(false)
    expect(rendered.blockedVars.some(m => m.name === 'style_prefix' && m.reason === REASON_BY_DESIGN)).toBe(true)
    expect(rendered.renderText).toContain('{{style_prefix}}')
  })
})

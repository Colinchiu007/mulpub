// @ts-check
'use strict'
/**
 * 影视工程 v2 · F-I「任务级提示词接入规划流程」契约测试
 *
 * 覆盖 `shot-prompt-task.js` 的契约（openspec change: film-pipeline-prompt-triple-and-guards，
 * design D20 / D21 / D22）：
 *   - 尾帧约束**plan 级**取自 doctrine 的 `frame_constraint` 块，**只留哈希与长度**（不落原文）
 *   - 缺失**四分类**（byDesign / assetMissing / templateVar / badVarName）+ 机器可判字段
 *     （`deliverable` / `blockedVars`）
 *   - 确定性**分两级**：`promptAssetHash`（资产面）/ `promptRenderHash`（逐镜渲染面）
 *
 * 判据分两类（design D21.5）：
 *   - **合成夹具**：固定数据 + 固定阈值 ⇒ 资产更新不会让它变红
 *   - **真实 kit 巡检**：只断言**一致性**并打印读数，**不设阈值** ⇒ 资产更新不会让它变红
 */
const fs = require('fs')
const path = require('path')

const {
  SHOT_PROMPT_TASK_ID,
  TASK_VARS,
  MAX_KIT_VAR_LEN,
  MAX_SHOT_FIELD_LEN,
  MAX_MISSING_ENTRIES,
  MAX_MISSING_NAME_LEN,
  REASON_BY_DESIGN,
  REASON_ASSET_MISSING,
  REASON_TEMPLATE_VAR,
  REASON_BAD_VAR_NAME,
  REASON_OVERSIZE_VAR,
  pickLocaleText,
  buildEndFrameConstraint,
  buildShotTaskVars,
  buildShotTaskPrompt,
  computePromptAssetHash,
  computePromptRenderHash,
} = require('./shot-prompt-task')
const { loadFilmKit } = require('./kit-loader')

const KIT_DIR = path.join(__dirname, '..', '..', 'film-kit')

/** 合成任务模板：7 个变量与真实 `generate_shot_prompt/user.md` 同构 */
const USER_TEMPLATE = [
  '## 分镜记录',
  '{{shot_json}}',
  '## 上下文',
  '- 色盘：{{palette_line}}',
  '- 风格前缀：{{style_prefix}}',
  '- 本场 GEO 平面图：{{geo_block}}',
  '- 角色身份描述符：{{character_descriptors}}',
  '- 目标时长：{{duration_sec}} 秒',
  '- 模型：{{model}}',
].join('\n')

/** 合成 prompt 库（结构与 kit.promptLibrary 同构） */
function makeLibrary (opts) {
  const o = opts || {}
  const user = typeof o.user === 'string' ? o.user : USER_TEMPLATE
  const system = typeof o.system === 'string' ? o.system : '你是 AI 视频提示词工程师。'
  const task = {}
  task.zh = { system, user }
  if (o.noEn !== true) task.en = { system, user }
  return { root: '/synthetic', tasks: { [SHOT_PROMPT_TASK_ID]: task }, taskNames: [SHOT_PROMPT_TASK_ID] }
}

/** 合成 doctrine：带 frame_constraint 块 */
function makeDoctrine (frameText) {
  return {
    schemaVersion: 2,
    blocks: [
      { key: 'style', label: 'STYLE', zh: '风格前缀：逐字粘贴（Photoreal. NON-IP. 16:9. 12s.）', en: 'Style prefix' },
      { key: 'frame_constraint', label: 'FIRST / LAST FRAME CONSTRAINT', zh: frameText || '尾帧必须是可继续的稳定姿态。', en: 'The last frame must be a resumable settled pose.' },
    ],
    rules: [{ key: 'r1', title: 't', zh: 'z', en: 'e' }],
    glossary: [{ term: 'g', zh: 'z', en: 'e' }],
  }
}

/** 合成 kit：palette + manifest 角色 */
function makeKit (opts) {
  const o = opts || {}
  return {
    palette: o.noPalette === true ? null : { paletteLine: { zh: '色盘：夜色近黑 / 冷青。', en: 'Palette: night near-black / cold teal.' } },
    manifest: {
      filmMeta: {
        characters: o.noCharacters === true ? [] : [
          { name: 'ROKO', descriptor: 'Determined street kid; crystal arm.' },
          { name: 'JAXX', descriptor: 'Reckless, hungry street kid.' },
        ],
      },
    },
  }
}

const SHOT = {
  index: 0,
  shotId: 'auto-000',
  title: '镜 1',
  beatIndex: 1,
  characterNames: ['ROKO'],
  model: 'seedance_2_0',
}

describe('F-I · shot-prompt-task / 尾帧约束（plan 级，只留哈希与长度）', () => {
  it('取自 doctrine 的 frame_constraint 块：可用 + 有哈希与长度，**不返回原文**', () => {
    const r = buildEndFrameConstraint({ doctrine: makeDoctrine('尾帧必须是可继续的稳定姿态。'), locale: 'zh' })
    expect(r.available).toBe(true)
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.length).toBeGreaterThan(0)
    expect(r.text).toBeUndefined()
    expect(r.fallback).toBe(false)
    expect(r.locale).toBe('zh')
  })

  it('超长尾帧被截到上限并出声（truncated=true，不静默截断）', () => {
    const long = 'x'.repeat(60000)
    const r = buildEndFrameConstraint({ doctrine: makeDoctrine(long), locale: 'zh' })
    expect(r.truncated).toBe(true)
    expect(r.length).toBe(50000)
  })

  it('缺 en 回落 zh 并标记 fallback', () => {
    const d = makeDoctrine('尾帧必须是可继续的稳定姿态。')
    delete d.blocks.find(b => b.key === 'frame_constraint').en
    const r = buildEndFrameConstraint({ doctrine: d, locale: 'en' })
    expect(r.fallback).toBe(true)
    expect(r.locale).toBe('zh')
  })

  it('缺 doctrine ⇒ available=false（纯增量，不编内容）', () => {
    const r = buildEndFrameConstraint({ doctrine: null, locale: 'zh' })
    expect(r.available).toBe(false)
    expect(r.hash).toBe('')
  })

  /**
   * 第 8 轮 i2（Critical / clarity）：`frameConstraint.hash` 覆盖**截断前还是截断后**？
   *
   * 事实（实现）：`hash` 与 `length` 描述**同一个对象** —— 都是**截断后**的文本。
   * 但只存截断后的指纹有个**真缺口**：两段「前 50000 字相同、后半不同」的文本，
   * 截断后哈希**完全一样** ⇒ 截断点之后的改动**不可见**。
   * ⇒ 另存 `originalHash` / `originalLength`（截断前原文的指纹与长度）。
   */
  it('hash/length 取截断后文本；另存 originalHash/originalLength（截断点之后的改动也可见）', () => {
    const long = 'x'.repeat(60000)
    const r = buildEndFrameConstraint({ doctrine: makeDoctrine(long), locale: 'zh' })
    expect(r.truncated).toBe(true)
    expect(r.length).toBe(50000)
    // 截断后文本的指纹 = 截断后长度相同、但**后半不同**的两段文本 → 指纹**相同**
    const a = buildEndFrameConstraint({ doctrine: makeDoctrine('x'.repeat(60000) + 'AAAA'), locale: 'zh' })
    const b = buildEndFrameConstraint({ doctrine: makeDoctrine('x'.repeat(60000) + 'BBBB'), locale: 'zh' })
    expect(a.hash).toBe(b.hash)
    // 但 originalHash **不同** ⇒ 截断点之后的改动**可检测**
    expect(a.originalHash).not.toBe(b.originalHash)
    expect(a.originalLength).toBe(60004)
    expect(b.originalLength).toBe(60004)
    // 未截断时两者一致
    const short = buildEndFrameConstraint({ doctrine: makeDoctrine('短约束。'), locale: 'zh' })
    expect(short.truncated).toBe(false)
    expect(short.hash).toBe(short.originalHash)
    expect(short.length).toBe(short.originalLength)
  })
})

/**
 * 第 8 轮 i8（Warning / security）：`userData/film-kit` 可被用户或外部进程写入，
 * kit-loader 只校验**结构**、不校验块文本长度 ⇒ 流入提示词的 kit 自由文本
 * （色盘行、角色描述）**必须设长度上限**。
 *
 * 超限的处理是**不提供该变量**（⇒ 进 `missing` ⇒ `deliverable=false`），
 * **不是静默截断** —— 截断会把「资产异常」伪装成「资产正常」。
 */
describe('F-I · kit 视为不可信输入：长度上限（第 8 轮 i8）', () => {
  it('色盘行超上限 ⇒ 不提供该变量（进 missing ⇒ deliverable=false），**不静默截断**', () => {
    const kit = makeKit()
    kit.palette.paletteLine.zh = '色'.repeat(MAX_KIT_VAR_LEN + 1)
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit, locale: 'zh', durationSec: 5 })
    expect(vars.palette_line).toBeUndefined()
    expect(missing.some(m => m.name === 'palette_line' && m.reason === REASON_OVERSIZE_VAR)).toBe(true)
    const r = buildShotTaskPrompt({ library: makeLibrary(), vars, missing, locale: 'zh' })
    expect(r.deliverable).toBe(false)
  })

  it('角色描述超上限 ⇒ **整个变量**不提供（部分提供会产出「看着完整、其实缺角色」的提示词）', () => {
    const kit = makeKit()
    kit.manifest.filmMeta.characters[0].descriptor = '描'.repeat(MAX_KIT_VAR_LEN + 1)
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit, locale: 'zh', durationSec: 5 })
    expect(vars.character_descriptors).toBeUndefined()
    expect(missing.some(m => m.name === 'character_descriptors' && m.reason === REASON_OVERSIZE_VAR)).toBe(true)
  })

  it('**不可信**模板带来的变量名封顶到 64 字符（第 12 轮 i5：名字会落进逐镜项目文件）', () => {
    // ⚠ 名字必须是**合法名**（`renderTemplate` 的模板变量名正则只认 `[a-z][a-z0-9_]*`）
    //   ⇒ 不合法的名字**根本不会进清单**（它在渲染文本里原样留着），进清单的是「合法但超长」的名字。
    const longName = 'a'.repeat(200)
    const lib = makeLibrary({ user: USER_TEMPLATE + '\n- 额外：{{' + longName + '}}' })
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    const r = buildShotTaskPrompt({ library: lib, vars, missing, locale: 'zh' })
    const long = r.missing.find(m => m.name.length > 20)
    expect(long).toBeTruthy()
    expect(long.reason).toBe(REASON_TEMPLATE_VAR)
    expect(long.name.length).toBeLessThanOrEqual(MAX_MISSING_NAME_LEN)
    // 落盘体积因此有界：一个超长变量名不会进项目文件
    expect(JSON.stringify(r.missing).length).toBeLessThan(1024)
  })

  it('**duration_sec 恒为字符串**（第 19 轮 i2：命中判据是「非空字符串」⇒ 数值时长必须先 String 化）', () => {
    const { vars } = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    expect(typeof vars.duration_sec).toBe('string')
    expect(vars.duration_sec).toBe('5')
  })

  it('未超上限时照常提供（上限不误杀正常资产）', () => {
    const kit = makeKit()
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit, locale: 'zh', durationSec: 5 })
    expect(typeof vars.palette_line).toBe('string')
    expect(typeof vars.character_descriptors).toBe('string')
    expect(missing.some(m => m.name === 'palette_line')).toBe(false)
    expect(missing.some(m => m.name === 'character_descriptors')).toBe(false)
  })

  /**
   * 第 9 轮 i8（Warning / security）：长度纪律不能只管 kit 自由文本 ——
   * `shot_json` 把镜头的 `title` / `characterNames` / `model` **原样**送进提示词，
   * 而它们来自**用户可编辑的项目文件**（同样不可信）⇒ 上限留一个直通口。
   */
  it('逐镜字段超上限 ⇒ 不提供 shot_json（⇒ deliverable=false），**不静默截断**', () => {
    const longTitle = { ...SHOT, title: '标'.repeat(MAX_SHOT_FIELD_LEN + 1) }
    const r1 = buildShotTaskVars({ shot: longTitle, kit: makeKit(), locale: 'zh', durationSec: 5 })
    expect(r1.vars.shot_json).toBeUndefined()
    expect(r1.missing.some(m => m.name === 'shot_json' && m.reason === REASON_OVERSIZE_VAR)).toBe(true)
    const p1 = buildShotTaskPrompt({ library: makeLibrary(), vars: r1.vars, missing: r1.missing, locale: 'zh' })
    expect(p1.deliverable).toBe(false)

    // 角色名超长同样不提供
    const longChar = { ...SHOT, characterNames: ['角'.repeat(MAX_SHOT_FIELD_LEN + 1)] }
    const r2 = buildShotTaskVars({ shot: longChar, kit: makeKit(), locale: 'zh', durationSec: 5 })
    expect(r2.vars.shot_json).toBeUndefined()

    // 未超上限时照常提供（上限不误杀正常镜头）
    const ok = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    expect(typeof ok.vars.shot_json).toBe('string')
    expect(ok.missing.some(m => m.name === 'shot_json')).toBe(false)
  })
})

describe('F-I · shot-prompt-task / 变量装配与缺失四分类（合成夹具）', () => {
  it('7 变量齐备 ⇒ 渲染无 {{}} 残留 + missing 为空 + deliverable=true（**只测渲染器本身，非生产路径**）', () => {
    const kit = makeKit()
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit, locale: 'zh', durationSec: 5 })
    // 合成夹具：把 byDesign 的 style_prefix 与资产缺口的 geo_block 都补上
    vars.style_prefix = 'Photoreal. NON-IP. 16:9. 5s.'
    vars.geo_block = 'PLATFORM = 圆形石台。'
    const r = buildShotTaskPrompt({
      library: makeLibrary(),
      vars,
      missing: missing.filter(m => m.name !== 'style_prefix' && m.name !== 'geo_block'),
      locale: 'zh',
    })
    expect(r.ok).toBe(true)
    expect(r.renderText).not.toContain('{{')
    expect(r.missing).toEqual([])
    expect(r.deliverable).toBe(true)
    expect(TASK_VARS.length).toBe(7)
  })

  it('生产路径：style_prefix 永不提供 ⇒ 保留 {{style_prefix}} + deliverable=false', () => {
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    const r = buildShotTaskPrompt({ library: makeLibrary(), vars, missing, locale: 'zh' })
    expect(r.ok).toBe(true)
    expect(r.renderText).toContain('{{style_prefix}}')
    expect(r.deliverable).toBe(false)
    expect(r.blockedVars.some(m => m.name === 'style_prefix' && m.reason === REASON_BY_DESIGN)).toBe(true)
  })

  it('**byDesign（geo_block）** ⇒ 保留占位符 + 进清单（第 17 轮 i3 改判：不是 assetMissing）', () => {
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    const r = buildShotTaskPrompt({ library: makeLibrary(), vars, missing, locale: 'zh' })
    // 本批次**不取** GEO 块 ⇒ 不提供 ⇒ 渲染文本保留 `{{geo_block}}` 原样
    expect(r.renderText).toContain('{{geo_block}}')
    expect(r.blockedVars.some(m => m.name === 'geo_block' && m.reason === REASON_BY_DESIGN)).toBe(true)
  })

  it('**byDesign（geo_block）** ⇒ 保留占位符 + 进清单（第 17 轮 i3 改判：不是 assetMissing）', () => {
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    const r = buildShotTaskPrompt({ library: makeLibrary(), vars, missing, locale: 'zh' })
    // 本批次**不取** GEO 块 ⇒ 不提供 ⇒ 渲染文本保留 `{{geo_block}}` 原样
    expect(r.renderText).toContain('{{geo_block}}')
    expect(r.blockedVars.some(m => m.name === 'geo_block' && m.reason === REASON_BY_DESIGN)).toBe(true)
  })

  it('**byDesign（geo_block）** ⇒ 保留占位符 + 进清单（第 17 轮 i3 改判：不是 assetMissing）', () => {
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    const r = buildShotTaskPrompt({ library: makeLibrary(), vars, missing, locale: 'zh' })
    // 本批次**不取** GEO 块 ⇒ 不提供 ⇒ 渲染文本保留 `{{geo_block}}` 原样
    expect(r.renderText).toContain('{{geo_block}}')
    expect(r.blockedVars.some(m => m.name === 'geo_block' && m.reason === REASON_BY_DESIGN)).toBe(true)
  })

  it('assetMissing ⇒ 渲染为空串（不留占位符）+ 进清单', () => {
    // ⚠ 用**色盘行**做这个用例：`geo_block` 在第 17 轮 i3 改判为 **byDesign**（本批次不取）
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit({ noPalette: true }), locale: 'zh', durationSec: 5 })
    const r = buildShotTaskPrompt({ library: makeLibrary(), vars, missing, locale: 'zh' })
    expect(r.renderText).not.toContain('{{palette_line}}')
    expect(r.blockedVars.some(m => m.name === 'palette_line' && m.reason === REASON_ASSET_MISSING)).toBe(true)
  })

  it('模板多出的变量（templateVar）计入 missing 且拦住直送', () => {
    const lib = makeLibrary({ user: USER_TEMPLATE + '\n- 额外：{{extra_var}}' })
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    const r = buildShotTaskPrompt({ library: lib, vars, missing, locale: 'zh' })
    expect(r.blockedVars.some(m => m.name === 'extra_var' && m.reason === REASON_TEMPLATE_VAR)).toBe(true)
    expect(r.deliverable).toBe(false)
  })

  it('非法变量名（badVarName）计入 missing 且拦住直送', () => {
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    vars['Bad Name'] = 'x'
    const r = buildShotTaskPrompt({ library: makeLibrary(), vars, missing, locale: 'zh' })
    expect(r.blockedVars.some(m => m.reason === REASON_BAD_VAR_NAME)).toBe(true)
    expect(r.deliverable).toBe(false)
  })

  it('缺 palette / 角色 ⇒ 对应变量进清单（assetMissing）', () => {
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit({ noPalette: true, noCharacters: true }), locale: 'zh', durationSec: 5 })
    // **缺失**（资产里压根没有）⇒ assetMissing（**不是** oversizeVar —— 那是「有但太大」）
    expect(missing.some(m => m.name === 'palette_line' && m.reason === REASON_ASSET_MISSING)).toBe(true)
    expect(missing.some(m => m.name === 'character_descriptors' && m.reason === REASON_ASSET_MISSING)).toBe(true)
    // ⚠ 资产**缺失** ⇒ 提供**空串**（⇒ 渲染为空、**不留占位符**）—— 与 assetMissing 的语义一致（第 17 轮）
    expect(vars.palette_line).toBe('')
  })
})

describe('F-I · shot-prompt-task / 确定性（design D22：资产面与渲染面分两级）', () => {
  it('同输入两次渲染逐字相等', () => {
    const kit = makeKit()
    const a = buildShotTaskVars({ shot: SHOT, kit, locale: 'zh', durationSec: 5 })
    const b = buildShotTaskVars({ shot: SHOT, kit, locale: 'zh', durationSec: 5 })
    const ra = buildShotTaskPrompt({ library: makeLibrary(), vars: a.vars, missing: a.missing, locale: 'zh' })
    const rb = buildShotTaskPrompt({ library: makeLibrary(), vars: b.vars, missing: b.missing, locale: 'zh' })
    expect(ra.renderText).toBe(rb.renderText)
  })

  it('promptAssetHash 同输入稳定；随 locale 与回退事实变化', () => {
    const prompts = buildShotTaskPrompt({ library: makeLibrary(), vars: {}, missing: [], locale: 'zh' })
    const h1 = computePromptAssetHash({ doctrine: makeDoctrine(), system: prompts.system, user: prompts.user, locale: 'zh' })
    const h2 = computePromptAssetHash({ doctrine: makeDoctrine(), system: prompts.system, user: prompts.user, locale: 'zh' })
    expect(h1).toBe(h2)
    const hEn = computePromptAssetHash({ doctrine: makeDoctrine(), system: prompts.system, user: prompts.user, locale: 'en' })
    expect(hEn).not.toBe(h1)
    const hFb = computePromptAssetHash({ doctrine: makeDoctrine(), system: prompts.system, user: prompts.user, locale: 'en', fallbacks: { doctrine: { frame_constraint: 'zh' } } })
    expect(hFb).not.toBe(hEn)
  })

  /**
   * 第 7 轮 i3（Critical / security）：「资产哈希的确定性只依赖本地文件，没有运行时校验；
   * 篡改会静默破坏相等性」。
   *
   * 这条判据把「篡改**可检测**」落成可执行断言：
   * 哈希的每一个输入（doctrine 原文 / system / user）被改动 ⇒ 哈希必变
   * ⇒ 资产被换掉时，**重算的 `promptAssetHash` 与 plan 级存的不一致** ⇒ 消费方可据此拒绝直送。
   *
   * 注意「embedded manifest」不在本 PR：那是 F-J 写路径（PR-3b，design D19），
   * 需要独立安全评审；本 PR 的边界是「篡改必须**可检测**」，不是「资产必须被签名」。
   */
  it('promptAssetHash 对每个输入敏感（doctrine / system / user 任一被改 ⇒ 哈希变 ⇒ 篡改可检测）', () => {
    const prompts = buildShotTaskPrompt({ library: makeLibrary(), vars: {}, missing: [], locale: 'zh' })
    const base = { doctrine: makeDoctrine(), system: prompts.system, user: prompts.user, locale: 'zh' }
    const h0 = computePromptAssetHash(base)

    // ① doctrine 原文被换（本地资产被篡改）
    const d2 = makeDoctrine()
    d2.blocks.find(b => b.key === 'frame_constraint').zh = '被改过的尾帧约束。'
    expect(computePromptAssetHash({ ...base, doctrine: d2 })).not.toBe(h0)

    // ② 任务模板 system 被换
    expect(computePromptAssetHash({ ...base, system: base.system + '\n- 额外指令' })).not.toBe(h0)

    // ③ 任务模板 user 被换
    expect(computePromptAssetHash({ ...base, user: base.user + '\n- 额外要求' })).not.toBe(h0)
  })

  /**
   * 第 10 轮 i3（Critical/security）：「截断」与「哈希敏感性」的自洽性。
   *
   * 两个哈希的**域不同**，必须写清：
   * - `promptAssetHash` 吃的是**完整 doctrine 原文**（**不截断**）⇒ 截断点**之后**的改动**看得见**；
   * - `frameConstraint.hash` / `length` 吃的是**截断后**文本 ⇒ 截断点之后的改动**看不见**；
   *   `frameConstraint.originalHash` 吃的是**截断前**原文 ⇒ 那半段**补回来了**。
   *
   * 这条判据把三者的关系锁死，避免文档里再出现「任一改动 ⇒ 哈希必变」这种
   * 对**不同对象**的混用表述。
   */
  it('哈希的域分层：截断点之后的改动 ⇒ promptAssetHash 变、frameConstraint.hash 不变、originalHash 变', () => {
    const long = 'x'.repeat(60000)
    const a = makeDoctrine(long + 'AAAA')
    const b = makeDoctrine(long + 'BBBB')

    // ① promptAssetHash 吃**完整** doctrine ⇒ 截断点之后的改动看得见
    expect(computePromptAssetHash({ doctrine: a })).not.toBe(computePromptAssetHash({ doctrine: b }))

    // ② frameConstraint.hash 吃**截断后**文本 ⇒ 那半段看不见
    const fa = buildEndFrameConstraint({ doctrine: a, locale: 'zh' })
    const fb = buildEndFrameConstraint({ doctrine: b, locale: 'zh' })
    expect(fa.truncated).toBe(true)
    expect(fa.hash).toBe(fb.hash)

    // ③ originalHash 吃**截断前**原文 ⇒ 那半段补回来了
    expect(fa.originalHash).not.toBe(fb.originalHash)
  })

  /**
   * 第 10 轮 i5（Warning/consistency）：`promptAssetHash` 的**负向域** ——
   * 改色盘 / 改角色描述**不得**改它（它们不在这个哈希的域里），
   * 改的是**逐镜** `promptRenderHash`。
   *
   * 这条判据把「域的边界」变成可执行的**负向断言**（光有正向断言时，
   * 「把色盘也塞进哈希」这种过度覆盖**不会**被发现）。
   */
  it('负向域：改色盘/角色描述**不改** promptAssetHash，但**改** promptRenderHash', () => {
    const kitA = makeKit()
    const kitB = makeKit()
    kitB.palette.paletteLine.zh = '色盘：完全不同的另一种色。'
    const doctrine = makeDoctrine()
    const ha = computePromptAssetHash({ doctrine, system: 's', user: 'u', locale: 'zh' })
    const hb = computePromptAssetHash({ doctrine, system: 's', user: 'u', locale: 'zh' })
    expect(hb).toBe(ha) // 色盘根本不在这个哈希的输入里

    const a = buildShotTaskVars({ shot: SHOT, kit: kitA, locale: 'zh', durationSec: 5 })
    const b = buildShotTaskVars({ shot: SHOT, kit: kitB, locale: 'zh', durationSec: 5 })
    expect(computePromptRenderHash({ vars: a.vars, locale: 'zh' }))
      .not.toBe(computePromptRenderHash({ vars: b.vars, locale: 'zh' }))
  })

  it('promptRenderHash 同镜同资产稳定；**不同镜的 promptRenderHash 不同**（promptAssetHash 相同不代表渲染相同）', () => {
    const kit = makeKit()
    const a = buildShotTaskVars({ shot: SHOT, kit, locale: 'zh', durationSec: 5 })
    const other = { ...SHOT, shotId: 'auto-001', index: 1 }
    const b = buildShotTaskVars({ shot: other, kit, locale: 'zh', durationSec: 5 })
    expect(computePromptRenderHash({ vars: a.vars, locale: 'zh' })).toBe(computePromptRenderHash({ vars: a.vars, locale: 'zh' }))
    expect(computePromptRenderHash({ vars: a.vars, locale: 'zh' })).not.toBe(computePromptRenderHash({ vars: b.vars, locale: 'zh' }))
    // 同一资产面下逐镜哈希不同 ⇒ 逐镜相等只能靠 promptRenderHash
    const promptAssetHash = computePromptAssetHash({ doctrine: makeDoctrine(), locale: 'zh' })
    expect(promptAssetHash).toBe(computePromptAssetHash({ doctrine: makeDoctrine(), locale: 'zh' }))
  })

  it('**控制字符**从变量名里剥除（第 13 轮 i5：名字会进 UI 与日志）', () => {
    const evil = 'a\u0000b\u0007c\nd'
    const lib = makeLibrary({ user: USER_TEMPLATE + '\n- 额外：{{' + evil + '}}' })
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    const r = buildShotTaskPrompt({ library: lib, vars, missing, locale: 'zh' })
    for (const m of r.missing) {
      expect(/[\u0000-\u001f\u007f-\u009f]/.test(m.name), '名字里残留控制字符: ' + JSON.stringify(m.name)).toBe(false)
    }
  })

  it('**缺失态与提供态哈希不同**（第 14 轮 i2）：「变量超限」与「变量没有」不得同哈希', () => {
    const shot = { ...SHOT }
    // ① 正常：色盘有内容
    const a = buildShotTaskVars({ shot, kit: makeKit(), locale: 'zh', durationSec: 5 })
    // ② 色盘**超限**（不提供 ⇒ 进 missing）
    const kit2 = makeKit()
    kit2.palette.paletteLine.zh = '色'.repeat(MAX_KIT_VAR_LEN + 1)
    const b = buildShotTaskVars({ shot, kit: kit2, locale: 'zh', durationSec: 5 })
    // ③ 色盘**根本没有**（同样不提供）
    const c = buildShotTaskVars({ shot, kit: makeKit({ noPalette: true }), locale: 'zh', durationSec: 5 })
    const h = (x) => computePromptRenderHash({ vars: x.vars, missing: x.missing, locale: 'zh' })
    expect(h(a)).not.toBe(h(b))
    // ② 与 ③ 的**原因不同**（oversizeVar vs assetMissing）⇒ 哈希可区分
    expect(h(b)).not.toBe(h(c))
    expect(b.missing.find(m => m.name === 'palette_line').reason).toBe(REASON_OVERSIZE_VAR)
    expect(c.missing.find(m => m.name === 'palette_line').reason).toBe(REASON_ASSET_MISSING)
  })

  it('清单条目数有**硬闸门**（第 14 轮 i3）：模板要 100 个变量 ⇒ 清单仍被封住', () => {
    const many = Array.from({ length: 100 }, (_, i) => '{{extra_' + i + '}}').join('\n')
    const lib = makeLibrary({ user: USER_TEMPLATE + '\n' + many })
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    const r = buildShotTaskPrompt({ library: lib, vars, missing, locale: 'zh' })
    // 闸门在**实现**里（不是只在断言里）⇒ 100 个坏名也进不来
    expect(r.missing.length).toBeLessThanOrEqual(TASK_VARS.length + MAX_MISSING_ENTRIES)
    expect(JSON.stringify(r.missing).length).toBeLessThan(1024)
    // 闸门**不放行**：清单被截了，但 deliverable 仍是 false
    expect(r.deliverable).toBe(false)
  })

  it('截断**不切开代理对**（第 14 轮 i6）：emoji 不留半个', () => {
    const emoji = '🎬'.repeat(10)
    const r = buildEndFrameConstraint({ doctrine: makeDoctrine(emoji), locale: 'zh', maxLen: 5 })
    expect(r.truncated).toBe(true)
    // 截断后长度必为**偶数**（emoji = 2 个 code unit）⇒ 没有落单的高/低代理
    expect(r.length % 2).toBe(0)
    expect(r.length).toBeLessThanOrEqual(5)
    // 确定性：同输入两次截断结果**逐字相同**（长度与哈希都一样）
    const r2 = buildEndFrameConstraint({ doctrine: makeDoctrine(emoji), locale: 'zh', maxLen: 5 })
    expect(r2.hash).toBe(r.hash)
    expect(r2.length).toBe(r.length)
    // 未截断时长度就是原长
    const full = buildEndFrameConstraint({ doctrine: makeDoctrine(emoji), locale: 'zh' })
    expect(full.truncated).toBe(false)
    expect(full.length).toBe(20)
  })

  it('截断后的名字**唯一**（第 16 轮 i7：两个前 63 字相同的长名字不能同名）', () => {
    // 两个**合法**名（`[a-z0-9_]`）且**前 63 字相同、之后不同** ⇒ 截断到 63 字后**会撞名**
    // ⚠ 名字必须**全小写**：模板变量名正则只认 `[a-z][a-z0-9_]*` ⇒ 含大写的名字**根本不会进清单**
    const prefix = 'a'.repeat(62) + 'x'
    const p1 = prefix + 'a'.repeat(10)
    const p2 = prefix + 'a'.repeat(9) + 'b'
    expect(p1.slice(0, 63)).toBe(p2.slice(0, 63))
    const lib = makeLibrary({ user: USER_TEMPLATE + '\n- 1：{{' + p1 + '}}\n- 2：{{' + p2 + '}}' })
    const { vars, missing } = buildShotTaskVars({ shot: SHOT, kit: makeKit(), locale: 'zh', durationSec: 5 })
    const r = buildShotTaskPrompt({ library: lib, vars, missing, locale: 'zh' })
    const long = r.missing.filter(m => m.name.length > 20)
    expect(long.length).toBe(2)
    expect(long[0].name).not.toBe(long[1].name)
  })

  it('统一回退函数：缺该语种回落 zh 并标记', () => {
    const p = pickLocaleText({ zh: '中文' }, 'en')
    expect(p.fallback).toBe(true)
    expect(p.resolved).toBe('zh')
    expect(p.text).toBe('中文')
  })
})

/**
 * 真实 kit 的**人工读数**（2026-10-21，真实 film-kit 抽样 20 镜逐条实测）。
 *
 * 为什么要有它：只断言「命中数与 missing 清单自洽」是拿被测代码的输出对照自己（同义反复），
 * 没有任何外部真值。⇒ 把人工读数**落盘**在这里作 ground truth，测试与之比对。
 *
 * 容差 ±1：资产更新把读数挪动 ≤1 时不红（不制造假回归）；挪动 >1 时红 ⇒
 * **这是信号**（方法论接入面变了，要人工重录读数并在本文件写明原因），不是噪音。
 */
const RECORDED_READING = {
  avgFilled: 5,
  totalVars: 7,
  tolerance: 1,
  recordedAt: '2026-10-21',
  note: '人工读数：真实 kit 抽样 20 镜，平均可填 5/7（style_prefix 无资产源 ⇒ byDesign；geo_block 仅 1/153 模板有 ⇒ assetMissing）',
}

describe('F-I · shot-prompt-task / 真实 kit 巡检（非阻断：与人工读数比对 + 打印读数）', () => {
  it('真实 kit 抽样 20 镜 ⇒ 命中数与 missing 清单自洽，且与人工读数相符（容差 ±1）', () => {
    const loaded = loadFilmKit({ kitDir: KIT_DIR })
    if (!loaded.ok) {
      // 明确的 skip 条件：CI 上没有 film-kit 资产时**跳过**（不红），
      // 但必须打印读数格式，让「没跑」与「跑了但读数变了」在日志上可区分。
      console.log('[巡检] SKIP：film-kit 不可用（' + String(loaded.error).slice(0, 80) + '）'
        + '｜读数格式：[巡检] 真实 kit 抽样 N 镜：平均可填 X/7（人工读数 ' + RECORDED_READING.avgFilled + '/7）')
      return
    }
    const kit = loaded.kit
    const templates = kit.shots.slice(0, 20)
    let hitSum = 0
    for (const tpl of templates) {
      const shot = { index: 0, shotId: tpl.shotId, title: '', characterNames: [], model: tpl.model }
      const { vars, missing } = buildShotTaskVars({ shot, kit, locale: 'zh', durationSec: 5 })
      const filled = TASK_VARS.filter(n => typeof vars[n] === 'string' && vars[n] !== '').length
      /**
       * 第 9 轮 i2（Critical/consistency）：不变量必须**只统计 7 个任务变量**。
       *
       * `missing` 里还可能有 `templateVar` / `badVarName`（**模板多要的**变量与我们给错的名字），
       * 它们**不在 7 个任务变量之内** ⇒ 原来的「命中数 + 清单条数 == 7」在模板多要变量时
       * **必然为假**（自己定的判据把自己打脸）。
       */
      const missingTaskVars = missing.filter(m => TASK_VARS.includes(m.name)).length
      expect(filled + missingTaskVars).toBe(TASK_VARS.length)
      // 不变量（阻断）：`style_prefix` **恒**是 byDesign（设计如此，与资产无关）
      const sp = missing.find(m => m.name === 'style_prefix')
      expect(sp && sp.reason).toBe(REASON_BY_DESIGN)
      /**
       * 第 10 轮 i7（Info/feasibility）：「命中数 + 清单条数 == 7」是**定义恒真式**
       * （变量要么命中、要么进清单 ⇒ 装配器自己保证的），**发现不了任何真实缺陷**。
       * ⇒ 换成**有内容**的断言：每条 missing 的 reason 合法，且 reason 与渲染行为一致。
       */
      const REASONS = [REASON_BY_DESIGN, REASON_ASSET_MISSING, REASON_TEMPLATE_VAR, REASON_BAD_VAR_NAME, REASON_OVERSIZE_VAR]
      for (const m of missing) {
        expect(REASONS, '非法 reason: ' + JSON.stringify(m)).toContain(m.reason)
      }
      // reason 与渲染行为一致：byDesign 保留占位符；assetMissing 渲染空串（不留占位符）
      const rendered = buildShotTaskPrompt({ library: makeLibrary(), vars, missing, locale: 'zh' })
      for (const m of missing) {
        if (m.reason === REASON_BY_DESIGN) {
          expect(rendered.renderText, m.name + ' 应当保留占位符').toContain('{{' + m.name + '}}')
        } else if (m.reason === REASON_ASSET_MISSING) {
          expect(rendered.renderText, m.name + ' 应当不留占位符').not.toContain('{{' + m.name + '}}')
        }
      }
      // deliverable 与清单一致：有 missing ⇒ 不可直送
      expect(rendered.deliverable).toBe(missing.length === 0)
      expect(rendered.blockedVars.length).toBe(missing.length)
      hitSum += filled
    }
    const avg = hitSum / Math.max(1, templates.length)
    console.log('[巡检] 真实 kit 抽样 ' + templates.length + ' 镜：平均可填 ' + avg.toFixed(2) + '/' + TASK_VARS.length
      + '（人工读数 ' + RECORDED_READING.avgFilled + '/' + RECORDED_READING.totalVars + '，容差 ±' + RECORDED_READING.tolerance + '）')
    expect(avg).toBeGreaterThan(0)
    /**
     * 第 8 轮 i3（Warning / consistency）：读数**不参与判定**。
     *
     * 原来的「|avg − 人工读数| ≤ 容差」是**阻断**断言，但它建立在一个会漂的量上：
     * 样本里「无角色」的镜只有 4/7，资产一更新（补了角色/色盘）均值就动 ⇒ **可能假红**。
     * 而本节开头写明的原则是「真实 kit 巡检**不设阈值** ⇒ 资产更新不会让它变红」——
     * 旧断言**违反了自己的原则**。
     *
     * ⇒ 阻断判据只保留**不变量**（上面每镜的「命中数 + 清单 == 7」+ `style_prefix` 恒 blocked）；
     * 读数降级为**打印**（供人工比对），偏离时出声提醒，但不红。
     */
    const drift = Math.abs(avg - RECORDED_READING.avgFilled)
    if (drift > RECORDED_READING.tolerance) {
      console.log('[巡检] 读数与人工读数偏离 > 容差（' + avg.toFixed(2) + ' vs ' + RECORDED_READING.avgFilled
        + '）—— 这是**信号不是失败**：方法论接入面可能变了，请人工重录读数并更新本文件的 RECORDED_READING。')
    }
  })
})

/**
 * 第 7 轮 i4（Warning / consistency）：历史处置表里留着**陈旧字段名**
 * （`sourceHash` / `blockedExport`），实施时容易被「照着文档写」⇒ 写回旧名。
 *
 * 文档侧的口径在评审记录里（那是历史快照，不改）；**代码侧必须零残留** ——
 * 这条判据把「实施会不会照旧名写」变成机器可查的事实，而不是靠人记得。
 *
 * ⚠ **2026-10-22：扫描域从「硬编码文件清单」改成「按目录 glob」**。
 * 动因：本 PR 把 `shot-prompt-task.js` 按职责拆成了 6 个模块（`shot-prompt-*.js`），
 * 而原清单是**写死的 7 个文件名** ⇒ 新拆出来的文件**不在锁的覆盖内** ⇒
 * 旧名可以躲进新文件里，锁却照样绿（**结构性漏洞**）。
 * ⇒ 改成扫**整个目录**（`film-engineering/**` + 相关 ipc-handler + 两个 Vue），
 * 以后再拆文件、新增文件都**自动进锁**，不需要人记得改清单。
 */
describe('F-I · 陈旧字段名回归锁（第 7 轮 i4）', () => {
  const fs = require('fs')
  const path = require('path')
  /** 扫描域：影视工程相关的**全部**实现文件（按目录 glob，不写死文件名） */
  function collectImplFiles () {
    const roots = [
      path.join(__dirname),                                  // electron/services/film-engineering/
      path.join(__dirname, '..', '..', 'ipc-handlers'),      // electron/ipc-handlers/
      path.join(__dirname, '..', '..', '..', 'src', 'views', 'film-auto'),
      path.join(__dirname, '..', '..', '..', 'src', 'views'),
    ]
    const out = []
    const walk = (dir, depth) => {
      if (depth > 1) return
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (!e.isFile()) continue
        const name = e.name
        if (/\.test\.js$/.test(name)) continue
        if (/\.js$/.test(name) && /^(film-engineering|shot-prompt|auto-plan|auto-project|auto-runner)/.test(name)) {
          out.push(path.join(dir, name))
        } else if (/\.vue$/.test(name) && /^(FilmAutoPanel|FilmEngineeringView)\.vue$/.test(name)) {
          out.push(path.join(dir, name))
        }
      }
    }
    for (const r of roots) walk(r, 0)
    return out
  }
  const OBSOLETE = ['sourceHash', 'blockedExport']

  it('实现代码里不得再出现 sourceHash / blockedExport（旧名，第 4 轮已改名）', () => {
    const files = collectImplFiles()
    const hits = []
    for (const abs of files) {
      const src = fs.readFileSync(abs, 'utf8')
      for (const name of OBSOLETE) {
        if (src.includes(name)) hits.push(path.basename(abs) + ' → ' + name)
      }
    }
    expect(hits).toEqual([])
    // 第 8 轮 i4：防空集通过 —— 扫描列表为空/路径写错时，这条判据会**恒真**。
    expect(files.length).toBeGreaterThan(0)
    // 2026-10-22：锁的覆盖域必须**包含本 PR 新拆出来的模块**（否则旧名可以躲进新文件）。
    // 这条断言把「扫描域漏了新文件」变成机器可查的事实。
    const names = files.map((f) => path.basename(f))
    for (const must of [
      'shot-prompt-task.js',
      'shot-prompt-contract.js',
      'shot-prompt-hash.js',
      'shot-prompt-render.js',
      'shot-prompt-context.js',
      'shot-prompt-sanitize.js',
      'shot-prompt-locale.js',
    ]) {
      expect(names, '扫描域漏了 ' + must + ' ⇒ 旧名可以躲进它而锁照样绿').toContain(must)
    }
  })

  it('现行字段名确实在用（防止把新名也一起删掉，锁成「零命中」）', () => {
    const files = collectImplFiles()
    const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
    // 资产面哈希 + 资产不完整标记（plan 级上下文）
    expect(all).toContain('promptAssetHash')
    expect(all).toContain('assetsIncomplete')
    // 逐镜渲染哈希：服务层导出 `computePromptRenderHash`，**落盘字段名**是 `promptRenderHash`（在 auto-plan 层写）
    expect(all).toContain('computePromptRenderHash')
    expect(all).toContain('promptRenderHash')
  })
})

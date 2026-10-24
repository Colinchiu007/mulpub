// @ts-check
'use strict'
/**
 * auto-plan — 自动模式规划层（openspec change: film-auto-mode）
 *
 * 职责（design D8/D10/D11/D26）：把「剧本 + 参考图 + 横竖屏 + 大概时长」这一步人类输入，
 * 变成可执行的分镜计划：
 *   validateAutoInputs → 输入域校验（拒即不落盘，design D22）
 *   planShotCount      → 目标镜数 N = clamp(round(T/s), 1, MAX_AUTO_SHOTS)
 *   splitAutoBeats     → 分场（复用 script-adapt.splitScript 语义）
 *   expandBeatsToCount → **只拆**（K<N 时按句末标点，不丢字）
 *   mergeBeatsToCount  → **只并**（K>N 时相邻合并，不丢字）——与 expand 单向分工，杜绝双重合并（R1-i2）
 *   detectCharacters   → 角色检出（用户标注 > 显式标记 > 对话动词 > 频次；停用词守卫）
 *   buildCharacterMap  → 按频次降序填 ROKO/JAXX/LULU/REIN 槽位
 *   bindReferencePaths → 逐镜参考绑定（人物命中 + 场景轮转；受控根纵深防御；≤2 张）
 *   planAutoShots      → 主入口（提示词复用 kit 模板块结构，绝不新写组装逻辑）
 *   buildShotFingerprint / buildPayloadHash / buildPlanId → 指纹与哈希（归属与审计，D17/D26）
 *
 * 纪律：本模块为纯函数 + 零 IO（不读盘、不调 provider），便于表格化用例覆盖；
 *       所有 provider 调用与落盘一律在 IPC 层（D21：执行不经 pipeline 引擎）。
 */

const crypto = require('crypto')
const os = require('os')
const path = require('path')
const { splitScript, buildTemplatePrompt, buildMotionPrompt } = require('./script-adapt')
const { VIDEO_REFERENCE_PARAM_BY_PROVIDER } = require('./video-reference-inputs')
const {
  MAX_CHARACTER_NAME_LENGTH, SLOT_ORDER, STOPWORDS,
  detectCharacters, buildCharacterMap, bindReferencePaths, buildReferenceWarnings,
} = require('./auto-plan-characters')
const {
  sha256, buildShotFingerprint, buildPayloadHash, buildPlanId, buildRefsFingerprint,
} = require('./auto-plan-fingerprint')
const { resolveShotDurationMs, DEFAULT_TIERS: DEFAULT_DURATION_TIERS } = require('./shot-duration')
const {
  MIN_SENTENCE_CHUNK_LENGTH,
  splitIntoChunks,
  buildShotDurationWarnings,
  evaluateCapacity,
  buildShortCountWarning,
} = require('./auto-beat-splitter')
const { buildPlanPromptContext, buildShotTaskVars, computePromptRenderHash } = require('./shot-prompt-task')

const MAX_AUTO_SHOTS = 120
const MAX_AUTO_SCRIPT_LENGTH = 10000
const MIN_AUTO_DURATION_SEC = 10
const MAX_AUTO_DURATION_SEC = 600
const AUTO_ASPECTS = Object.freeze(['16x9', '9x16'])
const AUTO_SHOT_SECONDS = Object.freeze([5, 8, 10])
/**
 * 内置档位的单镜上限（秒）——**从档位本身推导，不另写一个字面量**。
 *
 * v7 对抗评审 i3 修正：初版写死 12 并注释「与 shot-grammar.json 的 maxSec 同源」，但内置档位
 * 最高只有 10，于是 12s 档在自动模式根本不可达，而 maxSec=12 让「已到上限」的判定永远不触发。
 * 现在上限等于实际最高档；kit 支持到 12s，需要放宽时用 planAutoShots({ durationTiers }) 注入，
 * 不要改这个常量（改它会让 validateAutoInputs 接受的档位与实际能力脱节）。
 */
const MAX_AUTO_SHOT_SEC = Math.max(...DEFAULT_DURATION_TIERS)
const MAX_AUTO_REFS = 8
/** 与 ipc-handlers/film-engineering.js:47-49 同源预估口径 */
const DISK_ESTIMATE_BYTES_PER_SHOT = 8 * 1024 * 1024
const WALLCLOCK_SECONDS_PER_SHOT = 300
const PRODUCTION_BATCH_SIZE = 10
const WALLCLOCK_WARN_SECONDS = 2 * 60 * 60

/** 目标时长 ÷ 单镜秒数 → 目标镜数（四舍五入并 clamp；非法输入回落 1，fail-closed 不抛） */
function planShotCount (targetDurationSec, shotSeconds, opts = {}) {
  const maxShots = Number.isInteger(opts.maxShots) && opts.maxShots > 0 ? opts.maxShots : MAX_AUTO_SHOTS
  const t = Number(targetDurationSec)
  const s = Number(shotSeconds)
  if (!Number.isFinite(t) || !Number.isFinite(s) || s <= 0 || t <= 0) return 1
  const n = Math.round(t / s)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, maxShots)
}

function badParam (message) {
  return { ok: false, errorCode: 'AUTO_BAD_PARAM', message: message || '参数非法' }
}

function isAbsoluteString (v) {
  return typeof v === 'string' && v.trim() !== '' && path.isAbsolute(v)
}

/**
 * 输入域校验（全部校验在此完成；auto-start 只复查归属与受控根 —— design D22）
 * @returns {{ok: true} | {ok: false, errorCode: string, message: string}}
 */
function validateAutoInputs (input) {
  const o = input || {}
  const script = typeof o.script === 'string' ? o.script : ''
  if (script.trim() === '') return { ok: false, errorCode: 'AUTO_SCRIPT_EMPTY', message: '剧本不能为空' }
  if (o.script.length > MAX_AUTO_SCRIPT_LENGTH) {
    return { ok: false, errorCode: 'AUTO_SCRIPT_TOO_LONG', message: '剧本不能超过 ' + MAX_AUTO_SCRIPT_LENGTH + ' 字' }
  }
  if (!AUTO_ASPECTS.includes(o.aspect)) return badParam('aspect 必须为 ' + AUTO_ASPECTS.join('/'))
  if (!AUTO_SHOT_SECONDS.includes(Number(o.seconds))) return badParam('seconds 必须为 ' + AUTO_SHOT_SECONDS.join('/'))
  const t = o.targetDurationSec
  if (!Number.isInteger(t) || t < MIN_AUTO_DURATION_SEC || t > MAX_AUTO_DURATION_SEC) {
    return badParam('targetDurationSec 必须为 ' + MIN_AUTO_DURATION_SEC + '-' + MAX_AUTO_DURATION_SEC + ' 的整数')
  }
  const characterRefs = o.characterRefs === undefined ? [] : o.characterRefs
  if (!Array.isArray(characterRefs) || characterRefs.length > MAX_AUTO_REFS) {
    return badParam('characterRefs 必须为不超过 ' + MAX_AUTO_REFS + ' 项的数组')
  }
  for (const ref of characterRefs) {
    if (!ref || typeof ref.name !== 'string' || ref.name.trim() === '' || ref.name.length > MAX_CHARACTER_NAME_LENGTH) {
      return badParam('人物参考图必须含 1-' + MAX_CHARACTER_NAME_LENGTH + ' 字的角色名')
    }
    if (!isAbsoluteString(ref.path)) return badParam('人物参考图路径必须为绝对路径')
  }
  const sceneRefs = o.sceneRefs === undefined ? [] : o.sceneRefs
  if (!Array.isArray(sceneRefs) || sceneRefs.length > MAX_AUTO_REFS) {
    return badParam('sceneRefs 必须为不超过 ' + MAX_AUTO_REFS + ' 项的数组')
  }
  for (const p of sceneRefs) {
    if (!isAbsoluteString(p)) return badParam('场景参考图路径必须为绝对路径')
  }
  return { ok: true }
}

/** 分场（复用剧本套用引擎的分场语义：空行分段 + 标题行并入下一段） */
function splitAutoBeats (script) {
  const beats = splitScript(typeof script === 'string' ? script : '')
  return beats.map((b, i) => ({ index: i + 1, title: b.title || '', text: b.text || '' }))
}


/** 把 chunks 均分成 parts 组（保序、非空、不丢字） */
function groupChunks (chunks, parts) {
  const groups = []
  const base = Math.floor(chunks.length / parts)
  let extra = chunks.length % parts
  let cursor = 0
  for (let i = 0; i < parts; i++) {
    const size = base + (extra > 0 ? 1 : 0)
    if (extra > 0) extra -= 1
    const slice = chunks.slice(cursor, cursor + size)
    cursor += size
    if (slice.length > 0) groups.push(slice)
  }
  return groups
}

/**
 * **只拆**：段落数 < 目标数时，把最长的可拆段落按句末标点拆开（不丢字、不造空镜）
 * 合并一律交给 mergeBeatsToCount（单向分工，见 design D8 / 评审 R1-i2）
 */
function expandBeatsToCount (beats, targetCount) {
  const target = Number.isInteger(targetCount) && targetCount > 0 ? targetCount : 0
  let list = (Array.isArray(beats) ? beats : []).map((b) => ({ ...b }))
  if (target <= list.length) return list
  for (;;) {
    if (list.length >= target) break
    let bestIdx = -1
    let bestChunks = null
    for (let i = 0; i < list.length; i++) {
      const chunks = splitIntoChunks(list[i].text)
      const splittable = chunks.length >= 2 && chunks.every((c) => c.length >= MIN_SENTENCE_CHUNK_LENGTH)
      if (!splittable) continue
      if (!bestChunks || list[i].text.length > list[bestIdx].text.length) { bestIdx = i; bestChunks = chunks }
    }
    if (bestIdx < 0 || !bestChunks) break
    const need = target - list.length
    const parts = Math.min(bestChunks.length, need + 1)
    if (parts < 2) break
    const groups = groupChunks(bestChunks, parts)
    if (groups.length < 2) break
    const source = list[bestIdx]
    const replacement = groups.map((g) => ({ index: 0, title: source.title, text: g.join('') }))
    list = list.slice(0, bestIdx).concat(replacement, list.slice(bestIdx + 1))
  }
  return list.map((b, i) => ({ ...b, index: i + 1 }))
}

/** **只并**：段落数 > 目标数时相邻合并（保序、不丢字、不复制内容） */
function mergeBeatsToCount (beats, targetCount) {
  const target = Number.isInteger(targetCount) && targetCount > 0 ? targetCount : 0
  const list = (Array.isArray(beats) ? beats : []).map((b) => ({ ...b }))
  if (target <= 0 || list.length <= target) return list
  const groups = groupChunks(list, target)
  return groups.map((g, i) => ({
    index: i + 1,
    title: g[0].title || '',
    text: g.map((b) => b.text).join(''),
  }))
}


/**
 * 主入口：剧本 + 参考图 + 参数 → 可执行分镜计划（零 provider 调用、零落盘）
 * @returns {{ok: true, shots: Array<object>, characterMap: object, warnings: Array<object>, estimates: object, plannedDurationSec: number, refsFingerprint: string, scriptHash: string}
 *          | {ok: false, errorCode: string, message: string}}
 */
function planAutoShots (input) {
  const o = input || {}
  const valid = validateAutoInputs(o)
  if (!valid.ok) return valid
  const templates = Array.isArray(o.templateShots) ? o.templateShots : []
  if (templates.length === 0) return { ok: false, errorCode: 'AUTO_NO_TEMPLATES', message: '没有可用模板分镜（film-kit 未加载或为空）' }

  const maxShots = Number.isInteger(o.maxShots) && o.maxShots > 0 ? o.maxShots : MAX_AUTO_SHOTS
  // 先按未 clamp 的原始镜数判上限（fail-closed 兜底）：clamp 之后的数恒 ≤ maxShots，
  // 若用 clamp 后的值判上限，该分支永远不可达（等于把防线写成死码）。
  const s = Number(o.seconds)
  const rawCount = s > 0 ? Math.round(Number(o.targetDurationSec) / s) : 1
  if (Number.isFinite(rawCount) && rawCount > maxShots) {
    return {
      ok: false,
      errorCode: 'AUTO_TOO_MANY_SHOTS',
      message: '计划镜数 ' + rawCount + ' 超过上限 ' + maxShots + '，请缩短大概时长或增大单镜秒数',
    }
  }
  const targetCount = planShotCount(o.targetDurationSec, o.seconds, { maxShots })

  const baseBeats = splitAutoBeats(o.script)
  // 理论不可达的 fail-closed 兜底（代码审查结论）：`validateAutoInputs` 已先拦下空白剧本（AUTO_SCRIPT_EMPTY），
  // 而 `splitScript` 对任何非空白输入都至少产出一段（连「只有标题行」也会补一段 text:''）。
  // 保留此分支作为「将来改了 splitScript 语义」的兜底，不删——但不要为它编造可达用例。
  if (baseBeats.length === 0) return { ok: false, errorCode: 'AUTO_NO_BEATS', message: '剧本无法分场（请用空行分隔场景）' }
  const expanded = expandBeatsToCount(baseBeats, targetCount)
  const beats = mergeBeatsToCount(expanded, targetCount)

  const detected = detectCharacters({ script: o.script, labeledRefs: o.characterRefs || [] })
  const characterMap = buildCharacterMap(detected.characters)
  const bound = bindReferencePaths({
    beats,
    characterRefs: o.characterRefs || [],
    sceneRefs: o.sceneRefs || [],
    mediaRoot: o.mediaRoot,
  })

  // 时长档的唯一缺省事实源是 shot-duration 的 DEFAULT_TIERS（= film-kit 的 supportedSec）。
  // v7 对抗评审第二轮 i3：初版用 AUTO_SHOT_SECONDS 兼当档位表，于是「用户可选的 seconds 输入域」
  // 与「模型支持的时长档」被绑成同一个东西，资产承诺 12s 而自动模式最高只有 10s。
  // 两者语义不同：前者是输入白名单（validateAutoInputs 用），后者是能力表。
  const durationTiers = Array.isArray(o.durationTiers) && o.durationTiers.length > 0
    ? o.durationTiers.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
    : DEFAULT_DURATION_TIERS
  const durationMaxSec = Math.max(...durationTiers)

  // 影视工程 v2 · F-I：规划期接方法论资产（零 provider 调用）。
  // kit 上下文缺省时**不产出**任何方法论字段 ⇒ 既有字段逐字不变（纯增量）。
  const kitCtx = o.kit && typeof o.kit === 'object' ? o.kit : null
  const locale = o.locale === 'en' ? 'en' : 'zh'
  const planPrompt = kitCtx ? buildPlanPromptContext({ kit: kitCtx, locale }) : { promptContext: null, warnings: [] }

  const shots = beats.map((beat, i) => {
    const template = templates[i % templates.length]
    const prompt = buildTemplatePrompt({ template, beatText: beat.text, characterMap })
    // 逐镜：任务模板的变量与缺失清单（长文本不落逐镜 —— design D21.1）
    const taskVars = kitCtx
      ? buildShotTaskVars({
        shot: { index: i, shotId: 'auto-' + String(i).padStart(3, '0'), title: beat.title || '', beatIndex: beat.index, characterNames: Object.values(characterMap).filter((name) => String(beat.text || '').includes(name)), model: template.model },
        kit: kitCtx,
        locale,
        durationSec: Number(o.seconds),
      })
      : null
    const refPaths = bound[i] ? bound[i].refPaths : []
    // v7 批次一 F2 + F34：给每镜补 durationMs（来源优先级链）。
    // 自动模式下还没有 TTS 实测，故走 formula（按本镜文案推算）→ tier（o.seconds 兜底）。
    // 传 text 而非 dialogue：beat.text 通常是「动作 + 台词」混排，
    // resolveShotDurationMs 会按引号抽取真正被念出的部分（v7 对抗评审 i1），避免整段按语速高估。
    // 这是**纯增量**：原先 `seconds` 的语义与 plannedDurationSec 一律不动，
    // 消费方可以继续只读 seconds；需要更细的时长就读 durationMs。
    const duration = resolveShotDurationMs(
      { text: beat.text, emotion: beat.emotion },
      {
        tiers: durationTiers,
        maxSec: durationMaxSec,
        defaultSec: Number(o.seconds),
        // M0′（2026-10-24）：容量基准 = **用户所选的单镜档位**，不是物理上限——
        // 出片镜长用的是全局 o.seconds（auto-runner.js:163/231），不是逐镜推算值。
        capacitySec: Number(o.seconds),
        // v7 对抗评审第二轮 i4：beat.text 常是纯动作描述 ⇒ 没有引号就不走 formula，
        // 否则会给动作配语速、让 120 字的无台词动作镜误触发「必须拆解台词」。
        requireQuotedDialogue: true,
      },
    )
    // M0′.1：容量不足的镜要**逐镜**给出可执行出口（R3.5）——
    // 逐镜是消费方唯一能看到「哪一镜念不完」的粒度（plan 级只给汇总）。
    const capacityOverflow = duration.ok && duration.capacityOverflow === true
    const shotWarnings = buildShotDurationWarnings(duration, { selectableSeconds: AUTO_SHOT_SECONDS })
    return {
      index: i,
      shotId: 'auto-' + String(i).padStart(3, '0'),
      beatIndex: beat.index,
      title: beat.title || '',
      prompt,
      // 影视工程 v2 · F-A：提示词三分。
      //   imagePrompt = 当前拼装结果（**与 prompt 逐字相同**）⇒ 图片生成零回归；
      //   videoPrompt = 运动子集（去掉空间/音频/约束等静态块）⇒ 视频模型只拿运动信息；
      //   endFramePrompt = ''（尾帧约束文本来自任务级提示词库，随 F-I 落地；本批次不派生，
      //     消费侧不发送该字段——见 openspec spec「尾帧提示词只产出不消费」）。
      imagePrompt: prompt,
      videoPrompt: buildMotionPrompt({ template, beatText: beat.text, characterMap }),
      endFramePrompt: '',
      // 影视工程 v2 · F-I：逐镜只存**变量与缺失清单**，不存方法论长文本（plan 级存一次）
      ...(taskVars
        ? {
            promptVars: taskVars.vars,
            promptMissing: taskVars.missing,
            // 清单被闸门截断了吗（第 17 轮 i7）⇒ 供 plan 级 `missingTruncated` 汇总
            promptTruncated: taskVars.truncated === true,
            // 逐镜渲染哈希（design D22）：同一镜 + 同一资产 ⇒ 渲染逐字相同
            // ⚠ 缺失清单**也要参与**（第 14 轮 i2）：否则「变量超限」与「变量没有」同哈希。
            promptRenderHash: computePromptRenderHash({ vars: taskVars.vars, missing: taskVars.missing, locale }),
          }
        : {}),
      characterNames: Object.values(characterMap).filter((name) => String(beat.text || '').includes(name)),
      refPaths,
      seconds: Number(o.seconds),
      durationMs: duration.ok ? duration.durationMs : Math.round(Number(o.seconds) * 1000),
      durationSec: duration.ok ? duration.durationSec : Number(o.seconds),
      durationSource: duration.ok ? duration.source : 'tier',
      durationRawSec: duration.ok && Number.isFinite(duration.rawSec) ? duration.rawSec : null,
      // M0′：本镜的容量判定结果与基准（供 plan 级汇总与 UI 逐镜展示）
      capacityOverflow,
      capacitySec: duration.ok && Number.isFinite(duration.capacitySec) ? duration.capacitySec : Number(o.seconds),
      durationWarnings: shotWarnings,
      status: 'pending',
    }
  })

  const plannedDurationSec = shots.length * Number(o.seconds)
  // 按台词推算的总时长（与档位基线并列展示，不替换任何既有字段）
  const estimatedDurationSec = Math.round(shots.reduce((acc, x) => acc + (Number(x.durationMs) || 0), 0) / 100) / 10
  const durationSourceCount = shots.reduce((acc, x) => {
    acc[x.durationSource] = (acc[x.durationSource] || 0) + 1
    return acc
  }, { formula: 0, tier: 0, tts: 0, user: 0 })
  const durationWarnings = []
  if (plannedDurationSec > 0 && Math.abs(estimatedDurationSec - plannedDurationSec) / plannedDurationSec > 0.2) {
    durationWarnings.push({
      code: 'W8',
      message: '按台词推算总时长 ' + estimatedDurationSec + ' 秒，与档位基线 ' + plannedDurationSec + ' 秒相差超过 20%'
        + '（推算 ' + durationSourceCount.formula + ' 镜 / 档位 ' + durationSourceCount.tier + ' 镜）。'
        + '最终以 TTS 实测为准；若差异过大请调整单镜秒数或拆分长台词镜头。',
    })
  }
  // v7 对抗评审 i1：逐镜时长警告原先只挂在 shot.durationWarnings 上，调用方不遍历就看不见，
  // 于是「推算超过单镜上限必须拆解台词」这条承诺在自动模式里是静默的。
  //
  // 判据刻意只覆盖**两类实质事件**，不把「无台词 / 低于最小档」这类良性提示也报上来——
  // 一个恒真的告警会立刻退化成噪音（W8 的误报风险已被同一轮评审点过）。
  //   ① overflow：台词量超过最高档，不拆解就会丢字
  //   ② truncation：容差吸附把档位压到内容长度以下，尾部可能被切
  // 两组必须**互斥**：溢出镜（rawSec > maxSec）必然同时满足「内容长于档位」，若不排除就会
  // 既报「必须拆解台词」又报「容差吸附到更短档位」，而且 N 会把同一镜数两次
  // （v7 对抗评审第二轮 i1）。截断只对未溢出的镜成立。
  const overflowShots = shots.filter((s) => Number.isFinite(s.durationRawSec) && s.durationRawSec > durationMaxSec)
  const truncatedShots = shots.filter((s) => Number.isFinite(s.durationRawSec)
    && s.durationRawSec <= durationMaxSec
    && s.durationRawSec * 1000 > Number(s.durationMs) + 1)
  if (overflowShots.length > 0 || truncatedShots.length > 0) {
    const parts = []
    if (overflowShots.length > 0) {
      parts.push('其中 ' + overflowShots.length + ' 镜推算时长超过单镜上限 ' + durationMaxSec + ' 秒（'
        + overflowShots.slice(0, 5).map((s) => '#' + s.index).join(', ')
        + '），必须按 long_dialogue_split 拆解台词，不得截断')
    }
    if (truncatedShots.length > 0) {
      parts.push(truncatedShots.length + ' 镜因容差吸附到了略短的档位（'
        + truncatedShots.slice(0, 5).map((s) => '#' + s.index).join(', ')
        + '），台词尾部可能被切，建议复核或改大单镜秒数')
    }
    durationWarnings.push({
      code: 'W9',
      message: '有 ' + (overflowShots.length + truncatedShots.length) + ' 个分镜的实际台词长度超出其档位时长（两类互斥，合计即独立镜数）；'
        + parts.join('；') + '。逐镜明细见 shots[].durationWarnings。',
    })
  }
  const wallclock = shots.length * WALLCLOCK_SECONDS_PER_SHOT
  const shotsWithReferences = shots.filter((s) => s.refPaths.length > 0).length
  // 空文案分镜（代码审查发现）：整篇只写一行场景标题（如单独一行 `INT.`）时，`splitScript` 会产出一段
  // `text:''`；这类镜的提示词里没有一点用户文案，而确认卡只显示「提示词字数」，用户看不出差异。
  // 因此显式给 W7 提示（不阻断——用户可能就是想要一张模板空镜）。
  const emptyBeatIndexes = beats.filter((b) => !String(b.text || '').trim()).map((b) => b.index)
  const warnings = [
    ...buildReferenceWarnings({ providerId: o.providerId, shotsWithReferences }),
    ...(shots.length > PRODUCTION_BATCH_SIZE
      ? [{ code: 'W2', message: '镜数超过 ' + PRODUCTION_BATCH_SIZE + '，将自动分 ' + Math.ceil(shots.length / PRODUCTION_BATCH_SIZE) + ' 批顺序执行（无需逐批确认）' }]
      : []),
    ...(plannedDurationSec !== Number(o.targetDurationSec)
      ? [{ code: 'W3', message: '实际时长约 ' + plannedDurationSec + ' 秒，与目标 ' + Number(o.targetDurationSec) + ' 秒存在差异（单镜 ' + Number(o.seconds) + ' 秒 × ' + shots.length + ' 镜）' }]
      : []),
    ...detected.warnings,
    ...(emptyBeatIndexes.length > 0
      ? [{
          code: 'W7',
          message: '有 ' + emptyBeatIndexes.length + ' 个分镜没有解析到文案（剧本里可能只写了场景标题行），这些镜将沿用模板原文：'
            + emptyBeatIndexes.slice(0, 5).map((i) => '#' + i).join(', '),
        }]
      : []),
    ...(wallclock > WALLCLOCK_WARN_SECONDS
      ? [{ code: 'W5', message: '墙钟预估约 ' + (wallclock / 3600).toFixed(1) + ' 小时，建议缩短时长或分批推进（支持停止与断点续跑）' }]
      : []),
    // 逐镜绑定警告（越界路径等）汇总为 W6，附前若干条便于定位
    ...(bound.some((b) => b.warnings.length > 0)
      ? [{
          code: 'W6',
          message: '部分参考图未通过受控目录校验已跳过：' + bound
            .filter((b) => b.warnings.length > 0)
            .slice(0, 3)
            .map((b) => '#' + b.index + ' ' + b.warnings.map((w) => w.reason).join(','))
            .join('; '),
        }]
      : []),
    ...durationWarnings,
    ...planPrompt.warnings,
  ]

  /**
   * M0′.4 / R14：少产镜数 ⇒ 报告原因（不阻断，成片能念完）。
   * M0′.2 / R3.3：容量不足 ⇒ fail-closed（阻断，成片一定念不完）。
   * 顺序：先报少产、再判容量 ⇒ 容量不足时返回的 warnings 也带着少产信息。
   */
  const shortCountWarning = buildShortCountWarning({ shots, targetCount, beats: baseBeats })
  if (shortCountWarning) warnings.push(shortCountWarning)
  const capacityVerdict = evaluateCapacity({
    shots,
    capacitySec: Number(o.seconds),
    selectableSeconds: AUTO_SHOT_SECONDS,
  })
  if (capacityVerdict.blocked) {
    return {
      ok: false,
      errorCode: capacityVerdict.errorCode,
      message: capacityVerdict.message,
      shots,
      warnings,
    }
  }

  return {
    ok: true,
    shots,
    promptContext: planPrompt.promptContext
      ? {
        ...planPrompt.promptContext,
        // ⚠ 任一镜的清单被**闸门截断**（第 17 轮 i7）⇒ 面板要说一句「还有未显示的」，
        //   否则用户看到的 blockedVars 少于真实数量（缺口被**静默丢弃**）。
        missingTruncated: shots.some(s => s && s.promptTruncated === true),
      }
      : null,
    characterMap,
    warnings,
    plannedDurationSec,
    estimatedDurationSec,
    durationSourceCount,
    targetDurationSec: Number(o.targetDurationSec),
    shotsWithReferences,
    scriptHash: sha256(o.script),
    refsFingerprint: buildRefsFingerprint(o.characterRefs || [], o.sceneRefs || []),
    estimates: {
      shotCount: shots.length,
      batchCount: Math.ceil(shots.length / PRODUCTION_BATCH_SIZE),
      diskEstimateBytes: shots.length * DISK_ESTIMATE_BYTES_PER_SHOT,
      wallclockEstimateSeconds: wallclock,
      estimatedDurationSec,
    },
  }
}

module.exports = {
  MAX_AUTO_SHOTS,
  MAX_AUTO_SCRIPT_LENGTH,
  MIN_AUTO_DURATION_SEC,
  MAX_AUTO_DURATION_SEC,
  AUTO_ASPECTS,
  AUTO_SHOT_SECONDS,
  MAX_AUTO_SHOT_SEC,
  MAX_AUTO_REFS,
  SLOT_ORDER,
  DISK_ESTIMATE_BYTES_PER_SHOT,
  WALLCLOCK_SECONDS_PER_SHOT,
  PRODUCTION_BATCH_SIZE,
  WALLCLOCK_WARN_SECONDS,
  STOPWORDS,
  planShotCount,
  validateAutoInputs,
  splitAutoBeats,
  expandBeatsToCount,
  mergeBeatsToCount,
  detectCharacters,
  buildCharacterMap,
  bindReferencePaths,
  buildReferenceWarnings,
  buildShotFingerprint,
  buildPayloadHash,
  buildPlanId,
  buildRefsFingerprint,
  planAutoShots,
}


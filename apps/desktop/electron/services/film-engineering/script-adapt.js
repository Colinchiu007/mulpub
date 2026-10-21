// @ts-check
'use strict'
/**
 * script-adapt - 剧本套用引擎（影视项目案例工程方法）
 *
 * 输入：用户剧本（剧情）+ 角色映射（用户角色 → 影视项目案例角色槽位）
 * 输出：adaptedShots（与 kit 分镜同构，可被勾选生成/导出消费）
 *   - 剧情内容 100% 来自用户剧本
 *   - 实现方法（提示词块结构 / 模型类型 / 参考图 token 约定）复刻自影视项目案例模板分镜
 *   - 可选 LLM 润色（复用 PromptBridge/aiGenerator）；LLM 不可用降级本地模板结果
 */

const MAX_SCRIPT_LENGTH = 10000
const MAX_CHARACTER_MAP_KEYS = 10
const DEFAULT_LLM_BATCH_LIMIT = 20

/**
 * 剧本分场：按空行分段；标题行（第X场 / SCENE n / INT. / EXT.）并入下一段。
 * @param {string} script
 * @returns {Array<{index: number, title: string, text: string}>}
 */
function splitScript (script) {
  const normalized = String(script || '').replace(/\r\n/g, '\n')
  const rawParts = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const merged = []
  let pendingTitle = null
  for (const part of rawParts) {
    const lines = part.split('\n').map((l) => l.trim()).filter(Boolean)
    const isHeading = lines.length === 1 &&
      /^(第\s*[0-9一二三四五六七八九十百]+场|scene\s*[0-9]+|int\.|ext\.|int\.\/ext)/i.test(lines[0])
    if (isHeading) {
      pendingTitle = lines[0]
      continue
    }
    const title = pendingTitle || (lines.length > 1 ? lines[0] : '')
    const text = pendingTitle ? lines.join(' ') : (lines.length > 1 ? lines.slice(1).join(' ') : lines[0])
    merged.push({ index: merged.length + 1, title, text })
    pendingTitle = null
  }
  if (pendingTitle) merged.push({ index: merged.length + 1, title: pendingTitle, text: '' })
  return merged
}

/**
 * 拆出模板提示词的**拼装零件**（影视工程 v2 · F-A 提示词三分）。
 *
 * 为什么要有这一层：`buildTemplatePrompt` 把「场景头 + 剧情 + 角色行 + 模板块」拼成一坨，
 * 于是「首帧图」与「视频运动」必须共用同一段文本——单镜提示词一段到底（G-1）。
 * 要拆成三份提示词，就得先把「哪些零件是静态（空间/音频/约束）、哪些是运动（动作/表演）」
 * 在**同一次拼装**里分开，否则两套拼装逻辑必然漂移（两份真相源）。
 *
 * 口径（按模板块的**首行**判定，散文正文不参与分类）：
 *   - 运动类：ACTION TIMING / CHARACTER ACTING
 *   - 静态类：GEO SPATIAL LAYOUT / AUDIO / POSITIVE CONSTRAINTS
 *
 * ⚠️ 拼装**顺序与内容逐字保持**原样：`buildTemplatePrompt` 改为消费本函数的产物，
 * 输出与改造前逐字节一致（有回归锁断言）。新增的只有 `motionParts` / `staticParts` 两个分类视图。
 *
 * @param {object} opts
 * @param {object} opts.template - kit 模板分镜
 * @param {string} opts.beatText - 用户剧情段落
 * @param {object} opts.characterMap - 角色映射
 * @returns {{head: string[], characterLines: string[], motionParts: string[], staticParts: string[], allParts: string[]}}
 */
function buildTemplatePromptParts ({ template, beatText, characterMap }) {
  const tpl = String(template.prompt || '')
  const storyLines = String(beatText || '').split('\n').map((l) => l.trim()).filter(Boolean)
  /** @type {string[]} */
  const head = []
  /** @type {string[]} */
  const characterLines = []
  /** @type {string[]} */
  const motionParts = []
  /** @type {string[]} */
  const staticParts = []
  const firstLine = tpl.split('\n')[0]
  const isSceneHeading = /^(INT|EXT|INT\.\/EXT|INT\.|EXT\.)/i.test(String(firstLine || '').trim())
  head.push(isSceneHeading ? firstLine.trim() : (storyLines[0] || 'SCENE'))
  if (storyLines.length > 0) head.push(storyLines.join(' '))
  const rawCharacterLines = tpl.split('\n').filter((l) => /\[CHARACTER:/.test(l))
  for (const cl of rawCharacterLines) {
    const m = cl.match(/\[CHARACTER:\s*([A-Z0-9_]+)\]/i)
    if (m) {
      const hgName = m[1].toUpperCase()
      const userRole = characterMap && characterMap[hgName]
      characterLines.push(cl.trim() + (userRole ? '（' + userRole + '）' : ''))
    } else {
      characterLines.push(cl.trim())
    }
  }
  const blocks = tpl.split(/\n{2,}/)
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    if (/\[CHARACTER:/.test(trimmed)) continue
    if (/^ACTION TIMING/i.test(trimmed) || /^CHARACTER ACTING/i.test(trimmed)) {
      motionParts.push(trimmed)
      continue
    }
    if (/^GEO SPATIAL LAYOUT/i.test(trimmed) ||
        /^AUDIO/i.test(trimmed) ||
        /^POSITIVE CONSTRAINTS/i.test(trimmed)) {
      staticParts.push(trimmed)
    }
  }
  // allParts：与原实现完全同序（head → characterLines → 块）
  const allParts = [...head, ...characterLines]
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    if (/\[CHARACTER:/.test(trimmed)) continue
    if (/^GEO SPATIAL LAYOUT/i.test(trimmed) ||
        /^ACTION TIMING/i.test(trimmed) ||
        /^AUDIO/i.test(trimmed) ||
        /^CHARACTER ACTING/i.test(trimmed) ||
        /^POSITIVE CONSTRAINTS/i.test(trimmed)) {
      allParts.push(trimmed)
    }
  }
  return { head, characterLines, motionParts, staticParts, allParts }
}

/**
 * 组装模板提示词：剧情替换 + 影视项目案例块结构复刻。
 * @param {object} opts
 * @param {object} opts.template - kit 模板分镜
 * @param {string} opts.beatText - 用户剧情段落
 * @param {object} opts.characterMap - 角色映射
 * @returns {string}
 */
function buildTemplatePrompt ({ template, beatText, characterMap }) {
  return buildTemplatePromptParts({ template, beatText, characterMap }).allParts.join('\n\n')
}

/**
 * 组装**视频运动提示词**（影视工程 v2 · F-A）：场景头 + 剧情 + 角色行 + 运动类块。
 *
 * 与首帧图提示词的差别：去掉**静态类块**（空间布局 / 音频 / 正向约束）——
 * 视频模型不需要「静态空间地图」，给它反而稀释动作约束。
 *
 * ⚠️ 当模板**没有任何静态块**时，本函数的结果与首帧图提示词**逐字相同**（该镜无可剔除内容，
 * 属正常态而非缺陷）。调用方据此判定「是否真的派生了运动子集」，不得用长度比硬凑。
 *
 * @param {object} opts - 同 buildTemplatePrompt
 * @returns {string}
 */
function buildMotionPrompt ({ template, beatText, characterMap }) {
  const parts = buildTemplatePromptParts({ template, beatText, characterMap })
  return [...parts.head, ...parts.characterLines, ...parts.motionParts].filter(Boolean).join('\n\n')
}

/**
 * 剧本套用引擎
 */
class ScriptAdapter {
  /**
   * @param {object} opts
   * @param {object} opts.kit - loadFilmKit 结果
   * @param {object|null} [opts.llm] - 可选 LLM 润色器：{ enhance: async ({draftPrompt}) => string }
   * @param {object} [opts.log]
   */
  constructor (opts) {
    opts = opts || {}
    if (!opts.kit) throw new Error('ScriptAdapter 需要 kit（loadFilmKit 结果）')
    this.kit = opts.kit
    this.llm = opts.llm || null
    this.log = opts.log || null
  }

  /** 默认模板选择：kit 中全部已收录分镜按场景顺序循环 */
  _defaultTemplates () {
    return this.kit.shots
  }

  /**
   * 剧本套用主入口
   * @param {object} opts
   * @param {string} opts.script
   * @param {object} opts.characterMap
   * @param {Array<object>} [opts.templateShots] - 模板分镜（默认 kit 全部分镜）
   * @param {boolean} [opts.llmEnabled]
   * @returns {Promise<{ok: boolean, adaptedShots?: Array<object>, llmEnhanced?: boolean, error?: string, warnings?: string[]}>}
   */
  async adaptScript ({ script, characterMap, templateShots, llmEnabled }) {
    const scriptText = typeof script === 'string' ? script : ''
    if (!scriptText.trim()) return { ok: false, error: '剧本不能为空' }
    if (scriptText.length > MAX_SCRIPT_LENGTH) {
      return { ok: false, error: '剧本不能超过 ' + MAX_SCRIPT_LENGTH + ' 字（当前 ' + scriptText.length + '）' }
    }
    if (characterMap === undefined || characterMap === null || typeof characterMap !== 'object' || Array.isArray(characterMap)) {
      return { ok: false, error: '角色映射必须为对象' }
    }
    const keys = Object.keys(characterMap)
    if (keys.length > MAX_CHARACTER_MAP_KEYS) {
      return { ok: false, error: '角色映射最多 ' + MAX_CHARACTER_MAP_KEYS + ' 个键' }
    }
    for (const k of keys) {
      const v = characterMap[k]
      if (typeof v !== 'string' || !v.trim()) {
        return { ok: false, error: '角色映射[' + k + '] 必须为非空字符串' }
      }
    }
    const templates = Array.isArray(templateShots) && templateShots.length > 0
      ? templateShots
      : this._defaultTemplates()
    if (templates.length === 0) {
      return { ok: false, error: '没有可用模板分镜（kit 为空）' }
    }

    const beats = splitScript(scriptText)
    if (beats.length === 0) return { ok: false, error: '剧本无法分场（请用空行分隔场景）' }

    const adaptedShots = beats.map((beat, i) => {
      const template = templates[i % templates.length]
      const draft = buildTemplatePrompt({
        template,
        beatText: beat.text,
        characterMap,
      })
      return {
        shotId: 'adapt-' + String(i + 1).padStart(3, '0'),
        sceneId: beat.title ? normalizeSceneId(beat.title) : 'adapted-scene-' + String(i + 1).padStart(3, '0'),
        prompt: draft,
        model: template.model || 'seedance_2_0',
        refTokens: Array.isArray(template.refTokens) ? template.refTokens.slice(0, 8) : [],
        roleBindings: buildRoleBindings(characterMap),
        beatIndex: i,
        sourceTemplateId: template.shotId,
        llmEnhanced: false,
      }
    })

    const useLlm = llmEnabled === true && this.llm && typeof this.llm.enhance === 'function'
    if (!useLlm) {
      return { ok: true, adaptedShots, llmEnhanced: false }
    }

    let llmEnhanced = true
    let enhancedCount = 0
    const warnings = []
    const limit = Math.min(adaptedShots.length, DEFAULT_LLM_BATCH_LIMIT)
    for (let i = 0; i < limit; i++) {
      const shot = adaptedShots[i]
      try {
        const polished = await this.llm.enhance({ draftPrompt: shot.prompt, beat: beats[i] })
        if (typeof polished === 'string' && polished.trim()) {
          shot.prompt = polished.trim()
          enhancedCount += 1
        }
      } catch (e) {
        warnings.push('分镜 ' + shot.shotId + ' LLM 润色失败，使用本地模板结果: ' +
          (e instanceof Error ? e.message : String(e)))
      }
    }
    if (enhancedCount === 0) llmEnhanced = false
    return { ok: true, adaptedShots, llmEnhanced, warnings }
  }
}

function buildRoleBindings (characterMap) {
  const bindings = {}
  for (const k of Object.keys(characterMap || {})) {
    const v = characterMap[k]
    if (typeof v === 'string' && v.trim()) bindings[k] = v.trim()
  }
  return bindings
}

function normalizeSceneId (title) {
  return String(title || '')
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'adapted-scene'
}

module.exports = {
  MAX_SCRIPT_LENGTH,
  MAX_CHARACTER_MAP_KEYS,
  ScriptAdapter,
  splitScript,
  buildTemplatePrompt,
  buildTemplatePromptParts,
  buildMotionPrompt,
  buildRoleBindings,
  normalizeSceneId,
}

// @ts-check
'use strict'
/**
 * shot-prompt-task —— 影视工程 v2 · F-I「任务级提示词接入规划流程」
 *
 * 职责：**规划期**（零 provider 调用、零落盘）把「方法论资产」接到每镜上：
 *   ① 尾帧约束：取自 `prompt-doctrine.json` 的 `frame_constraint` 块（**外置**，随 kit 更新）。
 *      **只留哈希与长度，不留原文**（design D22）—— 方法论原文属提示词资产，
 *      落进用户项目文件会多出一条外发/日志面，而原文本来就在用户本地的 kit 里。
 *   ② 任务级提示词包：用 `prompt-library` 的 `generate_shot_prompt` 任务模板渲染
 *      （`system` 原文 = 7 块结构契约；`user` 按 7 个变量渲染），
 *      并给出**缺失分级清单**与**机器可判字段**（`deliverable` / `blockedVars`）。
 *
 * 契约见 `openspec/changes/film-pipeline-prompt-triple-and-guards/design.md` D20 / D21 / D22。
 *
 * **为什么本模块不调 LLM**：`generate_shot_prompt` 是 LLM 任务模板（system 要求模型输出 JSON），
 * 而 `planAutoShots` 的契约是「零 provider 调用、零落盘」，且成本闸（F-B 就绪度）在 PR-5 才落地
 * ⇒ 在规划期调 LLM 就是「**没有闸的花钱**」。本模块只做**渲染与变量装配**，
 * `deliverable` 字段告诉后续消费方「这份文本能不能直送模型」。
 *
 * **缺失必须可区分**（否则消费方分不清「设计上不填」与「资产缺口」）：
 *   - `byDesign`     —— 设计上不填（`style_prefix`）：**不提供**该变量 ⇒ 渲染文本保留 `{{var}}` 原样；
 *   - `assetMissing` —— 资产缺口（`geo_block`）：提供**空串** ⇒ 渲染文本里不留占位符；
 *   - `templateVar`  —— 模板要但我们没给的变量；
 *   - `badVarName`   —— 我们给的变量名不合规（视为实现缺陷）。
 *
 * **确定性分两级**（design D22）：
 *   - `promptAssetHash`（plan 级）= **提示词资产面**（doctrine + 任务原文 + locale + 回退事实）；
 *   - `promptRenderHash`（逐镜） = 渲染面（固定键序的 vars 摘要 + locale）。
 *   两者**不能合并**：同资产的**不同镜**渲染结果本就不同（逐镜 vars 不同）⇒
 *   「资产哈希相同 ⇒ 渲染逐字相同」是**假命题**，逐镜相等要靠 promptRenderHash。
 *
 * **第 8 轮评审 i1（Critical/consistency）：哈希的「域」必须写准** ——
 * `promptAssetHash` 覆盖的是**提示词资产**（doctrine + 任务模板），
 * **不含**色盘、角色描述、逐镜时长/模型（那些是逐镜输入，由 `promptRenderHash` 覆盖）。
 * ⇒ 「换了色盘 ⇒ 提示词资产哈希会变」是**假命题**；色盘变了是**逐镜渲染哈希**变。
 *   字段名因此从 `promptAssetHash` 改名为 `promptAssetHash`（旧名会让人以为覆盖全部资产）。
 *
 * **第 8 轮评审 i8（Warning/security）：kit 是不可信输入** ——
 * `userData/film-kit` 可被用户或外部进程写入，kit-loader 只校验**结构**、不校验块文本长度。
 * ⇒ 流入提示词的 kit 自由文本（色盘行、角色描述）**必须设长度上限**，
 *   超限**不提供**该变量（⇒ 进 `missing` / `deliverable=false`），
 *   **绝不静默截断**（截断会把「资产异常」伪装成「资产正常」）。
 */

const crypto = require('crypto')
const { getTaskPrompts, renderTemplate } = require('./prompt-library')

/** 任务名（`prompts/tasks/<taskId>/{zh,en}/{system,user}.md`） */
const SHOT_PROMPT_TASK_ID = 'generate_shot_prompt'
/** 尾帧约束的长度上限（与既有单字段上限同值，**不放宽**） */
const MAX_END_FRAME_LEN = 50000
/**
 * **流入提示词的 kit 自由文本的长度上限**（第 8 轮评审 i8：kit 不可信）。
 *
 * 色盘行与角色描述来自 `userData/film-kit`（用户/外部进程可写），kit-loader 只校验结构、
 * 不校验块文本长度 ⇒ 一个 10MB 的 `paletteLine` 会直接进逐镜 `promptVars`（落项目文件）。
 * ⇒ 超限**不提供**该变量（进 `missing` ⇒ `deliverable=false`），**不静默截断**。
 */
const MAX_KIT_VAR_LEN = 20000
/**
 * **逐镜字段的长度上限**（第 8 轮 i8 的同一条纪律，落到 `shot_json` 上）。
 *
 * `shot_json` 把镜头的 `title` / `characterNames` / `model` **原样**送进提示词，
 * 而这些字段来自**用户可编辑的项目文件**（同样是不可信输入）⇒ 与 kit 自由文本同一条纪律。
 * 超限 ⇒ **不提供** `shot_json`（⇒ 进 `missing` ⇒ `deliverable=false`），**不静默截断**。
 */
const MAX_SHOT_FIELD_LEN = 2000
/** 变量名（与 `generate_shot_prompt/user.md` 的 `{{var}}` 一一对应） */
const TASK_VARS = Object.freeze([
  'shot_json',
  'palette_line',
  'style_prefix',
  'geo_block',
  'character_descriptors',
  'duration_sec',
  'model',
])
/**
 * **设计上不填**的变量（不提供 ⇒ 渲染文本保留占位符）。
 *
 * `style_prefix`：没有资产形态（doctrine 的 `style` 块是规则描述，示例值不是可粘贴的资产）。
 * `geo_block`：**本批次不取**（跨模板取 GEO 块的选取规则未定义 —— 第 17 轮 i3 改判；
 *   原先归 `assetMissing` 会说成「资产里没有」，与事实不符）。
 */
const BY_DESIGN_VARS = Object.freeze(['style_prefix', 'geo_block'])
/** 缺失原因（闭集，消费方按它分派处置） */
const REASON_BY_DESIGN = 'byDesign'
const REASON_ASSET_MISSING = 'assetMissing'
const REASON_TEMPLATE_VAR = 'templateVar'
const REASON_BAD_VAR_NAME = 'badVarName'
/**
 * **第五类缺失原因**：变量**超长**（第 9 轮 i4）。
 *
 * 前四类都回答「这个变量**是什么**」，唯独「太大」是另一回事 ——
 * 把超长变量混进 `assetMissing` 会让面板显示「资产缺口（该资产尚未提供）」，
 * 而事实是「资产**有**，但太大，装不进提示词」。
 * ⇒ 独立一类 `oversizeVar`：**不静默截断**（截断会把「资产异常」伪装成「资产正常」），
 *   不提供该变量 ⇒ `deliverable=false`。
 */
const REASON_OVERSIZE_VAR = 'oversizeVar'
/** 尾帧约束的**来源**取值（闭集；第 13 轮 i5：source 来自 kit，必须有定义） */
const FRAME_CONSTRAINT_SOURCE = 'doctrine.frame_constraint'
/** 「**没有**任务模板」的显式标记（第 14 轮 i8：空串与「真·空模板」必须可区分） */
const ABSENT_TEMPLATE = '<absent>'
/** 哈希的序列化版本号：改键序/字段时 +1（v2：逐镜渲染哈希**加进**缺失清单，第 14 轮 i2） */
const HASH_VERSION = 'v2'
/** 回退来源分组（design D22：扁平列表分不清是 doctrine/palette/task 哪一处回退） */
const FALLBACK_SOURCES = Object.freeze(['doctrine', 'palette', 'task'])

/**
 * **长度前缀拼接**（避免 `a=bc` 与 `ab=c` 这类拼接碰撞）。
 * @param {Array<[string, string]>} pairs
 * @returns {string}
 */
function joinLengthPrefixed (pairs) {
  const parts = []
  for (const [k, v] of pairs) {
    const key = String(k)
    const val = String(v)
    parts.push(key.length + ':' + key + '=' + val.length + ':' + val)
  }
  return parts.join('|')
}

/**
 * 取双语对象的指定语种，**缺该语种回退 zh**（design D21.3 的统一回退函数）。
 * @param {any} obj - {zh, en}
 * @param {string} locale
 * @returns {{text: string, fallback: boolean, resolved: string}}
 */
function pickLocaleText (obj, locale) {
  const loc = locale === 'en' ? 'en' : 'zh'
  const o = obj && typeof obj === 'object' ? obj : {}
  const primary = typeof o[loc] === 'string' && o[loc].trim() ? o[loc] : ''
  if (primary) return { text: primary, fallback: false, resolved: loc }
  const zh = typeof o.zh === 'string' && o.zh.trim() ? o.zh : ''
  if (!zh) return { text: '', fallback: false, resolved: loc }
  return { text: zh, fallback: true, resolved: 'zh' }
}

/**
 * 尾帧约束（**plan 级**，design D21.1）：来源**只有** doctrine 的 `frame_constraint` 块。
 *
 * 另一条路径（`generate_shot_prompt` 的尾帧铁律）要 LLM 才产出，而规划期零 provider ⇒ 不可达；
 * 两条都写会得到「一个来源、两个真相」。
 *
 * **只返回哈希与长度，不返回原文**（design D22）：方法论原文属提示词资产，
 * 落进用户项目文件会多出一条外发/日志面；原文本来就在用户本地的 kit 里，需要时按 kit 读。
 *
 * @param {object} opts
 * @param {any} [opts.doctrine] - kit.doctrine（可为 null）
 * @param {string} [opts.locale] - zh / en
 * @param {number} [opts.maxLen] - 长度上限（默认 MAX_END_FRAME_LEN）
 * @returns {{available: boolean, hash: string, length: number, locale: string, fallback: boolean, truncated: boolean, source: string,
 *            originalHash: string, originalLength: number}}
 */
function buildEndFrameConstraint (opts) {
  const o = opts || {}
  const doctrine = o.doctrine
  const locale = o.locale === 'en' ? 'en' : 'zh'
  const empty = {
    available: false, hash: '', length: 0, locale, fallback: false, truncated: false,
    source: FRAME_CONSTRAINT_SOURCE, originalHash: '', originalLength: 0,
  }
  if (!doctrine || !Array.isArray(doctrine.blocks)) return empty
  const block = doctrine.blocks.find((b) => b && b.key === 'frame_constraint')
  if (!block) return empty
  const picked = pickLocaleText(block, locale)
  if (!picked.text) return empty
  const maxLen = Number.isInteger(o.maxLen) && o.maxLen > 0 ? o.maxLen : MAX_END_FRAME_LEN
  const truncated = picked.text.length > maxLen
  let text = picked.text
  if (truncated) {
    text = picked.text.slice(0, maxLen)
    // ⚠ 不切开代理对（第 14 轮 i6）：截断点落在高/低代理之间会留下半个 emoji
    //   （确定性不受影响 —— 同输入同输出 —— 但**显示**是坏的）
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdfff) text = text.slice(0, text.length - 1)
  }
  return {
    available: true,
    // hash 与 length 描述**同一个对象**：都是**截断后**的文本（第 8 轮评审 i2 澄清）。
    hash: crypto.createHash('sha256').update(text).digest('hex'),
    length: text.length,
    locale: picked.resolved,
    fallback: picked.fallback,
    truncated,
    source: FRAME_CONSTRAINT_SOURCE,
    // 截断**前**的原文指纹：没有它，截断点之后的改动**不可见**
    // （两段前 50000 字相同、后半不同的文本，哈希完全一样）。
    originalHash: crypto.createHash('sha256').update(picked.text).digest('hex'),
    originalLength: picked.text.length,
  }
}

/**
 * 装配 7 个任务变量（缺失四分类在这里产生 —— design D21.3）。
 *
 * @param {object} opts
 * @param {any} [opts.shot] - 本镜
 * @param {any} [opts.kit] - kit（取 palette / manifest.filmMeta.characters）
 * @param {string} [opts.locale]
 * @param {number} [opts.durationSec] - 本镜时长（秒）
 * @returns {{vars: Record<string, string>, missing: Array<{name: string, reason: string}>, fallbacks: Record<string, string>}}
 */
function buildShotTaskVars (opts) {
  const o = opts || {}
  const shot = o.shot && typeof o.shot === 'object' ? o.shot : {}
  const kit = o.kit && typeof o.kit === 'object' ? o.kit : {}
  const locale = o.locale === 'en' ? 'en' : 'zh'
  /** @type {Record<string, string>} */
  const vars = {}
  /** @type {Array<{name: string, reason: string}>} */
  const missing = []
  /** @type {Record<string, string>} */
  const fallbacks = {}
  /** 超长而**不提供**的变量（第 9 轮 i4：独立一类 `oversizeVar`，不混进 `assetMissing`） */
  const oversizeVars = new Set()

  // ① shot_json：**固定键序**（design D22 —— 键序变了哈希就变）
  //    ⚠ 逐镜字段同样是不可信输入（第 8 轮 i8）⇒ 超上限就**不提供** `shot_json`。
  const shotTitle = typeof shot.title === 'string' ? shot.title : ''
  const shotModel = typeof shot.model === 'string' ? shot.model : ''
  const shotChars = Array.isArray(shot.characterNames)
    ? shot.characterNames.filter(n => typeof n === 'string')
    : []
  const shotFieldsOk =
    shotTitle.length <= MAX_SHOT_FIELD_LEN &&
    shotModel.length <= MAX_SHOT_FIELD_LEN &&
    shotChars.every(n => n.length <= MAX_SHOT_FIELD_LEN)
  if (shotFieldsOk) {
    vars.shot_json = JSON.stringify({
      index: shot.index === undefined ? null : shot.index,
      shotId: shot.shotId === undefined ? null : shot.shotId,
      title: shotTitle,
      beatIndex: shot.beatIndex === undefined ? null : shot.beatIndex,
      characterNames: shotChars,
      model: shotModel,
    })
  } else {
    oversizeVars.add('shot_json')
  }

  // ② palette_line：kit 色盘声明（缺该语种回退 zh）
  //    ⚠ kit 不可信（第 8 轮 i8）⇒ 超上限**不提供**（⇒ assetMissing ⇒ deliverable=false），
  //    **不静默截断**（截断会把「资产异常」伪装成「资产正常」）。
  const pickedPalette = pickLocaleText(kit.palette && kit.palette.paletteLine, locale)
  // ⚠ 净化**先于**长度判定（第 15 轮 i3）：否则「先判长、后净化」会漏
  const paletteText = sanitizeUntrustedText(pickedPalette.text)
  if (paletteText && paletteText.length <= MAX_KIT_VAR_LEN) {
    vars.palette_line = paletteText
    if (pickedPalette.fallback) fallbacks.palette_line = pickedPalette.resolved
  } else if (paletteText) {
    oversizeVars.add('palette_line')
  } else {
    // ⚠ **资产缺失** ⇒ 提供**空串**（⇒ 渲染为空、**不留占位符**），与 `assetMissing` 的语义一致（第 17 轮）
    //   —— 不提供的话渲染文本会留着 `{{palette_line}}`，那与「assetMissing ⇒ 渲染为空串」的口径**矛盾**。
    vars.palette_line = ''
  }

  // ③ style_prefix：**设计上不填**（无资产源）⇒ 不提供 ⇒ 渲染文本保留 `{{style_prefix}}`
  missing.push({ name: 'style_prefix', reason: REASON_BY_DESIGN })

  // ④ geo_block：**本批次不取**（第 17 轮 i3）——
  //    跨模板取 GEO 块的**选取规则未定义**（kit 存量 153 模板里只有 1 个带 GEO 块，取它得先定「取哪个模板的块」），
  //    所以「缺」的不是资产，而是**我们决定不取** ⇒ 归 **byDesign**（与 style_prefix 同类），
  //    **不是** assetMissing（那会说成「资产里没有」—— 与事实不符）。
  //    不提供 ⇒ 渲染文本保留 `{{geo_block}}` 原样（用户能看出「这个槽位没接上」）。
  missing.push({ name: 'geo_block', reason: REASON_BY_DESIGN })

  // ⑤ character_descriptors：manifest 里的角色身份描述符（逐字粘贴，不得缩写）
  //    ⚠ kit 不可信（第 8 轮 i8）⇒ **合计长度**超上限就**整个变量不提供**
  //    （部分提供会产出「看着完整、其实缺角色」的提示词，比不提供更危险）。
  //    ⚠ 上限是**拼接后合计**（第 14 轮 i1）—— 逐角色各判一次会让 N 个角色把上限乘 N 倍，
  //    而「单镜落盘体积」那条上限的余量推导就失效了。
  const chars = kit.manifest && kit.manifest.filmMeta && Array.isArray(kit.manifest.filmMeta.characters)
    ? kit.manifest.filmMeta.characters
    : []
  const descs = []
  let descsTooLong = false
  for (const c of chars) {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) continue
    const d = sanitizeUntrustedText(typeof c.descriptor === 'string' ? c.descriptor : '').trim()
    if (!d) continue
    const line = c.name.trim() + '：' + d
    descs.push(line)
  }
  const descsJoined = descs.length ? descs.join('\n') : ''
  if (descsJoined.length > MAX_KIT_VAR_LEN) descsTooLong = true
  if (descs.length && !descsTooLong) vars.character_descriptors = descsJoined
  else if (descsTooLong) oversizeVars.add('character_descriptors')
  else {
    // ⚠ 同上：资产**缺失** ⇒ 提供**空串**（⇒ 渲染为空、不留占位符）
    vars.character_descriptors = ''
  }

  // ⑥ duration_sec：逐镜时长
  const dur = Number(o.durationSec)
  vars.duration_sec = Number.isFinite(dur) && dur > 0 ? String(dur) : ''

  // ⑦ model：本镜模型
  vars.model = typeof shot.model === 'string' ? shot.model : ''

  // 资产缺口：拿到空串的变量（byDesign 除外）⇒ 进清单
  //   ⚠ 超长的变量**不算**「资产缺口」⇒ 独立一类 `oversizeVar`（第 9 轮 i4）
  for (const name of TASK_VARS) {
    if (BY_DESIGN_VARS.includes(name)) continue
    if (oversizeVars.has(name)) {
      missing.push({ name, reason: REASON_OVERSIZE_VAR })
      continue
    }
    if (typeof vars[name] !== 'string' || vars[name] === '') {
      missing.push({ name, reason: REASON_ASSET_MISSING })
    }
  }

  // ⚠ **闸门在产出源**（第 17 轮 i7 的要害）：**落盘**的清单来自这里（不是来自渲染路径）⇒
  //   若只在这里不截断，模板要 100 个变量就会把 100 条写进**逐镜项目文件**。
  const capped = capMissingList(missing)
  return { vars, missing: capped.list, fallbacks, truncated: capped.truncated }
}

/**
 * 清单闸门（条目数 + 字节数两道，第 14 轮 i3 / 第 15-16 轮 i2）。
 * **实现里的闸门**，不是测试里的断言。
 */
function capMissingList (list) {
  const taskVarEntries = list.filter(m => TASK_VARS.includes(m.name))
  const otherEntries = list.filter(m => !TASK_VARS.includes(m.name))
  const kept = taskVarEntries.concat(otherEntries.slice(0, MAX_MISSING_ENTRIES))
  const out = kept.slice()
  while (out.length > taskVarEntries.length &&
    Buffer.byteLength(JSON.stringify(out), 'utf8') > MAX_MISSING_BYTES) {
    out.pop()
  }
  return { list: out, truncated: out.length < list.length }
}

/** 缺失原因的**变量名**的长度上限（第 12 轮 i5 · security） */
const MAX_MISSING_NAME_LEN = 64

/**
 * **清单里非任务变量条目的硬上限**（第 14 轮 i3 · feasibility）。
 *
 * 模板是**不可信**输入 ⇒ 它可以要 100 个变量 ⇒ 清单会被撑爆。
 * 「清单 ≤ 1,024 字节」与「非任务条目 ≤ 8」必须是**闸门**（实现里强制），
 * 而不只是**断言**（测试里查）—— 断言在实现没做时只会红，而**闸门**才是防线。
 */
const MAX_MISSING_ENTRIES = 8

/**
 * **清单的字节预算**（第 14 轮 i2 / 第 15 轮 i2 / 第 16 轮 i2）。
 *
 * 推导（三次修正，**每次都因为算漏了东西**）：
 * ① 第 14 轮：「8 × (64 字符名 + 开销) ≈ 560 B < 1 KiB」⇒ **漏算**了 7 条任务变量（总 15 条）**与 CJK 的 3 字节/字**。
 * ② 第 15 轮：改按 15 × (192 B 名 + 30 B) ≈ 3.3 KB ⇒ 预算提到 **4 KiB** ⇒ **又漏算**了 **JSON 转义**：
 *    名字里含引号/反斜杠时按 `\uXXXX` 记 **6 字节/字** ⇒ 单条最坏 ≈ 64×6 + 30 ≈ 414 B ⇒ 15 条 ≈ 6.2 KB > 4 KiB。
 * ③ 第 16 轮：预算提到 **8 KiB**（15 × 414 ≈ 6.2 KB < 8 KB）⇒ 这次把**转义**也算进去了。
 * ⚠ 名字的**控制字符已在落盘前剥除**（`sanitizeUntrustedText`）⇒ 最坏转义只剩引号/反斜杠。
 */
const MAX_MISSING_BYTES = 8192

/**
 * 剥除**控制字符**与**零宽字符**（第 13/15 轮 i5/i3 · security）。
 *
 * kit 自由文本（色盘行、角色描述）与模板带来的变量名都来自**不可信**输入：
 * 控制字符能破坏提示词结构，零宽字符能**藏**内容（肉眼看不见、日志里也不显眼）⇒ 两样都剥掉。
 * ⚠ 长度上限按**净化后**的文本计（否则「先判长、后净化」会漏）。
 */
function sanitizeUntrustedText (s) {
  return String(s == null ? '' : s)
    // C0 / C1 控制字符（含换行与 DEL）
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    // 零宽与方向控制（U+200B-200F、U+202A-202E、U+2060-2064、U+FEFF、BOM）
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
}

/**
 * 变量名截断到上限 + 剥除控制字符（第 12 轮 i5 / 第 13 轮 i5 / 第 15 轮 i3）。
 *
 * `templateVar` / `badVarName` 的名字来自**kit 任务模板**（不可信输入）⇒
 * 一个超长名字会把清单撑爆（它**落盘**）；一个带**控制字符/换行**的名字会把
 * UI 与日志搅乱（面板按名字分行渲染，日志按行打印）⇒ 两样都要处理。
 *
 * 截断后仍能定位（首 63 字符 + 省略号），`reason` 仍说明发生了什么。
 */
function clampVarName (name) {
  const raw = typeof name === 'string' ? name : String(name == null ? '' : name)
  let s = sanitizeUntrustedText(raw)
  if (s.length <= MAX_MISSING_NAME_LEN) return s
  // ⚠ 不切开代理对（第 14 轮 i6）：截断点落在**高/低代理**之间会留下半个 emoji
  //   （确定性不受影响 —— 同输入同输出 —— 但**显示**是坏的）
  // ⚠ 截断长度**要把后缀算进去**（第 16 轮 i7）：`…` 1 + `#` 1 + 哈希 6 = 8
  const SUFFIX_LEN = 8
  let cut = s.slice(0, MAX_MISSING_NAME_LEN - SUFFIX_LEN)
  const last = cut.charCodeAt(cut.length - 1)
  // 末位是**代理**（高 0xD800-0xDBFF 或低 0xDC00-0xDFFF）⇒ 它的另一半被切掉了 ⇒ 去掉这半个
  if (last >= 0xd800 && last <= 0xdfff) cut = cut.slice(0, cut.length - 1)
  // ⚠ 截断后**加短哈希后缀**（第 16 轮 i7）：两个不同的长名字可能前 63 字相同 ⇒
  //   截断后**同名** ⇒ 面板按 name+reason 去重会把两条并成一条 ⇒ 条目数与清单不一致。
  //   加 6 位哈希 ⇒ 名字仍可读，但**唯一**。
  const suffix = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 6)
  return cut + '…#' + suffix
}

/**
 * 渲染「任务级提示词包」。
 *
 * `deliverable === false` ⇒ 渲染文本**不可直送模型**（有占位符或资产缺口）——
 * 消费方必须先校验该字段（design D21.3）。
 *
 * @param {object} opts
 * @param {any} opts.library - kit.promptLibrary
 * @param {Record<string, string>} [opts.vars]
 * @param {Array<{name: string, reason: string}>} [opts.missing]
 * @param {string} [opts.locale]
 * @param {string} [opts.taskId]
 * @returns {{ok: boolean, error?: string, taskId: string, locale: string, system: string, user: string,
 *            renderText: string, missing: Array<{name: string, reason: string}>,
 *            deliverable: boolean, blockedVars: Array<{name: string, reason: string}>}}
 */
function buildShotTaskPrompt (opts) {
  const o = opts || {}
  const taskId = typeof o.taskId === 'string' && o.taskId ? o.taskId : SHOT_PROMPT_TASK_ID
  const locale = o.locale === 'en' ? 'en' : 'zh'
  const base = {
    ok: false,
    taskId,
    locale,
    system: '',
    user: '',
    renderText: '',
    missing: [],
    deliverable: false,
    blockedVars: [],
  }
  // 任务模板的语种回退：en 缺失 ⇒ 回落 zh（与 doctrine/palette 同一套回退规则）
  let prompts = getTaskPrompts(o.library, taskId, locale)
  let taskFallback = false
  if (!prompts.ok && locale === 'en') {
    const zh = getTaskPrompts(o.library, taskId, 'zh')
    if (zh.ok) { prompts = zh; taskFallback = true }
  }
  if (!prompts.ok) {
    return Object.assign({}, base, { error: prompts.error })
  }
  const vars = o.vars && typeof o.vars === 'object' ? o.vars : {}
  /** @type {Array<{name: string, reason: string}>} */
  const missing = Array.isArray(o.missing) ? o.missing.slice() : []
  const rendered = renderTemplate(prompts.user, vars)
  // 模板要但我们没给的变量（templateVar）
  //
  // ⚠ **条目数与字节数的硬闸门**（第 14 轮 i3 / 第 16 轮 i2 · Critical/feasibility）：
  // 模板是**不可信**输入 ⇒ 它可以要 100 个变量 ⇒ 清单会被撑爆
  // （「清单 ≤ 字节预算」与「非任务条目 ≤ 8」两条上限都会被击穿 —— 那是**断言**，不是**闸门**）。
  // ⇒ 这里做**强制闸门**：超出上限的条目**不落清单**（`deliverable` 仍为 false ⇒ 照样拦住直送）。
  // 闸门**两道**：条目数 + **序列化字节数**（名字含引号/反斜杠时 JSON 转义按 6 字节/字算）。
  const capMissing = (list) => capMissingList(list).list
  for (const name of rendered.missing) {
    if (missing.some(m => m.name === name)) continue
    missing.push({ name: clampVarName(name), reason: REASON_TEMPLATE_VAR })
  }
  // 我们给的变量名不合规（badVarName）——视为实现缺陷，同样拦住直送
  for (const name of rendered.unknownVars) {
    if (missing.some(m => m.name === name)) continue
    missing.push({ name: clampVarName(name), reason: REASON_BAD_VAR_NAME })
  }
  const cappedMissing = capMissing(missing)
  // 清单**被截断**了吗（第 17 轮 i7）：截断了 ⇒ 面板要说一句「还有未显示的」，
  // 否则用户看到的 blockedVars 少于真实数量（缺口被**静默丢弃**）。
  const truncated = cappedMissing.length < missing.length
  return {
    ok: true,
    taskId,
    locale,
    system: prompts.system,
    user: prompts.user,
    renderText: rendered.text,
    missing: cappedMissing,
    deliverable: missing.length === 0,
    blockedVars: cappedMissing.slice(),
    truncated,
    taskFallback,
  }
}

/**
 * **plan 级提示词资产哈希**（design D22 / 第 8 轮 i1）：覆盖**提示词资产面**
 * （doctrine + 任务原文 + locale + 回退事实）。
 *
 * **它的域是有边界的**（第 8 轮 i1 · Critical/consistency）：
 * ✅ 覆盖：doctrine、任务模板 system/user、语种、回退事实 —— 这些是**提示词资产**。
 * ❌ **不**覆盖：色盘行、角色描述、逐镜时长/模型 —— 那些是**逐镜输入**，
 *    由 `promptRenderHash` 覆盖。
 * ⇒ 「换了色盘 ⇒ 提示词资产哈希会变」是**假命题**（色盘变了是**逐镜渲染哈希**变）。
 *    旧名 `assetHash` 会让人以为覆盖全部资产 ⇒ 已改名 `promptAssetHash`。
 *
 * 它回答「**提示词资产**变没变」，**不**回答「某镜的渲染变没变」——后者靠 `promptRenderHash`。
 *
 * @param {object} opts
 * @param {any} [opts.doctrine]
 * @param {string} [opts.system]
 * @param {string} [opts.user]
 * @param {string} [opts.locale]
 * @param {Record<string, string>} [opts.fallbacks] - 按来源分组的回退事实
 * @returns {string} 十六进制哈希（无输入 ⇒ 空串）
 */
function computePromptAssetHash (opts) {
  const o = opts || {}
  let doctrineText = ''
  if (o.doctrine && typeof o.doctrine === 'object') {
    try { doctrineText = JSON.stringify(o.doctrine) } catch (e) { doctrineText = '' }
  }
  const fb = o.fallbacks && typeof o.fallbacks === 'object' ? o.fallbacks : {}
  const fbPairs = []
  for (const src of FALLBACK_SOURCES) {
    const sub = fb[src] && typeof fb[src] === 'object' ? fb[src] : {}
    for (const k of Object.keys(sub).sort()) fbPairs.push([src + '.' + k, sub[k]])
  }
  const pairs = [
    ['version', HASH_VERSION],
    ['locale', o.locale === 'en' ? 'en' : 'zh'],
    ['fallbacks', joinLengthPrefixed(fbPairs)],
    ['doctrine', doctrineText],
    // ⚠ 缺模板用**显式标记**（第 14 轮 i8）：空串与「真·空模板」会同哈希 ⇒ 不可区分。
    ['system', typeof o.system === 'string' ? o.system : ABSENT_TEMPLATE],
    ['user', typeof o.user === 'string' ? o.user : ABSENT_TEMPLATE],
  ]
  return crypto.createHash('sha256').update(joinLengthPrefixed(pairs)).digest('hex')
}

/**
 * **逐镜渲染哈希**（design D22 / 第 14 轮 i2）：覆盖**渲染面**（固定键序的 vars + locale + **缺失清单**）。
 *
 * ⇒ 同一镜、同一资产 ⇒ `promptRenderHash` 相同 ⇒ 渲染**逐字相同**；
 * 不同镜的 `promptRenderHash` 本就不同（逐镜 vars 不同）⇒ 不能用 `promptAssetHash` 代替。
 *
 * ⚠ **缺失清单必须参与**（第 14 轮 i2 · Critical/consistency）：
 * 只哈希「已提供」的变量时，「变量**超限**」与「变量**根本没有**」会得到**同一个哈希**
 * （两者都不在 vars 里）⇒ 不可区分。
 * ⇒ 缺失项按 `name + reason` 的**规范形式**参与拼接 ⇒ 缺失态与提供态哈希**必然不同**。
 *
 * @param {object} opts
 * @param {Record<string, string>} [opts.vars]
 * @param {Array<{name: string, reason: string}>} [opts.missing]
 * @param {string} [opts.locale]
 * @returns {string} 十六进制哈希
 */
function computePromptRenderHash (opts) {
  const o = opts || {}
  const vars = o.vars && typeof o.vars === 'object' ? o.vars : {}
  const missing = Array.isArray(o.missing) ? o.missing : []
  const pairs = [
    ['version', HASH_VERSION],
    ['locale', o.locale === 'en' ? 'en' : 'zh'],
  ]
  for (const k of Object.keys(vars).sort()) pairs.push([k, vars[k]])
  // 缺失项：按 name + reason 排序后参与（区分「超限」与「没有」——第 14 轮 i2）
  const missPairs = missing
    .map(m => [String(m && m.name), String(m && m.reason)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1)))
  for (const [name, reason] of missPairs) pairs.push(['missing:' + name, reason])
  return crypto.createHash('sha256').update(joinLengthPrefixed(pairs)).digest('hex')
}

/**
 * 规划期的**方法论接线**（plan 级，design D21.1/D21.2/D21.4/D22）。
 *
 * @param {object} opts
 * @param {any} [opts.kit] - kit 上下文（{doctrine, palette, promptLibrary, manifest}）
 * @param {string} [opts.locale]
 * @returns {{promptContext: object, warnings: Array<object>}}
 */
function buildPlanPromptContext (opts) {
  const o = opts || {}
  const kit = o.kit && typeof o.kit === 'object' ? o.kit : null
  const locale = o.locale === 'en' ? 'en' : 'zh'
  const warnings = []

  const frame = buildEndFrameConstraint({ doctrine: kit && kit.doctrine, locale })
  if (!frame.available) {
    warnings.push({
      code: 'W10',
      message: '影视工程资产缺少提示词方法论（prompt-doctrine）⇒ 尾帧约束未接入，'
        + '逐镜尾帧提示词仍为空。资产补齐入口尚未提供（见 PR-3b）。',
    })
  }
  const library = kit && kit.promptLibrary
  const prompts = library
    ? buildShotTaskPrompt({ library, vars: {}, missing: [], locale })
    // ⚠ 没有模板 ⇒ system/user 用 **null**（不是空串）⇒ 哈希里落**显式标记**（第 14 轮 i8）
    : { ok: false, error: '提示词任务库不可用', system: null, user: null, taskFallback: false }
  if (!prompts.ok) {
    warnings.push({
      code: 'W11',
      message: '影视工程资产缺少任务级提示词库（prompts/tasks）⇒ 任务模板未接入。'
        + '资产补齐入口尚未提供（见 PR-3b）。',
    })
  }
  /** @type {Record<string, Record<string, string>>} */
  const fallbacks = { doctrine: {}, palette: {}, task: {} }
  if (frame.fallback) fallbacks.doctrine.frame_constraint = frame.locale
  if (prompts.taskFallback) fallbacks.task.task = 'zh'
  const promptContext = {
    taskId: SHOT_PROMPT_TASK_ID,
    // 任务模板库是否真的接上了（缺库时 taskId 仍在，但没有可渲染的原文）
    taskAvailable: prompts.ok === true,
    locale,
    promptAssetHash: computePromptAssetHash({
      doctrine: kit && kit.doctrine,
      system: prompts.system,
      user: prompts.user,
      locale,
      fallbacks,
    }),
    // 尾帧约束：只留哈希与长度，**不留原文**（design D22：原文属提示词资产，不落用户项目文件）
    frameConstraint: frame,
    // 本批次**不逐镜派生**尾帧文本（要 LLM）⇒ 规则已接入、逐镜待派生，如实标注
    frameConstraintPending: true,
    fallbackLocales: fallbacks,
    // 资产不完整（不是「导出被阻断」—— 本 PR 根本没有导出入口，design D22）
    assetsIncomplete: warnings.length > 0,
  }
  return { promptContext, warnings }
}

module.exports = {
  SHOT_PROMPT_TASK_ID,
  MAX_END_FRAME_LEN,
  MAX_KIT_VAR_LEN,
  MAX_SHOT_FIELD_LEN,
  TASK_VARS,
  BY_DESIGN_VARS,
  REASON_BY_DESIGN,
  REASON_ASSET_MISSING,
  REASON_TEMPLATE_VAR,
  REASON_BAD_VAR_NAME,
  REASON_OVERSIZE_VAR,
  MAX_MISSING_NAME_LEN,
  MAX_MISSING_ENTRIES,
  MAX_MISSING_BYTES,
  FRAME_CONSTRAINT_SOURCE,
  ABSENT_TEMPLATE,
  HASH_VERSION,
  FALLBACK_SOURCES,
  pickLocaleText,
  buildEndFrameConstraint,
  buildShotTaskVars,
  buildShotTaskPrompt,
  computePromptAssetHash,
  computePromptRenderHash,
  buildPlanPromptContext,
  clampVarName,
}

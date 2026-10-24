// @ts-check
'use strict'
/**
 * auto-beat-splitter —— 分镜切分与**台词容量契约**（PRD `01-docs/PRD-FILM-AUTO-LONGFORM-2026-10-24.md`）
 *
 * 为什么独立成模块（三条理由，缺一不可）：
 *   ① **行数硬约束**：`auto-plan.js` 是逐文件行数门禁的对象（上限 500），
 *      新逻辑必须落在新文件（PRD R13 的「新逻辑一律进新文件」纪律）。
 *   ② **同源复用**：R14 要求「按字数拆句」与 R3 档 2 的「按台词容量拆」**共用同一个拆镜器**，
 *      避免两套拆法产生不同的分镜集 ⇒ 容量判定与切分逻辑必须住在同一处。
 *   ③ **单一真源**：`splitIntoChunks` 的碎片处理、容量基准、容差口径三件事互相依赖
 *      （碎片会让整段判为不可拆 ⇒ 少产镜数；容量判定决定要不要拦）⇒ 放一起才不会漂。
 *
 * 本模块只做**纯函数**，不碰 IO、不碰 provider、不依赖 electron ⇒ 可零依赖单测。
 */

/** 切块后的最小可独立成块长度（与 auto-plan 的可拆判据同源） */
const MIN_SENTENCE_CHUNK_LENGTH = 2

/** 档位吸附容差（秒）——**从 `shot-duration.js` 导入**（不另写字面量）：
 *  两处必须同容差，否则会出现「吸附当它合法、容量判定却拦下它」的自相矛盾；
 *  而两处各写一个字面量就等于把这个「必须同源」变成一句空话（改一处不会同步另一处）。 */
const { DEFAULT_SNAP_TOLERANCE_SEC } = require('./shot-duration')

/**
 * 按句末标点切块（保留标点在前块）
 *
 * ⚠️ **碎片并回**（2026-10-24，M0′.4 实测修复）：
 * 切块后可能出现长度 < MIN_SENTENCE_CHUNK_LENGTH 的碎片（最典型是末尾的 `」`，
 * 它会单独成块、长度 1）。而可拆判据是「每块都 ≥ MIN_SENTENCE_CHUNK_LENGTH」
 * ⇒ **一个碎片会让整段判为不可拆** ⇒ 用户明明写了句号却拆不开，
 * 规划**静默少产镜数**（实测：`「他站在雨里。他把信塞进信封。他转身离开。」` 目标 4 镜只出 1 镜）。
 *
 * 修法：把碎片并回**前一块**（保序、不丢字、不造空块）。
 * ⚠️ 只并**尾部/中部**的碎片（`merged.length > 0`）——首块若是碎片，前面没有块可并，保留原样。
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoChunks (text) {
  const raw = String(text || '').match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || []
  const chunks = raw.map((s) => s.trim()).filter((s) => s.length > 0)
  const merged = []
  for (const c of chunks) {
    if (merged.length > 0 && c.length < MIN_SENTENCE_CHUNK_LENGTH) merged[merged.length - 1] += c
    else merged.push(c)
  }
  return merged
}

/**
 * **不可拆诊断**（M0′.4 / R14）：镜数达不到目标时，说清是哪几段、为什么拆不动。
 *
 * ⚠️ 两种成因要分开说，因为出口不同：
 *   ① 段内没有句末标点 ⇒ 出口是「加句号」或「改单镜秒数」；
 *   ② 段内切出的块里有长度不足的碎片 ⇒ 历史上会让**整段**判为不可拆
 *      （典型：末尾的 `」` 单独成块，长度 1 < MIN_SENTENCE_CHUNK_LENGTH）。
 *      这一类**已在碎片并回里修掉**，此处保留诊断分支以防复发。
 *
 * @param {Array<{index?: number, text?: string}>} beats
 * @returns {Array<{index: number, chars: number, reason: string}>}
 */
function diagnoseUnsplitBeats (beats) {
  const list = Array.isArray(beats) ? beats : []
  const out = []
  for (const b of list) {
    const text = String(b && b.text || '')
    if (!text.trim()) continue
    const chunks = splitIntoChunks(text)
    if (chunks.length >= 2) continue
    // ⚠️ 成因判据用「**合并后**的块里是否仍存在长度不足的碎片」——
    //   旧判据是「raw 分块里有任一块以句末标点结尾」，那在**任何普通单句段**上恒为真
    //   （实测 `他说：今天真累。` 被判成「有碎片」，于是让用户去「补句号」——而段里本来就有句号）。
    const shortChunks = chunks.filter((c) => c.length < MIN_SENTENCE_CHUNK_LENGTH)
    out.push({
      index: Number(b.index) || 0,
      chars: text.replace(/\s+/g, '').length,
      reason: shortChunks.length > 0
        ? '切分后仍有不足 ' + MIN_SENTENCE_CHUNK_LENGTH + ' 字的碎片，无法按句拆开'
        : '段内没有句末标点，无法按句拆开',
    })
  }
  return out
}

/**
 * **容量建议文案**（M0′.1 / R3.5）：台词念不完时给出**两个可执行出口**。
 *
 * 为什么必须给「两个」而不是一句「请调整」：容量不足有两条互斥的解法
 * （把档位调大 / 把台词拆短），只说其中一条会让用户以为只有一条路。
 * 而「调大档位」有副作用（目标总时长不变 ⇒ 镜数相应减少），必须说清，
 * 否则用户会以为改档位是免费的。
 *
 * @param {{rawSec?: number, capacitySec?: number, tierSec?: number, selectableSeconds?: number[]}} input
 * @returns {string}
 */
function buildCapacityAdvice (input) {
  const o = input || {}
  const raw = Number(o.rawSec)
  const capacity = Number(o.capacitySec)
  const list = (Array.isArray(o.selectableSeconds) ? o.selectableSeconds : [])
    .map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  const tol = DEFAULT_SNAP_TOLERANCE_SEC
  // 建议档位 = **可选档位里**第一个装得下的（不是吸附后的 tierSec——它可能超出用户可选范围）
  const fits = list.find((s) => raw <= s + tol)
  const outs = []
  if (fits) {
    outs.push('① 把单镜秒数改到 ' + fits + ' 秒（可选 ' + list.join('/') + '；目标总时长不变，镜数会相应减少）')
  }
  outs.push('② 把这段台词拆成两句')
  return '本镜台词需时 ' + raw.toFixed(2) + 's，超过你选择的单镜 ' + capacity + ' 秒'
    + '（含 ' + tol + 's 吸附容差）⇒ 在当前时长下念不完。'
    + (outs.length > 1 ? '两个出口：' : '只剩一个出口：') + outs.join('；')
    + (fits ? '。若改档后仍不足，请按 ② 继续拆台词' : '。') + '。'
}

/**
 * **容量判定**（M0′.2 / R3.3-R3.4）：台词需时 > 用户所选档位 ⇒ **fail-closed**。
 *
 * 判据：**`rawSec > 用户所选档位 + 吸附容差`**
 * （不用 `snapToTier(rawSec) > 档位`：吸附会把溢出值吸到最大档 ⇒ 漏判「用户选 10 秒 + 台词需 12.5 秒」；
 *   也不用现状的 truncation 判据：它拿**吸附后**的档位比 ⇒ 误判「用户选 8 秒、内容 5.125 秒被吸附到 5 秒」）。
 *
 * @param {{shots: Array<any>, capacitySec?: number, selectableSeconds?: number[]}} input
 * @returns {{blocked: boolean, errorCode?: string, message?: string}}
 */
function evaluateCapacity (input) {
  const o = input || {}
  const shots = Array.isArray(o.shots) ? o.shots : []
  const capacitySec = Number(o.capacitySec)
  const list = (Array.isArray(o.selectableSeconds) ? o.selectableSeconds : [])
    .map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  const overflow = shots.filter((s) => s && s.capacityOverflow === true)
  if (overflow.length === 0) return { blocked: false }
  const capacity = Number.isFinite(capacitySec) && capacitySec > 0 ? capacitySec : (Number(overflow[0].capacitySec) || 0)
  const rawMax = Math.max.apply(null, overflow.map((s) => Number(s.durationRawSec) || 0))
  const fits = list.find((sec) => rawMax <= sec + DEFAULT_SNAP_TOLERANCE_SEC)
  const outs = []
  if (fits) {
    outs.push('① 把单镜秒数改到 ' + fits + ' 秒（可选 ' + list.join('/') + '；目标总时长不变，镜数会相应减少）')
  }
  outs.push('② 把这些镜的台词拆成两句')
  const detail = overflow.slice(0, 5).map((s) => {
    const m = String((s.durationWarnings || []).join(' ')).match(/需时 ([\d.]+)s/)
    return '#' + s.index + '（需时 ' + (m ? m[1] : '?') + 's）'
  }).join('、')
  return {
    blocked: true,
    errorCode: 'AUTO_DIALOGUE_OVERFLOW',
    message: '有 ' + overflow.length + ' 个分镜的台词在当前单镜时长（' + capacity + ' 秒）下念不完：'
      + detail + (overflow.length > 5 ? ' 等' : '')
      + '。' + (outs.length > 1 ? '两个出口：' : '只剩一个出口：') + outs.join('；')
      + (fits ? '。若改档后仍不足，请按 ② 继续拆台词' : '')
      + '。规划已中止，未写入计划、未产出任何视频。',
  }
}

/**
 * **少产镜数警告**（M0′.4 / R14）：目标镜数达不到时，说清原因与出口。
 *
 * ⚠️ **只报告、不阻断**：少产镜数产出的成片**能念完**（只是比目标短）⇒ 不是坏结果。
 *   与「容量不足必须阻断」是两种不同的失败，不该混成一条。
 *
 * @param {{shots: Array<any>, targetCount: number, beats: Array<any>}} input
 * @returns {{code: string, message: string} | null}
 */
function buildShortCountWarning (input) {
  const o = input || {}
  const shots = Array.isArray(o.shots) ? o.shots : []
  const targetCount = Number(o.targetCount) || 0
  const shortBy = targetCount - shots.length
  if (!(shortBy > 0)) return null
  const blocked = diagnoseUnsplitBeats(o.beats)
  // ⚠️ 两种成因要分开（复核发现旧兜底文案在「句数不够」时是错的）：
  //   ① 有段拆不动（无句末标点 / 碎片）⇒ 出口是「补句号」；
  //   ② 段都拆开了、可拆的句子总数仍不够 ⇒ 出口是「再写几句」（补句号没用）。
  const detail = blocked.length > 0
    ? blocked.slice(0, 5).map((b) => '第 ' + b.index + ' 段（' + b.chars + ' 字）' + b.reason).join('；')
    : '剧本可拆的句子总数少于目标镜数'
  const outs = blocked.length > 0
    ? ['① 在这些段里补句号（。！？；）以便按句拆成多镜', '② 把单镜秒数调大（镜数 = 目标时长 ÷ 单镜秒数）']
    : ['① 再补几句台词（或把长句拆短）以便凑满镜数', '② 把单镜秒数调大（镜数 = 目标时长 ÷ 单镜秒数）']
  return {
    code: 'W10',
    message: '实际只产出 ' + shots.length + ' 镜，比目标 ' + targetCount + ' 镜少产 ' + shortBy + ' 镜：' + detail
      + '。两个出口：' + outs.join('；') + '。',
  }
}

/**
 * **逐镜时长警告拼装**（M0′.1）：把「中性事实警告」与「面向用户的两个出口」合成一份。
 *
 * ⚠️ 分工：`shot-duration.js` 只产出**事实**（需时、基准、是否超出），
 *   面向用户的出口（改档位 / 拆台词）需要知道「用户选了哪一档」与「可选档位集合」⇒ 由这里拼。
 *   两边各说一遍会变成同一句话说两遍 ⇒ 这里只出一次。
 *
 * @param {any} duration resolveShotDurationMs 的返回值
 * @param {{selectableSeconds?: number[]}} [opts]
 * @returns {string[]}
 */
function buildShotDurationWarnings (duration, opts) {
  const d = duration || {}
  const list = d.ok ? (d.warnings || []).slice() : [d.error]
  if (d.ok && d.capacityOverflow === true) {
    list.push(buildCapacityAdvice({
      rawSec: d.rawSec,
      capacitySec: d.capacitySec,
      tierSec: d.tierSec,
      selectableSeconds: (opts && opts.selectableSeconds) || [],
    }))
  }
  return list
}

module.exports = {
  MIN_SENTENCE_CHUNK_LENGTH,
  DEFAULT_SNAP_TOLERANCE_SEC,
  splitIntoChunks,
  diagnoseUnsplitBeats,
  buildCapacityAdvice,
  buildShotDurationWarnings,
  evaluateCapacity,
  buildShortCountWarning,
}

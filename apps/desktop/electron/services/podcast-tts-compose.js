'use strict'
/**
 * 刀 4（文案 → 一期播客音频）的分块与入参形状层（PRD §7.4.2 第 2 条、§7.4.3 第 ① 层）。
 *
 * 为什么单列一个纯函数模块而不是直接在宿主里写：块上限这条判据的失败形态是
 * **静默丢内容**（provider 侧 `asset-generator.js` 的 `slice(0, 4000)` 截断不报错），
 * 纯函数才能把「一个字符都不能少」写成可断言的重构不变量。
 *
 * 三条不可让的口径：
 * 1. 上限按 **码点** 计（2000），不是 UTF-16 码元，也不是 provider 的 4000 字符——
 *    `String.length` 会把代理对算成 2，emoji/生僻字因此在 length 合规的同时被 provider 截断。
 * 2. 块边界只允许落在**段落**（`\n`）或**句末终止标点**（。！？；…），不得在句中断开。
 * 3. 单句本身超上限时**拒绝出期**（CHUNK_UNSAFE）而不是硬切：硬切等于把一句话读成两截，
 *    而"块太长了"是配置问题，不是可以在运行期猜的东西。
 */
const MAX_CHUNK_CODEPOINTS = 2000
const MIN_CONTENT_CODEPOINTS = 80
const TITLE_MAX_CODEPOINTS = 200
const SENTENCE_ENDERS = ['。', '！', '？', '；', '…']
// 判据复用 `podcast-channel-registry` 的**唯一实现**：本层另写一份宽松正则，
// 会让 'c'/'UPPER' 这类形态在本层放行、在下一层被拒，症状是同一条入参两次判定结果不同。
const CHANNEL_ID_RE = require('./podcast-channel-registry').CHANNEL_ID_RE
const RUN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

const TTS_COMPOSE_ERRORS = {
  CHANNEL_ID_INVALID: 'PODCAST_CHANNEL_ID_INVALID',
  CHANNEL_ID_REQUIRED: 'PODCAST_CHANNEL_ID_REQUIRED',
  CONTENT_TOO_SHORT: 'PODCAST_TTS_COPY_TOO_SHORT',
  TITLE_INVALID: 'PODCAST_TTS_TITLE_INVALID',
  CHUNK_UNSAFE: 'PODCAST_TTS_CHUNK_UNSAFE',
  VOICE_REF_INCOMPLETE: 'PODCAST_TTS_VOICE_UNRESOLVED',
  RUN_ID_INVALID: 'PODCAST_EPISODE_INVALID',
}

/** 码点长度：代理对算一个字符。全仓同一口径，禁止再有人用 .length 判块上限。 */
function cpLen (s) {
  let n = 0
  for (const _ of String(s == null ? '' : s)) n++
  return n
}

/** 按句末标点切句，**终止标点留在句内**（丢掉标点等于改写了原文）。 */
function splitSentences (para) {
  const out = []
  let buf = ''
  const chars = Array.from(String(para))
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    buf += ch
    // 只在「本字符是终止标点、且下一个不是」时断句。否则「？！」「……」会被逐字拆开，
    // 而第二遍合并只认「前句以终止标点结尾」，成串标点因此永远并不回去（评审 Critical#1）。
    const next = chars[i + 1] || ''
    if (SENTENCE_ENDERS.includes(ch) && !SENTENCE_ENDERS.includes(next)) {
      // 连续标点（如「？！」「……」）并进同一句，避免把「真的？」！切成一空一句
      out.push(buf)
      buf = ''
    }
  }
  if (buf) out.push(buf)
  if (!out.length) out.push(String(para))
  // 「……」这类成串终止标点：把只由标点组成的尾巴并进前一句
  const merged = []
  for (const s of out) {
    const prev = merged[merged.length - 1]
    if (prev != null && !SENTENCE_ENDERS.some((e) => prev.endsWith(e))) merged[merged.length - 1] = prev + s
    else merged.push(s)
  }
  return merged
}

/**
 * 把整篇文案切成块。返回 `{ ok:true, chunks:[{text, para}] }`
 * 或 `{ ok:false, code, issues }`。
 * `para` 是**原段落下标**：调用方据此逐段自证「切完再拼回去 == 原段」，
 * 这是本模块唯一的重构不变量（内容不丢、不加、不重排）。
 */
function planChunks (content, opts = {}) {
  // 上限**只可下调不可上调**：2000 是按 provider 的静默截断行为定的安全线，
  // 调用方（未来的第 2 块）把它抬高就等于把本模块要防的那个洞重新打开，所以这里钳回 MAX_CHUNK_CODEPOINTS。
  const requested = Number(opts.maxCodepoints)
  const cap = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), MAX_CHUNK_CODEPOINTS) : MAX_CHUNK_CODEPOINTS
  const text = String(content == null ? '' : content)
  const paragraphs = text.split('\n')
  const chunks = []
  let seq = 0
  const issues = []
  paragraphs.forEach((para, idx) => {
    if (para.trim() === '') { return }
    if (cpLen(para) <= cap) { chunks.push({ text: para, para: idx }); return }
    const sentences = splitSentences(para)
    let cur = ''
    for (const s of sentences) {
      if (cpLen(s) > cap) {
        issues.push({ code: TTS_COMPOSE_ERRORS.CHUNK_UNSAFE, path: 'copy.content', para: idx, message: '单句 ' + cpLen(s) + ' 码点已超过块上限 ' + cap + '，且句内不得断开' })
        continue
      }
      if (cpLen(cur) + cpLen(s) <= cap) { cur += s; continue }
      if (cur) chunks.push({ text: cur, para: idx })
      cur = s
    }
    if (cur) chunks.push({ text: cur, para: idx })
  })
  // 每个块带全局序号：`para` 只说明「来自哪一段」，一段多块时它不唯一，进度与报错定位都要靠 index
  chunks.forEach((c, i) => { c.index = i })
  if (issues.length) return { ok: false, code: TTS_COMPOSE_ERRORS.CHUNK_UNSAFE, issues }
  if (!chunks.length) return { ok: false, code: TTS_COMPOSE_ERRORS.CONTENT_TOO_SHORT, issues: [{ code: TTS_COMPOSE_ERRORS.CONTENT_TOO_SHORT, path: 'copy.content', message: '没有可切的段落' }] }
  return { ok: true, chunks, totalBlocks: chunks.length }
}

/** voiceRef：provider / model / voiceId 三段必须**同存或同缺**，一半有一半没是配置残缺，不得由代码替用户补。 */
function voiceRefIssues (ref) {
  if (ref == null) return []
  const parts = ['providerId', 'model', 'voiceId']
  const given = parts.filter((k) => String((ref && ref[k]) || '').trim() !== '')
  if (given.length === 0 || given.length === parts.length) return []
  return [{ code: TTS_COMPOSE_ERRORS.VOICE_REF_INCOMPLETE, path: 'voiceRef', message: '音色三段（providerId/model/voiceId）必须同存或同缺，实到 ' + given.length + ' 段' }]
}

/**
 * §7.4.3 第 ① 层：入参形状，**在任何出站与任何磁盘写之前**。
 * issues 原样带出（渲染层按码取文案、逐条列给用户），这里只判定不翻译。
 */
function validateComposeInput (payload = {}) {
  const issues = []
  const channelId = String(payload.channelId || '').trim()
  if (!channelId) issues.push({ code: TTS_COMPOSE_ERRORS.CHANNEL_ID_REQUIRED, path: 'channelId', message: '出期必须指定频道' })
  else if (!CHANNEL_ID_RE.test(channelId)) issues.push({ code: TTS_COMPOSE_ERRORS.CHANNEL_ID_INVALID, path: 'channelId', message: '频道标识形态非法' })

  const content = String((payload.copy && payload.copy.content) || '')
  if (cpLen(content) < MIN_CONTENT_CODEPOINTS) {
    issues.push({ code: TTS_COMPOSE_ERRORS.CONTENT_TOO_SHORT, path: 'copy.content', message: '正文 ' + cpLen(content) + ' 码点，短于一期口播的下限 ' + MIN_CONTENT_CODEPOINTS })
  }
  const title = String(payload.title || '').trim()
  if (!title) issues.push({ code: TTS_COMPOSE_ERRORS.TITLE_INVALID, path: 'title', message: '单集标题不能为空' })
  else if (cpLen(title) > TITLE_MAX_CODEPOINTS) issues.push({ code: TTS_COMPOSE_ERRORS.TITLE_INVALID, path: 'title', message: '标题 ' + cpLen(title) + ' 码点，超出 ' + TITLE_MAX_CODEPOINTS })

  const runId = String(payload.runId || '').trim()
  if (!RUN_ID_RE.test(runId)) {
    // 它同时是主进程临时目录名的一部分 ⇒ 形态判据就是目录穿越边界本身，不是装饰
    issues.push({ code: TTS_COMPOSE_ERRORS.RUN_ID_INVALID, path: 'runId', message: '发起出期必须带形态合法的 runId（8-64 位 [A-Za-z0-9_-]）' })
  }
  issues.push(...voiceRefIssues(payload.voiceRef))

  if (issues.length) return { ok: false, code: issues[0].code, issues }
  const plan = planChunks(content, { maxCodepoints: payload.maxChunkCodepoints })
  if (!plan.ok) return plan
  return { ok: true, channelId, title, runId, chunks: plan.chunks }
}

module.exports = {
  MAX_CHUNK_CODEPOINTS, MIN_CONTENT_CODEPOINTS, TITLE_MAX_CODEPOINTS,
  TTS_COMPOSE_ERRORS, cpLen, splitSentences, planChunks, validateComposeInput, voiceRefIssues,
}

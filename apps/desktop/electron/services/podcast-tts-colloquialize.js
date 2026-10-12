'use strict'
/**
 * 刀 4 第 3 片·下半（第 1 层）：**口语化**（书面文案 → 听起来像人说的口播稿）
 * （PRD §7.4.2 第 1 条、§7.4.1 表格「platform 不得影响口语化 prompt」、AGENTS.md「后处理结构不变量」）。
 *
 * 两个不可混用的语义（这是本模块存在的理由）：
 * - `rewrite-engine` 的去 AI 味链路解决的是「**读**起来像人写的」；本层要的是「**听**起来像人说的」，
 *   两者的改写边界不同（口语化允许拆长句、加语气词，不允许改分段）。所以 prompt 是本模块的**单点常量**，
 *   禁止复用到别处，也禁止别处再抄一份。
 * - LLM 输出一旦破坏分段结构，下游 `planChunks` 的段落边界（`\n`）就是错的：块会在句中断开、
 *   段尾被追加标点，而听感问题**不会在任何日志里留下痕迹**。因此结构不变量校验发生在**采用之前**，
 *   不合格的输出整份丢弃、回退原文。
 *
 * 失败方向刻意是「旁路」而不是「拒绝出期」：
 * - 没有配置 LLM、调用抛错、返回空、结构不合格 ⇒ **采用原文**（原文本身是合法口播，只是不够口语），
 *   并把原因出声（warn 一次）。把可选增强做成出期的硬前提，等于让一个不影响正确性的环节决定用户能否发布。
 * - 唯一 fail closed 的入口是「调用方声明了要口语化却连 `invoke` 都没实现」——那是编程错误，不是配置缺失，
 *   由测试与调用点各自守住（见 `colloquializeCopy` 的 `enabled` 判据）。
 */
// 命名边界（勿与去 AI 味链路混用）：`rewrite-engine/src/ai-taste-remover.js` 里有个**同名不同义**的
// 私有方法 `_colloquialize`（词库级去 AI 味）。本层的 colloquializeCopy 是「听起来像人说的」口播化，
// 两者语义不同、互不复用；看到那个名字不要来这里，看到这里不要去那里（QM-6 后端评审 Info 指出的撞名）。
const COLLOQUIALIZE_REASONS = {
  APPLIED: 'applied',
  NOT_ENABLED: 'not_enabled',
  NO_PROVIDER: 'no_provider',
  INVOKE_FAILED: 'invoke_failed',
  EMPTY_OUTPUT: 'empty_output',
  STRUCTURE_REJECTED: 'structure_rejected',
}

/**
 * 口播化 system prompt（单点）。措辞要点：只改**句内**表达、严禁增删段落、严禁改动段尾终止标点、
 * 严禁输出解释或代码块围栏——最后一条是因为围栏一旦进正文，分块层会把围栏当成一个段落念出来。
 */
const SYSTEM_PROMPT = [
  '你是口播稿改写助手。把用户给的书面文案改得更适合**朗读**（听起来像人说的），不是更像文章。',
  '允许的改动：拆长句为短句、把书面连接词换成口语词、删掉只服务于排版的括号注释、给数字加适合朗读的读法。',
  '禁止的改动（任一条违反就整次作废）：',
  '1) 不得增加、删除、合并任何换行——输入按单个换行分成几行，输出就必须是同样多的几行；',
  '2) 每一段的最后一个字符必须与该段输入时的最后一个字符相同：段尾有终止标点就保留同一个，',
  '   段尾本来没有标点就**不要**补上；',
  '3) 不得改变事实、数字含义、人名与产品名；',
  '4) 不得输出任何解释、前后缀、markdown 代码块围栏，只输出正文本身。',
].join('\n')

function lastChar (s) {
  const str = String(s == null ? '' : s)
  return str.length ? str.charAt(str.length - 1) : ''
}

/**
 * 分段边界 = **单个换行**，与下游 `planChunks`（`podcast-tts-compose.js` 按
`n` split）逐字同一定义。
 * 早先这里写的是「按空行分段」，而代码与 `planChunks` 都按单换行——口径自相矛盾时，模型只要
 * 忠实遵守「空行=段」做一次合法段内重排，就会被本校验整份拒掉并回退原文（2026-10-11 QM-6
 * 后端评审 F1：判据与它自己引用的口径不是同一件事，白拒合格输出）。
 */
function splitParagraphs (text) {
  return String(text == null ? '' : text).split('\n').map((l) => l)
}

/**
 * 剥围栏：只在「第 0 行是开围栏且后面存在闭合行」时返回两者之间的内容。
 * 如实写明副作用——闭合行之后的内容会被丢弃；这不是静默错用，因为任何截断都会改变行数
 * 而被 checkStructure 整份拒绝回退原文。宣称比行为窄比宣称比行为宽安全。
 */
function unwrapFence (text) {
  const lines = String(text == null ? '' : text).split('\n')
  if (lines.length >= 2 && /^\s*```/.test(lines[0])) {
    let end = -1
    for (let i = lines.length - 1; i > 0; i--) { if (/^\s*```/.test(lines[i])) { end = i; break } }
    if (end > 0) return lines.slice(1, end).join('\n')
  }
  return String(text == null ? '' : text)
}

/**
 * 结构不变量：段数相等 + 空段位置保持 + 每段最后一个非空白字符逐字相同。
 * @returns {{ok:boolean, reason:string}} reason 只用于出声与日志，**不含用户文本**
 */
function checkStructure (inputText, outputText) {
  const a = splitParagraphs(inputText)
  const b = splitParagraphs(outputText)
  if (a.length !== b.length) return { ok: false, reason: 'paragraph_count:' + a.length + '->' + b.length }
  for (let i = 0; i < a.length; i++) {
    const x = a[i].trim()
    const y = b[i].trim()
    if ((x === '') !== (y === '')) return { ok: false, reason: 'blank_line_at:' + i }
    if (x === '') continue
    // 判据只有一条：**每段最后一个非空白字符必须逐字相同**。它同时覆盖三种失真——
    // 补标点（'text' → 'text。'）、换标点（'text。' → 'text！'）、删标点（'text。' → 'text'），
    // 因此不需要第二份终止标点集合（分块层那份是它的用途，合并两者会让一次口径改动牵动两层）。
    if (lastChar(x) !== lastChar(y)) return { ok: false, reason: 'last_char_changed_at:' + i }
  }
  return { ok: true, reason: COLLOQUIALIZE_REASONS.APPLIED }
}

/**
 * 组 prompt。**只接受 title 与 content**：PRD §7.4.1 明确 `platform` 不得影响口语化 prompt
 * （同一份文案出期与发布到哪个平台无关）。签名里没有第三个业务字段就是这条口径的落点。
 */
function buildColloquializePrompt (input = {}) {
  const title = String(input.title == null ? '' : input.title).trim()
  const content = String(input.content == null ? '' : input.content)
  const user = (title ? '【标题】' + title + '\n\n' : '') + '【正文】\n' + content
  return { system: SYSTEM_PROMPT, user }
}

/**
 * @param {object} input
 * @param {string} input.content 原始正文（分段结构即真源）
 * @param {string} [input.title]
 * @param {boolean} [input.enabled] 调用方是否要求口语化（默认 true）
 * @param {(p:{system:string,user:string})=>Promise<string>|string} [input.invoke] 由宿主绑定 ai-generator 的 chatCompletion
 * @param {(msg:string)=>void} [input.warn]
 * @returns {Promise<{content:string, applied:boolean, reason:string}>}
 *   任何旁路分支都返回**原文**，只有 `applied:true` 才采用改写结果。
 */
async function colloquializeCopy (input = {}) {
  const original = String(input.content == null ? '' : input.content)
  const warn = typeof input.warn === 'function' ? input.warn : () => {}
  if (input.enabled === false) return { content: original, applied: false, reason: COLLOQUIALIZE_REASONS.NOT_ENABLED }
  if (typeof input.invoke !== 'function') {
    // 没有可用 provider 是**配置状态**，不是错误：口播链继续用原文（§7.4.2 的旁路口径）
    return { content: original, applied: false, reason: COLLOQUIALIZE_REASONS.NO_PROVIDER }
  }
  let raw
  try {
    raw = await input.invoke(buildColloquializePrompt({ title: input.title, content: original }))
  } catch (e) {
    // 只记错误**类型**：注入侧（provider/网络）的 message 常把请求体或用户正文片段带回来，
    // 原样拼进 warn 就违反 §7.4.2.1「warn 不含用户正文」。归因靠 name + 计数，不靠正文。
    warn('[podcast-colloquialize] 口语化调用异常（' + ((e && e.name) || 'Error') + '），本期采用原文')
    return { content: original, applied: false, reason: COLLOQUIALIZE_REASONS.INVOKE_FAILED }
  }
  const out = unwrapFence(typeof raw === 'string' ? raw : '').trim()
  if (!out) return { content: original, applied: false, reason: COLLOQUIALIZE_REASONS.EMPTY_OUTPUT }
  const st = checkStructure(original, out)
  if (!st.ok) {
    // 采用一份破坏分段的输出 = 让下游在句中断开还静默发布；宁可退回原文
    warn('[podcast-colloquialize] 输出未保持分段结构（' + st.reason + '），本期采用原文')
    return { content: original, applied: false, reason: COLLOQUIALIZE_REASONS.STRUCTURE_REJECTED }
  }
  return { content: out, applied: true, reason: COLLOQUIALIZE_REASONS.APPLIED }
}

module.exports = {
  SYSTEM_PROMPT,
  COLLOQUIALIZE_REASONS,
  buildColloquializePrompt,
  checkStructure,
  colloquializeCopy,
  unwrapFence,
}

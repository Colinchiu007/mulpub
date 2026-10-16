'use strict'
/**
 * podcast-episode-plan-preview.js — 计费二次确认框的**只读**预览（PRD §7.10.4.1，tasks 4.3②-a）
 *
 * 存在的理由：§7.10.4 把「块数 / 总码点 / 服务商·模型·音色三段（含命中来源）」写成浮层显示项，
 * 而这两个数此前只存在于主进程的分块层与音色层，渲染端一个都取不到。缺这条读路径时只有两种坏结果：
 * ① 浮层显示 0（用户在被扣费的确认框里看到假数），② 渲染层另抄一份分块与音色推断
 * （两份口径必然漂移，且漂移的方向是「前端算的数」与「实际发出去的块数」不一致）。
 *
 * 三条不可让的口径：
 * 1. **只转发不加工**：块数来自 `planChunks` 的同一实现，音色来自 `resolveEpisodeVoice` 的同一实现。
 *    本模块不许出现第二个切分规则、第二条回退顺序、第二个领域码。
 * 2. **只读**：本层不建目录、不占频道忙标记、不调 TTS、不起 ffmpeg、不发 PUT。
 *    保证方式有两层，各自锁各自的一格：① 本文件源码不出现 `fs`/`child_process`/`net`/宿主模块/`mkdirSync`/
 *    `tryBeginPublish`（结构锁），所以这一层**自己**没有写盘与起进程的能力；② IPC 接线处断言
 *    宿主与忙标记 **0 次调用**（行为锁），防的是「以后有人把预览改道去走真链路」。
 *    注：registry 在本文件只贡献一个 `CHANNEL_ID_RE` 常量（与 compose 同源），预览不调它的任何方法——
 *    频道数据经注入的 `channelRefOf` 拿，因此「读一次频道」这件事发生在接线注入的实现里，与 `podcast:channel:get` 同路径。
 *    只看返回码不构成证据。
 * 3. **拒绝态不是空态**：正文过短 / 音色半配置 / 三层全空一律抛既有码 + `issues`，
 *    浮层据此显示原因句；绝不回 `{totalBlocks:0}` 那种「看起来算完了」的载荷。
 *    唯一例外是 `origin` 不在闭集内：那是解析层返回形状不合合同，处置是**整段不显示 + 出声**（§7.10.4.1），
 *    不是报错——计数仍然真实，音色那段不给用户看假的来源标注。
 *
 * `resolveVoice` 是本文件唯一的可注入判据点，生产默认即 `podcast-tts-voice` 的真实现；
 * 它存在只为让「闭集外的 origin」这一格可测（真实现不可达该形状）。
 * 接线处不得传替身，由 `podcast-episode-plan-preview.test.js` 的结构锁钉住，否则注入点会长成第二份口径。
 */

const { planChunks, cpLen, MIN_CONTENT_CODEPOINTS, TTS_COMPOSE_ERRORS } = require('./podcast-tts-compose')
const { resolveEpisodeVoice, VOICE_ORIGIN } = require('./podcast-tts-voice')
// 频道标识形态判据的单一真源在 registry（compose 也是从那里取，本层不得另写一份宽松正则）
const CHANNEL_ID_RE = require('./podcast-channel-registry').CHANNEL_ID_RE

// `PODCAST_EPISODE_INVALID` 是既有码（宿主 HOST_ERRORS.INVALID / 解析层缺注入实现都用它），
// 这里沿用同一个值，不为预览新造码。不能 require 宿主来取这个常量：宿主会把 fs/child_process
// 带进本模块的依赖闭包，而「只读」正是靠闭包里没有它们来保证的。
const PREVIEW_ERRORS = {
  INVALID: 'PODCAST_EPISODE_INVALID',
}

/** 注入实现的清单——缺任何一个都当场拒绝，不猜默认（猜一个音色等于替用户决定谁说话）。 */
const REQUIRED_DEPS = Object.freeze(['channelRefOf', 'defaultProviderOf', 'readPreference', 'getCapability'])

const VOICE_ORIGINS = new Set(Object.values(VOICE_ORIGIN))

function previewErr (code, message, issues) {
  const e = new Error(code + ': ' + message)
  e.code = code
  if (Array.isArray(issues) && issues.length) e.issues = issues
  return e
}

/**
 * @param {{channelRefOf:Function, defaultProviderOf:Function, readPreference:Function,
 *          getCapability:Function, warn?:Function, resolveVoice?:Function}} deps
 *        channelRefOf(channelId) → 频道 voiceRef | null；defaultProviderOf() → {providerId, model} | null
 * @returns {{previewEpisodePlan:Function, PREVIEW_ERRORS:object}}
 */
function createEpisodePlanPreview (deps = {}) {
  const warn = typeof deps.warn === 'function' ? deps.warn : () => {}
  const resolveVoice = typeof deps.resolveVoice === 'function' ? deps.resolveVoice : resolveEpisodeVoice

  /**
   * @param {{channelId?:string, script?:string}} input
   * @returns {Promise<{ok:true, plan:{totalBlocks:number, totalCodepoints:number},
   *                    voice:{providerId:string, model:string, voiceId:string, origin:string, resolvedBy:string}|null}>}
   */
  async function previewEpisodePlan (input = {}) {
    for (const key of REQUIRED_DEPS) {
      if (typeof deps[key] !== 'function') {
        throw previewErr(PREVIEW_ERRORS.INVALID, '只读预览必须注入 ' + key + '（缺一个实现就不许猜默认）')
      }
    }
    const p = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const channelId = String(p.channelId || '').trim()
    if (!channelId) throw previewErr(TTS_COMPOSE_ERRORS.CHANNEL_ID_REQUIRED, '出期必须指定频道')
    if (!CHANNEL_ID_RE.test(channelId)) throw previewErr(TTS_COMPOSE_ERRORS.CHANNEL_ID_INVALID, '频道标识形态非法')

    // ① 分块：判据只有 planChunks 一份实现。长度下限也取自它导出的常量，
    //    免得「浮层说够了」而真出期时被判太短（两处数字各写一次必然漂移）。
    const text = String(p.script == null ? '' : p.script)
    if (cpLen(text) < MIN_CONTENT_CODEPOINTS) {
      throw previewErr(TTS_COMPOSE_ERRORS.CONTENT_TOO_SHORT,
        '正文 ' + cpLen(text) + ' 码点，短于一期口播的下限 ' + MIN_CONTENT_CODEPOINTS,
        [{ code: TTS_COMPOSE_ERRORS.CONTENT_TOO_SHORT, path: 'copy.content', message: '正文 ' + cpLen(text) + ' 码点，短于一期口播的下限 ' + MIN_CONTENT_CODEPOINTS }])
    }
    const plan = planChunks(text)
    if (!plan.ok) throw previewErr(plan.code, (plan.issues && plan.issues[0] && plan.issues[0].message) || '文案无法切成可播报的块', plan.issues)

    // ② 音色：三层回退与「命中来源」都归 resolveEpisodeVoice，本层只搬运。
    const voiceRes = resolveVoice({
      channelRef: deps.channelRefOf(channelId),
      defaultProvider: deps.defaultProviderOf(),
      readPreference: deps.readPreference,
      getCapability: deps.getCapability,
      warn,
    })
    if (!voiceRes || voiceRes.ok !== true) {
      // 兜底码仍取自 compose 那份码表（`VOICE_REF_INCOMPLETE` 的值就是用户可见的
      // PODCAST_TTS_VOICE_UNRESOLVED），不在本文件写第二个字面量
      const code = (voiceRes && voiceRes.code) || TTS_COMPOSE_ERRORS.VOICE_REF_INCOMPLETE
      throw previewErr(code, (voiceRes && voiceRes.issues && voiceRes.issues[0] && voiceRes.issues[0].message) || '音色未解析出来', (voiceRes && voiceRes.issues) || null)
    }

    const totalBlocks = plan.chunks.length
    const totalCodepoints = plan.chunks.reduce((n, c) => n + cpLen(c.text), 0)
    if (!Number.isInteger(totalBlocks) || !Number.isInteger(totalCodepoints)) {
      // 计数不齐 = 整块不显示（此处选择拒绝而不是回 0：§7.9.6 那条「绝不回落 0」的口径）
      throw previewErr(PREVIEW_ERRORS.INVALID, '分块计数不完整，拒绝给出可能为 0 的预览')
    }

    const origin = String(voiceRes.origin || '')
    let voice = {
      providerId: String(voiceRes.providerId || ''),
      model: String(voiceRes.model || ''),
      voiceId: String(voiceRes.voiceId || ''),
      origin,
      resolvedBy: String(voiceRes.resolvedBy || ''),
    }
    if (!VOICE_ORIGINS.has(origin)) {
      // 闭集外：计数照给，音色整段不给看，并出声——给用户标一个错的来源比不标更坏
      warn('[podcast-plan-preview] resolveEpisodeVoice 返回闭集外的 origin（不显示音色段）: origin=' + (origin || '<empty>'))
      voice = null
    }
    return { ok: true, plan: { totalBlocks, totalCodepoints }, voice }
  }

  return { previewEpisodePlan, PREVIEW_ERRORS }
}

module.exports = { createEpisodePlanPreview, PREVIEW_ERRORS, REQUIRED_DEPS }

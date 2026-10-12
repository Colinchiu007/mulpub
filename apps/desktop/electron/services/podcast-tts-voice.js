'use strict'
/**
 * 刀 4 第 3 片·上半：一期播客的**音色解析**（PRD §7.4.1 纠正后的四步回退链、§7.4.6 显示项 3 的数据来源）。
 *
 * 为什么单列一个纯函数模块：这条链的失败形态是**静默换人说话**。用户听感是「我的播客怎么换了个人
 * 说话」，而 feed 一旦挂上就是对外可见的错——所以判据必须能在没有任何 provider 调用的前提下被逐条断言，
 * 也必须能把「命中了哪一层回退」原样带出去给界面显示（否则用户无法区分「我配过」与「系统替我选了」）。
 *
 * 四条不可让的口径：
 * 1. **顺序固定**：① 频道 voiceRef → ② 用户偏好 → ③ capability 的 defaultVoiceId → ④ 三者都拿不到就
 *    拒绝出期（`PODCAST_TTS_VOICE_UNRESOLVED`）。不得猜「某个 provider 的第一个音色」——那等于把
 *    一个没有依据的选择伪装成用户的选择。
 * 2. **voiceRef 半配置不是「未配置」**：三段（providerId/model/voiceId）里只有一部分时，必须
     以 `PODCAST_TTS_VOICE_UNRESOLVED` 当场拒绝（issues[].path 记 voiceRef），**不得**顺着回退链往下走——顺着走会让"填了一半"的频道
 *    每次都换一层来源去解析，而那正是本模块要消灭的现象；三段同缺才算真的未配置。
 *    判据复用 `podcast-tts-compose.js` 的 `voiceRefIssues`（同一份口径，禁止第二份实现）。
 * 3. **一切拒绝都发生在任何出站之前**：本模块不 require 任何网络/provider 代码，读偏好与 capability
 *    都由调用方注入——这样"解析失败"在测试里与在生产里走的是同一条代码路径。
 * 4. **空串等于没配**：偏好记录存在但 `voiceId` 是空串/纯空白时不得当作命中（把空值当命中会让下一层
 *    永远点不到，表现为"配过偏好的人反而解析失败"）。
 */
const { voiceRefIssues, TTS_COMPOSE_ERRORS } = require('./podcast-tts-compose')

const VOICE_ORIGIN = {
  CHANNEL: 'channel',
  PREFERENCE: 'preference',
  PROVIDER_DEFAULT: 'providerDefault',
}

// 码表**复用分块层那一份**：`TTS_COMPOSE_ERRORS.VOICE_REF_INCOMPLETE` 的值就是用户可见的
// `PODCAST_TTS_VOICE_UNRESOLVED`。本层不得为「半配置」另造第二个码——那会在 locale 里多一条无人维护的
// 文案键，而对用户来说两层的处置是同一句话（音色没解析出来）。层间区分靠 issues[].path：
// voiceRef（① 半配置）/ voice（无默认 provider、三层全空）/ voice.preference / voice.capability（读取异常）。
const VOICE_ERRORS = {
  UNRESOLVED: TTS_COMPOSE_ERRORS.VOICE_REF_INCOMPLETE,
}

function cleanId (v) {
  const s = String(v == null ? '' : v).trim()
  return s || ''
}

/** ① 频道自带三段：provider 与 model 必须成对（voiceId 已由 voiceRefIssues 保证同存）。 */
function channelRefParts (ref) {
  const providerId = cleanId(ref && ref.providerId)
  const model = cleanId(ref && ref.model)
  const voiceId = cleanId(ref && ref.voiceId)
  return { providerId, model, voiceId }
}

/**
 * @param {object} input
 * @param {{providerId?:string, model?:string, voiceId?:string}|null} [input.channelRef] 频道级三段（同存或同缺）
 * @param {{providerId?:string, model?:string}|null} [input.defaultProvider] 当前默认 tts provider（②③ 的定位键）
 * @param {(providerId:string, model:string)=>any} input.readPreference 读用户偏好记录（可为 `{voiceId}` 或裸串）
 * @param {(providerId:string, model:string)=>any} input.getCapability 读 capability（需含 `defaultVoiceId`）
 * @param {(msg:string)=>void} [input.warn]
 * @returns {{ok:true, providerId:string, model:string, voiceId:string, origin:string, resolvedBy:string}
 *          | {ok:false, code:string, issues:object[]}}
 */
function resolveEpisodeVoice (input = {}) {
  const { readPreference, getCapability, warn } = input
  const issues = []
  if (typeof readPreference !== 'function' || typeof getCapability !== 'function') {
    // 注入缺失不是"少一层回退"，而是整条判据不可评估——fail closed，不许代码替用户猜一个音色
    issues.push({ code: 'PODCAST_EPISODE_INVALID', path: 'voice.deps', message: '音色解析必须注入 readPreference 与 getCapability 两个读取实现' })
    return { ok: false, code: 'PODCAST_EPISODE_INVALID', issues }
  }

  const ref = input.channelRef
  // 归一再判：频道真源存的是 `providerId`（PRD §7.4.1），而 `voiceRefIssues` 的三段键名是 `provider`
  // （它管的是入参形状那一层）。不归一就把"三段齐备但键名叫 providerId"的合法配置判成半配置——
  // 那会把每个正常配置过音色的频道全部拒绝出期。判据本身仍是那一份，不许第二份。
  // 键名**只认 providerId**，与形状层逐字同口径（`voiceRefIssues` 的 parts 就是 providerId/model/voiceId）。
  // 曾在这里加过 `provider` 别名兜底——那会让同一条 channelRef 在两层得到相反结论（本层判三段齐备并出期、
  // 先跑的形状层判半配置并拒绝），2026-10-11 QM-6 后端评审 V1 命中后删除：别名要加就两层一起加，
  // 单侧放宽等于把"谁的判据生效"交给调用顺序决定。
  const normalizedRef = { providerId: cleanId(ref && ref.providerId), model: cleanId(ref && ref.model), voiceId: cleanId(ref && ref.voiceId) }
  if (ref != null && (typeof ref !== "object" || Array.isArray(ref))) {
    // 非对象的 voiceRef 不是"三段同缺"，而是形态错误；原先会落进回退链替用户选音色。
    return { ok: false, code: VOICE_ERRORS.UNRESOLVED, issues: [{ code: VOICE_ERRORS.UNRESOLVED, path: "voiceRef", message: "voiceRef 必须是对象（三段 providerId/model/voiceId），实到 " + typeof ref }] }
  }
  const refIncomplete = voiceRefIssues(normalizedRef)
  if (refIncomplete && refIncomplete.length) {
    // 三段半配置：拒绝，不往下走（见文件头口径 2）
    return { ok: false, code: VOICE_ERRORS.UNRESOLVED, issues: refIncomplete }
  }

  const parts = channelRefParts(ref)
  if (parts.voiceId) {
    return {
      ok: true,
      providerId: parts.providerId,
      model: parts.model,
      voiceId: parts.voiceId,
      origin: VOICE_ORIGIN.CHANNEL,
      resolvedBy: 'voiceRef:' + parts.providerId + '/' + parts.model,
    }
  }

  const dp = input.defaultProvider || {}
  const providerId = cleanId(dp.providerId)
  const model = cleanId(dp.model)
  if (!providerId || !model) {
    // 没有默认 provider 就没有 ②③ 的定位键。此时不得"随便挑一个 provider"：
    // 那会让同一频道在不同机器上解析出不同音色。
    if (warn) warn('[podcast-tts-voice] 未取到默认 tts provider（②③ 两层无定位键），本期拒绝出期')
    issues.push({ code: VOICE_ERRORS.UNRESOLVED, path: 'voice', message: '频道未配置音色，且没有可用的默认 provider 定位用户偏好与 capability 默认音色' })
    return { ok: false, code: VOICE_ERRORS.UNRESOLVED, issues }
  }

  // ② 用户偏好：键形如 `tts-voice-preference:v1:<provider>:<model>`，读取实现由调用方提供（唯一实现是 store）
  let pref
  try {
    pref = readPreference(providerId, model)
  } catch (e) {
    // 「偏好读失败」与「偏好没配」必须区分：前者不得静默降级到 ③——那会让一次存储异常把用户配的音色换成系统默认
    if (warn) warn('[podcast-tts-voice] 读用户偏好异常：' + ((e && e.message) || String(e)))
    issues.push({ code: VOICE_ERRORS.UNRESOLVED, path: 'voice.preference', message: '用户偏好读取异常，拒绝替你选一个音色' })
    return { ok: false, code: VOICE_ERRORS.UNRESOLVED, issues }
  }
  const prefVoiceId = cleanId(pref && typeof pref === 'object' ? pref.voiceId : pref)
  if (prefVoiceId) {
    return { ok: true, providerId, model, voiceId: prefVoiceId, origin: VOICE_ORIGIN.PREFERENCE, resolvedBy: 'preference:' + providerId + '/' + model }
  }

  // ③ capability 的 defaultVoiceId（本仓只有 capability 级这一处声明默认音色，不存在跨 provider 的全局默认）
  let capability
  try {
    capability = getCapability(providerId, model)
  } catch (e) {
    if (warn) warn('[podcast-tts-voice] 读 capability 异常：' + ((e && e.message) || String(e)))
    issues.push({ code: VOICE_ERRORS.UNRESOLVED, path: 'voice.capability', message: 'capability 读取异常，拒绝替你选一个音色' })
    return { ok: false, code: VOICE_ERRORS.UNRESOLVED, issues }
  }
  const defaultVoiceId = cleanId(capability && capability.defaultVoiceId)
  if (defaultVoiceId) {
    return { ok: true, providerId, model, voiceId: defaultVoiceId, origin: VOICE_ORIGIN.PROVIDER_DEFAULT, resolvedBy: 'capability:' + providerId + '/' + model }
  }

  // ④ 三层都拿不到：**拒绝出期**。不支持 TTS 的 provider（capability 存在但 defaultVoiceId 为 null）也走这里。
  issues.push({
    code: VOICE_ERRORS.UNRESOLVED,
    path: 'voice',
    message: '频道未配置音色，且该 provider 无用户偏好、capability 也没声明 defaultVoiceId（不支持 TTS 的 provider 不得被当作兜底）',
  })
  return { ok: false, code: VOICE_ERRORS.UNRESOLVED, issues }
}

module.exports = { VOICE_ORIGIN, VOICE_ERRORS, resolveEpisodeVoice }

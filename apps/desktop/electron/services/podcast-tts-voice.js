'use strict'
/**
 * 刀 4 第 3 片·上半：一期播客的**音色解析**（PRD §7.4.1 纠正后的回退链、§7.4.6 显示项 3 的数据来源）。
 *
 * 为什么单列一个纯函数模块：这条链的失败形态是**静默换人说话**。用户听感是「我的播客怎么换了个人
 * 说话」，而 feed 一旦挂上就是对外可见的错——所以判据必须能在没有任何 provider 调用的前提下被逐条断言，
 * 也必须能把「命中了哪一层回退」原样带出去给界面显示（否则用户无法区分「我配过」与「系统替我选了」）。
 *
 * 四条不可让的口径：
 * 1. **顺序固定**：① 用户偏好（当前默认 provider 的那条）→ ② capability 的 `defaultVoiceId` → ③ 两者都拿不到
 *    就拒绝出期（`PODCAST_TTS_VOICE_UNRESOLVED`）。不得猜「某个 provider 的第一个音色」——那等于把
 *    一个没有依据的选择伪装成用户的选择。
 * 2. **曾有第 ① 档「频道 `voiceRef`」，2026-10-19 经用户裁决删除**（tasks 4.5b② 改判「撤档」）。频道 meta
 *    的写侧从未存在——取证过程、裁决理由与「为什么不是反向补写侧」的**唯一真源是 PRD §7.4.1.2**，本注释
 *    不复述（QM6 i7：同一份裁决抄在头注释、PRD 与执行记录三处，改一处必漏两处）。这里只留代码读者需要
 *    的那条不变量：留着不可达的档位比少一条更坏，下一个读者会以为「频道可以配音色」，于是永远不去补
 *    真正需要的入口。⛔ **不得为「半配置拒绝」把它请回来**——撤档的定义就是该字段既不采纳也不拒绝；
 *    存量 meta 若真带着这个键，那次行为变更由 `ipc-handlers/podcast.js` 的一次 warn 出声，不落在本层。
 * 3. **一切拒绝都发生在任何出站之前**：本模块不 require 任何网络/provider 代码，读偏好与 capability
 *    都由调用方注入——这样"解析失败"在测试里与在生产里走的是同一条代码路径。
 * 4. **空串等于没配**：偏好记录存在但 `voiceId` 是空串/纯空白时不得当作命中（把空值当命中会让下一层
 *    永远点不到，表现为"配过偏好的人反而解析失败"）。
 */
const { TTS_COMPOSE_ERRORS } = require('./podcast-tts-compose')

const VOICE_ORIGIN = {
  PREFERENCE: 'preference',
  PROVIDER_DEFAULT: 'providerDefault',
}

// 码表**复用分块层那一份**：`TTS_COMPOSE_ERRORS.VOICE_REF_INCOMPLETE` 的值就是用户可见的
// `PODCAST_TTS_VOICE_UNRESOLVED`。本层不得另造第二个码——那会在 locale 里多一条无人维护的
// 文案键，而对用户来说两层的处置是同一句话（音色没解析出来）。层间区分靠 issues[].path：
// voice（无默认 provider、两层全空）/ voice.preference / voice.capability（读取异常）。
// 入参形状那一层的「三段同存或同缺」仍只在 `podcast-tts-compose.js` 的 `voiceRefIssues` 一处持有：
// 本层删掉频道档后不再读任何 voiceRef，那条判据没有因此失去落点，只是少了一个曾经的第二消费方。
const VOICE_ERRORS = {
  UNRESOLVED: TTS_COMPOSE_ERRORS.VOICE_REF_INCOMPLETE,
}

function cleanId (v) {
  const s = String(v == null ? '' : v).trim()
  return s || ''
}

/**
 * @param {object} input
 * @param {{providerId?:string, model?:string}|null} [input.defaultProvider] 当前默认 tts provider（①② 的定位键）
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

  const dp = input.defaultProvider || {}
  const providerId = cleanId(dp.providerId)
  const model = cleanId(dp.model)
  if (!providerId || !model) {
    // 没有默认 provider 就没有 ①② 的定位键。此时不得"随便挑一个 provider"：
    // 那会让同一频道在不同机器上解析出不同音色。
    if (warn) warn('[podcast-tts-voice] 未取到默认 tts provider（①② 两层无定位键），本期拒绝出期')
    issues.push({ code: VOICE_ERRORS.UNRESOLVED, path: 'voice', message: '没有可用的默认 provider 定位用户偏好与 capability 默认音色' })
    return { ok: false, code: VOICE_ERRORS.UNRESOLVED, issues }
  }

  // ① 用户偏好：键形如 `tts-voice-preference:v1:<provider>:<model>`，读取实现由调用方提供（唯一实现是 store）
  let pref
  try {
    pref = readPreference(providerId, model)
  } catch (e) {
    // 「偏好读失败」与「偏好没配」必须区分：前者不得静默降级到 ②——那会让一次存储异常把用户配的音色换成系统默认
    if (warn) warn('[podcast-tts-voice] 读用户偏好异常：' + ((e && e.message) || String(e)))
    issues.push({ code: VOICE_ERRORS.UNRESOLVED, path: 'voice.preference', message: '用户偏好读取异常，拒绝替你选一个音色' })
    return { ok: false, code: VOICE_ERRORS.UNRESOLVED, issues }
  }
  const prefVoiceId = cleanId(pref && typeof pref === 'object' ? pref.voiceId : pref)
  if (prefVoiceId) {
    return { ok: true, providerId, model, voiceId: prefVoiceId, origin: VOICE_ORIGIN.PREFERENCE, resolvedBy: 'preference:' + providerId + '/' + model }
  }

  // ② capability 的 defaultVoiceId（本仓只有 capability 级这一处声明默认音色，不存在跨 provider 的全局默认）
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

  // ③ 两层都拿不到：**拒绝出期**。不支持 TTS 的 provider（capability 存在但 defaultVoiceId 为 null）也走这里。
  issues.push({
    code: VOICE_ERRORS.UNRESOLVED,
    path: 'voice',
    message: '该 provider 无用户偏好、capability 也没声明 defaultVoiceId（不支持 TTS 的 provider 不得被当作兜底）',
  })
  return { ok: false, code: VOICE_ERRORS.UNRESOLVED, issues }
}

module.exports = { VOICE_ORIGIN, VOICE_ERRORS, resolveEpisodeVoice }

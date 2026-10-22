'use strict'
/**
 * 播客出期的**音色接线层**（tasks 4.5b④ / PRD §7.4.1.3，QM6 i3 的落点）
 *
 * 为什么单独一个文件：`ipc-handlers/podcast.js` 里曾内联这份装配，于是预览与宿主各自
 * 调用工厂时得到**两份实例**——「同一份接线」当时只剩源码形状在守，没有任何东西能断言它。
 * 收进本模块后，装配点仍是一处，但引用也是**一处**（WeakMap 按 deps 记忆化），
 * 「预览与宿主拿到同一个对象」第一次变成可断言的事实（`podcast-voice-deps.test.js`）。
 *
 * 三条不可让：
 * 1. **本层不判定回退顺序**。唯一实现是 `podcast-tts-voice.js` 的 `resolveEpisodeVoice`；
 *    这里只负责把三个读取实现交到它手上。抄第二份回退顺序 = 重新制造「界面算一套、成片算一套」。
 * 2. **偏好键的字面量只在 `podcast-episode-tts-adapters.createVoiceReaders` 一处**，本层不拼键名。
 * 3. **缺注入不猜默认**：没有 store ⇒ 偏好按未配置处理；没有 modelProviderManager ⇒ 定位键为 null
 *    （② ③ 两层随之如实拒绝出期）。两种缺失各**只 warn 一次**（同一 deps 内去重），
 *    口径与本仓 `stockShapeWarned` 一致——刷屏会把真信号冲掉。
 */
const { createVoiceReaders } = require('./podcast-episode-tts-adapters')

const cache = new WeakMap()

/**
 * @param {{deps:object, log:object, ownerSubjectOf?:Function}} input
 *        deps：IPC 注入面（`store` / `modelProviderManager` / `identityService`）
 * @returns {() => {defaultProviderOf:Function, readPreference:Function, getCapability:Function, warn:Function}}
 *          同一 deps 反复调用返回**同一对象引用**
 */
function createVoiceDepsFactory (input = {}) {
  const deps = input.deps || {}
  const log = input.log || { warn () {} }
  const ownerSubjectOf = typeof input.ownerSubjectOf === 'function' ? input.ownerSubjectOf : null
  const hit = cache.get(deps)
  if (hit) return hit

  let warned = false
  const warnOnce = (msg) => {
    if (warned) return
    warned = true
    log.warn(String(msg || ''))
  }
  const readers = createVoiceReaders({
    readSetting: (key) => {
      const s = deps.store
      if (!s || typeof s.getUserSetting !== 'function') {
        warnOnce('[ipc:podcast] 音色解析缺 store 注入：偏好按未配置处理（不猜默认音色，只报一次）')
        return null
      }
      return s.getUserSetting(key, null, ownerSubjectOf ? ownerSubjectOf(deps.identityService) : undefined)
    },
    getVoiceCapability: (providerId, model) => require('./tts-voice-catalog').getVoiceCapability(providerId, model),
  })

  const voiceDeps = {
    defaultProviderOf: () => {
      const m = deps.modelProviderManager
      if (!m || typeof m.getDefault !== 'function') {
        warnOnce('[ipc:podcast] 音色解析缺 modelProviderManager 注入：② ③ 两层没有定位键，将如实拒绝')
        return null
      }
      const row = m.getDefault('tts')
      if (!row || !row.id) return null
      // 默认模型取法只有 model-provider-manager 一份实现，本层不自己挑 models[0]
      const { resolveProviderDefaultModel } = require('./model-provider-manager')
      return { providerId: String(row.id), model: resolveProviderDefaultModel(row, 'tts') }
    },
    readPreference: readers.readPreference,
    getCapability: readers.getCapability,
    warn: (msg) => log.warn(String(msg || '')),
  }
  // 工厂返回的是「取同一份 voiceDeps」的闭包：调用方写法不变（`voiceResolveDeps()`），
  // 但两次调用拿到的是同一个对象——这条是 QM6 i3 要的载体，不是巧合。
  const get = () => voiceDeps
  cache.set(deps, get)
  return get
}

module.exports = { createVoiceDepsFactory }

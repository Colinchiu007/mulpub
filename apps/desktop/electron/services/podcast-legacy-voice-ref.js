'use strict'
/**
 * podcast-legacy-voice-ref.js — 「历史频道 meta.voiceRef 要不要出声」的判据（纯函数）。
 *
 * 为什么单独成文件：这条判据原先住在 `ipc-handlers/podcast.js` 里，加上注释 21 行把那个
 * 本已很大的 handler 文件推过 500 行线，被 CI 的债务熔断（`FILES_OVER_500`）当场判红。
 * 正解是拆结构而不是上调基线——它本来就是纯函数、零依赖、可独立阅读，留在 handler 里
 * 只是让它更胖。行为逐字不变（含下面这段范围口径）。
 *
 * 它**不是**第二份形状校验——合法性判据只在入参形状层一处；这里只回答「这个值当年会不会
 * 参与第①档判定」。范围由**主干那行注入自己**决定，不是由解析层守卫单独决定：主干写的是
 * `meta.voiceRef && typeof meta.voiceRef === 'object' ? meta.voiceRef : null`，所以非对象标量
 * （''、0、false、true、裸串）当年就被滤成 null、走 fallthrough ⇒ 撤档没改它们的行为；对它们
 * 发告警就是给从未受影响的数据刷屏，而误报一多，真那条会被当噪音冲掉（第五轮 P2：原版把这
 * 四格误报钉成了正确预期）。真正过了那道滤网的只有 plain object 与数组——数组撞旧守卫当场硬拒绝，
 * 对象看三段**规范键名**（大小写错位的 {voiceID:'x'} 当年既不成半配置也不命中频道档 ⇒ 不出声）。
 * {providerId: 0} 这类值类型错的规范键是真阳性不是保守噪声：cleanId(0) 记为 given ⇒ 当年半配置
 * 当场拒绝、撤档后变成通过 ⇒ 必须出声（P6：原注释把它写成「保守留下的误报」会诱导下一个会话
 * 顺手收紧判据，从而关掉一条真信号）。
 */

/**
 * @param {unknown} ref 频道 meta 里的历史 `voiceRef` 值
 * @returns {boolean} true = 这个值当年真参与过第①档判定，撤档会改变解析结果 ⇒ 必须出声
 */
function legacyChannelVoiceRefCarriesContent (ref) {
  if (ref == null) return false
  // 非对象标量（''、0、false、true、裸串）不需要一条专门的 typeof 短路：下一行的规范键名扫描对
  // 它们天然取不到键 ⇒ 返回 false。第六轮变异反证 M8 实测「加那一行」删掉后读数不变，
  // 那是一条观察不到的分支——写了却走不到就是装饰性档位，所以这里只留说明、不留判据。
  if (Array.isArray(ref)) return true
  return ['providerId', 'model', 'voiceId'].some((k) => String(ref[k] == null ? '' : ref[k]).trim() !== '')
}

module.exports = { legacyChannelVoiceRefCarriesContent }

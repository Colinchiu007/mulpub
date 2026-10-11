'use strict'

/**
 * podcast-public-url.js — 「这条 URL 能不能进公网 feed」的**唯一**判据（刀 3 第 3 片，QM-6 后端 ④a）
 *
 * 为什么收成一处：同一条判据原先在三个文件里各写一份 `/^https:\/\//i`
 * （`podcast-episode-publish.js` 的音频侧与 feed 侧、`podcast-hosting-service.js` 的 publishAudio）。
 * 三份抄本的实际后果不是重复代码，而是**放宽时只放宽一处**：某次为兼容某个自建 CDN 而把判据改成
 * 允许 http，只有音频侧跟着变，feed 侧仍在拦——同一个功能出现两种「能不能播」的答案，
 * 而用户看到的是「音频能下、订阅抓不到」这种无法归因的组合。
 *
 * ⛔ 与 `packages/shared-utils/src/safe-http-url.js` **不是**同一个判据，不得合并：
 * 那一份解决的是「外部可控 URL 绑进 href 会不会执行 JS」，口径是 http **或** https 都放行；
 * 本份解决的是「RSS 与各家聚合端会不会抓这条直链」，只认 https（非加密直链被判成混合内容或干脆不抓）。
 * 两者语义不同，合并等于给 href 面开出 https-only 的意外收紧、或给 feed 面放进 http。
 * 「能点开」与「能订阅」是两件事，本函数只判后者。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isPublicHttpsUrl (value) {
  return typeof value === 'string' && /^https:\/\//i.test(value.trim())
}

module.exports = { isPublicHttpsUrl }

'use strict'
/**
 * toutiao-video-probes.js — 头条视频的**只读探测**（发布权限 / 推荐封面）
 *
 * 从 `toutiao-video.js` 拆出（该文件再次逼近 `check-max-lines` 的 500 上限）。
 * 拆分边界按「有无副作用」：
 *   · 本文件 = **只读**平台查询（GetPublishAuth / GetPublishPageReviewLatency / GetPosterList）
 *   · `toutiao-video.js` = 有副作用的链（getAuthKey → apply → 分片 → commit → PublishVideo）
 *
 * 两个探测的证据来源（均为应用自身 bundle，逐字）：
 *
 * ```js
 * // 发布权限（bundle 有该端点；判定字段 DisablePublish 来自真机响应切片）
 * GET  /xigua/api/upload/GetPublishAuth?params={}
 * GET  /xigua/api/upload/GetPublishPageReviewLatency
 *
 * // 推荐封面（bundle 逐字）
 * (0,u.t9)("/ixigua/api/upload/GetPosterList/", { body: { vid } })   // → data.Posters
 * // 平台原文 UI 文案：「视频上传完毕后才能生成推荐封面，你可上传或自定义截取封面」
 * ```
 *
 * 设计要点：探测一律**不阻断主链**——
 *   · `checkPublishAuth` 取不到就返回 `canPublish: null`（unknown），只在**明确** `DisablePublish=true` 时才拦；
 *   · `getPosterList` 取不到由调用方决定回落，本模块只抛错不掩盖。
 */

const { parsePosterListResponse, pickPosterUri, PUBLISH_AUTH_PATH, REVIEW_LATENCY_PATH, POSTER_LIST_PATH } = require('./toutiao-video-publish')

/** GET 的宽松校验：200-499 都取回来看内容，不让 4xx 变成异常 */
const LOOSE = (s) => s >= 200 && s < 500

/**
 * 只读探测发布权限与审核/封禁状态。
 *
 * @param {{request: Function}} client  mp.toutiao.com 的 http 客户端
 * @param {object} headers              调用方拼好的头（含 Cookie）
 * @param {object} [logger]
 * @returns {Promise<{canPublish: boolean|null, disablePublish: boolean|null,
 *   blockStatus: number|null, reviewLatency: number|null, raw: object|null}>}
 */
async function probePublishAuth (client, headers, logger) {
  const out = { canPublish: null, disablePublish: null, blockStatus: null, reviewLatency: null, raw: null }
  try {
    const r1 = await client.request({
      method: 'get', url: PUBLISH_AUTH_PATH + '?params=%7B%7D',
      headers, validateStatus: LOOSE,
    })
    const d1 = (r1.data || {}).data || {}
    const perm = d1.authorPermission || {}
    // 2026-10-19：提交前唯一的「账号未完善」信号（DisablePublish 在這種账号上仍是 false）
    if (perm.IsIdentifyAuth !== undefined) out.identityVerified = Boolean(perm.IsIdentifyAuth)
    if (perm.DisablePublish !== undefined) {
      out.disablePublish = Boolean(perm.DisablePublish)
      out.canPublish = !Boolean(perm.DisablePublish)
    }
    out.raw = d1
  } catch (e) {
    if (logger && logger.warn) logger.warn('toutiao-video: GetPublishAuth 不可用 ' + String(e && e.message).slice(0, 120))
  }
  try {
    const r2 = await client.request({
      method: 'get', url: REVIEW_LATENCY_PATH,
      headers, validateStatus: LOOSE,
    })
    const d2 = (r2.data || {}).data || {}
    if (d2.BlockStatus !== undefined) out.blockStatus = Number(d2.BlockStatus)
    if (d2.ReviewLatency !== undefined) out.reviewLatency = Number(d2.ReviewLatency)
  } catch (_) { /* 只读遥测，取不到不影响主链 */ }
  return out
}

/**
 * 取**推荐封面**列表并按候选键挑一个 URI。
 *
 * @param {{request: Function}} client
 * @param {object} headers
 * @param {string} vid
 * @param {object} [logger]
 * @returns {Promise<{posters: Array, code: any, picked: {uri: string, key: string|null, poster: object|null}}>}
 */
async function fetchPosterList (client, headers, vid, logger) {
  if (!vid) throw new Error('toutiao-video: getPosterList 需要 vid')
  const res = await client.request({
    method: 'post', url: POSTER_LIST_PATH,
    data: JSON.stringify({ vid: String(vid) }),
    headers, validateStatus: LOOSE,
  })
  const parsed = parsePosterListResponse(res.data)
  const picked = pickPosterUri(parsed.posters)
  if (picked.key && logger && logger.info) {
    logger.info('toutiao-video: 推荐封面命中字段 ' + picked.key)
  }
  return Object.assign({}, parsed, { picked })
}

module.exports = { probePublishAuth, fetchPosterList }

'use strict'
/**
 * 抖音 web-API 发布链（对齐竞品 refproduct/main-dist-index.cjs 的调用面）。
 *
 * 竞品事实：
 *   GET  https://creator.douyin.com/aweme/v1/creator/pc/user/info/            （cookie+referer+Origin）
 *   GET  https://creator.douyin.com/web/api/media/user/anchor/list?…&msToken=&a_bogus=
 *        ⇒ msToken / a_bogus 传空仍可调用
 *   POST ApplyUploadInner → FinishUpload → CommitUploadInner（vod 协议，aws4 自签，见 vod-upload.js）
 *
 * 本模块只负责「非上传」的三步；上传复用 vod-upload.js。
 * 成功判据：create_v2 返回 status_code === 0 且含 aweme_id/item_id；2xx 不算。
 */
const BASE = 'https://creator.douyin.com'
const REFERER = BASE + '/creator-micro/home'

function headers (cookie) {
  return { cookie, referer: REFERER, Origin: BASE, 'User-Agent': 'Mozilla/5.0' }
}

function ok (d) {
  return !!d && (d.status_code === 0 || d.status_code === undefined && d.err_no === 0)
}

async function getUserInfo (http, cookie) {
  const res = await http.get('/aweme/v1/creator/pc/user/info/', { headers: headers(cookie) })
  return { ok: !!(res && res.data && res.data.user_id), data: (res && res.data) || {} }
}

async function getUploadAuth (http, cookie, uid) {
  const q = '/web/api/media/anchor/auth/?aid=1128&cookie_enabled=true&msToken=&a_bogus='
  const res = await http.get(q, { headers: headers(cookie) })
  const d = (res && res.data) || {}
  return { ok: !!(d.data && (d.data.access_key_id || d.data.AccessKeyId)), data: d.data || d }
}

async function createV2 (http, cookie, payload) {
  const res = await http.post('/aweme/v1/web/creator/video/create_v2/?aid=1128&msToken=&a_bogus=', payload, { headers: { ...headers(cookie), 'Content-Type': 'application/json' } })
  const d = (res && res.data) || {}
  const id = d.aweme_id || d.item_id || (d.data && (d.data.aweme_id || d.data.item_id)) || ''
  const okFlag = (d.status_code === 0 || d.status_code === undefined) && !!id
  return { ok: okFlag, id: String(id || ''), error: d.status_msg || d.err_tips || '', raw: d }
}

module.exports = { getUserInfo, getUploadAuth, createV2, headers, BASE, REFERER, ok }

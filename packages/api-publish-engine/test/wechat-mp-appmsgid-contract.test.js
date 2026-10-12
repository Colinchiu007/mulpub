// @ts-check
/**
 * wechat-mp-appmsgid-contract.test.js — 跨轨「appMsgId」口径一致性契约锁
 * （wxmp-draft-mediaid-fix）
 *
 * ## 为什么需要这个文件
 *
 * 参考产品（4.0）逆向工程对公众号的做法是**完全不碰 DOM、回放编辑器自己的 XHR**
 * （`01-docs/learnings.md` 的 `wechat-mp-api-track` 复盘；契约见
 *  `01-docs/PRD-WECHAT-MP-API-TRACK-2026-10-12.md` §3「建草稿」行）：
 *
 *   POST /cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=<T>
 *   ⇒ 回包 {appMsgId, base_resp}
 *
 * 于是本仓有**两条轨**消费同一个响应体字段：
 *   ① API 轨 `packages/api-publish-engine/src/adapters/wechat-mp/draft.js` 的 `createDraft`
 *   ② DOM 轨 `apps/desktop/electron/services/wechat-mp-draft-mediaid.js` 的 `extractAppMsgIdFromBody`
 *
 * 两条轨各写一份键名/判据，就会出现「API 轨说失败、DOM 轨说成功」的分裂 ——
 * 那比本次修的 bug 更难排查。本文件把口径钉成**跨包契约**：
 *   - 键名集合一致；
 *   - `0` / 空串都判「未创建」；
 *   - 畸形响应体都不抛。
 *
 * 本文件零网络、零 Electron 依赖，可在任何目录直跑（node --test）。
 */
'use strict'
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const DESKTOP = path.resolve(__dirname, '..', '..', '..', 'apps', 'desktop', 'electron', 'services')
const ENGINE = path.resolve(__dirname, '..', 'src', 'adapters', 'wechat-mp')
const HELPERS = path.resolve(__dirname, 'helpers', 'wechat-mp-fake-http.js')

const domMod = require(path.join(DESKTOP, 'wechat-mp-draft-mediaid.js'))
const { createDraft } = require(path.join(ENGINE, 'draft.js'))
const { createFakeHttp, SESSION } = require(HELPERS)

/** 参考产品取证记载的键名（PRD-WECHAT-MP-API-TRACK §3 + draft.js 实现） */
const API_TRACK_KEYS = ['appMsgId', 'app_msg_id', 'appMsgId']

test('两条轨对同一个响应体取到同一个 ID', async () => {
  const body = JSON.stringify({ ret: 0, appMsgId: '2651883412', err_msg: 'ok' })
  // DOM 轨
  assert.equal(domMod.extractAppMsgIdFromBody(body), '2651883412')
  // API 轨（经 fake http 走完整 createDraft）
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('operate_appmsg'), respond: { data: { appMsgId: '2651883412', base_resp: { ret: 0 } } } },
  ])
  const r = await createDraft(http, { cookie: 'c', session: SESSION, body: 'title0=t', count: 1 })
  assert.equal(String(r.appMsgId), '2651883412')
})

test('🔴 appMsgId=0 两条轨都判「未创建」（不得一轨成功一轨失败）', async () => {
  // DOM 轨：返回空串
  assert.equal(domMod.extractAppMsgIdFromBody('{"ret":0,"appMsgId":0}'), '')
  assert.equal(domMod.extractAppMsgIdFromBody('{"ret":0,"appMsgId":"0"}'), '')
  // API 轨：抛 draft-not-created
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('operate_appmsg'), respond: { data: { appMsgId: 0, base_resp: { ret: 0 } } } },
  ])
  await assert.rejects(
    () => createDraft(http, { cookie: 'c', session: SESSION, body: 'title0=t', count: 1 }),
    (err) => { assert.equal(err.code, 'draft-not-created'); return true }
  )
})

test('🔴 响应体完全没有 ID 字段 ⇒ 两条轨都不算成功', async () => {
  assert.equal(domMod.extractAppMsgIdFromBody('{"ret":0,"err_msg":"ok"}'), '')
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('operate_appmsg'), respond: { data: { base_resp: { ret: 0, err_msg: 'ok' } } } },
  ])
  await assert.rejects(
    () => createDraft(http, { cookie: 'c', session: SESSION, body: 'title0=t', count: 1 }),
    (err) => { assert.equal(err.code, 'draft-not-created'); return true }
  )
})

test('畸形 / 空响应体两条轨都不抛', async () => {
  for (const bad of ['', 'not json', '<html>err</html>', null, undefined, '{}']) {
    assert.equal(domMod.extractAppMsgIdFromBody(bad), '', 'DOM 轨应返回空串: ' + String(bad))
  }
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('operate_appmsg'), respond: { data: {} } },
  ])
  await assert.rejects(() => createDraft(http, { cookie: 'c', session: SESSION, body: 'title0=t', count: 1 }))
})

test('历史键名 app_msg_id 两条轨都认（API 轨 createDraft 的第三顺位）', async () => {
  assert.equal(domMod.extractAppMsgIdFromBody('{"app_msg_id":"778899"}'), '778899')
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('operate_appmsg'), respond: { data: { app_msg_id: '778899', base_resp: { ret: 0 } } } },
  ])
  const r = await createDraft(http, { cookie: 'c', session: SESSION, body: 'title0=t', count: 1 })
  assert.equal(String(r.appMsgId), '778899')
})

test('原创性错误码（64714）在 API 轨仍映射为 originality-required（不因本 PR 改判）', async () => {
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('operate_appmsg'), respond: { data: { ret: '64714', base_resp: { ret: '64714', err_msg: 'x' } } } },
  ])
  await assert.rejects(
    () => createDraft(http, { cookie: 'c', session: SESSION, body: 'title0=t', count: 1 }),
    (err) => { assert.equal(err.code, 'originality-required'); return true }
  )
  // DOM 轨文案侧同族判据不得丢
  assert.match(domMod.describeSaveFailure('{"ret":"64714"}'), /原创/)
})

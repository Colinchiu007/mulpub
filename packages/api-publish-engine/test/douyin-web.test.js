'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const w = require('../src/publish/platforms/douyin-web')

function fake (map) {
  return {
    get: async (u) => ({ data: map[u] || {} }),
    post: async (u) => ({ data: map[u] || {} }),
  }
}

test('getUserInfo: 有 user_id 才算成功', async () => {
  const h = fake({ '/aweme/v1/creator/pc/user/info/': { user_id: '123' } })
  const r = await w.getUserInfo(h, 'c=1')
  assert.equal(r.ok, true)
})

test('getUploadAuth: 取 access_key_id', async () => {
  const q = '/web/api/media/anchor/auth/?aid=1128&cookie_enabled=true&msToken=&a_bogus='
  const h = fake({ [q]: { data: { access_key_id: 'AK' } } })
  const r = await w.getUploadAuth(h, 'c=1', '123')
  assert.equal(r.ok, true)
  assert.equal(r.data.access_key_id, 'AK')
})

test('createV2: status_code=0 且有 aweme_id 才算成功（2xx 不算）', async () => {
  const q = '/aweme/v1/web/creator/video/create_v2/?aid=1128&msToken=&a_bogus='
  const good = fake({ [q]: { status_code: 0, aweme_id: '999' } })
  assert.equal((await w.createV2(good, 'c=1', {})).ok, true)

  const bad = fake({ [q]: { status_code: 8, status_msg: 'risk' } })
  const r = await w.createV2(bad, 'c=1', {})
  assert.equal(r.ok, false)
  assert.equal(r.error, 'risk')
})

test('createV2: 空响应不算成功', async () => {
  const h = fake({})
  assert.equal((await w.createV2(h, 'c=1', {})).ok, false)
})

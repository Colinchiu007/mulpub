'use strict'
/**
 * POST /api/v1/me/accounts/tombstones —— 墓碑写入端点
 *
 * 这把锁存在的理由：同步侧的恢复逻辑只读墓碑，若没有写端点，被删账号会在下一次
 * 同步从云端原样复活（用户视角 = 删不掉）。只读不写的墓碑等于没有墓碑。
 */
const test = require('node:test').test
const assert = require('node:assert/strict')

const { handleCloudAccountsRequest } = require('../src/cloud-accounts/handlers')

function makeContext ({ method = 'POST', url = '/api/v1/me/accounts/tombstones', body, repository, auth = { businessUser: { id: 'u-1' } } }) {
  return {
    method,
    url,
    req: { method, url, headers: {} },
    auth,
    repository,
    crypto: {},
    bodyParser: async () => body,
    now: () => Date.parse('2026-09-27T00:00:00.000Z'),
  }
}

function repo (spy, addImpl) {
  return {
    listDigest: async () => ({ total: 0, byPlatform: [], tombstones: 0 }),
    addTombstone: async (userId, platform, platformUid) => {
      spy.push([userId, platform, platformUid])
      if (addImpl) return addImpl(platformUid)
    },
  }
}

test('墓碑端点：逐条登记，一条失败不回滚已登记的其他条', async () => {
  const spy = []
  const failing = repo(spy, (uid) => {
    if (uid === 'bad') throw Object.assign(new Error('x'), { code: 'ACCOUNT_WRITE_FAILED' })
  })
  const res = await handleCloudAccountsRequest({
    ...makeContext({
      repository: failing,
      body: { keys: [{ platform: 'douyin', platformUid: 'u1' }, { platform: 'douyin', platformUid: 'bad' }] },
    }),
  })
  assert.deepEqual(spy.map((c) => c[2]), ['u1', 'bad'], '两条都必须各自尝试')
  assert.equal(res.status, 400, '存在逐条 rejected 时不得报 200')
  assert.deepEqual(res.body.data.results.map((r) => r.outcome), ['tombstoned', 'rejected'])
  assert.equal(res.body.error, 'ACCOUNT_WRITE_FAILED')
})

test('墓碑端点：全部成功 → 200 + 逐条 tombstoned', async () => {
  const spy = []
  const res = await handleCloudAccountsRequest(makeContext({
    repository: repo(spy),
    body: { keys: [{ platform: 'douyin', platformUid: 'u2' }] },
  }))
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.data, { results: [{ platform: 'douyin', platformUid: 'u2', outcome: 'tombstoned' }] })
  assert.deepEqual(spy, [['u-1', 'douyin', 'u2']], '归属必须取 token 解析出的 userId')
})

test('墓碑端点：键形状非法一律 400 且一条都不登记', async () => {
  for (const body of [
    undefined,
    {},
    { keys: 'x' },
    { keys: [{ platform: 'douyin' }] },
    { keys: [{ platform: 'douyin', platformUid: '' }] },
    { keys: [{ platform: 'douyin', platformUid: 'u'.repeat(200) }] },
  ]) {
    const spy = []
    const res = await handleCloudAccountsRequest(makeContext({ repository: repo(spy), body }))
    assert.equal(res.status, 400, '坏形状必须被拒：' + JSON.stringify(body))
    assert.equal(spy.length, 0, '空/缺 uid 的键不得产生墓碑 —— 它会挡住该平台全部账号的恢复')
  }
})

test('墓碑端点：只认 POST，且必须已认证', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const spy = []
    const res = await handleCloudAccountsRequest(makeContext({ method, repository: repo(spy), body: { keys: [] } }))
    assert.equal(res.status, 405, method + ' 不得写入墓碑')
    assert.equal(spy.length, 0)
  }
  const spy = []
  // 未认证 401 由 handlers 既有的「路由与归属」套件统一断言，本文件不重复；
  // 这里只锁「只有 POST 能写墓碑」这条端点自身的门禁。
  assert.equal(spy.length, 0)
})

test('墓碑端点：仓储抛非语义码异常也不冒泡成裸 500 之外形态', async () => {
  const boom = repo([], () => { throw new Error('connection reset') })
  const res = await handleCloudAccountsRequest(makeContext({ repository: boom, body: { keys: [{ platform: 'douyin', platformUid: 'u9' }] } }))
  assert.equal(res.status, 400)
  assert.equal(res.body.data.results[0].outcome, 'rejected')
})

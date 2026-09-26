const assert = require('assert')
const test = require('node:test')

const { handleCloudAccountsRequest, CLOUD_ACCOUNTS_ROUTES } = require('../src/cloud-accounts/handlers')
const { createCloudAccountRepository } = require('../src/cloud-accounts/cloud-account-repository')
const { createLocalKms, createEnvelopeCrypto, encodeEnvelope } = require('../src/cloud-accounts/envelope-crypto')
const { credentialDigest } = require('../src/cloud-accounts/credential-digest')

const NOW = new Date('2026-09-27T08:00:00.000Z')
const PAST = '2026-09-26T08:00:00.000Z'
const AUTH = { businessUser: { id: 'u-1', status: 'active' }, authType: 'logto', subject: 'sub-1' }
/** 测试内共用同一把本地主密钥：KMS 不匹配时 503 是预期行为，见「KMS 不可用」用例。 */
const LOCAL_MASTER_KEY = '11'.repeat(32)

function repositoryStub(overrides) {
  const calls = []
  return Object.assign({
    calls,
    async listDigest(userId) { calls.push(['listDigest', userId]); return { total: 2, byPlatform: [{ platform: 'douyin', count: 2 }], tombstones: 1, updatedAt: PAST } },
    async listFull(userId) { calls.push(['listFull', userId]); return { accounts: [{ platform: 'douyin', platformUid: 'uid-9' }], tombstones: [] } },
    async upsertMany(userId, items) { calls.push(['upsertMany', userId, items.length]); return { results: items.map((item) => ({ platform: item.platform, platformUid: item.platformUid, outcome: 'created' })) } },
    async listTombstones(userId) { calls.push(['listTombstones', userId]); return [] },
    async addTombstone(userId, platform, platformUid) { calls.push(['addTombstone', userId, platform, platformUid]); return { created: true } },
    async getCredentials(userId, keys) { calls.push(['getCredentials', userId, keys.length]); return keys.map((key) => ({ platform: key.platform, platformUid: key.platformUid, credentialUpdatedAt: PAST, credentialEnvelope: { v: 1, alg: 'A256GCM', iv: Buffer.alloc(12, 1), ciphertext: Buffer.from('ct', 'utf8'), tag: Buffer.alloc(16, 2), encryptedDataKey: Buffer.alloc(32, 3), digest: 'a'.repeat(64) } })) },
    async clearAll(userId) { calls.push(['clearAll', userId]); return { ok: true, deletedAccounts: 3, deletedTombstones: 2, remaining: 0 } },
  }, overrides || {})
}

function context(overrides) {
  return Object.assign({
    method: 'GET',
    url: '/api/v1/me/accounts',
    req: { method: 'GET', url: '/api/v1/me/accounts', headers: {} },
    auth: AUTH,
    repository: repositoryStub(),
    crypto: createEnvelopeCrypto({ kms: createLocalKms({ key: LOCAL_MASTER_KEY }) }),
    now: NOW,
  }, overrides || {})
}

/** 用真实加密器产出一份可入库的信封（不手搓形状，避免 mock 反向固化错误结构）。 */
async function realEnvelope(userId, platform, platformUid, credential) {
  const envelopeCrypto = createEnvelopeCrypto({ kms: createLocalKms({ key: LOCAL_MASTER_KEY }) })
  const sealed = await envelopeCrypto.encryptCredential({ userId, platform, platformUid, credential })
  const digest = credentialDigest(credential)
  assert.strictEqual(sealed.digest, digest)
  return Object.assign(encodeEnvelope(sealed), { credentialUpdatedAt: PAST })
}

function itemFor(envelope, overrides) {
  return Object.assign({
    platform: 'douyin',
    platformUid: 'uid-9',
    displayName: '数字生命丘丘',
    followers: 100,
    isActive: true,
    metadataUpdatedAt: PAST,
    credentialEnvelope: envelope,
  }, overrides || {})
}

test('handlers：路由与归属', async (t) => {
  await t.test('GET ?view=digest 返回 PRD §7.1 摘要形状', async () => {
    const repository = repositoryStub()
    const response = await handleCloudAccountsRequest(context({ repository }))
    assert.strictEqual(response.status, 200)
    assert.deepStrictEqual(response.body, {
      code: 0,
      data: { total: 2, byPlatform: [{ platform: 'douyin', count: 2 }], tombstones: 1, updatedAt: PAST },
    })
    assert.deepStrictEqual(repository.calls, [['listDigest', 'u-1']])
  })

  await t.test('GET ?view=full 返回 accounts + tombstones，不含任何凭证材料', async () => {
    const repository = repositoryStub()
    const response = await handleCloudAccountsRequest(context({ url: '/api/v1/me/accounts?view=full', repository }))
    assert.strictEqual(response.status, 200)
    assert.deepStrictEqual(response.body.data.accounts, [{ platform: 'douyin', platformUid: 'uid-9' }])
    assert.deepStrictEqual(response.body.data.tombstones, [])
    assert.deepStrictEqual(repository.calls, [['listFull', 'u-1']])
    assert.strictEqual(JSON.stringify(response.body).includes('ciphertext'), false)
  })

  await t.test('未知 view 按 digest 处理（不为视图参数发明错误码）', async () => {
    const repository = repositoryStub()
    await handleCloudAccountsRequest(context({ url: '/api/v1/me/accounts?view=nope', repository }))
    assert.deepStrictEqual(repository.calls, [['listDigest', 'u-1']])
  })

  await t.test('归属只从 auth 取：请求体里的 userId/ownerSubject 一律不生效', async () => {
    const envelope = await realEnvelope('u-1', 'douyin', 'uid-9', { cookies: [] })
    // A) body 顶层混入归属字段：不得改变写入归属（也绝不作为「第二真源」参与裁决）。
    const clean = repositoryStub()
    const inert = await handleCloudAccountsRequest(context({
      method: 'PUT',
      bodyParser: async () => ({ accounts: [itemFor(envelope)], userId: 'victim-9', ownerSubject: 'victim-9' }),
      repository: clean,
    }))
    assert.strictEqual(inert.status, 200)
    assert.deepStrictEqual(clean.calls, [['upsertMany', 'u-1', 1]])
    // B) 条目内自报归属：不在 §6.2 白名单内，逐条拒收。
    const itemLevel = repositoryStub()
    const rejected = await handleCloudAccountsRequest(context({
      method: 'PUT',
      bodyParser: async () => ({ accounts: [itemFor(envelope, { platformUid: 'uid-x', ownerSubject: 'victim-9' })] }),
      repository: itemLevel,
    }))
    assert.strictEqual(rejected.status, 400)
    assert.deepStrictEqual(rejected.body.data.results, [
      { platform: 'douyin', platformUid: 'uid-x', outcome: 'rejected', errorCode: 'ACCOUNT_FIELD_NOT_ALLOWED' },
    ])
    assert.deepStrictEqual(itemLevel.calls, [], '被拒条目不得触库')
  })

  await t.test('未认证 → 401，且不触达仓储', async () => {
    for (const auth of [null, undefined, {}, { businessUser: null }, { userId: '   ' }, 'u-1']) {
      const repository = repositoryStub()
      const response = await handleCloudAccountsRequest(context({ auth, repository }))
      assert.strictEqual(response.status, 401, `auth=${JSON.stringify(auth)} 必须按未认证处理`)
      assert.deepStrictEqual(response.body, { error: 'UNAUTHORIZED' })
      assert.deepStrictEqual(Object.keys(response.body), ['error'])
      assert.strictEqual(repository.calls.length, 0)
    }
  })

  await t.test('未配置仓储 → 503 BUSINESS_USER_REPOSITORY_NOT_CONFIGURED（与既有 /me 族同口径）', async () => {
    for (const override of [{ repository: null }, { repository: undefined }]) {
      const response = await handleCloudAccountsRequest(context(override))
      assert.strictEqual(response.status, 503)
      assert.deepStrictEqual(response.body, { error: 'BUSINESS_USER_REPOSITORY_NOT_CONFIGURED' })
    }
  })

  await t.test('未知路径 404 / 已知路径错方法 405', async () => {
    const notFound = await handleCloudAccountsRequest(context({ url: '/api/v1/me/accounts/other' }))
    assert.strictEqual(notFound.status, 404)
    assert.deepStrictEqual(notFound.body, { error: 'ROUTE_NOT_FOUND' })
    for (const [method, url] of [
      ['POST', '/api/v1/me/accounts'],
      ['DELETE', '/api/v1/me/accounts'],
      ['GET', '/api/v1/me/accounts/sync'],
      ['DELETE', '/api/v1/me/accounts/sync'],
      ['PATCH', '/api/v1/me/accounts'],
    ]) {
      const response = await handleCloudAccountsRequest(context({ method, url, req: { method, url, headers: {} } }))
      assert.strictEqual(response.status, 405, `${method} ${url}`)
      assert.deepStrictEqual(response.body, { error: 'METHOD_NOT_ALLOWED' })
    }
    // 路由清单必须与 PRD §7.1–§7.4 一一对应：四条，断开云端只有 POST 独立路径一条。
    assert.deepStrictEqual(CLOUD_ACCOUNTS_ROUTES.slice().sort(), [
      'GET /api/v1/me/accounts',
      'POST /api/v1/me/accounts/disconnect',
      'POST /api/v1/me/accounts/sync',
      'POST /api/v1/me/accounts/tombstones',
    'PUT /api/v1/me/accounts',
    ])
    // DELETE 不得作为断开云端的入口：`DELETE` 带 body 在反代与 HTTP 客户端上是长期歧义源，
    // 且桌面侧会员白名单 ME_API_PATHS 对 /api/v1/me/accounts 只放开 GET/PUT。
    // 留两条入口等于留两个需要分别守住确认语义的门，故清单里一个 DELETE 都不许出现。
    assert.strictEqual(
      CLOUD_ACCOUNTS_ROUTES.filter((route) => /^\s*DELETE\s/i.test(route)).length,
      0,
      `路由清单不得含 DELETE：${JSON.stringify(CLOUD_ACCOUNTS_ROUTES)}`,
    )
  })

  await t.test('每个 handler 自身异常都必须被捕获成 500 + 语义码，不冒到调用方', async () => {
    // 每条自带请求体：断开云端现在只认 body 里的显式确认，共用一份 keys 体会让它
    // 在确认门禁就 400 返回，永远走不到 clearAll，等于把这条异常回归悄悄变成空跑。
    for (const [method, url, repository, payload] of [
      ['GET', '/api/v1/me/accounts', repositoryStub({ async listDigest() { throw new Error('driver exploded') } }), {}],
      ['GET', '/api/v1/me/accounts?view=full', repositoryStub({ async listFull() { throw Object.assign(new Error('no'), { code: 'BUSINESS_DATABASE_SCHEMA_NOT_READY' }) } }), {}],
      ['POST', '/api/v1/me/accounts/sync', repositoryStub({ async getCredentials() { throw new Error('boom') } }), { keys: [{ platform: 'douyin', platformUid: 'uid-9' }] }],
      ['POST', '/api/v1/me/accounts/disconnect', repositoryStub({ async clearAll() { throw new Error('boom') } }), { confirm: 'cloud' }],
    ]) {
      const response = await handleCloudAccountsRequest(context({
        method,
        url,
        req: { method, url, headers: {} },
        repository,
        bodyParser: async () => payload,
      }))
      assert.strictEqual(response.status >= 500, true, `${method} ${url}`)
      assert.match(response.body.error, /^[A-Z][A-Z0-9_]{2,63}$/)
    }
    const leaked = await handleCloudAccountsRequest(context({
      repository: repositoryStub({ async listDigest() { throw new Error('password=hunter connection string') } }),
    }))
    assert.deepStrictEqual(leaked.body, { error: 'INTERNAL_SERVER_ERROR' })
  })

  await t.test('json 回调可选：提供时按 (status, body) 出线，且返回值同形', async () => {
    const sent = []
    const response = await handleCloudAccountsRequest(context({ json: (status, body) => sent.push({ status, body }) }))
    assert.strictEqual(response.status, 200)
    assert.deepStrictEqual(sent, [{ status: 200, body: response.body }])
  })

  await t.test('入参缺失/形状不合规不得抛同步异常', async () => {
    assert.deepStrictEqual(await handleCloudAccountsRequest(), { status: 404, body: { error: 'ROUTE_NOT_FOUND' } })
    const response = await handleCloudAccountsRequest(context({ req: undefined }))
    assert.strictEqual(response.status, 200)
  })
})

test('handlers：PUT 批量上行', async (t) => {
  await t.test('合法批次 → created，results 与入参同序', async () => {
    const envelope = await realEnvelope('u-1', 'douyin', 'uid-9', { cookies: [{ name: 'a', value: 'b' }] })
    const repository = repositoryStub()
    const response = await handleCloudAccountsRequest(context({
      method: 'PUT',
      url: '/api/v1/me/accounts',
      req: { method: 'PUT', url: '/api/v1/me/accounts', headers: {} },
      bodyParser: async () => ({ accounts: [itemFor(envelope)] }),
      repository,
    }))
    assert.strictEqual(response.status, 200)
    assert.deepStrictEqual(response.body, {
      code: 0,
      data: { results: [{ platform: 'douyin', platformUid: 'uid-9', outcome: 'created' }] },
    })
    assert.strictEqual(repository.calls[0][0], 'upsertMany')
    assert.strictEqual(repository.calls[0][1], 'u-1')
    assert.strictEqual(response.body.data.results.length, 1)
  })

  await t.test('未知字段 → 400，且 results 逐条如实（一条坏不拦其余）', async () => {
    const repositoryStubCalls = []
    const envelope = await realEnvelope('u-1', 'douyin', 'uid-9', { cookies: [] })
    const repository = repositoryStub({
      async upsertMany(userId, items) {
        repositoryStubCalls.push(items.length)
        return { results: items.map((item) => ({ platform: item.platform, platformUid: item.platformUid, outcome: 'created' })) }
      },
    })
    const response = await handleCloudAccountsRequest(context({
      method: 'PUT',
      req: { method: 'PUT', url: '/api/v1/me/accounts', headers: {} },
      bodyParser: async () => ({
        accounts: [
          itemFor(envelope),
          itemFor(envelope, { platformUid: 'uid-bad', status: 'active' }),
          itemFor(envelope, { platformUid: 'uid-3', followers: -1 }),
        ],
      }),
      repository,
    }))
    assert.strictEqual(response.status, 400)
    assert.strictEqual(response.body.error, 'ACCOUNT_FIELD_NOT_ALLOWED', '顶层 error 必须给出首个拒绝原因')
    assert.deepStrictEqual(response.body.data.results, [
      { platform: 'douyin', platformUid: 'uid-9', outcome: 'created' },
      { platform: 'douyin', platformUid: 'uid-bad', outcome: 'rejected', errorCode: 'ACCOUNT_FIELD_NOT_ALLOWED' },
      { platform: 'douyin', platformUid: 'uid-3', outcome: 'rejected', errorCode: 'ACCOUNT_FOLLOWERS_INVALID' },
    ])
    assert.deepStrictEqual(repositoryStubCalls, [1], '只有合法条目进入仓储')
  })

  await t.test('KMS 不可用 → 503 KMS_UNAVAILABLE，且一条都没写', async () => {
    const envelope = await realEnvelope('u-1', 'douyin', 'uid-9', { cookies: [] })
    const repository = repositoryStub()
    const response = await handleCloudAccountsRequest(context({
      method: 'PUT',
      req: { method: 'PUT', url: '/api/v1/me/accounts', headers: {} },
      bodyParser: async () => ({ accounts: [itemFor(envelope)] }),
      repository,
      crypto: createEnvelopeCrypto({
        kms: { async wrap() { throw new Error('kms down') }, async unwrap() { throw new Error('kms down') } },
      }),
    }))
    assert.strictEqual(response.status, 503)
    assert.deepStrictEqual(response.body, { error: 'KMS_UNAVAILABLE' })
    assert.deepStrictEqual(repository.calls, [])
  })

  await t.test('未接加密器 → 503 KMS_UNAVAILABLE（禁止把无法确认主密钥的信封入库）', async () => {
    const envelope = await realEnvelope('u-1', 'douyin', 'uid-9', { cookies: [] })
    const repository = repositoryStub()
    const response = await handleCloudAccountsRequest(context({
      method: 'PUT',
      req: { method: 'PUT', url: '/api/v1/me/accounts', headers: {} },
      bodyParser: async () => ({ accounts: [itemFor(envelope)] }),
      repository,
      crypto: null,
    }))
    assert.strictEqual(response.status, 503)
    assert.deepStrictEqual(response.body, { error: 'KMS_UNAVAILABLE' })
    assert.deepStrictEqual(repository.calls, [])
  })

  await t.test('批量层错误：>100 条 413，body 形状不对 400，且都不触库', async () => {
    const envelope = await realEnvelope('u-1', 'douyin', 'uid-9', { cookies: [] })
    for (const [payload, code, status] of [
      [{ accounts: new Array(101).fill(itemFor(envelope)) }, 'ACCOUNT_BATCH_TOO_LARGE', 413],
      [{}, 'ACCOUNT_BATCH_INVALID', 400],
      [{ accounts: 'nope' }, 'ACCOUNT_BATCH_INVALID', 400],
      [null, 'ACCOUNT_BATCH_INVALID', 400],
    ]) {
      const repository = repositoryStub()
      const response = await handleCloudAccountsRequest(context({
        method: 'PUT',
        req: { method: 'PUT', url: '/api/v1/me/accounts', headers: {} },
        bodyParser: async () => payload,
        repository,
      }))
      assert.strictEqual(response.status, status, `${code} 的 HTTP 状态`)
      assert.deepStrictEqual(response.body, { error: code })
      assert.deepStrictEqual(repository.calls, [])
    }
  })

  await t.test('bodyParser 抛错 / 缺失 → 400 ACCOUNT_BATCH_INVALID（不得冒泡 500）', async () => {
    const throwing = await handleCloudAccountsRequest(context({
      method: 'PUT',
      req: { method: 'PUT', url: '/api/v1/me/accounts', headers: {} },
      bodyParser: async () => { throw new Error('body too large') },
    }))
    assert.strictEqual(throwing.status, 400)
    assert.deepStrictEqual(throwing.body, { error: 'ACCOUNT_BATCH_INVALID' })
    const missing = await handleCloudAccountsRequest(context({
      method: 'PUT',
      req: { method: 'PUT', url: '/api/v1/me/accounts', headers: {} },
    }))
    assert.strictEqual(missing.status, 400)
    assert.deepStrictEqual(missing.body, { error: 'ACCOUNT_BATCH_INVALID' })
  })

  await t.test('空批次 → 200 且 results 为空（不触库）', async () => {
    const repository = repositoryStub()
    const response = await handleCloudAccountsRequest(context({
      method: 'PUT',
      req: { method: 'PUT', url: '/api/v1/me/accounts', headers: {} },
      bodyParser: async () => ({ accounts: [] }),
      repository,
    }))
    assert.strictEqual(response.status, 200)
    assert.deepStrictEqual(response.body, { code: 0, data: { results: [] } })
    assert.deepStrictEqual(repository.calls, [])
  })

  await t.test('时钟注入点三种形态都必须生效（接线方传的是函数）', async () => {
    const envelope = await realEnvelope('u-1', 'douyin', 'uid-9', { cookies: [] })
    // 略微超前的 metadataUpdatedAt：只有当注入时钟被真正读到时才判合法，
    // 否则「注入 now」会退化成一个没人读的参数（死探针），时间戳门禁静默失去可测性。
    const future = new Date(NOW.getTime() + 60_000).toISOString()
    const body = async () => ({ accounts: [itemFor(envelope, { metadataUpdatedAt: future })] })
    const asDate = await handleCloudAccountsRequest(context({ method: 'PUT', bodyParser: body, now: new Date(NOW.getTime() + 120_000) }))
    assert.strictEqual(asDate.status, 200, 'now 为 Date 必须生效')
    const asNumber = await handleCloudAccountsRequest(context({ method: 'PUT', bodyParser: body, now: NOW.getTime() + 120_000 }))
    assert.strictEqual(asNumber.status, 200, 'now 为时间戳必须生效')
    const asFunction = await handleCloudAccountsRequest(context({ method: 'PUT', bodyParser: body, now: () => NOW.getTime() + 120_000 }))
    assert.strictEqual(asFunction.status, 200, 'now 为取时函数必须生效（接线方即此形态）')
    const asFunctionDate = await handleCloudAccountsRequest(context({ method: 'PUT', bodyParser: body, now: () => new Date(NOW.getTime() + 120_000) }))
    assert.strictEqual(asFunctionDate.status, 200)
    const beyondSkew = await handleCloudAccountsRequest(context({
      method: 'PUT',
      bodyParser: async () => ({ accounts: [itemFor(envelope, { metadataUpdatedAt: new Date(NOW.getTime() + 3_600_000).toISOString() })] }),
      now: () => NOW.getTime(),
    }))
    assert.strictEqual(beyondSkew.status, 400, '超出 now+5min 必须拒绝')
    assert.strictEqual(beyondSkew.body.data.results[0].errorCode, 'ACCOUNT_TIMESTAMP_INVALID')
  })
})

test('handlers：POST 取凭证与 POST 断开云端', async (t) => {
  await t.test('POST /sync → 批量取回信封（base64 线上形态）', async () => {
    const repository = repositoryStub()
    const response = await handleCloudAccountsRequest(context({
      method: 'POST',
      url: '/api/v1/me/accounts/sync',
      req: { method: 'POST', url: '/api/v1/me/accounts/sync', headers: {} },
      bodyParser: async () => ({ keys: [{ platform: 'douyin', platformUid: 'uid-9' }] }),
      repository,
    }))
    assert.strictEqual(response.status, 200)
    const [entry] = response.body.data.credentials
    assert.strictEqual(entry.platformUid, 'uid-9')
    assert.strictEqual(typeof entry.credentialEnvelope.iv, 'string', '信封必须以 base64 出线')
    assert.strictEqual(Buffer.from(entry.credentialEnvelope.iv, 'base64').length, 12)
    assert.strictEqual(entry.credentialEnvelope.alg, 'A256GCM')
    assert.deepStrictEqual(repository.calls, [['getCredentials', 'u-1', 1]])
  })

  await t.test('POST /sync 入参非法 → 400，不发查询', async () => {
    for (const [payload, code] of [
      [{}, 'ACCOUNT_BATCH_INVALID'],
      [{ keys: [{ platform: 'douyin' }] }, 'ACCOUNT_UID_INVALID'],
      [{ keys: [{ platform: 'weibo', platformUid: 'u' }] }, 'ACCOUNT_PLATFORM_UNSUPPORTED'],
    ]) {
      const repository = repositoryStub()
      const response = await handleCloudAccountsRequest(context({
        method: 'POST',
        url: '/api/v1/me/accounts/sync',
        req: { method: 'POST', url: '/api/v1/me/accounts/sync', headers: {} },
        bodyParser: async () => payload,
        repository,
      }))
      assert.strictEqual(response.status, 400)
      assert.deepStrictEqual(response.body, { error: code })
      assert.deepStrictEqual(repository.calls, [])
    }
  })

  await t.test('POST disconnect 缺/错 confirm → 400，且绝不删任何东西', async () => {
    // 坏值按两个维度取：确认值形态（缺席 / 空串 / 语义近似 / 大小写不符 / 带空格），
    // 以及 body 自身不是对象（null / 字符串 / 数组）。`'cloud'` 这条是刻意放的陷阱——
    // 串本身等于确认值，但承载形状不对，一样不得删。
    for (const payload of [
      {}, { confirm: '' }, { confirm: 'yes' }, { confirm: 'CLOUD' }, { confirm: ' cloud' },
      null, 'cloud', ['cloud'],
    ]) {
      const repository = repositoryStub()
      const response = await handleCloudAccountsRequest(context({
        method: 'POST',
        url: '/api/v1/me/accounts/disconnect',
        req: { method: 'POST', url: '/api/v1/me/accounts/disconnect', headers: {} },
        bodyParser: async () => payload,
        repository,
      }))
      assert.strictEqual(response.status, 400, `body=${JSON.stringify(payload)}`)
      assert.deepStrictEqual(response.body, { error: 'DISCONNECT_CONFIRMATION_REQUIRED' })
      assert.deepStrictEqual(repository.calls, [], '确认值不匹配时不得发出任何删除')
    }
    // 接线方拿到空请求体（没有 bodyParser 可注入）同样不得当成已确认。
    const repository = repositoryStub()
    const bodyless = await handleCloudAccountsRequest(context({
      method: 'POST',
      url: '/api/v1/me/accounts/disconnect',
      req: { method: 'POST', url: '/api/v1/me/accounts/disconnect', headers: {} },
      repository,
    }))
    assert.strictEqual(bodyless.status, 400)
    assert.deepStrictEqual(bodyless.body, { error: 'DISCONNECT_CONFIRMATION_REQUIRED' })
    assert.deepStrictEqual(repository.calls, [], '无 body 即无确认，不得触库')
  })

  await t.test('断开云端只认 POST：其它方法打到 disconnect 一律 405 且 clearAll 不被调用', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const repository = repositoryStub()
      const response = await handleCloudAccountsRequest(context({
        method,
        url: '/api/v1/me/accounts/disconnect',
        req: { method, url: '/api/v1/me/accounts/disconnect', headers: {} },
        // 即便请求体里带着合法确认，方法不对也进不了 handleDisconnect。
        bodyParser: async () => ({ confirm: 'cloud' }),
        repository,
      }))
      assert.strictEqual(response.status, 405, `${method} 不得触发断开`)
      assert.deepStrictEqual(response.body, { error: 'METHOD_NOT_ALLOWED' })
      assert.deepStrictEqual(repository.calls, [], `${method} 不得调用 clearAll`)
    }
    // 反证位（防上面四条假绿）：同一夹具下 POST 必须真的删成，
    // 否则「全部方法都 405」的实现退化会让四条断言一起变成空跑。
    const repository = repositoryStub()
    const allowed = await handleCloudAccountsRequest(context({
      method: 'POST',
      url: '/api/v1/me/accounts/disconnect',
      req: { method: 'POST', url: '/api/v1/me/accounts/disconnect', headers: {} },
      bodyParser: async () => ({ confirm: 'cloud' }),
      repository,
    }))
    assert.strictEqual(allowed.status, 200)
    assert.deepStrictEqual(repository.calls, [['clearAll', 'u-1']], '只有 POST 能删')
  })

  await t.test('X-Confirm-Disconnect 请求头不再是授权承载：只带头的请求不得删掉任何东西', async () => {
    // 断开云端曾同时接受「DELETE + 请求头」与「POST + body」两种确认承载，
    // 那等于两条门要分别守；现在确认只认 body，头必须是死字。
    for (const [method, url, expectStatus] of [
      ['DELETE', '/api/v1/me/accounts', 405],
      ['POST', '/api/v1/me/accounts/disconnect', 400],
    ]) {
      const repository = repositoryStub()
      const response = await handleCloudAccountsRequest(context({
        method,
        url,
        req: { method, url, headers: { 'x-confirm-disconnect': 'cloud', 'X-Confirm-Disconnect': 'cloud' } },
        bodyParser: async () => ({}),
        repository,
      }))
      assert.strictEqual(response.status, expectStatus, `${method} ${url}`)
      assert.deepStrictEqual(
        response.body,
        { error: expectStatus === 405 ? 'METHOD_NOT_ALLOWED' : 'DISCONNECT_CONFIRMATION_REQUIRED' },
      )
      assert.deepStrictEqual(repository.calls, [], '请求头不得被当成已确认')
    }
  })

  await t.test('POST disconnect 确认 → 200 { deletedAccounts, deletedTombstones }', async () => {
    const repository = repositoryStub()
    const response = await handleCloudAccountsRequest(context({
      method: 'POST',
      url: '/api/v1/me/accounts/disconnect',
      req: { method: 'POST', url: '/api/v1/me/accounts/disconnect', headers: {} },
      bodyParser: async () => ({ confirm: 'cloud' }),
      repository,
    }))
    assert.strictEqual(response.status, 200)
    assert.deepStrictEqual(response.body, { code: 0, data: { deletedAccounts: 3, deletedTombstones: 2 } })
    assert.deepStrictEqual(repository.calls, [['clearAll', 'u-1']])
  })

  await t.test('POST disconnect 未清干净 → 500 CLOUD_DISCONNECT_PARTIAL + 已删/剩余如实', async () => {
    const repository = repositoryStub({ async clearAll() { return { ok: false, errorCode: 'CLOUD_DISCONNECT_PARTIAL', deletedAccounts: 1, deletedTombstones: 0, remaining: 3 } } })
    const response = await handleCloudAccountsRequest(context({
      method: 'POST',
      url: '/api/v1/me/accounts/disconnect',
      req: { method: 'POST', url: '/api/v1/me/accounts/disconnect', headers: {} },
      bodyParser: async () => ({ confirm: 'cloud' }),
      repository,
    }))
    assert.strictEqual(response.status, 500)
    assert.deepStrictEqual(response.body, { error: 'CLOUD_DISCONNECT_PARTIAL', deletedAccounts: 1, remaining: 3 })
  })

  await t.test('断开云端不得影响本机：响应里不出现本机路径或凭证字段', async () => {
    const response = await handleCloudAccountsRequest(context({
      method: 'POST',
      url: '/api/v1/me/accounts/disconnect',
      req: { method: 'POST', url: '/api/v1/me/accounts/disconnect', headers: {} },
      bodyParser: async () => ({ confirm: 'cloud' }),
    }))
    assert.strictEqual(response.status, 200, '前置：断开必须真的成功，否则下面的"不含敏感字段"是空断言')
    const serialized = JSON.stringify(response.body)
    for (const forbidden of ['credential', 'cookie', 'userData', 'filePath', 'accounts.json']) {
      assert.strictEqual(serialized.toLowerCase().includes(forbidden), false, `响应不该出现 ${forbidden}`)
    }
  })
})

test('handlers：与真仓储 + 真加密器的贯通（不 mock SQL 执行以外的层）', async (t) => {
  await t.test('PUT → 真 repository 生成参数化 SQL，KMS 验后入库', async () => {
    const calls = []
    const pool = {
      async query(text, values) {
        calls.push({ text, values })
        // 真仓储靠「INSERT ... DO NOTHING 是否回行」区分 created / 竞态，这里让写语句回一行。
        if (/^\s*INSERT/i.test(text)) return { rows: [{ id: '77' }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      },
    }
    const envelope = await realEnvelope('u-1', 'douyin', 'uid-9', { cookies: [{ name: 'sid', value: 'private-value' }], localStorage: { a: 'b' } })
    const response = await handleCloudAccountsRequest(context({
      method: 'PUT',
      req: { method: 'PUT', url: '/api/v1/me/accounts', headers: {} },
      bodyParser: async () => ({ accounts: [itemFor(envelope)] }),
      repository: createCloudAccountRepository({ pool }),
    }))
    assert.strictEqual(response.status, 200)
    assert.strictEqual(calls.length, 2, 'SELECT + INSERT')
    assert.match(calls[1].text, /ON CONFLICT \(user_id, platform, platform_uid\) DO NOTHING/)
    const serializedSql = calls.map((call) => call.text).join('\n')
    assert.strictEqual(serializedSql.includes('private-value'), false, '凭证明文不得出现在 SQL 文本里')
    assert.strictEqual(serializedSql.includes('cookies'), false, '凭证结构不得出现在 SQL 文本里')
    assert.ok(Buffer.isBuffer(calls[1].values[8]), '信封密文必须以 Buffer 传参')
    assert.ok(calls[1].values.map((v) => (typeof v === 'string' ? v : '')).join('|').includes('uid-9'))
  })
})

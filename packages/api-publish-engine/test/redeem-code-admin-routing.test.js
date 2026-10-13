'use strict'

/**
 * 运营兑换码路由分派的回归护栏。
 *
 * 为什么需要这层：`/api/v1/admin/member/*` 整块已从 publish-api-server.js 抽到
 * `publish-api-redeem-code-admin.js` mixin（逐文件行数点名目标所迫）。重构把
 * 「鉴权守卫 + 路由分派 + 错误出口」搬了家，最容易出的错是**某条分支搬漏**——
 * 端点静默 404 或守卫失效。这类错误在单元测试（只测 service）里看不见。
 *
 * 这里直接把 mixin 挂到桩原型上驱动，覆盖三件事：
 *   1. 三个端点的分派都还在（含 grant 未被误伤）
 *   2. **鉴权守卫没有被搬丢**：非 logto 身份一律 403，且在任何 handler 之前
 *   3. REDEEM_BATCH_INCOMPLETE 走专用出口并带上已签发码，其余错误仍走 _commerceFailure
 */

const assert = require('assert')
const test = require('node:test')

const { applyRedeemCodeAdminHelpers } = require('../src/auth/publish-api-redeem-code-admin')

function createStub(overrides = {}) {
  const emitted = []
  const audit = []
  const errors = []
  const subCalls = []

  // 混入目标是**构造函数**（applyXxx 内部做 Proto.prototype），
  // 直接传实例会拿到 Object.prototype 再取 .prototype → undefined。
  class Stub {
    _json(res, status, body) { emitted.push({ status, body }); return true }
    _auditLog = { log(entry) { audit.push(entry) } }
    _ownerSubject() { return 'admin-subject-1' }
    async _parseBody() { return overrides.body || {} }
    _commerceFailure(req, res, error) {
      errors.push(error);
      this._json(res, (error && error.status) || 500, { error: (error && error.code) || 'X' })
    }
  }
  applyRedeemCodeAdminHelpers(Stub)

  const stub = new Stub()
  stub.emitted = emitted
  stub.audit = audit
  stub.errors = errors
  stub.subCalls = subCalls
  stub._subscriptionService = {
    async grant(args) { subCalls.push(['grant', args]); return { userId: args.userId, plan: args.plan } },
    async createRedeemBatch(args) { subCalls.push(['createRedeemBatch', args]); return { batch: 'b1', requested: args.count, generated: args.count, codes: ['ABCD-EFGH-JKMN'] } },
    async listRedeemCodes(args) {
      subCalls.push(['listRedeemCodes', args])
      return { codes: [{ code: args.reveal ? 'ABCD-EFGH-JKMN' : 'ABCD-****-****', masked: !args.reveal }], total: 1, limit: args.limit, offset: args.offset, revealed: args.reveal === true }
    },
    async disableRedeemCode(args) { subCalls.push(['disableRedeemCode', args]); return { code: args.code, status: 'disabled', idempotent: false } },
  }
  return stub
}

/**
 * 复刻 publish-api-server.js 的分派方式。
 *
 * 关键细节：真实调用方传进来的 `url` 是 `requestPath(req)` **剥掉 query 之后**的路径，
 * 而 `req.url` 仍是带 query 的原始串——分派用前者，取参数用后者。
 * 这里必须照抄这个约定，否则测的是一个调用方永远不会产生的不一致输入。
 */
async function drive(stub, method, fullUrl, reqOverrides = {}) {
  const req = Object.assign({ url: fullUrl, auth: { authType: 'logto' } }, reqOverrides)
  if (req.auth.authType !== 'logto') {
    stub._json(req.res || {}, 403, { error: 'AUTH_SCOPE_MISSING' })
    return true
  }
  return stub._handleAdminMemberRoute(req, {}, method, fullUrl.split('?')[0])
}

test('路由分派：grant / 列表 / 吊销 三条分支都在', async () => {
  const grant = createStub({ body: { userId: 'u-1', plan: 'pro' } })
  await drive(grant, 'POST', '/api/v1/admin/member/grant')
  assert.deepStrictEqual(grant.subCalls[0][0], 'grant')

  const list = createStub()
  assert.strictEqual(await drive(list, 'GET', '/api/v1/admin/member/redeem-codes'), true)
  assert.deepStrictEqual(list.subCalls[0][0], 'listRedeemCodes')

  const disable = createStub()
  assert.strictEqual(await drive(disable, 'POST', '/api/v1/admin/member/redeem-codes/disable'), true)
  assert.deepStrictEqual(disable.subCalls[0][0], 'disableRedeemCode')
})

test('路由分派：进入 /admin/member/ 前缀但无匹配路由 → 404（算已处理）', async () => {
  const stub = createStub()
  // 前缀内的一切都算「已处理」：404 由本块自己发，不该回落给外层再判一次
  assert.strictEqual(await drive(stub, 'GET', '/api/v1/admin/member/unknown'), true)
  assert.deepStrictEqual(stub.emitted.at(-1), { status: 404, body: { error: 'ROUTE_NOT_FOUND' } })
  assert.strictEqual(await drive(stub, 'DELETE', '/api/v1/admin/member/redeem-codes'), true)
})

test('路由分派：前缀不匹配才返回 false，交回调用方', async () => {
  const stub = createStub()
  assert.strictEqual(await drive(stub, 'GET', '/api/v1/somewhere-else'), false)
  assert.strictEqual(stub.emitted.length, 0, '前缀外不该产生任何响应')
})

test('鉴权守卫：非 logto 身份不得触达任何 handler', async () => {
  // 直接测守卫代码块本身（drive 里的复刻不是被测代码）
  const stub = createStub()
  const calls = []
  stub._handleAdminRedeemCodeList = async () => { calls.push('list'); return true }
  const req = { url: '/api/v1/admin/member/redeem-codes', auth: { authType: 'api_key' } }

  let emitted = null
  stub._json = (res, status, body) => { emitted = { status, body } }
  // 走 mixin 的真实入口：它内部先做守卫，守卫不通过时直接返回 false
  const handled = await stub._handleAdminMemberRoute(req, {}, 'GET', '/api/v1/admin/member/redeem-codes')
  assert.deepStrictEqual(calls, [], '守卫必须先于 handler 执行')
  // 已发 403 ⇒ 必须报告「已处理」，否则调用方会继续往下并发出第二个响应
  assert.strictEqual(handled, true)
  assert.deepStrictEqual(emitted, { status: 403, body: { error: 'AUTH_SCOPE_MISSING' } })
})

test('鉴权守卫：无 auth 时同样被拒', async () => {
  const stub = createStub()
  let emitted = null
  stub._json = (res, status, body) => { emitted = { status, body } }
  const handled = await stub._handleAdminMemberRoute({ url: '/api/v1/admin/member/redeem-codes' }, {}, 'GET', '/api/v1/admin/member/redeem-codes')
  assert.strictEqual(handled, true)
  assert.deepStrictEqual(emitted, { status: 403, body: { error: 'AUTH_SCOPE_MISSING' } })
})

test('列表默认掩码，且仅在 reveal 时记审计', async () => {
  const masked = createStub()
  await drive(masked, 'GET', '/api/v1/admin/member/redeem-codes')
  assert.strictEqual(masked.subCalls[0][1].reveal, false)
  assert.strictEqual(masked.audit.length, 0, '掩码读取不该留审计（否则审计噪音淹没真操作）')
  assert.strictEqual(masked.emitted[0].body.revealed, false)

  const revealed = createStub()
  await drive(revealed, 'GET', '/api/v1/admin/member/redeem-codes?reveal=true')
  assert.strictEqual(revealed.subCalls[0][1].reveal, true)
  assert.strictEqual(revealed.audit.length, 1, '导出完整码必须留痕')
  assert.strictEqual(revealed.audit[0].type, 'redeem_code_reveal')
  assert.strictEqual(revealed.audit[0].ownerSubject, 'admin-subject-1', '审计必须带操作者身份')
})

test('列表 query 解析：分页与筛选正确下传', async () => {
  const stub = createStub()
  await drive(stub, 'GET', '/api/v1/admin/member/redeem-codes?plan=pro&status=used&limit=5&offset=10')
  const args = stub.subCalls[0][1]
  assert.strictEqual(args.plan, 'pro')
  assert.strictEqual(args.status, 'used')
  assert.strictEqual(args.limit, 5)
  assert.strictEqual(args.offset, 10)
})

test('列表 query 解析：分页缺省用 20/0', async () => {
  const stub = createStub()
  await drive(stub, 'GET', '/api/v1/admin/member/redeem-codes')
  assert.strictEqual(stub.subCalls[0][1].limit, 20)
  assert.strictEqual(stub.subCalls[0][1].offset, 0)
})

test('错误出口：REDEEM_BATCH_INCOMPLETE 带已签发码，不进 _commerceFailure', async () => {
  const stub = createStub()
  const issued = ['ABCD-EFGH-JKMN', 'WXYZ-2345-6789']
  const err = Object.assign(new Error('批量签发未补足'), {
    code: 'REDEEM_BATCH_INCOMPLETE', status: 409,
    requested: 10, generated: 2, rounds: 10, created: issued,
  })

  const handled = stub._handleAdminRedeemCodeError({}, {}, err)
  assert.strictEqual(handled, true)
  assert.strictEqual(stub.errors.length, 0, '带业务载荷的错误不得走通用出口（会丢码）')
  assert.strictEqual(stub.emitted[0].status, 409)
  assert.deepStrictEqual(stub.emitted[0].body.codes, issued)
  assert.strictEqual(stub.emitted[0].body.generated, 2)
  assert.strictEqual(stub.audit[0].type, 'redeem_code_batch_incomplete')
})

test('错误出口：其余 commerce 错误交回 _commerceFailure', () => {
  const stub = createStub()
  const err = Object.assign(new Error('时长不合法'), { code: 'DURATION_INVALID', status: 400 })
  assert.strictEqual(stub._handleAdminRedeemCodeError({}, {}, err), false)
  assert.strictEqual(stub.emitted.length, 0)
})

test('回归护栏：已发响应的所有分支都必须返回 true（含 400 校验失败分支）', async () => {
  // 真实回归：mixin 里残留过一处行内 `return;`（USER_ID_REQUIRED 分支）。
  // 从 _handle 抽出后它只退出 mixin 方法 → 返回 undefined → 调用方误判「未处理」
  // 而继续往下 → 对同一个 req 发出第二个响应（ERR_HTTP_HEADERS_SENT 打挂进程）。
  // 之前只测了成功分支与鉴权守卫，恰好漏掉 400 这类校验失败分支。
  const stub = createStub({ body: {} }) // 缺 userId → 触发 400 早退
  const handled = await stub._handleAdminMemberRoute(
    { url: '/api/v1/admin/member/grant', auth: { authType: 'logto' } },
    {}, 'POST', '/api/v1/admin/member/grant'
  )
  assert.strictEqual(stub.emitted.length, 1, '只应发一次响应')
  assert.strictEqual(stub.emitted[0].status, 400)
  assert.strictEqual(handled, true, '已发响应 ⇒ 必须报告已处理，否则调用方会重复响应')
})

test('回归护栏：503 服务未配置分支同样返回 true', async () => {
  const stub = createStub()
  stub._subscriptionService = null
  const handled = await stub._handleAdminMemberRoute(
    { url: '/api/v1/admin/member/grant', auth: { authType: 'logto' } },
    {}, 'POST', '/api/v1/admin/member/grant'
  )
  assert.strictEqual(handled, true)
  assert.deepStrictEqual(stub.emitted[0], { status: 503, body: { error: 'SUBSCRIPTION_SERVICE_NOT_CONFIGURED' } })
})

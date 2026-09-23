const assert = require('assert')
const http = require('http')
const { TestPublishApiServer: PublishApiServer } = require('./test-publish-api-server')

function request(port, method, path, token, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, method, path,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }) }
        catch (error) { reject(new Error(`响应非 JSON (${res.statusCode}): ${data.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function createRepositoryStub() {
  return {
    calls: [],
    async findBySubject(provider, subject) {
      return { id: 'business-user-1', auth_provider: provider, auth_subject: subject, status: 'active', display_name: '用户甲' }
    },
    async create() { throw new Error('存量测试不应创建用户') },
    async countUnreadNotifications(userId) { this.calls.push(['countUnread', userId]); return 2 },
    async listOrders(userId, options) { this.calls.push(['listOrders', userId, options]); return [{ id: 'ord-1', plan: 'pro', amount: 0, channel: 'redeem', status: 'paid' }] },
    async listNotifications(userId, options) { this.calls.push(['listNotifications', userId, options]); return [{ id: 'ntf-1', title: '公告', read_at: null }] },
    async markNotificationsRead(userId) { this.calls.push(['markRead', userId]); return ['ntf-1'] },
    async listActiveSessions(userId) { this.calls.push(['listSessions', userId]); return [{ id: 'ses-x', device_id: 'device-a' }] },
    async upsertSession(record) { this.calls.push(['upsertSession', record]); return { id: 'ses-x', ...record } },
    async revokeOtherSessions(userId, keepDeviceId) { this.calls.push(['revokeOthers', userId, keepDeviceId]); return ['ses-old'] },
    async updateProfile(id, patch) { this.calls.push(['updateProfile', id, patch]); return { id, display_name: patch.display_name, avatar_url: patch.avatar_url } },
  }
}

function createServiceStub(overrides = {}) {
  const repository = createRepositoryStub()
  return {
    repository,
    planOverrides: null,
    async getSubscriptionView(userId) {
      if (overrides.subscriptionFails) throw new Error('会员视图不可用')
      return { plan: 'standard', status: 'active', periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z', entitlement: { plan: 'standard', features: ['cloud_publish'], quota: {}, limits: {} } }
    },
    async getUsageView() { return { plan: 'standard', features: [{ feature: 'cloud_publish', used: 1, limit: 1500 }] } },
    async redeem({ userId, code }) {
      if (overrides.redeemNotFound) throw Object.assign(new Error('不存在'), { code: 'REDEEM_CODE_NOT_FOUND', status: 404 })
      return { idempotent: false, code: 'ABCD-EFGH-JKMN', plan: 'pro' }
    },
    async grant({ userId, plan }) {
      if (overrides.grantInvalid) throw Object.assign(new Error('档位'), { code: 'PLAN_INVALID', status: 400 })
      return { plan, order: { id: 'ord-admin', channel: 'admin_grant' } }
    },
    async createRedeemBatch({ count }) { return { batch: 'b1', codes: ['ABCD-EFGH-JKMN'] } },
  }
}

function createVerifier() {
  return {
    verify: async (token) => {
      if (token === 'member-read') return { subject: 'sub-me', scopes: ['profile:read'] }
      if (token === 'member-write') return { subject: 'sub-me', scopes: ['profile:read', 'profile:write'] }
      if (token === 'admin-token') return { subject: 'sub-admin', scopes: ['admin:users'] }
      if (token === 'publish-token') return { subject: 'sub-me', scopes: ['publish:read', 'publish:submit'] }
      throw Object.assign(new Error('AUTH_TOKEN_INVALID'), { code: 'AUTH_TOKEN_INVALID', status: 401 })
    },
  }
}

async function main() {
  // 场景 1：完整会员链路
  const service = createServiceStub()
  const server = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createRepositoryStub(),
    entitlementProvider: {
      async getForUser() { return { plan: 'standard', features: ['cloud_publish'], quota: { cloud_publish_monthly: 1500 }, limits: { daily_publish: 50 } } },
      async consumeFeature() { return { used: 1, remaining: 1499 } },
    },
    subscriptionService: service,
  })
  await server.start(0)
  const port = server._server.address().port
  try {
    const plans = await request(port, 'GET', '/api/v1/plans', 'member-read')
    assert.strictEqual(plans.status, 200)
    assert.strictEqual(plans.body.plans.length, 3)
    assert.strictEqual(plans.body.plans[1].priceMonthlyCents, 2900)
    console.log('  ✅ GET /api/v1/plans 价目目录')

    const me = await request(port, 'GET', '/api/v1/me', 'member-read', null, { 'X-Device-ID': 'device-aaaaaaaaaaaa' })
    assert.strictEqual(me.status, 200)
    assert.strictEqual(me.body.membership.subscription.plan, 'standard')
    assert.strictEqual(me.body.membership.unreadNotifications, 2)
    assert.strictEqual(me.body.membership.usage.features[0].feature, 'cloud_publish')
    assert.deepStrictEqual(me.body.entitlement.limits, { daily_publish: 50 }, 'limits 必须透传')
    assert.ok(service.repository.calls.some((call) => call[0] === 'upsertSession' && call[1].deviceId === 'device-aaaaaaaaaaaa'), '/me 应登记设备会话')
    console.log('  ✅ GET /api/v1/me 聚合 membership + 设备登记 + limits 透传')

    const meNoDevice = await request(port, 'GET', '/api/v1/me', 'member-read')
    assert.strictEqual(meNoDevice.status, 200, '缺 X-Device-ID 不影响 /me')
    console.log('  ✅ /me 无设备头不受影响')

    const orders = await request(port, 'GET', '/api/v1/me/orders', 'member-read')
    assert.strictEqual(orders.status, 200)
    assert.strictEqual(orders.body.orders[0].id, 'ord-1')
    const notifications = await request(port, 'GET', '/api/v1/me/notifications', 'member-read')
    assert.strictEqual(notifications.status, 200)
    assert.strictEqual(notifications.body.unreadCount, 2)
    const markRead = await request(port, 'POST', '/api/v1/me/notifications/read', 'member-write', {})
    assert.strictEqual(markRead.status, 200)
    assert.deepStrictEqual(markRead.body.ids, ['ntf-1'])
    const sessions = await request(port, 'GET', '/api/v1/me/sessions', 'member-read')
    assert.strictEqual(sessions.status, 200)
    assert.strictEqual(sessions.body.sessions[0].device_id, 'device-a')
    const revokeNoHeader = await request(port, 'POST', '/api/v1/me/sessions/revoke-others', 'member-write', { deviceId: 'x' })
    assert.strictEqual(revokeNoHeader.status, 400, 'revoke-others 只认 X-Device-ID，body.deviceId 不得作为保活依据')
    const revoke = await request(port, 'POST', '/api/v1/me/sessions/revoke-others', 'member-write', {}, { 'X-Device-ID': 'device-aaaaaaaaaaaa' })
    assert.strictEqual(revoke.status, 200)
    assert.deepStrictEqual(revoke.body.revoked, ['ses-old'])
    const profile = await request(port, 'PATCH', '/api/v1/me/profile', 'member-write', { displayName: '新名字' })
    assert.strictEqual(profile.status, 200)
    assert.strictEqual(profile.body.user.displayName, '新名字')
    const badAvatar = await request(port, 'PATCH', '/api/v1/me/profile', 'member-write', { avatarUrl: 'javascript:alert(1)' })
    assert.strictEqual(badAvatar.status, 400)
    assert.strictEqual(badAvatar.body.error, 'AVATAR_URL_INVALID')
    console.log('  ✅ orders/notifications/sessions/profile 会员端点')

    const readOnlyWrite = await request(port, 'PATCH', '/api/v1/me/profile', 'member-read', { displayName: 'x' })
    assert.strictEqual(readOnlyWrite.status, 403, 'profile:read 不能写资料')
    const redeemWithRead = await request(port, 'POST', '/api/v1/redeem', 'member-read', { code: 'ABCD-EFGH-JKMN' })
    assert.strictEqual(redeemWithRead.status, 403, '核销需要 profile:write')
    const publishScopeRejected = await request(port, 'GET', '/api/v1/plans', 'publish-token')
    assert.strictEqual(publishScopeRejected.status, 403, 'publish scope 不能读价目')
    console.log('  ✅ scope 边界（读/写/无关 scope 隔离）')

    const redeem = await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'abcd-efgh-jkmn' })
    assert.strictEqual(redeem.status, 200)
    assert.strictEqual(redeem.body.plan, 'pro')
    console.log('  ✅ POST /api/v1/redeem 成功核销')

    const adminGrant = await request(port, 'POST', '/api/v1/admin/member/grant', 'admin-token', { userId: 'u-x', plan: 'standard', durationDays: 30 })
    assert.strictEqual(adminGrant.status, 200)
    assert.strictEqual(adminGrant.body.order.channel, 'admin_grant')
    const adminBatch = await request(port, 'POST', '/api/v1/admin/member/redeem-codes', 'admin-token', { plan: 'pro', durationDays: 365, count: 1 })
    assert.strictEqual(adminBatch.status, 200)
    assert.strictEqual(adminBatch.body.codes.length, 1)
    const memberAdminRejected = await request(port, 'POST', '/api/v1/admin/member/grant', 'member-write', { userId: 'u-x', plan: 'standard', durationDays: 30 })
    assert.strictEqual(memberAdminRejected.status, 403, '非 admin scope 不得开通')
    console.log('  ✅ admin 会员运营端点')

    // 存量回归：发布链路不受会员路由影响
    const publish = await request(port, 'POST', '/api/v1/publish', 'publish-token', { platform: 'zhihu', title: 'x' })
    assert.strictEqual(publish.status, 200)
    console.log('  ✅ 发布链路无回归')
  } finally {
    await server.stop()
  }

  // 场景 2：错误映射与 fail-soft
  const failServer = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createRepositoryStub(),
    entitlementProvider: { async getForUser() { return { plan: 'free', features: [] } } },
    subscriptionService: createServiceStub({ redeemNotFound: true, subscriptionFails: true }),
  })
  await failServer.start(0)
  const failPort = failServer._server.address().port
  try {
    const notFound = await request(failPort, 'POST', '/api/v1/redeem', 'member-write', { code: 'ABCD-EFGH-JKMN' })
    assert.strictEqual(notFound.status, 404)
    assert.strictEqual(notFound.body.error, 'REDEEM_CODE_NOT_FOUND')
    const meDegraded = await request(failPort, 'GET', '/api/v1/me', 'member-read')
    assert.strictEqual(meDegraded.status, 200, '会员聚合失败不得阻断 /me 主响应')
    assert.strictEqual(meDegraded.body.user.id, 'business-user-1')
    assert.strictEqual(meDegraded.body.membership, undefined)
    console.log('  ✅ CommerceError 状态码映射 + membership fail-soft')
  } finally {
    await failServer.stop()
  }

  // 场景 3：未配置商务服务的降级
  const bareServer = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createRepositoryStub(),
    entitlementProvider: { async getForUser() { return { plan: 'free', features: [] } } },
  })
  await bareServer.start(0)
  const barePort = bareServer._server.address().port
  try {
    const bareMe = await request(barePort, 'GET', '/api/v1/me', 'member-read')
    assert.strictEqual(bareMe.status, 200)
    assert.strictEqual(bareMe.body.membership, undefined)
    const barePlans = await request(barePort, 'GET', '/api/v1/plans', 'member-read')
    assert.strictEqual(barePlans.status, 200, 'plans 不依赖 subscriptionService')
    const bareRedeem = await request(barePort, 'POST', '/api/v1/redeem', 'member-write', { code: 'ABCD-EFGH-JKMN' })
    assert.strictEqual(bareRedeem.status, 503)
    assert.strictEqual(bareRedeem.body.error, 'SUBSCRIPTION_SERVICE_NOT_CONFIGURED')
    console.log('  ✅ 未配置商务服务的 503/降级合同')
  } finally {
    await bareServer.stop()
  }
  // ===== 场景 4：评审收口的契约测试（H1-H6 行为变更 + 状态码映射回归锁）=====
  const DEV = "device-aaaaaaaaaaaa";
  function makeRepo(over) {
    over = over || {};
    return {
      calls: [],
      async findBySubject(provider, subject) { return { id: "business-user-1", auth_provider: provider, auth_subject: subject, status: "active", display_name: "用户甲" }; },
      async listOrders() { return []; },
      async create() { throw new Error("unexpected create"); },
      async listNotifications() { return []; },
      async markNotificationsRead() { return []; },
      async listActiveSessions() { return []; },
      async updateProfile(id, patch) { return { id: id, display_name: patch.display_name, avatar_url: patch.avatar_url }; },
      async countUnreadNotifications() { if (over.countThrows) throw Object.assign(new Error("boom"), { code: "NOTIF_COUNT_FAILED", status: 503 }); return 5; },
      async upsertSession(rec) { this.calls.push(["upsertSession", rec]); if (over.upsertThrows) throw Object.assign(new Error("need device"), { code: "SESSION_DEVICE_REQUIRED", status: 400 }); return { id: "ses", device_id: rec.deviceId }; },
    };
  }
  function makeService(over) {
    over = over || {};
    const repository = over.repository || makeRepo(over);
    return {
      repository: repository,
      planOverrides: over.planOverrides || null,
      async getSubscriptionView() { if (over.subscriptionFails) throw new Error("sub down"); return { plan: "standard", status: "active", entitlement: { plan: "standard", features: [], quota: {}, limits: {} } }; },
      async getUsageView() { if (over.usageFails) throw new Error("usage down"); return { plan: "standard", features: [{ feature: "cloud_publish", used: 1, limit: 1500 }] }; },
      async redeem() { if (over.redeemThrow) throw over.redeemThrow; return { plan: "pro" }; },
      async grant() { if (over.grantInvalid) throw Object.assign(new Error("plan"), { code: "PLAN_INVALID", status: 400 }); return { plan: "pro", order: { id: "ord-admin", channel: "admin_grant" } }; },
      async createRedeemBatch() { return { batch: "b1", codes: ["ABCD-EFGH-JKMN"] }; },
    };
  }
  async function startCommerceServer(service, extra) {
    const server = new PublishApiServer(Object.assign({
      dryRun: true,
      logtoVerifier: createVerifier(),
      businessIdentityRepository: service.repository,
      entitlementProvider: { async getForUser() { return { plan: "standard", features: ["cloud_publish"], quota: {}, limits: {} }; } },
      subscriptionService: service,
    }, extra || {}));
    await server.start(0);
    return { server: server, port: server._server.address().port };
  }
  function rawReq(port, method, path, headers) {
    return new Promise((resolve, reject) => {
      const r = http.request({ hostname: "127.0.0.1", port: port, method: method, path: path, headers: headers || {} }, (res) => {
        let d = ""; res.on("data", (c) => { d += c; });
        res.on("end", () => { resolve({ status: res.statusCode, headers: res.headers, body: d ? JSON.parse(d) : null }); });
      });
      r.on("error", reject); r.end();
    });
  }

  // H1：_commerceFailure 夹紧 status + 校验 code 形状
  for (const inj of [
    { e: { code: "WEIRD", status: 200 }, want: 500 },
    { e: { code: "23505" }, want: 500 },
    { e: { code: "REDEEM_CODE_GONE", status: 99999 }, want: 500 },
  ]) {
    const svc = makeService({ redeemThrow: Object.assign(new Error("inject"), inj.e) });
    const started = await startCommerceServer(svc);
    try {
      const r = await request(started.port, "POST", "/api/v1/redeem", "member-write", { code: "X" });
      assert.strictEqual(r.status, inj.want, "H1 status 夹紧 " + JSON.stringify(inj.e));
      if (inj.e.code === "23505") assert.notStrictEqual(r.body.error, "23505", "H1 不得外泄内部 SQLSTATE");
      if (inj.e.status === 99999) { assert.strictEqual(r.body.error, "REDEEM_CODE_GONE", "H1 语义码不得被吞"); assert.notStrictEqual(r.body.error, "INTERNAL_SERVER_ERROR"); }
      if (inj.e.status === 200) assert.strictEqual(r.body.message, "服务暂时不可用", "H1 大于等于 500 掩码");
    } finally { await started.server.stop(); }
  }

  // H2：逐槽降级 / unread null / upsert best-effort
  {
    const svc = makeService({ usageFails: true });
    const started = await startCommerceServer(svc);
    try {
      const r = await request(started.port, "GET", "/api/v1/me", "member-read");
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.membership, "subscription 成功则 membership 必须存在");
      assert.ok(r.body.membership.subscription, "subscription 槽保留");
      assert.strictEqual(r.body.membership.usage, null, "usage 槽失败置 null");
    } finally { await started.server.stop(); }
  }
  {
    const repo = makeRepo();
    delete repo.countUnreadNotifications;
    const svc = makeService({ repository: repo });
    const started = await startCommerceServer(svc);
    try {
      const r = await request(started.port, "GET", "/api/v1/me", "member-read");
      assert.strictEqual(r.body.membership.unreadNotifications, null, "未配置计数不得吐 0");
    } finally { await started.server.stop(); }
  }
  {
    const svc = makeService({ upsertThrows: true });
    const started = await startCommerceServer(svc);
    try {
      const r = await request(started.port, "GET", "/api/v1/me", "member-read", null, { "X-Device-ID": DEV });
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.membership.subscription);
      assert.ok(r.body.membership.usage);
      assert.strictEqual(r.body.membership.unreadNotifications, 5);
    } finally { await started.server.stop(); }
  }

  // H3：X-Device-Name 入库前清洗
  {
    const svc = makeService({});
    const started = await startCommerceServer(svc);
    try {
      await request(started.port, "GET", "/api/v1/me", "member-read", null, { "X-Device-ID": DEV, "X-Device-Name": "<img src=x onerror=alert(1)>" });
      const rec = svc.repository.calls.filter((c) => c[0] === "upsertSession").pop()[1];
      assert.ok(rec.deviceName === null || (!/[<>]/.test(rec.deviceName) && !/[\u0000-\u001f\u007f]/.test(rec.deviceName)), "尖括号载荷须被清洗");
      await request(started.port, "GET", "/api/v1/me", "member-read", null, { "X-Device-ID": DEV, "X-Device-Name": "MacBook Pro (Chrome)" });
      const rec2 = svc.repository.calls.filter((c) => c[0] === "upsertSession").pop()[1];
      assert.strictEqual(rec2.deviceName, "MacBook Pro (Chrome)", "正常设备名不得被误伤");
    } finally { await started.server.stop(); }
  }

  // H4：admin 会员端点拒绝静态主密钥，接受经 scope 校验的 logto
  {
    const svc = makeService({});
    const started = await startCommerceServer(svc, { identityAuthRequired: false, apiKey: "legacy-master-key", autoMigrate: false });
    try {
      const r = await request(started.port, "POST", "/api/v1/admin/member/grant", "legacy-master-key", { userId: "u-x", plan: "pro", durationDays: 365 });
      assert.strictEqual(r.status, 403, "主密钥不得开通会员权益");
      assert.strictEqual(r.body.error, "AUTH_SCOPE_MISSING");
    } finally { await started.server.stop(); }
    const svc2 = makeService({});
    const started2 = await startCommerceServer(svc2);
    try {
      const ok = await request(started2.port, "POST", "/api/v1/admin/member/grant", "admin-token", { userId: "u-x", plan: "standard", durationDays: 30 });
      assert.strictEqual(ok.status, 200, "logto admin 正常路径不得被堵");
    } finally { await started2.server.stop(); }
  }

  // H5：OPTIONS 预检须含 PATCH 与 X-Device-Name
  {
    const svc = makeService({});
    const started = await startCommerceServer(svc);
    try {
      const pre = await rawReq(started.port, "OPTIONS", "/api/v1/me/profile", { Origin: "http://localhost:5174" });
      assert.ok(/PATCH/.test(pre.headers["access-control-allow-methods"] || ""), "预检方法须含 PATCH");
      assert.ok(/X-Device-Name/i.test(pre.headers["access-control-allow-headers"] || ""), "预检头须含 X-Device-Name");
    } finally { await started.server.stop(); }
  }

  // H6：/plans 目录非法 overrides → 保留 PLAN_MATRIX_CONFIG_INVALID
  {
    const svc = makeService({ planOverrides: [{ bad: 1 }] });
    const started = await startCommerceServer(svc);
    try {
      const r = await request(started.port, "GET", "/api/v1/plans", "member-read");
      assert.strictEqual(r.status, 500, "非法 overrides 应 500");
      assert.strictEqual(r.body.error, "PLAN_MATRIX_CONFIG_INVALID", "语义码不得被兜底吞掉");
    } finally { await started.server.stop(); }
  }

  // redeem 状态码映射回归锁
  for (const map of [
    { code: "REDEEM_CODE_NOT_FOUND", status: 404 },
    { code: "REDEEM_CODE_USED", status: 409 },
    { code: "REDEEM_CODE_EXPIRED", status: 410 },
    { code: "REDEEM_CODE_FORMAT", status: 400 },
  ]) {
    const svc = makeService({ redeemThrow: Object.assign(new Error("r"), { code: map.code, status: map.status }) });
    const started = await startCommerceServer(svc);
    try {
      const r = await request(started.port, "POST", "/api/v1/redeem", "member-write", { code: "X" });
      assert.strictEqual(r.status, map.status, "redeem 映射 " + map.code);
      assert.strictEqual(r.body.error, map.code);
    } finally { await started.server.stop(); }
  }

  // grantInvalid 分支真正被触发 → PLAN_INVALID 400
  {
    const svc = makeService({ grantInvalid: true });
    const started = await startCommerceServer(svc);
    try {
      const r = await request(started.port, "POST", "/api/v1/admin/member/grant", "admin-token", { userId: "u-x", plan: "ghost" });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.body.error, "PLAN_INVALID");
    } finally { await started.server.stop(); }
  }

  // 入参契约 400：PROFILE_PATCH_EMPTY / DISPLAY_NAME_INVALID / USER_ID_REQUIRED
  {
    const svc = makeService({});
    const started = await startCommerceServer(svc);
    try {
      const empty = await request(started.port, "PATCH", "/api/v1/me/profile", "member-write", {});
      assert.strictEqual(empty.status, 400);
      assert.strictEqual(empty.body.error, "PROFILE_PATCH_EMPTY");
      const badName = await request(started.port, "PATCH", "/api/v1/me/profile", "member-write", { displayName: "   " });
      assert.strictEqual(badName.status, 400);
      assert.strictEqual(badName.body.error, "DISPLAY_NAME_INVALID");
      const noUser = await request(started.port, "POST", "/api/v1/admin/member/grant", "admin-token", { plan: "pro" });
      assert.strictEqual(noUser.status, 400);
      assert.strictEqual(noUser.body.error, "USER_ID_REQUIRED");
    } finally { await started.server.stop(); }
  }

  // 405 家族 + admin GET 404 ROUTE_NOT_FOUND
  {
    const svc = makeService({});
    const started = await startCommerceServer(svc);
    try {
      const del = await request(started.port, "DELETE", "/api/v1/me/orders", "member-write");
      assert.strictEqual(del.status, 405);
      assert.strictEqual(del.body.error, "METHOD_NOT_ALLOWED");
      const postNtf = await request(started.port, "POST", "/api/v1/me/notifications", "member-write", {});
      assert.strictEqual(postNtf.status, 405);
      assert.strictEqual(postNtf.body.error, "METHOD_NOT_ALLOWED");
      const adminGet = await request(started.port, "GET", "/api/v1/admin/member/grant", "admin-token");
      assert.strictEqual(adminGet.status, 404);
      assert.strictEqual(adminGet.body.error, "ROUTE_NOT_FOUND");
    } finally { await started.server.stop(); }
  }

  // PUT /me/profile 别名 → 与 PATCH 同行为
  {
    const svc = makeService({});
    const started = await startCommerceServer(svc);
    try {
      const viaPut = await request(started.port, "PUT", "/api/v1/me/profile", "member-write", { displayName: "别名生效" });
      assert.strictEqual(viaPut.status, 200);
      assert.strictEqual(viaPut.body.user.displayName, "别名生效");
    } finally { await started.server.stop(); }
  }

  // membership 与 entitlementSnapshot 共存
  {
    const svc = makeService({});
    const started = await startCommerceServer(svc, { entitlementSigner: { async sign(snapshot) { return { token: "sig." + snapshot.plan }; } } });
    try {
      const r = await request(started.port, "GET", "/api/v1/me", "member-read", null, { "X-Device-ID": DEV });
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.membership, "membership 必须存在");
      assert.ok(r.body.entitlementSnapshot, "entitlementSnapshot 必须共存");
      assert.strictEqual(r.body.entitlementSnapshot.token, "sig.standard");
    } finally { await started.server.stop(); }
  }
  console.log("  ✅ 场景 4：H1-H6 收口 + 契约回归锁（redeem 映射 / grantInvalid / 400 契约 / 405 家族 / PUT 别名 / 共存形状）");
  console.log('member-commerce-api: 全部通过')
}

main().catch((error) => { console.error(error); process.exit(1) })

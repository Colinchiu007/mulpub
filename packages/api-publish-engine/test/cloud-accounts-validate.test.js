const assert = require('assert')
const path = require('path')
const test = require('node:test')

const {
  ALLOWED_ACCOUNT_FIELDS,
  CHROME_SUFFIXES,
  CLOSE_BRACKETS,
  ELLIPSIS_PATTERN,
  KNOWN_PAGE_TITLES,
  MAX_BATCH_SIZE,
  MAX_CREDENTIAL_BYTES,
  MAX_CREDENTIAL_KEYS,
  METRIC_PATTERNS,
  METRIC_WORDS,
  NOISE_KEYWORDS,
  OPEN_BRACKETS,
  SUPPORTED_PLATFORMS,
  TITLE_SEPARATOR_PATTERN,
  asBytes,
  hasUnbalancedBrackets,
  isNoiseAccountName,
  validateAccount,
  validateAccountQuietly,
  validateBatch,
  validateCredentialShape,
  validateEnvelope,
  validateSyncKeys,
} = require('../src/cloud-accounts/validate-account')

const NOW = new Date('2026-09-27T08:00:00.000Z')
const PAST = '2026-09-26T08:00:00.000Z'
const FIVE_MIN = '2026-09-27T08:05:00.000Z'
const SIX_MIN = '2026-09-27T08:06:00.000Z'
const ENVELOPE = {
  v: 1,
  alg: 'A256GCM',
  iv: Buffer.alloc(12, 1).toString('base64'),
  ciphertext: Buffer.from('cipher-bytes', 'utf8').toString('base64'),
  tag: Buffer.alloc(16, 2).toString('base64'),
  encryptedDataKey: Buffer.alloc(32, 3).toString('base64'),
  digest: 'a'.repeat(64),
  credentialUpdatedAt: PAST,
}

function account(overrides) {
  return Object.assign({
    platform: 'douyin',
    platformUid: 'uid-9',
    displayName: '数字生命丘丘',
    accountName: '丘丘',
    avatar: 'https://p3.douyinpic.com/avatar.jpg',
    followers: 12345,
    isActive: true,
    credentialEnvelope: ENVELOPE,
    metadataUpdatedAt: PAST,
    createdAt: PAST,
    lastReportedStatus: 'active',
    lastSyncDeviceLabel: 'DESKTOP-A1',
  }, overrides || {})
}

/** 断言单条账号按 §6.2 判非法，且错误码逐字一致。 */
function rejectsWith(overrides, code) {
  assert.throws(
    () => validateAccount(account(overrides), { now: NOW }),
    (error) => {
      assert.strictEqual(error.code, code, `期望 ${code}，实得 ${error && error.code}`)
      return true
    },
    `字段 ${JSON.stringify(Object.keys(overrides))} 必须以 ${code} 拒绝`,
  )
}

function accepts(overrides) {
  return validateAccount(account(overrides), { now: NOW })
}

test('validate-account：PRD §6.2 逐行校验', async (t) => {
  await t.test('正例：完整合法条目被归一为 camelCase 记录', () => {
    const value = accepts({})
    assert.strictEqual(value.platform, 'douyin')
    assert.strictEqual(value.platformUid, 'uid-9')
    assert.strictEqual(value.displayName, '数字生命丘丘')
    assert.strictEqual(value.accountName, '丘丘')
    assert.strictEqual(value.followers, 12345)
    assert.strictEqual(value.isActive, true)
    assert.strictEqual(value.credentialDigest, 'a'.repeat(64))
    assert.strictEqual(value.metadataUpdatedAt, PAST)
    assert.ok(Buffer.isBuffer(value.credential.iv), '信封字段必须解成 Buffer 供 BYTEA 入库')
    assert.strictEqual(value.credential.iv.length, 12)
    assert.strictEqual(value.credentialUpdatedAt, PAST)
  })

  await t.test('整体：只允许白名单键，未知键 ACCOUNT_FIELD_NOT_ALLOWED', () => {
    rejectsWith({ ownerSubject: 'someone-else' }, 'ACCOUNT_FIELD_NOT_ALLOWED')
    rejectsWith({ status: 'active' }, 'ACCOUNT_FIELD_NOT_ALLOWED')
    rejectsWith({ credential: { cookies: [] } }, 'ACCOUNT_FIELD_NOT_ALLOWED')
    // 归属只从 token 取（PRD §6.3 owner_subject 行）：客户端自报归属必须被拒。
    assert.strictEqual(ALLOWED_ACCOUNT_FIELDS.includes('ownerSubject'), false)
    assert.strictEqual(ALLOWED_ACCOUNT_FIELDS.includes('status'), false)
    assert.strictEqual(ALLOWED_ACCOUNT_FIELDS.includes('lastValidated'), false)
    assert.ok(ALLOWED_ACCOUNT_FIELDS.length >= 20)
  })

  await t.test('platform：八平台枚举，其余 ACCOUNT_PLATFORM_UNSUPPORTED', () => {
    assert.deepStrictEqual(
      SUPPORTED_PLATFORMS.slice(),
      ['douyin', 'toutiao', 'wechat_mp', 'tencent_video', 'bilibili', 'kuaishou', 'xiaohongshu', 'zhihu'],
    )
    for (const platform of SUPPORTED_PLATFORMS) assert.strictEqual(accepts({ platform }).platform, platform)
    rejectsWith({ platform: 'weibo' }, 'ACCOUNT_PLATFORM_UNSUPPORTED')
    rejectsWith({ platform: 'DOUYIN' }, 'ACCOUNT_PLATFORM_UNSUPPORTED')
    rejectsWith({ platform: '' }, 'ACCOUNT_PLATFORM_UNSUPPORTED')
    rejectsWith({ platform: null }, 'ACCOUNT_PLATFORM_UNSUPPORTED')
    rejectsWith({ platform: 123 }, 'ACCOUNT_PLATFORM_UNSUPPORTED')
  })

  await t.test('platform_uid：非空、trim 后 ≤128、无控制字符 → ACCOUNT_UID_INVALID', () => {
    assert.strictEqual(accepts({ platformUid: '  uid-9  ' }).platformUid, 'uid-9', 'uid 必须 trim 后入库')
    assert.strictEqual(accepts({ platformUid: 'x'.repeat(128) }).platformUid.length, 128)
    rejectsWith({ platformUid: '' }, 'ACCOUNT_UID_INVALID')
    rejectsWith({ platformUid: '   ' }, 'ACCOUNT_UID_INVALID')
    rejectsWith({ platformUid: 'x'.repeat(129) }, 'ACCOUNT_UID_INVALID')
    rejectsWith({ platformUid: 'uid\u00009' }, 'ACCOUNT_UID_INVALID')
    rejectsWith({ platformUid: 'uid\t9' }, 'ACCOUNT_UID_INVALID')
    rejectsWith({ platformUid: 9 }, 'ACCOUNT_UID_INVALID')
  })

  await t.test('display_name：非空 ≤200 且不得命中噪声形态 → ACCOUNT_NAME_NOISE', () => {
    assert.strictEqual(accepts({ displayName: 'x'.repeat(200) }).displayName.length, 200)
    rejectsWith({ displayName: '' }, 'ACCOUNT_NAME_NOISE')
    rejectsWith({ displayName: '   ' }, 'ACCOUNT_NAME_NOISE')
    rejectsWith({ displayName: 'x'.repeat(201) }, 'ACCOUNT_NAME_NOISE')
    rejectsWith({ displayName: null }, 'ACCOUNT_NAME_NOISE')
    rejectsWith({ displayName: 42 }, 'ACCOUNT_NAME_NOISE')
    rejectsWith({ displayName: '485.9万人看过' }, 'ACCOUNT_NAME_NOISE')
  })

  await t.test('account_name：可缺席/为 null；命中形态规则判非法 → ACCOUNT_NAME_NOISE', () => {
    assert.strictEqual(accepts({ accountName: null }).accountName, null)
    assert.strictEqual(accepts({}).accountName, '丘丘')
    assert.strictEqual(accepts({ accountName: 'x'.repeat(200) }).accountName.length, 200)
    rejectsWith({ accountName: 'x'.repeat(201) }, 'ACCOUNT_NAME_NOISE')
    rejectsWith({ accountName: '分享此刻的想法...' }, 'ACCOUNT_NAME_NOISE')
    rejectsWith({ accountName: 12 }, 'ACCOUNT_NAME_NOISE')
    // 空串没有可展示信息，与 display_name 同一口径（不静默存成空昵称）
    assert.strictEqual(accepts({ accountName: '' }).accountName, null)
  })

  await t.test('avatar：只允许空或 https://，≤1024 → ACCOUNT_AVATAR_INVALID', () => {
    assert.strictEqual(accepts({ avatar: '' }).avatar, null)
    assert.strictEqual(accepts({ avatar: null }).avatar, null)
    assert.strictEqual(accepts({ avatar: 'https://x'.repeat(1) + 'a'.repeat(1010) }).avatar.length, 1019)
    rejectsWith({ avatar: 'http://a.example.com/x.png' }, 'ACCOUNT_AVATAR_INVALID')
    rejectsWith({ avatar: 'file:///etc/passwd' }, 'ACCOUNT_AVATAR_INVALID')
    rejectsWith({ avatar: 'javascript:alert(1)' }, 'ACCOUNT_AVATAR_INVALID')
    rejectsWith({ avatar: 'data:image/png;base64,AAAA' }, 'ACCOUNT_AVATAR_INVALID')
    rejectsWith({ avatar: 'https://a.example.com/' + 'x'.repeat(1024) }, 'ACCOUNT_AVATAR_INVALID')
    rejectsWith({ avatar: 42 }, 'ACCOUNT_AVATAR_INVALID')
    rejectsWith({ avatar: 'https://a.example.com/x.png?a=1 2' }, 'ACCOUNT_AVATAR_INVALID')
  })

  await t.test('followers：Number.isSafeInteger 且 0 ≤ n ≤ 1e12 → ACCOUNT_FOLLOWERS_INVALID', () => {
    assert.strictEqual(accepts({ followers: 0 }).followers, 0)
    assert.strictEqual(accepts({ followers: 1e12 }).followers, 1e12)
    assert.strictEqual(accepts({ followers: null }).followers, null)
    assert.strictEqual(accepts({ followers: undefined }).followers, null)
    const withoutFollowers = account({})
    delete withoutFollowers.followers
    assert.strictEqual(validateAccount(withoutFollowers, { now: NOW }).followers, null)
    for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, '123', true, false, {}, Number.MAX_SAFE_INTEGER + 1]) {
      rejectsWith({ followers: bad }, 'ACCOUNT_FOLLOWERS_INVALID')
    }
  })

  await t.test('时间戳：ISO 8601、不得晚于 now+5min → ACCOUNT_TIMESTAMP_INVALID', () => {
    assert.strictEqual(accepts({ metadataUpdatedAt: FIVE_MIN }).metadataUpdatedAt, FIVE_MIN)
    assert.strictEqual(accepts({ createdAt: PAST }).createdAt, PAST)
    rejectsWith({ metadataUpdatedAt: SIX_MIN }, 'ACCOUNT_TIMESTAMP_INVALID')
    rejectsWith({ metadataUpdatedAt: 'not-a-date' }, 'ACCOUNT_TIMESTAMP_INVALID')
    rejectsWith({ metadataUpdatedAt: '2026/09/26 08:00' }, 'ACCOUNT_TIMESTAMP_INVALID')
    rejectsWith({ metadataUpdatedAt: null }, 'ACCOUNT_TIMESTAMP_INVALID')
    rejectsWith({ metadataUpdatedAt: undefined }, 'ACCOUNT_TIMESTAMP_INVALID')
    rejectsWith({ createdAt: SIX_MIN }, 'ACCOUNT_TIMESTAMP_INVALID')
    rejectsWith({ credentialEnvelope: Object.assign({}, ENVELOPE, { credentialUpdatedAt: SIX_MIN }) }, 'ACCOUNT_TIMESTAMP_INVALID')
    // 时区偏移形态必须被接受并归一为 UTC ISO（客户端来自本机 new Date().toISOString()）。
    assert.strictEqual(accepts({ metadataUpdatedAt: '2026-09-27T16:00:00+08:00' }).metadataUpdatedAt, '2026-09-27T08:00:00.000Z')
  })

  await t.test('isActive 必须是布尔', () => {
    assert.strictEqual(accepts({ isActive: false }).isActive, false)
    assert.strictEqual(accepts({ isActive: undefined }).isActive, true, '缺席按启用态默认')
    rejectsWith({ isActive: 'true' }, 'ACCOUNT_FIELD_NOT_ALLOWED')
    rejectsWith({ isActive: 1 }, 'ACCOUNT_FIELD_NOT_ALLOWED')
  })

  await t.test('snake_case 别名可用；两种拼写冲突时不猜', () => {
    const snake = account({})
    delete snake.platformUid
    delete snake.displayName
    snake.platform_uid = 'uid-9'
    snake.display_name = '数字生命丘丘'
    assert.strictEqual(validateAccount(snake, { now: NOW }).platformUid, 'uid-9')
    rejectsWith({ platformUid: 'uid-9', platform_uid: 'other-uid' }, 'ACCOUNT_FIELD_NOT_ALLOWED')
  })

  await t.test('last_reported_status 只认三态，其余按未上报存 null（不为展示快照发明错误码）', () => {
    assert.strictEqual(accepts({ lastReportedStatus: 'expired' }).lastReportedStatus, 'expired')
    assert.strictEqual(accepts({ lastReportedStatus: 'unverified' }).lastReportedStatus, 'unverified')
    assert.strictEqual(accepts({ lastReportedStatus: 'active-ish' }).lastReportedStatus, null)
    assert.strictEqual(accepts({ lastReportedStatus: null }).lastReportedStatus, null)
  })

  await t.test('last_sync_device_label ≤64 且无控制字符', () => {
    assert.strictEqual(accepts({ lastSyncDeviceLabel: 'x'.repeat(64) }).lastSyncDeviceLabel.length, 64)
    rejectsWith({ lastSyncDeviceLabel: 'x'.repeat(65) }, 'ACCOUNT_DEVICE_LABEL_INVALID')
    rejectsWith({ lastSyncDeviceLabel: 'a\u0000b' }, 'ACCOUNT_DEVICE_LABEL_INVALID')
  })

  await t.test('逐条裁决：validateAccountQuietly 不抛出，只回该条错误码', () => {
    const ok = validateAccountQuietly(account({}), { now: NOW })
    assert.strictEqual(ok.ok, true)
    const bad = validateAccountQuietly(account({ platform: 'weibo' }), { now: NOW })
    assert.strictEqual(bad.ok, false)
    assert.strictEqual(bad.code, 'ACCOUNT_PLATFORM_UNSUPPORTED')
    assert.strictEqual(bad.status, 400)
    // 非语义异常（例如内部 TypeError）也必须被折叠成语义码，不外泄原文。
    const weird = validateAccountQuietly(Object.assign(account({}), { toJSON() { throw new Error('boom') } }), { now: NOW })
    assert.strictEqual(weird.ok, false)
    assert.match(weird.code, /^[A-Z][A-Z0-9_]{2,63}$/)
  })
})

test('validate-account：凭证与批量门禁', async (t) => {
  await t.test('明文凭证形状：cookies 数组含 name/value、localStorage 对象、键总数 ≤5000', () => {
    assert.strictEqual(validateCredentialShape({ cookies: [{ name: 'a', value: 'b' }], localStorage: { k: 'v' }, indexedDB: {} }), true)
    assert.strictEqual(validateCredentialShape({}), true, '三个分区都缺席按空处理')
    for (const bad of [
      null,
      'string',
      [],
      { cookies: {} },
      { cookies: [null] },
      { cookies: [{ value: 'no-name' }] },
      { cookies: [{ name: '', value: 'v' }] },
      { cookies: [{ name: 'a' }] },
      { cookies: [{ name: 'a', value: 3 }] },
      { localStorage: [] },
      { indexedDB: 'nope' },
    ]) {
      assert.throws(
        () => validateCredentialShape(bad),
        (error) => error.code === 'CREDENTIAL_SHAPE_INVALID' && error.status === 400,
        `必须拒绝形状：${JSON.stringify(bad)}`,
      )
    }
    const manyCookies = new Array(MAX_CREDENTIAL_KEYS + 1).fill(0).map((_, i) => ({ name: `c${i}`, value: 'v' }))
    assert.throws(() => validateCredentialShape({ cookies: manyCookies }), (error) => error.code === 'CREDENTIAL_SHAPE_INVALID')
  })

  await t.test('凭证体积 >2MiB → CREDENTIAL_TOO_LARGE(413)', () => {
    const huge = { cookies: [{ name: 'a', value: 'x'.repeat(MAX_CREDENTIAL_BYTES + 10) }], localStorage: {}, indexedDB: {} }
    assert.throws(
      () => validateCredentialShape(huge),
      (error) => error.code === 'CREDENTIAL_TOO_LARGE' && error.status === 413,
    )
    const small = { cookies: [{ name: 'a', value: 'b' }] }
    assert.strictEqual(validateCredentialShape(small), true)
  })

  await t.test('信封形状：v/alg/iv/tag/密文/摘要逐项 fail closed', () => {
    assert.strictEqual(validateEnvelope(ENVELOPE, { now: NOW }).iv.length, 12)
    const cases = [
      [Object.assign({}, ENVELOPE, { v: 2 }), 'CREDENTIAL_SHAPE_INVALID'],
      [Object.assign({}, ENVELOPE, { alg: 'A128GCM' }), 'CREDENTIAL_SHAPE_INVALID'],
      [Object.assign({}, ENVELOPE, { iv: Buffer.alloc(11, 1).toString('base64') }), 'CREDENTIAL_SHAPE_INVALID'],
      [Object.assign({}, ENVELOPE, { tag: Buffer.alloc(15, 2).toString('base64') }), 'CREDENTIAL_SHAPE_INVALID'],
      [Object.assign({}, ENVELOPE, { ciphertext: '' }), 'CREDENTIAL_SHAPE_INVALID'],
      [Object.assign({}, ENVELOPE, { digest: 'Z'.repeat(64) }), 'CREDENTIAL_SHAPE_INVALID'],
      [Object.assign({}, ENVELOPE, { digest: 'a'.repeat(63) }), 'CREDENTIAL_SHAPE_INVALID'],
      [Object.assign({}, ENVELOPE, { encryptedDataKey: 'not base64 !!!' }), 'CREDENTIAL_SHAPE_INVALID'],
      [null, 'CREDENTIAL_SHAPE_INVALID'],
      ['envelope', 'CREDENTIAL_SHAPE_INVALID'],
      [{}, 'CREDENTIAL_SHAPE_INVALID'],
    ]
    for (const [envelope, code] of cases) {
      assert.throws(
        () => validateEnvelope(envelope, { now: NOW }),
        (error) => error.code === code,
        `必须拒绝信封：${JSON.stringify(envelope)}`,
      )
    }
    assert.strictEqual(validateEnvelope(null, { now: NOW, required: false }), null)
  })

  await t.test('base64 收口：带单等号的合法填充必须通过，填充错位必须拒', () => {
    for (const length of [1, 2, 3, 4, 40]) {
      const encoded = Buffer.alloc(length, 7).toString('base64')
      assert.deepStrictEqual(asBytes(encoded, 'CREDENTIAL_SHAPE_INVALID'), Buffer.alloc(length, 7))
    }
    assert.throws(() => asBytes('AAAAAAAAAAAAAAAA=', 'CREDENTIAL_SHAPE_INVALID'), (error) => error.code === 'CREDENTIAL_SHAPE_INVALID')
    assert.throws(() => asBytes('****', 'CREDENTIAL_SHAPE_INVALID'), (error) => error.code === 'CREDENTIAL_SHAPE_INVALID')
  })

  await t.test('批量：>100 条 ACCOUNT_BATCH_TOO_LARGE(413)；非数组 ACCOUNT_BATCH_INVALID(400)', () => {
    assert.strictEqual(validateBatch([]).length, 0)
    assert.strictEqual(validateBatch(new Array(MAX_BATCH_SIZE).fill(account({}))).length, 100)
    assert.strictEqual(MAX_BATCH_SIZE, 100)
    assert.throws(
      () => validateBatch(new Array(MAX_BATCH_SIZE + 1).fill(account({}))),
      (error) => error.code === 'ACCOUNT_BATCH_TOO_LARGE' && error.status === 413,
    )
    for (const bad of [undefined, null, {}, 'x', 12]) {
      assert.throws(() => validateBatch(bad), (error) => error.code === 'ACCOUNT_BATCH_INVALID' && error.status === 400)
    }
  })

  await t.test('sync keys：只允许合并键两列', () => {
    assert.deepStrictEqual(validateSyncKeys({ keys: [{ platform: 'zhihu', platformUid: 'u-1' }] }), [{ platform: 'zhihu', platformUid: 'u-1' }])
    assert.deepStrictEqual(validateSyncKeys({ keys: [] }), [])
    assert.deepStrictEqual(validateSyncKeys({ keys: [{ platform: 'zhihu', platform_uid: ' u-1 ' }] }), [{ platform: 'zhihu', platformUid: 'u-1' }])
    assert.throws(() => validateSyncKeys({}), (error) => error.code === 'ACCOUNT_BATCH_INVALID')
    assert.throws(() => validateSyncKeys({ keys: {} }), (error) => error.code === 'ACCOUNT_BATCH_INVALID')
    assert.throws(() => validateSyncKeys({ keys: [{ platform: 'weibo', platformUid: 'u' }] }), (error) => error.code === 'ACCOUNT_PLATFORM_UNSUPPORTED')
    assert.throws(() => validateSyncKeys({ keys: [{ platform: 'zhihu', platformUid: '' }] }), (error) => error.code === 'ACCOUNT_UID_INVALID')
    assert.throws(() => validateSyncKeys({ keys: [{ platform: 'zhihu', platformUid: 'u', displayName: 'x' }] }), (error) => error.code === 'ACCOUNT_FIELD_NOT_ALLOWED')
    assert.throws(
      () => validateSyncKeys({ keys: new Array(MAX_BATCH_SIZE + 1).fill({ platform: 'zhihu', platformUid: 'u' }) }),
      (error) => error.code === 'ACCOUNT_BATCH_TOO_LARGE',
    )
  })
})

test('isNoiseAccountName：形态规则 + 与 shared-utils CJS 孪生的 parity 锁', async (t) => {
  // 样本一律不取自被枚举集合（AGENTS.md「枚举式黑名单必须配结构化正向契约」）。
  const accepted = [
    '数字生命丘丘', '小林的设计日记', 'Alice Wang', '21号钓点', '关注美食',
    '老周（北京）', 'K-Line', '小·明', '1998年的夏天', '36氪', '阿玖',
  ]
  const rejected = [
    '485.9万人看过', '1.2万次阅读', '2.3w条评价', '500位粉丝',
    'XX创作者服务平台', '某工作室工作台', '开放平台',
    '分享此刻的想法...', '同步到圈子发想法…',
    '哔哩哔哩 (゜', '标题（未闭合',
    '头条号 - 个人中心', '某作品 | 后台',
  ]

  await t.test('形态规则四类各自判否', () => {
    for (const sample of rejected) assert.strictEqual(isNoiseAccountName(sample), true, `必须判噪声：${sample}`)
    for (const sample of accepted) assert.strictEqual(isNoiseAccountName(sample), false, `不得误杀真昵称：${sample}`)
  })

  await t.test('四类规则各自的泛化断言（不靠枚举表）', () => {
    assert.strictEqual(METRIC_PATTERNS.some((re) => re.test('7.8万人看过')), true)
    assert.strictEqual(CHROME_SUFFIXES.some((suffix) => '随便某工作台'.endsWith(suffix)), true)
    assert.strictEqual(ELLIPSIS_PATTERN.test('随便一段……'), true)
    assert.strictEqual(hasUnbalancedBrackets('随便（未闭合'), true)
    assert.strictEqual(hasUnbalancedBrackets('随便（闭合）'), false)
    assert.strictEqual(TITLE_SEPARATOR_PATTERN.test('随便 - 站点'), true)
    assert.strictEqual(TITLE_SEPARATOR_PATTERN.test('A-B'), false)
  })

  await t.test('与 shared-utils 孪生实现逐字 parity：词表、正则 source/flags、判定结果', () => {
    const twinPath = path.resolve(__dirname, '../../shared-utils/src/account-name-guard.js')
    const twin = require(twinPath)
    assert.deepStrictEqual(NOISE_KEYWORDS.slice(), twin.NOISE_KEYWORDS.slice())
    assert.deepStrictEqual(METRIC_WORDS.slice(), twin.METRIC_WORDS.slice())
    assert.deepStrictEqual(KNOWN_PAGE_TITLES.slice(), twin.KNOWN_PAGE_TITLES.slice())
    assert.deepStrictEqual(CHROME_SUFFIXES.slice(), twin.CHROME_SUFFIXES.slice())
    assert.strictEqual(ELLIPSIS_PATTERN.source, twin.ELLIPSIS_PATTERN.source)
    assert.strictEqual(ELLIPSIS_PATTERN.flags, twin.ELLIPSIS_PATTERN.flags)
    assert.strictEqual(TITLE_SEPARATOR_PATTERN.source, twin.TITLE_SEPARATOR_PATTERN.source)
    assert.strictEqual(OPEN_BRACKETS, twin.OPEN_BRACKETS)
    assert.strictEqual(CLOSE_BRACKETS, twin.CLOSE_BRACKETS)
    assert.strictEqual(METRIC_PATTERNS.length, twin.METRIC_PATTERNS.length)
    for (const [index, pattern] of METRIC_PATTERNS.entries()) {
      assert.strictEqual(pattern.source, twin.METRIC_PATTERNS[index].source, `METRIC_PATTERNS[${index}] source 漂移`)
      assert.strictEqual(pattern.flags, twin.METRIC_PATTERNS[index].flags, `METRIC_PATTERNS[${index}] flags 漂移`)
    }
    const samples = accepted.concat(rejected, ['', '   ', null, undefined, 7])
    for (const sample of samples) {
      assert.strictEqual(isNoiseAccountName(sample), twin.isNoiseAccountName(sample), `两份实现在 ${JSON.stringify(sample)} 上判定不一致`)
    }
  })
})

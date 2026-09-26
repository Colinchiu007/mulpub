const assert = require('assert')
const crypto = require('crypto')
const test = require('node:test')

const {
  normalizeCredential,
  credentialDigest,
  stableStringify,
  COOKIE_SEMANTIC_FIELDS,
  COOKIE_VOLATILE_FIELDS,
} = require('../src/cloud-accounts/credential-digest')
const {
  createEnvelopeCrypto,
  createLocalKms,
  encodeEnvelope,
  decodeEnvelope,
  ENVELOPE_VERSION,
  ENVELOPE_ALG,
} = require('../src/cloud-accounts/envelope-crypto')

const TRIPLE = { userId: 'user-1', platform: 'douyin', platformUid: 'uid-9' }

function cookie(name, extra) {
  return Object.assign({ name, value: `v-${name}`, domain: '.example.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }, extra)
}

function sampleCredential() {
  return {
    cookies: [
      cookie('sid', { domain: '.b.com', path: '/x', expirationDate: 1893456000, session: false, hostOnly: false, storeId: 3, lastAccessTime: 111 }),
      cookie('auth', { domain: '.a.com', path: '/', expirationDate: 1893456000, session: false, hostOnly: true, storeId: 1 }),
      cookie('theme', { domain: '.a.com', path: '/', session: true, storeId: 2 }),
    ],
    localStorage: { zeta: '1', alpha: '2', middle: '3' },
    indexedDB: { secure: { token: 't' }, audit: { n: 1 } },
  }
}

function recordingKms(options = {}) {
  const calls = { wrap: [], unwrap: [] }
  const master = options.masterKey || crypto.randomBytes(32)
  return {
    calls,
    // 刻意让 wrap/unwrap 不绑定 keyId：这样「跨账号/跨用户串解」只剩 AAD 一道防线，
    // 正是 PRD 验收标准 8 要证的点。keyId 仍被记录，另在用例里断言取值。
    async wrap(dk, keyId) {
      calls.wrap.push({ dkLength: dk.length, keyId })
      if (options.failWrap) throw new Error('kms downstream exploded')
      return Buffer.from(dk)
    },
    async unwrap(cipherDk, keyId) {
      calls.unwrap.push({ keyId })
      if (options.failUnwrap) throw new Error('kms downstream exploded')
      if (!Buffer.isBuffer(cipherDk) || cipherDk.length !== 32) throw new Error('kms payload corrupt')
      return Buffer.from(cipherDk)
    },
    master,
  }
}

test('credential-digest：规范化与摘要', async (t) => {
  await t.test('cookies 按 (domain, path, name) 字典序排序，与输入顺序无关', () => {
    const credential = sampleCredential()
    const forward = normalizeCredential(credential)
    const reversed = normalizeCredential(Object.assign({}, credential, { cookies: credential.cookies.slice().reverse() }))
    assert.deepStrictEqual(
      forward.cookies.map((c) => `${c.domain}|${c.path}|${c.name}`),
      ['.a.com|/|auth', '.a.com|/|theme', '.b.com|/x|sid'],
    )
    assert.deepStrictEqual(reversed.cookies, forward.cookies)
  })

  await t.test('每项只保留语义字段，volatile 字段被丢弃', () => {
    const normalized = normalizeCredential(sampleCredential())
    for (const item of normalized.cookies) {
      assert.deepStrictEqual(Object.keys(item).sort(), COOKIE_SEMANTIC_FIELDS.slice().sort())
      for (const volatile of COOKIE_VOLATILE_FIELDS) {
        assert.strictEqual(Object.prototype.hasOwnProperty.call(item, volatile), false, `volatile 字段未丢弃：${volatile}`)
      }
    }
    assert.match(stableStringify(normalized), /"name":"auth"/)
    assert.strictEqual(stableStringify(normalized).includes('expirationDate'), false)
    assert.strictEqual(stableStringify(normalized).includes('storeId'), false)
  })

  await t.test('localStorage / indexedDB 键按字典序输出', () => {
    const normalized = normalizeCredential(sampleCredential())
    assert.deepStrictEqual(Object.keys(normalized.localStorage), ['alpha', 'middle', 'zeta'])
    assert.deepStrictEqual(Object.keys(normalized.indexedDB), ['audit', 'secure'])
    assert.strictEqual(stableStringify(normalized.localStorage).startsWith('{"alpha"'), true)
  })

  await t.test('缺失分区按空集合处理，不抛错', () => {
    assert.deepStrictEqual(normalizeCredential(undefined), { cookies: [], localStorage: {}, indexedDB: {} })
    assert.deepStrictEqual(normalizeCredential({}), { cookies: [], localStorage: {}, indexedDB: {} })
    assert.deepStrictEqual(normalizeCredential({ cookies: null, localStorage: null, indexedDB: null }), { cookies: [], localStorage: {}, indexedDB: {} })
  })

  await t.test('摘要稳定性合同：插入顺序不同 / 抖动字段不同 → 同摘要；cookie 值不同 → 异摘要', () => {
    const base = sampleCredential()
    const reordered = {
      cookies: base.cookies.slice().reverse().map((c) => {
        // 同时打乱单个 cookie 内部的键插入顺序
        const entries = Object.keys(c).reverse()
        const out = {}
        for (const key of entries) out[key] = c[key]
        return out
      }),
      localStorage: { middle: '3', zeta: '1', alpha: '2' },
      indexedDB: { audit: { n: 1 }, secure: { token: 't' } },
    }
    assert.strictEqual(credentialDigest(reordered), credentialDigest(base), '键插入顺序不得改变摘要')

    const withDifferentExpiry = {
      cookies: base.cookies.map((c, i) => Object.assign({}, c, { expirationDate: i === 0 ? 2000000000 : undefined, lastAccessTime: 999, session: true })),
      localStorage: base.localStorage,
      indexedDB: base.indexedDB,
    }
    assert.strictEqual(credentialDigest(withDifferentExpiry), credentialDigest(base), '非语义字段不得改变摘要')

    const changedValue = {
      cookies: base.cookies.map((c) => (c.name === 'auth' ? Object.assign({}, c, { value: 'stolen' }) : c)),
      localStorage: base.localStorage,
      indexedDB: base.indexedDB,
    }
    assert.notStrictEqual(credentialDigest(changedValue), credentialDigest(base), 'cookie 值必须参与摘要')
  })

  await t.test('摘要是 64 位小写十六进制 SHA-256', () => {
    const digest = credentialDigest(sampleCredential())
    assert.match(digest, /^[0-9a-f]{64}$/)
    assert.strictEqual(digest.length, 64)
  })
})

test('envelope-crypto：信封加解密与 fail-closed', async (t) => {
  await t.test('加解密往返一致，明文无损（保留 volatile 字段）', async () => {
    const kms = recordingKms()
    const envelopeCrypto = createEnvelopeCrypto({ kms })
    const credential = sampleCredential()
    const envelope = await envelopeCrypto.encryptCredential(Object.assign({ credential }, TRIPLE))

    assert.strictEqual(envelope.v, ENVELOPE_VERSION)
    assert.strictEqual(envelope.v, 1)
    assert.strictEqual(envelope.alg, ENVELOPE_ALG)
    assert.strictEqual(envelope.alg, 'A256GCM')
    assert.strictEqual(envelope.iv.length, 12)
    assert.strictEqual(envelope.tag.length, 16)
    assert.ok(Buffer.isBuffer(envelope.ciphertext) && envelope.ciphertext.length > 0)
    assert.ok(Buffer.isBuffer(envelope.encryptedDataKey))
    assert.match(envelope.digest, /^[0-9a-f]{64}$/)
    assert.strictEqual(envelope.digest, credentialDigest(credential))
    assert.deepStrictEqual(Object.keys(envelope).sort(), ['alg', 'ciphertext', 'digest', 'encryptedDataKey', 'iv', 'tag', 'v'])

    // 库内不得出现 cookie 明文子串（PRD 验收标准 7）
    for (const part of [envelope.ciphertext, envelope.encryptedDataKey, envelope.iv, envelope.tag]) {
      assert.strictEqual(part.toString('latin1').includes('v-auth'), false, '密文中泄漏了凭证明文')
    }

    const restored = await envelopeCrypto.decryptCredential(envelope, TRIPLE)
    assert.strictEqual(restored.cookies[0].expirationDate, credential.cookies[0].expirationDate, '解密必须还原原始字段（下行恢复要用）')
    assert.strictEqual(stableStringify(restored), stableStringify(credential))
    assert.strictEqual(kms.calls.wrap[0].keyId, 'user:user-1')
    assert.strictEqual(kms.calls.unwrap.at(-1).keyId, 'user:user-1')
  })

  await t.test('AAD 三元组任一被换 → 解密必须失败（PRD 验收标准 8）', async () => {
    const envelopeCrypto = createEnvelopeCrypto({ kms: recordingKms() })
    const envelope = await envelopeCrypto.encryptCredential(Object.assign({ credential: sampleCredential() }, TRIPLE))
    for (const tampered of [
      { userId: 'user-2', platform: 'douyin', platformUid: 'uid-9' },
      { userId: 'user-1', platform: 'bilibili', platformUid: 'uid-9' },
      { userId: 'user-1', platform: 'douyin', platformUid: 'uid-10' },
    ]) {
      await assert.rejects(
        envelopeCrypto.decryptCredential(envelope, tampered),
        (error) => error.code === 'CREDENTIAL_DECRYPT_FAILED',
        `换掉 ${JSON.stringify(tampered)} 后必须解不开`,
      )
    }
    await assert.rejects(
      envelopeCrypto.decryptCredential(Object.assign({}, envelope, { ciphertext: Buffer.concat([envelope.ciphertext, Buffer.from([0])]) }), TRIPLE),
      (error) => error.code === 'CREDENTIAL_DECRYPT_FAILED',
    )
  })

  await t.test('KMS 缺失 / wrap 抛错 / unwrap 抛错 → KMS_UNAVAILABLE，绝不降级', async () => {
    for (const options of [{}, { kms: null }, { kms: {} }, { kms: { wrap: () => 'not-async' } }]) {
      const envelopeCrypto = createEnvelopeCrypto(options)
      await assert.rejects(
        envelopeCrypto.encryptCredential(Object.assign({ credential: sampleCredential() }, TRIPLE)),
        (error) => error.code === 'KMS_UNAVAILABLE' && error.status === 503,
        `KMS 形状不合规必须 fail closed：${JSON.stringify(Object.keys(options))}`,
      )
    }
    const failingWrap = createEnvelopeCrypto({ kms: recordingKms({ failWrap: true }) })
    await assert.rejects(
      failingWrap.encryptCredential(Object.assign({ credential: sampleCredential() }, TRIPLE)),
      (error) => error.code === 'KMS_UNAVAILABLE' && error.status === 503,
    )
    // 原始 KMS 报错原文不得外泄给调用方（对齐 safe-error-code 的口径）
    try {
      await failingWrap.encryptCredential(Object.assign({ credential: sampleCredential() }, TRIPLE))
      assert.fail('应当抛出 KMS_UNAVAILABLE')
    } catch (error) {
      assert.strictEqual(error.message.includes('exploded'), false)
      assert.strictEqual(error.code, 'KMS_UNAVAILABLE')
    }
    const envelopeCrypto = createEnvelopeCrypto({ kms: recordingKms() })
    const envelope = await envelopeCrypto.encryptCredential(Object.assign({ credential: sampleCredential() }, TRIPLE))
    const broken = createEnvelopeCrypto({ kms: recordingKms({ failUnwrap: true }) })
    await assert.rejects(
      broken.decryptCredential(envelope, TRIPLE),
      (error) => error.code === 'KMS_UNAVAILABLE' && error.status === 503,
    )
  })

  await t.test('数据密钥明文在用完前后被清零（zeroMemory 合同）', async () => {
    const dk = Buffer.alloc(32, 0x41)
    const iv = Buffer.alloc(12, 0x42)
    const kms = recordingKms()
    const envelopeCrypto = createEnvelopeCrypto({
      kms,
      randomBytes: (size) => (size === 32 ? dk : iv),
    })
    await envelopeCrypto.encryptCredential(Object.assign({ credential: sampleCredential() }, TRIPLE))
    assert.strictEqual(dk.includes(0x41), false, 'DK 明文未清零')
    assert.deepStrictEqual(Array.from(dk), new Array(32).fill(0))
  })

  await t.test('凭证过大 → CREDENTIAL_TOO_LARGE，且未调用 KMS', async () => {
    const kms = recordingKms()
    const envelopeCrypto = createEnvelopeCrypto({ kms })
    const huge = { cookies: [{ name: 'big', value: 'x'.repeat(2 * 1024 * 1024 + 10), domain: '.a.com', path: '/' }], localStorage: {}, indexedDB: {} }
    await assert.rejects(
      envelopeCrypto.encryptCredential(Object.assign({ credential: huge }, TRIPLE)),
      (error) => error.code === 'CREDENTIAL_TOO_LARGE' && error.status === 413,
    )
    assert.strictEqual(kms.calls.wrap.length, 0, 'KMS 体积门禁前不得被调用')
  })

  await t.test('三元组缺失 → ACCOUNT_UID_INVALID / 归属缺失拒绝', async () => {
    const envelopeCrypto = createEnvelopeCrypto({ kms: recordingKms() })
    for (const triple of [
      { userId: '', platform: 'douyin', platformUid: 'u' },
      { userId: 'user-1', platform: '', platformUid: 'u' },
      { userId: 'user-1', platform: 'douyin', platformUid: '   ' },
    ]) {
      await assert.rejects(
        envelopeCrypto.encryptCredential(Object.assign({ credential: sampleCredential() }, triple)),
        (error) => error.code === 'ACCOUNT_UID_INVALID' || error.code === 'ACCOUNT_PLATFORM_UNSUPPORTED' || error.code === 'BUSINESS_USER_REQUIRED',
      )
    }
  })

  await t.test('encodeEnvelope / decodeEnvelope 走 base64 线上形态往返一致', async () => {
    const envelopeCrypto = createEnvelopeCrypto({ kms: recordingKms() })
    const envelope = await envelopeCrypto.encryptCredential(Object.assign({ credential: sampleCredential() }, TRIPLE))
    const wire = encodeEnvelope(envelope)
    assert.strictEqual(typeof wire.iv, 'string')
    assert.deepStrictEqual(
      Object.keys(wire).sort(),
      ['alg', 'ciphertext', 'digest', 'encryptedDataKey', 'iv', 'tag', 'v'],
    )
    assert.deepStrictEqual(JSON.parse(JSON.stringify(wire)), wire, '线上形态必须可 JSON 序列化')
    const decoded = decodeEnvelope(wire)
    assert.deepStrictEqual(decoded.ciphertext, envelope.ciphertext)
    assert.deepStrictEqual(decoded.iv, envelope.iv)
    assert.deepStrictEqual(decoded.tag, envelope.tag)
    assert.deepStrictEqual(decoded.encryptedDataKey, envelope.encryptedDataKey)
    const restored = await envelopeCrypto.decryptCredential(decoded, TRIPLE)
    assert.strictEqual(stableStringify(restored), stableStringify(sampleCredential()))
    assert.throws(() => decodeEnvelope({ iv: 'not-base64-@@@' }), (error) => error.code === 'CREDENTIAL_SHAPE_INVALID')
  })

  await t.test('createLocalKms：32 字节 hex 主密钥可用，非法主密钥拒绝', async () => {
    const key = crypto.randomBytes(32).toString('hex')
    const kms = createLocalKms({ key })
    const dk = crypto.randomBytes(32)
    const dkSnapshot = Buffer.from(dk)
    const wrapped = await kms.wrap(dk, 'user:u-1')
    assert.ok(Buffer.isBuffer(wrapped))
    assert.ok(wrapped.length > 0)
    assert.deepStrictEqual(dk, dkSnapshot, '本地 KMS 不得改写调用方传入的 DK')
    assert.strictEqual(wrapped.toString('latin1').includes(dkSnapshot.toString('latin1')), false, '包裹结果不得包含 DK 明文')
    const unwrapped = await kms.unwrap(wrapped, 'user:u-1')
    assert.deepStrictEqual(unwrapped, dk)
    await assert.rejects(kms.unwrap(wrapped, 'user:other'), (error) => error.code === 'KMS_UNAVAILABLE')
    await assert.rejects(kms.wrap(Buffer.alloc(16), 'user:u-1'), (error) => error.code === 'KMS_UNAVAILABLE')

    for (const bad of ['short', 'zz' .repeat(64), crypto.randomBytes(31).toString('hex'), crypto.randomBytes(33).toString('hex')]) {
      assert.throws(() => createLocalKms({ key: bad }), (error) => error.code === 'KMS_CONFIG_INVALID', `非法主密钥必须拒绝：${String(bad).slice(0, 12)}`)
    }
    assert.throws(() => createLocalKms({ env: {} }), (error) => error.code === 'KMS_CONFIG_INVALID')
    const fromEnv = createLocalKms({ env: { MP_CLOUD_KMS_LOCAL_KEY: key } })
    assert.deepStrictEqual(await fromEnv.unwrap(await fromEnv.wrap(dk, 'user:u-2'), 'user:u-2'), dk)
  })
})

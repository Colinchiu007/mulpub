'use strict'
/**
 * official-key-envelope.test.js — 官方 Key 信封的密码学契约锁
 * （change: compute-key-envelope-migration，tasks 2.2 / 2.3 / 2.5）。
 *
 * 本文件同时承担三道结构锁的判据（tasks 2.3 / 2.4 / 2.5）：
 *   - **2.3** 两个信封模块的 IV / tag / DK 常量同源（扫描域只含这两个文件）；
 *   - **2.5** 官方 Key 路径复用 `createKmsFromEnv` 的唯一选择口径，
 *     仓内不得出现第二处「用哪个 KMS」的判断；
 *   - **2.4** `api_key = encrypt_key(...)` 的加密写入全仓只允许出现在
 *     `ops-center/backend/services/key_service.py` 一处。
 */

const assert = require('node:assert')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const {
  OFFICIAL_KEY_ENVELOPE_VERSION,
  DATA_KEY_BYTES,
  createOfficialKeyEnvelopeCrypto,
  buildAad,
  keyIdFor,
} = require('../src/cloud-accounts/official-key-envelope')

const { ENVELOPE_ALG, IV_BYTES, AUTH_TAG_BYTES } = require('../src/cloud-accounts/validate-account')

const REPO_ROOT = process.env.MP_REPO_ROOT
  ? path.resolve(process.env.MP_REPO_ROOT)
  : path.resolve(__dirname, '..', '..', '..')

/** 测试用的确定性 KMS：wrap 产出 [idLen|keyId|iv|tag|ct]，与 keyring-kms.js 的持久形态同构。 */
function createFakeKms () {
  const master = Buffer.alloc(32, 7)
  return {
    provider: 'fake',
    async wrap (dataKey, keyId) {
      const crypto = require('node:crypto')
      const idBuf = Buffer.from(keyId, 'utf8')
      const iv = crypto.randomBytes(IV_BYTES)
      const cipher = crypto.createCipheriv('aes-256-gcm', master, iv)
      cipher.setAAD(Buffer.from(keyId, 'utf8'))
      const ct = Buffer.concat([cipher.update(dataKey), cipher.final()])
      return Buffer.concat([Buffer.from([idBuf.length]), idBuf, iv, cipher.getAuthTag(), ct])
    },
    async unwrap (wrapped, keyId) {
      const crypto = require('node:crypto')
      const idLen = wrapped[0]
      const offset = 1 + idLen
      const keyIdName = wrapped.subarray(1, offset).toString('utf8')
      if (keyIdName !== keyId) throw new Error('unknown kms key id')
      const iv = wrapped.subarray(offset, offset + IV_BYTES)
      const tag = wrapped.subarray(offset + IV_BYTES, offset + IV_BYTES + AUTH_TAG_BYTES)
      const ct = wrapped.subarray(offset + IV_BYTES + AUTH_TAG_BYTES)
      const decipher = crypto.createDecipheriv('aes-256-gcm', master, iv)
      decipher.setAAD(Buffer.from(keyId, 'utf8'))
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ct), decipher.final()])
    },
  }
}

const PROVIDER = 'kling'
const KEY_ROW_ID = 'official-key-row-1'
const PLAINTEXT = 'sk-test-0123456789abcdef'

test('官方 Key 信封：正常往返', async (t) => {
  const kms = createFakeKms()
  const crypto = createOfficialKeyEnvelopeCrypto({ kms })

  const envelope = await crypto.sealOfficialKey({
    provider: PROVIDER,
    keyRowId: KEY_ROW_ID,
    plaintext: PLAINTEXT,
  })

  await t.test('信封字段形状合规', () => {
    assert.strictEqual(envelope.v, OFFICIAL_KEY_ENVELOPE_VERSION)
    assert.strictEqual(envelope.alg, ENVELOPE_ALG)
    assert.strictEqual(envelope.iv.length, IV_BYTES)
    assert.strictEqual(envelope.tag.length, AUTH_TAG_BYTES)
    assert.ok(Buffer.isBuffer(envelope.ciphertext))
    assert.ok(Buffer.isBuffer(envelope.encryptedDataKey))
  })

  await t.test('解封还原出同一明文', async () => {
    const opened = await crypto.openOfficialKey({
      provider: PROVIDER,
      keyRowId: KEY_ROW_ID,
      envelope,
    })
    try {
      assert.strictEqual(opened.toString('utf8'), PLAINTEXT)
    } finally {
      opened.fill(0)
    }
  })

  await t.test('只读 verify 通过（不产出明文）', async () => {
    assert.strictEqual(await crypto.verifyOfficialKeyEnvelope({
      provider: PROVIDER,
      keyRowId: KEY_ROW_ID,
      envelope,
    }), true)
  })
})

test('官方 Key 信封：跨 provider 替换必失败', async (t) => {
  const kms = createFakeKms()
  const crypto = createOfficialKeyEnvelopeCrypto({ kms })
  const envelope = await crypto.sealOfficialKey({
    provider: PROVIDER,
    keyRowId: KEY_ROW_ID,
    plaintext: PLAINTEXT,
  })

  // 换 provider 的失败落在 **KMS unwrap 层**（keyId = official:<provider> 随 provider 变），
  // 而非外层 AAD——D3 已定案：KMS 上下文只管供应商维度，行级绑定才由 AAD 承担。
  // 因此这里断言的是**安全性质**（拿不到明文）而不是某个具体错误码：
  // 归属不符与 KMS 故障在调用方看来都是「解不开」，但前者不该被报成「服务不可用」。
  await t.test('解封时换 provider ⇒ 拿不到明文', async () => {
    await assert.rejects(
      () => crypto.openOfficialKey({ provider: 'minimax', keyRowId: KEY_ROW_ID, envelope }),
      (err) => {
        assert.ok(
          /KMS_UNAVAILABLE|OFFICIAL_KEY_ENVELOPE_UNSEAL_FAILED/.test(String(err && err.message)),
          `换 provider 必须失败，实际错误：${err && err.message}`
        )
        return true
      }
    )
  })

  await t.test('verify 时换 provider ⇒ 同样失败', async () => {
    await assert.rejects(
      () => crypto.verifyOfficialKeyEnvelope({ provider: 'minimax', keyRowId: KEY_ROW_ID, envelope }),
      (err) => {
        assert.ok(
          /KMS_UNAVAILABLE|OFFICIAL_KEY_ENVELOPE_UNSEAL_FAILED/.test(String(err && err.message)),
          `换 provider 必须失败，实际错误：${err && err.message}`
        )
        return true
      }
    )
  })

  await t.test('KMS 包裹上下文确实只含供应商维度（不含行 id）', () => {
    assert.strictEqual(keyIdFor('kling'), 'official:kling')
    assert.ok(!keyIdFor('kling').includes(KEY_ROW_ID))
  })
})

test('官方 Key 信封：跨行替换必失败', async (t) => {
  const kms = createFakeKms()
  const crypto = createOfficialKeyEnvelopeCrypto({ kms })
  const envelope = await crypto.sealOfficialKey({
    provider: PROVIDER,
    keyRowId: KEY_ROW_ID,
    plaintext: PLAINTEXT,
  })

  await t.test('解封时换行 id ⇒ 认证失败（行级绑定由 AAD 承担）', async () => {
    await assert.rejects(
      () => crypto.openOfficialKey({ provider: PROVIDER, keyRowId: 'other-row', envelope }),
      /OFFICIAL_KEY_ENVELOPE_UNSEAL_FAILED/
    )
  })

  await t.test('AAD 材料确实含行 id（防止「看起来一样」的伪隔离）', () => {
    assert.strictEqual(buildAad(PROVIDER, KEY_ROW_ID).toString('utf8'),
      `official|${PROVIDER}|${KEY_ROW_ID}`)
    assert.notStrictEqual(
      buildAad(PROVIDER, KEY_ROW_ID).toString('utf8'),
      buildAad(PROVIDER, 'other-row').toString('utf8')
    )
  })
})

test('官方 Key 信封：`v` 不匹配一律拒绝，不猜格式', async (t) => {
  const kms = createFakeKms()
  const crypto = createOfficialKeyEnvelopeCrypto({ kms })
  const envelope = await crypto.sealOfficialKey({
    provider: PROVIDER,
    keyRowId: KEY_ROW_ID,
    plaintext: PLAINTEXT,
  })

  await t.test('未知格式族拒绝', async () => {
    await assert.rejects(
      () => crypto.openOfficialKey({
        provider: PROVIDER,
        keyRowId: KEY_ROW_ID,
        envelope: { ...envelope, v: 'official-key/999' },
      }),
      /OFFICIAL_KEY_ENVELOPE_VERSION_MISMATCH/
    )
  })

  await t.test('与云端凭证的 ENVELOPE_VERSION 不同值（格式族必须可独立判别）', () => {
    const { ENVELOPE_VERSION } = require('../src/cloud-accounts/validate-account')
    assert.notStrictEqual(OFFICIAL_KEY_ENVELOPE_VERSION, ENVELOPE_VERSION)
  })
})

test('官方 Key 信封：KMS 缺失抛错，不降级', async (t) => {
  const crypto = createOfficialKeyEnvelopeCrypto({})

  await t.test('封印时 KMS 未配置 ⇒ KMS_UNAVAILABLE', async () => {
    await assert.rejects(
      () => crypto.sealOfficialKey({ provider: PROVIDER, keyRowId: KEY_ROW_ID, plaintext: PLAINTEXT }),
      /KMS_UNAVAILABLE/
    )
  })

  await t.test('KMS 形状不合规（无 unwrap）⇒ KMS_UNAVAILABLE', async () => {
    const bad = createOfficialKeyEnvelopeCrypto({ kms: { wrap: async () => Buffer.alloc(1) } })
    await assert.rejects(
      () => bad.sealOfficialKey({ provider: PROVIDER, keyRowId: KEY_ROW_ID, plaintext: PLAINTEXT }),
      /KMS_UNAVAILABLE/
    )
  })
})

test('官方 Key 信封：归属元组非法即拒（先于任何加密动作）', async (t) => {
  const kms = createFakeKms()
  const crypto = createOfficialKeyEnvelopeCrypto({ kms })

  await t.test('provider 为空 ⇒ 拒', async () => {
    await assert.rejects(
      () => crypto.sealOfficialKey({ provider: '', keyRowId: KEY_ROW_ID, plaintext: PLAINTEXT }),
      /OFFICIAL_KEY_PROVIDER_INVALID/
    )
  })

  await t.test('keyRowId 为空 ⇒ 拒', async () => {
    await assert.rejects(
      () => crypto.sealOfficialKey({ provider: PROVIDER, keyRowId: '', plaintext: PLAINTEXT }),
      /OFFICIAL_KEY_ROW_ID_INVALID/
    )
  })
})

// ── 结构锁 2.3：两个信封模块的 IV / tag / DK 常量同源 ──────────────────
test('结构锁 2.3：两个信封模块的算法常量同源，不得各自声明字面量', () => {
  const ENVELOPE_CRYPTO = path.join(__dirname, '..', 'src', 'cloud-accounts', 'envelope-crypto.js')
  const OFFICIAL = path.join(__dirname, '..', 'src', 'cloud-accounts', 'official-key-envelope.js')
  const read = (f) => fs.readFileSync(f, 'utf8')

  for (const [label, file] of [['envelope-crypto.js', ENVELOPE_CRYPTO], ['official-key-envelope.js', OFFICIAL]]) {
    const src = read(file)
    // IV / tag 字面量必须来自 validate-account 的同源 import
    assert.ok(
      /IV_BYTES/.test(src) && /AUTH_TAG_BYTES/.test(src) && /ENVELOPE_ALG/.test(src),
      `${label} 必须引用同源常量 IV_BYTES / AUTH_TAG_BYTES / ENVELOPE_ALG`
    )
    // 不得就地声明 IV/tag 的字面量
    assert.ok(
      !/^\s*(const|let)\s+IV_BYTES\s*=\s*\d+/m.test(src),
      `${label} 不得就地声明 IV_BYTES 字面量`
    )
    assert.ok(
      !/^\s*(const|let)\s+AUTH_TAG_BYTES\s*=\s*\d+/m.test(src),
      `${label} 不得就地声明 AUTH_TAG_BYTES 字面量`
    )
  }

  // DK 长度：validate-account 未导出该常量（规格偏差 SD-1），故锁「同值」而非「同源」
  const officialSrc = read(OFFICIAL)
  const dkMatch = officialSrc.match(/DATA_KEY_BYTES\s*=\s*(\d+)/)
  assert.ok(dkMatch, 'official-key-envelope.js 必须声明 DATA_KEY_BYTES')
  assert.strictEqual(Number(dkMatch[1]), 32, 'DATA_KEY_BYTES 必须为 32（AES-256-GCM 密钥长度）')
  assert.strictEqual(DATA_KEY_BYTES, 32)
})

// ── 结构锁 2.5：KMS 选择口径唯一 ──────────────────────────────────────
test('结构锁 2.5：官方 Key 路径复用 createKmsFromEnv，不另立第三套判断', () => {
  const ccIndex = fs.readFileSync(path.join(__dirname, '..', 'src', 'cloud-accounts', 'index.js'), 'utf8')
  assert.ok(
    /function\s+createKmsFromEnv/.test(ccIndex),
    'cloud-accounts/index.js 必须提供 createKmsFromEnv 作为唯一 KMS 选择口径'
  )

  // 扫描域：两个 JS 信封模块 + cloud-accounts/index.js
  const scope = [
    path.join(__dirname, '..', 'src', 'cloud-accounts', 'official-key-envelope.js'),
    path.join(__dirname, '..', 'src', 'cloud-accounts', 'envelope-crypto.js'),
    path.join(__dirname, '..', 'src', 'cloud-accounts', 'index.js'),
  ]
  for (const file of scope) {
    const src = fs.readFileSync(file, 'utf8')
    assert.ok(
      !/MP_CLOUD_KMS_KEYRING/.test(src) || file.endsWith('index.js'),
      `${path.basename(file)} 不得直接读密钥环环境变量（选择口径只在 index.js）`
    )
  }
})

// ── 结构锁 2.4：官方 Key 的加密写入全仓唯一 ──────────────────────────
test('结构锁 2.4：api_key = encrypt_key(...) 的加密写入全仓只允许一处', () => {
  const opsRoot = path.join(REPO_ROOT, 'ops-center', 'backend')
  const hits = []
  const walk = (dir) => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === '__pycache__' || e.name === 'node_modules' || e.name === '.venv') continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (e.name.endsWith('.py')) {
        const src = fs.readFileSync(abs, 'utf8')
        if (/api_key\s*=\s*encrypt_key\s*\(/.test(src)) {
          hits.push(path.relative(REPO_ROOT, abs))
        }
      }
    }
  }
  walk(opsRoot)
  assert.deepStrictEqual(
    hits,
    [path.join('ops-center', 'backend', 'services', 'key_service.py')],
    '官方 Key 的 Fernet 加密写入必须只在 key_service.py 一处'
  )
})

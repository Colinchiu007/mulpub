// @ts-check
/**
 * runtime-trust-anchor.test.js — P0-1 信任锚闸门（打包版不吃内置 DEV 公钥）
 *
 * 覆盖：未打包回落 DEV 公钥 / 打包无自定义锚拒绝 / 打包有自定义锚正常验签 /
 * 探针异常按最保守（生产态）处理 / verifyRuntimeSignature 端到端集成。
 */
import { describe, it, expect, afterEach } from 'vitest'

__registerMock('./crypto', {
  isAvailable: () => true,
  encrypt: (key) => (key ? Buffer.from('enc_' + key) : null),
  decrypt: (value) => (value ? Buffer.from(value).toString('utf8').replace(/^enc_/, '') : ''),
  mask: (key) => (key ? key.slice(0, 4) + '****' + key.slice(-4) : '****'),
  setSafeStorage: () => {},
})

const nodeCrypto = require('crypto')

const { configurePackagedProbe, isPackagedApp, resolveTrustAnchor } = require('./runtime-trust-anchor')
const { verifyRuntimeSignature, canonicalJson, DEFAULT_RUNTIME_PUBLIC_KEY } = require('./ops-center-sync')

// 与 ops-center-sync.test.js 同一把 DEV 密钥对（仅测试自验用）
const DEV_PRIVATE_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MC4CAQAwBQYDK2VwBCIEIMEaqZBFhrl/hpieWHhYoaG6Dn+Juchfx4/2s0dXok0S',
  '-----END PRIVATE KEY-----',
].join('\n')

function signPayload (payload) {
  const key = nodeCrypto.createPrivateKey(DEV_PRIVATE_KEY)
  const canonical = Buffer.from(canonicalJson(payload), 'utf-8')
  const sig = nodeCrypto.sign(null, canonical, key)
  return { ...payload, signature: sig.toString('base64') }
}

afterEach(() => { configurePackagedProbe(null) })

describe('resolveTrustAnchor —— 内置 DEV 公钥只在未打包态当便利锚', () => {
  it('未打包 + 未配置自定义锚 → 回落内置 DEV 公钥（开发/演示自验）', () => {
    configurePackagedProbe(() => false)
    expect(resolveTrustAnchor('', DEFAULT_RUNTIME_PUBLIC_KEY)).toEqual({ pem: DEFAULT_RUNTIME_PUBLIC_KEY })
    expect(resolveTrustAnchor('   ', DEFAULT_RUNTIME_PUBLIC_KEY)).toEqual({ pem: DEFAULT_RUNTIME_PUBLIC_KEY })
  })

  it('打包 + 未配置自定义锚 → NO_PRODUCTION_TRUST_ANCHOR（拒绝内置 DEV 公钥）', () => {
    configurePackagedProbe(() => true)
    expect(resolveTrustAnchor('', DEFAULT_RUNTIME_PUBLIC_KEY)).toEqual({ error: 'NO_PRODUCTION_TRUST_ANCHOR' })
    expect(resolveTrustAnchor(undefined, DEFAULT_RUNTIME_PUBLIC_KEY)).toEqual({ error: 'NO_PRODUCTION_TRUST_ANCHOR' })
  })

  it('打包 + 已配置自定义锚 → 用自定义锚（去空白）', () => {
    configurePackagedProbe(() => true)
    const other = nodeCrypto.generateKeyPairSync('ed25519')
    const pem = other.publicKey.export({ type: 'spki', format: 'pem' })
    expect(resolveTrustAnchor('  \n' + pem + '\n', DEFAULT_RUNTIME_PUBLIC_KEY)).toEqual({ pem: pem.trim() })
  })

  it('未打包但 DEV 公钥缺失（被裁掉）→ NO_PUBLIC_KEY，不返回空 PEM', () => {
    configurePackagedProbe(() => false)
    expect(resolveTrustAnchor('', '')).toEqual({ error: 'NO_PUBLIC_KEY' })
  })
})

describe('isPackagedApp —— 判据保守性', () => {
  it('探针返回非 true（含异常值）→ 一律不算生产态', () => {
    configurePackagedProbe(() => 'yes')
    expect(isPackagedApp()).toBe(false)
  })

  it('探针自身抛错 → 按生产态处理（最保守：宁可不给便利锚）', () => {
    configurePackagedProbe(() => { throw new Error('boom') })
    expect(isPackagedApp()).toBe(true)
  })

  it('未注入探针时读 app.isPackaged（vitest 环境默认 false）', () => {
    expect(isPackagedApp()).toBe(false)
  })
})

describe('verifyRuntimeSignature 集成 —— 打包版无自定义锚则整份运行时策略不应用', () => {
  const base = { announcements: [{ title: '维护', severity: 'maintenance', content: 'x' }], synced_at: '2026-09-23T00:00:00Z' }

  it('打包 + 无锚：即便签名是用 DEV 私钥合法签的，也必须被拒', () => {
    configurePackagedProbe(() => true)
    const payload = signPayload(base)
    expect(verifyRuntimeSignature(payload, '')).toEqual({ ok: false, reason: 'NO_PRODUCTION_TRUST_ANCHOR' })
    expect(verifyRuntimeSignature(payload)).toEqual({ ok: false, reason: 'NO_PRODUCTION_TRUST_ANCHOR' })
  })

  it('未打包 + 无锚：沿用内置 DEV 公钥 → ok（不改坏开发体验）', () => {
    configurePackagedProbe(() => false)
    const payload = signPayload(base)
    expect(verifyRuntimeSignature(payload)).toEqual({ ok: true })
  })

  it('打包 + 自定义锚：用自定义密钥对签发的 payload → ok', () => {
    configurePackagedProbe(() => true)
    const kp = nodeCrypto.generateKeyPairSync('ed25519')
    const priv = kp.privateKey.export({ type: 'pkcs8', format: 'pem' })
    const pub = kp.publicKey.export({ type: 'spki', format: 'pem' })
    const canonical = Buffer.from(canonicalJson(base), 'utf-8')
    const payload = { ...base, signature: nodeCrypto.sign(null, canonical, priv).toString('base64') }
    expect(verifyRuntimeSignature(payload, pub)).toEqual({ ok: true })
    // 同一 payload 不能被 DEV 公钥接受（信任锚唯一性）
    expect(verifyRuntimeSignature(payload, DEFAULT_RUNTIME_PUBLIC_KEY)).toEqual({ ok: false, reason: 'SIGNATURE_MISMATCH' })
  })
})

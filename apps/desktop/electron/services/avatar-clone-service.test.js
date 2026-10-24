// @ts-check
/**
 * avatar-clone-service.test.js — 数字人形象克隆 service 测试
 *
 * 覆盖（与 tts-voice-clone-service.test.js 同族，但素材是图片/视频）：
 *   - owner 隔离：换账号看到各自一套 registry
 *   - registry 形状非法 ⇒ 视为空并告警，不猜测不合并
 *   - 创建编排：审计先行 / 远端失败 / 落样本失败补偿删远端 / 重复 id
 *   - 删除三态：远端成功即清本地；远端失败标 pending 并保留样本
 *   - 训练状态轮询：completed / failed 归一；轮询失败不改本地状态
 *   - 素材校验：photo 只能图片、digital_twin 只能视频（防 HeyGen 侧难定位的 400）
 *   - 目录合并的失效标记（training_failed / sample_storage_missing）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import nodeFs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { AvatarCloneService } from './avatar-clone-service'

const OWNER_A = 'user-a'
const OWNER_B = 'user-b'

function ownerHash (owner) {
  return createHash('sha256').update(owner, 'utf8').digest('hex').slice(0, 32)
}

function createStore (initialOwner = OWNER_A) {
  let activeOwner = initialOwner
  const valuesByOwner = new Map()
  const getValues = (owner) => {
    if (!valuesByOwner.has(owner)) valuesByOwner.set(owner, new Map())
    return valuesByOwner.get(owner)
  }
  return {
    getOwnerSubject: vi.fn(() => activeOwner),
    getUserSetting: vi.fn((key, defaultValue, owner) => {
      const values = getValues(owner)
      return values.has(key) ? values.get(key) : defaultValue
    }),
    setUserSetting: vi.fn((key, value, owner) => {
      getValues(owner).set(key, value)
    }),
    getValue: (owner, key) => getValues(owner).get(key),
    setActiveOwner: (owner) => { activeOwner = owner },
  }
}

function createManager (handlers = {}) {
  return {
    callAdapter: vi.fn(async (_providerId, method, params) => {
      if (typeof handlers[method] === 'function') return handlers[method](params)
      if (method === 'createAvatar') return { code: 0, data: { id: 'av-1' } }
      if (method === 'getAvatarStatus') return { code: 0, data: { status: 'completed' } }
      if (method === 'deleteAvatar') return { code: 0, data: null }
      return { code: 0, data: null }
    }),
  }
}

function createBlob (content, type) {
  return new Blob([content], { type })
}

function imageMedia () {
  return { blob: createBlob('png-bytes', 'image/png'), fileName: 'me.png', contentType: 'image/png' }
}

function videoMedia () {
  return { blob: createBlob('mp4-bytes', 'video/mp4'), fileName: 'me.mp4', contentType: 'video/mp4' }
}

// change: avatar-voice-clone-bundled —— 配套声音素材（录音）
function audioMedia () {
  return { blob: createBlob('mp3-bytes', 'audio/mpeg'), fileName: 'me.mp3', contentType: 'audio/mpeg' }
}

function createService ({ store, manager, userDataPath, fsImpl } = {}) {
  return new AvatarCloneService({
    store: store || createStore(),
    modelProviderManager: manager || createManager(),
    userDataPath: userDataPath || os.tmpdir(),
    fs: fsImpl || nodeFs,
    createStorageId: (() => { let n = 0; return () => `st-${++n}` })(),
    now: (() => { let t = 1700000000000; return () => (t += 1000) })(),
  })
}

describe('AvatarCloneService — 数字人形象克隆', () => {
  let userDataDir

  beforeEach(() => {
    userDataDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'avatar-clone-test-'))
  })

  afterEach(() => {
    try { nodeFs.rmSync(userDataDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
  })

  // ── 入参校验 ───────────────────────────────────────────────────────

  describe('素材校验', () => {
    it('photo 只接受图片扩展名（.mp4 走 photo 会被拒）', async () => {
      const service = createService({ userDataPath: userDataDir })
      const result = await service.createClone({
        name: '形象', type: 'photo', media: videoMedia(),
      })
      expect(result.code).toBe(-1)
      expect(result.message).toBe('AVATAR_CLONE_INVALID_ARGUMENTS')
    })

    it('digital_twin 只接受视频扩展名（.png 走 digital_twin 会被拒）', async () => {
      const service = createService({ userDataPath: userDataDir })
      const result = await service.createClone({
        name: '形象', type: 'digital_twin', media: imageMedia(),
      })
      expect(result.code).toBe(-1)
      expect(result.message).toBe('AVATAR_CLONE_INVALID_ARGUMENTS')
    })

    it('未知 type 与缺 media 一律拒绝', async () => {
      const service = createService({ userDataPath: userDataDir })
      expect((await service.createClone({ name: 'x', type: 'hologram', media: imageMedia() })).code).toBe(-1)
      expect((await service.createClone({ name: 'x', type: 'photo' })).code).toBe(-1)
      expect((await service.createClone({ type: 'photo', media: imageMedia() })).code).toBe(-1)
    })

    it('sourceKind 缺省 self；非法值回落 self', async () => {
      const store = createStore()
      const service = createService({ store, userDataPath: userDataDir })
      await service.createClone({ name: '形象', type: 'photo', media: imageMedia(), sourceKind: 'bogus' })
      const registry = store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)
      expect(registry.avatars[0].sourceKind).toBe('self')
    })
  })

  // ── 创建编排 ───────────────────────────────────────────────────────

  describe('创建', () => {
    it('成功：远端返回 id → 样本落盘 → registry 落一条 active/training', async () => {
      const store = createStore()
      const service = createService({ store, userDataPath: userDataDir })
      const result = await service.createClone({ name: '我的形象', type: 'photo', media: imageMedia() })

      expect(result.code).toBe(0)
      expect(result.data.avatar).toMatchObject({
        id: 'av-1',
        name: '我的形象',
        source: 'user_clone',
        sourceKind: 'self',
        mediaType: 'image',
        trainingState: 'training',
        deletionState: 'active',
      })

      const registry = store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)
      expect(registry.avatars).toHaveLength(1)
      expect(registry.avatars[0].sampleStorage.sampleCount).toBe(1)

      // 样本真的落盘了
      const sampleDir = path.resolve(userDataDir, registry.avatars[0].sampleStorage.relativeDir)
      expect(nodeFs.existsSync(sampleDir)).toBe(true)
      expect(nodeFs.readdirSync(sampleDir)).toContain('source.png')

      // 审计日志独立落盘
      const auditLog = path.resolve(userDataDir, 'audit', 'avatar-voice-clone.log')
      expect(nodeFs.existsSync(auditLog)).toBe(true)
      const events = nodeFs.readFileSync(auditLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      expect(events.map((e) => e.event)).toEqual(['create', 'created'])
    })

    it('远端失败：不写 registry、不落样本，审计记 create_failed', async () => {
      const store = createStore()
      const manager = createManager({
        createAvatar: () => ({ code: -1, errorCode: 'OPERATION_NOT_SUPPORTED', message: 'not supported' }),
      })
      const service = createService({ store, manager, userDataPath: userDataDir })
      const result = await service.createClone({ name: 'x', type: 'photo', media: imageMedia() })

      expect(result.code).toBe(-1)
      expect(result.message).toBe('AVATAR_CLONE_PROVIDER_UNAVAILABLE')
      expect(store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)).toBeUndefined()

      const auditLog = path.resolve(userDataDir, 'audit', 'avatar-voice-clone.log')
      const events = nodeFs.readFileSync(auditLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      expect(events.map((e) => e.event)).toEqual(['create', 'create_failed'])
    })

    it('落样本失败：补偿删远端（不留下付费孤儿资产）', async () => {
      const store = createStore()
      const deleteSpy = vi.fn(async () => ({ code: 0, data: null }))
      const manager = createManager({
        createAvatar: () => ({ code: 0, data: { id: 'av-9' } }),
        deleteAvatar: deleteSpy,
      })
      // 只让「样本目录」写不动，audit 日志仍可写（否则 auditSeq 为空会提前返回，
      // 走不到 createAvatar，补偿路径就测不到）。判定条件：路径含 avatar-clone-samples。
      const realPromises = nodeFs.promises
      const brokenFs = {
        promises: {
          ...realPromises,
          mkdir: async (target, ...rest) => {
            if (String(target).includes('avatar-clone-samples')) throw new Error('EACCES')
            return realPromises.mkdir(target, ...rest)
          },
          writeFile: async (target, ...rest) => {
            if (String(target).includes('avatar-clone-samples')) throw new Error('EACCES')
            return realPromises.writeFile(target, ...rest)
          },
        },
      }
      const service = createService({ store, manager, userDataPath: userDataDir, fsImpl: brokenFs })
      const result = await service.createClone({ name: 'x', type: 'photo', media: imageMedia() })

      expect(result.code).toBe(-1)
      expect(result.message).toBe('AVATAR_CLONE_STORAGE_UNAVAILABLE')
      expect(deleteSpy).toHaveBeenCalledWith({ avatarId: 'av-9' })
      expect(store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)).toBeUndefined()
    })

    it('重复 id：补偿删远端并报 DUPLICATE_ID', async () => {
      const store = createStore()
      const manager = createManager({ createAvatar: () => ({ code: 0, data: { id: 'av-1' } }) })
      const service = createService({ store, manager, userDataPath: userDataDir })
      await service.createClone({ name: '第一个', type: 'photo', media: imageMedia() })
      const result = await service.createClone({ name: '第二个', type: 'photo', media: imageMedia() })

      expect(result.code).toBe(-1)
      expect(result.message).toBe('AVATAR_CLONE_DUPLICATE_ID')
      const registry = store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)
      expect(registry.avatars).toHaveLength(1)
    })
  })

  // ── owner 隔离 ─────────────────────────────────────────────────────

  describe('owner 隔离', () => {
    it('换账号看到各自一套 registry', async () => {
      const store = createStore()
      const service = createService({ store, userDataPath: userDataDir })
      await service.createClone({ name: 'A 的形象', type: 'photo', media: imageMedia() })

      store.setActiveOwner(OWNER_B)
      const listB = await service.listClones({})
      expect(listB.data.avatars).toHaveLength(0)

      store.setActiveOwner(OWNER_A)
      const listA = await service.listClones({})
      expect(listA.data.avatars).toHaveLength(1)
      expect(listA.data.avatars[0].name).toBe('A 的形象')
    })
  })

  // ── 列表与失效标记 ─────────────────────────────────────────────────

  describe('列表失效标记', () => {
    it('trainingState=failed 的条目标 training_failed', async () => {
      const store = createStore()
      const service = createService({ store, userDataPath: userDataDir })
      await service.createClone({ name: 'x', type: 'photo', media: imageMedia() })

      const key = `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`
      const registry = store.getValue(OWNER_A, key)
      registry.avatars[0].trainingState = 'failed'
      store.setUserSetting(key, registry, OWNER_A)

      const list = await service.listClones({})
      expect(list.data.avatars[0].invalidReason).toBe('training_failed')
    })

    it('registry 形状非法 ⇒ 视为空（不猜测不合并）', async () => {
      const store = createStore()
      store.setUserSetting(`avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`, { bogus: true }, OWNER_A)
      const service = createService({ store, userDataPath: userDataDir })
      const list = await service.listClones({})
      expect(list.data.avatars).toEqual([])
    })
  })

  // ── 删除三态 ───────────────────────────────────────────────────────

  describe('删除', () => {
    it('远端删除成功 ⇒ 清 registry 与本地样本', async () => {
      const store = createStore()
      const service = createService({ store, userDataPath: userDataDir })
      await service.createClone({ name: 'x', type: 'photo', media: imageMedia() })
      const registry = store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)
      const sampleDir = path.resolve(userDataDir, registry.avatars[0].sampleStorage.relativeDir)
      expect(nodeFs.existsSync(sampleDir)).toBe(true)

      const result = await service.deleteClone({ avatarId: 'av-1' })
      expect(result.code).toBe(0)
      expect(result.data).toMatchObject({ deleted: true, remoteDeleted: true })
      expect(store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`).avatars).toHaveLength(0)
      expect(nodeFs.existsSync(sampleDir)).toBe(false)
    })

    it('远端删除失败 ⇒ 标 pending 并保留样本（不谎称成功）', async () => {
      const store = createStore()
      const manager = createManager({ deleteAvatar: () => ({ code: -1, message: 'boom' }) })
      const service = createService({ store, manager, userDataPath: userDataDir })
      await service.createClone({ name: 'x', type: 'photo', media: imageMedia() })
      const registry = store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)
      const sampleDir = path.resolve(userDataDir, registry.avatars[0].sampleStorage.relativeDir)

      const result = await service.deleteClone({ avatarId: 'av-1' })
      expect(result.code).toBe(0)
      expect(result.data).toMatchObject({ deleted: false, remoteDeleted: false, pending: true })

      const after = store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)
      expect(after.avatars).toHaveLength(1)
      expect(after.avatars[0].deletionState).toBe('pending')
      // 样本必须保留（下次重试要用）
      expect(nodeFs.existsSync(sampleDir)).toBe(true)
    })

    it('删除不存在的 id ⇒ NOT_FOUND', async () => {
      const service = createService({ userDataPath: userDataDir })
      const result = await service.deleteClone({ avatarId: 'nope' })
      expect(result.message).toBe('AVATAR_CLONE_NOT_FOUND')
    })
  })

  // ── 训练轮询 ───────────────────────────────────────────────────────

  describe('训练状态轮询', () => {
    it('completed ⇒ 本地状态更新为 completed', async () => {
      const store = createStore()
      const service = createService({ store, userDataPath: userDataDir })
      await service.createClone({ name: 'x', type: 'photo', media: imageMedia() })

      const result = await service.refreshTrainingState({ avatarId: 'av-1' })
      expect(result.data.avatar.trainingState).toBe('completed')

      const registry = store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)
      expect(registry.avatars[0].trainingState).toBe('completed')
    })

    it('failed ⇒ 本地状态更新为 failed', async () => {
      const store = createStore()
      const manager = createManager({ getAvatarStatus: () => ({ code: 0, data: { status: 'failed' } }) })
      const service = createService({ store, manager, userDataPath: userDataDir })
      await service.createClone({ name: 'x', type: 'photo', media: imageMedia() })

      const result = await service.refreshTrainingState({ avatarId: 'av-1' })
      expect(result.data.avatar.trainingState).toBe('failed')
    })

    it('轮询失败 ⇒ 本地状态不变（下次再试），且回报失败', async () => {
      const store = createStore()
      const manager = createManager({ getAvatarStatus: () => ({ code: -1, message: 'timeout' }) })
      const service = createService({ store, manager, userDataPath: userDataDir })
      await service.createClone({ name: 'x', type: 'photo', media: imageMedia() })

      const result = await service.refreshTrainingState({ avatarId: 'av-1' })
      expect(result.code).toBe(-1)
      const registry = store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)
      expect(registry.avatars[0].trainingState).toBe('training')
    })
  })

  // ── change: digital-human-multiprovider：provider 隔离 ──────────────

  describe("远端调用必须按 owner.providerId 走（不能写死 heygen）", () => {
    it("providerId=hifly 时 createAvatar 打到 hifly", async () => {
      const store = createStore()
      const manager = createManager({ createAvatar: () => ({ code: 0, data: { id: 'av-hf' } }) })
      const service = createService({ store, manager, userDataPath: userDataDir })

      await service.createClone({ name: '飞影形象', type: 'photo', media: imageMedia(), providerId: 'hifly' })

      const call = manager.callAdapter.mock.calls.find((c) => c[1] === 'createAvatar')
      expect(call).toBeDefined()
      expect(call[0]).toBe('hifly')
    })

    it('删除也按 providerId 走（hifly 的形象不能拿 HeyGen 删）', async () => {
      const store = createStore()
      const manager = createManager({ createAvatar: () => ({ code: 0, data: { id: 'av-hf' } }) })
      const service = createService({ store, manager, userDataPath: userDataDir })

      await service.createClone({ name: '飞影形象', type: 'photo', media: imageMedia(), providerId: 'hifly' })
      await service.deleteClone({ avatarId: 'av-hf', providerId: 'hifly' })

      const call = manager.callAdapter.mock.calls.find((c) => c[1] === 'deleteAvatar')
      expect(call).toBeDefined()
      expect(call[0]).toBe('hifly')
    })

    it('providerId=heygen 时仍打 heygen（回归）', async () => {
      const store = createStore()
      const manager = createManager({ createAvatar: () => ({ code: 0, data: { id: 'av-hg' } }) })
      const service = createService({ store, manager, userDataPath: userDataDir })

      await service.createClone({ name: 'HeyGen 形象', type: 'photo', media: imageMedia(), providerId: 'heygen' })

      const call = manager.callAdapter.mock.calls.find((c) => c[1] === 'createAvatar')
      expect(call[0]).toBe('heygen')
    })
  })


  describe('provider 隔离（registry 键与样本目录按 providerId 分段）', () => {
    it('两家 provider 的克隆写进各自 registry，不串库', async () => {
      const store = createStore()
      const service = createService({ store, userDataPath: userDataDir })

      await service.createClone({ name: 'HeyGen 形象', type: 'photo', media: imageMedia(), providerId: 'heygen' })
      await service.createClone({ name: '飞影形象', type: 'photo', media: imageMedia(), providerId: 'hifly' })

      const heygenRegistry = store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)
      const hiflyRegistry = store.getValue(OWNER_A, `avatar-clones:v1:hifly:${ownerHash(OWNER_A)}`)

      expect(heygenRegistry.avatars).toHaveLength(1)
      expect(heygenRegistry.avatars[0].name).toBe('HeyGen 形象')
      expect(hiflyRegistry.avatars).toHaveLength(1)
      expect(hiflyRegistry.avatars[0].name).toBe('飞影形象')
    })

    it('样本目录按 providerId 分段：两家的 storageId 不落在同一目录', async () => {
      const store = createStore()
      const service = createService({ store, userDataPath: userDataDir })

      await service.createClone({ name: 'A', type: 'photo', media: imageMedia(), providerId: 'heygen' })
      await service.createClone({ name: 'B', type: 'photo', media: imageMedia(), providerId: 'hifly' })

      // 从 registry 读（_toPublic 只回 sampleCount，不含 relativeDir）
      const hg = store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`).avatars[0]
      const hf = store.getValue(OWNER_A, `avatar-clones:v1:hifly:${ownerHash(OWNER_A)}`).avatars[0]

      expect(hg.sampleStorage.relativeDir).toContain('avatar-clone-samples/heygen/')
      expect(hf.sampleStorage.relativeDir).toContain('avatar-clone-samples/hifly/')
      // 两家 storageId 相同也不冲突（目录不同）—— 且样本真的各自落盘
      expect(hg.sampleStorage.relativeDir).not.toBe(hf.sampleStorage.relativeDir)
      expect(nodeFs.existsSync(path.resolve(userDataDir, hg.sampleStorage.relativeDir))).toBe(true)
      expect(nodeFs.existsSync(path.resolve(userDataDir, hf.sampleStorage.relativeDir))).toBe(true)
    })

    it('未传 providerId ⇒ 回落默认（不因缺参把 registry 键写成 undefined）', async () => {
      const store = createStore()
      const service = createService({ store, userDataPath: userDataDir })
      await service.createClone({ name: 'x', type: 'photo', media: imageMedia() })

      const registry = store.getValue(OWNER_A, `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`)
      expect(registry.avatars).toHaveLength(1)
      expect(store.getValue(OWNER_A, `avatar-clones:v1:undefined:${ownerHash(OWNER_A)}`)).toBeUndefined()
    })

    it('老 3 段样本目录仍判合法（升级前已克隆的用户不被误标「素材已缺失」）', async () => {
      const store = createStore()
      const service = createService({ store, userDataPath: userDataDir })
      const legacyDir = `avatar-clone-samples/${ownerHash(OWNER_A)}/legacy-storage`
      store.setUserSetting(
        `avatar-clones:v1:heygen:${ownerHash(OWNER_A)}`,
        {
          version: 1,
          ownerHash: ownerHash(OWNER_A),
          avatars: [{
            id: 'av-legacy',
            name: '老形象',
            source: 'user_clone',
            sourceKind: 'self',
            mediaType: 'image',
            trainingState: 'completed',
            deletionState: 'active',
            createdAt: Date.now(),
            auditSeq: 1,
            attestation: { acknowledgedAt: Date.now() },
            sampleStorage: { relativeDir: legacyDir, sampleCount: 1, mediaType: 'image' },
          }],
        },
        OWNER_A
      )

      const result = await service.listClones()
      expect(result.code).toBe(0)
      expect(result.data.avatars[0].invalidReason).toBeUndefined()
    })
  })

  // ── 重命名 ─────────────────────────────────────────────────────────

  describe('重命名', () => {
    it('只改本地 registry，不动远端', async () => {
      const store = createStore()
      const callSpy = vi.fn(async () => ({ code: 0, data: null }))
      const manager = createManager({ deleteAvatar: callSpy })
      const service = createService({ store, manager, userDataPath: userDataDir })
      await service.createClone({ name: '旧名', type: 'photo', media: imageMedia() })

      const result = await service.renameClone({ avatarId: 'av-1', name: '新名' })
      expect(result.data.avatar.name).toBe('新名')
      // 重命名不得触发任何远端调用
      expect(callSpy).not.toHaveBeenCalled()
      expect(manager.callAdapter).toHaveBeenCalledTimes(1)
    })
  })

  // ── change: avatar-voice-clone-bundled：声音与形象绑在同一家 provider ──

  describe('配套声音（bundled voice）', () => {
    it('传 voice ⇒ 同一 provider 下先后调 createAvatar 与 cloneVoice', async () => {
      const store = createStore()
      const manager = createManager({
        createAvatar: () => ({ code: 0, data: { id: 'av-1' } }),
        cloneVoice: () => ({ code: 0, data: { voice_id: 'vc-1' } }),
      })
      const service = createService({ store, manager, userDataPath: userDataDir })

      const result = await service.createClone({
        name: '完整克隆', type: 'photo', media: imageMedia(), voice: audioMedia(), providerId: 'hifly',
      })

      expect(result.code).toBe(0)
      const avCall = manager.callAdapter.mock.calls.find((c) => c[1] === 'createAvatar')
      const vcCall = manager.callAdapter.mock.calls.find((c) => c[1] === 'cloneVoice')
      expect(avCall[0]).toBe('hifly')
      expect(vcCall[0]).toBe('hifly')
      expect(result.data.avatar.voiceId).toBe('vc-1')
    })

    it('声音失败 ⇒ 补偿删已建成的形象，且不写 registry（不留半截克隆）', async () => {
      const store = createStore()
      const manager = createManager({
        createAvatar: () => ({ code: 0, data: { id: 'av-1' } }),
        cloneVoice: () => ({ code: -1, message: 'VOICE_CLONE_LIMIT' }),
      })
      const service = createService({ store, manager, userDataPath: userDataDir })

      const result = await service.createClone({
        name: '半截', type: 'photo', media: imageMedia(), voice: audioMedia(), providerId: 'hifly',
      })

      expect(result.code).toBe(-1)
      expect(result.message).toBe('AVATAR_CLONE_VOICE_FAILED')
      const delCall = manager.callAdapter.mock.calls.find((c) => c[1] === 'deleteAvatar')
      expect(delCall).toBeDefined()
      expect(delCall[2]).toMatchObject({ avatarId: 'av-1' })
      // registry 不得留下条目
      const registry = store.getValue('user-a', 'avatar-clones:v1:hifly:' + ownerHash('user-a'))
      expect(registry).toBeUndefined()
    })

    it('不传 voice ⇒ 只建形象，registry 条目无 voiceId 字段', async () => {
      const store = createStore()
      const manager = createManager({ createAvatar: () => ({ code: 0, data: { id: 'av-1' } }) })
      const service = createService({ store, manager, userDataPath: userDataDir })

      const result = await service.createClone({ name: '只要形象', type: 'photo', media: imageMedia(), providerId: 'hifly' })

      expect(result.code).toBe(0)
      expect(manager.callAdapter.mock.calls.some((c) => c[1] === 'cloneVoice')).toBe(false)
      expect('voiceId' in result.data.avatar).toBe(false)
    })

    it('voice 扩展名不在白名单 ⇒ 整个请求被拒', async () => {
      const service = createService({ userDataPath: userDataDir })
      const result = await service.createClone({
        name: 'x', type: 'photo', media: imageMedia(), voice: { blob: createBlob('txt', 'text/plain'), fileName: 'a.txt' },
      })
      expect(result.message).toBe('AVATAR_CLONE_INVALID_ARGUMENTS')
    })

    it('删除带 voiceId 的条目 ⇒ 连带删声音', async () => {
      const store = createStore()
      const manager = createManager({
        createAvatar: () => ({ code: 0, data: { id: 'av-1' } }),
        cloneVoice: () => ({ code: 0, data: { voice_id: 'vc-1' } }),
      })
      const service = createService({ store, manager, userDataPath: userDataDir })
      await service.createClone({
        name: '完整', type: 'photo', media: imageMedia(), voice: audioMedia(), providerId: 'hifly',
      })

      await service.deleteClone({ avatarId: 'av-1', providerId: 'hifly' })

      const dels = manager.callAdapter.mock.calls.filter((c) => c[1] === 'deleteAvatar')
      expect(dels.some((c) => c[2].avatarId === 'av-1')).toBe(true)
      expect(dels.some((c) => c[2].avatarId === 'vc-1')).toBe(true)
    })
  })
})

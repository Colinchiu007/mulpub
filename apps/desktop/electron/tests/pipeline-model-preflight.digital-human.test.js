// @ts-check
/**
 * pipeline-model-preflight.digital-human.test.js — 数字人流水线启动前校验
 *
 * 锁定 PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19 §4.2：
 *  - avatarId / voiceId 缺失在**启动前**被拦（不创建 run、不消耗 LLM 调用）
 *  - 「配了通用视频模型」不再被误判为「数字人可用」（原假阳性）
 *  - 校验顺序：参数先于 provider
 */

import { describe, it, expect, vi } from 'vitest'
const {
  checkPipelineModelRequirements,
  checkDigitalHumanRequirements,
  PIPELINE_MODEL_REQUIREMENTS_MISSING,
  AVATAR_ID_REQUIRED,
  AVATAR_VOICE_REQUIRED,
} = require('../services/pipeline-model-preflight')

const noopLog = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }

function makeManager ({ defaults = {}, providers = {} } = {}) {
  return {
    _ready: true,
    getDefault: vi.fn((capability) => (defaults[capability] ? { id: 'default-' + capability, category: capability } : null)),
    getProviderWithKey: vi.fn((id) => {
      if (!providers[id]) return null
      return { id, base_url: providers[id].base_url || '', api_key: providers[id].api_key || '' }
    }),
  }
}

/** 一切齐备：LLM 默认可用 + HeyGen 已配 Key */
function readyManager () {
  return makeManager({
    defaults: { llm: true },
    providers: { heygen: { api_key: 'hg-key-xxx' } },
  })
}

describe('数字人流水线启动前校验', () => {
  it('三要素齐备（avatarId + voiceId + HeyGen 已配）→ 放行', () => {
    const result = checkPipelineModelRequirements(
      readyManager(), 'avatar-spokesperson',
      { avatarId: 'ava-1', voiceId: 'voice-1' }, noopLog,
    )
    expect(result.success).toBe(true)
  })

  describe('参数缺失在启动前拦截', () => {
    it('缺 avatarId → AVATAR_ID_REQUIRED', () => {
      const result = checkPipelineModelRequirements(
        readyManager(), 'avatar-spokesperson', { voiceId: 'voice-1' }, noopLog,
      )
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(AVATAR_ID_REQUIRED)
      expect(result.error).toContain('数字人形象')
    })

    it('缺 voiceId → AVATAR_VOICE_REQUIRED', () => {
      const result = checkPipelineModelRequirements(
        readyManager(), 'avatar-spokesperson', { avatarId: 'ava-1' }, noopLog,
      )
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(AVATAR_VOICE_REQUIRED)
      expect(result.error).toContain('音色')
    })

    it('两者都缺 → 先报 avatarId（可即时修正的排前面）', () => {
      const result = checkPipelineModelRequirements(
        readyManager(), 'avatar-spokesperson', {}, noopLog,
      )
      expect(result.errorCode).toBe(AVATAR_ID_REQUIRED)
    })

    const blankCases = [
      ['空字符串', ''],
      ['纯空格', '   '],
      ['超长', 'a'.repeat(300)],
      ['非字符串', 123],
    ]
    for (const [label, avatarId] of blankCases) {
      it(`avatarId ${label} → 视为缺失`, () => {
        const result = checkPipelineModelRequirements(
          readyManager(), 'avatar-spokesperson', { avatarId, voiceId: 'voice-1' }, noopLog,
        )
        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(AVATAR_ID_REQUIRED)
      })
    }
  })

  describe('假阳性修复：通用视频模型 ≠ 数字人可用', () => {
    it('★ 只配了 Kling（通用视频）未配 HeyGen → 拦截', () => {
      const manager = makeManager({
        defaults: { llm: true, video: true }, // 通用视频模型可用
        providers: { kling: { api_key: 'kling-key' } }, // 但 HeyGen 没配
      })
      const result = checkPipelineModelRequirements(
        manager, 'avatar-spokesperson', { avatarId: 'ava-1', voiceId: 'voice-1' }, noopLog,
      )
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(PIPELINE_MODEL_REQUIREMENTS_MISSING)
      expect(result.error).toContain('HeyGen')
    })

    it('HeyGen 已配但无 API Key → 拦截', () => {
      const manager = makeManager({
        defaults: { llm: true },
        providers: { heygen: { api_key: '' } },
      })
      const result = checkPipelineModelRequirements(
        manager, 'avatar-spokesperson', { avatarId: 'ava-1', voiceId: 'voice-1' }, noopLog,
      )
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(PIPELINE_MODEL_REQUIREMENTS_MISSING)
    })

    it('显式 videoProvider 指向其他已配 provider 时按其校验', () => {
      const manager = makeManager({
        defaults: { llm: true },
        providers: { 'other-dh': { api_key: 'ok' } },
      })
      const result = checkPipelineModelRequirements(
        manager, 'avatar-spokesperson',
        { avatarId: 'ava-1', voiceId: 'voice-1', videoProvider: 'other-dh' }, noopLog,
      )
      expect(result.success).toBe(true)
    })
  })

  describe('不影响其它流水线', () => {
    it('animation 仍走通用 llm+video 校验，不要求 avatarId', () => {
      const manager = makeManager({ defaults: { llm: true, video: true } })
      const result = checkPipelineModelRequirements(manager, 'animation', {}, noopLog)
      expect(result.success).toBe(true)
    })

    it('animation 缺 video 仍按原样拦截（errorCode 不变）', () => {
      const manager = makeManager({ defaults: { llm: true } })
      const result = checkPipelineModelRequirements(manager, 'animation', {}, noopLog)
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(PIPELINE_MODEL_REQUIREMENTS_MISSING)
      expect(result.errorParams.missing).toEqual(['video'])
    })

    it('manager 不可用时数字人校验也 fail-open（不误报）', () => {
      const result = checkPipelineModelRequirements(null, 'avatar-spokesperson', { avatarId: 'a', voiceId: 'v' }, noopLog)
      expect(result.success).toBe(true)
      expect(result.checked).toBe(false)
    })
  })

  describe('checkDigitalHumanRequirements 独立入口', () => {
    it('可直接单测，不依赖 manager 就绪判定', () => {
      expect(checkDigitalHumanRequirements(readyManager(), { avatarId: 'a', voiceId: 'v' }).success).toBe(true)
      expect(checkDigitalHumanRequirements(readyManager(), { avatarId: 'a' }).errorCode).toBe(AVATAR_VOICE_REQUIRED)
    })
  })

  // ── 克隆产物失效（change: avatar-voice-clone）────────────────────────
  //
  // 克隆形象/声音与公共目录同形同键（都是 HeyGen 的 look_id / voice_id），
  // 所以三要素来源无需扩展；但克隆产物有公共目录没有的失效态
  // （training_failed / 远端已不存在），必须在启动前拦下，
  // 而不是等 generate 阶段跑到网络层才炸。
  //
  // 刻意用**同步**探子：启动路径是同步的（checkPipelineModelRequirements），
  // 且生命周期设计是「本地 registry 为权威」——失效标记在列表时已写好，
  // 无需在启动前再查一次远端。
  describe('克隆产物失效在启动前拦截', () => {
    const CLONE_AVATAR_UNAVAILABLE = 'AVATAR_CLONE_UNAVAILABLE'

    function managerWithClones (avatars = []) {
      const base = readyManager()
      base.listAvatarClonesSync = vi.fn(() => ({ code: 0, data: { avatars } }))
      return base
    }

    it('training_failed 的克隆形象 → AVATAR_CLONE_UNAVAILABLE', () => {
      const manager = managerWithClones([
        { id: 'av-bad', trainingState: 'failed', invalidReason: 'training_failed' },
      ])
      const result = checkPipelineModelRequirements(
        manager, 'avatar-spokesperson', { avatarId: 'av-bad', voiceId: 'voice-1' }, noopLog,
      )
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(CLONE_AVATAR_UNAVAILABLE)
      expect(result.error).toContain('克隆')
    })

    it('远端已失效的克隆形象 → AVATAR_CLONE_UNAVAILABLE', () => {
      const manager = managerWithClones([
        { id: 'av-gone', trainingState: 'completed', invalidReason: 'sample_storage_missing' },
      ])
      const result = checkPipelineModelRequirements(
        manager, 'avatar-spokesperson', { avatarId: 'av-gone', voiceId: 'voice-1' }, noopLog,
      )
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(CLONE_AVATAR_UNAVAILABLE)
    })

    it('公共目录形象不受影响（id 不在克隆 registry 里）', () => {
      const manager = managerWithClones([{ id: 'av-ok', trainingState: 'completed' }])
      const result = checkPipelineModelRequirements(
        manager, 'avatar-spokesperson', { avatarId: 'public-ava', voiceId: 'voice-1' }, noopLog,
      )
      expect(result.success).toBe(true)
    })

    it('manager 不提供克隆探子时 fail-open（不影响未装克隆功能的构建）', () => {
      const manager = readyManager()
      const result = checkPipelineModelRequirements(
        manager, 'avatar-spokesperson', { avatarId: 'av-any', voiceId: 'voice-1' }, noopLog,
      )
      expect(result.success).toBe(true)
    })
  })
})

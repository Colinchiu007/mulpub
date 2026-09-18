// @ts-check
/**
 * CreateView 模块级纯函数/常量单元测试（createview-split 拆分第一批）
 *
 * 覆盖：pipeline stage/snapshot 归一化与合并、S2V 配置快照字段挑选、
 * 历史请求超时竞速、枚举恢复白名单。
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeProgressPercent,
  normalizePipelineStage,
  normalizePipelineStages,
  pipelineStageKey,
  mergePipelineStages,
  normalizePipelineRunMeta,
  createPipelineRunMeta,
  cloneJsonValue,
  pickS2VConfigProfileFields,
  pickS2VOutputProfileFields,
  settleHistoryRequest,
  IMPLEMENTED_PIPELINES,
  S2V_CONFIG_PROFILE_FIELDS,
  AUTO_PIPELINE_STAGES,
} from './create-view-module-utils'

describe('create-view-module-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizeProgressPercent：钳位 0-100，非有限数回退', () => {
    expect(normalizeProgressPercent(50)).toBe(50)
    expect(normalizeProgressPercent(-5)).toBe(0)
    expect(normalizeProgressPercent(150)).toBe(100)
    expect(normalizeProgressPercent('42.4')).toBe(42)
    expect(normalizeProgressPercent('abc', 7)).toBe(7)
    expect(normalizeProgressPercent(null)).toBe(0) // Number(null)=0 → 钳位 0
  })

  it('normalizePipelineStage：name 回退 stage 字段，非法 status 拒绝，progress 钳位', () => {
    expect(normalizePipelineStage(null)).toBeNull()
    expect(normalizePipelineStage({ name: '  转写  ', status: 'running', progress: { percent: 140 } }))
      .toEqual({ name: '转写', status: 'running', progress: { percent: 100 } })
    expect(normalizePipelineStage({ stage: 'compose', status: 'pending' }).name).toBe('compose')
    expect(normalizePipelineStage({ name: 'x', status: 'bogus' })).toBeNull()
  })

  it('mergePipelineStages：进度事件只带活动阶段时保留上次完整快照', () => {
    const previous = [
      { id: 'a', name: 'A', status: 'completed' },
      { id: 'b', name: 'B', status: 'pending' },
    ]
    // incoming 更短（progress-only）：按 key 合并回 previous
    const merged = mergePipelineStages(previous, [{ id: 'b', status: 'running', progress: { percent: 30 } }])
    expect(merged).toHaveLength(2)
    expect(merged[0].status).toBe('completed')
    expect(merged[1].status).toBe('running')
    expect(merged[1].progress.percent).toBe(30)
    // incoming 更长：以 incoming 为主骨架，保留 previous 进度字段
    const merged2 = mergePipelineStages([{ id: 'a', progress: { percent: 100 } }], [
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'pending' },
    ])
    expect(merged2[0].progress.percent).toBe(100)
    expect(merged2[1].status).toBe('pending')
    // 非数组 incoming → previous 原样
    expect(mergePipelineStages(previous, null)).toEqual(previous)
  })

  it('pipelineStageKey：id > name > stage > index 优先级', () => {
    expect(pipelineStageKey({ id: 'x', name: 'n' }, 0)).toBe('x')
    expect(pipelineStageKey({ name: 'n', stage: 's' }, 0)).toBe('n')
    expect(pipelineStageKey({ stage: 's' }, 0)).toBe('s')
    expect(pipelineStageKey(null, 3)).toBe('3')
  })

  it('normalizePipelineRunMeta：非法 snapshot → null，字段缺省回退', () => {
    expect(normalizePipelineRunMeta(null)).toEqual({ valid: false, value: null })
    expect(normalizePipelineRunMeta({ status: 'running', started_at: '2026-09-18T00:00:00Z' })).toBeTruthy()
    // 对象输入（即便 status 为空串）：返回 valid=true 的字段提取结果（status 校验在调用方）
    expect(normalizePipelineRunMeta({ status: '   ' }).valid).toBe(true)
  })

  it('createPipelineRunMeta：生成带 createdAt 的合法 meta', () => {
    const meta = createPipelineRunMeta('2026-01-01T00:00:00Z')
    expect(meta).toBeTruthy()
    expect(meta.createdAt).toBe('2026-01-01T00:00:00Z')
  })

  it('pickS2VConfigProfileFields：白名单字段深拷贝，对象字段按 allowedKeys 挑选', () => {
    const source = {
      contentType: 'general',
      watermarkConfig: { enabled: true, position: 'br', rogue: 'x' },
      localMediaPath: '/should/not/leak',
      __proto__: {},
    }
    const picked = pickS2VConfigProfileFields(source)
    expect(picked.contentType).toBe('general')
    expect(picked.watermarkConfig).toEqual({ enabled: true, position: 'br' })
    expect(picked.localMediaPath).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(picked, '__proto__')).toBe(false)
    // 非对象输入：标量字段跳过，OBJECT_FIELDS 仍写默认 picked
    expect(pickS2VConfigProfileFields(null).contentType).toBeUndefined()
    expect(pickS2VConfigProfileFields(null).watermarkConfig).toBeUndefined() // OBJECT_FIELDS 仅在输入有值时写入
    expect(pickS2VConfigProfileFields([1, 2]).subtitleStyle).toBeUndefined()
  })

  it('pickS2VOutputProfileFields：仅挑 resolution/fps/format', () => {
    const picked = pickS2VOutputProfileFields({ resolution: '1920x1080', fps: 30, format: 'mp4', extra: 1 })
    expect(picked).toEqual({ resolution: '1920x1080', fps: 30, format: 'mp4' })
  })

  it('cloneJsonValue：深拷贝，循环引用返回 undefined 不抛', () => {
    const obj = { a: 1 }
    expect(cloneJsonValue(obj)).toEqual({ a: 1 })
    expect(cloneJsonValue(obj)).not.toBe(obj)
    const circular = {}
    circular.self = circular
    expect(cloneJsonValue(circular)).toBeUndefined()
  })

  it('settleHistoryRequest：正常解析走 race，超时拒绝带 HISTORY_LOAD_TIMEOUT', async () => {
    const ok = await settleHistoryRequest(async () => 'done')
    expect(ok).toBe('done')
    await expect(settleHistoryRequest(() => new Promise(() => {}))).rejects.toMatchObject({ code: 'HISTORY_LOAD_TIMEOUT' })
  }, 10000)

  it('常量导出完整性：流水线白名单与自动阶段映射', () => {
    expect(IMPLEMENTED_PIPELINES).toContain('story2video-compose')
    expect(S2V_CONFIG_PROFILE_FIELDS.length).toBeGreaterThan(30)
    expect(AUTO_PIPELINE_STAGES['framework-smoke']).toEqual(['verify', 'report'])
  })
})

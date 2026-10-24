// @ts-check
/**
 * agnes-video-models.test.js — Agnes 视频模型能力描述（单一真源）
 *
 * 覆盖：
 * - 两个已知模型的能力边界（尺寸档位 / 素材上限 / 参考视频支持）
 * - 未知模型**保守回落**（fail-closed）
 * - 输出像素映射（Flash 的 16:9 是 1280x704，与标准 2.5 的 1280x720 不同）
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'

const {
  AGNES_VIDEO_MODELS, describeVideoModel, isKnownVideoModel, listVideoModels, outputPixelsFor, estimateVideoCost,
} = require('./agnes-video-models')

describe('Agnes 视频模型能力描述', () => {
  it('Flash：固定 720P、参考图 ≤5、参考音频 ≤3、不支持参考视频', () => {
    const spec = describeVideoModel('agnes-video-2.5-flash')
    expect(spec.sizes).toEqual(['720P'])
    expect(spec.defaultSize).toBe('720P')
    expect(spec.maxImages).toBe(5)
    expect(spec.maxAudios).toBe(3)
    expect(spec.maxVideos).toBe(0)
    expect(spec.supportsReferenceVideo).toBe(false)
  })

  it('标准 2.5：四档分辨率、参考图 ≤8、支持参考视频（≤1）', () => {
    const spec = describeVideoModel('agnes-video-2.5')
    expect(spec.sizes).toEqual(['720P', '1080P', '1K', '2K'])
    expect(spec.maxImages).toBe(8)
    expect(spec.maxAudios).toBe(3)
    expect(spec.maxVideos).toBe(1)
    expect(spec.supportsReferenceVideo).toBe(true)
  })

  it('未知模型保守回落：最严能力集（不放大限制）', () => {
    const spec = describeVideoModel('some-unknown-model')
    expect(spec.sizes).toEqual(['720P'])
    expect(spec.maxImages).toBe(5)
    expect(spec.maxAudios).toBe(3)
    expect(spec.maxVideos).toBe(0)
    expect(spec.supportsReferenceVideo).toBe(false)
    expect(isKnownVideoModel('some-unknown-model')).toBe(false)
  })

  it('空/非字符串模型 ID 同样保守回落，不抛异常', () => {
    expect(describeVideoModel('').maxImages).toBe(5)
    expect(describeVideoModel(null).maxImages).toBe(5)
    expect(describeVideoModel(undefined).supportsReferenceVideo).toBe(false)
  })

  it('listVideoModels 列出两个已知模型', () => {
    const list = listVideoModels()
    expect(list.map((m) => m.id)).toEqual(['agnes-video-2.5-flash', 'agnes-video-2.5'])
  })

  it('输出像素：Flash 的 16:9 是 1280x704（不是 1280x720）', () => {
    expect(outputPixelsFor('agnes-video-2.5-flash', '720P', '16:9')).toBe('1280x704')
    expect(outputPixelsFor('agnes-video-2.5', '720P', '16:9')).toBe('1280x704')
    expect(outputPixelsFor('agnes-video-2.5', '1080P', '16:9')).toBe('1920x1080')
    expect(outputPixelsFor('agnes-video-2.5', '1K', '16:9')).toBe('1024x1024')
    expect(outputPixelsFor('agnes-video-2.5-flash', '720P', '9:16')).toBe('720x1280')
  })

  it('不支持的档位/画幅回落到默认档位与 16:9', () => {
    expect(outputPixelsFor('agnes-video-2.5-flash', '2K', '16:9')).toBe('1280x704')
    expect(outputPixelsFor('agnes-video-2.5-flash', '720P', 'auto')).toBe('1280x704')
  })

  it('成本估算：输出秒数 × 档位单价；参考视频秒数**相加**计费', () => {
    // Flash 限时免费
    expect(estimateVideoCost('agnes-video-2.5-flash', { seconds: 8 }).amount).toBe(0)
    expect(estimateVideoCost('agnes-video-2.5-flash', { seconds: 8 }).free).toBe(true)
    // 标准 2.5：8 秒 × ¥0.15 = ¥1.20
    const plain = estimateVideoCost('agnes-video-2.5', { seconds: 8 })
    expect(plain.amount).toBeCloseTo(1.2, 5)
    // 加一段 3 秒参考视频 ⇒ 11 秒 × ¥0.15 = ¥1.65（输入视频秒数与输出秒数相加）
    const withVideo = estimateVideoCost('agnes-video-2.5', { seconds: 8, inputVideoSeconds: 3 })
    expect(withVideo.amount).toBeCloseTo(1.65, 5)
    // 更高档位单价更高
    expect(estimateVideoCost('agnes-video-2.5', { seconds: 8, size: '2K' }).amount)
      .toBeGreaterThan(plain.amount)
  })

  it('能力描述对象被冻结，调用方无法就地改写', () => {
    const spec = AGNES_VIDEO_MODELS['agnes-video-2.5-flash']
    expect(Object.isFrozen(spec)).toBe(true)
    expect(Object.isFrozen(spec.sizes)).toBe(true)
  })
})

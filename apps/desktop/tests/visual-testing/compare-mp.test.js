import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'

const {
  compareImages,
  normalizeTarget,
} = require('./scripts/compare-mp')

function image (width, height, rgba = [255, 255, 255, 255]) {
  const png = new PNG({ width, height })
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data.set(rgba, offset)
  }
  return png
}

function setPixel (png, x, y, rgba) {
  const offset = (y * png.width + x) * 4
  png.data.set(rgba, offset)
}

describe('参考产品真实截图比较合同', () => {
  it('允许从不同原图裁出同尺寸主内容区域后比较', () => {
    const reference = image(5, 5)
    const current = image(7, 6, [0, 0, 0, 255])
    for (let y = 2; y < 5; y += 1) {
      for (let x = 3; x < 6; x += 1) setPixel(current, x, y, [255, 255, 255, 255])
    }

    const result = compareImages(reference, current, {
      referenceCrop: { x: 1, y: 1, width: 3, height: 3 },
      currentCrop: { x: 3, y: 2, width: 3, height: 3 },
      mismatchThreshold: 0,
      pixelThreshold: 0.1,
    })

    expect(result.status).toBe('PASS')
    expect(result.dimensions).toEqual({ reference: [3, 3], current: [3, 3] })
    expect(result.referenceCrop).toEqual({ x: 1, y: 1, width: 3, height: 3 })
    expect(result.currentCrop).toEqual({ x: 3, y: 2, width: 3, height: 3 })
  })

  it('裁剪区域越界时阻断审计并返回明确状态', () => {
    const result = compareImages(image(4, 4), image(4, 4), {
      referenceCrop: { x: 2, y: 2, width: 3, height: 3 },
      mismatchThreshold: 0,
      pixelThreshold: 0.1,
    })

    expect(result).toMatchObject({ status: 'CROP_INVALID', blocked: true, passed: false })
    expect(result.reason).toContain('referenceCrop')
  })

  it('裁剪后尺寸不一致时阻断，避免比较错位页面', () => {
    const result = compareImages(image(5, 5), image(5, 5), {
      referenceCrop: { x: 0, y: 0, width: 3, height: 3 },
      currentCrop: { x: 0, y: 0, width: 4, height: 3 },
      mismatchThreshold: 0,
      pixelThreshold: 0.1,
    })

    expect(result.status).toBe('CROP_DIMENSION_MISMATCH')
    expect(result.blocked).toBe(true)
  })

  it('对称忽略动态区域且从有效像素分母中排除', () => {
    const reference = image(3, 1)
    const current = image(3, 1)
    setPixel(current, 1, 0, [0, 0, 0, 255])

    const masked = compareImages(reference, current, {
      ignoreRegions: [{ x: 1, y: 0, width: 1, height: 1 }],
      mismatchThreshold: 0,
      pixelThreshold: 0.1,
    })
    const unmasked = compareImages(reference, current, {
      mismatchThreshold: 0,
      pixelThreshold: 0.1,
    })

    expect(masked).toMatchObject({ status: 'PASS', mismatchPixels: 0, maskedPixels: 1, effectivePixels: 2 })
    expect(unmasked.status).toBe('FAIL')
  })

  it('manifest 拒绝小数、负坐标和零尺寸矩形', () => {
    const base = { name: 'accounts', reference: 'reference.png', current: 'current.png' }

    expect(() => normalizeTarget({ ...base, currentCrop: { x: 0.5, y: 0, width: 1, height: 1 } })).toThrow(/currentCrop/)
    expect(() => normalizeTarget({ ...base, referenceCrop: { x: -1, y: 0, width: 1, height: 1 } })).toThrow(/referenceCrop/)
    expect(() => normalizeTarget({ ...base, ignoreRegions: [{ x: 0, y: 0, width: 0, height: 1 }] })).toThrow(/ignoreRegions/)
  })
})

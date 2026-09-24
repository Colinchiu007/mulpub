// @ts-check
'use strict'
/**
 * film-engineering video-reference-inputs 契约测试（tasks 4.3：引擎侧消费 localReferences）
 * 覆盖：provider 参考输入能力探测（显式映射表、保守默认不支持）/
 *       localReferences 形状归一化（非法条目防御跳过）/
 *       参考文件解析（受控根内 + 魔数嗅探 → dataURL；越界/缺失/超限/非图像降级 warning）/
 *       一镜多参考 v1 取首个有效（首帧语义）
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  VIDEO_REFERENCE_PARAM_BY_PROVIDER,
  supportsVideoReferenceInput,
  normalizeLocalReferences,
  resolveShotReferenceInput,
} = require('./video-reference-inputs')

// 1x1 透明 PNG（真实魔数内容，走嗅探正路）
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 受控媒体根（tests 专用 tmp 目录，模拟 reference-store 落盘根） */
function makeMediaRoot (name) {
  const root = path.join(fs.realpathSync(os.tmpdir()), 'film-ref-inputs-test-' + name)
  fs.mkdirSync(path.join(root, 'references'), { recursive: true })
  return root
}

/** 在 <root>/references 下写一张测试参考图，返回绝对路径 */
function writeRef (root, fileName, content) {
  const p = path.join(root, 'references', fileName)
  fs.writeFileSync(p, content)
  return p
}

describe('supportsVideoReferenceInput - 能力探测', () => {
  it('显式映射表内的 provider 支持，且参数名与 adapter 形状一致', () => {
    expect(supportsVideoReferenceInput('minimax')).toBe(true)
    expect(VIDEO_REFERENCE_PARAM_BY_PROVIDER.minimax).toBe('firstFrameImage')
    expect(supportsVideoReferenceInput('agnes-video')).toBe(true)
    expect(VIDEO_REFERENCE_PARAM_BY_PROVIDER['agnes-video']).toBe('image')
    expect(supportsVideoReferenceInput('agnes-multimodal')).toBe(true)
  })

  it('未列入映射表一律保守视为不支持（含 mock/未知 id/非法入参）', () => {
    expect(supportsVideoReferenceInput('mock-video')).toBe(false)
    expect(supportsVideoReferenceInput('seedance')).toBe(false)
    expect(supportsVideoReferenceInput('some-future-provider')).toBe(false)
    expect(supportsVideoReferenceInput('')).toBe(false)
    expect(supportsVideoReferenceInput(null)).toBe(false)
    expect(supportsVideoReferenceInput(undefined)).toBe(false)
  })
})

describe('normalizeLocalReferences - 形状归一化', () => {
  it('合法负载 → Map<shotId, paths[]>，仅收非空字符串路径', () => {
    const m = normalizeLocalReferences([
      { shotId: 's1', paths: ['/r/a.png', '/r/b.jpg'] },
      { shotId: 's2', paths: ['/r/c.png', '', 42, null] },
    ])
    expect(m instanceof Map).toBe(true)
    expect(m.get('s1')).toEqual(['/r/a.png', '/r/b.jpg'])
    expect(m.get('s2')).toEqual(['/r/c.png'])
  })

  it('非法条目防御跳过，不抛异常；全非法/空输入 → 空 Map', () => {
    const m = normalizeLocalReferences([
      null,
      'not-an-object',
      { shotId: '', paths: ['/r/a.png'] },
      { shotId: 's3', paths: 'oops' },
      { paths: ['/r/d.png'] },
    ])
    expect(m.size).toBe(0)
    expect(normalizeLocalReferences(null).size).toBe(0)
    expect(normalizeLocalReferences(undefined).size).toBe(0)
    expect(normalizeLocalReferences('bad').size).toBe(0)
    expect(normalizeLocalReferences([{ shotId: 's1', paths: [] }]).size).toBe(0)
  })
})

describe('resolveShotReferenceInput - 参考解析与降级', () => {
  it('无参考（Map 为空/无该 shotId）→ 无注入且无 warning（向后兼容静默）', () => {
    const root = makeMediaRoot('silent')
    const empty = new Map()
    let r = resolveShotReferenceInput({ providerId: 'minimax', refMap: empty, shotId: 's1', mediaRoot: root })
    expect(r.refParam).toBeUndefined()
    expect(r.warning).toBeUndefined()
    r = resolveShotReferenceInput({ providerId: 'minimax', refMap: new Map([['s2', ['/x.png']]]), shotId: 's1', mediaRoot: root })
    expect(r.refParam).toBeUndefined()
    expect(r.warning).toBeUndefined()
  })

  it('provider 不支持参考输入但有连线 → 降级 warning（不静默失败、不阻断出片）', () => {
    const root = makeMediaRoot('unsupported')
    const p = writeRef(root, 'ref-a.png', PNG_1x1)
    const refMap = new Map([['s1', [p]]])
    const r = resolveShotReferenceInput({ providerId: 'mock-video', refMap, shotId: 's1', mediaRoot: root })
    expect(r.refParam).toBeUndefined()
    expect(r.warning).toBeTruthy()
    expect(r.warning.shotId).toBe('s1')
    expect(r.warning.reason).toContain('mock-video')
  })

  it('受控根内 PNG → 参数名按映射表注入 dataURL（首帧语义）', () => {
    const root = makeMediaRoot('png')
    const p = writeRef(root, 'ref-b.png', PNG_1x1)
    const refMap = new Map([['s1', [p]]])
    const r = resolveShotReferenceInput({ providerId: 'minimax', refMap, shotId: 's1', mediaRoot: root })
    expect(r.warning).toBeUndefined()
    expect(Object.keys(r.refParam)).toEqual(['firstFrameImage'])
    expect(r.refParam.firstFrameImage).toBe('data:image/png;base64,' + PNG_1x1.toString('base64'))
    expect(r.usedPath).toBe(p)
    // agnes-video 映射到 image 参数名
    const r2 = resolveShotReferenceInput({ providerId: 'agnes-video', refMap, shotId: 's1', mediaRoot: root })
    expect(r2.refParam.image).toContain('data:image/png;base64,')
  })

  it('一镜多参考 v1 取首个有效：首参考越界 → 跳过并 warning，改用次参考', () => {
    const root = makeMediaRoot('multi')
    const good = writeRef(root, 'ref-good.png', PNG_1x1)
    const refMap = new Map([['s1', [path.join(fs.realpathSync(os.tmpdir()), 'elsewhere.png'), good]]])
    const r = resolveShotReferenceInput({ providerId: 'minimax', refMap, shotId: 's1', mediaRoot: root })
    expect(r.usedPath).toBe(good)
    expect(r.warning).toBeTruthy()
    expect(r.warning.shotId).toBe('s1')
    expect(r.refParam.firstFrameImage).toContain('data:image/png;base64,')
  })

  it('全部参考无效（不存在/越界/非图像魔数）→ 不注入但 warning 汇总，绝不抛异常', () => {
    const root = makeMediaRoot('invalid')
    const missing = path.join(root, 'references', 'ref-missing.png')
    const outside = path.join(fs.realpathSync(os.tmpdir()), 'film-ref-outside-evil.png')
    fs.writeFileSync(outside, PNG_1x1)
    const notImage = writeRef(root, 'ref-txt.png', Buffer.from('hello world, not an image at all'))
    const fakeExt = writeRef(root, 'ref-fake.png', Buffer.alloc(512 * 1024, 0x41))
    // 体积上限（MAX_REF_BYTES）在 reference-store 落盘时已拦，读取侧再兜底一次；
    // 此处以 ext 合法但魔数不符的文件覆盖嗅探拒绝路径。
    const refMap = new Map([['s1', [missing, outside, notImage, fakeExt]]])
    const r = resolveShotReferenceInput({ providerId: 'minimax', refMap, shotId: 's1', mediaRoot: root })
    expect(r.refParam).toBeUndefined()
    expect(r.warning).toBeTruthy()
    expect(r.warning.reason.length).toBeGreaterThan(0)
    // 越界文件不得出现在任何 warning 允许读取的路径解析结果中（仅报告，不读取内容）
    expect(r.warning.reason).toContain('outside-media-root')
    fs.unlinkSync(outside)
  })

  it('mediaRoot 未配置 → 有连线时 warning，不注入', () => {
    const refMap = new Map([['s1', ['/r/a.png']]])
    const r = resolveShotReferenceInput({ providerId: 'minimax', refMap, shotId: 's1', mediaRoot: '' })
    expect(r.refParam).toBeUndefined()
    expect(r.warning).toBeTruthy()
  })
})

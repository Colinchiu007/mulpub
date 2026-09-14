import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'

const {
  compareTarget,
  loadManifest,
  parseCliArgs,
  renderMarkdown,
  runAudit,
} = require('../../tests/visual-testing/scripts/compare-mp')

function writePng(filePath, color = [255, 255, 255, 255], width = 2, height = 2) {
  const image = new PNG({ width, height })
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = color[0]
    image.data[offset + 1] = color[1]
    image.data[offset + 2] = color[2]
    image.data[offset + 3] = color[3]
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, PNG.sync.write(image))
}

function createDirectoryLink(target, linkPath) {
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

function withTempRoot(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-pixel-audit-'))
  return Promise.resolve()
    .then(() => callback(root))
    .finally(() => fs.rmSync(root, { recursive: true, force: true }))
}

describe('参考产品真实基线像素审计', () => {
  it('相同尺寸且像素一致时通过并记录图片指纹', () => withTempRoot(async (root) => {
    writePng(path.join(root, 'reference.png'))
    writePng(path.join(root, 'current.png'))

    const result = await compareTarget({
      name: 'accounts',
      reference: 'reference.png',
      current: 'current.png',
    }, { root, diffDir: path.join(root, 'diff') })

    expect(result).toMatchObject({
      status: 'PASS',
      passed: true,
      blocked: false,
      dimensions: { reference: [2, 2], current: [2, 2] },
    })
    expect(result.referenceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.currentSha256).toBe(result.referenceSha256)
  }))

  it('缺少真实参考图时阻断，绝不伪造通过', () => withTempRoot(async (root) => {
    writePng(path.join(root, 'current.png'))

    const result = await compareTarget({
      name: 'publish',
      reference: 'captured/publish.png',
      current: 'current.png',
    }, { root })

    expect(result).toMatchObject({
      status: 'REFERENCE_UNVERIFIED',
      passed: false,
      blocked: true,
    })
    expect(result.reason).toMatch(/参考图不存在/)
    expect(result.reason).toContain('captured/publish.png')
    expect(result.reason).not.toContain(root)
  }))

  it('PENDING_REAL_CAPTURE 即使图片已存在也必须阻断', () => withTempRoot(async (root) => {
    writePng(path.join(root, 'reference.png'))
    writePng(path.join(root, 'current.png'))

    const report = await runAudit({
      root,
      referenceStatus: 'PENDING_REAL_CAPTURE',
      targets: [{ name: 'publish', reference: 'reference.png', current: 'current.png' }],
    })

    expect(report.results[0]).toMatchObject({
      status: 'REFERENCE_UNVERIFIED',
      passed: false,
      blocked: true,
    })
    expect(report.results[0].reason).toMatch(/PENDING_REAL_CAPTURE/)
  }))

  it('CAPTURED_VERIFIED 的程序化调用必须提供参考图指纹和尺寸', () => withTempRoot(async (root) => {
    writePng(path.join(root, 'reference.png'))
    writePng(path.join(root, 'current.png'))
    const target = { name: 'publish', reference: 'reference.png', current: 'current.png' }

    const result = await compareTarget(target, {
      root,
      referenceStatus: 'CAPTURED_VERIFIED',
    })

    expect(result).toMatchObject({ status: 'CONFIG_INVALID', blocked: true })
    expect(result.reason).toMatch(/referenceSha256/)
    await expect(runAudit({
      root,
      referenceStatus: 'CAPTURED_VERIFIED',
      targets: [target],
    })).rejects.toThrow(/referenceSha256/)
  }))

  it('尺寸不一致时阻断，并在汇总中保留阻断状态', () => withTempRoot(async (root) => {
    writePng(path.join(root, 'reference.png'), [255, 255, 255, 255], 2, 2)
    writePng(path.join(root, 'current.png'), [255, 255, 255, 255], 3, 2)

    const report = await runAudit({
      root,
      targets: [{ name: 'batch-publish', reference: 'reference.png', current: 'current.png' }],
    })

    expect(report.results[0]).toMatchObject({ status: 'DIMENSION_MISMATCH', blocked: true })
    expect(report.summary).toMatchObject({ total: 1, passed: 0, failed: 0, blocked: 1 })
  }))

  it('拒绝仓库外图片路径和危险的差异图名称', () => withTempRoot(async (root) => {
    writePng(path.join(root, 'reference.png'))
    writePng(path.join(root, 'current.png'), [0, 0, 0, 255])

    const outsideReference = await compareTarget({
      name: 'accounts',
      reference: '../outside.png',
      current: 'current.png',
    }, { root, diffDir: path.join(root, 'diff') })
    const unsafeName = await compareTarget({
      name: '../overwrite',
      reference: 'reference.png',
      current: 'current.png',
    }, { root, diffDir: path.join(root, 'diff') })

    expect(outsideReference).toMatchObject({ status: 'CONFIG_INVALID', blocked: true })
    expect(unsafeName).toMatchObject({ status: 'CONFIG_INVALID', blocked: true })
    expect(fs.existsSync(path.join(root, 'overwrite.png'))).toBe(false)
  }))

  it('拒绝借由符号链接访问仓库外图片或写入差异图', () => withTempRoot(async (root) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-pixel-audit-outside-'))
    try {
      writePng(path.join(root, 'reference.png'))
      writePng(path.join(root, 'current.png'), [0, 0, 0, 255])
      writePng(path.join(outside, 'reference.png'))
      createDirectoryLink(outside, path.join(root, 'outside-link'))

      const outsideReference = await compareTarget({
        name: 'accounts',
        reference: 'outside-link/reference.png',
        current: 'current.png',
      }, { root })
      const outsideDiff = await compareTarget({
        name: 'accounts',
        reference: 'reference.png',
        current: 'current.png',
      }, { root, diffDir: 'outside-link' })

      expect(outsideReference).toMatchObject({ status: 'CONFIG_INVALID', blocked: true })
      expect(outsideDiff).toMatchObject({ status: 'CONFIG_INVALID', blocked: true })
      expect(fs.existsSync(path.join(outside, 'accounts.png'))).toBe(false)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  }))

  it('以百分比表达整体误差阈值，而不是把 0.1 误解为 10%', () => withTempRoot(async (root) => {
    writePng(path.join(root, 'reference.png'), [255, 255, 255, 255], 10, 10)
    writePng(path.join(root, 'current.png'), [255, 255, 255, 255], 10, 10)
    const current = PNG.sync.read(fs.readFileSync(path.join(root, 'current.png')))
    current.data[0] = 0
    fs.writeFileSync(path.join(root, 'current.png'), PNG.sync.write(current))

    const passing = await compareTarget({ name: 'accounts', reference: 'reference.png', current: 'current.png' }, {
      root,
      mismatchThreshold: 1,
      pixelThreshold: 0,
    })
    const failing = await compareTarget({ name: 'accounts', reference: 'reference.png', current: 'current.png' }, {
      root,
      mismatchThreshold: 0.99,
      pixelThreshold: 0,
    })

    expect(passing).toMatchObject({ status: 'PASS', mismatchPercentage: 1 })
    expect(failing).toMatchObject({ status: 'FAIL', mismatchPercentage: 1 })
  }))

  it('拒绝程序化调用中的非法比较阈值', () => withTempRoot(async (root) => {
    writePng(path.join(root, 'reference.png'))
    writePng(path.join(root, 'current.png'))
    const target = { name: 'accounts', reference: 'reference.png', current: 'current.png' }

    const result = await compareTarget(target, { root, mismatchThreshold: 101 })

    expect(result).toMatchObject({ status: 'CONFIG_INVALID', blocked: true })
    expect(result.reason).toMatch(/mismatchThreshold/)
    await expect(runAudit({
      root,
      targets: [target],
      pixelThreshold: -0.1,
    })).rejects.toThrow(/pixelThreshold/)
  }))

  it('要求存在且结构合法的 manifest，并解析受限 CLI 参数', () => withTempRoot(async (root) => {
    expect(() => loadManifest(path.join(root, 'missing.json'), { root })).toThrow(/manifest/i)
    const manifestPath = path.join(root, 'manifest.json')
    const target = {
      name: 'accounts',
      reference: 'reference.png',
      current: 'current.png',
    }
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      referenceStatus: 'PENDING_REAL_CAPTURE',
      targets: [target],
    }))
    expect(loadManifest(manifestPath, { root })).toMatchObject({
      referenceStatus: 'PENDING_REAL_CAPTURE',
    })

    fs.writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      referenceStatus: 'CAPTURED_VERIFIED',
      targets: [target],
    }))
    expect(() => loadManifest(manifestPath, { root })).toThrow(/referenceSha256/)

    fs.writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      referenceStatus: 'CAPTURED_VERIFIED',
      targets: [{
        ...target,
        referenceSha256: 'a'.repeat(64),
        referenceDimensions: [2, 2],
      }],
    }))
    expect(loadManifest(manifestPath, { root })).toMatchObject({
      referenceStatus: 'CAPTURED_VERIFIED',
      targets: [expect.objectContaining({
        referenceSha256: 'a'.repeat(64),
        referenceDimensions: [2, 2],
      })],
    })

    expect(() => parseCliArgs(['--mismatch-threshold=101'])).toThrow(/mismatch-threshold/)
    expect(parseCliArgs([
      '--manifest=01-docs/ui-reference/visual-baseline-manifest.json',
      '--mismatch-threshold=0.25',
      '--pixel-threshold=0.05',
    ])).toMatchObject({
      manifest: '01-docs/ui-reference/visual-baseline-manifest.json',
      mismatchThreshold: 0.25,
      pixelThreshold: 0.05,
    })
  }))

  it('报告转义 manifest 中的表格分隔符', () => {
    const markdown = renderMarkdown({
      meta: { generatedAt: '2026-07-24T00:00:00.000Z', manifest: 'manifest.json' },
      summary: { total: 1, passed: 0, failed: 1, blocked: 0, referenceUnverified: 0, dimensionMismatch: 0 },
      results: [{
        name: 'accounts',
        status: 'FAIL',
        referencePath: 'reference|image.png',
        currentPath: 'current.png',
        mismatchPercentage: 1,
        reason: '原因|需要检查',
      }],
    })

    expect(markdown).toContain('reference\\|image.png')
    expect(markdown).toContain('原因\\|需要检查')
  })
})

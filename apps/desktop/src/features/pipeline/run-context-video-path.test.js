// @ts-check
/**
 * run context → 成片路径（热门选题一键生成视频 / 视频创作页共享，2026-10-17）。
 *
 * 口径来自 CreateView.extractOrchestrationVideoPath（原样搬出，行为不变）：
 * 引擎按 stage.name 把执行输出写进 run.context[stageName]，不同流水线落在不同阶段名上：
 * - story2video-compose：publish / compose
 * - animated-explainer / documentary-montage：compose（documentary 的 render 阶段 type=compose，键名 render）
 * - animation / avatar-spokesperson / character-animation / hybrid：render
 * - clip-factory：export
 * - framework-smoke：report
 * 每个阶段兼容 `{ data }` 包裹与扁平两种历史形态。
 */
import { describe, it, expect } from 'vitest'
import { extractRunContextVideoPath } from './run-context-video-path'

describe('extractRunContextVideoPath', () => {
  it('prefers publish over compose (published run keeps the same path)', () => {
    expect(extractRunContextVideoPath({
      publish: { videoPath: 'D:/out/publish.mp4' },
      compose: { videoPath: 'D:/out/compose.mp4' },
    })).toBe('D:/out/publish.mp4')
  })

  it('reads compose for story2video/explainer style pipelines', () => {
    expect(extractRunContextVideoPath({ compose: { videoPath: 'D:/out/compose.mp4' } })).toBe('D:/out/compose.mp4')
    expect(extractRunContextVideoPath({ compose: { path: 'D:/out/compose-path.mp4' } })).toBe('D:/out/compose-path.mp4')
  })

  it('reads export (clip-factory), render (videogen families) and report (smoke)', () => {
    expect(extractRunContextVideoPath({ export: { videoPath: 'D:/out/export.mp4' } })).toBe('D:/out/export.mp4')
    expect(extractRunContextVideoPath({ render: { videoPath: 'D:/out/render.mp4' } })).toBe('D:/out/render.mp4')
    expect(extractRunContextVideoPath({ render: { path: 'D:/out/render-path.mp4' } })).toBe('D:/out/render-path.mp4')
    expect(extractRunContextVideoPath({ report: { videoPath: 'D:/out/report.mp4' } })).toBe('D:/out/report.mp4')
  })

  it('unwraps the historical { data } wrapper used by persisted run records', () => {
    expect(extractRunContextVideoPath({
      publish: { data: { videoPath: 'D:/out/p.mp4' } },
      render: { data: { path: 'D:/out/r.mp4' } },
    })).toBe('D:/out/p.mp4')
    expect(extractRunContextVideoPath({ render: { data: { videoPath: 'D:/out/r.mp4' } } })).toBe('D:/out/r.mp4')
  })

  it('returns null for missing/invalid contexts instead of throwing', () => {
    expect(extractRunContextVideoPath(null)).toBeNull()
    expect(extractRunContextVideoPath(undefined)).toBeNull()
    expect(extractRunContextVideoPath({})).toBeNull()
    expect(extractRunContextVideoPath({ compose: {} })).toBeNull()
    expect(extractRunContextVideoPath({ compose: 'not-an-object' })).toBeNull()
  })
})

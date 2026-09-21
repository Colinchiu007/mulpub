// @ts-check
/**
 * PR-2（F8）preload/API 层合同：impact 快照只读暴露面
 *
 * 锁定三件事（PRD-VIRAL-PAGE-FULL-UTILIZATION-2026-09-21 §4 F8 / §10 Q1）：
 * 1. preload publish API 暴露 getRecentImpactSnapshots → 'impact:get-recent-snapshots'（复用既有主进程通道，零新增 IPC）
 * 2. index.bundle.js 已重打包并包含该绑定（防止改 preload 源忘记 build:preload）
 * 3. src/api/publisher.js 提供 invokeWithFallback 封装（未登录/无 API 时 code -1 → F8 区块隐藏）
 *
 * @vitest-environment node
 */
const fs = require('node:fs')
const path = require('node:path')

const desktopRoot = path.resolve(__dirname, '..', '..')

describe('PR-2 F8 impact 快照暴露面合同', () => {
  it('createPublishApi 暴露 getRecentImpactSnapshots 并绑定既有 impact:get-recent-snapshots 通道', () => {
    const calls = []
    const ipcRenderer = {
      invoke: (...args) => { calls.push(args); return Promise.resolve({ code: 0, data: [] }) },
      on: () => () => {},
      removeListener: () => {},
    }
    const { createPublishApi } = require('../preload/publish')
    const api = createPublishApi(ipcRenderer)
    expect(typeof api.getRecentImpactSnapshots).toBe('function')
    api.getRecentImpactSnapshots()
    expect(calls[0][0]).toBe('impact:get-recent-snapshots')
  })

  it('preload index.bundle.js 已重打包（含 impact:get-recent-snapshots 绑定）', () => {
    const src = fs.readFileSync(path.join(desktopRoot, 'electron/preload/index.bundle.js'), 'utf8')
    expect(src).toContain('impact:get-recent-snapshots')
    expect(src).toContain('getRecentImpactSnapshots')
  })

  it('src/api/publisher.js 导出 getRecentImpactSnapshots 且走 invokeWithFallback code -1 兜底', () => {
    const src = fs.readFileSync(path.join(desktopRoot, 'src/api/publisher.js'), 'utf8')
    expect(src).toMatch(/export async function getRecentImpactSnapshots/)
    expect(src).toMatch(/getRecentImpactSnapshots",\s*\{\s*code:\s*-1,\s*data:\s*\[\]\s*\}/)
  })
})

// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const path = require('path')

function collectApiPaths(value, prefix = '') {
  const paths = []
  for (const key of Object.keys(value || {})) {
    const current = prefix ? `${prefix}.${key}` : key
    if (typeof value[key] === 'function') paths.push(current)
    else if (value[key] && typeof value[key] === 'object') paths.push(...collectApiPaths(value[key], current))
  }
  return paths.sort()
}

function loadExposedApi(modulePath) {
  delete require.cache[require.resolve(modulePath)]
  __electronMock.contextBridge.exposeInMainWorld = vi.fn()
  __electronMock.ipcRenderer.sendSync = vi.fn(() => 'admin')
  __enableElectronMock()
  require(modulePath)
  return __electronMock.contextBridge.exposeInMainWorld.mock.calls[0][1]
}

afterEach(() => {
  __disableElectronMock()
  delete __electronMock.ipcRenderer.sendSync
})

describe('preload 单文件构建', () => {
  it('声明直接构建依赖，避免依赖包提升变化导致打包失败', () => {
    const packageJson = require('../../package.json')

    expect(packageJson.devDependencies).toHaveProperty('esbuild')
    expect(packageJson.scripts['build:preload']).toBe('node scripts/build-preload.js')
    expect(packageJson.scripts['test:preload:sandbox'])
      .toBe('pnpm run build:preload && node scripts/verify-preload-sandbox.js')
    expect(packageJson.build.beforePack).toBe('scripts/before-pack.js')
  })

  it('输出不包含 sandbox 禁止的本地 require', async () => {
    const { buildPreload } = require('../../scripts/build-preload')
    const result = await buildPreload({ write: false })
    const code = result.outputFiles[0].text

    expect(code).toMatch(/require\(["']electron["']\)/)
    expect(code).not.toMatch(/require\(["']\.{1,2}[\\/]/)
  })

  // 2026-10-17（change: bundle-untrack）：产物移出版本控制后，本用例的语义由
  // 「**提交的** bundle 与源码一致」变成「**构建出的** bundle 与源码一致」——
  // 它守的性质没变（改了 preload 源码就必须让产物跟上），只是产物来源从 git 换成构建。
  // CI 的 unit-tests / desktop-shards / coverage 三个 job 已在跑测试前执行 build:preload。
  it('构建产物与源码暴露完全相同的 API 路径', () => {
    const { OUTPUT_FILE } = require('../../scripts/build-preload')
    expect(path.basename(OUTPUT_FILE)).toBe('index.bundle.js')
    const sourceApi = loadExposedApi(path.resolve(__dirname, '../preload/index.js'))
    const bundleApi = loadExposedApi(OUTPUT_FILE)

    expect(collectApiPaths(bundleApi)).toEqual(collectApiPaths(sourceApi))
    expect(bundleApi).toHaveProperty('retryTask')
    expect(bundleApi).toHaveProperty('onAccountStatusChanged')
    expect(bundleApi).not.toHaveProperty('authSaveCredentials')
  })
})

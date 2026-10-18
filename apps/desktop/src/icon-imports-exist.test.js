/**
 * @element-plus/icons-vue 图标导入存在性锁
 *
 * 动因（本 PR 实测）：给设置页「快捷键」Tab 挑图标时写了 `Keyboard`，
 * 该名字在这个版本里**不存在** —— 组件测试全绿（视图测试按 §11.3 用 Proxy 兜底 mock 图标），
 * 只有 `vite build` 才报 `"Keyboard" is not exported by ...`，也就是**打包阶段才炸**。
 * 图标名是编译期不校验、运行期静默 undefined 的那类引用（AGENTS.md「宿主 API 字段归属必须先核实」
 * 的同族：凭名字猜宿主导出，测试夹具还会替你圆场）。
 *
 * 判据：扫渲染端所有 `.vue`/`.js` 里对 `@element-plus/icons-vue` 的具名 import，
 * 逐个用**真模块**核对；两条反失明断言（扫描域非空、导出集规模下界）不可省。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as realIcons from '@element-plus/icons-vue'

const SRC_ROOT = path.resolve(__dirname)

function listSources (dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listSources(full, out)
    else if (entry.isFile() && /\.(vue|js)$/.test(entry.name) && !/\.(test|spec)\.js$/.test(entry.name)) out.push(full)
  }
  return out
}

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]@element-plus\/icons-vue['"]/g

describe('图标具名导入必须真实存在（防"只有 vite build 才发现"）', () => {
  const files = listSources(SRC_ROOT)
  const missing = []
  let checked = 0

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    let m
    IMPORT_RE.lastIndex = 0
    while ((m = IMPORT_RE.exec(src)) !== null) {
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim()
        if (!name) continue
        checked += 1
        if (!(name in realIcons)) missing.push(`${path.relative(SRC_ROOT, file).replace(/\\/g, '/')} → ${name}`)
      }
    }
  }

  it('判定域非空：确实扫到图标 import，且真模块导出集有规模', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(Object.keys(realIcons).length).toBeGreaterThan(200)
    expect(checked).toBeGreaterThan(20)
  })

  it('没有具名导入落在真实导出集之外', () => {
    expect(missing).toEqual([])
  })

  it('判据自己有区分力：本 PR 真实踩错的那个名字必须落在导出集之外', () => {
    // 若这条变红，说明图标集里真的有 Keyboard —— 那当初该报的不是"名字不存在"而是别的错，
    // 上面那条锁的语义也就跟着变了。它是"扫描器确实能判否"的现场证据，不是装饰。
    expect('Keyboard' in realIcons).toBe(false)
    expect('Key' in realIcons).toBe(true)
  })
})

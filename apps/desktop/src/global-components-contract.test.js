// @ts-check
/**
 * 全局组件注册合同（audit-6 / 阶段 1.3）
 *
 * 两条判据，各自挡一类真实失效：
 *   A. main.js 的全局注册集合 与 test-setup.js 的单测镜像集合 必须逐字相同。
 *      test-setup.js:342 的注释写着"镜像 main.js"，但此前没有任何东西对账过，
 *      于是"两边都注册了同一个组件"这件事本身可以一直成立，而其中一个早已无人使用。
 *   B. 凡全局注册的组件，必须在至少一个 .vue 模板里被消费（`<Name`）。
 *      这正是 AGENTS.md「新增全局 app.component 前必须问它在几条路由上被用」的机械版：
 *      注册 ≠ 使用；`LoadingState` 就是注册在 main.js:58、全仓模板零消费、
 *      却自带一份 7 条用例的测试而长期全绿的例子。
 *
 * 反失明：两个集合都非空且含已知成员（解析退化时立即红，而不是"零个注册 ⇒ 零个违规"）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC_DIR = join(__dirname)
const MAIN_JS = join(SRC_DIR, 'main.js')
const TEST_SETUP = join(SRC_DIR, '..', 'test-setup.js')

/** 取 `app.component('Name', Binding)` 的名字集合 */
function extractGlobalRegistrations (source) {
  const re = /app\.component\(\s*['"]([A-Za-z][A-Za-z0-9-]*)['"]\s*,\s*[A-Za-z_$][\w$]*\s*\)/g
  const names = []
  let match
  while ((match = re.exec(source)) !== null) names.push(match[1])
  return [...new Set(names)].sort()
}

/** 取 test-setup.js 里 `vtConfig.global.components = { … }` 的键集合（简写与 `k: v` 两形态） */
function extractMirroredComponents (source) {
  const start = source.indexOf('vtConfig.global.components')
  if (start === -1) throw new Error('test-setup.js 不再镜像全局组件注册，本锁的前提已失效，请同步改锁')
  const open = source.indexOf('{', start)
  if (open === -1) throw new Error('未找到 vtConfig.global.components 的对象字面量起点')
  let depth = 0
  let close = -1
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) { close = i; break }
    }
  }
  if (close === -1) throw new Error('vtConfig.global.components 对象字面量括号未闭合')
  const body = source.slice(open + 1, close)
  const names = new Set()
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim().replace(/,$/, '')
    if (!line || line.startsWith('...')) continue
    const pair = /^([A-Za-z][A-Za-z0-9_-]*)\s*:/.exec(line)
    if (pair) { names.add(pair[1]); continue }
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(line)) names.add(line)
  }
  return [...names].sort()
}

function collectVueFiles (dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const st = statSync(full)
    if (st.isDirectory()) out.push(...collectVueFiles(full))
    else if (entry.endsWith('.vue')) out.push(full)
  }
  return out
}

const vueFiles = collectVueFiles(SRC_DIR)
const vueSources = vueFiles.map((file) => ({ file: relative(SRC_DIR, file).replace(/\\/g, '/'), text: readFileSync(file, 'utf8') }))

describe('全局组件注册合同', () => {
  const registered = extractGlobalRegistrations(readFileSync(MAIN_JS, 'utf8'))
  const mirrored = extractMirroredComponents(readFileSync(TEST_SETUP, 'utf8'))

  it('解析器确实取到了注册项（防解析退化把空集合读成通过）', () => {
    expect(registered.length, `main.js 全局注册数=${registered.length}`).toBeGreaterThan(0)
    expect(mirrored.length, `test-setup.js 镜像数=${mirrored.length}`).toBeGreaterThan(0)
    expect(registered).toContain('EmptyState')
    expect(mirrored).toContain('EmptyState')
  })

  it('main.js 注册集合与单测镜像集合逐字相同', () => {
    expect(mirrored, 'test-setup.js 是 main.js 全局注册的镜像，两份清单不得漂移').toEqual(registered)
  })

  it.each(registered)('全局注册的 %s 在 .vue 模板里有真实消费者', (name) => {
    const consumers = vueSources.filter((f) => f.text.includes(`<${name}`)).map((f) => f.file)
    expect(consumers.length, `<${name}> 在 src/**/*.vue 中零消费 ⇒ 注册即死代码（扫描域 ${vueSources.length} 个 .vue）`).toBeGreaterThan(0)
  })

  it('扫描域非空（否则上一条会因空集而恒真）', () => {
    expect(vueSources.length).toBeGreaterThan(50)
  })

  it('零消费的全局注册不得再被加回来（LoadingState 墓碑）', () => {
    expect(registered, 'LoadingState 曾被全局注册但全仓模板零消费（audit-6）').not.toContain('LoadingState')
    expect(mirrored).not.toContain('LoadingState')
    expect(vueSources.some((f) => f.text.includes('<LoadingState'))).toBe(false)
  })
})

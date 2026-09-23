/**
 * 回归保护测试：Accounts.vue 模块编译通过
 *
 * 背景（Bug 复盘 2026-09-05）：
 *   提交 c3c395570 在 Accounts.vue 中引入了重复 import 和缺失的 PLATFORM_LOGIN_URLS 导出，
 *   导致 Vite 动态 import 失败（"Failed to fetch dynamically imported module"）。
 *
 * 本测试验证：
 *   1. Accounts.vue 的所有顶层 import 都能成功解析
 *   2. 从 @multi-publish/shared-utils/src/platform-definitions 导入的符号在浏览器版中可用
 *   3. Accounts.vue 这个 SFC 本体可被 @vue/compiler-sfc 独立编译（脚本 + 模板）
 *
 * 2026-09-23 变更（本地/CI 超时 flake 排查，见 01-docs/learnings.md）：
 *   原先本文件第 6 条用例用 execSync 跑了一次完整 `vite build`：本地实测单条 55.1s（整文件 63.1s），
 *   失败时表现为「测试超时」而非「构建报错」，磁盘吃紧时最先崩的也是它。而这条命令在 CI 必需链路上
 *   已由 6 个 workflow 覆盖：其中 quality-gate.yml 的 visual job（apps/desktop 下 pnpm run build:vue）被 required 的
 *   "Gate Result" 经 needs 依赖构成硬门禁；另见 build / electron-ci / gui-test / visual-test / autonomous-loop.yml（后者输出进 Out-Null，不作断言）。
 *   故：全量构建降级为显式开启（MP_VITE_BUILD_GUARD=1），日常守卫由 333ms 的 SFC 编译承担
 *   —— c3c395570 的「重复 import」缺陷类由 compileScript 直接拦截（见下方守卫自检测试用例）。
 */
import { describe, expect, it } from 'vitest'

describe('Accounts.vue 导入完整性', () => {
  it('PLATFORM_LOGIN_URLS 可从 @multi-publish/shared-utils/src/platform-definitions 导入', async () => {
    // Vite 的 resolve.alias 将此模块映射到 platform-definitions.browser.js
    const mod = await import('@multi-publish/shared-utils/src/platform-definitions')
    expect(mod).toHaveProperty('PLATFORM_LOGIN_URLS')
    expect(mod).toHaveProperty('PLATFORM_DASHBOARD_URLS')
    expect(typeof mod.PLATFORM_LOGIN_URLS).toBe('object')
    expect(Object.keys(mod.PLATFORM_LOGIN_URLS).length).toBeGreaterThanOrEqual(14)
  })

  it('formatUserError 可从 @/utils/user-facing-error 导入', async () => {
    const mod = await import('@/utils/user-facing-error')
    expect(mod).toHaveProperty('formatUserError')
    expect(typeof mod.formatUserError).toBe('function')
  })

  it('useAccountStore 可从 @/stores/accounts 导入', async () => {
    const mod = await import('@/stores/accounts')
    expect(mod).toHaveProperty('useAccountStore')
    expect(typeof mod.useAccountStore).toBe('function')
  })

  it('useAccountEvents 可从 @/composables/useAccountEvents 导入', async () => {
    const mod = await import('@/composables/useAccountEvents')
    expect(mod).toHaveProperty('useAccountEvents')
    expect(typeof mod.useAccountEvents).toBe('function')
  })

  it('useAccountActions 可从 @/composables/useAccountActions 导入', async () => {
    const mod = await import('@/composables/useAccountActions')
    expect(mod).toHaveProperty('useAccountActions')
    expect(typeof mod.useAccountActions).toBe('function')
  })

  it('Accounts.vue SFC 可被 @vue/compiler-sfc 独立编译（脚本 + 模板）', async () => {
    const { readFileSync } = await import('node:fs')
    const { default: path } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const { parse, compileScript, compileTemplate } = await import('vue/compiler-sfc')

    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const sfcPath = path.resolve(__dirname, 'Accounts.vue')
    const { descriptor, errors } = parse(readFileSync(sfcPath, 'utf-8'), { filename: 'Accounts.vue' })
    expect(errors, `SFC 解析失败：${errors.map(String).join('; ')}`).toHaveLength(0)
    expect(descriptor.scriptSetup, 'Accounts.vue 应仍为 <script setup> 形态').toBeTruthy()
    expect(descriptor.template, 'Accounts.vue 应仍有 <template>').toBeTruthy()

    // compileScript 不解析依赖、只编译本文件：重复 import / 重复声明会在此抛出（c3c395570 缺陷类）
    const script = compileScript(descriptor, { id: 'accounts-compile-guard' })
    expect(script.content.length).toBeGreaterThan(0)
    expect(Object.keys(script.bindings || {}).length).toBeGreaterThan(0)

    const template = compileTemplate({
      source: descriptor.template.content,
      filename: sfcPath,
      id: 'accounts-compile-guard',
      compilerOptions: { bindingMetadata: script.bindings },
    })
    expect(template.errors, `模板编译失败：${template.errors.map(String).join('; ')}`).toHaveLength(0)
    expect(template.code.length).toBeGreaterThan(0)
  })

  it('守卫自检：重复 import 的 SFC 必须被 compileScript 拒绝（否则上面的守卫是空守卫）', async () => {
    const { parse, compileScript } = await import('vue/compiler-sfc')
    const nl = String.fromCharCode(10)
    const duplicated = [
      '<template><div>{{ label }}</div></template>',
      '<script setup>',
      'import { useAccountStore } from "@/stores/accounts"',
      'import { useAccountStore } from "@/stores/accounts"',
      'const label = useAccountStore()',
      '</script>',
    ].join(nl)

    const { descriptor, errors } = parse(duplicated, { filename: 'Duplicated.vue' })
    // parse 阶段发现不了重复声明：若只做到 parse.errors 就收工，c3c395570 仍会逃逸。
    expect(errors).toHaveLength(0)
    expect(() => compileScript(descriptor, { id: 'guard-selfcheck' })).toThrowError(
      /already been declared/,
    )
  })

  // 默认跳过：同一条命令已在 CI required 链路（Gate Result needs visual job）上执行，单测内再跑一次
  // 只会把 55s 的全量构建塞进串行 worker，并把构建故障伪装成测试超时。本地需要时显式开启：
  //   MP_VITE_BUILD_GUARD=1 pnpm test src/views/accounts-compile.test.js
  it.skipIf(process.env.MP_VITE_BUILD_GUARD !== '1')(
    '完整 vite build 成功（显式开启时的端到端确认）',
    async () => {
      const { execSync } = await import('node:child_process')
      const { default: path } = await import('node:path')
      const { fileURLToPath } = await import('node:url')

      const __dirname = path.dirname(fileURLToPath(import.meta.url))
      const desktopRoot = path.resolve(__dirname, '..', '..')

      try {
        execSync('npx vite build --emptyOutDir false --minify false', {
          cwd: desktopRoot,
          stdio: 'pipe',
          timeout: 120000,
        })
      } catch (error) {
        const stderr = error.stderr?.toString() || ''
        const stdout = error.stdout?.toString() || ''
        // 如果构建失败，输出错误信息帮助定位
        throw new Error(
          `vite build 失败：\nstdout: ${stdout.slice(-500)}\nstderr: ${stderr.slice(-500)}`
        )
      }
    },
    180000,
  )
})
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 限流自检「迁移运营中心 + 桌面保留隐藏执行端」回归契约（源码断言）。
// PRD-RATE-LIMIT-SELFCHECK-MIGRATE-OPS-CENTER-2026-09-23：
//   P0-1 桌面模型设置页自检入口下线；P0-3 真机执行端（electron）保留；
//   P0-6 桌面「高级/诊断」黑盒一键诊断入口（无参数）；P0-2 locale 成对清理。
const here = dirname(fileURLToPath(import.meta.url))
const appDesktop = join(here, '..', '..')
const read = (p) => readFileSync(join(appDesktop, p), 'utf8')

const vue = read('src/views/ModelProviders.vue')
const preload = read('electron/preload/index.js')
const ipc = read('electron/ipc-handlers/rate-limit.js')
const logs = read('src/components/LogsSettings.vue')
const diagnose = read('src/components/NetSchedDiagnose.vue')
const zh = read('src/locales/zh.js')
const en = read('src/locales/en.js')

describe('限流自检迁移运营中心 · 回归契约', () => {
  it('P0-1：模型设置页不再含限流自检一级入口/弹窗/表单', () => {
    expect(vue).not.toMatch(/selfcheck-entry/)
    expect(vue).not.toMatch(/open-self-check/)
    expect(vue).not.toMatch(/showSelfCheckDialog/)
    expect(vue).not.toMatch(/selfCheckForm/)
    expect(vue).not.toMatch(/\.selfcheck-form/)
  })

  it('P0-3：真机执行端（electron 服务 + IPC + preload 通道）完整保留', () => {
    expect(existsSync(join(appDesktop, 'electron/services/rate-limit-self-check.js'))).toBe(true)
    expect(ipc).toMatch(/rate-limit:self-check/)
    expect(ipc).toMatch(/rate-limit:report/)
    expect(preload).toMatch(/rateLimitSelfCheck/)
    expect(preload).toMatch(/rateLimitReport/)
  })

  it('P0-6：高级/诊断含黑盒一键诊断入口且不暴露 6 参数', () => {
    expect(logs).toMatch(/NetSchedDiagnose/)
    expect(diagnose).toMatch(/net-sched-diagnose/)
    // 黑盒：诊断卡内不出现参数输入（inject429 / rpm el-input-number 等）
    expect(diagnose).not.toMatch(/inject429|inject_429|el-input-number/)
  })

  it('P0-2：自检专用 locale 键在 zh/en 成对移除（保留复用的 limitPer5hLabel）', () => {
    for (const [name, txt] of [['zh', zh], ['en', en]]) {
      expect(txt, name + ' 仍残留 selfCheckHint').not.toMatch(/selfCheckHint\s*:/)
      expect(txt, name + ' 仍残留 runSelfCheck').not.toMatch(/runSelfCheck\s*:/)
      expect(txt, name + ' 仍残留 limitPer5hLabel2').not.toMatch(/limitPer5hLabel2\s*:/)
    }
    // 被 provider 配置表单复用的键不得删除
    expect(zh).toMatch(/limitPer5hLabel\s*:/)
    expect(en).toMatch(/limitPer5hLabel\s*:/)
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import zh from '@/locales/zh'
import en from '@/locales/en'

/**
 * 模型设置页文案契约（2026-09-22 settings-model-tabs-polish）
 * 回归保护：
 *  - "+ 添加服务商" 双加号 bug：模板曾硬编码 ＋ 前缀，locale 值又带 ＋，渲染成 "++ 添加服务商"。
 *  - pageSubtitle 文案："管理推理"→"文字推理"（与 capLlm 术语对齐）、"七类"→"7类"。
 */
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('模型设置页文案契约', () => {
  it('zh addProvider 只有一个半角 + 前缀，无全角＋', () => {
    const v = zh.modelProviders.addProvider
    expect(v).toBe('+ 添加服务商')
    expect(v).not.toContain('\uff0b') // 全角＋
    // 只允许一个 + 号
    expect((v.match(/\+/g) || []).length).toBe(1)
  })

  it('en addProvider 与 zh 语义对齐（单个 + 前缀）', () => {
    expect(en.modelProviders.addProvider).toBe('+ Add Provider')
  })

  it('zh pageSubtitle 用"文字推理"和"7类"，不含旧文案', () => {
    const sub = zh.modelProviders.pageSubtitle
    expect(sub).toContain('文字推理')
    expect(sub).toContain('7类')
    expect(sub).not.toContain('管理推理')
    expect(sub).not.toContain('七类')
  })

  it('en pageSubtitle 用"7 types"和"Text Reasoning"', () => {
    const sub = en.modelProviders.pageSubtitle
    expect(sub).toContain('7 types')
    expect(sub).toContain('Text Reasoning')
    expect(sub).not.toMatch(/seven/i)
  })

  it('ModelProviders.vue 模板不再硬编码 ＋ 前缀（双加号根因）', () => {
    const vue = readFileSync(join(srcDir, 'views/ModelProviders.vue'), 'utf8')
    expect(vue).not.toContain('＋ {{')
    expect(vue).toContain(">{{ t('modelProviders.addProvider') }}</button>")
  })
})

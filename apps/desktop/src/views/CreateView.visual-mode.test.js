// @vitest-environment node
// @ts-check
/**
 * CreateView.visual-mode.test.js — 「画面模式」前端契约锁（AI 讲解视频）
 *
 * ## 为什么锁这三件
 *
 * ① **locale zh/en 成对**：新文案漏翻译会让英文用户在界面上看到裸 key
 *    （`create.explainer.visualMode.hint`），CI Gate 7 只保证键成对存在，
 *    这里再锁一次「四个键都存在且非空」——漏一个键就是界面直接崩给人看。
 *
 * ② **提示文案必须同时说清两个要点**：「不消耗积分」+「表现形式单一」。
 *    这是本功能对用户的**唯一告知面**：用户不知道动效标题卡只是图片展示文字，
 *    就会以为拿到的还是 AI 画面。文案被改坏 ⇒ 用户按错误预期下单 ⇒ 投诉。
 *    ⇒ 断言两个要点都在文案里，而不是只断言「文案非空」。
 *
 * ③ **接线不丢**：`params.visualMode` 的下发、状态字段、流水线判定三处都在。
 *    这是「源码契约锁」——组件本身有 5400+ 行、mount 成本过高，
 *    不做全量渲染测试；但这三处一旦被误删，功能会**静默失效**
 *    （界面上还能选，参数发不出去，没有任何报错）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const VIEW_PATH = path.resolve(__dirname, 'CreateView.vue')

// locale 是 ESM（内部用无扩展名的 import），必须走 vite 的动态 import 解析，
// 直接 require 会因「找不到 ./avatar/zh」而整个 suite 加载失败。
const zh = (await import('../locales/create/zh.js')).default
const en = (await import('../locales/create/en.js')).default

describe('AI 讲解视频 · 画面模式 locale 契约', () => {
  const KEYS = ['label', 'ai', 'titleCard', 'hint']

  it('zh 四个键都存在且非空', () => {
    for (const key of KEYS) {
      const value = zh?.explainer?.visualMode?.[key]
      expect(typeof value, `zh create.explainer.visualMode.${key} 缺失`).toBe('string')
      expect(value.trim().length, `zh create.explainer.visualMode.${key} 为空`).toBeGreaterThan(0)
    }
  })

  it('en 四个键都存在且非空（漏翻译会让英文界面显示裸 key）', () => {
    for (const key of KEYS) {
      const value = en?.explainer?.visualMode?.[key]
      expect(typeof value, `en create.explainer.visualMode.${key} 缺失`).toBe('string')
      expect(value.trim().length, `en create.explainer.visualMode.${key} 为空`).toBeGreaterThan(0)
    }
  })

  it('zh 提示文案同时说清「不消耗积分」与「表现形式单一」两个要点', () => {
    const hint = zh.explainer.visualMode.hint
    expect(hint).toContain('不消耗积分')
    expect(hint).toContain('表现形式单一')
  })

  it('en 提示文案同时覆盖 cost 与 limitation 两个要点', () => {
    const hint = en.explainer.visualMode.hint
    expect(hint.toLowerCase()).toContain('no credits')
    expect(hint.toLowerCase()).toContain('limited')
  })
})

describe('AI 讲解视频 · 画面模式接线（源码契约锁）', () => {
  const source = readFileSync(VIEW_PATH, 'utf8')

  it('状态字段存在且默认 AI 生成', () => {
    expect(source).toContain("explainerVisualMode: 'ai'")
  })

  it('启动时把 visualMode 下发给主进程（只在 explainer 流水线下发）', () => {
    expect(source).toContain('params.visualMode')
    expect(source).toContain('isExplainerPipeline')
  })

  it('判定只认 animated-explainer（数字人流水线复用同一启动方法但没有这个选项）', () => {
    expect(source).toMatch(/isExplainerPipeline\(name\)\s*\{\s*return name === 'animated-explainer'/)
  })

  it('选择器用 locale 键而非中文字面量（.vue template 块的中文会被 check-locale-sync --cjk 拦下）', () => {
    expect(source).toContain("$t('create.explainer.visualMode.label')")
    expect(source).toContain("$t('create.explainer.visualMode.ai')")
    expect(source).toContain("$t('create.explainer.visualMode.titleCard')")
    expect(source).toContain("$t('create.explainer.visualMode.hint')")
  })
})

// @ts-check
/**
 * video-copy-refine.test.js — 视频创作 UI 文案精修的回归锁
 *
 * 背景（用户需求 2026-10-19）：
 *   ① 影视工程卡片文案去掉「复刻《Hell Grind》」字样；
 *   ② 故事讲述流水线页副标题「基于 OpenMontage 流水线引擎」→「全能性流水线引擎」；
 *   ③ 影视工程页标题与分镜库总标题的「Hell Grind」→「影响项目案例」（需多语言）；
 *   ④ Hub 第 3 标签「工程案例」→「项目案例」。
 *
 * 为什么值得上锁：四处文案分属两个 locale 命名空间 + 一个 .vue 模板 + 一条 CJK 基线条目，
 * 任何一处漏改都会造成「同一个产品两个说法」；而 ② 原本是**硬编码中文**（存量 CJK 债务），
 * 本次一并迁进 locale，若只改文案不删基线条目，等于把「已治理」的债务又记回基线。
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

import zhPipelines from '@/locales/pipelines/zh'
import enPipelines from '@/locales/pipelines/en'
import zhFilm from '@/locales/film-engineering/zh'
import enFilm from '@/locales/film-engineering/en'
import zhCreate from '@/locales/create/zh'
import enCreate from '@/locales/create/en'
import i18n from '@/i18n'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_ROOT = path.resolve(__dirname, '../..')
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '../..')

const read = (rel) => readFileSync(path.join(DESKTOP_ROOT, rel), 'utf8')
const readRepo = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8')

describe('视频创作 UI 文案精修（video-copy-refine）', () => {
  describe('① 影视工程卡片文案（pipelines.descriptions）', () => {
    it('zh 为目标文案且不含旧片名', () => {
      expect(zhPipelines.descriptions['film-engineering'])
        .toBe('影视工程：——行业专业分镜提示词库、素材索引与剧本套用')
      expect(zhPipelines.descriptions['film-engineering']).not.toContain('Hell Grind')
    })

    it('en 成对且不含旧片名', () => {
      expect(enPipelines.descriptions['film-engineering'])
        .toBe('Film Engineering: — industry-grade shot prompt library, asset index & script adaptation')
      expect(enPipelines.descriptions['film-engineering']).not.toContain('Hell Grind')
    })
  })

  describe('② 故事讲述流水线页副标题（硬编码 → locale）', () => {
    it('zh/en 成对，文案为目标值且不再提 OpenMontage', () => {
      expect(zhCreate.story2video.engineSubtitle).toBe('全能性流水线引擎，AI 驱动从脚本到成片的全流程')
      expect(enCreate.story2video.engineSubtitle).toBe('An all-in-one pipeline engine: AI-driven from script to final cut')
      expect(zhCreate.story2video.engineSubtitle).not.toContain('OpenMontage')
      expect(enCreate.story2video.engineSubtitle).not.toContain('OpenMontage')
    })

    it('CreateView.vue 引用 locale key，不再硬编码该句（防回退）', () => {
      const src = read('src/views/CreateView.vue')
      // CreateView.vue 是 Options API：模板里只有 $t，没有 t()
      expect(src).toContain("$t('create.story2video.engineSubtitle')")
      expect(src).not.toContain('基于 OpenMontage 流水线引擎，AI 驱动从脚本到成片的全流程')
    })

    it('CJK 基线不再登记该条已迁走的硬编码（存量债务同步销账）', () => {
      const baseline = JSON.parse(readRepo('.github/scripts/locale-cjk-baseline.json'))
      const stale = baseline.filter((e) => e.includes('基于 OpenMontage 流水线引擎'))
      expect(stale).toEqual([])
    })
  })

  describe('③ 影视工程页标题 / 分镜库总标题（Hell Grind → 影响项目案例，多语言）', () => {
    it('filmEngineering.title zh/en 成对且为目标文案', () => {
      expect(zhFilm.title).toBe('影视工程 · 影响项目案例制作流水线')
      expect(enFilm.title).toBe('Film Engineering · Impact Project Case Production Pipeline')
    })

    it('filmEngineering.libraryTitle zh/en 成对且为目标文案', () => {
      expect(zhFilm.libraryTitle).toBe('影响项目案例')
      expect(enFilm.libraryTitle).toBe('Impact Project Case')
    })

    it('FilmEngineeringView.vue 的分镜库总标题读 locale key，不再直读 filmMeta.title', () => {
      const src = read('src/views/FilmEngineeringView.vue')
      expect(src).toContain("t('filmEngineering.libraryTitle')")
      // fe-meta-title 处不得再渲染随包数据的原始片名
      expect(src).not.toMatch(/fe-meta-title">\{\{\s*status\.filmMeta\.title\s*\}\}/)
    })
  })

  describe('④ Hub 第 3 标签「工程案例」→「项目案例」', () => {
    it('hub.tabs.classic zh/en 成对', () => {
      expect(zhFilm.hub.tabs.classic).toBe('项目案例')
      expect(enFilm.hub.tabs.classic).toBe('Project Cases')
    })

    it('hub.subtitle 中的同名标签描述同步改写（防同页两种说法）', () => {
      expect(zhFilm.hub.subtitle).toContain('项目案例')
      expect(zhFilm.hub.subtitle).not.toContain('工程案例')
      // en 侧副标题必须用新标签名 "Project Cases"；旧文案是 ", Cases (the real shot library"
      expect(enFilm.hub.subtitle).toContain('Project Cases (industry-grade shot library')
      expect(enFilm.hub.subtitle).not.toContain(', Cases (the real shot library')
    })
  })

  describe('⑤ 端到端：Hub 标签与工程案例页标题真实渲染（DOM 断言）', () => {
    it('Hub 第 3 标签渲染「项目案例」，页面上不得残留旧片名', async () => {
      // Hub 依赖 vue-router（useRoute/useRouter），按既有 FilmEngineeringHubView.test.js 同款方式 mock
      const { reactive } = await import('vue')
      const routeState = reactive({ query: {} })
      vi.doMock('vue-router', () => ({
        useRoute: () => routeState,
        useRouter: () => ({ replace: vi.fn() }),
      }))
      const { default: FilmEngineeringHubView } = await import('./FilmEngineeringHubView.vue')
      const wrapper = mount(FilmEngineeringHubView, {
        global: {
          plugins: [i18n],
          stubs: { FilmAutoPanel: true, FilmCanvasView: true },
        },
      })
      await flushPromises()
      const classicTab = wrapper.find('[data-testid="fh-tab-classic"]')
      expect(classicTab.text()).toBe('项目案例')
      // Hub 页副标题与 tooltip 都不得再出现旧片名/旧标签名
      expect(wrapper.text()).not.toContain('Hell Grind')
      expect(wrapper.text()).not.toContain('工程案例')
      await nextTick()
      wrapper.unmount()
    })
  })
})

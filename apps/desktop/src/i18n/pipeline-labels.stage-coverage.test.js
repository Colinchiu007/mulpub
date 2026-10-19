// @ts-check
/**
 * pipeline-labels 阶段 key 登记完整性回归锁（fix-film-engineering-defects，2026-10-19）
 *
 * 动因：影视工程「自动」模式的进度区三行阶段名显示为英文 id 原文
 * （`film_auto_plan` / `film_auto_generate` / `film_auto_render`），因为这三个 id
 * 只定义在 `useFilmAutoRun.js`，从未登记进 `src/i18n/pipeline-labels.js` 的 STAGES 表，
 * `translate()` 走 fallback 原样返回 id。
 *
 * 为什么既有测试拦不住：三道文案门禁（locale 成对 check-locale-sync、渲染端硬编码中文
 * 扫描、i18n-glossary）**都只管字面量中文**，管不到「代码生成的动态 key」是否登记。
 * 属结构性盲区，因此这里补一条**全仓扫描**：凡是传给进度/阶段组件的阶段 id 字面量，
 * 必须在 STAGES 表有登记，且 zh/en 两侧都有对应文案。
 *
 * 本锁通用：未来任何新流水线漏登记阶段名，这里都会红。
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PIPELINE_STAGE_KEYS } from '@/i18n/pipeline-labels'
import pipelinesZh from '@/locales/pipelines/zh'
import pipelinesEn from '@/locales/pipelines/en'

const SRC_ROOT = path.resolve(__dirname, '..', '..')

/** 递归收集 src 下的 .js/.vue 文件（排除测试文件） */
function walk (dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      walk(p, out)
    } else if (/\.(js|vue)$/.test(entry.name) && !/\.test\.(js|vue)$/.test(entry.name)) {
      out.push(p)
    }
  }
  return out
}

/**
 * 从源码里提取「传给阶段/进度组件的阶段 id 字面量」。
 * 形态：`name: 'xxx'` 且该 xxx 形似阶段 id（小写字母/下划线/数字）。
 * 只取同文件里出现过 stageList / stages / getPipelineStage 之一的文件，避免误扫。
 */
function collectStageIdLiterals () {
  const ids = new Set()
  for (const file of walk(SRC_ROOT)) {
    const text = fs.readFileSync(file, 'utf8')
    if (!/stageList|getPipelineStage|PIPELINE_STAGE_KEYS|stages\s*[:=]/.test(text)) continue
    for (const m of text.matchAll(/name:\s*'([a-z][a-z0-9_]{2,})'/g)) {
      ids.add(m[1])
    }
  }
  return ids
}

describe('pipeline-labels 阶段 key 登记完整性', () => {
  // 注意：locales/pipelines/*.js 是 default 导出且顶层即 names/stages（无 pipelines 包裹层）
  const registered = new Set(Object.keys(PIPELINE_STAGE_KEYS))
  const zhStages = pipelinesZh?.stages || {}
  const enStages = pipelinesEn?.stages || {}

  it('STAGES 表登记的 key 必须在 zh/en 两侧都有文案（防漏翻译）', () => {
    const missingZh = [...registered].filter((k) => !zhStages[k])
    const missingEn = [...registered].filter((k) => !enStages[k])
    expect(missingZh).toEqual([])
    expect(missingEn).toEqual([])
  })

  it('源码里出现的阶段 id 字面量必须全部登记进 STAGES 表（防漏登记回归）', () => {
    const used = [...collectStageIdLiterals()].filter((id) => id.startsWith('film_') || id.includes('_'))
    // 只断言形似流水线阶段 id 的（避免误伤组件里普通的 name 字段）
    const filmAuto = used.filter((id) => id.startsWith('film_auto_'))
    const unregistered = filmAuto.filter((id) => !registered.has(id))
    expect(unregistered).toEqual([])
  })

  it('影视工程自动模式的三个阶段 id 必须登记（本缺陷的直接锁）', () => {
    for (const id of ['film_auto_plan', 'film_auto_generate', 'film_auto_render']) {
      expect(registered.has(id), `${id} 必须登记`).toBe(true)
      expect(typeof zhStages[id]).toBe('string')
      expect(typeof enStages[id]).toBe('string')
    }
  })
})

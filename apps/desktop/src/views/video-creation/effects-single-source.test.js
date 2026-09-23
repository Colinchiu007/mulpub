/**
 * 审计 P2·枚举单一来源（桌面端消费侧）回归保护。
 *
 * 桌面端历史上把动效/转场 ID 抄了 4 份（types.ts + create-view-module-utils +
 * create-view-utils + 组件内 option/label 映射），任一处新增都会静默漂移：
 * 引擎支持的 effect 值在「恢复上次使用的选项」白名单里被判为陈旧值而丢弃，或
 * 下拉里出现了引擎不认识的 ID。本用例把消费侧与包内派生值双向锁死。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { IMAGE_EFFECT_IDS, TRANSITION_EFFECT_IDS } from '@multi-publish/story2video-engine/effects-library'
import { S2V_RESTORE_ENUM_OPTIONS } from './create-view-module-utils'

function read(rel) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** 取 v-model 指向该字段的下拉块里的 option value 列表（按 DOM 顺序） */
function optionIdsOf(src, modelExpr) {
  const start = src.indexOf('v-model="' + modelExpr + '"')
  expect(start, '未找到下拉：' + modelExpr).toBeGreaterThan(-1)
  const block = src.slice(start, src.indexOf('</UiSelect>', start))
  return Array.from(block.matchAll(/<option\s+value="([^"]+)"/g)).map((m) => m[1])
}

describe('动效/转场枚举单一来源（消费侧）', () => {
  it('快照恢复白名单直接引用派生数组（不再手抄字面量）', () => {
    expect(Array.from(S2V_RESTORE_ENUM_OPTIONS.imageEffect)).toEqual(Array.from(IMAGE_EFFECT_IDS))
    expect(Array.from(S2V_RESTORE_ENUM_OPTIONS.transition)).toEqual(Array.from(TRANSITION_EFFECT_IDS))
    const src = read('src/views/video-creation/create-view-module-utils.js')
    expect(src).not.toMatch(/imageEffect:\s*\[\s*'none',\s*'zoom-in'/)
    expect(src).not.toMatch(/transition:\s*\[\s*'none',\s*'fade'/)
  })

  it('设置面板下拉的 option 值与派生数组逐项一致（反向漂移即阻断）', () => {
    const src = read('src/views/video-creation/S2vConfigPanels.vue')
    expect(optionIdsOf(src, 's2vConfig.imageEffect')).toEqual(Array.from(IMAGE_EFFECT_IDS))
    expect(optionIdsOf(src, 's2vConfig.transition')).toEqual(Array.from(TRANSITION_EFFECT_IDS))
  })

  it('配置摘要的 i18n 标签映射覆盖全部 ID（缺项会渲染出裸 ID）', () => {
    const src = read('src/views/video-creation/ConfigSummary.vue')
    const m = src.match(/const IMAGE_EFFECTS = \{([\s\S]*?)\n\}/)
    expect(m, 'ConfigSummary 里的 IMAGE_EFFECTS 映射被挪动').toBeTruthy()
    const keys = Array.from(m[1].matchAll(/(?:^|[,{\s])('?[\w-]+'?)\s*:/g)).map((x) => x[1].replace(/'/g, ''))
    expect(keys.sort()).toEqual([...IMAGE_EFFECT_IDS].sort())
  })

  it('已死的重复枚举副本不得复活（create-view-utils.js 已随本批删除）', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/views/create-view-utils.js'))).toBe(false)
  })
})

/**
 * story2video locale 文案字形回归锁（2026-10-20，CCG 外部评审 i1）。
 *
 * 动因（真实事故，本次自查发现）：`labels.currentScene` 曾被写成
 * `'\u8be5\u573a\u6664'` —— `\u6664` 是「晤」，而本该是「景」（`\u666f`）。
 * 于是兜底文案渲染成「该场晤」，一个用户可见的错字，而**当时所有测试都是绿的**：
 * 没有任何判据在解码交付的 \uXXXX 字符串后核对字形。
 *
 * 为什么必须机械锁而不能只靠人眼：zh.js 全量使用 \uXXXX 转义（既有风格），
 * 相邻码位在视觉上完全无法区分（666f / 6664 只差最后一个十六进制字符），
 * 而错字会影响每一个走该兜底分支的用户。
 *
 * 锁什么：把本模块新增/维护的**兜底标签**解码后与期望字形逐字比对。
 * 不做全文件通用比对（那需要一份权威字表，反而引入新的漂移源）；
 * 只在「这几个字是有语义的、错一个就误导用户」的条目上落断言。
 */
import { describe, it, expect } from 'vitest'
import zh from './zh'
import en from './en'

const zhLabels = zh.story2video.labels
const enLabels = en.story2video.labels

describe('story2video labels 字形回归锁（CCG 评审 i1）', () => {
  it('currentScene 解码后必须是「该场景」——曾被写成 \\u6664（晤）', () => {
    expect(zhLabels.currentScene).toBe('该场景')
    // 逐字锁定，防止有人「顺手」改成同义但错位的字
    expect([...zhLabels.currentScene]).toEqual(['该', '场', '景'])
    expect(zhLabels.currentScene).not.toContain('晤')
    expect(zhLabels.currentScene).not.toContain('旤')
  })

  it('unknownSize 解码后必须是「允许上限」', () => {
    expect(zhLabels.unknownSize).toBe('允许上限')
  })

  it('英文侧兜底标签语义正确且非空', () => {
    expect(typeof enLabels.currentScene).toBe('string')
    expect(enLabels.currentScene.trim().length).toBeGreaterThan(0)
    expect(typeof enLabels.unknownSize).toBe('string')
    expect(enLabels.unknownSize.trim().length).toBeGreaterThan(0)
  })

  it('sceneLabel 与 currentScene 必须共用同一个「景」字（同族错字最容易漂）', () => {
    // sceneLabel 是「第 {scene} 个场景」这类，含「景」；两者若不同源极易漂成错字
    expect(zhLabels.sceneLabel).toContain('景')
    expect(zhLabels.currentScene).toContain('景')
  })
})

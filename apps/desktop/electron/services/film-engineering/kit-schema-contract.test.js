// @ts-check
'use strict'
/**
 * kit-schema-contract 契约测试（PR-3b 资产导入 · `SCHEMA.md` 导入契约小节）
 *
 * 覆盖方案要求的**第二道自动化断言**：
 *   ① 「导入契约」小节**存在**（缺失 ⇒ 直接失败，**不跳过**）；
 *   ② `reason` 枚举**逐值存在**且与代码的闭集**完全一致**（不多不少）；
 *   ③ 审计字段小节**存在且非空**（字段名逐个在位）；
 *   ④ 恢复路径小节**存在且非空**（三档 + 恢复动作）。
 *
 * ⚠ 本测试**不在运行路径上**（构建期/测试期）⇒ 不违反「SCHEMA.md 不用于运行时解析」那条声明。
 */

const fs = require('fs')
const path = require('path')

const { SCHEMA_PATH } = require('./kit-mirror-check')
const { REASON: SCAN_REASON } = require('./kit-import-scan')
const { REASON: LOCK_REASON } = require('./kit-import-lock')
const { REASON: AUDIT_REASON } = require('./kit-import-audit')
const { REASON: SWAP_REASON } = require('./kit-import-swap')
const { REASON: IMPORT_REASON } = require('./kit-import')

const text = fs.readFileSync(SCHEMA_PATH, 'utf8')

/** 代码侧的全部 reason 值（各模块闭集的并集；⚠ 去重 —— 多个模块共用同一 reason） */
const CODE_REASONS = [...new Set([
  ...Object.values(SCAN_REASON),
  ...Object.values(LOCK_REASON),
  ...Object.values(AUDIT_REASON),
  ...Object.values(SWAP_REASON),
  ...Object.values(IMPORT_REASON),
].filter((v) => typeof v === 'string'))]

function contractSection () {
  const i = text.indexOf('## 十一、导入契约')
  const j = text.indexOf('## 十二、')
  expect(i, 'SCHEMA.md 缺少「导入契约」小节').toBeGreaterThan(-1)
  expect(j, 'SCHEMA.md 缺少「生成与重建」小节（导入契约小节未闭合）').toBeGreaterThan(i)
  return text.slice(i, j)
}

describe('kit-schema-contract: SCHEMA.md 导入契约小节', () => {
  it('「导入契约」小节存在（缺失即失败，不跳过）', () => {
    const sec = contractSection()
    expect(sec.length).toBeGreaterThan(500)
  })

  it('声明了「不用于运行时解析」的安全边界', () => {
    const sec = contractSection()
    expect(sec).toContain('不用于运行时解析')
  })

  it('reason 枚举：代码闭集的每个值都在文档里，且枚举小节不多出别的值', () => {
    const sec = contractSection()
    const missing = CODE_REASONS.filter((r) => sec.indexOf('`' + r + '`') < 0)
    expect(missing).toEqual([])
    // ⚠ 只在 **11.4 枚举小节**内比对「不多出别的值」——
    //   整节里还有常量名（`WHITELIST_PATTERNS` 等）与恢复档位（`PRE_SWAP` 等），
    //   它们**不是** reason ⇒ 拿整节做集合比较会误报。
    const i = sec.indexOf('### 11.4')
    const j = sec.indexOf('### 11.5')
    expect(i, '缺少 11.4 reason 枚举小节').toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)
    const enumValues = [...new Set((sec.slice(i, j).match(/`[A-Z][A-Z_]{3,}`/g) || []).map((x) => x.replace(/`/g, '')))]
    expect(enumValues.sort()).toEqual([...CODE_REASONS].sort())
  })

  it('审计字段小节存在且字段名逐个在位', () => {
    const sec = contractSection()
    for (const field of [
      '时间', 'sender URL', 'sender 路由', '触发组件', '所选目录',
      '结果', 'reason', 'post_check', 'recovery_state', '恢复路径',
    ]) {
      expect(sec, '审计字段缺失: ' + field).toContain(field)
    }
    expect(sec).toContain('制表符分隔')
    expect(sec).toContain('示例行')
  })

  it('恢复路径小节存在且三档齐全', () => {
    const sec = contractSection()
    for (const state of ['PRE_SWAP', 'MISSING_KIT', 'BAK_LEFT', 'LOCK_LEFT']) {
      expect(sec, '恢复档位缺失: ' + state).toContain(state)
    }
  })

  it('取舍小节写明 R0 禁递归删目录与跨目录硬链边界', () => {
    const sec = contractSection()
    expect(sec).toContain('禁止递归删除目录')
    expect(sec).toContain('非防篡改边界')
  })

  it('白名单 9 项 + 排除项 images/ 都在文档里', () => {
    const sec = contractSection()
    expect(sec).toContain('9 项')
    expect(sec).toContain('images/')
  })
})

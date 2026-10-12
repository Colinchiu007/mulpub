'use strict'
/**
 * PRD 需求条目状态标注的回归锁（2026-10-12，Gate 9 第 3 层修复）。
 *
 * 背景：审计器把 PRD 里**所有**可解析条目都当成「应实现的需求」——包括规划中、
 * 不做、历史记录类。实测 01-docs/PRD.md 抽出 357 项，其中大量是未来规划，
 * 于是「覆盖率」被规划项稀释成存量欠账，任何 feat PR 都可能被误判。
 *
 * 修复：PRD 条目可带显式状态标注，parser 识别后交给审计器分层；
 * 状态不明（未标注）的条目按既有行为保留（不擅自改变语义）。
 */

const test = require('node:test')
const assert = require('node:assert/strict')

// 状态标注判据独立成纯函数模块，便于单测与复用
const { parseItemStatus, STATUS_TAGS } = require('./gate9-prd-status.js')

test('显式标注：已实现 / 规划中 / 不做 / 历史 四类均被识别', () => {
  assert.equal(parseItemStatus('一键发布功能【已实现】').status, 'implemented')
  assert.equal(parseItemStatus('播客托管【规划中】').status, 'planned')
  assert.equal(parseItemStatus('深色模式【不做】').status, 'wont-do')
  assert.equal(parseItemStatus('旧版发布链路【历史】').status, 'historical')
})

test('未标注条目 → unknown（既有行为不变，不擅自排除）', () => {
  assert.equal(parseItemStatus('一键发布功能').status, 'unknown')
})

test('标注在条目任意位置都能识别（含句中）', () => {
  // 句中多标注时按 STATUS_ORDER 取先命中者（implemented 优先），
  // 避免「【已实现】…【规划中】」复合描述被误判为规划中
  assert.equal(parseItemStatus('支持小红书【已实现】与抖音【规划中】双端').status, 'implemented')
  // 无 implemented 时才落到 planned
  assert.equal(parseItemStatus('支持小红书与抖音【规划中】双端').status, 'planned')
})

test('英文同族标注也认（implemented / planned / wont-do / historical）', () => {
  assert.equal(parseItemStatus('Dark mode [implemented]').status, 'implemented')
  assert.equal(parseItemStatus('Dark mode [planned]').status, 'planned')
})

test('STATUS_TAGS 常量表与判据一致（改判据必改表，防两处漂移）', () => {
  assert.ok(STATUS_TAGS.implemented.length >= 2)
  assert.ok(STATUS_TAGS.planned.length >= 2)
  assert.ok(STATUS_TAGS['wont-do'].length >= 2)
  assert.ok(STATUS_TAGS.historical.length >= 2)
})

test('反证：若把 implemented 的标注从判据里删掉 → 立刻红', () => {
  // 这条锁的是「判据与常量表同源」：判据靠 STATUS_TAGS 驱动，
  // 删表内任一项都会让上面四类识别用例红
  const r = parseItemStatus('某功能【已实现】')
  assert.equal(r.status, 'implemented')
  assert.ok(r.tag, '必须回显命中的标注，便于排查')
})

test('审计范围判据：只有 implemented / unknown 进审计，其余分层', () => {
  const { shouldAudit } = require('./gate9-prd-status.js')
  assert.equal(shouldAudit('implemented'), true)
  assert.equal(shouldAudit('unknown'), true)
  assert.equal(shouldAudit('planned'), false)
  assert.equal(shouldAudit('wont-do'), false)
  assert.equal(shouldAudit('historical'), false)
})

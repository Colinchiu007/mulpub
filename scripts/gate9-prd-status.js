'use strict'
/**
 * PRD 需求条目的状态标注判据（2026-10-12，Gate 9 第 3 层修复）。
 *
 * 为什么要有这个文件：审计器（ai-autonomous-tester）把 PRD 里所有可解析条目
 * 都当成「应实现的需求」。实测 01-docs/PRD.md 抽出 **357 项**，其中大量是
 * 规划中/不做/历史记录类，覆盖率被规划项稀释成存量欠账 —— 任何 feat PR 都可能
 * 因此被判 COVERAGE_FAIL（#3413 实测 score 0.31，#3409 连挂 4 次）。
 *
 * 口径（写死、可测）：
 *   - implemented / unknown → 进审计（unknown 保持既有行为，不擅自排除）
 *   - planned / wont-do / historical → 不进审计（分层报告，不计入覆盖率分母）
 *
 * 判据与常量表同源：判据由 STATUS_TAGS 驱动，改判据必改表，防两处漂移。
 */

const STATUS_TAGS = {
  implemented: ['已实现', 'implemented', '已上线', 'done', 'shipped'],
  planned: ['规划中', 'planned', '待实现', 'todo', 'future'],
  'wont-do': ['不做', "won't do", 'wont-do', 'wontdo', 'rejected'],
  historical: ['历史', 'historical', 'legacy', 'deprecated', '已废弃'],
}

// 检索顺序即优先级：一条同时带多个标注时取先命中者（implemented 优先，
// 避免「【已实现】…【历史】」这类复合描述被误判为历史）
const STATUS_ORDER = ['implemented', 'historical', 'planned', 'wont-do']

/**
 * 解析条目文本中的状态标注。
 * @param {string} text PRD 条目文本（可含标注）
 * @returns {{status: 'implemented'|'planned'|'wont-do'|'historical'|'unknown', tag: string|null}}
 */
function parseItemStatus(text) {
  const s = String(text || '')
  for (const status of STATUS_ORDER) {
    for (const tag of STATUS_TAGS[status]) {
      if (s.includes(tag)) {
        return { status, tag }
      }
    }
  }
  return { status: 'unknown', tag: null }
}

/**
 * 该状态是否应进入覆盖审计。
 * @param {string} status parseItemStatus 返回的 status
 */
function shouldAudit(status) {
  return status === 'implemented' || status === 'unknown'
}

module.exports = { parseItemStatus, shouldAudit, STATUS_TAGS, STATUS_ORDER }

'use strict'

/**
 * 闭环状态词的**唯一真源**（2026-10-20，外部评审第 2 轮 i2 升级为 Critical 后落地）。
 *
 * 为什么单独成模块：这三个词同时决定
 *   ① `check-pr-exec-record.js` 的**阻断面**（状态是否闭环，`unresolved` 的来源）；
 *   ② 同文件「转变核对」的判定；
 *   ③ `scripts/lib/exec-record-audit.js` 的**审计分档**。
 * 三处各抄一份时，改一处的后果不是报错而是**静默不一致**：审计把某状态算成未闭环、
 * 判据却算成闭环，两边读数对不上而没有任何东西会红。
 *
 * 第 1 轮我加的是「相等测试」（护栏），第 2 轮 critic 指出那只是**发现**漂移、不能**消除**
 * 漂移（要等测试跑到）。所以这里改成真正的单一来源：判据与审计都 require 本模块，
 * 删掉各自的字面量副本。
 *
 * ⚠️ 本模块**只放常量**，不 require 任何东西、不读环境、不写文件：
 * 它会被判据本体 require，而判据本体是 CI 每次 PR 都跑的入口，必须保持零副作用。
 */

/** 判据认可的闭环状态词（闭集；新增词等于放宽闭环口径，须同时改判据注释与测试） */
const CLOSED_DEEP_REVIEW_STATUSES = new Set([
  'cleared',
  'needs_revision',
  'self_play_resolved',
])

module.exports = { CLOSED_DEEP_REVIEW_STATUSES }

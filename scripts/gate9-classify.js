'use strict'
/**
 * Gate 9（PRD/源码自主覆盖审计）的 PR 判据 —— 单一真源模块。
 *
 * 为什么要有这个文件：判据原来以 PowerShell 字面量抄在
 * `.github/workflows/quality-gate.yml` 的 "Gate 9 - PR metadata" 步骤里，
 * 无法单测、无法被 workflow 与本地复现共享。三个真实缺陷各引一次事故：
 *
 *   ① **作用域错**（2026-10-12，#3413）：审计器固定 `--src=apps/desktop/src`，
 *      而 PRD 与桌面端实现是「全量存量比对」，与本 PR 改了什么无关。
 *      #3413 只动 ops-center 也被判 COVERAGE_FAIL（score 0.31）拦住合并；
 *      同构先例 #3409 连挂 4 次。产物实锤：PRD 357 项 vs 桌面端 1081 特征。
 *   ② **判定不稳**（同次实跑）：LLM 空输出走 `AUDIT_NO_VERDICT` 静默放行
 *      （agent-review-gate.js:125），等于「没审也算过」；而同一 PR 两次跑
 *      结论相反（0.31 FAIL → NEED_HUMAN）。判据波动却能决定合并与否。
 *   ③ **口径割裂**：CI 跑 `--mode=advisory`（恒 0），本机/文档却用
 *      `--mode=enforce`；`gate-result` 又把 autonomous 列 blocking。
 *      三处口径不一致，导致「绿的 check」名不副实。
 *
 * 定数规则（与 gate-budget.js 同风格：写死、可测、注释与判据一一对应）：
 *   - PR_MODE=report-only ⇔ 变更本身没有覆盖审计的标的（纯文档 / 未触碰任何前端源码目录）；
 *     **判据不含标题与 label**——2026-10-15 移除该豁免：实测它让"这条检查绿"变成
 *     "作者写了 fix: 前缀所以没跑"，而真正跑起来的 PR 又因为量的是全仓存量而必红；
 *   - PR_MODE=full ⇔ 需要审计，此时必须给出 srcDir 与 docPaths；
 *   - srcDir 由**变更文件实际落点**决定，不是固定值。
 */

const DESKTOP_PREFIX = 'apps/desktop/'
const OPS_CENTER_PREFIX = 'ops-center/'
const DOCS_PREFIXES = ['01-docs/', 'docs/', 'openspec/']

// ⛔ 这里**不再有**「标题前缀 / label ⇒ report-only」那条豁免（2026-10-15 移除，见本文件末注释）。
// 原标题豁免让被审对象自己决定要不要被审：一个 feat 改动只要把标题写成 fix: 就整步不跑
// （实测 #3605 就是这样绕过的），于是"这条 check 绿"的真实含义变成"前缀命中、没跑"。
// 现在 mode 只由变更文件决定；PR 的类型语义仍可用于报告，但不得用来关掉门禁。

// 文档/流程类路径（与 classify-docs-only 的白名单同源思路，这里只做 Gate 9 自己的粗分层）
const DOC_ONLY_PATH_PREFIXES = [
  '01-docs/', 'docs/', 'openspec/', '.ccg/', 'CHANGELOG.md', 'AGENTS.md',
  '.quality-gates.md', 'scripts/gate-record-debt-ledger.json',
]

/**
 * 判定 Gate 9 的 PR 画像。
 *
 * @param {object} input
 * @param {string} input.title PR 标题
 * @param {string} [input.body] PR 正文
 * @param {string} [input.labels] 逗号分隔的 label
 * @param {string[]} input.changedFiles PR 变更文件（相对仓库根，正斜杠）
 * @returns {{mode: 'full'|'report-only', srcDir: string, docPaths: string[], reason: string, featureIds: string[]}}
 */
function classifyGate9(input) {
  const body = String((input && input.body) || '')
  // title / labels 被**故意**忽略：审计跑不跑只该看改了什么文件。
  const changedFiles = Array.isArray(input && input.changedFiles) ? input.changedFiles.filter(Boolean) : []

  const featureIds = Array.from(
    new Set(Array.from(body.matchAll(/feat_[A-Za-z0-9_]+/g)).map((m) => m[0]))
  ).sort()

  const base = {
    featureIds,
    docPaths: ['01-docs/PRD.md'],
  }


  // 变更文件缺失（本地/非 PR 上下文）：fail-closed 走 full + 桌面端，保持既有行为
  if (changedFiles.length === 0) {
    return {
      ...base,
      mode: 'full',
      srcDir: 'apps/desktop/src',
      reason: '无变更文件清单（非 PR 上下文）：fail-closed 按全量桌面端审计',
    }
  }

  const allDocOnly = changedFiles.every((f) =>
    DOC_ONLY_PATH_PREFIXES.some((p) => f === p || f.startsWith(p))
  )
  if (allDocOnly) {
    return {
      ...base,
      mode: 'report-only',
      srcDir: '',
      reason: '变更全部落在文档/流程路径：覆盖审计无标的',
    }
  }

  const touchesDesktop = changedFiles.some((f) => f.startsWith(DESKTOP_PREFIX))
  const touchesOpsCenter = changedFiles.some((f) => f.startsWith(OPS_CENTER_PREFIX))

  // ② 作用域分流：只碰运营中心 → 审计运营中心自己的前端，不审桌面端存量
  if (touchesOpsCenter && !touchesDesktop) {
    return {
      ...base,
      mode: 'full',
      srcDir: 'ops-center/frontend/src',
      docPaths: ['ops-center/docs/PRD.md'],
      reason: '变更仅落在 ops-center：按运营中心自身前端/PRD 审计（不审桌面端存量欠账）',
    }
  }

  // ③ 碰桌面端（或两者都碰）：全量桌面端审计（既有行为）
  if (touchesDesktop) {
    return {
      ...base,
      mode: 'full',
      srcDir: 'apps/desktop/src',
      docPaths: ['01-docs/PRD.md'],
      reason: '变更触及桌面端：全量桌面端覆盖审计',
    }
  }

  // 碰了别的运行面（packages/、scripts/ 等）：不审前端覆盖，但也不假装审过
  return {
    ...base,
    mode: 'report-only',
    srcDir: '',
    reason: '变更未触及任何前端源码目录：覆盖审计不适用',
  }
}

module.exports = { classifyGate9, DOC_ONLY_PATH_PREFIXES }

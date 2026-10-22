'use strict'
/**
 * ccg-review-gate-surfaces.js —— 「守门面清单」的唯一真源（tasks 11.1）
 *
 * 这里列的是**机械闸门本体**的路径族：改它们等于改「谁来守门」，而不是改被守的东西。
 *
 * 为什么需要单独一个模块：这件事原先在仓里有两份互不认账的表 ——
 *  - `check-pr-exec-record.js::HIGH_RISK_SURFACES`：收口矩阵读它（高危面必须拿外部出处）
 *  - `ccg-review-decider.js::RULES.sensitivePaths`：决定要不要起双模型评审，
 *    实测**一条守门门面路径都不含** ⇒ 改 CI 判据本体的 PR 常被评 `single`，
 *    凭一条 pending 产物就能通过既有闭环判据（缺陷 G / tasks 8.5①）。
 * 收成一处之后，两个消费者**用途不同、口径相同**：判据按它要求出处；决策层只报告命中
 * 条数与名单，**不改 mode**（把 gate 命中升成 dual 会让每次改判据都固定多花 23-40 分钟
 * 的 DUAL 钩子，那属「谁来守门」的政策变更，须人工过目，不由本刀顺手决定）。
 *
 * 匹配（文件 → 前缀）的唯一实现仍在判据侧 `highRiskPrefixOf`：它带段起点、vendored 排除
 * 与扩展名作用域。本模块只做**名称**层面的查询，不参与文件匹配。
 */

// why 里的「实测命中 N 个」是**下界**，由 check-pr-exec-record.test.js 的 X2-14 按当前归因对账：
// 跌破即红（命中域被削窄），超出只打印不拦。这些数是活数，引用时现跑，不得当常数抄进别处。
// ── 依赖图（改这张表要同时动谁、谁在守它）─────────────────────────────
//  真源     ：本文件的 GATE_SURFACES —— 仓内唯一一份守门面清单。
//  消费方 A ：check-pr-exec-record.js 的 HIGH_RISK_SURFACES —— 经 ...assertGateSurfaces(GATE_SURFACES) 派生，
//             用于高危面收口要求（tier=external 那一档）。
//  消费方 B ：ccg-review-decider.js 的 gateSurfaceHitGroups() —— 只把命中写进 stats 与 CLI，不改 mode。
//  匹配实现 ：不在本文件。文件→前缀的唯一实现是 check-pr-exec-record.js 的 highRiskPrefixOf
//             （段起点 + vendored 排除 + exts 作用域）；本文件只做**名称**层面的集合/家族查询。
//  回归锁   ：scripts/lib/ccg-review-gate-surfaces.test.js（两表双向对账 + 接线）挂 CI 的 Gate 2c7；
//             ccg-review-decider.test.js 的「守门面命中」那组守观测面本身，其中「段起点」那一格
//             是唯一能分辨"复用判据匹配"与"自己写一份根锚定"的输入（vendored 那格两版同形）。
//  改宽度的门槛：扩表属改「谁来守门」，须人工过目 —— 见 11.6 / 11.7 两条未勾项。
const GATE_SURFACES = [
  { prefix: '.github/workflows/', why: 'CI 判据本体（谁来守门），实测命中 15 个' },
  { prefix: 'scripts/check-', why: '仓内静态门禁脚本本体 = 判据自指，实测命中 106 个（含 .github/scripts/ 40 与 apps/desktop/scripts/ 2 —— 段起点匹配的全部理由）' },
  { prefix: 'scripts/ccg-review-', why: '判定写入方（决定"要不要评审"），实测命中 3 个受管文件' },
  { prefix: 'scripts/lib/ccg-review-', why: '评审后端对的真源（决定"谁来评"）—— 跨家族轴 X2-9 实测这条此前落在清单外，改它不触发任何收口要求；实测命中 2 个' },
  { prefix: 'scripts/deep-review', why: '评审驱动本体（闭环值与 performedBy 由它写），实测命中 2 个受管文件' },
]

const EXACT = new Set(GATE_SURFACES.map((s) => s.prefix))

/** 名称成员查询：这个串本身**就是**清单里的一条前缀吗（不是文件路径）。 */
function isGateSurfacePrefix (p) {
  return EXACT.has(String(p))
}

/** 家族归属查询：这个串是否位于某条守门面条目之下（含条目自身）。 */
function looksLikeGatePrefix (p) {
  const s = String(p || '')
  return GATE_SURFACES.some((g) => s === g.prefix || s.slice(0, g.prefix.length) === g.prefix)
}

module.exports = { GATE_SURFACES, isGateSurfacePrefix, looksLikeGatePrefix }

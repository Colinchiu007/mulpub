#!/usr/bin/env node
/**
 * 债务守门输入变更后重算在飞 PR（change: debt-baseline-recheck）
 *
 * 要补的缺口：收紧 scripts/debt-baseline.json 之后，在飞 PR 的 required check **不会重跑**
 * （pull_request 的 run 钉在触发那一刻的 merge ref 上），于是带着旧基线绿结论的 PR 照样能
 * 自动合并、主干当场变红。本脚本只在"主干上这两份守门输入变了"时被调用，逐笔 PR 取
 * 「与当下主干的合并态」重算，并把结论点名在 PR 上。
 *
 * 三条不可破的边界（规格见 openspec/specs/... 归档前的 change specs/ci-debt-baseline-recheck）：
 *   1. 度量只有一处实现：本脚本**不**复算任何指标，一律调用 scripts/check-debt-budget.js；
 *   2. 它不是闸门：量到了才退 0（哪怕结论是"有债"）；整轮一条都没量到 ⇒ 非零。唯一的例外是
 *      "每一行都是 conflict"（他人 PR 与主干真冲突 ⇒ GitHub 侧本就合不进去，陈旧绿进不了主干），
 *      它退 0 但必须打印 MEASURED=0(all-conflict) 留痕；
 *   3. 量不到必须单列并带封闭 reason 词表，不得折叠成"通过"或"违规"，且每条都要带失败命令的
 *      首行 stderr —— 词表归类只由 REASON_CLASS 一处持有，抄第二份名单就是 run 39563222046
 *      那次"零测量却报 success"的成因。
 *
 * 用法（由 workflow 装配，测试面全部走注入）：
 *   node scripts/check-debt-recheck.js --print-plan     # 只打印将要重算哪些 PR，不动任何东西
 */

'use strict'

const C = require('./lib/debt-recheck-core.js')
const V = require('./lib/debt-recheck-live.js')

function main (argv) {
  if (argv.includes('--live')) return V.live()
  if (argv.includes('--print-plan')) {
    console.log('plan: 由 workflow 传入 open PR 清单后逐笔重算；本脚本不自行联网（测试面一律注入）')
    return 0
  }
  console.log('用法: node scripts/check-debt-recheck.js --live | --print-plan')
  return 2
}

// 门面：判据核与装配面的名字都在这里对外可见——回归锁按这个名字面读源码，改名要同步改锁。
module.exports = Object.assign({}, C, V, { main })

if (require.main === module) process.exitCode = main(process.argv.slice(2))

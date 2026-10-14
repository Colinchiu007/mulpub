// GUI Tests 相关性判据（change: gui-test-required-shape）
//
// 为什么要有这个文件：gui-test.yml 原先把路径白名单写在 `on.pull_request.paths` 上。触发层过滤
// 的效果是「不匹配就整条 workflow 不启动」，于是它产生的检查在 required 语义下不是 skipped，
// 而是**永远不到来**（实测 #3499：只改 openspec/records 的 PR 上，build / electron-tests /
// 债务熔断检查 都以 skipping 出现，GUI Tests 计数 0）。本仓的 required 检查由 classic 保护
// （Gate Result / build / QG Unit Tests / QG Coverage）与 ruleset main-ci-gate（6 条）**同时**
// 强制，两套并集里任何一条想纳入 GUI Tests，都必须先把这条判据从触发层搬到作业层。
//
// 形状沿用 electron-ci.yml / quality-gate.yml 的 `changes` 作业先例：PR 触发不带路径过滤，
// 由一个 ubuntu 小作业算出 `gui-relevant`，重型作业 `needs: [changes]` + `if` 门控。
// diff 与 glob 机制**不重写第二份**，直接复用 classify-docs-only.js 的实现（两份必然漂移）。
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')

const { matchesPattern, changedFileStatuses } = require('./classify-docs-only')

// 清单与搬迁前的 `on.pull_request.paths` 逐字相同 —— 搬家不等于改需求；
// 每一项都有现场依据：改桌面/共享包要重跑 GUI，改依赖清单要重跑装依赖，改本文件要自证。
//
// ⚠️ 与 GitHub 原生 paths 过滤**不是同一套语义**，两条已知差异（外部评审实测提出，此处如实记边界）：
//   ① 匹配区分大小写 —— matchesPattern 用 startsWith/===，而 GitHub 在 Windows/macOS runner 上
//      对路径大小写不敏感。本仓文件路径实际全为小写，且 `git diff --name-only` 输出的是索引里的
//      真实大小写，所以当前不构成误判；**若将来有人写大写路径或新增大小写混用的目录，这里会漏判**。
//   ② 只支持 `dir/**` 与字面量两种形态 —— `**/*.ext`、`dir/**/*.ext` 这类 GitHub 支持的写法
//      在这里不生效（classify-docs-only 的实现只特判 `/**` 结尾与根级 `*.md`）。
//      往 GUI_PATHS 加项前，先确认它落在这两种形态之内，否则要连 matchesPattern 一起增强。
const GUI_PATHS = [
  'apps/desktop/**',
  'packages/**',
  'package.json',
  'pnpm-lock.yaml',
  '.github/workflows/gui-test.yml',
]

function isGuiRelevant(files) {
  if (!Array.isArray(files)) {
    throw new Error(`isGuiRelevant 需要数组（收到 ${typeof files}）；不得把"读不到清单"当成"不相关"`)
  }
  // 空清单判否而不是判是：宁多少跑一次，也不要在真相关时静默跳过。
  // 注意这与 changedFileStatuses 的"取证失败一律抛错"是两件事 —— 抛错才是 fail closed。
  return files.some((f) => typeof f === 'string' && GUI_PATHS.some((p) => matchesPattern(f, p)))
}

function parseArgs(argv) {
  const out = {}
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    if (m) out[m[1]] = m[2]
    else if (arg.startsWith('--')) out[arg.slice(2)] = true
  }
  return out
}

function main(argv) {
  const args = parseArgs(argv)
  const repo = args.repo || process.cwd()
  const base = args.base
  const head = args.head || 'HEAD'
  if (!base) {
    process.stderr.write('用法: node ci-gui-relevance.js --base=<ref> [--head=<ref>] [--repo=<dir>]\n')
    process.exit(2)
  }

  let entries
  try {
    entries = changedFileStatuses({ repo, base, head })
  } catch (e) {
    // 取证失败必须红并且**不写产出**：把"读不到"写成 gui-relevant=false 会让 GUI 静默不跑，
    // 而那正是本判据要消灭的"看起来在守、实际恒真"的形态。
    process.stderr.write(`[ci-gui-relevance] ${e.message}\n`)
    process.exit(1)
  }

  const relevant = isGuiRelevant(entries.map((e) => e.file))
  const hits = entries.filter((e) => GUI_PATHS.some((p) => matchesPattern(e.file, p))).map((e) => e.file)
  const lines = [`gui-relevant=${relevant}`, `files=${entries.length}`, `hits=${hits.length}`, ...hits]
  if (entries.length === 0) {
    // 空变更集判"不相关"是**语义正确**的（没东西可测），但它与"判据坏了"在输出上必须可区分：
    // 没有这行留痕，下一个会话只能靠猜。真正危险的差异是取证失败 —— 那条走上面的 exit 1，
    // 绝不落到这里（否则就是把读不到当成不相关）。
    lines.unshift('NOTE: EMPTY_CHANGESET —— base 与 head 之间没有任何文件差异，按"无内容可测"判不相关')
  }
  process.stdout.write(lines.join('\n') + '\n')

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `gui-relevant=${relevant}\n`, 'utf8')
  }
  process.exit(0)
}

module.exports = { GUI_PATHS, isGuiRelevant, matchesPattern }

if (require.main === module) {
  main(process.argv.slice(2))
}

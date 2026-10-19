// docs-only 判定单一真源（change: docs-only-ci-shortcircuit）
//
// 三个消费方共用本模块，禁止出现第二份判定实现：
//   1. CI changes job（quality-gate / electron-ci / build 的 job 级短路判定）
//   2. workflow-contract.test.js（import CI_IGNORED_PATHS 断言 push paths-ignore 同源）
//   3. 本地质量节拍 docs-only 快速通道（AGENTS.md）
//
// 匹配语义（fail-closed，与 GitHub paths 文档字面语义对齐）：
//   * `dir/**`  => 路径以 `dir/` 开头（任意深度）
//   * `*.md`    => 仅根目录 .md（GitHub 文档：'*.{js,py}' matches files in the root
//                  directory）；子目录 .md 必须由显式 `dir/**` 条目覆盖
//   * 字面量    => 路径全等
//   * 其他形态  => 不命中（宁可全量，不可漏跑）
//
// 判定语义：当且仅当文件清单非空且全部命中白名单时 docs-only=true；
// 空清单 / 非数组 / 任一未命中 => false（fail-closed）。
//
// CLI：
//   node scripts/classify-docs-only.js --base=<ref> [--head=<ref>] [--repo=<dir>]
// 输出（stdout，供人工审计）：
//   docs-only=true|false
//   files=<N>
//   <file>（每行一个）
// 环境变量 GITHUB_OUTPUT 存在时追加 `docs-only=<bool>`。
// git 失败（ref 不存在等）=> 非零退出，让 changes job 红、gate-result 拦截。

'use strict'

const { execFileSync } = require('node:child_process')

// 与三个全量 workflow 的 push.paths-ignore 保持逐项一致（真源在此，
// workflow-contract.test.js 从这里 import 并断言一致）。
const CI_IGNORED_PATHS = [
  '01-docs/**',
  'docs/**',
  '*.md',
  'LICENSE',
  '.gitignore',
  '.editorconfig',
  '.ccg/**',
  '.claude/**',
  '.agents/**',
  // 质量节拍 vendored 制品树（165 个文件：98 个 .md + 上游技能脚本副本）。
  // 进名单的前提锁已成立：唯一消费其内容的门禁（契约镜像漂移锁）住在不被 docs-only
  // 短路的 changes job（Gate 2b2），本仓 CI 不执行该树里的任何脚本
  // （check-unwired-tests.js 的 VENDORED_MIRROR 已把它排除在测试扫描域外）。
  '.quality-rhythm/**',
  'openspec/**',
  // 对抗评审产物（adversarial-review-loop）：proposal / critique / rebuttal / summary，
  // 实测构成是纯 .md + .json（62 个文件、零可执行代码），与 .ccg/** 同性质。
  // 不进白名单的后果：只提交评审产物的 docs-only PR 会因 docs-only=false
  // 触发全量 Desktop Shards + Coverage 门禁（实测 3 项重型 job 跑 15+ 分钟）。
  '.adversarial/**',
  'scripts/gate-record-debt-ledger.json',
]

function matchesPattern(filePath, pattern) {
  if (pattern.endsWith('/**')) {
    const dir = pattern.slice(0, -3) // '01-docs/**' -> '01-docs'
    return filePath.startsWith(dir + '/')
  }
  if (pattern === '*.md') {
    return !filePath.includes('/') && filePath.endsWith('.md')
  }
  return filePath === pattern
}

function isDocsOnly(files) {
  if (!Array.isArray(files) || files.length === 0) return false
  return files.every((f) =>
    typeof f === 'string' && CI_IGNORED_PATHS.some((p) => matchesPattern(f, p)),
  )
}

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
}

// 「本 PR 改了哪些文件」的唯一取源。
// 为什么必须只有一份：本仓有过"同一个三态映射被抄成三份"的事故（login-state，见 AGENTS.md）。
// 若 docs-only 判定与「执行记录存在性」判定各自拼一次 diff，两者对 base 的取法迟早漂移，
// 结果是同一个 PR 在一处判"纯文档"、在另一处判"缺记录"，而这种红无法归因。
// 返回 name-status 而不是只有名字：判"本 PR 是否新增了一篇记录文件"需要区分 A/M/D——
// 只看名字会把"改了一篇历史记录"当成"新增了记录"而放行。名字由本函数派生，diff 仍只取一次。
// 失败一律抛错：返回空清单会被上层读成"这个 PR 没改任何文件"，那是假绿通道。
function changedFileStatuses({ repo, base, head }) {
  if (!repo || !base || !head) {
    throw new Error(`changedFileStatuses 需要 repo/base/head 三个参数（收到 repo=${repo || '(空)'} base=${base || '(空)'} head=${head || '(空)'}）`)
  }
  try {
    // PR base 可能落后于 main：用 merge-base 防漏检（与 build.yml package-relevant 同模式）
    const mergeBase = git(repo, ['merge-base', base, head]).trim()
    const raw = git(repo, ['diff', '--name-status', '-z', mergeBase, head])
    // -z 形态实测是「状态 NUL 路径 NUL」交替，**不是** `状态\tpath`（我先按 tab 写过一版，
    // 结果每段都解析成空 → 整个函数静默返回 [] —— 正是本函数要防的假绿通道，靠转储实测才发现）。
    // 重命名/复制的形态是 状态 NUL 旧路径 NUL 新路径。
    const parts = raw.split('\0').filter((s) => s.length > 0)
    const out = []
    for (let i = 0; i < parts.length; i++) {
      // 状态段形如 M / A / D，重命名与复制带相似度数字：**R100 / C75**，不是一个字母
      // （实测：只按 ^[A-Z]$ 匹配会把 R100 整条丢掉，重命名就静默消失）
      const sm = /^([ACDMRUTXB])(\d*)$/.exec(parts[i])
      if (!sm) continue
      const status = sm[1]
      if (status === 'R' || status === 'C') {
        const [oldPath, newPath] = [parts[i + 1], parts[i + 2]]
        if (newPath) out.push({ status: parts[i], file: newPath, from: oldPath })
        i += 2
      } else {
        const file = parts[i + 1]
        if (file) out.push({ status, file })
        i += 1
      }
    }
    return out
  } catch (e) {
    throw new Error(`git 取证失败（base=${base} head=${head}）：${String(e.message || e)}`)
  }
}

function changedFiles(o) {
  return changedFileStatuses(o).map((e) => e.file)
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
    process.stderr.write('用法: node classify-docs-only.js --base=<ref> [--head=<ref>] [--repo=<dir>]\n')
    process.exit(2)
  }

  let files
  try {
    files = changedFiles({ repo, base, head })
  } catch (e) {
    process.stderr.write(`[classify-docs-only] ${e.message}\n`)
    process.exit(1)
  }

  const docsOnly = isDocsOnly(files)

  const lines = [`docs-only=${docsOnly}`, `files=${files.length}`, ...files]
  process.stdout.write(lines.join('\n') + '\n')

  if (process.env.GITHUB_OUTPUT) {
    require('node:fs').appendFileSync(
      process.env.GITHUB_OUTPUT,
      `docs-only=${docsOnly}\n`,
      'utf8',
    )
  }
  process.exit(0)
}

module.exports = { CI_IGNORED_PATHS, isDocsOnly, matchesPattern, changedFiles, changedFileStatuses }

if (require.main === module) {
  main(process.argv.slice(2))
}

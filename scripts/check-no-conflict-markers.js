#!/usr/bin/env node
/**
 * 全仓「冲突标记残留」棘轮锁。
 *
 * 动因（2026-10-14 实测，origin/main `96074c90d`）：`git grep -a` 在**已合入主干**的文件里
 * 抓到 6 篇含 git 冲突标记的行（`<<<<<<< ` / `>>>>>>> `）。两类成因不同：4 篇是
 * `git stash pop` 的冲突被整块提交（两侧含互相矛盾的状态格），2 篇是 rebase 时只删了
 * `<<<<<<<` 一侧却留着 `=======` + `>>>>>>> <sha>`。此前**没有任何判据在看这件事**——
 * `check-text-encoding-integrity.js` 管控制字节，numstat 管行尾，都对标记免疫。
 * 后果不是"难看"：那 4 篇记录的两个表格行互相矛盾，下游按行匹配状态词的判据
 * （`check-gate-record-debt.js` 的 ROW_RE）只会看到第一条，第二条 `待跑` 永远读不到。
 *
 * 判据口径：
 *   - 扫**受管文件全集**（`git ls-files -z`），不经 `git grep` 的二进制跳过：本仓
 *     `01-docs/PRD.md`、`01-docs/learnings.md` 等含 NUL，默认被当二进制**静默跳过**
 *     ⇒ 等价于 `grep -a`。这是 AGENTS「全仓关键词复扫必须带 -a」的同一族。
 *   - 只认 `^<<<<<<<` / `^>>>>>>>`（后接空格或行尾），**不认 `^=======$`**：七个等号在
 *     本仓是合法的 Markdown setext 下划线（`01-docs/PRD-XHS…` 等实测 6 处正当用法），
 *     把它一并禁掉就是造一条会假红的锁。
 *   - 承认清单 KNOWN_CONFLICT_MARKERS 是**带计数基线**的：只按文件粒度承认时，对一篇
 *     已登记的文件再犯一次同款事故（标记 2 行变 4 行）会同时不触发「未登记」与「陈旧」
 *     两条判据 ⇒ 判据照绿（QM-6 外部评审命中）。所以棘轮在这里是**双向**的：
 *     实际标记行数只允许 ≤ 登记数，超过即红；登记项所指文件已无标记 ⇒ 报陈旧红。
 *   - 覆盖范围如实划界：本判据被 `quality-gate.yml` 的 `changes` job 在**非 PR 早退之前**
 *     点名，所以 PR 档全覆盖（`pull_request` 触发**没有** paths 过滤）。main push 档则只覆盖
 *     「真的触发了这条 workflow 的 push」——push 侧有 `paths-ignore`（含 `openspec/**`、
 *     `01-docs/**`、`*.md`），纯文档 push 不生成 run。这一维之所以目前不构成漏洞，是因为
 *     main 的唯一写入通路是 PR（直推被 GH011 拒；ruleset `main-ci-gate` 的 `bypass_actors`
 *     实测为空）⇒ **若将来给 ruleset 加了旁路主体，这句话就失效**，届时要补 schedule 档。
 *
 * CLI 退出码三档，不得混档：
 *   0 合规 / 1 发现违规（未登记、登记项陈旧、已登记文件标记数超过基线）/
 *   2 判据自身故障（读不到仓库、列不到文件、受管文件读不出、承认清单形态不合法、
 *     以及 CLI 参数解析阶段的任何意外——**用法错误不得落到 1 档**，否则"判据坏了"
 *     会被读成"仓库里有标记"）。
 */
'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// 只认**行首**七个尖括号（后接空白或行尾）。七个等号**故意不在内**：它在本仓是合法的
// Markdown setext 下划线（实测 PRD-XHS 等文件有 5 处正当用法），一并禁掉就是造一条会假红的锁。
//
// ⚠ 行尾只由下面 `replace(/\r$/, '')` 这一处负责，字符类里**不得**再放 `\r`：
// 两道冗余机制会让彼此都变成不可证伪的实现（实测变异反证连续两轮 MISSED —— 摘掉任一道
// 另一道仍然兜住，于是没有任何用例能报警，锁看着有牙其实测不到东西）。
const MARKER_RE = /^(<{7}|>{7})([ \t]|$)/

/**
 * 承认清单：path -> { markers: 本轮实测的标记行数基线, reason: 为什么本轮没修 }。
 * `markers` 不是装饰：没有它，"只能缩小"只对了一半（收敛方向有陈旧红兜，扩张方向无人看）。
 * 形态不合法的登记项一律走**退出码 2**（判据自身故障），不得静默当成"没有基线约束"。
 */
const KNOWN_CONFLICT_MARKERS = {
  'openspec/records/batch-b-debounce-watch.md': {
    markers: 2,
    reason:
      'git stash pop 冲突被整块提交；两侧在 `QM-6 跨家族外部评审` 格里互相矛盾（`已执行` vs `待跑`），' +
      '去标记不等于选边。属他人会话的执行记录，按「不代其他会话改写其记录」纪律交属主会话或人工裁决',
  },
  'openspec/records/fix-learnings-encoding-damage.md': {
    markers: 2,
    reason: '同上形态；且 ours 侧存在跨行焊接（一节正文与取证命令粘在同一行），删标记无法修复，需要逐句重建',
  },
  'openspec/records/fix-xhs-api-chain-contract.md': {
    markers: 2,
    reason: '同上形态；ours 侧含 `### 故意没做的事` 等小节，标记之后又出现一次，需先定哪一侧是后来者',
  },
  'openspec/records/retire-changelog-dedup-auth.md': {
    markers: 2,
    reason: '同上形态；`### 与既有承诺的关系` / `### 遗留` 在小节里出现两次（hunk 内一次、hunk 后一次）',
  },
}

function listTrackedFiles(root) {
  // encoding 必须显式给：execFileSync 不带 encoding 返回 Buffer，而 Buffer 没有 .split
  // （踩过：判据以退出码 2 fail-closed 报 "out.split is not a function"）
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  return out.split('\0').filter(Boolean)
}

function findMarkers(root) {
  const hits = []
  const skipped = []
  let unreadable = 0
  const files = listTrackedFiles(root)
  for (const rel of files) {
    let raw
    try {
      raw = fs.readFileSync(path.join(root, rel))
    } catch (e) {
      const st = (() => {
        try {
          return fs.lstatSync(path.join(root, rel))
        } catch {
          return null
        }
      })()
      // 「本就不是普通文件」（目录 / 符号链接 / gitlink）不计违规，但**必须出声**并计数：
      // 它们不在扫描域内，静默跳过会让"域退化"读起来像"没有残留"。
      // 注意稀疏检出**不在这一支**——那种文件在磁盘上根本不存在，lstat 也失败 ⇒ 落 unreadable ⇒ rc 2。
      if (st && !st.isFile()) {
        skipped.push(rel)
        continue
      }
      unreadable++
      continue
    }
    const text = raw.toString('latin1') // 逐字节搬运：不做 UTF-8 解码，避免含 NUL/坏字节文件解析失败
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '')
      if (MARKER_RE.test(line)) {
        hits.push({
          file: rel,
          line: i + 1,
          kind: line.startsWith('<') ? 'ours' : 'theirs',
          // 检测走 latin1（字节安全），**展示必须回到 UTF-8**：否则中文标记行打印成乱码，
          // 读日志的人以为自己看到的是一行垃圾数据而跳过它
          text: Buffer.from(line.slice(0, 80), 'latin1').toString('utf8'),
        })
      }
    }
  }
  return { hits, total: files.length, unreadable, skipped }
}

function validateKnownShape(known, label) {
  const bad = []
  for (const [f, v] of Object.entries(known)) {
    const okShape =
      v &&
      typeof v === 'object' &&
      Number.isInteger(v.markers) &&
      v.markers >= 1 &&
      typeof v.reason === 'string' &&
      v.reason.trim().length > 0
    if (!okShape) bad.push(f)
  }
  if (bad.length) {
    throw new Error(
      `承认清单形态不合法（${label}）：${bad.length} 条必须写成 { markers: 整数>=1, reason: 非空 }，缺基线计数就不构成棘轮 —— ${bad.join(', ')}`,
    )
  }
}

function collect(root, { known = KNOWN_CONFLICT_MARKERS } = {}) {
  // `known` 必须是可注入的：把承认清单硬编进判据本体，任何非本仓的域（测试夹具、
  // 另一个 checkout）都会恒报"全部登记项陈旧"而 rc=1 —— 那样"干净仓库判 0"与
  // 两条负控就同时失去了意义（本仓另一条记忆点名的同族：root 写死让换 cwd 无效）。
  validateKnownShape(known, '内置清单或 --ack-file')
  const { hits, total, unreadable, skipped } = findMarkers(root)
  const byFile = new Map()
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, [])
    byFile.get(h.file).push(h)
  }
  const offending = [...byFile.keys()].sort()
  const violations = offending.filter((f) => !(f in known))
  const stale = Object.keys(known).filter((f) => !byFile.has(f)).sort()
  const grew = []
  const shrunken = []
  for (const f of offending) {
    const k = known[f]
    if (!k) continue
    const actual = byFile.get(f).length
    if (actual > k.markers) grew.push({ file: f, actual, registered: k.markers })
    else if (actual < k.markers) shrunken.push({ file: f, actual, registered: k.markers })
  }
  return { hits, offending, violations, stale, grew, shrunken, total, unreadable, skipped, byFile }
}

function selfFailure(msg) {
  process.stderr.write(`[no-conflict-markers] 判据自身故障：${msg}\n`)
  process.exit(2)
}

function main(argv) {
  // 整个主体都在 try 里：CLI 参数解析阶段的意外（例如 `--root` 漏值 ⇒ path.resolve(true)
  // 抛 TypeError）必须落**退出码 2**，不得以未捕获异常收场——那是 1 档，等于把"判据坏了"
  // 报成"仓库里有标记"（QM-6 外部评审 I4 实测命中）。
  let args
  let root
  let known
  try {
    args = new Map()
    for (const a of argv) {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/)
      if (m) args.set(m[1], m[2] === undefined ? true : m[2])
    }
    const rootArg = args.get('root')
    // 这里**刻意不再加** typeof 显式守卫：`path.resolve(true)` 自己会抛，而抛点已在 try 内 ⇒
    // 由 catch 统一收进 2 档。写两道兜底的后果是"摘掉任一道另一道仍兜住"，那条用例就变成
    // 对谁都不可证伪的装饰（本轮在同一份文件上已经为 \r 踩过一次，见 MARKER_RE 上方注释）。
    root = path.resolve(rootArg || process.cwd())
    // --ack-file 只服务判据自身的测试（夹具里没有那 4 篇被承认的文件，用内置清单会恒报陈旧）。
    // 它不构成绕过面：接线锁会断言 workflow 的调用行里不出现 --ack-file（见 .test.js 最后一条）。
    known = KNOWN_CONFLICT_MARKERS
    if (args.get('ack-file')) {
      known = JSON.parse(fs.readFileSync(path.resolve(String(args.get('ack-file'))), 'utf8'))
    }
  } catch (e) {
    selfFailure(`参数/清单装载失败：${e.message}`)
    return
  }

  let r
  try {
    r = collect(root, { known })
  } catch (e) {
    selfFailure(e.message)
    return
  }
  if (r.total === 0) {
    selfFailure('受管文件清单为空（不等于"没有标记"）')
    return
  }
  if (r.unreadable > 0) {
    selfFailure(`${r.unreadable} 个受管文件读不到，不能判定"无残留"`)
    return
  }

  const blocked = r.violations.length + r.stale.length + r.grew.length
  if (args.get('dry-run')) {
    process.stdout.write(
      `[no-conflict-markers] domain=${r.total} files_with_markers=${r.offending.length} marker_lines=${r.hits.length} ` +
        `violations=${r.violations.length} acknowledged=${Object.keys(known).length} stale=${r.stale.length} ` +
        `grew=${r.grew.length} skipped=${r.skipped.length}\n`,
    )
    process.exit(blocked > 0 ? 1 : 0)
  }

  if (r.violations.length) {
    process.stdout.write(
      `[no-conflict-markers] FAIL：检出 ${r.violations.length} 个未登记的冲突标记残留文件（全仓 ${r.total} 个受管文件）\n`,
    )
    for (const f of r.violations) {
      for (const h of r.byFile.get(f)) {
        process.stdout.write(`  ${f}:${h.line} [${h.kind}] ${JSON.stringify(h.text)}\n`)
      }
      process.stdout.write(`    修法：删标记行并保留两侧内容；确需保留则进 KNOWN_CONFLICT_MARKERS 带原因与基线计数（清单只能缩小）\n`)
    }
  }
  if (r.grew.length) {
    process.stdout.write(
      `[no-conflict-markers] FAIL：${r.grew.length} 个**已登记**文件的标记行数超过了登记基线（同一种事故又犯了一次，文件级承认把它读成"照旧"）\n`,
    )
    for (const g of r.grew) {
      process.stdout.write(`  grew: ${g.file} 实际=${g.actual} 登记基线=${g.registered}\n`)
      for (const h of r.byFile.get(g.file)) {
        process.stdout.write(`    ${g.file}:${h.line} [${h.kind}] ${JSON.stringify(h.text)}\n`)
      }
    }
    process.stdout.write('    修法：把新增的标记一并解掉；不得通过抬高基线交差（基线只能跟着实际数下降）\n')
  }
  if (r.stale.length) {
    process.stdout.write(`[no-conflict-markers] FAIL：${r.stale.length} 条承认项已不成立（文件已无标记或已消失），必须删除登记\n`)
    for (const f of r.stale) process.stdout.write(`  stale: ${f}\n`)
  }
  if (!blocked) {
    if (r.shrunken.length) {
      process.stdout.write(`（可见项，不拦截：${r.shrunken.length} 个已登记文件的标记数已低于基线，收口后请删登记 —— ${r.shrunken.map((s) => `${s.file} ${s.registered}→${s.actual}`).join('，')}）\n`)
    }
    process.stdout.write(
      `[no-conflict-markers] OK：冲突标记残留 ${r.offending.length} 个文件全部带原因登记且不超基线（域=${r.total} 个受管文件，标记行=${r.hits.length}，非普通文件跳过=${r.skipped.length}）\n`,
    )
    process.exit(0)
  }
  process.exit(1)
}

module.exports = {
  MARKER_RE,
  KNOWN_CONFLICT_MARKERS,
  listTrackedFiles,
  findMarkers,
  validateKnownShape,
  collect,
  main,
}

if (require.main === module) {
  main(process.argv.slice(2))
}

#!/usr/bin/env node
// PR 差量取源的单一实现（change: ban-record-closure-backfill-pr）。
//
// 为什么单独一个模块，而不是写在判据里：基线规格 `quality-gate-execution-record` 第一条
// Requirement 原文就写着「判据 SHALL 从该实现取值，MUST NOT 在判据内另写 git 解析」，
// 且该禁令已由两条在跑的锁钉住（判据源码禁 `execFileSync('git'`、禁第二份 git 解析）。
// 本 change 要跑 `git diff` —— 写进判据就是当着两条锁改代码；放宽那两条锁则是拆门。
//
// 分工口径（这条分界是本模块存在的全部理由）：
//   - 本模块只管 **git 取源 + diff 结构**（哪一行属于删除侧/新增侧、属于哪个文件、在不在代码围栏里）。
//   - **状态词表不住在这里**。`ROW_RE` / `CLOSED_RE` / `DERIVED_MARKER_RE` 仍住在判据里，
//     由判据把自己的口径传进来。两份词表必然漂移，而漂移方向是"换个新词绕过"或"误伤合法新词"。
//
// 取 diff 的三条口径都是实测钉出来的：
//   1) 三点式 `<base>...<head>`（merge-base 语义）。两点式会把别人在 base 之后改过的文件
//      拉进"本 PR 触碰集"——实测两点式文件集 2 / 三点式 1。⚠️ 注意可分辨的是**文件集**，
//      不是红集：两者红集在本轮对照实验里逐字相同，所以任何只断言红集的测试都锁不住这条。
//   2) `--no-renames`。开了 rename 检测，改名会呈现为一次 `R`，删除侧那一行就不再作为
//      `-` 出现 ⇒ "改名 + 顺手改写收口行"这条绕道会静默通过。与 merge-ledger 同口径。
//   3) `-c core.quotepath=off`。中文记录名是真实存在的（`远程同步-锁定.md` 这类），
//      转义后路径键永久对不上，表现为"这条记录永远测不到"，且不报错。

const { execFileSync } = require('node:child_process')

const FENCE_RE = /^\s*(```|~~~)/
const DEV_NULL = '/dev/null'

function runGit(cwd, args) {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// diff 文本 → 每个记录文件的「删除侧行 / 新增侧行」，并逐行标注是否落在代码围栏内。
// 围栏状态按两侧各自跟踪：`-` 行属于旧文件、`+` 行属于新文件，两侧围栏可以不同。
// 已知边界：unified=0 的 hunk 只给被改的那几行，所以围栏状态在每个 hunk 起点按"在围栏外"
// 起算。要误判必须有一个跨越 hunk 边界、且内部包含以 `|` 开头的示例行的超长代码块 ——
// 本仓记录里没有这种形态；这条边界如实写着，不假装它已被证明不存在。
function splitDiffLines(diffText, recordsRel = 'openspec/records') {
  const files = new Map()
  let cur = null
  let oldFence = false
  let newFence = false
  const prefix = recordsRel.replace(/\\/g, '/').replace(/\/$/, '') + '/'

  for (const raw of diffText.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('diff --git ')) {
      // 以 b/ 侧为准；b/ 侧是 /dev/null（文件被删）时退回 a/ 侧 —— 删除侧的那一行
      // 必须还能归属到这篇记录，否则"整删 + 另增"就把配对拆到两个文件上绕开锁。
      const m = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line)
      const nameOf = (p) => {
        const n = (p || '').replace(/\\/g, '/')
        if (!n.startsWith(prefix)) return null
        const rest = n.slice(prefix.length)
        return !rest || rest.includes('/') ? null : rest
      }
      const name = m ? nameOf(m[2]) || nameOf(m[1]) : null
      cur = name ? { name } : null
      oldFence = false
      newFence = false
      if (cur && !files.has(cur.name)) {
        files.set(cur.name, { removed: [], added: [], deletedFile: false, addedFile: false })
      }
      continue
    }
    if (!cur) continue
    const rec = files.get(cur.name)
    // 删除/新增的判据只能来自 `--- a/…` / `+++ b/…`：git 对删除也写 `a/X b/X` 同名头，
    // 只看 diff 头会把"整删一篇记录"误判成普通修改 —— F4 那条绕道正是靠这个区别成立的。
    if (line === '--- /dev/null') { rec.addedFile = true; continue }
    if (line === '+++ ' + DEV_NULL) { rec.deletedFile = true; continue }
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')) continue
    if (line.startsWith('-')) {
      const text = line.slice(1)
      if (FENCE_RE.test(text)) oldFence = !oldFence
      else rec.removed.push({ text, inFence: oldFence })
    } else if (line.startsWith('+')) {
      const text = line.slice(1)
      if (FENCE_RE.test(text)) newFence = !newFence
      else rec.added.push({ text, inFence: newFence })
    }
  }
  return files
}

// 取源：只返回原始 diff 文本与"取到了没有"，不做任何词表判断。
function buildClosureDiff({ baseRef, headRef = 'HEAD', cwd = process.cwd(), recordsRel = 'openspec/records' } = {}) {
  if (!baseRef || !headRef) {
    return { ok: false, reason: 'ref-unresolvable', detail: 'baseRef/headRef 都必须显式给出' }
  }
  // 两步区分，与 merge-ledger 同一口径：`rev-parse` 对"不在仓库里"和"仓库里没有这个 ref"
  // 都只回 128。混成一个码，就会把"判据装错了目录"报成"分支还没建好"，
  // 而这两种情况的修法完全相反（前者修接线，后者等 fetch）。
  try {
    runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  } catch (e) {
    return { ok: false, reason: 'not-a-repository', detail: e.message }
  }
  try {
    for (const r of [baseRef, headRef]) runGit(cwd, ['rev-parse', '--verify', `${r}^{commit}`])
  } catch (e) {
    return { ok: false, reason: 'ref-unresolvable', detail: e.message }
  }
  let diff = ''
  try {
    diff = runGit(cwd, [
      'diff', '--no-renames', '--unified=0', '--no-color',
      `${baseRef}...${headRef}`, '--', `${recordsRel}/`,
    ])
  } catch (e) {
    return { ok: false, reason: 'git-failed', detail: e.message }
  }
  return { ok: true, diff, baseRef, headRef, recordsRel }
}

module.exports = { buildClosureDiff, splitDiffLines }

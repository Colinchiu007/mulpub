"use strict"

// 测试收集接线棘轮：本仓没有任何机制会自动收集 scripts/ 与 .github/scripts/ 下的测试。
// vitest 只覆盖 apps/desktop 等 workspace，根 package.json 的 test 是 `pnpm -r run test`，
// 所以一条新写的 node --test / bash 测试若不同 PR 登记进 .github/workflows，它就永远不会执行，
// 而且没有任何东西会因此变红。本脚本把这条规矩变成门禁：
// 检查域内每个测试文件必须被某个 workflow 的**可执行正文**点名（注释不算）；
// 豁免只允许按欠账登记，且清单只能缩小。
//
// 检查域**不再是两个写死的目录**，而是「整仓减去显式声明的排除项」。旧口径把域钉死在
// scripts/ 与 .github/scripts/，于是落在两目录之外的测试文件对棘轮**完全隐身**。实测漏例：
// `.quality-rhythm/.github/scripts/tpl-contract.test.js` 被同目录那份
// `.quality-rhythm/.github/workflows/mechanism-check.yml` 用 `node --test` 点名，看起来"已接线"，
// 但 GitHub 只执行**仓库顶层**的 .github/workflows/，那份嵌套 workflow 永远不会被调度 ⇒
// 一条"看着是门禁、实际零执行"的死锁。故本文件同时新增 NESTED_WORKFLOW_NOT_EXECUTED。

const fs = require("node:fs")
const path = require("node:path")

const TEST_SUFFIXES = [".test.js", ".test.mjs", ".test.sh", ".test.ps1"]

// 排除项必须**逐个带理由**地写在这里，且只能缩小（test 侧用 deepEqual 钉住）。
// WORKSPACE_COVERED：由 vitest 按 workspace 自动收集，不属于"没人点名"这一类。
const WORKSPACE_COVERED = ["apps/", "packages/", "ops-center/"]
// VENDORED_MIRROR：上游技能制品的 vendored 副本（含它自带的 .github/workflows），
// 不是本仓的被测代码；本仓 CI 不去执行它，也不把它内部的 *.test.* 计入检查域。
// 这一条同时也是 NESTED_WORKFLOW_NOT_EXECUTED 的白名单——新增嵌套 workflow 必须先在这里显式承认。
const VENDORED_MIRROR = [".quality-rhythm/"]
// 目录级剪枝：构建产物与依赖，永远不是本仓测试源。
const PRUNE_DIRS = [".git", "node_modules", "dist", "dist-electron", "coverage", ".playwright-browsers", ".next", "build"]

// 欠账登记：path -> 不可省略的原因。只能缩小，新增即红（与 platform-definitions 棘轮同形）。
// 2026-09-27 把 scripts 下 7 条 PowerShell 测试逐个实跑分档（本机 pwsh 7.6 / PS 5.1 各一遍，
// 再以 runner 首跑为准）：6 条接进 Gate 2d，1 条按硬证据登记欠账（不是"没试过"）。
// session-write-guard 曾在欠账里（runner 红、本机绿），根因是夹具与真实工作树不同形，已修并回接：
// 判「runner 端差异」时先问这一维是不是**可配置的**（git 全局配置、shell、环境变量都算），
// 可配置就能在本机用 GIT_CONFIG_GLOBAL 指到临时配置文件复现，不属于"只有 runner 知道"那一类。
// 2026-09-29：最后一条 session-isolation-automation.test.ps1 已销账，清单归零。
// 它的旧登记理由有两处过期，在此记下以免有人照旧口径重新挂欠账：
//   ① "未知量是 runner 进程令牌是否提权" —— 不成立。该测试自己就按实测分两条支路
//     （AtLogOn 注册成功 ⇒ 断言两条任务在；被 0x80070005 拒绝 ⇒ 断言 installer fail-closed
//     且输出点名 RunAs），所以它不依赖提权与否，两条支路都该绿。
//   ② 真阻塞根本不是计划任务，而是**前三条断言要求的工作树形态 CI 不给**：
//     actions/checkout 是 detached HEAD（健康检查 -RequirePrimary 硬要 branch=main）、
//     CI 从不装 hooks。正解是不改断言、改夹具：Gate 2d 在 $RUNNER_TEMP 造一个自有临时
//     clone（checkout -B main + 复制两个 hook）再在里面跑；本机以同样配方复现过，
//     两档 shell 各 18 条 PASS。
// 清单空了不等于机制可以拆：它一拆，"新写一条测试不接线"就又回到无人发现的状态。
const KNOWN_UNWIRED = {}

// 接线**资格**登记：path -> 为什么它必须住在"没有被整体跳过"的 job 里。只能缩小，新增必须带理由。
//
// 为什么需要这一档：上面那条判据只问"测试文件在不在 workflow 可执行正文里"，它答不了
// "点名所在的 job 会不会被整片跳过"。当一条锁的输入落在 docs-only 白名单（CI_IGNORED_PATHS）内时，
// 接在有 `if: needs.changes.outputs.docs-only != 'true'` 的 job 里 = **在这类 PR 上一次都不跑**，
// 于是漂移可以合法全绿合入。实测（2026-10-08）：vendored 契约镜像锁只住在 static-gates，
// 归档 PR #3114 在 PR 侧 `QG Changes=pass` / `QG Static=skipping` 下合并，main 的 push 才红
// （run 37716816985，step `Gate 2b`，`not ok 2 - 镜像不得自行发明或漏掉 Requirement`），
// 一次性卡住当时所有 open PR 的 QG Static。
//
// 口径刻意保持**精确**：不做"从测试源码里正则提取路径字面量再和白名单求交"的启发式判据。
// 实测理由（同一轮做的两遍清点）：第一遍按字面量匹配得 6 条"可疑"，逐条核到"是否真的用 fs 读到了
// 仓库内那个文件"后只剩 1 条 —— 其余 5 条全是夹具里编出来的假路径。启发式硬红会一次引入 5 个假阳，
// 那种门禁的结局是逼人绕过，与没有门禁更糟。所以：新增白名单输入的锁时，**登记由人做、正确性由本判据锁**。
// 登记值刻意**结构化**成两个字段：reason 说明"为什么必须住在不被跳过的 job"，
// resolveWhen 说明"什么时候可以销账"。合成一句散文的写法（上一版）只能被子串绊线糊过去
// ——「销账条件：无」也算通过 includes("销账")，那是把形式合规当成校验（QM-6 maintainability 轴实测指出）。
const MUST_LIVE_IN_UNGATED_JOB = {
  "scripts/openspec-sync-check.test.js": {
    reason:
      "它审计的两类输入 .ccg/** 与 openspec/** 都在 docs-only 白名单内（实测 CI_IGNORED_PATHS 14 条里占这两条），" +
      "而它原先只接在 static-gates（该 job 带 if: needs.changes.outputs.docs-only != true 的门槛）" +
      "⇒ 纯文档 PR 可以改坏被审计文件，却让这把锁一次都不跑（实测：真实仓库当场 rc=2 / 14 条违规，无人看）",
    resolveWhen:
      "它被点名进 changes job（无 job 级 if 的那类面），或 .ccg/openspec 从 CI_IGNORED_PATHS 移出",
  },

  "scripts/quality-rhythm-spec-mirror.test.js": {
    reason:
      "输入含 openspec/specs/openspec-integration/spec.md，而 openspec/** 在 docs-only 白名单内 ⇒ " +
      "纯文档 PR 可以改真源却让这条锁一次都不跑（实测：归档 PR #3114 全绿合入，main push 才红）",
    resolveWhen:
      "该锁的输入不再命中 CI_IGNORED_PATHS，或它本身被删（那会同时触发本清单的 stale 红）",
  },
}

// 嵌套 workflow 承认清单：path -> 为什么允许它存在但永不执行。只能缩小，新增即红。
// 这类文件的危害不是"没跑测试"，而是**看起来像门禁**：正文里写着 node --test，读的人以为
// 有东西在守；实际 GitHub 只调度仓库顶层的 .github/workflows/，嵌套那份永远不会被排队执行。
const KNOWN_NESTED_WORKFLOWS = {
  ".quality-rhythm/.github/workflows/mechanism-check.yml":
    "质量节拍技能的 vendored 副本自带一份上游 CI 配置，本仓不会执行它；它与副本内的 " +
    ".quality-rhythm/.github/scripts/tpl-contract.test.js 同属制品内容，本仓的契约由 " +
    "scripts/quality-rhythm-spec-mirror.test.js（Gate 2b）对真源逐 Requirement 钉死",
}

// 测试域排除 = workspace（vitest 已收集）+ vendored 副本（不是本仓被测代码）。
// 注意：VENDORED_MIRROR **只排除测试域**，不排除遍历——否则里面那份永不执行的 workflow
// 就看不见，而"承认它是副本"这件事就退化成了无人核对的默认值。
const TEST_DOMAIN_EXCLUDED = [...WORKSPACE_COVERED, ...VENDORED_MIRROR]

function inAnyPrefix(relPosix, prefixes) {
  return prefixes.some((p) => relPosix.startsWith(p))
}

// 全仓遍历（不跟随链接：Windows 上 worktree 的 node_modules 里全是 junction，跟随会跨到别处）。
// 返回相对 root 的正斜杠路径清单。剪枝 PRUNE_DIRS 与 workspace 目录，保证不遍历依赖与构建产物。
function walkRepoFiles(root) {
  const out = []
  const absRoot = path.resolve(root)
  const stack = [""]
  while (stack.length) {
    const rel = stack.pop()
    const abs = rel ? path.join(absRoot, rel) : absRoot
    let entries
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch (error) {
      // 读不动的目录必须出声：静默跳过就是"以不完整遍历判定全绿"（同 R3 链接扫描的教训）
      throw new Error(`无法枚举目录 ${abs}：${error && error.message}（遍历不完整时本门禁拒绝判定）`)
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isSymbolicLink() || e.isFIFO() || e.isSocket()) continue
      if (e.isDirectory()) {
        if (PRUNE_DIRS.includes(e.name) || inAnyPrefix(childRel + "/", WORKSPACE_COVERED)) continue
        stack.push(childRel)
        continue
      }
      if (!e.isFile()) continue
      out.push(childRel)
    }
  }
  return out.sort()
}

// 嵌套的 workflow 文件：GitHub 只调度仓库顶层 .github/workflows/ 下的文件，
// 任何 `.../.github/workflows/*.yml` 都是**永远不会被执行**的配置副本。
function isNestedWorkflow(relPosix) {
  return /(^|\/)\.github\/workflows\/.*\.(yml|yaml)$/.test(relPosix) && !relPosix.startsWith(".github/workflows/")
}

function listTestFiles(root) {
  return walkRepoFiles(root)
    .filter((rel) => !inAnyPrefix(rel, TEST_DOMAIN_EXCLUDED))
    .filter((rel) => TEST_SUFFIXES.some((s) => rel.endsWith(s)))
    .sort()
}

function listNestedWorkflows(root) {
  return walkRepoFiles(root).filter(isNestedWorkflow).sort()
}

// 注释里提到文件名不构成接线：反证实测过「删掉 run 行、只留注释」仍被判绿。
// 逐行剥掉 YAML 注释（行首 # 或前置空白后的 #）。
function stripComments(text) {
  return text
    .split(/\r?\n/)
    .map(line => {
      const idx = line.search(/(^|\s)#/)
      return idx < 0 ? line : line.slice(0, idx)
    })
    .join("\n")
}

function readWorkflowText(root) {
  const dir = path.join(root, ".github", "workflows")
  if (!fs.existsSync(dir)) {
    throw new Error(`未找到 workflows 目录：${dir}（解析退化会让本门禁假绿）`)
  }
  const files = fs.readdirSync(dir).filter(f => /\.(yml|yaml)$/.test(f))
  if (files.length === 0) throw new Error(`${dir} 下没有 workflow 文件，拒绝以空集合判定全部未接线`)
  return stripComments(files.map(f => fs.readFileSync(path.join(dir, f), "utf8")).join("\n"))
}

// 同名 basename 会让「按文件名点名」串到另一个文件上，那种情况要求 workflow 写全相对路径。
/**
 * 列出每个 workflow 里每个 job 的：是否被 job 级 `if:` 整片门控 + 它的可执行正文（已剥注释）。
 * 判"接线住在哪"必须靠这个，而不是靠整份文件做 includes —— 后者会把"接在会被跳过的 job"读成已接线。
 */
function listJobBlocks(root) {
  const dir = path.join(root, ".github", "workflows")
  if (!fs.existsSync(dir)) throw new Error(`未找到 workflows 目录：${dir}（解析退化会让本判据假绿）`)
  const names = fs.readdirSync(dir).filter(f => /\.(yml|yaml)$/.test(f)).sort()
  if (names.length === 0) throw new Error(`${dir} 下没有 workflow 文件，拒绝以空集合判定接线资格`)
  const jobs = []
  for (const name of names) {
    const lines = fs.readFileSync(path.join(dir, name), "utf8").replace(/\r\n/g, "\n").split("\n")
    let inJobs = false
    let cur = null
    let runIndent = -1 // step 的 run 键所在缩进；-1 = 不在 run 正文里
    for (const line of lines) {
      if (/^jobs:\s*$/.test(line)) { inJobs = true; cur = null; continue }
      if (!inJobs) continue
      if (/^\S/.test(line)) { inJobs = false; cur = null; continue }
      // 整行注释先跳过：它既不是 job 键，也不是点名（实测本仓 build.yml 里有两空格缩进的
      // `  # --- docs-only 短路判定（change: ...）`，不先跳会被下面的"未知 job 键"判据误抛）。
      if (/^\s*#/.test(line)) continue
      const key = line.match(/^  ([A-Za-z0-9_-]+):\s*$/)
      if (key) {
        cur = { workflow: name, name: key[1], gated: false, code: "" }
        runIndent = -1
        jobs.push(cur)
        continue
      }
      // 两空格缩进 = job 层级的键。认不出来就必须抛错：把它当普通正文继续累加到**上一个 job**，
      // 会让那个 job 冒充成"点名的承载者"——被误读的方向是假绿，正是本判据要消灭的形态。
      // （GitHub Actions 的 job_id 只允许字母/数字/下划线/短横；出现别的写法说明解析器看不懂，
      //  而不是仓库合法 —— 所以这里 fail closed，不做"宽松匹配"。）
      const unknown = line.match(/^  (\S[^:]*):(\s|$)/)
      if (unknown) {
        throw new Error(
          `无法识别的 job 键：${name} -> 「${unknown[1]}」（workflow 的 job_id 只允许字母/数字/下划线/短横）。` +
          "静默跳过会把它的正文累加到上一个 job 上，从而伪造出「有不被跳过的 job 点名」的结论",
        )
      }
      if (!cur) continue
      // 判"整个 job 被门控"只看**缩进层级**：job 的直接子键恰为 4 空格，step 级 if 写作
      // `- if:`（6 空格 + 短横）或 `        if:`（8 空格），都不可能被 ^    if: 命中。
      // job 级 `env:` 的子键同理落在 6 空格，因此一个叫 `IF` 的环境变量也不会被误判成门控。
      // 这里刻意**不**要求"出现在 steps: 之前"——YAML 映射的键序是自由的，把 if: 写在 steps: 之后
      // 同样是 job 级门控；按位置判会漏，且漏的方向是假绿（把会被跳过的 job 读成不被跳过）。
      if (/^    if:\s*\S/.test(line)) cur.gated = true
      // "可执行正文"的口径 = **step 的 run/script/command 体**（含 `- run: x` 那一行本身）。
      // 只按缩进把 job 正文全收会吃掉 `env:\n  TARGET: scripts/x.test.js` 这种 YAML 映射值 ——
      // 那是把一个字符串塞进环境，不会执行任何东西，当成点名同样是假绿方向。
      // 出块判据用缩进（比 run 键更缩进才算正文），所以多行 `run: |` 里的每条命令都被覆盖。
      if (/^\s*(?:-\s+)?(?:run|script|command):/.test(line)) runIndent = line.length - line.trimStart().length
      else if (runIndent >= 0 && (line.trim() === "" || line.length - line.trimStart().length > runIndent)) {
        // 仍在 run 正文里（空行无害，一并收）
      } else if (runIndent >= 0) runIndent = -1
      if (runIndent < 0) continue
      // 行尾注释同样不算接线（与 readWorkflowText 用的 stripComments 同口径）：
      // `- run: echo # node --test scripts/x.test.js` 里那个文件名是注释，不是执行。
      const ci = line.search(/(^|\s)#/)
      cur.code += (ci < 0 ? line : line.slice(0, ci)) + "\n"
    }
  }
  if (jobs.length === 0) throw new Error("workflow 里一个 job 都没解析出来 —— 解析退化不得读成「没有需要核对的接线」")
  return jobs
}

function escapeRegExp (s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * 接线资格判据：登记表里的每条锁，必须至少被一个「无 job 级 if」的 job 点名。
 *
 * 点名匹配的三条口径，方向全是**假绿**，所以宁可严一档：
 * ① 整相对路径也必须带词边界 —— `env: TARGET=scripts/x.test.js` 这类"变量字面量"不是执行；
 * ② basename 回退只在**该 basename 全仓唯一**时才允许（与 collectCheck 的歧义守卫同口径），
 *    否则 `scripts/a/x.test.js` 会冒领 `scripts/b/x.test.js` 的点名；
 * ③ 行尾注释在 listJobBlocks 里已剥掉，注释里的文件名不算执行。
 */
/**
 * 点名匹配（三条例外全是**假绿**方向，所以宁可严一档）：
 * ① 只在 step 的 run 正文里找（`env: TARGET: scripts/x.test.js` 那种 YAML 值不执行任何东西）；
 * ② 命中位置前后必须是词边界 —— 排除字母/数字/`_`/`-`/`=`/`$`（`TARGET=scripts/x.test.js`
 *    与 `scripts/ba.test.js` 都不得算命中）。**已知残余**：允许前置 `/` 与 `.`，所以
 *    `other/dir/scripts/x.test.js` 这种"以登记路径结尾的更长路径"仍会算命中；本仓 run 正文
 *    一律写仓库相对路径，故按实测保留这个残余，不在这里发明第二条路径语义；
 * ③ basename 回退只在**该 basename 全仓唯一**时允许（与 collectCheck 的歧义守卫同口径），
 *    否则 `scripts/a/x.test.js` 会冒领 `scripts/b/x.test.js` 的点名。
 */
function mentionsFile(code, file, base, ambiguousBasename) {
  const BOUND = "(^|[^A-Za-z0-9_\\-=$])"
  if (new RegExp(BOUND + escapeRegExp(file) + "(?![A-Za-z0-9_-])").test(code)) return true
  if (ambiguousBasename) return false
  return new RegExp(BOUND + escapeRegExp(base) + "(?![A-Za-z0-9_-])").test(code)
}

function ackReason(ack) {
  return typeof ack === "string" ? ack : String((ack && ack.reason) || "")
}

function collectUngatedCheck(files, registry, jobs) {
  const violations = []
  const stale = []
  const baseCount = new Map()
  for (const f of files) {
    const b = path.basename(f)
    baseCount.set(b, (baseCount.get(b) || 0) + 1)
  }
  for (const [file, ack] of Object.entries(registry)) {
    if (!files.includes(file)) {
      // 文件没了却还登记着：要么删登记、要么文件被"顺手"删掉逃避判据 —— 两种都要红
      stale.push({ code: "UNGATED_WIRING_ACK_STALE", file, reason: ackReason(ack) })
      continue
    }
    const base = path.basename(file)
    const hits = jobs.filter((j) => mentionsFile(j.code, file, base, (baseCount.get(base) || 0) > 1))
    const ungated = hits.filter(j => !j.gated)
    if (ungated.length === 0) {
      violations.push({
        code: "TEST_ONLY_IN_SKIPPABLE_JOB",
        file,
        where: hits.length ? hits.map(h => `${h.workflow}::${h.name}(gated)`).join(", ") : "未被任何 job 点名",
        reason: ackReason(ack),
      })
    }
  }
  return { violations, stale }
}

// 第 4 参 ungatedRegistry 的缺省值是 `{}`，即"不查接线资格"——这是**刻意与前三参不对称**：
// exemptions/nestedAcks 缺省成生产清单（夹具也会跑到），而 registry 缺省成空集，
// 因为既有 12 条夹具里没有 jobs: 段，listJobBlocks 会按"解析退化"抛错（那是 fail closed 的正确方向）。
// 不变量：**跑真判据必须显式传第 4 参**（run() 与真实仓库用例都传了）；将来谁新增一条
// 只传三参的"真实仓库"用例，它测的就不是本判据 —— 评审要看这一点，别照 3 参形态抄。
function collectCheck(root, exemptions = KNOWN_UNWIRED, nestedAcks = KNOWN_NESTED_WORKFLOWS, ungatedRegistry = {}) {
  const files = listTestFiles(root)
  const workflows = readWorkflowText(root)
  const basenameCount = new Map()
  for (const file of files) {
    const base = path.basename(file)
    basenameCount.set(base, (basenameCount.get(base) || 0) + 1)
  }

  const violations = []
  const staleExemptions = []
  for (const file of files) {
    const base = path.basename(file)
    const ambiguous = (basenameCount.get(base) || 0) > 1
    const referenced = ambiguous ? workflows.includes(file) : workflows.includes(base)
    if (!referenced && !exemptions[file]) {
      violations.push({ code: "TEST_NOT_COLLECTED_BY_CI", file, ambiguous })
    }
    if (referenced && exemptions[file]) {
      staleExemptions.push({ code: "TEST_EXEMPTION_STALE", file })
    }
  }
  // 嵌套 workflow 单独一档：它不是"测试没接线"，而是"配置看着像门禁、实际永不排队执行"。
  const nestedFiles = listNestedWorkflows(root)
  const nested = []
  for (const f of nestedFiles) {
    if (!nestedAcks[f]) nested.push({ code: "NESTED_WORKFLOW_NOT_EXECUTED", file: f })
  }
  const staleNested = []
  for (const f of Object.keys(nestedAcks)) {
    if (!nestedFiles.includes(f)) staleNested.push({ code: "NESTED_WORKFLOW_ACK_STALE", file: f })
  }

  // 接线资格（第二问：它接的那个 job 会不会被整片跳过）。
  // 只在登记表非空时解析 job 结构 —— 解析器对"一个 job 都解析不出来"是抛错的（fail-closed），
  // 而单元测试的玩具夹具本来就没有 jobs: 段，不该被这条牵制。
  let ungatedViolations = []
  let staleUngated = []
  if (Object.keys(ungatedRegistry).length > 0) {
    const jobs = listJobBlocks(root)
    ;({ violations: ungatedViolations, stale: staleUngated } = collectUngatedCheck(files, ungatedRegistry, jobs))
  }

  return { files, violations, staleExemptions, nested, staleNested, nestedFiles, ungatedViolations, staleUngated }
}

function run(root) {
  const {
    files, violations, staleExemptions, nested, staleNested, ungatedViolations, staleUngated,
  } = collectCheck(root, KNOWN_UNWIRED, KNOWN_NESTED_WORKFLOWS, MUST_LIVE_IN_UNGATED_JOB)
  const findings = [...violations, ...staleExemptions, ...nested, ...staleNested, ...ungatedViolations, ...staleUngated]
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ ok: findings.length === 0, checked: files.length, findings }, null, 2) + "\n")
  } else {
    process.stdout.write(`检查域内测试文件 ${files.length} 个\n`)
    for (const v of violations) {
      process.stdout.write(
        `  未接线 ${v.file}${v.ambiguous ? "（同名文件存在，须写全相对路径）" : ""} —— ` +
          "本仓不自动收集 scripts/ 下的测试，必须在 .github/workflows 正文里点名\n",
      )
    }
    for (const s of staleExemptions) {
      process.stdout.write(`  豁免已过时 ${s.file} —— 它已被 CI 收集，请删除 KNOWN_UNWIRED 条目\n`)
    }
    for (const n of nested) {
      process.stdout.write(
        `  嵌套 workflow 永不执行 ${n.file} —— GitHub 只调度仓库顶层 .github/workflows/；` +
          "要么删掉，要么在 KNOWN_NESTED_WORKFLOWS 里带理由承认\n",
      )
    }
    for (const n of staleNested) {
      process.stdout.write(`  过时的嵌套 workflow 承认 ${n.file} —— 文件已不在，请删除该条\n`)
    }
    for (const u of ungatedViolations) {
      process.stdout.write(
        `  接线不住在不被跳过的 job ${u.file} —— 它只被点名在 ${u.where}；` +
          `该测试的输入命中 docs-only 白名单（登记原因：${u.reason}），` +
          `所以在纯文档 PR 上一次都不会跑。正解：把它的点名补进 changes job，而不是把登记删掉\n`,
      )
    }
    for (const u of staleUngated) {
      process.stdout.write(`  过时的接线资格登记 ${u.file} —— 该测试文件已不在检查域内，请删除登记（或说明它被谁替代）\n`)
    }
    if (findings.length === 0) process.stdout.write("OK: 全部测试均已接线或按欠账登记\n")
  }
  return { exitCode: findings.length === 0 ? 0 : 1, findings }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2)
    const rootArg = args.find(a => a.startsWith("--root="))
    const root = rootArg ? path.resolve(rootArg.slice(7)) : process.cwd()
    process.exitCode = run(root).exitCode
  } catch (error) {
    process.stderr.write(`ERROR: ${error && error.message}\n`)
    process.exitCode = 2
  }
}

module.exports = {
  listTestFiles,
  listNestedWorkflows,
  listJobBlocks,
  collectUngatedCheck,
  walkRepoFiles,
  readWorkflowText,
  stripComments,
  collectCheck,
  run,
  KNOWN_UNWIRED,
  KNOWN_NESTED_WORKFLOWS,
  MUST_LIVE_IN_UNGATED_JOB,
  TEST_SUFFIXES,
  WORKSPACE_COVERED,
  VENDORED_MIRROR,
  TEST_DOMAIN_EXCLUDED,
}

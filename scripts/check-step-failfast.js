"use strict"

// CI 步骤 fail-fast 棘轮。
// 实测事故：`run: |` 块里塞多条测试命令时，GitHub 的 PowerShell 步骤**不会**在中间某条
// 非零退出时中止 —— 只有最后一条命令的 $LASTEXITCODE 决定步骤成败。于是
// `session-write-guard.test.ps1` 在 runner 上抛 FAIL 之后，后面的测试照跑、步骤照绿
// （run 36313053992 / step "Gate 2d"）。这种步骤看起来是门禁，实际是装饰。
// 口径：一个 run 块里执行 ≥2 条受管命令时，必须**逐条**显式 fail-fast
// —— 要么整步 shell: bash（GitHub 默认 `bash -e -o pipefail`），要么**每条命令后面各跟一条**自己的退出码检查。
//
// ⛔ 第 2 轮纠正（2026-10-13，实测 run 38339739342）：原先的判据是"整块正文里出现过 $LASTEXITCODE 就算合规"，
// 于是 Gate 3 那种「8 文件的 node --test（无守卫）+ check-hardcoded-secrets.js（无守卫）+ 最后一条命令带守卫」
// 的形状**通过**了本棘轮，而它正是吞红的那一个：该 step 日志里 `# fail 1`（workflow-contract 的 Gate 9 断言），
// conclusion 却是 success。判据测的是"有没有写守卫"，不是"每一条都被守住"——这就是装饰性棘轮。
// 另两处同源纠正：①受管集合此前只数测试文件，`node .github/scripts/check-*.js` 这类**门禁脚本**不计数
// （Gate 10 两条命令、一条测试一条门禁脚本 ⇒ 旧判据连"多命令步骤"都没识别出来）；
// ②shell 只看步骤自己，不看 job 级 `defaults: run: shell:`（debt-guard / electron-ci 是 job 级 bash，
// 只看步骤会把它们误报成违规）。空值 `shell:`（gui-test.yml:31-32 形状）**不得**当成 bash。
// ③第 3 轮由 CI 实测打穿的第三个落点：未声明 shell 时的默认档**取决于 runner 的 OS**，不是恒定 pwsh。
// `business-api-postgres` 是 runs-on: ubuntu-latest ⇒ 默认 bash（GitHub 给 bash 带 -e -o pipefail，本来就
// 逐条中止），我按 pwsh 给它塞了一条 PowerShell 守卫，runner 当场报 syntax error near unexpected token。
// ④同轮第四个落点：stepShell 原先"往上找 12 行内第一个 shell:"，**会跨过步骤边界**读到兄弟步骤的 shell
// （Gate 2d 的 shell: bash 与 Gate 3 相距 37 行才恰好没撞上——那是靠距离躲过的，不是靠机制）。
// 现在上溯遇 `- name:` 或另一个 `run:` 即停：归属只在自己的步骤内成立。

const fs = require("node:fs")
const path = require("node:path")

// 既有欠账：file::step 名 -> 原因。只能缩小，新增即红。
const KNOWN_NON_FAIL_FAST = {}

const TEST_INVOCATION = /(\bnode\s+(?:--test\s+\S|\S*\.test\.(?:js|mjs))|\bbash\s+\S*\.test\.sh|\b(?:pwsh|powershell)\b[^|\n]*-File\s+\S*\.test\.ps1|\bpytest\b|\bpython\s+-m\s+pytest)/
// 门禁脚本：以 node 跑一个 .js 文件（非 --test、非 -e 内联）。它们的非零退出同样"应当让步骤失败"，
// 不纳入受管集合就会让"一条测试 + 一条门禁脚本"的装饰步骤连多命令形态都不被识别。
const GATE_INVOCATION = /^\s*node\s+(?:--\S+\s+)*["']?[\w./\\-]+\.js(?:\s|$)/
// 内联 `node -e` 不当受管命令：它自己就是常见的手工守卫（内部 process.exit），且常常是多行块的续行。
const INLINE_NODE = /^\s*node\s+-e\b/
// 同行守卫：「&&」（失败即不继续）与「|| exit」（失败即中止）算守住；「|| true」/「|| echo」是把失败吃掉，
// 不得算——否则「node 门禁脚本 || echo 忽略」这种装饰形状会顺利通过本棘轮。
const SAME_LINE_GUARD = /&&|\$LASTEXITCODE|\|\|\s*exit\b/
const NEXT_GUARD = /\$LASTEXITCODE|\bexit\s+\$LASTEXITCODE|throw\b/
const JOB_KEY = /^  ([\w.-]+):\s*$/
const JOB_SHELL = /^\s+shell:\s*(\S*)\s*$/
// 值取到行尾：runs-on: [self-hosted, linux] 这种数组形态必须整段看见，否则只读到 "[self-hosted," 会推错
const RUNS_ON_LINE = /^\s+runs-on:\s*(.+?)\s*$/
const SHELL_LINE = /^\s*shell:\s*(\S+)/
const RUN_BLOCK = /^(\s*)run:\s*[|>]\s*$/
const NAME_LINE = /^(\s*)-\s*name:\s*(.+)$/

function stepName(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    const m = lines[i].match(NAME_LINE)
    if (m) return m[2].trim().replace(/^["']|["']$/g, "")
    const other = lines[i].match(/^\s*-\s/)
    if (other && i !== idx) return "(未命名步骤)"
  }
  return "(未知步骤)"
}

function stepShell(lines, idx, indent) {
  for (let i = idx; i >= 0; i--) {
    if (lines[i].trim() === "") continue
    // 边界即停：本步骤之外的 shell 都不属于本步骤的归属链（兄弟泄漏此前只靠距离侥幸没撞上）
    // 起点那一行就是本步骤自己的 run:，所以两个边界判据都必须先排除 i === idx,
    // 否则一上来就早退，shell 永远读不到（第 1 版就是这么把 3 条既有用例打红的）。
    if (i !== idx && /^\s*-\s*name:/.test(lines[i])) return "(默认)"
    if (i !== idx && /^\s*run:/.test(lines[i])) return "(默认)"
    const own = lines[i].match(/^(\s*)/)
    if (own && own[1].length <= indent.length && !/^\s*#/.test(lines[i])) {
      const s = lines[i].match(SHELL_LINE)
      if (s) return s[1]
    }
    if (i < idx - 12) break
    const s = lines[i].match(SHELL_LINE)
    if (s) return s[1]
  }
  return "(默认)"
}

/** job 级默认 shell（`defaults:\n  run:\n    shell: bash`）。空值一律不算声明了 bash。 */
function jobShellMap(lines) {
  const map = new Map()
  let job = null
  for (let i = 0; i < lines.length; i++) {
    const jm = lines[i].match(JOB_KEY)
    if (jm) { job = jm[1]; continue }
    if (!job) continue
    if (/^\s+defaults:\s*$/.test(lines[i])) {
      for (let k = i + 1; k <= Math.min(lines.length - 1, i + 4); k++) {
        const s = lines[k].match(JOB_SHELL)
        if (s) { map.set(job, s[1] === '' ? '(空值)' : s[1]); break }
      }
    }
  }
  return map
}

function enclosingJob(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    const m = lines[i].match(JOB_KEY)
    if (m) return m[1]
  }
  return null
}

/** 作业级 runs-on（每个作业取第一个出现的值）。 */
function jobRunsOnMap(lines) {
  const map = new Map()
  let job = null
  for (let i = 0; i < lines.length; i++) {
    const jm = lines[i].match(JOB_KEY)
    if (jm) { job = jm[1]; continue }
    if (!job || map.has(job)) continue
    const rm = lines[i].match(RUNS_ON_LINE)
    if (rm) map.set(job, rm[1])
  }
  return map
}

/**
 * 未声明 shell 时的默认档由 runner OS 决定（GitHub 的默认 shell 不是全局常量）：
 * windows → pwsh；ubuntu/macos/linux → bash。推不出返回 null ⇒ 调用方保守判「要逐条守卫」。
 * 两个猜错的后果都实测过：把 bash 当 pwsh = 往真 bash 步骤里塞 PowerShell 语法（runner 语法错误）；
 * 把 pwsh 当 bash = 漏掉吞红。所以宁可保守也不猜。
 */
function defaultShellForRunsOn(runsOn) {
  const v = String(runsOn == null ? "" : runsOn).toLowerCase().trim()
  if (v === "" || v.includes("{{")) return null
  if (v.includes("windows")) return "pwsh"
  if (v.includes("ubuntu") || v.includes("macos") || v.includes("linux")) return "bash"
  return null
}

function collectCheck(root) {
  const dir = path.join(root, ".github", "workflows")
  if (!fs.existsSync(dir)) throw new Error(`未找到 workflows 目录：${dir}（解析退化会让本门禁假绿）`)
  const files = fs.readdirSync(dir).filter(f => /\.(yml|yaml)$/.test(f)).sort()
  if (files.length === 0) throw new Error(`${dir} 下没有 workflow 文件，拒绝以空集合判定全部合规`)

  const violations = []
  let stepsScanned = 0
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n").split("\n")
    const jobShells = jobShellMap(lines)
    const jobRunsOns = jobRunsOnMap(lines)
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(RUN_BLOCK)
      if (!m) continue
      const indent = m[1]
      const body = []
      for (let k = i + 1; k < lines.length; k++) {
        if (lines[k].trim() === "") continue
        const ind = lines[k].match(/^(\s*)/)[1]
        if (ind.length <= indent.length) break
        body.push(lines[k])
      }
      // 受管命令 = 测试命令 ∪ 门禁脚本（逐行判，行号留着给 hint 定位）
      const managed = []
      body.forEach((text, at) => {
        if (INLINE_NODE.test(text)) return
        if (TEST_INVOCATION.test(text) || GATE_INVOCATION.test(text)) managed.push({ text, at })
      })
      if (managed.length < 2) continue
      stepsScanned++
      const stepShellValue = stepShell(lines, i, indent)
      const jobKeyHere = enclosingJob(lines, i)
      let shell = stepShellValue
      if (shell === '(默认)') shell = jobShells.get(jobKeyHere) || '(默认)'
      if (shell === '(默认)') shell = defaultShellForRunsOn(jobRunsOns.get(jobKeyHere)) || '(默认)'
      const name = stepName(lines, i)
      // 逐条配对：每条受管命令必须被"自己"守住 —— 整步 bash，或同行 && / **紧邻的下一行**是退出码检查。
      // 窗口取 1 行而不是若干行：放宽到 3 行时，"给第 N 条写的守卫"会顺手把第 N-1 条也判成已守住，
      // 而 Gate 3 的吞红形状恰好就是"两条无守卫 + 末尾一条守卫"——实测该放宽让 Gate 3 报 uncovered=0（假绿）。
      const uncovered = /^bash$/.test(shell) ? [] : managed.filter((m) => {
        if (SAME_LINE_GUARD.test(m.text)) return false
        const next = body[m.at + 1]
        return !(typeof next === 'string' && NEXT_GUARD.test(next))
      })
      const key = `${f}::${name}`
      if (uncovered.length > 0 && !KNOWN_NON_FAIL_FAST[key]) {
        const where = uncovered.map((m) => m.text.trim().slice(0, 56)).join(' ; ')
        violations.push({ code: "STEP_NOT_FAIL_FAST", key, shell, tests: managed.length, uncovered: uncovered.length, hint: `shell: ${shell}，${managed.length} 条受管命令里 ${uncovered.length} 条没被自己的退出码检查守住：${where}` })
      }
      if (uncovered.length === 0 && KNOWN_NON_FAIL_FAST[key]) {
        violations.push({ code: "STEP_EXEMPTION_STALE", key, shell, tests: managed.length, hint: "该步骤已逐条 fail-fast，请删除欠账登记" })
      }
    }
  }
  return { stepsScanned, violations }
}

function run(root) {
  const { stepsScanned, violations } = collectCheck(root)
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ ok: violations.length === 0, multiTestSteps: stepsScanned, violations }, null, 2) + "\n")
  } else {
    process.stdout.write(`含 ≥2 条受管命令的 run 步骤：${stepsScanned} 个\n`)
    for (const v of violations) process.stdout.write(`  ${v.code} ${v.key} —— ${v.hint}\n`)
    if (violations.length === 0) process.stdout.write("OK: 所有多测试步骤均 fail-fast（或已按欠账登记）\n")
  }
  return { exitCode: violations.length === 0 ? 0 : 1, violations }
}

if (require.main === module) {
  try {
    const rootArg = process.argv.slice(2).find(a => a.startsWith("--root="))
    process.exitCode = run(rootArg ? path.resolve(rootArg.slice(7)) : process.cwd()).exitCode
  } catch (error) {
    process.stderr.write(`ERROR: ${error && error.message}\n`)
    process.exitCode = 2
  }
}

module.exports = { collectCheck, run, KNOWN_NON_FAIL_FAST, TEST_INVOCATION, GATE_INVOCATION, jobShellMap, jobRunsOnMap, defaultShellForRunsOn, enclosingJob }

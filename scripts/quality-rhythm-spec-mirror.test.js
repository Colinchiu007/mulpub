"use strict"

// 质量节拍 vendored 契约镜像漂移锁：
// .quality-rhythm/integrations/openspec/spec-contract.md 是 openspec/specs/openspec-integration/spec.md
// 分发到其他仓库时的契约副本。真源每次增删 Requirement 或 Scenario，镜像必须同步——
// 此前只有人肉同步（#2479 只补了其中一句），本锁负责把它变成会红的东西。

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const LIVE_SPEC = path.join(__dirname, "..", "openspec", "specs", "openspec-integration", "spec.md")
const MIRROR_SPEC = path.join(
  __dirname,
  "..",
  ".quality-rhythm",
  "integrations",
  "openspec",
  "spec-contract.md",
)

const REQUIREMENT_HEADING = /^### Requirement: (.+)$/

// 一个 Requirement 块 = 从该标题起到下一个任意级标题（# / ## / ### / ####不切开，
// 因为 Scenario 属于同一块）之前。这里以 ### 与 ## / # 为界，保证 Scenario 留在块内。
function readRequirementBlocks(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n")
  const blocks = new Map()
  let current = null
  for (const line of lines) {
    const heading = line.match(REQUIREMENT_HEADING)
    if (heading) {
      current = { title: heading[1].trim(), lines: [line] }
      blocks.set(current.title, current.lines)
      continue
    }
    if (current && /^#{1,3} /.test(line)) {
      current = null
      continue
    }
    if (current) current.lines.push(line)
  }
  for (const [title, body] of blocks) {
    while (body.length && body[body.length - 1].trim() === "") body.pop()
    blocks.set(title, body.join("\n"))
  }
  return blocks
}

function scenarioTitles(block) {
  return block
    .split("\n")
    .filter(line => line.startsWith("#### Scenario: "))
    .map(line => line.replace(/^#### Scenario: /, "").trim())
}

const live = readRequirementBlocks(LIVE_SPEC)
const mirror = readRequirementBlocks(MIRROR_SPEC)

test("真源 spec 与 vendored 镜像都解析出 Requirement（防止解析退化成空集合假绿）", () => {
  assert.ok(live.size >= 11, `真源解析到的 Requirement 数异常：${live.size}`)
  assert.ok(mirror.size >= 11, `镜像解析到的 Requirement 数异常：${mirror.size}`)
})

test("镜像不得自行发明或漏掉 Requirement", () => {
  assert.deepEqual(
    [...mirror.keys()].sort(),
    [...live.keys()].sort(),
    "vendored 契约镜像的 Requirement 清单与真源不一致",
  )
})

test("镜像每个 Requirement 块与真源逐行全等", () => {
  const drifted = []
  for (const title of [...live.keys()].sort()) {
    if (!mirror.has(title)) continue
    if (mirror.get(title) !== live.get(title)) drifted.push(title)
  }
  assert.deepEqual(
    drifted,
    [],
    `以下 Requirement 在真源已变更而 vendored 镜像未同步：${drifted.join("、")}`,
  )
})

test("镜像每个 Requirement 的 Scenario 清单与真源一致（漂移时报具体缺哪个）", () => {
  const diffs = []
  for (const title of [...live.keys()].sort()) {
    if (!mirror.has(title)) continue
    const liveSet = scenarioTitles(live.get(title)).sort()
    const mirrorSet = scenarioTitles(mirror.get(title)).sort()
    if (liveSet.join("|") !== mirrorSet.join("|")) {
      diffs.push(`${title}: 真源=[${liveSet.join(", ")}] 镜像=[${mirrorSet.join(", ")}]`)
    }
  }
  assert.deepEqual(diffs, [], "Scenario 清单漂移：\n" + diffs.join("\n"))
})

// 同一目录里还有一对「脚本 vendored 副本」：openspec-sync-check.js 由
// scripts/openspec-sync-check.test.js 自己守着，affected-report.js 此前无人守。
const BYTE_MIRRORS = [
  [
    "scripts/affected-report.js",
    ".quality-rhythm/skills/other/ci-hardening/scripts/affected-report.js",
  ],
]

test("vendored 脚本副本与仓库真源逐字节一致", () => {
  const root = path.join(__dirname, "..")
  for (const [source, copy] of BYTE_MIRRORS) {
    const srcFile = path.join(root, source)
    const copyFile = path.join(root, copy)
    const src = fs.readFileSync(srcFile, "utf8").replace(/\r\n/g, "\n").trimEnd()
    const dst = fs.readFileSync(copyFile, "utf8").replace(/\r\n/g, "\n").trimEnd()
    assert.ok(src.length > 0, `真源为空：${source}`)
    assert.equal(dst, src, `vendored 副本与真源不一致：${copy} <-> ${source}`)
  }
})

/* ------------------------------------------------------------------ *
 * 接线资格两锁（2026-10-08，动因见下）
 *
 * 这条漂移锁此前只点名在 quality-gate.yml 的 static-gates，而那个 job 有
 * `if: needs.changes.outputs.docs-only != 'true'`，且它的输入 `openspec/**` 在 docs-only
 * 白名单里 ⇒ 只改主规格的 PR 上它一次都不跑。实测代价：归档 PR #3114 全绿合并
 * （QG Changes=pass / QG Static=skipping），main 的 push 才红，一次卡住所有 open PR。
 * 现在它必须住在至少一个「没有 job 级 if」的 job 里，由下面第一条锁钉住。
 * ------------------------------------------------------------------ */

const SELF_BASENAME = "quality-rhythm-spec-mirror.test.js"

/**
 * 按两空格缩进的 job 键切分 jobs: 段，返回 [{ name, hasJobLevelIf, code }]。
 * code = 该 job 的可执行正文（已剥 YAML 注释行）—— 注释里提一句文件名不构成接线。
 *
 * 这是生产判据 `scripts/check-unwired-tests.js` 的 listJobBlocks 的**第二份实现**，
 * 理由不是"判据不同域"（那话不成立：两边判的都是 job 级 if 门控），而是：
 * 本锁要能在生产解析器**自己坏掉**时仍然给出独立结论，否则一条锁引用的解析函数和被它保护的
 * 判据共用同一个 bug，会一起沉默放行。代价是口径漂移风险 —— 由下面那条
 * 「两份解析器逐 job 同结论」的差分锁封住（一边修一半必须红）。
 */
function parseJobs(workflowText) {
  const text = workflowText.replace(/\r\n/g, "\n")
  const jobsAt = text.search(/^jobs:\s*$/m)
  assert.ok(jobsAt >= 0, "workflow 里没有 jobs: 段（解析退化时本锁必须红，不得判通过）")
  const lines = text.slice(jobsAt).split("\n")
  const jobs = []
  let cur = null
  for (const line of lines) {
    const key = line.match(/^  ([A-Za-z0-9_-]+):\s*$/)
    if (key) {
      cur = { name: key[1], hasJobLevelIf: false, code: "" }
      jobs.push(cur)
      continue
    }
    if (!cur) continue
    if (/^    if:\s*\S/.test(line)) cur.hasJobLevelIf = true
    if (/^  \S/.test(line) && !key) cur = null
    if (/^\s*#/.test(line)) continue
    cur.code += line + "\n"
  }
  return jobs
}

function workflowsInRepo() {
  const dir = path.join(__dirname, "..", ".github", "workflows")
  const names = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))
  assert.ok(names.length > 0, "workflows 目录为空 —— 解析退化不得读成「没有需要接线的 job」")
  return names.map((f) => ({ file: f, text: fs.readFileSync(path.join(dir, f), "utf8") }))
}

test("本锁的 job 解析必须与生产判据 listJobBlocks 逐 job 同结论（两份实现必须互证）", () => {
  // 这里刻意留着第二份解析器（parseJobs），但**不许它只是重复**：
  // 两份实现若各修一半，漂移必须在这一条锁上暴露，而不是各自沉默地放行。
  // 上一版的注释写的是"两者判据不同域"——那是不诚实的措辞（判的都是 job 级 if 门控），已按实测改掉。
  const root = path.join(__dirname, "..")
  const { listJobBlocks, domainFiles } = require("./check-unwired-tests.js")
  // 第 2 个实参是 #85 起的必传项：job 清单由 git 的域给出，而不是由磁盘目录给出。
  const prod = listJobBlocks(root, domainFiles(root))
    .filter((j) => j.workflow === "quality-gate.yml")
    .map((j) => `${j.name}|${j.gated ? "gated" : "ungated"}`)
  const wfText = fs.readFileSync(path.join(root, ".github", "workflows", "quality-gate.yml"), "utf8")
  const mine = parseJobs(wfText).map((j) => `${j.name}|${j.hasJobLevelIf ? "gated" : "ungated"}`)
  assert.ok(prod.length >= 5, `生产判据只解析到 ${prod.length} 个 job —— 规模下界防"解析退化成空集合"`)
  assert.deepEqual(mine, prod, "两份 job 解析器口径漂移：一边修的 bug 不得让另一边继续放行")
})

test("本锁必须被点名在至少一个没有 job 级 if 的 job 里（docs-only 短路的 job 不算接线）", () => {
  const all = []
  let ungatedHits = 0
  let gatedHits = 0
  for (const wf of workflowsInRepo()) {
    for (const job of parseJobs(wf.text)) {
      if (!job.code.includes(SELF_BASENAME)) continue
      all.push(`${wf.file}::${job.name}${job.hasJobLevelIf ? "(gated)" : "(ungated)"}`)
      if (job.hasJobLevelIf) gatedHits++
      else ungatedHits++
    }
  }
  // 反失明两条：一次都没解析到 = 接线丢了或被改名；全在被短路的 job 里 = 本轮修的那个洞
  assert.ok(
    all.length > 0,
    `${SELF_BASENAME} 没有被任何 workflow 的 job 正文点名 —— 要么接线丢了，要么 job 段落解析退化；两种都不允许读成通过`,
  )
  assert.ok(
    ungatedHits > 0,
    `本锁只住在会被整体跳过的 job 里（${all.join(", ")}）—— 纯文档 PR 上它一次都不跑，` +
      `漂移只能等 main 的 push 才红（#3114 形态）。请把它点名进 changes job`,
  )
})

test("本锁的依赖面只能是 node 内置模块（changes job 没有 Install deps）", () => {
  const src = fs.readFileSync(path.join(__dirname, SELF_BASENAME), "utf8")
  const requires = [...src.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
  assert.ok(requires.length >= 4, `依赖面解析退化（只解析到 ${requires.length} 个 require）—— 空集合会让本锁恒真`)
  const builtins = new Set(require("node:module").builtinModules)
  const external = requires.filter(
    (r) => !(r.startsWith("node:") || builtins.has(r.replace(/^node:/, "")) || r.startsWith("./") || r.startsWith("../")),
  )
  assert.deepEqual(
    external,
    [],
    `本锁引入了第三方包 ${JSON.stringify(external)} —— 它同时被点名在没有 Install deps 的 changes job，` +
      `那里 require 任何 npm 包都会当场 MODULE_NOT_FOUND（本机有 node_modules 复现不了）。` +
      `正解顺序：①换成 node 内置实现 ②把工具函数落在本仓 scripts/ 下用相对路径 require（相对路径已放行，` +
      `它不需要安装）③最后才考虑把这条锁从 changes job 摘掉——那等于拆掉本轮修的防线，必须同步改接线锁`,
  )
})

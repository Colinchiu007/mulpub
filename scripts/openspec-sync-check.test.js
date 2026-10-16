"use strict"

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { test } = require("node:test")

const checker = require("./openspec-sync-check.js")

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openspec-sync-check-"))
  fs.mkdirSync(path.join(root, ".ccg", "tasks"), { recursive: true })
  fs.mkdirSync(path.join(root, "openspec", "changes", "archive"), { recursive: true })
  return root
}

function writeJson(root, relativePath, value) {
  const file = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), "utf8")
}

function writeChange(root, relativePath) {
  fs.mkdirSync(path.join(root, "openspec", "changes", relativePath), { recursive: true })
}

function completedTask(id, change) {
  return { id, status: "completed", currentPhase: "completed", openspecChange: change }
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true })
}

test("dated archive satisfies a completed task", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/archive/2026-08/demo/task.json", completedTask("demo", "demo-change"))
    writeChange(root, "archive/2026-08-15-demo-change")
    const result = checker.scanRepository(root)
    assert.equal(result.ok, true)
    assert.equal(result.exitCode, 0)
    assert.deepEqual(result.violations, [])
  } finally {
    cleanup(root)
  }
})

test("completed task linked to active change is a business violation", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/demo/task.json", completedTask("demo", "demo-change"))
    writeChange(root, "demo-change")
    const result = checker.scanRepository(root)
    assert.equal(result.ok, false)
    assert.equal(result.exitCode, 1)
    assert.ok(result.violations.some(item => item.code === "COMPLETED_TASK_ACTIVE_CHANGE"))
  } finally {
    cleanup(root)
  }
})

test("array associations are checked independently", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/demo/task.json", completedTask("demo", ["archived-change", "active-change"]))
    writeChange(root, "archive/2026-08-15-archived-change")
    writeChange(root, "active-change")
    const result = checker.scanRepository(root)
    assert.equal(result.exitCode, 1)
    assert.equal(result.violations.filter(item => item.code === "COMPLETED_TASK_ACTIVE_CHANGE").length, 1)
  } finally {
    cleanup(root)
  }
})

test("active and dated archive conflict is an input error", () => {
  const root = makeRepo()
  try {
    writeChange(root, "same-change")
    writeChange(root, "archive/2026-08-15-same-change")
    const result = checker.scanRepository(root)
    assert.equal(result.exitCode, 2)
    assert.ok(result.errors.some(item => item.code === "ACTIVE_ARCHIVE_CONFLICT"))
  } finally {
    cleanup(root)
  }
})

test("duplicate dated archives are an input error", () => {
  const root = makeRepo()
  try {
    writeChange(root, "archive/2026-08-14-same-change")
    writeChange(root, "archive/2026-08-15-same-change")
    const result = checker.scanRepository(root)
    assert.equal(result.exitCode, 2)
    assert.ok(result.errors.some(item => item.code === "DUPLICATE_ARCHIVE"))
  } finally {
    cleanup(root)
  }
})

test("malformed and non-object task JSON are input errors", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/bad/task.json", "{")
    writeJson(root, ".ccg/tasks/array/task.json", ["not a task"])
    const result = checker.scanRepository(root)
    assert.equal(result.exitCode, 2)
    assert.equal(result.errors.filter(item => item.code === "TASK_JSON_INVALID").length, 2)
  } finally {
    cleanup(root)
  }
})

test("invalid association IDs are rejected before filesystem lookup", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/bad/task.json", completedTask("bad", "../escape"))
    const result = checker.scanRepository(root)
    assert.equal(result.exitCode, 2)
    assert.ok(result.errors.some(item => item.code === "INVALID_CHANGE_ID"))
  } finally {
    cleanup(root)
  }
})

test("completed task with no matching change is a business violation", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/demo/task.json", completedTask("demo", "missing-change"))
    const result = checker.scanRepository(root)
    assert.equal(result.exitCode, 1)
    assert.ok(result.violations.some(item => item.code === "CHANGE_NOT_FOUND"))
  } finally {
    cleanup(root)
  }
})

test("completed status requires a terminal phase", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/demo/task.json", {
      ...completedTask("demo", "demo-change"),
      currentPhase: "review",
    })
    writeChange(root, "archive/2026-08-15-demo-change")
    const result = checker.scanRepository(root)
    assert.equal(result.exitCode, 2)
    assert.ok(result.errors.some(item => item.code === "TASK_STATE_INCONSISTENT"))
  } finally {
    cleanup(root)
  }
})

test("terminal phase requires completed status", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/demo/task.json", {
      id: "demo",
      status: "in_progress",
      currentPhase: "archived",
      openspecChange: "demo-change",
    })
    writeChange(root, "archive/2026-08-15-demo-change")
    const result = checker.scanRepository(root)
    assert.equal(result.exitCode, 2)
    assert.ok(result.errors.some(item => item.code === "TASK_STATE_INCONSISTENT"))
  } finally {
    cleanup(root)
  }
})

// ===================== 真实仓库自证（openspec-sync-realrepo，2026-10-16）=====================
//
// 上面每一条都在 os.tmpdir() 里自建夹具仓库 ⇒ 它们证的是"判据本体正确"，不是"真实仓库合规"。
// 而 CI 只跑这个文件，所以真实仓库当场 rc=2 / 14 条违规这件事，**从来没有被任何东西看过一眼**。
// 还有一层：这个文件原先只接在 static-gates（`if: needs.changes.outputs.docs-only != 'true'`），
// 而它审计的两类输入 `.ccg/**` 与 `openspec/**` **都在 docs-only 白名单里**（实测
// `scripts/classify-docs-only.js` 的 CI_IGNORED_PATHS 14 条中占两条）⇒ 这把锁只可能出现在
// "结构上碰不到被审计文件"的 PR 上，接线等于没接（AGENTS 的"前提锁"正是为此而写）。
//
// 因此这条锁有三个不可省的构件，缺一个它就退化成又一盏恒绿的装饰灯：
//   ① 对**真实仓库根**跑，不建夹具；
//   ② 取不到 `.ccg/tasks` 或 `openspec/changes` 一律**当场红**——禁止 skip，
//      因为"根目录没找到 ⇒ 静默跳过"与"找到了且合规"在通过消息里完全同形；
//   ③ 规模下界：扫描到的 task.json 数必须远大于夹具规模，否则扫描域塌成空集时
//      "零违规"读起来跟通过一模一样。
const REPO_ROOT = path.join(__dirname, "..")

test("真实仓库：审计器必须对仓库本体跑一次且退出码为 0", () => {
  for (const required of [".ccg/tasks", "openspec/changes"]) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, required)),
      `反失明：仓库根 ${REPO_ROOT} 下找不到 ${required} —— 这条锁正在测量一个不存在的对象`)
  }
  const result = checker.scanRepository(REPO_ROOT)
  const findings = [...result.errors, ...result.violations]
  console.log(
    `[openspec-sync/real-repo] summary=${JSON.stringify(result.summary)}` +
    ` exitCode=${result.exitCode} findings=${findings.length}`,
  )
  assert.ok(
    result.summary.taskFiles > 50,
    `反失明（规模下界）：真实仓库只扫到 taskFiles=${result.summary.taskFiles} 个 task.json，` +
    "说明扫描域退化；此时“零违规”不构成通过证据",
  )
  const detail = findings.slice(0, 20).map(item => `  ${item.code} ${item.file || item.change || ""}`).join("\n")
  assert.equal(
    result.exitCode,
    0,
    `真实仓库必须自证合规（errors=${result.errors.length} violations=${result.violations.length}）：\n${detail}`,
  )
})

test("superseded tasks require non-empty replacement evidence", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/demo/task.json", {
      ...completedTask("demo", "retired-change"),
      openspecState: "superseded",
      supersededBy: "   ",
    })
    const result = checker.scanRepository(root)
    assert.equal(result.exitCode, 2)
    assert.ok(result.errors.some(item => item.code === "SUPERSESSION_EVIDENCE_MISSING"))
    assert.ok(result.violations.some(item => item.code === "CHANGE_NOT_FOUND"))
  } finally {
    cleanup(root)
  }
})

test("superseded task with replacement evidence may reference a missing change", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/demo/task.json", {
      ...completedTask("demo", "retired-change"),
      openspecState: "superseded",
      supersededBy: "PR #717",
    })
    const result = checker.scanRepository(root)
    assert.equal(result.ok, true)
    assert.equal(result.exitCode, 0)
  } finally {
    cleanup(root)
  }
})

test("completed task linked to active change reports missing task tracking", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/demo/task.json", completedTask("demo", "demo-change"))
    writeChange(root, "demo-change")
    const result = checker.scanRepository(root)
    assert.equal(result.exitCode, 1)
    assert.ok(result.violations.some(item => item.code === "ACTIVE_CHANGE_TASKS_MISSING"))
  } finally {
    cleanup(root)
  }
})

test("completed task linked to active change reports untracked and incomplete task lists", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/demo/task.json", completedTask("demo", "demo-change"))
    writeChange(root, "demo-change")
    writeJson(root, "openspec/changes/demo-change/tasks.md", "# Tasks\n\nNo checkboxes here.\n")
    let result = checker.scanRepository(root)
    assert.equal(result.exitCode, 1)
    assert.ok(result.violations.some(item => item.code === "ACTIVE_CHANGE_TASKS_UNTRACKED"))

    writeJson(root, "openspec/changes/demo-change/tasks.md", "- [x] done\n- [ ] pending\n")
    result = checker.scanRepository(root)
    const incomplete = result.violations.find(item => item.code === "ACTIVE_CHANGE_TASKS_INCOMPLETE")
    assert.equal(incomplete.incomplete, 1)
  } finally {
    cleanup(root)
  }
})

test("quality-rhythm checker template remains source-aligned", () => {
  const rootScript = fs.readFileSync(path.join(__dirname, "openspec-sync-check.js"), "utf8")
  const templateScript = fs.readFileSync(
    path.join(__dirname, "..", ".quality-rhythm", "integrations", "openspec", "openspec-sync-check.js"),
    "utf8",
  )
  assert.equal(
    templateScript.replace(/\r\n/g, "\n").trimEnd(),
    rootScript.replace(/\r\n/g, "\n").trimEnd(),
  )
})

test("CLI human and JSON modes share the same nonzero result", () => {
  const root = makeRepo()
  try {
    writeJson(root, ".ccg/tasks/bad/task.json", "{")
    const script = path.join(__dirname, "openspec-sync-check.js")
    const human = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" })
    const machine = spawnSync(process.execPath, [script, "--root", root, "--json"], { encoding: "utf8" })
    assert.equal(human.status, 2)
    assert.equal(machine.status, 2)
    const payload = JSON.parse(machine.stdout)
    assert.equal(payload.ok, false)
    assert.ok(payload.errors.some(item => item.code === "TASK_JSON_INVALID"))
    assert.doesNotMatch(human.stdout, /OK:/)
  } finally {
    cleanup(root)
  }
})

test("duplicated task id inside tasks.md is flagged", () => {
  const root = makeRepo()
  try {
    writeChange(root, "demo-change")
    writeJson(root, "openspec/changes/demo-change/tasks.md", [
      "# Tasks",
      "",
      "- [x] 1.1 first task",
      "- [x] 1.2 deliver the widget",
      "- [ ] 1.2 deliver the widget",
      "",
    ].join("\n"))
    const result = checker.scanRepository(root)
    assert.equal(result.exitCode, 1)
    const dup = result.violations.find(item => item.code === "TASKS_MD_DUPLICATE_TASK_ID")
    assert.ok(dup, "expected a TASKS_MD_DUPLICATE_TASK_ID violation")
    assert.equal(dup.change, "demo-change")
    assert.equal(dup.task, "1.2")
    assert.equal(dup.count, 2)
  } finally {
    cleanup(root)
  }
})

test("numbering gap inside archived tasks.md is flagged", () => {
  const root = makeRepo()
  try {
    writeChange(root, "archive/2026-08-15-old-change")
    writeJson(root, "openspec/changes/archive/2026-08-15-old-change/tasks.md", "- [x] 1.1 a\n- [x] 1.3 c\n")
    const result = checker.scanRepository(root)
    const gap = result.violations.find(item => item.code === "TASKS_MD_NUMBERING_GAP")
    assert.ok(gap, "expected a TASKS_MD_NUMBERING_GAP violation")
    assert.equal(gap.change, "old-change")
    assert.deepEqual(gap.missing, ["1.2"])
    assert.equal(result.exitCode, 1)
  } finally {
    cleanup(root)
  }
})

test("well-formed tasks.md passes the integrity checks", () => {
  const root = makeRepo()
  try {
    writeChange(root, "demo-change")
    writeJson(root, "openspec/changes/demo-change/tasks.md", "- [x] 1.1 a\n- [x] 1.1.1 nested one\n- [x] 1.1.2 nested two\n- [x] 1.2 b\n- [ ] 2.1 c\n- [ ] 2.2 d\n- [ ] sub item without number\n")
    const result = checker.scanRepository(root)
    assert.deepEqual(result.violations.filter(item => item.code.startsWith("TASKS_MD_")), [])
  } finally {
    cleanup(root)
  }
})

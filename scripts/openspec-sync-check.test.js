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

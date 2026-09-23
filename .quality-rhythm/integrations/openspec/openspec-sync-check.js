#!/usr/bin/env node
"use strict"

const fs = require("node:fs")
const path = require("node:path")

const CHANGE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATED_ARCHIVE_RE = /^(\d{4}-\d{2}-\d{2})-(.+)$/
const TERMINAL_PHASES = new Set(["completed", "archived"])

function normalizeRelative(root, file) {
  return path.relative(root, file).split(path.sep).join("/")
}

function collectTaskFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectTaskFiles(fullPath, output)
    else if (entry.isFile() && entry.name === "task.json") output.push(fullPath)
  }
  return output
}

function collectChangeDirectories(directory, exclude = new Set()) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !exclude.has(entry.name))
    .map(entry => entry.name)
    .sort()
}

function normalizeAssociations(value, file, errors) {
  if (value === undefined || value === null) return []
  const values = Array.isArray(value) ? value : [value]
  if (values.length === 0) {
    errors.push({ code: "INVALID_CHANGE_ID", file, message: "openspecChange must not be an empty array" })
    return []
  }
  const associations = []
  for (const item of values) {
    const change = typeof item === "string" ? item.trim() : ""
    if (!change || !CHANGE_ID_RE.test(change)) {
      errors.push({
        code: "INVALID_CHANGE_ID",
        file,
        value: item,
        message: "openspecChange must be a kebab-case string or a non-empty array of kebab-case strings",
      })
      continue
    }
    if (!associations.includes(change)) associations.push(change)
  }
  return associations
}

function indexChanges(root, errors) {
  const changesDirectory = path.join(root, "openspec", "changes")
  const archiveDirectory = path.join(changesDirectory, "archive")
  const active = new Set(collectChangeDirectories(changesDirectory, new Set(["archive"])))
  const archives = new Map()

  for (const directoryName of collectChangeDirectories(archiveDirectory)) {
    const match = directoryName.match(DATED_ARCHIVE_RE)
    const change = match ? match[2] : directoryName
    if (!CHANGE_ID_RE.test(change)) {
      errors.push({
        code: "INVALID_ARCHIVE_NAME",
        file: normalizeRelative(root, path.join(archiveDirectory, directoryName)),
        message: "archive directory must be <change-id> or YYYY-MM-DD-<change-id>",
      })
      continue
    }
    const entries = archives.get(change) || []
    entries.push(directoryName)
    archives.set(change, entries)
  }

  for (const [change, entries] of archives) {
    if (entries.length > 1) {
      errors.push({ code: "DUPLICATE_ARCHIVE", change, archives: entries, message: "multiple archive directories map to the same change" })
    }
    if (active.has(change)) {
      errors.push({ code: "ACTIVE_ARCHIVE_CONFLICT", change, archives: entries, message: "change exists in both active and archive directories" })
    }
  }

  return { active, archives }
}

function hasSupersessionEvidence(task) {
  return task.openspecState === "superseded"
    && typeof task.supersededBy === "string"
    && task.supersededBy.trim().length > 0
}

function inspectActiveChangeTasks(root, change) {
  const tasksFile = path.join(root, "openspec", "changes", change, "tasks.md")
  const file = normalizeRelative(root, tasksFile)
  if (!fs.existsSync(tasksFile)) {
    return [{
      code: "ACTIVE_CHANGE_TASKS_MISSING",
      change,
      file,
      message: "active OpenSpec change has no tasks.md for completed CCG task",
    }]
  }

  let content
  try {
    content = fs.readFileSync(tasksFile, "utf8")
  } catch (error) {
    return [{
      code: "ACTIVE_CHANGE_TASKS_UNREADABLE",
      change,
      file,
      message: "active OpenSpec change tasks.md could not be read: " + error.message,
    }]
  }

  const checkboxes = [...content.matchAll(/^\s*-\s*\[([ xX])\]\s+/gm)]
  if (checkboxes.length === 0) {
    return [{
      code: "ACTIVE_CHANGE_TASKS_UNTRACKED",
      change,
      file,
      message: "active OpenSpec change tasks.md has no trackable task checkboxes",
    }]
  }

  const incomplete = checkboxes.filter(match => match[1] === " ").length
  if (incomplete === 0) return []
  return [{
    code: "ACTIVE_CHANGE_TASKS_INCOMPLETE",
    change,
    file,
    incomplete,
    total: checkboxes.length,
    message: "active OpenSpec change has " + incomplete + " incomplete tracked task(s)",
  }]
}

function inspectTasksMdIntegrity(root, changeRelDir, changeId) {
  const tasksFile = path.join(root, "openspec", "changes", changeRelDir, "tasks.md")
  if (!fs.existsSync(tasksFile)) return []
  let content
  try {
    content = fs.readFileSync(tasksFile, "utf8")
  } catch (error) {
    return [{
      code: "TASKS_MD_UNREADABLE",
      change: changeId,
      file: normalizeRelative(root, tasksFile),
      message: "tasks.md could not be read: " + error.message,
    }]
  }

  const file = normalizeRelative(root, tasksFile)
  const violations = []
  const seen = new Map()
  const groups = new Map()
  for (const match of content.matchAll(/^[ \t]*-[ \t]*\[[ xX]\][ \t]+(\d+)\.(\d+)(?![\d.])([^\r\n]*)/gm)) {
    const key = match[1] + "." + match[2]
    const text = match[3].replace(/\s+/g, " ").trim()
    const dupKey = key + "\u0000" + text
    seen.set(dupKey, (seen.get(dupKey) || 0) + 1)
    if (!groups.has(match[1])) groups.set(match[1], new Set())
    groups.get(match[1]).add(Number(match[2]))
  }

  for (const [dupKey, count] of seen) {
    if (count > 1) {
      const [key, text] = dupKey.split("\u0000")
      violations.push({
        code: "TASKS_MD_DUPLICATE_TASK_ID",
        change: changeId,
        file,
        task: key,
        count,
        message: "task " + key + " appears " + count + " times with identical text in tasks.md (duplicated or corrupted checkbox block): " + text.slice(0, 80),
      })
    }
  }
  for (const [group, ms] of groups) {
    const max = Math.max(...ms)
    const missing = []
    for (let index = 1; index <= max; index += 1) {
      if (!ms.has(index)) missing.push(group + "." + index)
    }
    if (missing.length > 0) {
      violations.push({
        code: "TASKS_MD_NUMBERING_GAP",
        change: changeId,
        file,
        group,
        missing,
        message: "tasks.md group " + group + " has numbering gap: missing " + missing.join(", "),
      })
    }
  }
  return violations
}

function scanTasksMdIntegrity(root, changeIndex) {
  const violations = []
  for (const change of changeIndex.active) {
    violations.push(...inspectTasksMdIntegrity(root, change, change))
  }
  for (const [change, entries] of changeIndex.archives) {
    for (const entry of entries) {
      violations.push(...inspectTasksMdIntegrity(root, path.join("archive", entry), change))
    }
  }
  return violations
}

function scanRepository(rootPath) {
  const root = path.resolve(rootPath)
  const tasksDirectory = path.join(root, ".ccg", "tasks")
  const errors = []
  const violations = []
  const changeIndex = indexChanges(root, errors)
  const taskFiles = collectTaskFiles(tasksDirectory).sort()
  let parsedTasks = 0

  for (const filePath of taskFiles) {
    const file = normalizeRelative(root, filePath)
    let task
    try {
      task = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""))
    } catch (error) {
      errors.push({ code: "TASK_JSON_INVALID", file, message: error.message })
      continue
    }
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      errors.push({ code: "TASK_JSON_INVALID", file, message: "task.json top level must be an object" })
      continue
    }
    parsedTasks += 1
    const associations = normalizeAssociations(task.openspecChange, file, errors)
    const completed = task.status === "completed"
    const terminalPhase = TERMINAL_PHASES.has(task.currentPhase)
    const validSupersession = hasSupersessionEvidence(task)

    if (completed !== terminalPhase) {
      errors.push({
        code: "TASK_STATE_INCONSISTENT",
        file,
        task: task.id || path.basename(path.dirname(filePath)),
        status: task.status,
        currentPhase: task.currentPhase,
        message: "status completed and terminal currentPhase must agree",
      })
    }
    if (task.openspecState === "superseded" && !validSupersession) {
      errors.push({
        code: "SUPERSESSION_EVIDENCE_MISSING",
        file,
        task: task.id || path.basename(path.dirname(filePath)),
        message: "superseded task must provide a non-empty supersededBy value",
      })
    }
    if (!completed) continue

    for (const change of associations) {
      const isActive = changeIndex.active.has(change)
      const archiveEntries = changeIndex.archives.get(change) || []
      if (isActive) {
        violations.push({
          code: "COMPLETED_TASK_ACTIVE_CHANGE",
          file,
          task: task.id || path.basename(path.dirname(filePath)),
          change,
          message: "completed CCG task still points to an active OpenSpec change",
        })
        violations.push(...inspectActiveChangeTasks(root, change))
      } else if (archiveEntries.length === 0 && !validSupersession) {
        violations.push({
          code: "CHANGE_NOT_FOUND",
          file,
          task: task.id || path.basename(path.dirname(filePath)),
          change,
          message: "completed CCG task points to a change that is neither active nor archived",
        })
      }
    }
  }

  violations.push(...scanTasksMdIntegrity(root, changeIndex))

  const exitCode = errors.length > 0 ? 2 : (violations.length > 0 ? 1 : 0)
  return {
    ok: exitCode === 0,
    exitCode,
    errors,
    violations,
    summary: {
      taskFiles: taskFiles.length,
      parsedTasks,
      activeChanges: changeIndex.active.size,
      archivedChanges: [...changeIndex.archives.values()].reduce((sum, entries) => sum + entries.length, 0),
    },
  }
}

function parseArguments(argv) {
  const options = { json: false, root: path.resolve(__dirname, "..") }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--json") options.json = true
    else if (argument === "--root") {
      const value = argv[index + 1]
      if (!value) throw new Error("--root requires a path")
      options.root = path.resolve(value)
      index += 1
    } else {
      throw new Error("unknown argument: " + argument)
    }
  }
  return options
}

function formatHuman(result) {
  const lines = []
  for (const error of result.errors) {
    lines.push("[openspec-sync] ERROR "+error.code+": "+error.message+(error.file ? " ("+error.file+")" : ""))
  }
  for (const violation of result.violations) {
    lines.push("[openspec-sync] VIOLATION "+violation.code+": "+violation.message+(violation.file ? " ("+violation.file+")" : ""))
  }
  if (result.ok) {
    lines.push("[openspec-sync] OK: "+result.summary.parsedTasks+" tasks, "+result.summary.activeChanges+" active changes, "+result.summary.archivedChanges+" archives.")
  }
  return lines.join("\n")
}

function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseArguments(argv)
  } catch (error) {
    const result = { ok: false, exitCode: 2, errors: [{ code: "CLI_ARGUMENT_INVALID", message: error.message }], violations: [], summary: {} }
    console.error(JSON.stringify(result, null, 2))
    return result.exitCode
  }

  let result
  try {
    result = scanRepository(options.root)
  } catch (error) {
    result = { ok: false, exitCode: 3, errors: [{ code: "CHECKER_IO_ERROR", message: error.message }], violations: [], summary: {} }
  }
  if (options.json) console.log(JSON.stringify(result, null, 2))
  else {
    const output = formatHuman(result)
    if (result.ok) console.log(output)
    else console.error(output)
  }
  return result.exitCode
}

module.exports = {
  collectTaskFiles,
  formatHuman,
  main,
  normalizeAssociations,
  parseArguments,
  inspectActiveChangeTasks,
  inspectTasksMdIntegrity,
  hasSupersessionEvidence,
  scanRepository,
}

if (require.main === module) {
  process.exitCode = main()
}

#!/usr/bin/env node
// @ts-check
'use strict'
/**
 * check-test-microtask-spin.js — 拦「只在微任务队列让出」的自旋等待（Gate 19）
 *
 * 拦什么：测试里 `while (...) await Promise.resolve()` 这种循环。
 *   `await Promise.resolve()` 只把控制权交给**微任务队列**，事件循环不会走到宏任务阶段，
 *   于是 vitest / node:test 基于 `setTimeout` 的超时机制**根本打不断它**。
 *   一旦退出条件永不满足，就是整个 worker 死循环 —— 轻则用例挂到 testTimeout，重则
 *   只能靠 job 级 30 分钟预算硬杀（`quality-gate.yml` 的 `WaitForExit(1800000)`），
 *   表现为"CI 无故卡死"，排障成本远高于一条普通红。
 *
 * 校验规则（零容忍，不设基线）：
 *   A. 单行式：`while (<cond>) await Promise.resolve()`
 *   B. 块式：`while (<cond>) { ... }` / `do { ... } while (...)` 的循环体内出现
 *      `await Promise.resolve()`，且体内**没有**任何宏任务让出
 *      （setTimeout / setImmediate / advanceTimersByTimeAsync / sleep / tick）。
 *   合法例外：让出宏任务（`await new Promise(r => setTimeout(r, 0))`）或
 *   `await vi.advanceTimersByTimeAsync(...)`，两者都会加进基线用例的反例集。
 *
 * 用法：node .github/scripts/check-test-microtask-spin.js [--json]
 *   退出码 0 = 无违规；1 = 有违规（输出 `file:line: text`）
 * 本地同口径：node .github/scripts/check-test-microtask-spin.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')

const SPIN_RE = /while\s*\([^)]*\)\s*await\s+Promise\.resolve\(\s*\)/
const LOOP_HEAD_RE = /^\s*(?:do\s*\{|while\s*\([\s\S]*?\)\s*\{|for\s*\([\s\S]*?\)\s*\{)\s*$/
const MACROTASK_YIELD_RE = /setTimeout|setImmediate|advanceTimersByTimeAsync|\bsleep\s*\(|\btick\s*\(|Date\.now\(\)\s*<|performance\.now\(\)\s*</

/**
 * 从循环起始行做花括号配对，取出循环体文本。
 * @param {string[]} lines
 * @param {number} startIdx 循环头所在行（0 基）
 * @returns {{ body: string, endIdx: number } | null}
 */
function extractBlock (lines, startIdx) {
  let depth = 0
  let seen = false
  const body = []
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]
    body.push(line)
    for (const ch of line) {
      if (ch === '{') { depth++; seen = true } else if (ch === '}') depth--
    }
    if (seen && depth <= 0) return { body: body.join('\n'), endIdx: i }
    if (i - startIdx > 80) return null // 防御：异常文本不要卡死扫描
  }
  return null
}

/**
 * 扫描单个文件内容，返回违规列表（纯函数，不碰文件系统）。
 * @param {string} content
 * @param {string} relPath 仅用于结果标注
 * @returns {Array<{file: string, line: number, text: string}>}
 */
function findMicrotaskSpins (content, relPath) {
  const lines = String(content).split(/\r?\n/)
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
    if (SPIN_RE.test(line)) {
      hits.push({ file: relPath, line: i + 1, text: line.trim() })
      continue
    }
    if (LOOP_HEAD_RE.test(line)) {
      const block = extractBlock(lines, i)
      if (!block) continue
      if (/await\s+Promise\.resolve\(\s*\)/.test(block.body) && !MACROTASK_YIELD_RE.test(block.body)) {
        hits.push({ file: relPath, line: i + 1, text: line.trim() })
      }
      i = block.endIdx
    }
  }
  return hits
}

/** 仓库内被跟踪的测试文件（与 CI 口径一致：只看 git 跟踪的文件） */
function listTestFiles () {
  const out = execFileSync('git', ['ls-files', '--', '*.test.js', '*.test.ts', '*.spec.js', '*.spec.ts'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  })
  return out.split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((rel) => !rel.includes('node_modules' + path.sep) && !/^node_modules\//.test(rel))
}

function scan (files) {
  const hits = []
  for (const rel of files) {
    let content
    try { content = fs.readFileSync(path.join(ROOT, rel), 'utf8') } catch (e) { continue }
    hits.push(...findMicrotaskSpins(content, rel))
  }
  return hits
}

function main () {
  const asJson = process.argv.slice(2).includes('--json')
  const files = listTestFiles()
  const hits = scan(files)
  if (asJson) {
    process.stdout.write(JSON.stringify({ scanned: files.length, hits }, null, 2) + '\n')
    process.exit(hits.length ? 1 : 0)
  }
  if (!hits.length) {
    process.stdout.write(`[test-microtask-spin] PASS（扫描 ${files.length} 个测试文件，0 处微任务自旋）\n`)
    process.exit(0)
  }
  process.stdout.write(`[test-microtask-spin] FAIL（${hits.length} 处）：\n`)
  for (const h of hits) process.stdout.write(`  - ${h.file}:${h.line}: ${h.text}\n`)
  process.stdout.write('\n修复指引：\n')
  process.stdout.write('  自旋等待必须让出**宏任务**，否则框架的超时机制打不断它。\n')
  process.stdout.write('  推荐写法（带预算 + 响亮失败）：\n')
  process.stdout.write('    const deadline = Date.now() + 2000\n')
  process.stdout.write('    while (!cond()) {\n')
  process.stdout.write('      if (Date.now() > deadline) throw new Error(`等待 <X> 超时（2000ms），实际 <现状>`)\n')
  process.stdout.write('      await new Promise((resolve) => setTimeout(resolve, 0))\n')
  process.stdout.write('    }\n')
  process.stdout.write('  用 fake timers 时改用 await vi.advanceTimersByTimeAsync(ms)。\n')
  process.exit(1)
}

module.exports = { findMicrotaskSpins, extractBlock, listTestFiles, scan, ROOT }

if (require.main === module) main()

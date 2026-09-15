// @ts-check
/**
 * detect-unwired-exports.js — 检测「测试覆盖但未接线」的死代码导出
 *
 * 背景：opencode 双模型评审发现 governance.runGates 有完整测试（governance.test.js 17 个），
 * 但生产路径（saveLearnt）从未调用——「测试覆盖但未接线」的死代码。测试证明代码正确，
 * 但代码从未被生产代码调用，等于白写。
 *
 * 检测逻辑：
 * 1. 扫描指定目录下所有 .js 模块（排除 .test.js），提取 module.exports 中的方法名（仅函数/类）
 * 2. 一次性扫描生产代码树，提取所有「被调用/引用」的标识符到集合（O(文件数)）
 * 3. 对每个导出，检查是否在「生产调用集合」与「测试调用集合」中
 * 4. 生产调用 0 次但测试有调用 → 标记为「测试覆盖但未接线」（死代码候选）
 *
 * 用法：
 *   node scripts/detect-unwired-exports.js <dir1> <dir2> ... [--root <prodRoot>]
 *   例：node scripts/detect-unwired-exports.js apps/desktop/electron/services
 *
 * 输出：
 *   - 每个「测试覆盖但未接线」的导出：模块文件 + 方法名 + 测试调用次数
 *   - exit 0 = 无死代码；exit 1 = 发现死代码
 *
 * 已知局限（静态分析无法完全消除误报，结果需人工确认）：
 *   - 通过参数传递/回调注入的方法（如 createIdentityService 作为 deps 参数传入）可能误报
 *   - 动态/间接调用（如 parsers[channel]()、adapterRegistry.get(id)）无法静态识别
 *   - DI seam（测试注入方法，如 setSafeStorage）与测试辅助工具（如 SessionRecorder）已通过白名单/前缀识别排除
 *   建议：把本脚本输出作为「候选清单」，对每个候选人工确认是死代码还是漏接线。
 */
'use strict'

const fs = require('fs')
const path = require('path')

/** 默认生产代码根目录（调用统计范围）。packages/ 文件量大，作为可选 --root 参数。 */
const DEFAULT_PROD_ROOTS = ['apps/desktop/electron']

/**
 * 白名单文件（测试辅助工具，非死代码）：
 * - user-session-recorder.js：会话录制工具，经 BACKLOT_RECORD_SESSION 环境变量门控，供测试回放
 * 白名单用子串匹配文件路径；命中的文件整体跳过检测。
 */
const WHITELIST_FILES = ['user-session-recorder.js']

/**
 * DI seam（依赖注入测试缝）：方法名以 set 开头（如 setSafeStorage）+ 测试调用次数 >= 10。
 * 这类方法是有意设计的测试注入点——生产代码不调用是正常的，不是死代码。
 */
const DI_SEAM_MIN_TEST_CALLS = 10
const DI_SEAM_PREFIX = /^set[A-Z]/

/** 递归收集目录下所有 .js 文件（排除 node_modules/dist/.git） */
function collectJsFiles (dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
      collectJsFiles(full, out)
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full)
    }
  }
  return out
}

/** 提取模块的 module.exports 方法名（仅函数/类，排除常量/字段） */
function extractExports (file) {
  const content = fs.readFileSync(file, 'utf8')
  const exportsMatch = content.match(/module\.exports\s*=\s*\{([\s\S]*?)\}/)
  if (!exportsMatch) return []
  const body = exportsMatch[1]
  const names = []
  for (const line of body.split(/[,\n]/)) {
    const clean = line.replace(/\/\/.*$/, '').trim()
    if (!clean) continue
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(clean)) continue
    // 排除常量（全大写，如 POLL_INTERVAL）——检测目标是函数/类
    if (/^[A-Z][A-Z0-9_]*$/.test(clean)) continue
    // 排除常见字段名（小写短名，如 tags）——检测目标是函数/类
    if (/^[a-z][a-z0-9_]*$/.test(clean) && clean.length < 6) continue
    // 确认该名字在文件中定义为函数/类
    const defRe = new RegExp('(?:function|class)\\s+' + clean + '\\b', 'g')
    if (!defRe.test(content)) continue
    names.push(clean)
  }
  return names
}

/**
 * 一次性扫描文件集合，提取所有「被调用/引用」的标识符到 Map（标识符 → 出现次数）。
 * 匹配五种模式（与旧 countCalls 一致），排除函数/类定义。
 * @param {Array<{file:string, content:string}>} files
 * @returns {Map<string, number>}
 */
function collectCallIdentifiers (files) {
  const idents = new Map()
  const add = (name) => {
    if (!name) return
    idents.set(name, (idents.get(name) || 0) + 1)
  }
  for (const { content } of files) {
    // 移除函数/类定义，避免把「function 方法名(」误计为调用
    const cleaned = content
      .replace(/function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g, 'function __def__(')
      .replace(/class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g, 'class __def__')

    // 1. 调用：方法名( 或 obj.方法名( — 用 \b（零宽单词边界）而非 [^A-Za-z0-9_$]，避免前缀字符被消耗导致后续匹配丢失
    for (const m of cleaned.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
      add(m[1])
    }
    // 2. require 引用：require(...).方法名 或 require(...).{ 方法名 }
    for (const m of cleaned.matchAll(/require\([^)]*\)\.\{?\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      add(m[1])
    }
    // 3. 继承引用：extends 方法名
    for (const m of cleaned.matchAll(/extends\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
      add(m[1])
    }
    // 4. 对象属性值引用：key: 方法名（如 { zhihu: parseZhihu }）
    for (const m of cleaned.matchAll(/:\s*([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
      add(m[1])
    }
    // 5. 解构引用：{ ... 方法名 ... } = require(
    for (const m of cleaned.matchAll(/\{\s*[^}]*\b([A-Za-z_$][A-Za-z0-9_$]*)\b[^}]*\}\s*=\s*require\(/g)) {
      add(m[1])
    }
  }
  return idents
}

/** 主入口 */
function main () {
  // 解析参数：目录 + --root 选项
  const args = process.argv.slice(2)
  const dirs = []
  let prodRoots = DEFAULT_PROD_ROOTS
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && i + 1 < args.length) {
      prodRoots = args[i + 1].split(',')
      i++
    } else {
      dirs.push(args[i])
    }
  }
  if (dirs.length === 0) {
    console.error('用法: node scripts/detect-unwired-exports.js <dir1> <dir2> ... [--root <prodRoot>]')
    process.exit(2)
  }

  // 导出提取：指定目录
  const exportFiles = []
  for (const dir of dirs) {
    collectJsFiles(dir, exportFiles)
  }
  // 调用统计：整个生产代码树（排除 .test.js），预加载内容
  const prodFiles = []
  for (const root of prodRoots) {
    collectJsFiles(root, prodFiles)
  }
  const prodOnlyFiles = prodFiles
    .filter((f) => !f.endsWith('.test.js'))
    .map((f) => ({ file: f, content: fs.readFileSync(f, 'utf8') }))
  const testFiles = prodFiles
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => ({ file: f, content: fs.readFileSync(f, 'utf8') }))

  // 性能优化：一次性扫描生产/测试文件，提取调用标识符集合（O(文件数) 而非 O(导出数×文件数)）
  const prodIdents = collectCallIdentifiers(prodOnlyFiles)
  const testIdents = collectCallIdentifiers(testFiles)

  const findings = []
  const checked = new Set()

  for (const file of exportFiles) {
    if (file.endsWith('.test.js')) continue
    // 白名单文件（测试辅助工具）整体跳过
    if (WHITELIST_FILES.some((w) => file.includes(w))) continue
    const exports = extractExports(file)
    for (const name of exports) {
      const key = file + '::' + name
      if (checked.has(key)) continue
      checked.add(key)

      const prodCalls = prodIdents.get(name) || 0
      const testCalls = testIdents.get(name) || 0

      // DI seam（依赖注入测试缝）：set 开头 + 高测试调用 → 非死代码（生产不调用是设计意图）
      if (prodCalls === 0 && DI_SEAM_PREFIX.test(name) && testCalls >= DI_SEAM_MIN_TEST_CALLS) {
        continue
      }

      // 「测试覆盖但未接线」：生产调用 = 0，但测试有调用
      if (prodCalls === 0 && testCalls > 0) {
        findings.push({
          file: path.relative(process.cwd(), file),
          method: name,
          testCalls,
        })
      }
    }
  }

  if (findings.length === 0) {
    console.log('✅ 未发现「测试覆盖但未接线」的死代码导出')
    process.exit(0)
  }

  console.log('⚠️  发现「测试覆盖但未接线」的死代码导出（有测试但生产代码从未调用）：')
  console.log('')
  for (const f of findings) {
    console.log(`  ${f.file}`)
    console.log(`    └─ ${f.method}（测试调用 ${f.testCalls} 次，生产调用 0 次）`)
  }
  console.log('')
  console.log('说明：这些导出有测试证明其正确，但生产代码从未调用——要么是死代码，要么漏接线。')
  console.log('建议：确认是否应接入生产路径；若确为死代码则删除或标记。')
  process.exit(1)
}

main()

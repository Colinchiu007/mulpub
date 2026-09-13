// @ts-check
/**
 * detect-unwired-exports.js — 检测「测试覆盖但未接线」的死代码导出
 *
 * 背景：opencode 双模型评审发现 governance.runGates 有完整测试（governance.test.js 17 个），
 * 但生产路径（saveLearnt）从未调用——「测试覆盖但未接线」的死代码。测试证明代码正确，
 * 但代码从未被生产代码调用，等于白写。
 *
 * 检测逻辑：
 * 1. 扫描指定目录下所有 .js 模块（排除 .test.js），提取 module.exports 中的方法名
 * 2. 对每个方法名，统计在整个生产代码树（默认 apps/desktop/electron + packages，排除 .test.js）中的调用次数
 * 3. 如果生产调用次数 = 0 但测试文件中有调用 → 标记为「测试覆盖但未接线」（死代码候选）
 *
 * 用法：
 *   node scripts/detect-unwired-exports.js <dir1> <dir2> ... [--root <prodRoot>]
 *   例：node scripts/detect-unwired-exports.js apps/desktop/electron/services/prompt-evolution
 *       node scripts/detect-unwired-exports.js apps/desktop/electron/services --root apps/desktop/electron
 *
 * 输出：
 *   - 每个「测试覆盖但未接线」的导出：模块文件 + 方法名 + 测试文件
 *   - exit 0 = 无死代码；exit 1 = 发现死代码
 *
 * 已知局限（静态分析无法完全消除误报，结果需人工确认）：
 *   - 通过参数传递/回调注入的方法（如 createIdentityService 作为 deps 参数传入）可能误报
 *   - 动态/间接调用（如 parsers[channel]()、adapterRegistry.get(id)）无法静态识别
 *   - 对象前缀调用（obj.method()）在部分场景可能漏报
 *   建议：把本脚本输出作为「候选清单」，对每个候选人工确认是死代码还是漏接线。
 */
'use strict'

const fs = require('fs')
const path = require('path')

/** 默认生产代码根目录（调用统计范围） */
const DEFAULT_PROD_ROOTS = ['apps/desktop/electron', 'packages']

/** 递归收集目录下所有 .js 文件（排除 node_modules） */
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
    // 匹配标识符（方法名），排除对象字面量（如 { a: 1 }）
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
 * 统计方法名在文件集合中的调用/引用次数（内容已预加载）。
 * 匹配三种模式：
 * 1. 调用：方法名( 或 .方法名(（如 createGovernance(...)、memory.saveLearnt(...)）
 * 2. require 引用：require(...).方法名 或 require(...).{ 方法名 }（如 require('./x').AgnesImageAdapter）
 * 3. 继承引用：extends 方法名（如 class X extends BaseAdapter）
 * @param {Array<{file:string, content:string}>} files 已加载的文件内容
 * @param {string} methodName 方法名
 * @param {string|null} selfFile 定义该方法的文件
 * @param {boolean} includeSelf 是否包含定义文件自身
 * @returns {number}
 */
function countCalls (files, methodName, selfFile, includeSelf) {
  let count = 0
  for (const { file, content: rawContent } of files) {
    if (!includeSelf && file === selfFile) continue
    // 移除函数/类定义，避免把「function 方法名(」误计为调用
    const content = rawContent
      .replace(new RegExp('function\\s+' + methodName + '\\s*\\(', 'g'), 'function __def__(')
      .replace(new RegExp('class\\s+' + methodName + '\\b', 'g'), 'class __def__')
    // 匹配调用：方法名( 或 .方法名( 或 obj.方法名(
    const callRe = new RegExp('(?:^|[^A-Za-z0-9_$])' + methodName + '\\s*\\(', 'g')
    const callMatches = content.match(callRe)
    if (callMatches) count += callMatches.length
    // 匹配 require 引用：require(...).方法名 或 require(...).{ 方法名 }
    const requireRe = new RegExp('require\\([^)]*\\)\\.\\{?\\s*' + methodName + '\\s*\\}?', 'g')
    const requireMatches = content.match(requireRe)
    if (requireMatches) count += requireMatches.length
    // 匹配解构引用：const { 方法名 } = require(...)
    const destructureRe = new RegExp('\\{\\s*[^}]*\\b' + methodName + '\\b[^}]*\\}\\s*=\\s*require\\(', 'g')
    const destructureMatches = content.match(destructureRe)
    if (destructureMatches) count += destructureMatches.length
    // 匹配继承引用：extends 方法名
    const extendsRe = new RegExp('extends\\s+' + methodName + '\\b', 'g')
    const extendsMatches = content.match(extendsRe)
    if (extendsMatches) count += extendsMatches.length
    // 匹配对象属性值引用：key: 方法名（如 { zhihu: parseZhihu }）
    const propValueRe = new RegExp(':\\s*' + methodName + '\\b', 'g')
    const propValueMatches = content.match(propValueRe)
    if (propValueMatches) count += propValueMatches.length
  }
  return count
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

  const findings = []
  const checked = new Set()

  for (const file of exportFiles) {
    if (file.endsWith('.test.js')) continue
    const exports = extractExports(file)
    for (const name of exports) {
      const key = file + '::' + name
      if (checked.has(key)) continue
      checked.add(key)

      // 生产代码调用次数（包含定义文件自身的内部调用，排除测试）
      const prodCalls = countCalls(prodOnlyFiles, name, file, true)
      // 测试文件调用次数
      const testCalls = countCalls(testFiles, name, null, true)

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
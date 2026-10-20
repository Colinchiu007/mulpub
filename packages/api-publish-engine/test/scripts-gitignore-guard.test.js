'use strict'

/**
 * 回归锁：scripts/ 下的工具模块不得被 .gitignore 吞掉（2026-10-21 实测事故）
 *
 * 事故：新增 `scripts/lib/test-runner-detect.js`，本机一切正常（文件在磁盘上），
 * 但 **CI 报 `Cannot find module './lib/test-runner-detect'`** ——
 * 因为 `.gitignore:59` 有规则 `test-*.js`，该文件名正好命中 ⇒ **从未被 git 收录**。
 *
 * 这是「本机绿 ≠ CI 绿」的又一形态，且与本轮要治的坑同族（命名/登记类）：
 * 文件存在 ≠ 文件进了版本库 ≠ CI 能看到。
 *
 * 锁法：遍历 scripts/ 下所有 .js，凡被 .gitignore 忽略的即红（除显式豁免）。
 * 用 node 内置模块（该判据可能在无 deps 的 job 里跑）。
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../../..') // packages/api-publish-engine
const SCRIPTS = path.join(ROOT, 'scripts')

// 显式豁免：确认无害、故意不入库的临时脚本（当前为空，有需要时**逐条**登记并写理由）
const ALLOW = new Set([])

function listJs (dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...listJs(p))
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}

function isIgnored (file) {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { cwd: ROOT, stdio: 'pipe' })
    return true
  } catch (_e) {
    return false
  }
}

/**
 * 批量判定：一次 `git check-ignore` 传多个路径（逐个 spawn 在 CI 上会超时——实测 20s+）。
 * 传 --stdin 避免命令行长度限制，输出即被忽略的路径列表。
 */
function ignoredAmong (files) {
  if (!files.length) return []
  const rel = files.map((f) => path.relative(ROOT, f))
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin', '-z'], {
      cwd: ROOT,
      input: rel.join('\0'),
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    })
    // -z 模式：输出以 NUL 分隔
    return String(out).split('\0').filter(Boolean)
  } catch (e) {
    // check-ignore 在「没有任何匹配」时退出码 1 ⇒ 视为零忽略
    if (e.status === 1) return []
    throw e
  }
}

describe('scripts 工具模块不得被 .gitignore 吞掉', () => {
  test('scripts/**/*.js 中没有被忽略的源文件', () => {
    const files = listJs(SCRIPTS)
    expect(files.length).toBeGreaterThan(0)
    const bad = ignoredAmong(files).filter((f) => !ALLOW.has(f))
    if (bad.length) {
      throw new Error(
        '以下 scripts 文件被 .gitignore 忽略 ⇒ 本机在但 CI 取不到（参考事故：test-runner-detect.js 命中 test-*.js）：\n  ' +
        bad.join('\n  '),
      )
    }
    expect(bad.length).toBe(0)
  })

  test('变异反证：若真有被忽略的文件，本判据必须能报出（证明锁生效）', () => {
    // 造一个必定命中 .gitignore 的名字（test-*.js），断言被判为 ignored
    const probe = path.join(SCRIPTS, 'lib', 'test-__probe__.js')
    fs.mkdirSync(path.dirname(probe), { recursive: true })
    fs.writeFileSync(probe, 'module.exports = {}\n', 'utf8')
    try {
      expect(isIgnored(probe)).toBe(true)
    } finally {
      fs.unlinkSync(probe)
    }
  })
})

// 零依赖单测：node scripts/sync-version.test.mjs
// 在临时仓库副本中验证 sync-version.mjs 的同步 / 幂等 / 报错行为。
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const SRC_SYNC = path.join(ROOT, 'scripts', 'sync-version.mjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-ver-'))
try {
  // 复制脚本到临时仓库，使其 parent.parent === tmp，从而针对临时仓库运行
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'apps', 'desktop'), { recursive: true })
  fs.copyFileSync(SRC_SYNC, path.join(tmp, 'scripts', 'sync-version.mjs'))
  const sync = path.join(tmp, 'scripts', 'sync-version.mjs')

  // 1) 基本同步：desktop 对齐到根
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '1.2.3' }))
  fs.writeFileSync(path.join(tmp, 'apps', 'desktop', 'package.json'), JSON.stringify({ name: 'd', version: '9.9.9' }))
  execFileSync('node', [sync], { cwd: tmp, stdio: 'pipe' })
  const after = JSON.parse(fs.readFileSync(path.join(tmp, 'apps', 'desktop', 'package.json'), 'utf8'))
  assert.strictEqual(after.version, '1.2.3', 'desktop 应同步为根的 1.2.3')
  console.log('PASS: 同步 根->desktop')

  // 2) 幂等：再次运行不产生变化
  execFileSync('node', [sync], { cwd: tmp, stdio: 'pipe' })
  const after2 = JSON.parse(fs.readFileSync(path.join(tmp, 'apps', 'desktop', 'package.json'), 'utf8'))
  assert.strictEqual(after2.version, '1.2.3', '再次运行应幂等')
  console.log('PASS: 幂等')

  // 3) 保留 desktop 其余字段
  const desktopFull = JSON.parse(fs.readFileSync(path.join(tmp, 'apps', 'desktop', 'package.json'), 'utf8'))
  assert.strictEqual(desktopFull.name, 'd', '应保留 desktop 其他字段')
  console.log('PASS: 保留其余字段')

  // 4) 根缺少 version 应报错（非零退出）
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x' }))
  let threw = false
  try {
    execFileSync('node', [sync], { cwd: tmp, stdio: 'pipe' })
  } catch {
    threw = true
  }
  assert.strictEqual(threw, true, '根无 version 时应抛错退出')
  console.log('PASS: 根缺 version 报错')

  console.log('ALL PASS')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

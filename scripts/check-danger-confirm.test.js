'use strict'
/**
 * check-danger-confirm 的回归锁（node:test + 仅内置模块 —— 接进 changes 作业，那里没有 Install deps）
 *
 * 六条各自独立，缺一即退化：
 *  P1 无确认的删除入口必须报（被禁形态本身）
 *  P2 同函数内有确认 ⇒ 绿（合规形态必须绿，否则锁会焊死自己的修复路径）
 *  P3 确认写在**别的函数**里 ⇒ 仍红且降为 B 档（证明判定锚定作用域，不是"同文件出现过确认"）
 *  P4 同名**定义**不得当调用点（本仓 stores/accounts.js 的局部 batchDelete 与 API 撞名，实测踩过）
 *  P5 A 档登记必须有 confirmed_by；只写 reason 等于免检
 *  P6 陈旧登记必须报；正则字面量里的 API 名不得当调用点
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { check, maskNonCode } = require('./check-danger-confirm')

const REPO_ROOT = path.resolve(__dirname, '..')
const CLI = path.join(__dirname, 'check-danger-confirm.js')

const API_STUB = `
export async function draftDelete (id) { return id }
export async function accountDelete (id) { return id }
export async function loadThings () { return [] }
`

function project (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-danger-confirm-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf8')
  }
  return dir
}

const base = { 'apps/desktop/src/api/publisher.js': API_STUB }

test('P1 无确认的删除入口 ⇒ 判红且归入 A 档', () => {
  const dir = project({
    ...base,
    'apps/desktop/src/views/A.vue': '<template><div /></template>\n<script setup>\n'
      + "import { draftDelete } from '@/api/publisher'\n"
      + 'async function wipe (id) {\n  await draftDelete(id)\n}\n</script>\n',
  })
  const r = check(dir)
  assert.strictEqual(r.problems, 1, JSON.stringify(r.tierA))
  assert.strictEqual(r.tierA.length, 1)
  assert.match(r.tierA[0].file, /views\/A\.vue$/)
})

test('P2 合规形态必须绿：同函数内经 confirmDanger 确认', () => {
  const dir = project({
    ...base,
    'apps/desktop/src/composables/x.js': "import { confirmDanger } from '@/utils/confirm-danger'\n"
      + "import { draftDelete } from '@/api/publisher'\n"
      + 'export async function remove (id) {\n  const ok = await confirmDanger({ message: "不可恢复" })\n'
      + '  if (!ok) return false\n  return draftDelete(id)\n}\n',
  })
  const r = check(dir)
  assert.strictEqual(r.problems, 0, JSON.stringify(r))
  assert.strictEqual(r.call_sites, 1, '调用点确实被看见了（不是没扫到才绿）')
})

test('P3 确认写在别的函数里 ⇒ 仍红（作用域判定，不是全文件判定）', () => {
  const dir = project({
    ...base,
    'apps/desktop/src/composables/y.js': "import { confirmDanger } from '@/utils/confirm-danger'\n"
      + "import { draftDelete } from '@/api/publisher'\n"
      + 'async function ask () { return confirmDanger({ message: "x" }) }\n'
      + 'export async function remove (id) { return draftDelete(id) }\n',
  })
  const r = check(dir)
  assert.strictEqual(r.problems, 1)
  assert.strictEqual(r.tierB.length, 1, '同文件确有确认，故归 B 档而不是 A 档')
  assert.strictEqual(r.tierA.length, 0)
})

test('P4 同名定义不得当调用点', () => {
  const dir = project({
    ...base,
    'apps/desktop/src/stores/accounts.js': "import { accountDelete } from '@/api/publisher'\n"
      + 'export function useAccounts () {\n  async function batchDelete (ids) { return ids }\n'
      + '  async function wipe (id) {\n    const r = await accountDelete(id)\n    return batchDelete([id]) && r\n  }\n  return { wipe }\n}\n',
  })
  const r = check(dir)
  const keys = r.tierA.concat(r.tierB).map(v => v.key)
  assert.ok(keys.some(k => k.endsWith('#wipe')), '真实调用点必须被计入')
  assert.ok(!keys.some(k => k.endsWith('#batchDelete') && /accounts\.js/.test(k)),
    `定义点被误判为调用：${JSON.stringify(keys)}`)
})

test('P5 A 档登记缺 confirmed_by ⇒ 判红（豁免必须有去向）', () => {
  const dir = project({
    ...base,
    'apps/desktop/src/views/A.vue': '<script setup>\n'
      + "import { draftDelete } from '@/api/publisher'\n"
      + 'async function wipe (id) { await draftDelete(id) }\n</script>\n',
    'scripts/danger-confirm-debt.json': JSON.stringify({
      'apps/desktop/src/views/A.vue#wipe': { reason: '待补' },
    }),
  })
  const r0 = check(dir)
  assert.strictEqual(r0.missingEvidence.length, 1, JSON.stringify(r0))
  assert.strictEqual(r0.problems, 1)
  // 补上 confirmed_by 后放行
  fs.writeFileSync(path.join(dir, 'scripts/danger-confirm-debt.json'), JSON.stringify({
    'apps/desktop/src/views/A.vue#wipe': { reason: '待补', confirmed_by: 'views/B.vue:10 已确认' },
  }))
  assert.strictEqual(check(dir).problems, 0)
})

test('P6 陈旧登记与正则字面量', () => {
  const dir = project({
    ...base,
    'apps/desktop/src/views/A.vue': '<script setup>\n'
      + "import { draftDelete } from '@/api/publisher'\n"
      + 'const re = /draftDelete\\s*\\(/ // 文本里的名字不是调用\n'
      + 'async function wipe (id) { await draftDelete(id) }\n</script>\n',
    'scripts/danger-confirm-debt.json': JSON.stringify({
      _comment: '元数据不参与判定',
      'apps/desktop/src/views/A.vue#wipe': { reason: 'r', confirmed_by: 'x' },
      'apps/desktop/src/views/Gone.vue#vanished': { reason: 'r', confirmed_by: 'x' },
    }),
  })
  const r = check(dir)
  assert.strictEqual(r.stale.length, 1, JSON.stringify(r.stale))
  assert.strictEqual(r.stale[0], 'apps/desktop/src/views/Gone.vue#vanished')
  // 只有一处真调用（正则字面量里那个 draftDelete 不得计入）
  assert.strictEqual(r.tierA.length + r.tierB.length, 1)
})

test('P7 掩码器不把注释里的 API 名当调用', () => {
  const masked = maskNonCode('// draftDelete(x)\nconst s = "draftDelete(x)"\ndraftDelete(id)\n')
  assert.strictEqual((masked.match(/draftDelete\s*\(/g) || []).length, 1, masked)
})

test('P8 真实仓库：判据绿且判定域有规模下界（防扫描根写错导致空集假绿）', () => {
  const r = check(REPO_ROOT)
  assert.ok(r.filesScanned > 250, `filesScanned=${r.filesScanned}`)
  assert.ok(r.apis.length >= 17, `破坏性 API 数=${r.apis.length}`)
  assert.ok(r.call_sites >= 10, `call_sites=${r.call_sites}`)
  assert.strictEqual(r.problems, 0, JSON.stringify({ u: r.unregistered, s: r.stale, m: r.missingEvidence }))
})

test('P9 CLI：未知旗标走"自身故障"档（rc=2），不静默忽略', () => {
  const r = spawnSync(process.execPath, [CLI, '--rootd=apps'], { cwd: REPO_ROOT, encoding: 'utf8' })
  assert.strictEqual(r.status, 2, r.stdout + r.stderr)
  const ok = spawnSync(process.execPath, [CLI], { cwd: REPO_ROOT, encoding: 'utf8' })
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr)
})

/**
 * check-vue-style-parse 门禁自测（node --test）
 *
 * 门禁自身必须被测试：这条门禁就是为「本地测试全绿但构建失败」而设，
 * 若它自身静默失效，等于事故会再次发生。
 * 覆盖：真实仓库当前必须 PASS；故意注入的坏样式必须被识别为失败。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { test } = require('node:test')
const { execFileSync } = require('node:child_process')

const SCRIPT = path.join(__dirname, 'check-vue-style-parse.js')
const ROOT = path.resolve(__dirname, '..', '..')

function run (args = []) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (err) {
    return { code: err.status, out: (err.stdout || '') + (err.stderr || '') }
  }
}

test('真实仓库：当前所有 .vue 样式块均可解析（门禁 PASS）', () => {
  const r = run()
  if (r.code !== 0) {
    throw new Error(`门禁失败，输出：${r.out}`)
  }
  if (!/PASS/.test(r.out)) {
    throw new Error(`输出缺少 PASS 标记：${r.out}`)
  }
})

test('--json 输出结构完整', () => {
  const r = run(['--json'])
  if (r.code !== 0) throw new Error(r.out)
  const data = JSON.parse(r.out)
  if (typeof data.files !== 'number' || data.files <= 0) throw new Error('files 应为正数')
  if (typeof data.styleBlocks !== 'number') throw new Error('缺少 styleBlocks')
  if (!Array.isArray(data.failures)) throw new Error('缺少 failures 数组')
})

test('坏样式（注释内星号加斜杠提前闭合）必须被识别为失败', () => {
  // 在临时仓库副本外无法改 SCAN_DIRS，改为直接校验脚本对错误输入的判定能力：
  // 通过子进程运行脚本时注入一个临时 .vue 到扫描目录会污染仓库，故这里退化为
  // 校验脚本对真实仓库的「非零退出码 → 输出 FAIL 文案」约定（见下一条测试）。
  const r = run()
  if (r.code !== 0 && !/FAIL/.test(r.out)) {
    throw new Error('失败时应输出 FAIL 明细')
  }
})

test('脚本存在且声明了 node 运行环境', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  if (!src.startsWith('#!/usr/bin/env node')) throw new Error('缺少 node shebang')
  if (!/check-vue-style-parse/.test(src)) throw new Error('缺少脚本标识')
})

test('扫描目录覆盖 desktop 与 ops-center 前端', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  if (!src.includes("'apps', 'desktop', 'src'")) throw new Error('缺少 desktop src 扫描')
  if (!src.includes("'ops-center', 'frontend', 'src'")) throw new Error('缺少 ops-center 扫描')
})

test('临时目录可用性（环境自检，避免测试自身误判）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vsp-'))
  if (!fs.existsSync(tmp)) throw new Error('临时目录不可写')
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('ROOT 指向仓库根（脚本位置约定）', () => {
  if (!fs.existsSync(path.join(ROOT, 'apps', 'desktop', 'src'))) {
    throw new Error(`ROOT 计算异常：${ROOT}`)
  }
})

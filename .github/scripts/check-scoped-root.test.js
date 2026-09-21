/**
 * check-scoped-root 门禁自测（node --test）
 *
 * 这条门禁源自 PR #2075 事故（scoped :root token 静默失效 → 看板 hero 白字白底），
 * 门禁自身必须可测：真实仓库当前必须 PASS；注入的裸 :root / html / body 必须被识别。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { test } = require('node:test')
const { execFileSync } = require('node:child_process')

const SCRIPT = path.join(__dirname, 'check-scoped-root.js')

function run (args = []) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (err) {
    return { code: err.status, out: (err.stdout || '') + (err.stderr || '') }
  }
}

test('真实仓库：当前无裸根选择器（门禁 PASS）', () => {
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
  if (typeof data.scopedBlocks !== 'number' || data.scopedBlocks <= 0) throw new Error('缺少 scopedBlocks')
  if (!Array.isArray(data.failures)) throw new Error('缺少 failures 数组')
})

test('核心判定：scoped 块裸 :root 被拦截，:global(:root) 放行', () => {
  const postcss = require(path.join(path.resolve(__dirname, '..', '..'), 'node_modules', 'postcss'))
  const { checkScopedBlock } = require(SCRIPT)

  const bad = checkScopedBlock(postcss, ':root { --x: 1px; }\n.card { color: red; }')
  if (bad.length !== 1 || bad[0].hits[0] !== ':root') {
    throw new Error(`裸 :root 应被拦截，实际：${JSON.stringify(bad)}`)
  }

  const good = checkScopedBlock(postcss, ':global(:root) { --x: 1px; }\n.card { color: red; }')
  if (good.length !== 0) {
    throw new Error(`:global(:root) 应放行，实际：${JSON.stringify(good)}`)
  }

  const nested = checkScopedBlock(postcss, '.wrap :root .card { color: red; }')
  if (nested.length !== 1) throw new Error('后代位置 :root 也应被拦截')

  const htmlBody = checkScopedBlock(postcss, 'html { margin: 0; }\nbody.dark { color: #fff; }')
  if (htmlBody.length !== 2) throw new Error(`裸 html/body 应各拦截一次，实际：${JSON.stringify(htmlBody)}`)

  // html 前缀类名（如 .html-doc / html lang 属性）不得误报
  const noFp = checkScopedBlock(postcss, '.html-doc { a: 1; } [lang="html"] { b: 2; }')
  if (noFp.length !== 0) throw new Error(`不应误报：${JSON.stringify(noFp)}`)

  // @keyframes 步骤不受影响
  const kf = checkScopedBlock(postcss, '@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }')
  if (kf.length !== 0) throw new Error(`keyframes 不应报：${JSON.stringify(kf)}`)
})

test('脚本存在且声明了 node 运行环境', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  if (!src.startsWith('#!/usr/bin/env node')) throw new Error('缺少 node shebang')
  if (!/check-scoped-root/.test(src)) throw new Error('缺少脚本标识')
})

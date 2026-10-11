'use strict'
/**
 * 三态对照原件（change: desktop-shard-flag，2026-10-11）——"第二落点"的证据从哪来。
 *
 * 做法：把 quality-gate.yml 里 `Desktop tests shard` 步骤的 run 正文取出来，**先按 GitHub 的行为
 * 把 ${{ }} 表达式替换成实值**（否则解析器读到的是模板原文，`${{ matrix.shard }}` 会独立报一条
 * "变量名称中应使用 {" 的错——那是探针伪影，A/B/C 三态都有，与本判据无关），再交给
 * `shardflag-ps-parse.ps1` 用 PowerShell 自己的解析器读。
 *
 *   A 基线（HEAD，带裸 "--"，无新注释）      → 0 语法错、extent 含 -ArgumentList、长度 334、含裸 "--"
 *   B 注释插在反引号续行之后（我改掉的那版）  → 0 语法错、extent **不含** -ArgumentList、长度塌到 34
 *   C 当前工作副本（注释移到命令之前）        → 0 语法错、extent 含 -ArgumentList、长度 324、无裸 "--"
 *
 * B 是本轮改这个步骤时**自己踩到**的：语法一个错都不报，CI 会照跑，但 pnpm 带着 0 个实参被拉起来。
 * 这条原件的存在理由就是：证明"pwsh 解析通过"不构成任何证据，判据必须落到文本相邻性
 * （`findContinuationSevers`），其反证是变异电池里的 G/H/I 三条。
 *
 * 跑法：node .ccg/reviews/shardflag-ps3state.driver.js   （需要 pwsh；缺失即以非零码出声）
 */
const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const yaml = require('js-yaml')

const ROOT = path.resolve(__dirname, '..', '..')
const WF = '.github/workflows/quality-gate.yml'
const HELPER = path.join(__dirname, 'shardflag-ps-parse.ps1')

function shardRun (text) {
  const doc = yaml.load(text)
  for (const [jName, job] of Object.entries(doc.jobs || {})) {
    for (const st of (job.steps || [])) {
      if (typeof st.name === 'string' && st.name.indexOf('Desktop tests shard') >= 0) return { jName, run: st.run, shell: st.shell }
    }
  }
  throw new Error('SHARD_STEP_NOT_FOUND')
}
function parse (label, runText, tmpDir) {
  const f = path.join(tmpDir, 'dsf-variant-' + label + '.ps1')
  fs.writeFileSync(f, runText, 'utf8')
  try {
    return cp.execFileSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HELPER, f, label],
      { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 180000 }).trim().split(/\r?\n/).filter((l) => !/^LABEL/.test(l))
  } catch (e) {
    const code = e && e.code
    if (code === 'ENOENT') throw new Error('PWSH_MISSING：本机没有 pwsh，本原件什么都没测（不得当成"通过"）')
    throw e
  }
}

const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mp-dsf-ps-'))
let rc = 0
try {
  const head = cp.execFileSync('git', ['-C', ROOT, 'show', 'HEAD:' + WF], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const work = fs.readFileSync(path.join(ROOT, WF), 'utf8')
  const subst = (s) => s.replace(/\$\{\{[^}]*\}\}/g, '1/2')

  console.log('# shardflag 三态对照（PowerShell 解析器 + Start-Process extent）')
  console.log('# head=' + cp.execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
  console.log('# node=' + process.version + ' collectedAt=' + new Date().toISOString())
  console.log('# 说明：${{ ... }} 已按 GitHub 行为替换成实值 1/2；未替换时三态都会额外报一条模板伪影错。')

  const aText = subst(shardRun(head).run)
  const cText = subst(shardRun(work).run)
  console.log('\n== A 基线（HEAD：带裸 "--"，无本轮新增注释）')
  for (const l of parse('A', aText, tmpDir)) console.log('   ' + l)
  console.log('\n== C 当前工作副本（注释已移到 Start-Process 之前，裸 "--" 已删）')
  for (const l of parse('C', cText, tmpDir)) console.log('   ' + l)

  const aLines = aText.split(/\r?\n/)
  const at = aLines.findIndex((l) => /Start-Process -FilePath "pnpm\.cmd"/.test(l))
  if (at < 0) throw new Error('ANCHOR_A_MISSING')
  const bLines = aLines.slice(0, at + 1).concat(['          # MUT-B comment inside continuation'], aLines.slice(at + 1))
  console.log('\n== B 把注释插在反引号续行之后（本轮真实踩到的形态）')
  for (const l of parse('B', bLines.join('\r\n'), tmpDir)) console.log('   ' + l)

  console.log('\n== 结论对账（三条都必须成立，否则这条原件在说谎）')
  const facts = {}
  for (const [k, t] of [['A', aText], ['B', bLines.join('\r\n')], ['C', cText]]) {
    const out = parse(k, t, tmpDir)
    facts[k] = {
      errors: Number((out.find((l) => l.startsWith('PARSE_ERRORS=')) || '').split('=')[1]),
      arglist: (out.find((l) => l.startsWith('SP_HAS_ARGUMENTLIST=')) || '').split('=')[1],
      len: Number((out.find((l) => l.startsWith('SP_EXTENT_LEN=')) || '').split('=')[1]),
      bare: (out.find((l) => l.startsWith('SP_HAS_BARE_DASHDASH_ELEMENT=')) || '').split('=')[1],
    }
  }
  const checks = [
    ['A/B/C 三态 PARSE_ERRORS 全为 0（所以"语法没报错"不是判据）', facts.A.errors === 0 && facts.B.errors === 0 && facts.C.errors === 0],
    ['B 的 extent 丢掉了 -ArgumentList（False）而 A/C 保住（True）', facts.B.arglist === 'False' && facts.A.arglist === 'True' && facts.C.arglist === 'True'],
    ['A 的 extent 里确有裸 "--"（缺陷当时真的生效）', facts.A.bare === 'True'],
    ['C 的 extent 里没有裸 "--"（本 PR 的修复真的落到了那条命令上）', facts.C.bare === 'False'],
  ]
  for (const [name, ok] of checks) console.log('   ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name)
  console.log('   facts=' + JSON.stringify(facts))
  if (checks.some(([, ok]) => !ok)) rc = 1
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
process.exitCode = rc

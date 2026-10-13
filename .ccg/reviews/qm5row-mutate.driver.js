'use strict'
/*
 * check-record-qm5-rows.js 的变异反证驱动（8 条）
 * 每条变异都对应判据的一个分支；期望"指定的那条锁变红"。
 * 前置自检：
 *   P1 未变异基线必须 0 红（否则"变红"不能归因于变异）
 *   P2 期望锁名必须真实存在于测试文件（否则"没红"是名字写错）
 *   P3 锚点在文件中必须**唯一**命中，否则 ABORTED（锚点漂移没有失败信号）
 * 收尾：还原后与备份**逐字节相同**。
 * 用法：node qm5-mutate.driver.js            （跑全部）
 *       node qm5-mutate.driver.js --list     （只打印表）
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', '..')   // .ccg/reviews -> 仓库根；不写任何会话临时路径
const TARGET = path.join(ROOT, 'scripts', 'check-record-qm5-rows.js')
const TESTFILE = path.join(ROOT, 'scripts', 'check-record-qm5-rows.test.js')
const OUT = path.join(__dirname, 'qm5row-mutations.txt')

const Q = String.fromCharCode(39)
const dq = (s) => s.split('"').join(Q)

const MUTS = [
  {
    id: 'M1', axis: '判据A：必需集必须来自模板',
    target: '把"从模板派生"换成手抄五个（本仓模板实测不含 ③，手抄会让模板自己当场红）',
    expectRed: '必需步骤集从模板行题派生：模板声明什么就要求什么',
    edits: [['  return stepsFromText(templateText)', '  return [\x27①\x27, \x27②\x27, \x27③\x27, \x27④\x27, \x27⑤\x27]']],
  },
  {
    id: 'M2', axis: '判据B：只采表格行题',
    target: '行题判据退化成"整行任意位置出现该字样"（一句注释/正文就能把缺的行糊出来）',
    expectRed: '记录里出现的步骤标记按行题采集，正文里提到的字样不算',
    edits: [['const ROW_TITLE_STEP = /^\\|[ \\t]*([^|\\n]*?（QM-5\\s*([①②③④⑤])）[^|\\n]*?)[ \\t]*\\|/gm',
             'const ROW_TITLE_STEP = /^([^\\n]*)（QM-5\\s*([①②③④⑤])）([^\\n]*)$/gm']],
  },
  {
    id: 'M3', axis: '判据C：清单只能缩小',
    target: 'unregistered 恒空（新缺口可以靠"没人改它"永久隐身）',
    expectRed: '全仓未登记缺行必须被点名，且不依赖改动集（否则新缺口能靠"没人改它"隐身）',
    edits: [['if (!registered) unregistered.push({ file: rel, missing })',
             'if (false) unregistered.push({ file: rel, missing })']],
  },
  {
    id: 'M4', axis: '判据C：陈旧登记不许静默',
    target: 'stale 恒空（补齐了还挂在清单里也没人管 ⇒ 清单可以无限膨胀）',
    expectRed: '欠账登记项可以免报，但登记了却不缺 ⇒ 陈旧登记必须红（清单只能缩小）',
    edits: [['    if (missing.length === 0) stale.push(rel)', '    if (false) stale.push(rel)']],
  },
  {
    id: 'M5', axis: '域排除',
    target: '模板与豁免目录不再排出域外（判据来源变成被审对象，或豁免载体被绕过）',
    expectRed: '模板自身与豁免目录被排除（模板是判据来源，不是被审对象）',
    edits: [['  return isRecordPath(f) && !OUT_OF_DOMAIN.some((re) => re.test(f))', '  return isRecordPath(f)']],
  },
  {
    id: 'M6', axis: '约定判定',
    target: '去掉"未采用 QM-5 行题约定 ⇒ 不进域"的早退（老格式记录被误伤）',
    expectRed: '未使用 QM-5 约定的历史记录不进检查域（不误伤老格式）',
    edits: [['    if (present.size === 0) continue', '    if (false) continue']],
  },
  {
    id: 'M7', axis: '登记即免报',
    target: 'violations 不看登记状态（清单里已有的历史缺口每次被碰到都红 ⇒ 门禁会被整体摘掉）',
    expectRed: 'KNOWN_MISSING_QM5 每条必须带原因，且键必须是真实存在的记录文件',
    edits: [['    if (changed.includes(rel) && !registered) {', '    if (changed.includes(rel)) {']],
  },
  {
    id: 'M8', axis: 'CLI 层改动集',
    target: 'main() 里 changed 恒空（导出函数全对，但从进程入口进来时改动面消失 ⇒ 只有 CLI 端到端用例抓得到）',
    expectRed: 'CLI 端到端：临时 git 仓库里删掉 ⑤ 行必须 rc=1，补回必须 rc=0（正向对偶）',
    edits: [['.split(/\\r?\\n/).filter(Boolean)', '.split(/\\r?\\n/).filter(() => false)']],
  },
  {
    // 危害的确切表现：记录里用 ``` 块**演示**行题时，示例被当成真行 ⇒ "正文缺 ⑤、示例里有 ⑤"
    // 被读成合规。这条变异只摘剥围栏这一层，另一层（行题正则）不动，仍能红。
    id: 'M9', axis: '判据B的第二个落点：围栏代码块',
    target: '不剥 ``` 块（示例表格被当真行题采集）',
    expectRed: '围栏代码块里的示例表格不得充当真行题（否则"只有示例、没有真行"能骗过判据）',
    edits: [["  const normalized = String(text).replace(/\\r\\n/g, '\\n').replace(/^```[\\s\\S]*?^```[ \\t]*$/gm, '')",
            "  const normalized = String(text).replace(/\\r\\n/g, '\\n')"]],
  },
  {
    // 复合变异（两层同拆）：单摘归一 或 单加 $ 锚 都**不会**红 —— 因为剥了 CRLF 之后
    // 行尾本来就没有 \\r，$ 照样命中；这是防线冗余，不是覆盖漏洞。要证的危害是
    // "判据在真实工作副本形态（本仓 254/254 份记录都是 CRLF）上失明"，必须把两层一起造出来。
    id: 'M10', axis: 'CRLF 归一（复合：拆归一 + 行尾锚）',
    target: '去掉 CRLF 归一，并把行题正则改成要求行尾闭合（复刻"依赖行尾形状"的写法）',
    expectRed: 'CRLF 记录必须与 LF 记录采到同一组步骤（本仓工作副本实测 254/254 含 CRLF）',
    edits: [["  const normalized = String(text).replace(/\\r\\n/g, '\\n').replace(/^```[\\s\\S]*?^```[ \\t]*$/gm, '')",
            "  const normalized = String(text).replace(/^```[\\s\\S]*?^```[ \\t]*$/gm, '')"],
           ['[ \\t]*\\|/gm', '[ \\t]*\\|$/gm']],
  },
]

function applyEdits(src, edits) {
  let s = src
  for (const [from, to] of edits) {
    const first = s.indexOf(from)
    if (first < 0) return { error: 'ANCHOR_NOT_FOUND', detail: from.slice(0, 60) }
    if (s.indexOf(from, first + 1) >= 0) return { error: 'ANCHOR_NOT_UNIQUE', detail: from.slice(0, 60) }
    s = s.slice(0, first) + to + s.slice(first + from.length)
  }
  if (s === src) return { error: 'NO_CHANGE' }
  return { text: s }
}

function runTests() {
  const r = spawnSync(process.execPath, ['--test', TESTFILE],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  const out = (r.stdout || '') + (r.stderr || '')
  const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
  const passM = /ℹ pass (\d+)/.exec(plain)
  const failM = /ℹ fail (\d+)/.exec(plain)
  if (!passM || !failM) {
    return { broken: true, reason: 'NO_SUMMARY: ' + plain.slice(-260), pass: 0, fail: 0, names: [] }
  }
  const names = [...plain.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1])
  return { broken: false, pass: Number(passM[1]), fail: Number(failM[1]), names }
}

function main() {
  const original = fs.readFileSync(TARGET, 'utf8')
  const testSrc = fs.readFileSync(TESTFILE, 'utf8')
  const lines = []
  let preBad = 0

  // P2：期望锁名必须真实存在
  for (const m of MUTS) {
    if (!testSrc.includes(m.expectRed)) { console.log('P2_FAIL ' + m.id + ' 期望锁名不在测试文件里: ' + m.expectRed); preBad++ }
    for (const [from] of m.edits) {
      const c = original.split(from).length - 1
      if (c !== 1) { console.log('P3_FAIL ' + m.id + ' 锚点命中 ' + c + ' 次: ' + from.slice(0, 50)); preBad++ }
    }
  }
  // P1：未变异基线必须 0 红
  const base = runTests()
  if (base.broken || base.fail !== 0 || base.pass === 0) {
    console.log('P1_FAIL 基线不可信 broken=' + base.broken + ' pass=' + base.pass + ' fail=' + base.fail + ' :: ' + (base.reason || base.names.join('|')))
    fs.writeFileSync(OUT, 'ABORTED P1/P2/P3 preBad=' + preBad + '\n')
    process.exit(3)
  }
  console.log('PREFLIGHT ok baseline pass=' + base.pass + ' preBad=' + preBad)
  if (preBad) { console.log('ABORTED 前置自检有问题 preBad=' + preBad); process.exit(3) }

  if (process.argv.includes('--list')) { MUTS.forEach((m) => console.log(m.id + ' -> ' + m.expectRed)); process.exit(0) }

  let missed = 0, wrongCause = 0
  for (const m of MUTS) {
    const res = applyEdits(original, m.edits)
    if (res.error) { console.log('ABORTED ' + m.id + ' ' + res.error + ' :: ' + (res.detail || '')); fs.writeFileSync(OUT, lines.join('\n') + '\nABORTED ' + m.id + '\n'); process.exit(4) }
    fs.writeFileSync(TARGET, res.text)
    const t = runTests()
    fs.writeFileSync(TARGET, original)
    const restored = fs.readFileSync(TARGET, 'utf8') === original
    if (t.broken) { console.log('PROBE_BROKEN ' + m.id + ' ' + t.reason); missed++; continue }
    const hit = t.names.some((n) => n === m.expectRed)
    const status = t.fail === 0 ? 'MISSED(全绿=锁没响)' : (hit ? 'CAUGHT' : 'WRONG_CAUSE(fail=' + t.fail + ' 红的是: ' + t.names.join('|').slice(0, 90) + ')')
    if (!hit) missed++
    if (status.startsWith('WRONG_CAUSE')) wrongCause++
    console.log(m.id + ' ' + status + ' fail=' + t.fail + ' restored=' + restored)
    lines.push([m.id, status, 'fail=' + t.fail, 'expect=' + m.expectRed.slice(0, 44), 'red=' + t.names.join('|').slice(0, 140), 'restored=' + restored].join(' | '))
  }
  // 收尾：逐字节还原自检
  const same = fs.readFileSync(TARGET, 'utf8') === original
  const summary = 'PREFLIGHT_BAD=' + preBad + ' MUTATIONS=' + MUTS.length + ' MISSED=' + missed + ' WRONG_CAUSE=' + wrongCause + ' RESTORED_BYTES_EQUAL=' + same
  lines.push(summary)
  fs.writeFileSync(OUT, lines.join('\n') + '\n')
  console.log(summary)
  process.exit(missed === 0 && same ? 0 : 1)
}
main()

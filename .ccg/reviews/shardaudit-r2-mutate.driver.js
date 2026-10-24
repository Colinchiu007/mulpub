#!/usr/bin/env node
/**
 * `shard-audit-transient-retry` 第 2 轮外部评审锁的变异反证驱动（M10–M17）。
 *
 * 为什么驱动要**入库**：第 1 轮评审 i9 打的正是「§5 引用了 M10/M11/M12，但 diff 里没有任何
 * 执行器或读数，证据无法从交付物复现」。驱动留在本机临时目录 = 下一会话只能重抄一遍结论。
 *
 * 四条不自欺的判据（都写在代码里，不靠注释）：
 * ① 锚不唯一即抛 `MUT_ANCHOR`——"替换没发生"必须比"跑了且绿"更响；
 * ② **变异必须取被禁形态本身**：M15 第一版只把 `opts.api ||` 放回来、却没摘掉同段的
 *    `if (opts.api) throw` 守卫 ⇒ 该刀恒 MISSED，看起来像"锁没牙"，实际是探针没打到那一格
 *    （本仓记过的同型：反证没红先排"测错对象"）；
 * ③ 还原顺序是"先写回再比对"——第一版写成"先比对再写回"，于是每刀都打印
 *    `RESTORE_VERIFIED`，而那次比对读的是**仍是变异态**的文件，等于没验；
 * ④ 全部红集两两不同且各自非空，MISSED 或红集重复一律非零退出。
 *
 * 用法：`node .ccg/reviews/shardaudit-r2-mutate.driver.js`（工作目录 = 仓库根）。
 * 读数另存：`… > .ccg/reviews/shardaudit-r2-mutations.txt 2>&1`
 */
'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const AUDIT_IMPL = 'scripts/electron-ci-shard-audit.js';
const STEP_IMPL = 'scripts/electron-ci-desktop-step.js';
const STEP_TEST = 'scripts/electron-ci-desktop-step.test.js';
const AUDIT_TEST = 'scripts/electron-ci-shard-audit.test.js';

/** 每刀：变异取**被禁形态本身**（规则明文禁止的那个写法），不是随手改坏。 */
const MUTATIONS = [
  {
    id: 'M10', file: AUDIT_IMPL, suite: AUDIT_TEST, name: 'i2 反证：摘掉 rawStderr ⇒ 判据退回只看截断后的 200 字符',
    from: '    e.rawStderr = raw', to: '    // (mutation) rawStderr 不再挂出，判据只能看见截断文本',
  },
  {
    id: 'M11', file: AUDIT_IMPL, suite: AUDIT_TEST, name: 'i2 对偶反证：判据恒真 ⇒ "404 藏在长 stderr 尾部"被洗成概率事件',
    from: '  return TRANSIENT_PATTERNS.some((re) => re.test(text))', to: '  return true // (mutation) 恒判瞬时',
  },
  {
    id: 'M12', file: AUDIT_IMPL, suite: AUDIT_TEST, name: 'i4 反证：摘掉退避总预算 ⇒ "有界"退回输入的善意假设',
    from: '      if (slept + next > ctx.backoffBudgetMs) {', to: '      if (false) { // (mutation) 预算检查失效',
  },
  {
    id: 'M13', file: AUDIT_IMPL, suite: AUDIT_TEST, name: 'i8 反证：把空串退回静默回落（被禁的旧形态本身）',
    from: "  if (raw === undefined || raw === null) return dflt", to: "  if (raw === undefined || raw === null || raw === '') return dflt // (mutation)",
  },
  {
    id: 'M14', file: AUDIT_IMPL, suite: AUDIT_TEST, name: 'i11 反证：摘掉参数点名 ⇒ 坏 attempts 演成 TypeError',
    from: '  if (!Number.isInteger(ctx.attempts) || ctx.attempts < 1) {', to: '  if (false) { // (mutation) 不再点名坏参数',
  },
  {
    // 被禁形态 = "collect 里存在第二条取数面"。守卫与 `|| opts.api` 是同一件事的两半，
    // 只放开一半等于没放开（判据②）。
    id: 'M15', file: AUDIT_IMPL, suite: AUDIT_TEST, name: 'i7 反证：整段退回"守卫不存在 + opts.api 旁路"',
    from: [
      '  if (opts.api) {',
      "    throw new Error('BAD_COLLECT_OPTS opts.api 已移除：取数面只有 makeGhApi 一条，' +",
      "      '注入整份 api 会绕过重试与非法值校验 ⇒ 请改注入 spawnImpl')",
      '  }',
      '  const api = makeGhApi({',
    ],
    to: '  const api = opts.api || makeGhApi({',
  },
  {
    id: 'M16', file: STEP_TEST, suite: STEP_TEST, name: 'i3 反证：扶正分支摘掉样本量下限 ⇒ 8 片档照样能扶正',
    from: '      && newest.shards >= MIN_GOVERNING_SAMPLES', to: '      // (mutation) 下限不再参与判定',
  },
  {
    id: 'M17', file: STEP_IMPL, suite: STEP_TEST, name: 'i10 反证：从新档读数里抹掉分布下界 ⇒ 字段锁必须红',
    from: '      minShardMin: 19.4,', to: '      // (mutation) 这条读数不再带 min',
  },
]

function readBuf (rel) { return fs.readFileSync(path.join(REPO, rel)) }
function writeBuf (rel, buf) { fs.writeFileSync(path.join(REPO, rel), buf) }
function eolOf (text) { return text.indexOf('\r\n') >= 0 ? '\r\n' : '\n' }
function needleOf (mu, text) {
  return Array.isArray(mu.from) ? mu.from.join(eolOf(text)) : mu.from
}

/** 跑一套测试，返回失败用例名集合。红名解析要先剥 ANSI（Actions 与本机会带颜色）。 */
function runSuite (suiteRel) {
  const r = cp.spawnSync(process.execPath, ['--test', path.join(REPO, suiteRel)],
    { encoding: 'utf8', cwd: REPO, maxBuffer: 1 << 27 })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const plain = out.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '')
  const failed = new Set()
  for (const line of plain.split(/\r?\n/)) {
    const m = /^[^\S\r\n]*(?:✖|not ok)\s+(.+)$/.exec(line)
    if (!m) continue
    let nm = String(m[1]).replace(/^\d+-\s+/, '').replace(/\s+\(?[0-9.]+ms\)?\s*$/, '').trim()
    // node 的汇总头「✖ failing tests:」不是用例名；留着会让红集看起来比实际多一条。
    if (!nm || /^failing tests:?$/i.test(nm) || /^tests?$/i.test(nm)) continue
    failed.add(nm)
  }
  const failLine = /^[^\S\r\n]*[#ℹ]\s*fail\s+(\d+)/m.exec(plain)
  return { rc: r.status, failed, failCount: failLine ? Number(failLine[1]) : 0, raw: plain }
}

function main () {
  // 现场读数不得写本机绝对路径（AGENTS「受管文档不得新增本机绝对路径」；Gate 12c 只扫 .md/.js/…，.txt 恰好躲得过，但纪律不按判据的盲区划线）⇒ 只打仓库根的最后一段。
  console.log('[mut-dr] repoDirTail=' + path.basename(REPO) + ' mutations=' + MUTATIONS.length)
  const control = runSuite(AUDIT_TEST)
  const controlStep = runSuite(STEP_TEST)
  console.log('[mut-dr] 控制跑(全绿前置) audit rc=' + control.rc + ' fail=' + control.failCount +
    ' | step rc=' + controlStep.rc + ' fail=' + controlStep.failCount)
  if (control.rc !== 0 || controlStep.rc !== 0) {
    console.log('[mut-dr] ABORT 基线不绿 ⇒ 变异红集无法归因'); return 3
  }

  const TARGETS = Array.from(new Set(MUTATIONS.map((m) => m.file)))
  const snap = {}
  for (const t of TARGETS) snap[t] = readBuf(t)

  const sets = {}
  let missed = 0
  for (const mu of MUTATIONS) {
    const before = snap[mu.file]
    const text = before.toString('utf8')
    const needle = needleOf(mu, text)
    const hits = text.split(needle).length - 1
    if (hits !== 1) {
      console.log('[mut-dr] ' + mu.id + ' MUT_ANCHOR hits=' + hits + ' :: ' + JSON.stringify(needle.slice(0, 120)))
      return 2
    }
    try {
      writeBuf(mu.file, Buffer.from(text.replace(needle, mu.to), 'utf8'))
      const res = runSuite(mu.suite)
      sets[mu.id] = res.failed
      console.log('[mut-dr] ' + mu.id + ' ' + mu.name)
      console.log('[mut-dr]   rc=' + res.rc + ' fail=' + res.failCount +
        ' 红集=' + (Array.from(res.failed).join(' | ') || '(空)'))
      if (res.failCount === 0 || res.failed.size === 0) {
        missed++
        console.log('[mut-dr]   MISSED ⇒ 要么锁没牙，要么这一刀没打到它声称的那格（先按后者排查）')
      }
    } finally {
      writeBuf(mu.file, before)
      const back = readBuf(mu.file)
      if (!back.equals(before)) {
        console.log('[mut-dr] ' + mu.id + ' RESTORE_FAIL 写回后仍与快照不同 ⇒ 停在这里，不再跑后面的刀')
        return 4
      }
      console.log('[mut-dr] ' + mu.id + ' 逐字节还原: OK')
    }
  }

  const ids = Object.keys(sets)
  let distinct = true
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = sets[ids[i]]
      const b = sets[ids[j]]
      if (a.size === b.size && a.size > 0 && Array.from(a).every((x) => b.has(x))) {
        distinct = false
        console.log('[mut-dr] 红集相同: ' + ids[i] + ' == ' + ids[j])
      }
    }
  }
  const drift = TARGETS.filter((t) => !snap[t].equals(readBuf(t)))
  console.log('[mut-dr] 红集互不相同: ' + (distinct ? 'YES' : 'NO') +
    ' 空集=' + (ids.filter((k) => sets[k].size === 0).join(',') || '无') + ' MISSED=' + missed)
  console.log('[mut-dr] 收尾自检 与开局快照不同的文件=' + (drift.length ? drift.join(',') : '无'))
  return distinct && missed === 0 && drift.length === 0 ? 0 : 1
}

if (require.main === module) { process.exitCode = main() }
module.exports = { MUTATIONS, runSuite }

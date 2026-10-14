/**
 * verify-platform-onboarding 的测试（P3-1 验收判据③）。
 *
 * 风格对齐本仓既有 scripts/*.test.js：node:test + node:assert/strict
 * （本仓 scripts 下的测试没有 expect —— 用 vitest 风格会 expect is not a function，
 *   本文件第一版就是这么红的）。
 *
 * 关键：反证 —— 故意漏一步，该步必须 FAIL。
 * 一个永远绿的自检脚本比没有脚本更坏（它会让人以为查过了）。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts/verify-platform-onboarding.js')
const { buildChecks, slugIsKnown } = require(SCRIPT)

function run (slug) {
  const args = slug === '' ? [SCRIPT] : [SCRIPT, slug]
  try {
    const out = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

test('① 对已有平台 完全合规的平台 kuaishou 跑 ⇒ 13 条全 PASS，exit=0', () => {
  const r = run('kuaishou')
  assert.ok(r.out.includes('全部 13 条判据通过'), '实际输出尾部: ' + r.out.slice(-200))
  assert.ok(!r.out.includes('FAIL'), '不应有 FAIL')
  assert.equal(r.code, 0)
})

test('② 对不存在的 slug 跑 ⇒ exit 非 0，且逐条报 FAIL（不静默通过）', () => {
  const r = run('no_such_platform_xyz')
  assert.notEqual(r.code, 0)
  assert.match(r.out, /FAIL/)
  assert.ok(r.out.includes('config/platforms.yaml 里没有'))
  assert.ok(!r.out.includes('全部 13 条判据通过'))
})

test('②b 缺参数 ⇒ exit=2 并给用法', () => {
  const r = run('')
  assert.equal(r.code, 2)
  assert.ok(r.out.includes('用法'))
})

test('②c slug 形态非法 ⇒ exit=2（防路径注入）', () => {
  for (const bad of ['../etc', 'A-B', 'a b', 'a/b']) {
    const r = run(bad)
    assert.equal(r.code, 2, 'slug=' + bad + ' 未被拒绝（code=' + r.code + '）')
  }
})

test('③ 反证：不存在的 slug 让多数判据 FAIL，而全局不变量仍 PASS', () => {
  const checks = buildChecks('no_such_platform_xyz')
  assert.equal(checks.length, 13)
  const results = checks.map((c) => {
    try { return c.fn().ok } catch (e) { return false }
  })
  assert.ok(results.filter((x) => !x).length > 0, '不存在的 slug 必须让判据 FAIL')
  // ★ 步骤 12/13 是全局不变量（与 slug 无关），本就不该 FAIL ——
  //   这正是「逐条独立」的证据：不同判据对同一输入给出不同结论。
  assert.equal(results[11], true, '步骤 12 是全局不变量，不应因 slug 不存在而 FAIL')
  assert.equal(results[12], true, '步骤 13 是全局不变量，不应因 slug 不存在而 FAIL')
})

test('③b 反证：前 11 步对不存在的平台不能全部通过', () => {
  const checks = buildChecks('zzz_absent_platform')
  const perStep = checks.slice(0, 11).map((c) => {
    try { return { id: c.id, ok: c.fn().ok } } catch (e) { return { id: c.id, ok: false } }
  })
  const passed = perStep.filter((x) => x.ok)
  assert.ok(passed.length < 11, '步骤 ' + passed.map((x) => x.id).join(',') + ' 对不存在的平台也通过了')
  assert.ok(perStep.filter((x) => !x.ok).length >= 5, 'FAIL 步数低于预期底线')
})

test('slugIsKnown 对真实平台 true，对瞎写的 false', () => {
  assert.equal(slugIsKnown('kuaishou'), true)
  assert.equal(slugIsKnown('zzz_absent_platform'), false)
})

test('判据条数恰为 13（11 步 + 2 条额外），且 id 连续 1..13', () => {
  const checks = buildChecks('kuaishou')
  assert.deepEqual(checks.map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
})

test('每条判据都返回 {ok, detail} 形态（不抛）', () => {
  for (const c of buildChecks('kuaishou')) {
    const r = c.fn()
    assert.equal(typeof r.ok, 'boolean', '步骤 ' + c.id + ' 未返回 ok')
    assert.equal(typeof r.detail, 'string', '步骤 ' + c.id + ' 未返回 detail')
  }
})

test('输出里 PASS/FAIL 逐条可见（不是只给汇总）', () => {
  const r = run('kuaishou')
  const passes = (r.out.match(/^PASS/gm) || []).length
  assert.equal(passes, 13)
})

// ───────────────────────────────────────────────────────────────────────────
// 回归：YAML 平台块提取的边界（2026-10-14）
//
// 动因：步骤 9 对 weibo / zhihu / toutiao 误报「has_api:true 但无链」，
// 而这三个平台实际都是 `has_api: false`。根因是块提取写成
//     rest.slice(1).search(/^\s{2}\S/)        ← 缺 /m
// 无 /m 时 `^` 只匹配字符串开头，而 rest.slice(1) 从行中间开始 ⇒ 恒返回 -1
// ⇒ block 退化成「文件剩余全部」⇒ has_api 判据实际问的是
//   「**该平台之后**有没有任何平台是 true」，与平台自身无关（**文件顺序依赖**）。
//
// ★ 这 4 条断言是**边界断言**，不是汇总断言 —— 原有 10 条测试只断言整条命令的
//   PASS/FAIL 汇总，照不到「块提取抓了多少行」这个维度（同第 41 轮 ESLint 的教训）。
// ───────────────────────────────────────────────────────────────────────────
const YAML_CASES = [
  // [slug, 期望块行数（不含键行）, 期望 has_api]
  ['toutiao', 17, false],
  ['weibo', 14, false],
  ['zhihu', 17, false],
  ['baijiahao', 17, true],
  ['douyin', 16, true],
]

test('回归：平台块提取不能吃到别的平台（文件顺序依赖 bug）', () => {
  const fs = require('node:fs')
  const y = fs.readFileSync(path.join(ROOT, 'config/platforms.yaml'), 'utf8')
  const lines = y.split(/\r?\n/)
  for (const [slug, expectLines, expectHasApi] of YAML_CASES) {
    // 独立真源：按行扫描重建块（与实现无关，避免「用同一个错实现验自己」）
    const blocks = []
    let cur = null
    for (const l of lines) {
      const m = l.match(/^[ \t]{2}([a-z][a-z0-9_]*):[ \t]*$/)
      if (m) { cur = { slug: m[1], lines: [] }; blocks.push(cur); continue }
      if (cur) cur.lines.push(l)
    }
    const b = blocks.find((x) => x.slug === slug)
    assert.ok(b, `真源里找不到 ${slug}`)
    assert.equal(b.lines.length, expectLines, `${slug} 块行数（真源）`)
    const ha = b.lines.find((l) => /^[ \t]{4}has_api:/.test(l))
    assert.ok(ha, `${slug} 无 has_api 行`)
    assert.equal(/^[ \t]{4}has_api:[ \t]*true/.test(ha), expectHasApi, `${slug} 的 has_api`)

    // ★ 关键断言：该块**不得**包含其他平台的 has_api 行
    const otherHasApi = b.lines.filter((l) => /^[ \t]{4}has_api:/.test(l))
    assert.equal(otherHasApi.length, 1, `${slug} 块内有 ${otherHasApi.length} 个 has_api（应为 1）`)
  }
})

test('步骤 9 对 has_api:false 的平台不得去找发布链（顺序无关）', () => {
  const checks = buildChecks('toutiao')
  const step9 = checks.find((c) => c.id === 9)
  const r = step9.fn()
  assert.equal(r.ok, true, `toutiao(has_api:false) 的步骤 9 应通过，实际: ${r.detail}`)
  assert.ok(r.detail.includes('无需发布链'), `详情应说明无需发布链，实际: ${r.detail}`)
})

test('步骤 9 的顺序无关性：把平台在文件里的位置换掉，结论不变', () => {
  // 用三个 has_api:false 的平台互相印证 —— 若判据依赖「后面有没有 true 平台」，
  // 这三个必然给出不同结论（实测正是如此：xiaohongshu 过、weibo/zhihu 不过）。
  for (const slug of ['weibo', 'zhihu', 'toutiao']) {
    const r = buildChecks(slug).find((c) => c.id === 9).fn()
    assert.equal(r.ok, true, `${slug}(has_api:false) 步骤 9 应通过，实际: ${r.detail}`)
  }
})

// ───────────────────────────────────────────────────────────────────────────
// 合规版图快照（2026-10-14 P3-1 首次全量跑出的真实结果；同日 P3-2-A 修掉第一项）
//
// ★ 这条测试的作用是**记录现状**，不是「说现状是对的」。
//   它把「哪些平台在哪些判据上有缺口」钉住，任何变化（修好了，或又坏了）都会让它红。
//
// 首跑结果：15 个平台里**只有 4 个**完全合规。逐条核对过：
//   · 步骤 4 要求 `enabled` 有设计文 §9.3 依据（且它是「单平台一键回滚」机制，
//     见 ARCH-REUSE-INTEGRATION §9.3 回滚成本段）。首跑缺它的三个：
//     tencent_video / baijiahao / instagram。
//     **2026-10-14 P3-2（方案 A，只碰已有平台）已补齐这三个并改成棘轮** ——
//     本快照随之更新（原话：「若是有意修好了，请同步更新本快照」）。
//   · 步骤 10 要求候选文件含 formatArticleBody —— 是否过严**尚未裁定**，
//     故本快照如实记录，不宣称这些平台「有缺陷」。
// ───────────────────────────────────────────────────────────────────────────
const FULLY_COMPLIANT = ['douyin', 'xiaohongshu', 'kuaishou', 'bilibili', 'baijiahao']

/**
 * 缺 `enabled` 的平台集合 —— **必须恒为空**。
 *
 * 首跑的「真发现」是 `['tencent_video', 'baijiahao', 'instagram']`，已在 P3-2-A 补齐。
 * 这里从「记录已知缺口」改成「**禁止**该缺口」：空数组是**断言目标**，不是待办清单。
 */
const MISSING_ENABLED = []

test('合规版图快照：完全合规的平台集合', () => {
  const all = ['wechat_mp', 'zhihu', 'weibo', 'douyin', 'xiaohongshu', 'tencent_video',
    'kuaishou', 'toutiao', 'youtube', 'tiktok', 'bilibili', 'baijiahao', 'twitter', 'instagram', 'facebook']
  const compliant = all.filter((s) => buildChecks(s).every((c) => {
    try { return c.fn().ok } catch (e) { return false }
  }))
  assert.deepEqual(compliant, FULLY_COMPLIANT,
    '合规平台集合变了 —— 若是有意修好了，请同步更新本快照；若是退化，请查因')
})

test('棘轮：没有任何平台缺 enabled 字段（「单平台一键回滚」可达性）', () => {
  const fs = require('node:fs')
  const y = fs.readFileSync(path.join(ROOT, 'config/platforms.yaml'), 'utf8')
  const lines = y.split(/\r?\n/)
  const blocks = []
  let cur = null
  for (const l of lines) {
    const m = l.match(/^[ \t]{2}([a-z][a-z0-9_]*):[ \t]*$/)
    if (m) { cur = { slug: m[1], lines: [] }; blocks.push(cur); continue }
    if (cur) cur.lines.push(l)
  }
  // 规模下界：防止解析退化成空集合后「空 == 空」假绿
  assert.ok(blocks.length >= 15, `平台块解析数异常（${blocks.length}），判据可能空转`)
  const missing = blocks.filter((b) => !b.lines.some((l) => /^[ \t]{4}enabled:/.test(l))).map((b) => b.slug)
  assert.deepEqual(missing, MISSING_ENABLED,
    '有平台缺 enabled —— 这是「单平台一键回滚」的可达性问题，请核对（不要把它加回白名单）')
})

test('步骤 4 确实在查 enabled（不是恒过的空判据）', () => {
  // 正控：全部平台步骤 4 都应过（含原先缺 enabled 的三个）
  for (const slug of ['kuaishou', 'tencent_video', 'baijiahao', 'instagram']) {
    const r = buildChecks(slug).find((c) => c.id === 4).fn()
    assert.equal(r.ok, true, `${slug} 步骤 4 应过，实际: ${r.ok} / ${r.detail}`)
    assert.ok(/7 个字段齐/.test(r.detail), `${slug} 步骤 4 详情应报「7 个字段齐」，实际: ${r.detail}`)
  }
  // ★ 负控不在这里做「假反证」：`buildChecks` 从磁盘读真实 YAML，无法注入夹具。
  //   判据 4 会 FAIL 这一点由**变异跑**证明（临时抽掉某个平台的 enabled ⇒
  //   上面的棘轮测试与断言 ① 当即变红，见 PR 描述）。把它写成
  //   「拿字面量测正则」的形式是同义反复，属假反证，故**刻意不写**。
})

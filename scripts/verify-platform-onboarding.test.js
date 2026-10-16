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
//
// ★ 2026-10-16 p3-residual-criteria **已裁定并修复**（本快照随之更新为「15 个全合规」）：
//   · 步骤 10（C 类）：**判据正确，缺陷在平台侧**。实测 6 个适配器确实各自在写
//     content/description 字段（zhihu/toutiao 直写 `stripped.content`、weibo 拼 composed、
//     tiktok/youtube 直写 description、twitter 拼裸 content）——正是 AGENTS.md 禁止的
//     「各链自抄转换」。已逐个改走 `formatArticleBody()`（含 toutiao：**HTML 承载平台**，
//     原样直写纯文本会让平台把换行当可忽略空白、整篇塌成一段，与 2026-10-12 百家号事故同型）。
//   · 步骤 9（B 类）+ 步骤 11（E 类）：**判据错**，已改口径，见各判据处注释与本文件对应棘轮。
// ───────────────────────────────────────────────────────────────────────────
const FULLY_COMPLIANT = [
  'wechat_mp', 'zhihu', 'weibo', 'douyin', 'xiaohongshu', 'tencent_video',
  'kuaishou', 'toutiao', 'youtube', 'tiktok', 'bilibili', 'baijiahao',
  'twitter', 'instagram', 'facebook',
]

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

// ───────────────────────────────────────────────────────────────────────────
// 判据 9 的锚定独立性（2026-10-15 假绿事故的回归锁）
//
// 事故：`/^[ \t]{4}has_api:[ \t]*true/.test(block)` **缺 m 标志** ⇒ `^` 只锚字符串
// 开头 ⇒ 该判据**只在「块的第一行恰好是 has_api」时才执行**，其余一律走
// `if (!hasApi) return { ok: true, detail: 'has_api 非 true ⇒ 无需发布链' }` ⇒ 判通过。
// 实测 15 个平台里 **6 个是假绿**（douyin / tencent_video / kuaishou / bilibili /
// baijiahao / facebook），其中 tencent_video 与 facebook 是 has_api:true 却 0 个链文件
// —— 真缺口被这条假绿藏住了。只有恰好把 has_api 写在块首行的 youtube / twitter 被抓到。
//
// ★ 反证用**真实数据**，不造夹具：`facebook` 的 has_api 不在块首行且无链 ⇒ 期望 FAIL。
//   若有人去掉 m，它会误判 PASS ⇒ 本测试当场变红。
// ───────────────────────────────────────────────────────────────────────────
test('判据 9 不依赖 has_api 在块中的位置（缺 m 标志的假绿回归锁）', () => {
  // ⚠️ 2026-10-16 样本更换（p3-residual-criteria）：原样本是 `facebook`（has_api:true + 无链 ⇒ 应 FAIL），
  //    但裁定后 facebook 已改 `has_api:false`（空声明 ⇒ 配置缺陷）⇒ 原样本不再 FAIL。
  //    新口径：把「位置依赖」这个**缺陷本身**做成可辨 ---- 缺 `m` 标志时，块首行不是 has_api 的平台
  //    会走早退分支「has_api 非 true ⇒ 无需发布链」；有 `m` 时走链/适配器分支。
  //    故断言详情的**文本归属**即可判定走没走对分支。
  const fs = require('node:fs')
  const lines = fs.readFileSync(path.join(ROOT, 'config/platforms.yaml'), 'utf8').split(/\r?\n/)

  // ★ 前提断言：样本的 has_api **确实不在块首行**——否则本锁测不到「位置依赖」，形同空转
  const idx = lines.findIndex((l) => /^[ \t]{2}douyin:[ \t]*$/.test(l))
  assert.ok(idx > 0, 'douyin 块未找到 ⇒ 样本失效，不得继续判定')
  const blockLines = []
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^[ \t]{2}\S/.test(lines[i])) break
    blockLines.push(lines[i])
  }
  assert.ok(blockLines.length > 0, 'douyin 块解析为空 ⇒ 本锁不得假绿')
  const firstNonEmpty = blockLines.find((l) => l.trim() !== '')
  assert.ok(
    !/^[ \t]{4}has_api:/.test(firstNonEmpty),
    `douyin 的 has_api 恰在块首行（${String(firstNonEmpty).trim()}）⇒ 本锁样本失效，请换平台`,
  )

  // 判据必须走 has_api 分支（链），**不得**走缺 m 标志时那条早退分支
  const dy = buildChecks('douyin').find((c) => c.id === 9).fn()
  assert.equal(dy.ok, true, `douyin 步骤 9 应 PASS，实际: ${dy.ok} / ${dy.detail}`)
  assert.ok(/链 \d+ 个/.test(dy.detail), `douyin 详情应来自链分支（含「链 N 个」），实际: ${dy.detail}`)
  assert.ok(!/无需发布链/.test(dy.detail), `douyin 误走早退分支 ⇒ m 标志可能缺失。实际: ${dy.detail}`)

  // 正控：has_api 同样不在块首行、但**有链**的平台应 PASS（证明上一条不是「恒 FAIL」）
  for (const slug of ['kuaishou', 'bilibili', 'baijiahao']) {
    const r = buildChecks(slug).find((c) => c.id === 9).fn()
    assert.equal(r.ok, true, `${slug} 步骤 9 应 PASS，实际: ${r.ok} / ${r.detail}`)
  }

  // 两轴语义（2026-10-16 裁定）：has_api:true + 0 链但**有 API 适配器** ⇒ 合法（未入波）
  for (const slug of ['youtube', 'twitter']) {
    const r = buildChecks(slug).find((c) => c.id === 9).fn()
    assert.equal(r.ok, true, `${slug}(has_api:true + 有适配器 + 无链) 步骤 9 应 PASS，实际: ${r.ok} / ${r.detail}`)
    assert.ok(/未入波/.test(r.detail), `${slug} 详情应说明「未入波」两轴语义，实际: ${r.detail}`)
  }
  // 而**既无链也无适配器**的声明必须 FAIL（本判据放宽后的下界，不得变成恒过）
  // —— 用真实数据取证：facebook 曾经就是这种形态，现已改 has_api:false；
  //    此处断言它的取值已修正，使「空声明」这一 FAIL 分支有据可查。
  const fbBlock = lines.slice(lines.findIndex((l) => /^[ \t]{2}facebook:[ \t]*$/.test(l)))
  const fbHasApi = (fbBlock.slice(0, 25).find((l) => /^[ \t]{4}has_api:/.test(l)) || '').trim()
  assert.equal(fbHasApi, 'has_api: false', `facebook 应为 has_api: false（空声明已修正），实际: ${fbHasApi}`)

  // ★ CCG 自扮演裁决 i4（2026-10-16，upheld）：「空声明 ⇒ FAIL」分支放宽后**已无真实样本**
  //   （15 个平台都合法）⇒ 只断言 facebook 的配置值**跑不到那条分支**，分支若被删成恒过没人知道。
  //   两条防线：
  //     ① 结构锁（本处）—— FAIL 分支的判据代码必须仍在源码里，删掉即红；
  //     ② 变异反证（记录在案）—— 把 facebook 临时改回 has_api:true ⇒ ⑨ 必须 FAIL。
  //   如实说明：这不是行为级覆盖（`buildChecks` 从磁盘读真实 YAML，无法注入夹具），
  //   故它与 ② 合起来守，不单独声称覆盖。
  const scriptSrc = require('node:fs').readFileSync(SCRIPT, 'utf8')
  assert.ok(
    /⇒ 空声明/.test(scriptSrc),
    '判据 9 的「空声明 ⇒ FAIL」分支在源码里找不到了 —— 放宽后该下界不得被静默删除',
  )
  assert.ok(
    /api-only' \|\| publishMode === 'api-then-dom/.test(scriptSrc),
    '判据 9 的「api-* 轨必须有链」分支在源码里找不到了（CCG i1 修复项）',
  )

  // ★ CCG 第三轮 i3（upheld）后补：publishMode **缺省派生必须与运行时同源**。
  //   运行时 api-router.js 的 getPublishMode/isApiTrack 在缺省时按
  //   `has_api:true → api-then-dom` 派生；⑨ 原来把缺省当 '' ⇒ 判「未入波」PASS，
  //   **同一份配置，判据与运行时给出相反结论** ⇒ 两轴不一致被漏报。
  //   当前 15 个平台全部显式写了 publishMode（实测无一样本），故这条分支没有真实样本
  //   可跑，用结构锁守：源码里必须出现「缺省 ⇒ 按 has_api 派生」的三元式，
  //   且不得退回空串（退回即让上面的矛盾复活）。
  assert.ok(
    /pmMatch\s*\?\s*pmMatch\[1\]\s*\n\s*:\s*\(hasApi \? 'api-then-dom' : 'dom-only'\)/.test(scriptSrc),
    '判据 9 的 publishMode 缺省派生不见了 —— 缺省必须按运行时同源规则（has_api → api-then-dom）；'
      + '退回空串会让「两轴不一致」被漏报（CCG 第三轮 i3）',
  )

  // 别名：tencent_video 的链叫 shipinhao-*，不得因命名差异误报
  const tv = buildChecks('tencent_video').find((c) => c.id === 9).fn()
  assert.equal(tv.ok, true, `tencent_video 步骤 9 应 PASS（链名 shipinhao-*），实际: ${tv.ok} / ${tv.detail}`)
})

/**
 * `has_api: true` 却无发布链的平台集合 —— **2026-10-16 p3-residual-criteria 已裁定，现为空**。
 *
 * 原记录的三个（youtube / twitter / facebook）共同点是「声明有 API 能力」+
 * 「`publishMode: dom-only`」+「无链实现」。裁定**按证据分两类**，不是一刀切：
 *
 *   · **youtube / twitter**：二者**都有完整的 API 适配器**
 *     （`adapters/youtube.js` = YouTube Data API v3 + OAuth2；`adapters/twitter.js` 同构）
 *     ⇒ `has_api:true` 是**诚实的**。本仓语义本就是两个独立轴（`publish-mode-config.test.js`
 *     的「未入波」锚点注释）：`has_api` = 有没有 API 实现；`publishMode` = 当前走哪条轨。
 *     ⇒ 判据 9 放宽为「有声明 ⇒ 至少有**实现证据**（链或适配器）」，不再把两轴混为一谈。
 *   · **facebook**：**既无链也无适配器**（两个目录都没有它的文件）⇒ 真·空声明。
 *     而 `api-router.js` 的 `supportsApi()` 就是 `!!cfg.has_api` ⇒ 原值让它谎称支持 API 轨。
 *     ⇒ 按**配置缺陷**修：`has_api: false`（见 `config/platforms.yaml` 该块注释）。
 *
 * ★ 本列表是**棘轮**：修好后请同步更新（并说明裁定结果），不得直接删条目了事。
 *   维持为空本身即新棘轮 —— 若再出现「有声明但零实现」的平台，这里会红。
 */
const STEP9_CHAIN_GAPS = []

test('棘轮：has_api:true 但无发布链的平台集合（2026-10-16 裁定后为**空**）', () => {
  const fs = require('node:fs')
  const y = fs.readFileSync(path.join(ROOT, 'config/platforms.yaml'), 'utf8')
  // 与实现同源：按行扫描块
  const lines = y.split(/\r?\n/)
  const blocks = []
  let cur = null
  for (const l of lines) {
    const m = l.match(/^[ \t]{2}([a-z][a-z0-9_]*):[ \t]*$/)
    if (m) { cur = { slug: m[1], lines: [] }; blocks.push(cur); continue }
    if (cur) cur.lines.push(l)
  }
  // 规模下界：防解析退化成空集合后「空 == 空」假绿
  assert.ok(blocks.length >= 15, `平台块解析数异常（${blocks.length}），判据可能空转`)

  const gaps = blocks
    .filter((b) => /^[ \t]{4}has_api:[ \t]*true/m.test(b.lines.join('\n')))
    .map((b) => b.slug)
    .filter((slug) => {
      const r = buildChecks(slug).find((c) => c.id === 9).fn()
      return !r.ok
    })
  assert.deepEqual(gaps, STEP9_CHAIN_GAPS,
    'has_api:true 却无链的平台集合变了 —— 若是有意修好了，请更新本棘轮并写明裁定结果；若是退化，请查因')
})

// ───────────────────────────────────────────────────────────────────────────
// TAG_STYLES 缺席走默认：判据过严的修正 + 放宽后「不许空转」的反向锁
// （2026-10-15 放宽判据；2026-10-16 表本身对齐注册表 ⇒ 缺席集合已空）
//
// 原判据 7/8 要求 TAG_STYLES 有该 slug 的**显式键**。但：
//   · content-formatter.js 的 formatTags 是 `TAG_STYLES[platform] || '#tag'`
//     —— **有默认兜底**，缺席不是坏；
//   · 默认值 '#tag' 对海外/短视频平台的 hashtag 约定**恰好正确**。
// 实测：原判据下 6 个平台 FAIL 且 detail 全是「TAG_STYLES 无 <slug>」
// （CONTENT_LIMITS / TITLE_LIMITS 均命中）—— 全部是判据过严，不是平台缺陷。
//
// ★ 2026-10-16 变化（p3-residual-criteria）：原表有 **29 个键**，其中 **19 个**在两个平台
//   真源里都不存在（注册表无、platform-definitions.js 的 15 张表全无命中）⇒ 不可达死键，已删；
//   同时把 6 个走兜底的平台（youtube/tiktok/twitter/instagram/facebook/tencent_video）**显式登记**
//   （取值与原先的兜底 `'#tag'` 同值 ⇒ 行为等价；`shipinhao` 改回真 slug `tencent_video`）。
//   ⇒ 现在 15 个平台**全部有显式键**，本常量随之清空；维持它为空本身是新的棘轮：
//     若有人把某平台的键删掉（回到兜底），这里会红并提示「要么是有意为之，要么是误删」。
//   ⇒ 表与注册表的**键集一致**另由 packages 侧的 G 用例锁住
//     （content-formatter-registry-sync.test.js：键集 ⊆ 注册表，且不得含 shipinhao）。
//
// ★ 反向锁（仍然有效，不许空转）：放宽后最怕的是「TAG_STYLES 整体失效也没人发现」。
//   所以这里直接钉住**默认兜底值本身合法**：
//   把 formatTags 的兜底从 '#tag' 改成非法值 ⇒ 判据 7/8 必须对缺席平台转 FAIL。
//   该变异已实跑（见 PR 描述），确认全红。
// ───────────────────────────────────────────────────────────────────────────
const TAG_STYLES_ABSENT_OK = []
const TAG_STYLES_ALLOWED = ["'#tag'", "'#tag#'", "'plain'"]

test('TAG_STYLES 缺席的平台走默认兜底，且判据 7/8 不空转', () => {
  const fs = require('node:fs')
  const fmt = fs.readFileSync(path.join(ROOT, 'packages/api-publish-engine/src/content-formatter.js'), 'utf8')

  // ① 默认兜底值必须可解析且合法（反向锁的核心）
  const dm = fmt.match(/TAG_STYLES\[platform\]\s*\|\|\s*'([^']+)'/)
  assert.ok(dm, 'formatTags 的默认兜底表达式不可解析 —— 判据 8 的缺席分支会失效，请核对')
  assert.ok(TAG_STYLES_ALLOWED.includes(`'${dm[1]}'`),
    `默认兜底 '${dm[1]}' 不在允许集 ${TAG_STYLES_ALLOWED.join(' / ')} —— 这会让所有缺席平台的标签样式退化`)

  // ② ⚠️ 2026-10-16：本分支**已无真实样本**（15 个平台全有显式键 ⇒ TAG_STYLES_ABSENT_OK 为空）。
  //    不许留一个永不执行的循环冒充覆盖 —— 这里把「为空」本身断言出来，
  //    并显式声明缺席分支的守护方式：① 的兜底值锁 + 一次**变异**
  //    （临时删掉某平台的键 ⇒ 判据 7/8 必须转 PASS 且 detail 报「缺席走默认」；已实跑记录）。
  assert.deepEqual(TAG_STYLES_ABSENT_OK, [],
    '本常量应恒为空：15 个平台都已显式登记（若有平台回到兜底，要么是有意为之请更新本清单并说明，要么是误删）')

  // ③ 全部平台必须报「显式命中」，不许被算成走默认（这才是现在真实生效的覆盖）
  // ★ CCG 第四轮 i5（upheld）：平台清单改为从**注册表动态派生**，不再硬编码 15 个名字
  //   （原先注册表加平台时要手改这里，正是本 PR 要消灭的漂移模式）。
  const fs2 = require('node:fs')
  const yaml2 = fs2.readFileSync(path.join(ROOT, 'config/platforms.yaml'), 'utf8')
  const ALL_PLATFORMS = yaml2.split(/\r?\n/)
    .filter((l) => /^[ \t]{2}[a-z][a-z0-9_]*:[ \t]*$/.test(l))
    .map((l) => l.trim().replace(/:$/, ''))
  assert.ok(ALL_PLATFORMS.length >= 15,
    `平台清单解析数 ${ALL_PLATFORMS.length} < 15 ⇒ 解析退化，本用例不得假绿`)
  for (const slug of ALL_PLATFORMS) {
    const r7 = buildChecks(slug).find((c) => c.id === 7).fn()
    assert.equal(r7.ok, true, `${slug} 判据 7 应 PASS，实际: ${r7.detail}`)
    assert.ok(/TAG_STYLES 显式命中/.test(r7.detail),
      `${slug} 有显式键却报成走默认，说明键匹配退化了。实际: ${r7.detail}`)
  }

  // ④ 规模下界：CONTENT_LIMITS / TITLE_LIMITS 仍要求显式键（不许一起被放宽）
  for (const slug of ALL_PLATFORMS) {
    const r7 = buildChecks(slug).find((c) => c.id === 7).fn()
    // detail 里不得出现「CONTENT_LIMITS 无」/「TITLE_LIMITS 无」才算真的过了那两关
    assert.ok(!/CONTENT_LIMITS 无|TITLE_LIMITS 无/.test(r7.detail),
      `${slug} 的上限表仍有缺失，不应只靠 TAG_STYLES 放宽混过。实际: ${r7.detail}`)
  }
})

// ───────────────────────────────────────────────────────────────────────────
// 判据 11 适用面（2026-10-16 p3-residual-criteria）
//
// 原判据 11 有两条**测量错作用面**的子判据，实测 9 个平台 FAIL：
//   ① 「content-formatter.test.js 里有没有该 slug 的**字面量**」——而本仓 formatter 限值的
//      真实覆盖是**按注册表遍历**的契约锁（content-formatter-registry-sync.test.js 的 A 用例
//      遍历 Object.keys(PLATFORM_PUBLISH_META) 逐平台断言），注册表加平台覆盖自动跟上。
//      ⇒ 对 youtube/tiktok/twitter/instagram/facebook 是**假 FAIL**（它们的限值其实已被逐平台断言）。
//   ② 「必须有 test/<slug>*.js」——对**无链平台**（dom-only：wechat_mp/weibo/toutiao/instagram/
//      facebook 等）恒不可满足（本来就没有链可测）；且 `tencent_video` 的链级测试叫
//      `shipinhao-*.test.js`（文件名≠slug），漏了别名表 ⇒ 存在却判「无」，与判据 9 同型假 FAIL。
//
// ★ 放宽后必须有下界，否则等于关掉判据 —— 本用例就是那个下界。
// ───────────────────────────────────────────────────────────────────────────
test('判据 11 适用面修正：有链才要求链级测试 + 别名同源 + 不存在的平台不得通过', () => {
  // ① 有链平台：详情必须报出「链 N 个 + 链级测试 M 个」（证明走的是链分支，不是恒过）
  for (const slug of ['douyin', 'kuaishou', 'bilibili', 'baijiahao']) {
    const r = buildChecks(slug).find((c) => c.id === 11).fn()
    assert.equal(r.ok, true, `${slug} 判据 11 应 PASS，实际: ${r.detail}`)
    assert.match(r.detail, /链 \d+ 个 \+ 链级测试 \d+ 个/,
      `${slug} 详情未报链与链级测试数 ⇒ 可能走了恒过分支。实际: ${r.detail}`)
  }

  // ② 别名同源（与判据 9 共用 CHAIN_NAME_ALIASES）：tencent_video 必须看到 shipinhao-* 的链。
  //    若有人把 ⑪ 的别名去掉，链数会变成 0、detail 转为「无发布链…」⇒ 本断言变红。
  const tv = buildChecks('tencent_video').find((c) => c.id === 11).fn()
  assert.equal(tv.ok, true, `tencent_video 判据 11 应 PASS，实际: ${tv.detail}`)
  assert.match(tv.detail, /链 2 个 \+ 链级测试 \d+ 个/,
    `tencent_video 未按别名看到 shipinhao-* 的链 ⇒ 判据对命名差异失明（与判据 9 同型）。实际: ${tv.detail}`)

  // ③ 无链平台：**不得**因「无链可测」被判红（原判据对它们恒不可满足）
  for (const slug of ['wechat_mp', 'weibo', 'toutiao', 'instagram', 'facebook']) {
    const r = buildChecks(slug).find((c) => c.id === 11).fn()
    assert.equal(r.ok, true, `${slug}（无发布链）判据 11 应 PASS，实际: ${r.detail}`)
    assert.match(r.detail, /无发布链 ⇒ 不要求链级测试/,
      `${slug} 详情未如实说明「无链 ⇒ 不要求链级测试」。实际: ${r.detail}`)
  }

  // ④ 下界：**不存在的平台**必须 FAIL（证明这段放宽没有把判据变成恒过）
  const fake = buildChecks('no_such_platform_xyz').find((c) => c.id === 11).fn()
  assert.equal(fake.ok, false, `不存在的平台不得通过判据 11，实际: ${fake.ok} / ${fake.detail}`)
  assert.match(fake.detail, /不在注册表/, `详情应点名「不在注册表」，实际: ${fake.detail}`)

  // ⑤ 下界：**真实的 15 个平台都在注册表内**（证明 ④ 的判据基准不是空的）
  const real = buildChecks('douyin').find((c) => c.id === 11).fn()
  assert.match(real.detail, /formatter 覆盖由注册表驱动契约锁提供/,
    `在册平台应报「注册表驱动覆盖」。实际: ${real.detail}`)
})

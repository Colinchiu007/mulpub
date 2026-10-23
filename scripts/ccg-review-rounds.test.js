'use strict'
/**
 * ccg-review-rounds.test.js —— 外部深审的跨调用轮次账本（tasks §1）
 *
 * 这把锁测的四件事，每一件都对应一个"看起来正常但计数已经失效"的形态：
 *  ① 计数键是 **(change, headSha)**，不是判定记录名——记录名是内容寻址，重投提交就换名
 *     （§0.1 实测：同一文件加一行，哈希 90dce309… → 720882d6…）。挂记录名 ⇒ 每次归零且全程静默。
 *  ② 同一 sha 重跑（填完裁决再跑一次那种）**不计数**，且 sha 只在驱动真被调用之后才落账——
 *     没跑成就记一轮，等于把失败烧进配额。
 *  ③ 上限只能来自现读的 env 默认；非法值回落 3 且**必须出声**（静默回落 = 没人知道上限被改过）。
 *  ④ 超限是**升级**不是放行：不叫模型、打印 escalated、非零退出。
 *
 * 跑法：node --test scripts/ccg-review-rounds.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const LIB = path.join(__dirname, 'lib', 'ccg-review-rounds.js')

function tmpLedger () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-rounds-${process.pid}-`))
  return { dir, file: path.join(dir, 'external-rounds.json') }
}

test('R1 上限默认 3；env 覆盖生效；非法值回落 3 并出声（三种非法各测一次）', () => {
  const m = require(LIB)
  assert.strictEqual(m.capOf({}).max, 3, '无 env 时默认必须是 3')
  assert.strictEqual(m.capOf({ MP_QM6_MAX_ROUNDS: '5' }).max, 5, 'env 覆盖必须生效')
  const warns = []
  for (const bad of ['abc', '0', '-2', '3.5', '']) {
    const r = m.capOf({ MP_QM6_MAX_ROUNDS: bad }, (msg) => warns.push(msg))
    assert.strictEqual(r.max, 3, `非法值 ${JSON.stringify(bad)} 必须回落 3，实得 ${r.max}`)
    assert.strictEqual(r.fellBack, true, `非法值 ${JSON.stringify(bad)} 必须标出"回落发生过"`)
  }
  assert.strictEqual(warns.length, 5, `每一次回落都必须出声一次，实得 ${warns.length} 次`)
  assert.match(warns[0], /非法|不可用/, '告警要说清是"值不可用"，不得只写"回落"')
})

test('R2 计数键是 (change, headSha)：同 sha 重跑不计数、不同 sha 各计一轮', () => {
  const m = require(LIB)
  const { file } = tmpLedger()
  const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

  assert.deepStrictEqual(m.inspect({ ledgerPath: file, change: 'c1', headSha: A }),
    { seen: false, sameDelivery: false, round: 0 },
    '空账本必须读成"没见过、第 0 轮"，不得读成第 1 轮；形状用整对象断言——多一个字段就该红一次，别换成子集断言糊过去')

  m.record({ ledgerPath: file, change: 'c1', headSha: A })
  const after = m.inspect({ ledgerPath: file, change: 'c1', headSha: A })
  assert.deepStrictEqual(after, { seen: true, sameDelivery: false, round: 1 },
    '记一次之后同 sha 再查：seen 是真（给读数用），轮次仍是 1。\n' +
    '    sameDelivery 这里必须是 false —— 这次查询**没带 --delivery**，按 check 侧口径就是' +
    '"无复用证据"（宁可拦）；两侧都用 unmeasured 哨兵的话，digest 一坏上限就静默不触发')

  m.record({ ledgerPath: file, change: 'c1', headSha: A })
  assert.strictEqual(m.inspect({ ledgerPath: file, change: 'c1', headSha: A }).round, 1,
    '同一 sha 重复登记（填完裁决再跑那种）不得把轮次推高')

  m.record({ ledgerPath: file, change: 'c1', headSha: B })
  assert.strictEqual(m.inspect({ ledgerPath: file, change: 'c1', headSha: B }).round, 2,
    '换了载荷（新 commit）必须算新的一轮——计数挂在 sha 上，不是挂在 change 上')

  assert.strictEqual(m.inspect({ ledgerPath: file, change: 'other', headSha: A }).round, 0,
    '另一个 change 的轮次不得串台（键必须含 change）')
})

test('R3 记录名换了也算同一轮：计数不受内容寻址名影响（§0.1 前提的现场锁）', () => {
  const m = require(LIB)
  const { file } = tmpLedger()
  const sha = 'cccccccccccccccccccccccccccccccccccccccc'
  m.record({ ledgerPath: file, change: 'c2', headSha: sha, recordName: 'f'.repeat(64) })
  const again = m.inspect({ ledgerPath: file, change: 'c2', headSha: sha, recordName: 'd'.repeat(64) })
  assert.strictEqual(again.seen, true,
    '判定记录名（内容寻址）变了但 HEAD 没变 ⇒ 仍算同一轮。若实现拿 recordName 当键，这一条必红')
  assert.strictEqual(again.round, 1)
})

test('R4 超限判定只看不写：exceedsCap 不改账本，也不新增条目', () => {
  const m = require(LIB)
  const { file } = tmpLedger()
  for (let i = 0; i < 3; i++) {
    m.record({ ledgerPath: file, change: 'c3', headSha: `s${i}`.padEnd(40, '0') })
  }
  const before = fs.readFileSync(file, 'utf8')
  const r = m.exceedsCap({ ledgerPath: file, change: 'c3', headSha: 'new-sha', max: 3 })
  assert.strictEqual(r.exceeded, true, '已记 3 轮 ⇒ 新载荷应判超限')
  assert.strictEqual(r.round, 3)
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before,
    '判超限这一步绝不能顺手写账本——写了就变成"拒绝调用还消耗配额"')
  // 跑满之后的放行理由是「这条交付已在账里」（零模型复跑），不是「这个 sha 记过」——
  // 后者等于给同一 sha 上的无限次真调用发免费通行证（QM-6 第二轮 i4 中的就是这一格）。
  const paid = JSON.parse(fs.readFileSync(file, 'utf8')).changes.c3.rounds[0]
  const ok = m.exceedsCap({
    ledgerPath: file, change: 'c3', headSha: paid.headSha, delivery: paid.delivery, max: 3
  })
  assert.strictEqual(ok.exceeded, false, '已入账的那条交付重跑不受上限约束（它不消耗配额）')
  const newDelivery = m.exceedsCap({
    ledgerPath: file, change: 'c3', headSha: paid.headSha, delivery: 'fp-brand-new', max: 3
  })
  assert.strictEqual(newDelivery.exceeded, true,
    '同一 sha 但新交付时不得放行 —— 放行理由一旦退回按 sha 判，这一条必红')
  const otherSha = m.exceedsCap({ ledgerPath: file, change: 'c3', headSha: 'f'.repeat(40), max: 3 })
  assert.strictEqual(otherSha.exceeded, true, '换了载荷本来就是一轮新的，跑满即拦')
})

test('R5 账本写盘是原子且幂等的：不留 .tmp、重复登记同 sha 不膨胀', () => {
  const m = require(LIB)
  const { file } = tmpLedger()
  const sha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  for (let i = 0; i < 5; i++) m.record({ ledgerPath: file, change: 'c4', headSha: sha })
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.strictEqual(data.changes.c4.rounds.length, 1, '同 sha 五次登记必须只剩一条')
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp')), [],
    '原子写不得留下 .tmp 残件')
})

test('R7 CLI：check 只读且不改账、record 幂等；没有 change 目录时不创建、不计数', () => {
  const { spawnSync } = require('node:child_process')
  const m = require(LIB)
  const { dir, file } = tmpLedger()
  const sha = 'ffffffffffffffffffffffffffffffffffffffff'
  const run = (mode, extra) => spawnSync(process.execPath,
    [LIB, mode, 'cli-change', sha].concat(extra || ['--ledger', file]),
    { cwd: dir, encoding: 'utf8' })
  const noDir = spawnSync(process.execPath, [LIB, 'check', 'cli-change', sha], { cwd: dir, encoding: 'utf8' })
  assert.strictEqual(noDir.status, 0, '没有 change 目录时不得抛栈：' + noDir.stderr)
  assert.match(noDir.stdout, /nochange=1/, '必须点名"没账本可记"')
  assert.strictEqual(fs.existsSync(path.join(dir, 'openspec')), false,
    '入口绝不能为了一个计数器凭空造 openspec/ 目录 —— 那会把"这分支没规格"伪装成"有"')

  fs.mkdirSync(path.dirname(file), { recursive: true })
  const c0 = run('check')
  assert.match(c0.stdout, /round=0.*exceeded=0/, 'check 读数：' + c0.stdout)
  assert.strictEqual(fs.existsSync(file), false, 'check 是只读的，不得顺手建账本')
  assert.match(run('record').stdout, /counted=1 round=1/, 'record 第一次必须 counted=1')
  assert.match(run('record').stdout, /counted=0 round=1/, '同 sha 再 record 必须 counted=0')
  assert.match(run('check').stdout, /round=1.*seen=1/, 'check 与 record 必须读同一份账')
  assert.strictEqual(run('bogus').status, 2, '未知子命令必须非零（静默 0 会让"CLI 用坏了"读成"零轮"）')
  assert.strictEqual(run('check', []).status, 0)
  assert.ok(typeof m.mainCli === 'function' && typeof m.defaultLedger === 'function', 'CLI 必须可导出测试')
})

test('R6 账本坏了读不出时按未证实处理：既不得当成"零轮"放行，也必须按超限升级', () => {
  const m = require(LIB)
  const { file } = tmpLedger()
  fs.writeFileSync(file, '{ this is not json', 'utf8')
  const r = m.inspect({ ledgerPath: file, change: 'c5', headSha: 'x' })
  assert.strictEqual(r.round, 0)
  assert.strictEqual(r.unreadable, true,
    'JSON 读不出必须标出来。把"账本坏了"读成"从没跑过"，上限就成一个永久不触发的装饰')
  const e = m.exceedsCap({ ledgerPath: file, change: 'c5', headSha: 'y', max: 3 })
  assert.strictEqual(e.unreadable, true)
  // 取向在 2026-10-23 第二轮评审 i3 后被**反转**，反转理由留在库注释里，不留在这里当第二份事实：
  // "读不出 ⇒ 不拦"等于把闸的开关交给任何一次 `echo garbage > 账本`，那是装饰性门禁。
  assert.strictEqual(e.exceeded, true,
    '读不出 = 无法证明还有预算 = 按超限处理。旧断言（exceeded=false）守的是"别挡干活"，' +
    '但它把最廉价的绕行留在高危面上，已被外部评审独立命中并推翻')
  // 与 nochange 分档：连目录都没有是合法状态（这分支没规格），不得升级
  const nc = m.exceedsCap({ ledgerPath: path.join(path.dirname(file), 'nope', 'x.json'), change: 'c5', headSha: 'y', max: 3 })
  assert.strictEqual(nc.unreadable, undefined, '文件不存在 = ENOENT，不是"读不出"')
  assert.strictEqual(nc.exceeded, false, '没有账本可查时不得凭空判超限（那会把没有规格的分支一律拦死）')
})

/* ---------------- 评审 i1 / i2 之后补的三把锁（R8–R10）----------------
   不是"顺手加"：R8/R10 来自 i1（change 名未消毒就拼进路径），R9 来自 i2 里**可复现的那一半**
   （账本读不出时照样追加 ⇒ 把读不动的历史覆盖成只剩那一条）。
   i2 的另一半（并发丢更新）本机 4 进程探针**没复现**（终态 4 条齐全），所以这里不给它写断言，
   残留如实登记在 tasks §1.8 —— 没复现的竞态可以留账，不可以编成已防。 */

test('R8 change 形态判据：只拒 `..` 段与绝对路径；含斜杠的合法分支名必须放行', () => {
  const m = require(LIB)
  assert.strictEqual(typeof m.assertChangeName, 'function', '必须导出 assertChangeName（否则 R8 只能靠 defaultLedger 间接测）')
  for (const ok of ['qm6-rebuttal-round-cap', 'team/feature', 'fix/a-b', 'main']) {
    assert.strictEqual(m.assertChangeName(ok), ok, '合法分支名不得被拒：' + ok)
    assert.ok(m.defaultLedger(ok).includes(path.join('openspec', 'changes')),
      '账本必须仍落在 openspec/changes/ 前缀下：' + ok)
  }
  // 拒的是"能把固定前缀走穿的那一类"，不是"看着不顺眼的那一类"：
  // 收紧成 kebab-only 会直接拒掉 team/feature 这种合法分支，代价由下一个用户承担（本仓禁令同型）。
  for (const bad of ['../../etc', 'a/../../b', '..', '../../../etc/passwd', '/abs/path', 'C:\\Windows']) {
    assert.throws(() => m.assertChangeName(bad), /change/, '应拒：' + JSON.stringify(bad))
  }
  for (const empty of ['', null, undefined]) {
    assert.throws(() => m.assertChangeName(empty), /change/,
      '空值会让账本落到 openspec/changes//，两个不同分支共用同一份计数：' + String(empty))
  }
  // 现场自证 i1 的可达性前提：git 本来就拒绝含 .. 的分支名。
  // 这句前提一旦变了（换 git 版本 / 入口改成参数传 change），下面这条会当场把"结论要重估"喊出来，
  // 而不是留下一个看起来只是"防御性校验"的锁让人以为它守的是同一个东西。
  const { spawnSync } = require('node:child_process')
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `mp-rounds-bn-${process.pid}-`))
  const g = (a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' })
  try {
    g(['init', '-q']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't'])
    fs.writeFileSync(path.join(repo, 'seed.txt'), 'x\n')
    g(['add', '-A']); g(['commit', '-q', '-m', 'seed'])
    for (const weird of ['../../etc/evil', 'a/../../b', '..\\..\\etc\\evil']) {
      assert.notStrictEqual(g(['branch', '-f', weird, 'HEAD']).status, 0,
        `前提变了：git 竟允许分支名 ${JSON.stringify(weird)} ⇒ i1 的可达性结论要重估`)
    }
    assert.strictEqual(g(['branch', '-f', 'team/feature', 'HEAD']).status, 0,
      '对照：合法含斜杠分支名必须能落地（否则上面那批拒绝就是判据自造的）')
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('R9 账本读不出时 record 拒绝追加，且那份坏文件必须逐字留着（i2 可复现那一半）', () => {
  const m = require(LIB)
  const { file } = tmpLedger()
  const two = { version: 1, changes: { c9: { rounds: [
    { headSha: 'a'.repeat(40), recordName: null, at: '2026-01-01T00:00:00.000Z' },
    { headSha: 'b'.repeat(40), recordName: null, at: '2026-01-01T00:00:00.000Z' }
  ] } } }
  fs.writeFileSync(file, JSON.stringify(two) + '\n', 'utf8')
  assert.strictEqual(m.inspect({ ledgerPath: file, change: 'c9', headSha: 'z' }).round, 2,
    '前提自证：好账本里确实读得出 2 轮 —— 否则"历史被毁"这条断言测的是个空壳')
  const broken = '{ broken'
  fs.writeFileSync(file, broken, 'utf8')
  assert.throws(() => m.record({ ledgerPath: file, change: 'c9', headSha: 'c'.repeat(40) }),
    /读不出|拒绝/, '坏 JSON 之上必须拒绝追加。"顺手重建一份干净账本"就是把证据销毁')
  assert.strictEqual(fs.readFileSync(file, 'utf8'), broken,
    '拒写时文件必须逐字保留：原 HEAD 版实测把 2 轮压成 1 轮（旧两条不在），那才是这条锁存在的理由')
  assert.strictEqual(m.inspect({ ledgerPath: file, change: 'c9', headSha: 'z' }).unreadable, true,
    '拒写之后仍要能被读成 unreadable，不得变成"零轮"')
})

test('R11 CLI 输出形状合同：三条出口都必须按固定顺序给出五个纯数字键（入口的 parse 判据全靠它）', () => {
  const { spawnSync } = require('node:child_process')
  const { dir, file } = tmpLedger()
  // 入口那段 shell 是按 `tr " " "\n" | sed s/^key=//p` 取值的，取不到就是空串。
  // 所以"少一个键"或"值不是数字"在生产里的表现不是报错，而是**上限静默不触发** ——
  // 这条锁就是那条 parse 判据的对偶：它不测判据逻辑，它测判据赖以成立的前提。
  const SHAPE = /^round=\d+ max=\d+ exceeded=\d+ unreadable=\d+ seen=\d+/
  const run = (mode, extra) => spawnSync(process.execPath,
    [LIB, mode, 'shape-change', 'a'.repeat(40)].concat(extra || []), { cwd: dir, encoding: 'utf8' })

  const noDir = run('check')
  assert.strictEqual(noDir.status, 0, noDir.stderr)
  assert.match(noDir.stdout, SHAPE, '没有 change 目录那一档也要给全五个键：' + noDir.stdout)
  assert.match(noDir.stdout, /nochange=1/)

  fs.mkdirSync(path.dirname(file), { recursive: true })
  const empty = run('check', ['--ledger', file])
  assert.match(empty.stdout, SHAPE, '账本还不存在（ENOENT ≠ 读不出）：' + empty.stdout)
  assert.strictEqual(empty.stdout.match(/exceeded=0/) !== null, true, '首轮不得凭空判超限')

  fs.writeFileSync(file, '{ broken', 'utf8')
  const bad = run('check', ['--ledger', file])
  assert.match(bad.stdout, SHAPE, '坏账本那一档同样要给全键（否则入口 parse 判据会把"读不出"读成"没超限"）：' + bad.stdout)
  // 键序不是合同的一部分（入口按键名取值，与顺序无关），所以两条分开断言，
  // 不得写成 /unreadable=1 exceeded=1/ 这种把顺序焊进判据的断言——第一版就这么红过一次。
  assert.match(bad.stdout, /unreadable=1/, '必须报"读不出"')
  assert.match(bad.stdout, /exceeded=1/, '读不出必须同时报 exceeded=1 —— 无证据不等于还有预算')

  fs.writeFileSync(file, JSON.stringify({ version: 1, changes: { 'shape-change': { rounds:
    ['1', '2', '3'].map((n) => ({ headSha: n.padEnd(40, '0'), recordName: null, at: '2026-01-01T00:00:00.000Z' })) } } }) + '\n', 'utf8')
  const full = run('check', ['--ledger', file])
  assert.match(full.stdout, SHAPE, '跑满那一档：' + full.stdout)
  assert.match(full.stdout, /round=3 max=3 exceeded=1/)

  const badName = run('check', ['--ledger', file])
  void badName // 非法 change 那一档的形状由 R10 负责，这里不重复钉，免得两把锁各写一份期望
})

test('R10 CLI 用坏了必须成档：非法 change ⇒ rc=2 + badchange=1；record 拒落账 ⇒ rc=2 + counted=0 error=1', () => {
  const { spawnSync } = require('node:child_process')
  const m = require(LIB)
  const { dir, file } = tmpLedger()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const run = (mode, change, ledger) => spawnSync(process.execPath,
    [LIB, mode, change, 'f'.repeat(40), '--ledger', ledger || file], { cwd: dir, encoding: 'utf8' })

  const bad = run('check', '../../etc')
  assert.strictEqual(bad.status, 2, '非法 change 不得返回 0（"参数被拒"与"零轮"必须可区分）：' + bad.stdout)
  assert.match(bad.stdout, /badchange=1/, '必须点名是 change 被拒，不得只报一句通用错误')
  assert.match(bad.stdout, /unreadable=1/, '入口那侧要按未证实处理，不得读成"零轮继续跑"')
  assert.ok(!/\n\s+at .*ccg-review-rounds\.js/.test(String(bad.stderr)),
    '异常栈不得成为唯一读数：' + String(bad.stderr).slice(0, 200))

  // 显式 --ledger 时 change 只是文档里的一个键 ⇒ 怪键会静默读到一个不存在的桶（上限永不触发）。
  // 这一档是 R10 第一版漏掉的：它只测了 defaultLedger 那条分支，实际判据必须与路径来源无关。
  fs.writeFileSync(file, JSON.stringify({ version: 1, changes: { c10: { rounds: ['1', '2', '3'] } } }) + '\n', 'utf8')
  const keyed = run('check', '../etc')
  assert.strictEqual(keyed.status, 2, '带 --ledger 时同样必须拒非法 change：' + keyed.stdout)

  fs.writeFileSync(file, '{ broken', 'utf8')
  const rec = run('record', 'c10')
  assert.strictEqual(rec.status, 2, '在坏账本上 record 必须非零：' + rec.stdout + rec.stderr)
  assert.match(rec.stdout, /counted=0 error=1 msg=/, '拒落账必须自己成档（rc=2 + key=value），不得冒栈')
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ broken', 'CLI 档同样不得改写坏文件')
  assert.strictEqual(typeof m.assertChangeName, 'function')
})


test('R12 去重键是 (headSha, 交付指纹)：同 sha 的新交付必须再计一轮（i4 松口的闭合锁）', () => {
  const m = require(LIB)
  const { file } = tmpLedger()
  const sha = '9'.repeat(40)

  assert.strictEqual(m.record({ ledgerPath: file, change: 'c12', headSha: sha, delivery: 'fp-aaa' }).counted, true,
    '首记必计')
  const reuse = m.record({ ledgerPath: file, change: 'c12', headSha: sha, delivery: 'fp-aaa' })
  assert.strictEqual(reuse.counted, false, '同 sha 同交付 ⇒ 零模型复跑（填完裁决再覆盖那一轮），不该计数')
  assert.strictEqual(reuse.round, 1, '轮次不得被复跑推高')

  // 这一格是 i4 的全部内容：同一个 sha 上又真跑出一批**新** findings（额度又花了一遍）
  const fresh = m.record({ ledgerPath: file, change: 'c12', headSha: sha, delivery: 'fp-bbb' })
  assert.strictEqual(fresh.counted, true,
    '同一 sha 的新交付必须计新的一轮 —— 只按 sha 去重的旧实现在这条上必红（变异 M-n 实跑确认）')
  assert.strictEqual(fresh.round, 2, '轮次要跟着涨，否则上限对"同载荷反复真调"就是装饰')

  // 取不到交付指纹：record 侧按 unmeasured 记**新**一轮（宁可多计，不可把花掉的额度记成免费）
  const noFp = m.record({ ledgerPath: file, change: 'c12', headSha: sha })
  assert.strictEqual(noFp.counted, true,
    'digest 工具坏掉时不得静默省掉一轮 —— 那是把"看不见"读成"没花钱"')

  // 但 check 侧的取向相反：没带 --delivery 就是"无复用证据"，不得凭同哨兵放行
  const cap = m.exceedsCap({ ledgerPath: file, change: 'c12', headSha: sha, max: 4 })
  assert.strictEqual(cap.sameDelivery, false,
    'check 不带指纹时 sameDelivery 必须是 false；两侧共用 unmeasured 会让 digest 一坏上限就永不触发')

  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepStrictEqual(data.changes.c12.rounds.map((r) => r.delivery),
    ['fp-aaa', 'fp-bbb', 'unmeasured'],
    '账本里必须看得见每一轮的交付身份，否则事后无从复核"这一轮到底花没花额度"')
})

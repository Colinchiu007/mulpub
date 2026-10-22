'use strict'
/*
 * cleanup-artifacts.js 的行为锁（node --test，只用内置模块，零真实出站）
 *
 * 判据一律注入假 api/del —— 本仓没有 nock/msw，任何"测试不出网"都靠逐文件注入；
 * 真仓读数由 CLI 手工/定时那一跑留下（见 workflow 里的 --dry-run/--write 与首行 ARTIFACT-CLEAN）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parseArgs, cutoffOf, runCleanup } = require('./cleanup-artifacts.js')

const NOW = new Date('2026-10-21T12:00:00Z')
const OPT = { days: 5, retries: 3, perPage: 3, write: false, repo: 'o/r' }
const art = (id, createdAt, expired = false) => ({ id, created_at: createdAt, expired })

// 每页返回给定数组；耗尽后返回空页。calls 记录被请求到第几页。
// ⛔ 取页码必须用 `[?&]page=`：裸 `/page=(\d+)/` 会先匹配到同一个 URL 里的 `per_page=3`
//    （本仓第一版夹具就栽在这儿：它把每一页都读成第 3 页 ⇒ 全体"空页" ⇒ A1/A2/A4… 一片红，
//    看着像实现错了，实际是探针坐标取错）。
function fakeApi (pages, failPages = {}) {
  return (argv) => {
    const m = /[?&]page=(\d+)/.exec(argv[argv.length - 1])
    const p = Number(m[1])
    const f = failPages[p]
    if (f) {
      f.calls = (f.calls || 0) + 1
      if (f.calls <= (f.times || 99)) return { ok: false, status: 1, stderr: 'unexpected end of JSON input' }
    }
    return { ok: true, body: { artifacts: pages[p] || [] } }
  }
}
function recDel () {
  const calls = []
  return { del: (argv) => { calls.push(argv); return { ok: true } }, calls }
}

test('A1 分页正常收口：末页不满 perPage 即停，过期/未过期分别计数', () => {
  const pages = {
    1: [art(1, '2026-10-10T00:00:00Z'), art(2, '2026-10-21T00:00:00Z'), art(3, '2026-10-01T00:00:00Z', true)],
    2: [art(4, '2026-09-01T00:00:00Z')],
  }
  const r = runCleanup({ now: NOW, opt: OPT, api: fakeApi(pages), del: recDel().del })
  assert.equal(r.verdict, 'OK')
  assert.equal(r.pages, 2)
  assert.deepEqual(r.candidates, 2, '只该选中「早于 cutoff 且未 expired」的两条（1 与 4）；expired 那条不算')
})

test('A2 cutoff 边界：正好 5 天前不删、超一分钟才删', () => {
  const cut = cutoffOf(NOW, 5)
  const pages = { 1: [art(1, cut), art(2, '2026-10-16T00:00:01Z'), art(3, '2026-10-15T23:59:59Z')] }
  const r = runCleanup({ now: NOW, opt: OPT, api: fakeApi(pages), del: recDel().del })
  assert.equal(cut, '2026-10-16T12:00:00Z')
  assert.deepEqual(r.candidates, 2, 'cutoff 当刻与更早 1 秒都不得入选（ISO 串同格式才可直接比）')
})

test('A3 某页先 500 后成功：重试吃掉间歇故障，degraded 必须为 0', () => {
  const pages = { 1: [art(1, '2026-01-01T00:00:00Z')], 2: [] }
  const api = fakeApi(pages, { 1: { times: 2 } })
  const r = runCleanup({ now: NOW, opt: OPT, api, del: recDel().del })
  assert.equal(r.verdict, 'OK')
  assert.equal(r.degraded, 0)
})

test('A4 首页彻底失败 ⇒ UNPROVEN：一条都不删、非零结论，不得读成「没有待删条目」', () => {
  const r = runCleanup({ now: NOW, opt: OPT, api: fakeApi({}, { 1: { times: 99 } }), del: recDel().del })
  assert.equal(r.verdict, 'UNPROVEN')
  assert.equal(r.candidates, 0)
  assert.equal(r.pages, 0)
})

test('A5 中途页彻底失败 ⇒ DEGRADED：已列举的部分照常处理，但结论不得是 OK', () => {
  const pages = { 1: [art(1, '2026-01-01T00:00:00Z'), art(2, '2026-01-02T00:00:00Z'), art(3, '2026-01-03T00:00:00Z')] }
  const r = runCleanup({ now: NOW, opt: { ...OPT, perPage: 3 }, api: fakeApi(pages, { 2: { times: 99 } }), del: recDel().del })
  assert.equal(r.verdict, 'DEGRADED')
  assert.equal(r.degraded, 1)
  assert.equal(r.candidates, 3, '第 1 页已列举成功，那 3 条必须进候选（半途而废不能把已完成的部分也抹掉）')
})

test('A6 空仓（第一页就空）⇒ OK 且 candidates=0，这是合法终态不是故障', () => {
  const r = runCleanup({ now: NOW, opt: OPT, api: fakeApi({}), del: recDel().del })
  assert.equal(r.verdict, 'OK')
  assert.equal(r.candidates, 0)
})

test('A7 默认 dry-run：一条删除都不发', () => {
  const { del, calls } = recDel()
  const pages = { 1: [art(1, '2026-01-01T00:00:00Z')] }
  const r = runCleanup({ now: NOW, opt: { ...OPT, write: false }, api: fakeApi(pages), del })
  assert.equal(r.candidates, 1)
  assert.equal(r.deleted, 0)
  assert.equal(calls.length, 0)
})

test('A8 --write 才删；逐条计数进 deleted', () => {
  const { del, calls } = recDel()
  const pages = { 1: [art(1, '2026-01-01T00:00:00Z'), art(2, '2026-01-02T00:00:00Z')] }
  const r = runCleanup({ now: NOW, opt: { ...OPT, write: true }, api: fakeApi(pages), del })
  assert.equal(r.deleted, 2)
  assert.equal(calls.length, 2)
})

test('A9 DELETE 必须带 --silent：204 空体会被 gh 当 JSON 解析（与列表 500 同形）', () => {
  const { del, calls } = recDel()
  runCleanup({ now: NOW, opt: { ...OPT, write: true }, api: fakeApi({ 1: [art(7, '2026-01-01T00:00:00Z')] }), del })
  assert.ok(calls[0].includes('--silent'), JSON.stringify(calls[0]))
  assert.ok(calls[0].includes('DELETE'))
})

test('A10 删除中途失败 ⇒ DELETE_FAILED，并报出已删条数与失败那条 id（不假装全成功）', () => {
  const del = (argv) => ({ ok: !argv[argv.length - 1].endsWith('/2') })
  const pages = { 1: [art(1, '2026-01-01T00:00:00Z'), art(2, '2026-01-02T00:00:00Z')] }
  const r = runCleanup({ now: NOW, opt: { ...OPT, write: true }, api: fakeApi(pages), del })
  assert.equal(r.verdict, 'DELETE_FAILED')
  assert.equal(r.deleted, 1)
  assert.equal(r.failedId, 2)
})

test('A11 参数面：未知旗标 / 非法 days / 无仓库坐标一律抛错，不得静默按默认跑', () => {
  assert.throws(() => parseArgs(['--wrtie'], {}), /ART_CLEAN_ARGS/)
  assert.throws(() => parseArgs(['--days=0'], { GITHUB_REPOSITORY: 'o/r' }), /ART_CLEAN_ARGS/)
  assert.throws(() => parseArgs([], {}), /ART_CLEAN_ARGS/)
  assert.equal(parseArgs(['--write', '--days=7', '--repo=a/b'], {}).write, true)
})

test('A12 接线锁：定时作业真调本脚本，而行为锁被 PR 侧作业点名（否则等于没写）', () => {
  const strip = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  const wf = strip(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'cleanup-artifacts.yml'), 'utf8'))
  assert.match(wf, /node scripts\/cleanup-artifacts\.js --write --days=\d+/, '定时作业必须显式 --write（真删东西），只 --dry-run 等于什么都没清')
  assert.match(wf, /actions\/checkout/, '要跑仓内脚本就必须先检出：没有 checkout 时 node 找不到 scripts/ 会静默非零')
  // 仓库坐标必须写在调用点上。只在 env 里声明一个脚本不读的键（曾写 `REPO:`，而脚本读
  // GITHUB_REPOSITORY）今天靠 runner 自带变量恰好兜住，读起来却像"坐标已接线"——
  // 那是"判据对、传参错位"，只测脚本本体的锁永远看不见（QM-6 i4）。
  assert.match(wf, /--repo=\$\{\{ github\.repository \}\}/, '仓库坐标必须由定时作业显式给出')
  assert.ok(!/^\s*REPO\s*:/m.test(wf), 'env 里不得留脚本不消费的 REPO 键')
  const qg = strip(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml'), 'utf8'))
  assert.ok(qg.includes('node --test scripts/cleanup-artifacts.test.js'), '本测试文件不得只活在 schedule 作业里：schedule 不覆盖 PR，红也没人看')
})

test('A13 上游返回的 id 会进 DELETE 的路径段 ⇒ 非纯正整数一律不采纳，并计入 rejected', () => {
  const { del, calls } = recDel()
  const pages = {
    1: [
      art(1, '2026-01-01T00:00:00Z'),
      art('../9', '2026-01-02T00:00:00Z'),
      art(2.5, '2026-01-03T00:00:00Z'),
      art(0, '2026-01-04T00:00:00Z'),
      art(undefined, '2026-01-05T00:00:00Z'),
    ],
  }
  const r = runCleanup({ now: NOW, opt: { ...OPT, perPage: 5, write: true }, api: fakeApi(pages), del })
  assert.equal(r.candidates, 1, '只有那一条正整数 id 进候选')
  assert.equal(r.rejected, 4, '路径穿越 / 小数 / 0 / id 缺席四种坏形状都要计数')
  assert.equal(calls.length, 1, '坏形状不得发出删除请求')
  assert.match(calls[0][calls[0].length - 1], /\/artifacts\/\d+$/, `DELETE 路径段必须是纯数字：${calls[0][calls[0].length - 1]}`)
  assert.equal(r.verdict, 'REJECTED_PRESENT', '有条目被我拒了就不许判 OK——与"有页没列完"同档')
  // 正向对偶：全是合法形状时不得也报非 OK，否则这条判据退化成"恒红"的装饰
  const clean = runCleanup({ now: NOW, opt: { ...OPT, perPage: 5, write: true }, api: fakeApi({ 1: [art(11, '2026-01-01T00:00:00Z')] }), del: recDel().del })
  assert.equal(clean.rejected, 0)
  assert.equal(clean.verdict, 'OK')
})

test('A15 变异驱动必须真被 git 追踪（记录里写"驱动已入仓"，就得有东西在数这件事）', () => {
  const { spawnSync } = require('node:child_process')
  const rel = 'scripts/cleanup-artifacts.mutation.js'
  const env = { ...process.env }
  // GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE 会静默压过 cwd：钩子窗口里跑本锁时它们指向别的仓，
  // 于是这条锁量的根本不是本仓的追踪态（本仓实测踩过同款，见记忆 git-dir-overrides-cwd-in-test-spawns）。
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete env[k]
  const r = spawnSync('git', ['ls-files', '--', rel], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env })
  if (r.status !== 0) {
    throw new Error(`git ls-files 取不到读数（rc=${r.status}），按未证实处理、不得当作已追踪：${String(r.stderr || '').slice(0, 200)}`)
  }
  assert.equal((r.stdout || '').trim(), rel,
    `${rel} 不在索引里：.gitignore 的 scripts/*.js 会静默吞掉新建脚本，"驱动已入仓"就成了假话（QM-6 i6）`)
})

test('A14 首行读数必须带 rejected=（算了数却不出声，等于把坏形状静默吞掉）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'cleanup-artifacts.js'), 'utf8')
  const line = /ARTIFACT-CLEAN[^\n]*/.exec(src)
  assert.ok(line, '脚本必须打印 ARTIFACT-CLEAN 首行')
  assert.match(line[0], /rejected=\$\{r\.rejected\}/, 'rejected 必须进首行，与 pages/degraded 同排')
})

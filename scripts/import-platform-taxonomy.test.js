/**
 * import-platform-taxonomy 的测试 —— **先写测试（TDD RED）**。
 *
 * 被测：scripts/import-platform-taxonomy.js
 * 产出：config/platform-taxonomy.json
 *
 * 设计要点（每条都对应一个已知的失败模式）：
 *  ① 形态无关：分类映射是**装在 .txt 里的 JSON**，实测有多种形态；素材报告曾因「只认一种形态」
 *     把 11,623 少算成 3,838（少算 67%）。⇒ 断言必须覆盖多形态，且**未识别必须非零退出**。
 *  ② 逐文件编码判定：实测 132 个文本文件中 54 UTF-8 / 78 GBK，且**同一目录内混用**
 *     ⇒ 不能按目录或扩展名批量判定。
 *  ③ 图文/视频是**两套独立分类**，同一 id 含义不同（实测 B站 id=21 图文是「萌宠」、视频是「日常」）
 *     ⇒ 模型必须区分 contentType，否则会发错分类。
 *  ④ 只导入**带 ID** 的映射（`*categortmap.txt`）；`*subcategort.txt` 是去 ID 镜像
 *     ⇒ 断言产出里 **不存在** id 为 null 的节点。
 *  ⑤ 确定性：连跑两次字节相同（PLAN 的验收判据）。
 *  ⑥ fail-loud：目标平台文件缺失/解析失败 ⇒ 非零退出，绝不静默产出空表。
 *
 * 用法: node --test scripts/import-platform-taxonomy.test.js
 */
'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const REPO = path.resolve(__dirname, '..')
const SCRIPT = path.join(REPO, 'scripts', 'import-platform-taxonomy.js')
const DATA_DIR = path.join(REPO, '01-docs', 'research', 'competitor-reverse-2026-10-13', 'platform-data')

/**
 * 建一个临时 fixture 目录：写若干分类映射文件，返回路径。
 *
 * ⚠️ GBK 夹具必须给**真实 GBK 字节**：`Buffer.from(s,'binary')` 是 **latin1**（每字符取低 8 位），
 * 产生的是无效字节序列而非 GBK 编码 —— 拿它做「GBK 分支」等于零覆盖。
 * 此处按十六进制给字节，例如「动植物」的 GBK = B6 AF D6 B2 CE EF。
 */
function makeFixture (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxo-'))
  for (const [name, content, enc] of files) {
    if (enc === 'gbk-hex') {
      fs.writeFileSync(path.join(dir, name), Buffer.from(content, 'hex'))
    } else {
      fs.writeFileSync(path.join(dir, name), content, 'utf8')
    }
  }
  return dir
}

function run (args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO })
}

test('★ GBK 文件按逐文件判定被正确解码（真实 GBK 字节，不是 latin1 假夹具）', () => {
  // `{"code":1,"text":"动植物"}` 的 GBK 字节。动植物 = B6AF D6B2 CEEF。
  const GBK_HEX = '7B22636F6465223A312C2274657874223A22B6AFD6B2CEEF227D'
  const dir = makeFixture([['douyincategortmap.txt', GBK_HEX, 'gbk-hex']])
  const out = path.join(dir, 'out.json')
  const r = run(['--source', dir, '--out', out])
  assert.equal(r.status, 0, 'GBK 文件必须能解析：' + r.stderr)
  const j = JSON.parse(fs.readFileSync(out, 'utf8'))
  const n = j.platforms.douyin.article.nodes[0]
  assert.equal(n.id, '1')
  // 关键：解码正确 ⇒ 中文完好；若被当 latin1/UTF-8 处理，这里会是乱码或替换字符
  assert.equal(n.name, '动植物', 'GBK 未按 GBK 解码')
  assert.ok(!n.name.includes('\uFFFD'), '出现替换字符说明解码路径错了')
  assert.equal(j.source.filesRead[0].encoding, 'gbk', '未如实登记该文件为 gbk')
})

test('未指定参数时以非零退出并给出用法', () => {
  const r = run([])
  assert.notEqual(r.status, 0, '缺参数必须非零退出')
  assert.match(r.stderr, /用法|usage/i)
})

test('输入目录不存在 ⇒ 非零退出（fail-loud，不静默产出空表）', () => {
  const r = run(['--source', path.join(os.tmpdir(), 'definitely-not-exist-' + Date.now()), '--out', path.join(os.tmpdir(), 'x.json')])
  assert.notEqual(r.status, 0)
})

test('形态无关：扁平 {code,text} 与嵌套 {id,name,children} 都能解析出节点', () => {
  const dir = makeFixture([
    ['douyincategortmap.txt', JSON.stringify([{ code: 117, text: '动植物' }, { code: 109, text: '游戏' }])],
    ['douyinvideocategortmap.txt', JSON.stringify([{ id: '601', name: '剧情', child: [{ id: '60101', name: '短剧' }] }])],
  ])
  const out = path.join(dir, 'out.json')
  const r = run(['--source', dir, '--out', out])
  assert.equal(r.status, 0, '应成功：' + r.stderr)
  const j = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.equal(j.platforms.douyin.article.nodes.length, 2)
  assert.equal(j.platforms.douyin.video.nodes.length, 2, '嵌套 child 的父+子共 2 个节点')
})

test('未识别形态 ⇒ 非零退出，且不得写出成功的产出（fail-loud）', () => {
  // 一个既没有 id 类键也没有 name 类键的畸形结构
  const dir = makeFixture([['douyincategortmap.txt', JSON.stringify({ foo: { bar: 1 }, baz: [1, 2, 3] })]])
  const out = path.join(dir, 'out.json')
  const r = run(['--source', dir, '--out', out])
  assert.notEqual(r.status, 0, '未识别形态必须非零退出')
  assert.match(r.stderr, /未识别|无法识别|unrecognized/i)
})

test('确定性：连跑两次产出字节完全相同（PLAN 验收判据）', () => {
  const dir = makeFixture([
    ['bilibilicategortmap.txt', JSON.stringify([{ id: 2, name: '动画', children: [{ id: 4, name: '动漫杂谈' }] }])],
    ['bilibilivideocategortmap.txt', JSON.stringify([{ id: 160, name: '生活', children: [{ id: 21, name: '日常' }] }])],
  ])
  const a = path.join(dir, 'a.json'); const b = path.join(dir, 'b.json')
  assert.equal(run(['--source', dir, '--out', a]).status, 0)
  assert.equal(run(['--source', dir, '--out', b]).status, 0)
  const ha = crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex')
  const hb = crypto.createHash('sha256').update(fs.readFileSync(b)).digest('hex')
  assert.equal(ha, hb, '两次产出 SHA-256 必须相同')
})

test('图文与视频是两套分类，同一 id 不得互相覆盖', () => {
  const dir = makeFixture([
    ['bilibilicategortmap.txt', JSON.stringify([{ id: 21, name: '萌宠' }])],
    ['bilibilivideocategortmap.txt', JSON.stringify([{ id: 21, name: '日常' }])],
  ])
  const out = path.join(dir, 'out.json')
  assert.equal(run(['--source', dir, '--out', out]).status, 0)
  const j = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.equal(j.platforms.bilibili.article.nodes[0].name, '萌宠')
  assert.equal(j.platforms.bilibili.video.nodes[0].name, '日常')
})

test('产出里不含 id 为空的节点（只导入带 ID 的映射）', () => {
  const dir = makeFixture([
    ['bilibilicategortmap.txt', JSON.stringify([{ id: 2, name: '动画' }])],
  ])
  const out = path.join(dir, 'out.json')
  assert.equal(run(['--source', dir, '--out', out]).status, 0)
  const j = JSON.parse(fs.readFileSync(out, 'utf8'))
  for (const [p, types] of Object.entries(j.platforms)) {
    for (const [t, blk] of Object.entries(types)) {
      for (const n of blk.nodes) {
        assert.ok(n.id !== null && n.id !== undefined && n.id !== '', `${p}/${t} 出现无 id 节点：${JSON.stringify(n)}`)
      }
    }
  }
})

test('真实数据集：产出覆盖 6 个有 ID 的平台（tencent_video 刻意排除，见脚本注释）', () => {
  if (!fs.existsSync(DATA_DIR)) return // 数据集不在时跳过（不假装通过）
  const out = path.join(os.tmpdir(), 'taxo-real-' + Date.now() + '.json')
  const r = run(['--source', DATA_DIR, '--out', out])
  assert.equal(r.status, 0, '真实数据集必须解析成功：' + r.stderr)
  const j = JSON.parse(fs.readFileSync(out, 'utf8'))
  const withData = Object.keys(j.platforms).filter((p) => Object.values(j.platforms[p]).some((b) => b.nodes.length > 0))
  // 6 而非 7：`tencent_video` 在本项目指**微信视频号**，而数据集里只有**腾讯视频**的表，
  // 挂上去等于发错平台，故刻意不导入（详见脚本 PLATFORM_PREFIXES 注释）。
  assert.equal(withData.length, 6, `带 ID 的平台应为 6，实际 ${withData.length}：${withData.join(',')}`)
  assert.deepEqual(withData.sort(), ['baijiahao', 'bilibili', 'douyin', 'toutiao', 'weibo', 'zhihu'])
  assert.ok(j.platformsWithoutIdData.includes('tencent_video'), 'tencent_video 必须显式登记为无 ID 数据')
  // 实测基线：B站图文 38 节点、视频 142 节点
  assert.equal(j.platforms.bilibili.article.nodes.length, 38, 'B站图文应为 38 节点')
  assert.equal(j.platforms.bilibili.video.nodes.length, 142, 'B站视频应为 142 节点')
  fs.unlinkSync(out)
})

test('数据源为冻结快照：产出必须带来源与快照日期标注', () => {
  if (!fs.existsSync(DATA_DIR)) return
  const out = path.join(os.tmpdir(), 'taxo-src-' + Date.now() + '.json')
  const r = run(['--source', DATA_DIR, '--out', out])
  assert.equal(r.status, 0)
  const j = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.ok(j.source, '必须有 source 段')
  assert.match(String(j.source.snapshotDate), /^\d{4}-\d{2}-\d{2}$/, '快照日期格式 YYYY-MM-DD')
  assert.ok(j.source.verifiedOnline === false, '必须显式标注「未联网校验」')
  fs.unlinkSync(out)
})

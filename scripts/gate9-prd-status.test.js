'use strict'
/**
 * PRD 需求条目状态标注的回归锁（2026-10-12，Gate 9 第 3 层修复）。
 *
 * 背景：审计器把 PRD 里**所有**可解析条目都当成「应实现的需求」——包括规划中、
 * 不做、历史记录类。实测 01-docs/PRD.md 抽出 357 项，其中大量是未来规划，
 * 于是「覆盖率」被规划项稀释成存量欠账，任何 feat PR 都可能被误判。
 *
 * 修复：PRD 条目可带显式状态标注，parser 识别后交给审计器分层；
 * 状态不明（未标注）的条目按既有行为保留（不擅自改变语义）。
 */

const test = require('node:test')
const assert = require('node:assert/strict')

// 状态标注判据独立成纯函数模块，便于单测与复用
const { parseItemStatus, shouldAudit, STATUS_TAGS } = require('./gate9-prd-status.js')

test('显式标注：已实现 / 规划中 / 不做 / 历史 四类均被识别', () => {
  assert.equal(parseItemStatus('一键发布功能【已实现】').status, 'implemented')
  assert.equal(parseItemStatus('播客托管【规划中】').status, 'planned')
  assert.equal(parseItemStatus('深色模式【不做】').status, 'wont-do')
  assert.equal(parseItemStatus('旧版发布链路【历史】').status, 'historical')
})

test('未标注条目 → unknown（既有行为不变，不擅自排除）', () => {
  assert.equal(parseItemStatus('一键发布功能').status, 'unknown')
})

test('标注在条目任意位置都能识别（含句中）', () => {
  // 句中多标注时按 STATUS_ORDER 取先命中者（implemented 优先），
  // 避免「【已实现】…【规划中】」复合描述被误判为规划中
  assert.equal(parseItemStatus('支持小红书【已实现】与抖音【规划中】双端').status, 'implemented')
  // 无 implemented 时才落到 planned
  assert.equal(parseItemStatus('支持小红书与抖音【规划中】双端').status, 'planned')
})

test('英文同族标注也认（implemented / planned / wont-do / historical）', () => {
  assert.equal(parseItemStatus('Dark mode [implemented]').status, 'implemented')
  assert.equal(parseItemStatus('Dark mode [planned]').status, 'planned')
})

test('STATUS_TAGS 常量表与判据一致（改判据必改表，防两处漂移）', () => {
  assert.ok(STATUS_TAGS.implemented.length >= 2)
  assert.ok(STATUS_TAGS.planned.length >= 2)
  assert.ok(STATUS_TAGS['wont-do'].length >= 2)
  assert.ok(STATUS_TAGS.historical.length >= 2)
})

test('反证：若把 implemented 的标注从判据里删掉 → 立刻红', () => {
  // 这条锁的是「判据与常量表同源」：判据靠 STATUS_TAGS 驱动，
  // 删表内任一项都会让上面四类识别用例红
  const r = parseItemStatus('某功能【已实现】')
  assert.equal(r.status, 'implemented')
  assert.ok(r.tag, '必须回显命中的标注，便于排查')
})

test('审计范围判据：只有 implemented / unknown 进审计，其余分层', () => {
  const { shouldAudit } = require('./gate9-prd-status.js')
  assert.equal(shouldAudit('implemented'), true)
  assert.equal(shouldAudit('unknown'), true)
  assert.equal(shouldAudit('planned'), false)
  assert.equal(shouldAudit('wont-do'), false)
  assert.equal(shouldAudit('historical'), false)
})

// ---------------------------------------------------------------------------
// 2026-10-13（change: gate9-annot-bracket）：标注必须带方括号，裸词不算。
//
// 根因：原实现用 `text.includes(裸串)` 匹配，而 §二 的约定写的是**方括号标注**
// （【已实现】/ [implemented]）——实现与自身文档不符。实测真实 PRD 上 11 个被判
// 非 unknown 的条目至少 6 个是假阳性，把**真实且已实现**的需求当成「历史/不做」
// 静默移出审计面（审计面缩小 = 覆盖率虚高，正是本机制要防的失效形态）。
// ---------------------------------------------------------------------------

test('假阳性防线：裸词不构成标注（真实功能不得被静默移出审计面）', () => {
  const bare = [
    // 「历史」在这些条目里是**功能名**，不是「已废弃」
    '浏览历史记录',
    '历史版本管理',
    '操作历史查询',
    '订单/消费历史因暂无对应后端能力，不在本次范围内',
    '历史提示词翻译：界面语言非 en 时按场景生成翻译',
    // 「不做」是「不施加」的动词短语
    '不做长度限制',
    // 描述的是**已实现**的 fail-closed 设计，绝非「明确不做」
    '兜底仅覆盖 llm 类别：TTS/图片/视频等类别不做泛化兜底，未注册时 fail-closed',
    // 英文裸词同样不行
    'future-proof 配置',
    'undone 状态恢复',
    'Dark mode implemented',
    'legacy pending 仍可取消（迁移前数据的清理路径）',
    // 叙述历史事故，但要求本身是**当前**行为
    '历史上把 OPS_JWT_SECRET 注入成字面量，现已改为必填',
  ]
  for (const t of bare) {
    const r = parseItemStatus(t)
    assert.equal(r.status, 'unknown', `裸词不得构成标注，误判: ${t} -> ${r.status}`)
    assert.equal(r.tag, null, `裸词不得回显标注: ${t}`)
    assert.equal(
      shouldAudit(r.status),
      true,
      `误判为排除项会让审计面静默缩小（覆盖率虚高）: ${t}`
    )
  }
})

test('标注是独立方括号单元：【…】内必须与标注词完全相等', () => {
  // 括号内是标注、括号外是说明 —— 说明里再出现标注词不影响判定
  assert.equal(
    parseItemStatus('深色模式【不做】（桌面端定位为轻工具，暂不做主题切换）').status,
    'wont-do'
  )
  // 括号内做前后缀放宽会让「不做长度限制」这类**功能描述**被误排除，故要求完全相等
  assert.equal(parseItemStatus('导出【不做长度限制】').status, 'unknown')
  assert.equal(parseItemStatus('模式【已实现部分】').status, 'unknown')
  // 合规标注在句中同样生效
  assert.equal(parseItemStatus('支持小红书【已实现】与抖音【规划中】双端').status, 'implemented')
})

test('markdown 链接/图片语法不得被当成标注', () => {
  // [历史](url) 是链接标签，误判会让带链接的条目被静默排除
  assert.equal(parseItemStatus('见[历史](https://example.test/history) 页面').status, 'unknown')
  assert.equal(parseItemStatus('![planned](img.png) 图示').status, 'unknown')
  // 引用式链接 [text][ref]
  assert.equal(parseItemStatus('见[historical][ref-1]').status, 'unknown')
})

test('英文标注大小写不敏感，但同样必须带括号', () => {
  assert.equal(parseItemStatus('Dark mode [Implemented]').status, 'implemented')
  assert.equal(parseItemStatus('Dark mode [DONE]').status, 'implemented')
  assert.equal(parseItemStatus("Dark mode [won't do]").status, 'wont-do')
  assert.equal(parseItemStatus('Dark mode [legacy]').status, 'historical')
  // 无括号 → 不认
  assert.equal(parseItemStatus('Dark mode done').status, 'unknown')
})

test('真实 PRD 上不得出现裸词假阳性（事故现场回归）', () => {
  // 这条直接钉住 2026-10-13 实测的那批误判文本，任何放宽匹配的改动都会让它红
  const incidents = [
    ['兜底仅覆盖 llm 类别：TTS / 语音识别 / 图片 / 视频 / 多模态等类别不做泛化兜底', 'wont-do'],
    ['上传头像、修改昵称、订单/消费历史因暂无对应后端能力，不在本次范围内', 'historical'],
    ['**历史提示词翻译**：界面语言非 en（当前 zh）时，流水线在提示词优化后按场景生成翻译', 'historical'],
    ['**部署层**：systemd `Environment=` **不展开** `${}`，历史上把 `OPS_JWT_SECRET` 注入成仓库可复算的字面量', 'historical'],
    ['**legacy pending 仍可取消** —— 迁移前数据的清理路径', 'historical'],
  ]
  for (const [text, wrongStatus] of incidents) {
    const r = parseItemStatus(text)
    assert.notEqual(r.status, wrongStatus, `事故现场文本又被误判为 ${wrongStatus}: ${text.slice(0, 40)}`)
    assert.equal(r.status, 'unknown', text.slice(0, 40))
  }
})

// @ts-check
// @vitest-environment node
/**
 * prompt-memory.test.js — 记忆库 V0 单元测试（TDD）
 *
 * 规格：openspec/changes/prompt-engine-evolution-p1b-memory
 * 覆盖：learnt fragment 四类参数白名单 / mode 枚举 / dictVersion stale 重算与标 stale /
 *       fingerprint 缺失 fail-close / 版本优先级（碰撞拒绝/同源升版/新 id）/
 *       写盘原子性 / 损坏库 fail-close 重建 / listActive 仅 active
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createPromptMemory, FRAGMENT_ALLOWED_KEYS, TEMPLATE_STATES } = require('./prompt-memory')
const { DICT_VERSION } = require('./fingerprint')

/** 在 os.tmpdir() 下创建唯一隔离目录 */
function tmpRoot () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mp-prompt-memory-'))
}

function makeMemory (opts = {}) {
  const root = opts.root || tmpRoot()
  const memory = createPromptMemory({
    libraryRoot: path.join(root, 'prompt-library'),
    config: opts.config || {},
    statsProvider: opts.statsProvider || (() => null),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    now: opts.now,
  })
  memory.load()
  return { memory, root }
}

/** 构造一个合法的 learnt fragment 模板入参 */
function validFragment (overrides = {}) {
  return {
    engine: 'image',
    mode: 'storyboard',
    type: 'fragment',
    content: { compositionType: '前后对比', action: '放大', object: '书本', creativeLevel: 7 },
    concept: 'AI 改变教育',
    eventId: 'evt_' + 'a'.repeat(16),
    ...overrides,
  }
}

describe('prompt-memory: 数据模型与枚举', () => {
  it('FRAGMENT_ALLOWED_KEYS 仅四类可控参数', () => {
    expect(FRAGMENT_ALLOWED_KEYS).toEqual(['compositionType', 'action', 'object', 'creativeLevel'])
  })

  it('TEMPLATE_STATES 枚举完整', () => {
    expect(TEMPLATE_STATES).toEqual(['draft', 'active', 'deprecated', 'disabled'])
  })

  it('saveLearnt 合法 fragment 入 draft，返回 id/version/state', () => {
    const { memory, root } = makeMemory()
    const r = memory.saveLearnt(validFragment())
    expect(r.ok).toBe(true)
    expect(r.state).toBe('draft')
    expect(r.version).toBe(1)
    expect(r.id).toMatch(/^tpl_[0-9a-f]{16}$/)
    // 落盘校验：library.json + templates/<id>@1.json
    const libPath = path.join(root, 'prompt-library', 'library.json')
    expect(fs.existsSync(libPath)).toBe(true)
    const tplPath = path.join(root, 'prompt-library', 'templates', r.id + '@1.json')
    expect(fs.existsSync(tplPath)).toBe(true)
  })

  it('mode 非法枚举拒绝', () => {
    const { memory } = makeMemory()
    const r = memory.saveLearnt(validFragment({ mode: 'magic' }))
    expect(r.ok).toBe(false)
    expect(r.code).toBe('TEMPLATE_INVALID')
  })

  it('engine 非法枚举拒绝', () => {
    const { memory } = makeMemory()
    const r = memory.saveLearnt(validFragment({ engine: 'audio' }))
    expect(r.ok).toBe(false)
    expect(r.code).toBe('TEMPLATE_INVALID')
  })

  it('type 非法枚举拒绝', () => {
    const { memory } = makeMemory()
    const r = memory.saveLearnt(validFragment({ type: 'meme' }))
    expect(r.ok).toBe(false)
    expect(r.code).toBe('TEMPLATE_INVALID')
  })
})

describe('prompt-memory: learnt fragment 四类参数白名单', () => {
  it('含越界字段 color 拒绝入库', () => {
    const { memory, root } = makeMemory()
    const r = memory.saveLearnt(validFragment({ content: { compositionType: '前后对比', color: 'red' } }))
    expect(r.ok).toBe(false)
    expect(r.code).toBe('TEMPLATE_GATE_FAILED')
    // 不产生模板文件
    const tplDir = path.join(root, 'prompt-library', 'templates')
    expect(fs.existsSync(tplDir) ? fs.readdirSync(tplDir).length : 0).toBe(0)
  })

  it('含越界字段 keywords 拒绝', () => {
    const { memory } = makeMemory()
    const r = memory.saveLearnt(validFragment({ content: { compositionType: '前后对比', keywords: ['x'] } }))
    expect(r.ok).toBe(false)
    expect(r.code).toBe('TEMPLATE_GATE_FAILED')
  })

  it('含越界字段 metaphor 拒绝', () => {
    const { memory } = makeMemory()
    const r = memory.saveLearnt(validFragment({ content: { compositionType: '前后对比', metaphor: 'x' } }))
    expect(r.ok).toBe(false)
    expect(r.code).toBe('TEMPLATE_GATE_FAILED')
  })
})

describe('prompt-memory: dictVersion 变更重算与 stale', () => {
  it('指纹 dictVersion 与当前不一致时以 sourceText 重算', () => {
    const { memory } = makeMemory()
    const r = memory.saveLearnt(validFragment())
    expect(r.ok).toBe(true)
    // 篡改指纹 dictVersion 模拟旧版本
    const tpl = memory.get(r.id)
    tpl.fingerprint.dictVersion = '2020-01-01'
    memory._writeTemplate(tpl)
    // 重新加载触发重算
    memory.load()
    const reloaded = memory.get(r.id)
    expect(reloaded.fingerprint.dictVersion).toBe(DICT_VERSION)
    expect(reloaded.fingerprint.compositionIntents.length).toBeGreaterThan(0)
  })

  it('sourceText 缺失且 dictVersion 不一致时标 stale 不参与检索', () => {
    const { memory } = makeMemory()
    const r = memory.saveLearnt(validFragment())
    expect(r.ok).toBe(true)
    const tpl = memory.get(r.id)
    tpl.sourceText = ''
    tpl.fingerprint.dictVersion = '2020-01-01'
    memory._writeTemplate(tpl)
    memory.load()
    const reloaded = memory.get(r.id)
    expect(reloaded.stale).toBe(true)
    // listActive 不包含 stale 模板
    const active = memory.listActive({ engine: 'image' })
    expect(active.some((t) => t.id === r.id)).toBe(false)
  })
})

describe('prompt-memory: fingerprint 缺失 fail-close', () => {
  it('fingerprint 缺失的模板不参与检索且不影响其余模板', () => {
    const { memory } = makeMemory()
    const r1 = memory.saveLearnt(validFragment({ concept: 'AI 改变教育' }))
    const r2 = memory.saveLearnt(validFragment({
      concept: '医疗健康管理',
      eventId: 'evt_' + 'b'.repeat(16),
      content: { compositionType: '概念隐喻', action: '融合', object: '河流', creativeLevel: 6 },
    }))
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    // 破坏 r1 的 fingerprint
    const tpl = memory.get(r1.id)
    delete tpl.fingerprint
    memory._writeTemplate(tpl)
    memory.load()
    // 激活 r2 使其进入 active
    memory.activate(r2.id, { confirmedBy: 'user-hash' })
    // r1 不参与检索，r2 正常
    const active = memory.listActive({ engine: 'image' })
    expect(active.some((t) => t.id === r1.id)).toBe(false)
    expect(active.some((t) => t.id === r2.id)).toBe(true)
  })
})

describe('prompt-memory: 版本优先级（碰撞拒绝/同源升版/新 id）', () => {
  it('content checksum 完全碰撞拒绝', () => {
    const { memory } = makeMemory()
    const r1 = memory.saveLearnt(validFragment())
    expect(r1.ok).toBe(true)
    // 相同 content + 不同 eventId → 完全碰撞
    const r2 = memory.saveLearnt(validFragment({ eventId: 'evt_' + 'c'.repeat(16) }))
    expect(r2.ok).toBe(false)
    expect(r2.code).toBe('TEMPLATE_GATE_FAILED')
  })

  it('同 learnedFrom 且指纹相似 → 升版', () => {
    const { memory } = makeMemory()
    const r1 = memory.saveLearnt(validFragment({ eventId: 'evt_' + 'd'.repeat(16) }))
    expect(r1.ok).toBe(true)
    // 同 eventId + 相似 content（不同 action）→ 升版
    const r2 = memory.saveLearnt(validFragment({
      eventId: 'evt_' + 'd'.repeat(16),
      content: { compositionType: '前后对比', action: '缩小', object: '书本', creativeLevel: 7 },
    }))
    expect(r2.ok).toBe(true)
    expect(r2.id).toBe(r1.id)
    expect(r2.version).toBe(2)
  })

  it('不同 learnedFrom → 新 id', () => {
    const { memory } = makeMemory()
    const r1 = memory.saveLearnt(validFragment({ eventId: 'evt_' + 'e'.repeat(16) }))
    const r2 = memory.saveLearnt(validFragment({
      eventId: 'evt_' + 'f'.repeat(16),
      content: { compositionType: '流程展示', action: '旋转', object: '齿轮', creativeLevel: 5 },
    }))
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(r1.id).not.toBe(r2.id)
  })
})

describe('prompt-memory: 写盘原子性与损坏恢复', () => {
  it('写盘使用临时文件 + rename（无 .tmp 残留）', () => {
    const { memory, root } = makeMemory()
    const r = memory.saveLearnt(validFragment())
    expect(r.ok).toBe(true)
    const tplDir = path.join(root, 'prompt-library', 'templates')
    const files = fs.readdirSync(tplDir)
    expect(files).toEqual([r.id + '@1.json'])
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
  })

  it('损坏的 library.json fail-close 重建空库', () => {
    const root = tmpRoot()
    const libDir = path.join(root, 'prompt-library')
    fs.mkdirSync(libDir, { recursive: true })
    fs.writeFileSync(path.join(libDir, 'library.json'), '{ invalid json', 'utf8')
    const memory = createPromptMemory({
      libraryRoot: libDir,
      config: {},
      statsProvider: () => null,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    })
    expect(() => memory.load()).not.toThrow()
    // 重建后为空库
    expect(memory.list({})).toEqual([])
  })

  it('损坏的模板文件 fail-close 跳过且不影响其余', () => {
    const { memory, root } = makeMemory()
    const r1 = memory.saveLearnt(validFragment())
    const r2 = memory.saveLearnt(validFragment({
      concept: '医疗健康',
      eventId: 'evt_' + 'g'.repeat(16),
      content: { compositionType: '角色状态', action: '弹跳', object: '气球', creativeLevel: 8 },
    }))
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    // 破坏 r1 模板文件
    fs.writeFileSync(path.join(root, 'prompt-library', 'templates', r1.id + '@1.json'), '{ broken', 'utf8')
    memory.load()
    // r1 被跳过，r2 正常
    expect(memory.get(r1.id)).toBeNull()
    expect(memory.get(r2.id)).not.toBeNull()
  })
})

describe('prompt-memory: listActive 与状态流转', () => {
  it('listActive 仅返回 active 且 fingerprint 有效的模板', () => {
    const { memory } = makeMemory()
    const r1 = memory.saveLearnt(validFragment())
    expect(r1.ok).toBe(true)
    // 初始 draft，不在 active
    expect(memory.listActive({ engine: 'image' })).toEqual([])
    // activate 后进入 active
    memory.activate(r1.id, { confirmedBy: 'user-hash' })
    const active = memory.listActive({ engine: 'image' })
    expect(active.length).toBe(1)
    expect(active[0].id).toBe(r1.id)
    expect(active[0].fingerprint).toBeTruthy()
    // deprecate 后不在 active
    memory.deprecate(r1.id, { reason: 'test' })
    expect(memory.listActive({ engine: 'image' })).toEqual([])
  })

  it('listActive 按 engine 过滤', () => {
    const { memory } = makeMemory()
    const r1 = memory.saveLearnt(validFragment({ engine: 'image' }))
    const r2 = memory.saveLearnt(validFragment({
      engine: 'video',
      eventId: 'evt_' + 'h'.repeat(16),
      content: { compositionType: '地图路径', action: '追逐', object: '门', creativeLevel: 9 },
    }))
    memory.activate(r1.id, { confirmedBy: 'u' })
    memory.activate(r2.id, { confirmedBy: 'u' })
    expect(memory.listActive({ engine: 'image' }).map((t) => t.id)).toEqual([r1.id])
    expect(memory.listActive({ engine: 'video' }).map((t) => t.id)).toEqual([r2.id])
  })

  it('activate 不存在的模板返回 null', () => {
    const { memory } = makeMemory()
    expect(memory.activate('tpl_nonexistent', { confirmedBy: 'u' })).toBeNull()
  })

  it('非法状态流转被拒绝（active→draft 非法）', () => {
    const { memory } = makeMemory()
    const r1 = memory.saveLearnt(validFragment())
    memory.activate(r1.id, { confirmedBy: 'u' })
    // active→draft 非法
    expect(() => memory._setState(r1.id, 'draft')).toThrow()
  })

  it('concept 超 2000 字符截断', () => {
    const { memory } = makeMemory()
    const longConcept = 'x'.repeat(3000)
    const r = memory.saveLearnt(validFragment({ concept: longConcept }))
    expect(r.ok).toBe(true)
    const tpl = memory.get(r.id)
    expect(tpl.sourceText.length).toBe(2000)
  })
})

describe('prompt-memory: CCG 评审修复', () => {
  it('注入 gate 后门禁失败拒绝入库（fail-closed）', () => {
    const root = tmpRoot()
    const memory = createPromptMemory({
      libraryRoot: path.join(root, 'prompt-library'),
      config: {},
      statsProvider: () => null,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      gate: () => ({ pass: false, results: { structure: 'fail' } }),
    })
    memory.load()
    const r = memory.saveLearnt(validFragment())
    expect(r.ok).toBe(false)
    expect(r.code).toBe('TEMPLATE_GATE_FAILED')
  })

  it('注入 gate 且门禁通过后正常入库', () => {
    const root = tmpRoot()
    const memory = createPromptMemory({
      libraryRoot: path.join(root, 'prompt-library'),
      config: {},
      statsProvider: () => null,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      gate: () => ({ pass: true, results: {}, checksum: 'abc' }),
    })
    memory.load()
    const r = memory.saveLearnt(validFragment())
    expect(r.ok).toBe(true)
    expect(r.state).toBe('draft')
  })

  it('_setGate 可动态注入门禁（解决 governance↔memory 循环依赖）', () => {
    const { memory } = makeMemory()
    // 初始无 gate → 正常入库
    const r1 = memory.saveLearnt(validFragment())
    expect(r1.ok).toBe(true)
    // 注入拒绝门禁 → 后续入库被拒
    memory._setGate(() => ({ pass: false, results: {} }))
    const r2 = memory.saveLearnt(validFragment({ eventId: 'evt_' + 'z'.repeat(16), content: { compositionType: '概念隐喻', action: '融合', object: '河流', creativeLevel: 6 } }))
    expect(r2.ok).toBe(false)
    expect(r2.code).toBe('TEMPLATE_GATE_FAILED')
  })

  it('get 历史版本拒绝非法 version（防路径穿越）', () => {
    const { memory } = makeMemory()
    const r = memory.saveLearnt(validFragment())
    expect(r.ok).toBe(true)
    // 非法 version（路径穿越）→ 返回 null
    expect(memory.get(r.id, '../../etc/passwd')).toBeNull()
    expect(memory.get(r.id, '-1')).toBeNull()
    expect(memory.get(r.id, '0')).toBeNull()
    expect(memory.get(r.id, '1.5')).toBeNull()
    // 合法 version（当前版本）→ 正常返回
    expect(memory.get(r.id, 1)).not.toBeNull()
  })
})
'use strict'
/**
 * 刀 4 分块与入参形状层的行为锁。
 * 核心是**重构不变量**：切块之后按段拼回去必须逐字等于原段——这条必须是精确断言，
 * 不能只 toContain（AGENTS.md「文本结构断言」：子串匹配对"正文被压成一整行/标点被吃掉"完全免疫）。
 */
const {
  planChunks, validateComposeInput, cpLen, splitSentences,
  MAX_CHUNK_CODEPOINTS, TTS_COMPOSE_ERRORS,
} = require('./podcast-tts-compose')

const para = (n) => Array.from({ length: n }, (_, i) => `第${i}句 content。`).join('')
const longPara = (approxCp) => {
  let s = ''
  while (cpLen(s) < approxCp) s += '这是一句足够长的中文口播内容，用来把段落顶到块上限之上。'
  return s
}

/** 按段自证拼回 == 原段 */
function reconstruct (text, chunks) {
  const paras = text.split('\n')
  const byPara = new Map()
  for (const c of chunks) byPara.set(c.para, (byPara.get(c.para) || '') + c.text)
  return paras.map((p, i) => (byPara.get(i) || (p === '' ? '' : '«缺失»'))).join('\n')
}

describe('码点长度（不是 UTF-16 码元）', () => {
  it('代理对算一个字符：4 个 emoji 的 cpLen 是 4 而不是 8', () => {
    expect(cpLen('😀😀😀😀')).toBe(4)
    expect('😀😀😀😀'.length).toBe(8) // 这条存在的意义：证明判据没有退回 .length
  })
  it('空值与 null 都按 0 计，不抛', () => {
    expect(cpLen(null)).toBe(0)
    expect(cpLen(undefined)).toBe(0)
    expect(cpLen('')).toBe(0)
  })
})

describe('planChunks：块边界与结构不变量', () => {
  it('段落不超上限时一段一块，且块的 para 下标逐字对应', () => {
    const text = '第一段。\n第二段。\n\n第三段。'
    const r = planChunks(text)
    expect(r.ok).toBe(true)
    expect(r.chunks.map((c) => c.text)).toEqual(['第一段。', '第二段。', '第三段。'])
    expect(r.chunks.map((c) => c.para)).toEqual([0, 1, 3])
    expect(reconstruct(text, r.chunks)).toBe(text)
  })

  it('超上限的段落按句末标点切，终止标点留在句内、一个字符都不丢', () => {
    const src = longPara(MAX_CHUNK_CODEPOINTS + 900)
    const r = planChunks(src, { maxCodepoints: 1200 })
    expect(r.ok).toBe(true)
    for (const c of r.chunks) expect(cpLen(c.text)).toBeLessThanOrEqual(1200)
    // 每一块都必须以句末标点结尾（不得在句中断开）
    expect(r.chunks.every((c) => /[。！？；…]$/.test(c.text))).toBe(true)
    expect(reconstruct(src, r.chunks)).toBe(src)
  })

  it('单句本身就超上限 ⇒ 拒绝出期（CHUNK_UNSAFE），不硬切', () => {
    const unsafe = 'a'.repeat(500) // 无句末标点的一整句
    const r = planChunks(unsafe, { maxCodepoints: 100 })
    expect(r.ok).toBe(false)
    expect(r.code).toBe(TTS_COMPOSE_ERRORS.CHUNK_UNSAFE)
    expect(r.issues[0].para).toBe(0)
    expect(r.issues[0].path).toBe('copy.content')
  })

  it('一段安全一段不安全 ⇒ 整次拒绝，不得"先把安全那段发出去"（半篇音频比没音频更坏）', () => {
    const r = planChunks('安全的一小段。\n' + 'b'.repeat(500), { maxCodepoints: 100 })
    expect(r.ok).toBe(false)
    expect(r.code).toBe(TTS_COMPOSE_ERRORS.CHUNK_UNSAFE)
  })

  it('连续标点（？！ / ……）不被切成空句', () => {
    const s = splitSentences('真的？！我不信……彻底输了。')
    expect(s.join('')).toBe('真的？！我不信……彻底输了。')
    expect(s.every((x) => x.trim() !== '')).toBe(true)
  })

  it('全空输入 ⇒ CONTENT_TOO_SHORT（不得产出"0 块的正常计划"往下走）', () => {
    const r = planChunks('\n\n')
    expect(r.ok).toBe(false)
    expect(r.code).toBe(TTS_COMPOSE_ERRORS.CONTENT_TOO_SHORT)
  })
})

describe('validateComposeInput：§7.4.3 第①层，出站之前逐条判定', () => {
  const good = {
    channelId: 'ch_main',
    copy: { content: '这是一段足够长的播客正文。' .repeat(10) },
    title: '第一期',
    runId: 'abcd1234',
  }
  it('合规入参返回 ok 并带出切块结果（供上层直接驱动手柄）', () => {
    const r = validateComposeInput(good)
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.chunks) && r.chunks.length > 0).toBe(true)
    expect(r.channelId).toBe('ch_main')
  })
  it.each([
    ['缺频道', { ...good, channelId: ' ' }, TTS_COMPOSE_ERRORS.CHANNEL_ID_REQUIRED],
    ['频道形态非法（含 ../）', { ...good, channelId: '../x' }, TTS_COMPOSE_ERRORS.CHANNEL_ID_INVALID],
    ['正文短于一期下限', { ...good, copy: { content: '太短' } }, TTS_COMPOSE_ERRORS.CONTENT_TOO_SHORT],
    ['标题为空', { ...good, title: '  ' }, TTS_COMPOSE_ERRORS.TITLE_INVALID],
    ['runId 形态非法', { ...good, runId: 'ab' }, TTS_COMPOSE_ERRORS.RUN_ID_INVALID],
    ['voiceRef 半配（只有 providerId）', { ...good, voiceRef: { providerId: 'minimax' } }, TTS_COMPOSE_ERRORS.VOICE_REF_INCOMPLETE],
  ])('%s ⇒ 首个码是 %s', (_label, payload, code) => {
    const r = validateComposeInput(payload)
    expect(r.ok).toBe(false)
    expect(r.code).toBe(code)
    expect(r.issues.length).toBeGreaterThan(0)
    expect(r.issues[0]).toHaveProperty('path')
  })
  it('标题按码点判 200：emoji 计入一个字符而非两个', () => {
    const t = '😀'.repeat(201)
    expect(validateComposeInput({ ...good, title: t }).code).toBe(TTS_COMPOSE_ERRORS.TITLE_INVALID)
    expect(validateComposeInput({ ...good, title: '😀'.repeat(200) }).ok).toBe(true)
  })
  it('voiceRef 三段同缺是合法（由主进程按频道/全局两层取），不得在这里造默认音色', () => {
    expect(validateComposeInput({ ...good, voiceRef: {} }).ok).toBe(true)
  })
})

describe('QM-6 处置新增：上限钳制、空白段、稳定块号与领域码名', () => {
  // 夹具必须带句末终止标点：无句号的 2500 码点是「单句超上限」，planChunks 正确地拒绝硬切（那是另一条用例）
  const long = (n) => ('句子内容。').repeat(Math.ceil(n / 5))

  it('调用方把上限抬高也必须被钳回 2000（抬高等于把 provider 静默截断的洞重新打开）', () => {
    const r = planChunks(long(2500), { maxCodepoints: 999999 })
    expect(r.ok).toBe(true)
    for (const c of r.chunks) expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CODEPOINTS)
    // 反证锚：若钳制被摘掉，这里会出现一个 2500 码点的整块
    expect(r.chunks.length).toBeGreaterThan(1)
  })

  it('纯空白段不得成为独立 TTS 块', () => {
    const r = planChunks('第一段内容' + long(90) + '\n   \t \n' + '第二段内容' + long(90))
    expect(r.ok).toBe(true)
    for (const c of r.chunks) expect(c.text.trim()).not.toBe('')
  })

  it('每块带全局唯一 index，且一段切多块时 para 可重复而 index 不重复', () => {
    const r = planChunks(long(2500) + '\n' + long(2500))
    expect(r.ok).toBe(true)
    const idx = r.chunks.map((c) => c.index)
    expect(new Set(idx).size).toBe(idx.length)
    expect(idx).toEqual(r.chunks.map((_, i) => i))
    expect(r.totalBlocks).toBe(r.chunks.length)
    const paras = r.chunks.map((c) => c.para)
    expect(new Set(paras).size).toBeLessThan(paras.length)
  })

  it('领域码名逐字服从 PRD §7.4.6（COPY_TOO_SHORT / VOICE_UNRESOLVED，不是自造名）', () => {
    expect(TTS_COMPOSE_ERRORS.CONTENT_TOO_SHORT).toBe('PODCAST_TTS_COPY_TOO_SHORT')
    expect(TTS_COMPOSE_ERRORS.VOICE_REF_INCOMPLETE).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
    const r = validateComposeInput({ channelId: 'ch_abcd1234', title: 'T', runId: 'run_12345678', copy: { content: '短' } })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PODCAST_TTS_COPY_TOO_SHORT')
  })
})

describe('后端 QM-6 处置新增：成串标点、逐段顺序不变量、channelId 判据同源', () => {
  it('成串终止标点（？！ / ……）不得被逐字拆成两句', () => {
    expect(splitSentences('真的？！我不信……好吧')).toEqual(['真的？！', '我不信……', '好吧'])
    // 变异反证：把「下一个不是终止标点」这半条摘掉，'？！' 会被拆成 '？' 与 '！'
    expect(splitSentences('真的？！').join('|')).not.toContain('？|！')
  })

  it('重构不变量要按**段内顺序**断言：切完按 para 依次拼回必须逐字等于原段', () => {
    const src = ['第一段' + '内容。'.repeat(700), '第二段' + '文字！'.repeat(400), '短段无他'].join('\n')
    const r = planChunks(src)
    expect(r.ok).toBe(true)
    const paras = src.split('\n')
    paras.forEach((p, idx) => {
      const back = r.chunks.filter((c) => c.para === idx).map((c) => c.text).join('')
      expect(back).toBe(p)
    })
    // 段间不得重排：段落下标序列必须单调不减。
    // （原先用 join 反推分隔符，把「实现不在块间补段间换行」也当成违约——那不是本层的合同。）
    const parasSeen = r.chunks.map((c) => c.para)
    expect(parasSeen).toEqual([].concat(parasSeen).sort((x, y) => x - y))
  })

  it('channelId 判据复用 registry 唯一实现：宽松形态（c / UPPER / myChannelABC）必须在**本层**就拒', () => {
    const { CHANNEL_ID_RE } = require('./podcast-channel-registry')
    const bad = ['c', 'UPPER', 'myChannelABC', 'ch_']
    for (const id of bad) {
      const r = validateComposeInput({
        channelId: id, title: 'T', runId: 'run_12345678',
        copy: { content: '这是一段足够长的播客正文，用来越过口播下限。'.repeat(6) },
      })
      expect(r.ok, id).toBe(false)
      expect(r.issues.some((i) => i.code === 'PODCAST_CHANNEL_ID_INVALID'), id).toBe(true)
    }
    // 同源判据：本层用的就是那一份正则对象，而不是抄了一份形状相似的
    expect(CHANNEL_ID_RE.test('ch_abcd1234')).toBe(true)
    for (const id of bad) expect(CHANNEL_ID_RE.test(id)).toBe(false)
  })

  it('runId 首尾空白必须先 trim：带空白的值不得进临时目录名那一步', () => {
    const r = validateComposeInput({
      channelId: 'ch_abcd1234', title: 'T', runId: '  run_12345678  ',
      copy: { content: '这是一段足够长的播客正文，用来越过口播下限。'.repeat(6) },
    })
    expect(r.ok).toBe(true)
    expect(r.runId).toBe('run_12345678')
  })
})

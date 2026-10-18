// @ts-check
/**
 * rpa-dom-dump 测试（video-publish-4，2026-10-18）
 *
 * 锁四件事：① 默认关闭且关闭时**不触碰页面**（零开销是它的存在前提）；
 * ② 只采结构不采内容（valueLength 而非 value）；③ 落盘文件名/目录可预期；
 * ④ 任何异常都不得中断发布主链。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { COLLECT_SCRIPT, dumpDom, dumpDir, isEnabled, safePath } = require('./rpa-dom-dump')

function tmpDir (tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mp-dom-dump-' + tag + '-'))
}

function makeWin (payload, url = 'https://example.test/platform/post/create?token=SECRET#x') {
  return {
    webContents: {
      getURL: () => url,
      executeJavaScript: vi.fn().mockResolvedValue(payload),
    },
  }
}

const SAMPLE = {
  urlPath: '/platform/post/create',
  docTitle: '发表视频',
  files: [{ accept: 'video/*', multiple: false, disabled: false, visible: true, cls: 'upload-input', id: '' }],
  inputs: [{ type: 'text', placeholder: '填写标题', cls: 'c', id: 't', name: '', visible: true, valueLength: 3, maxLength: 60 }],
  textareas: [{ placeholder: '描述', cls: 'd', id: '', visible: true, valueLength: 12 }],
  editables: [{ tag: 'div', cls: 'ProseMirror', id: '', placeholder: '说点什么', visible: true, textLength: 20 }],
  buttons: [{ text: '发表', disabled: false, visible: true, cls: 'btn', tag: 'button' }],
  uploadAreas: [{ cls: 'upload-wrap', tag: 'div', visible: true }],
  bodyTextLength: 100,
}

describe('rpa-dom-dump — 开关与边界', () => {
  it('默认关闭：未设 MP_DOM_DUMP 时不采集、且一次都不读页面', async () => {
    const win = makeWin(SAMPLE)
    const out = await dumpDom(win, 'tencent_video', 'nav', { env: {}, dir: tmpDir('off') })
    expect(out).toBeNull()
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('只有精确 1 才开启（"true"/"yes" 不算，避免误开）', () => {
    expect(isEnabled({ MP_DOM_DUMP: '1' })).toBe(true)
    expect(isEnabled({ MP_DOM_DUMP: 'true' })).toBe(false)
    expect(isEnabled({ MP_DOM_DUMP: '0' })).toBe(false)
    expect(isEnabled({})).toBe(false)
  })

  it('关闭时也没有创建落盘目录（零副作用）', async () => {
    const dir = tmpDir('off2')
    await dumpDom(makeWin(SAMPLE), 'douyin', 'nav', { env: {}, dir })
    expect(fs.readdirSync(dir)).toEqual([])
  })
})

describe('rpa-dom-dump — 采集结果', () => {
  it('开启后按平台+阶段落盘，并汇总 counts', async () => {
    const dir = tmpDir('on')
    const rec = await dumpDom(makeWin(SAMPLE), 'tencent_video', 'uploaded', { env: { MP_DOM_DUMP: '1' }, dir })
    expect(rec.counts).toEqual({ files: 1, inputs: 1, textareas: 1, editables: 1, buttons: 1 })
    const files = fs.readdirSync(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^tencent_video-uploaded-\d+\.json$/)
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'))
    expect(onDisk.platform).toBe('tencent_video')
    expect(onDisk.stage).toBe('uploaded')
    expect(onDisk.files[0].accept).toBe('video/*')
  })

  it('只采结构不采内容：输入框只有 valueLength，没有 value 字段', async () => {
    const dir = tmpDir('content')
    await dumpDom(makeWin(SAMPLE), 'douyin', 'prepublish', { env: { MP_DOM_DUMP: '1' }, dir })
    const file = path.join(dir, fs.readdirSync(dir)[0])
    const text = fs.readFileSync(file, 'utf8')
    expect(text).not.toMatch(/"value"\s*:/)
    expect(text).toMatch(/"valueLength"\s*:/)
    expect(text).not.toMatch(/SECRET/)
  })

  it('URL 只留 origin + pathname（丢掉 query，避免 token 落盘）', async () => {
    expect(safePath('https://channels.weixin.qq.com/platform/post/create?token=abc&x=1')).toBe('https://channels.weixin.qq.com/platform/post/create')
    expect(safePath('not a url')).toBe('')
    const win = makeWin(SAMPLE, 'https://channels.weixin.qq.com/platform/post/create?token=abc&x=1')
    const rec = await dumpDom(win, 'tencent_video', 'nav', { env: { MP_DOM_DUMP: '1' }, dir: tmpDir('url') })
    expect(rec.urlPath).toBe('https://channels.weixin.qq.com/platform/post/create')
    expect(JSON.stringify(rec)).not.toMatch(/token=abc/)
  })

  it('落盘目录固定在系统临时目录下的 mp-dom-dump（不污染仓库）', () => {
    expect(dumpDir()).toBe(path.join(os.tmpdir(), 'mp-dom-dump'))
  })
})

describe('rpa-dom-dump — 绝不打断发布主链', () => {
  it('页面执行抛错时返回 null 而不抛', async () => {
    const win = { webContents: { getURL: () => 'https://x.test/p', executeJavaScript: vi.fn().mockRejectedValue(new Error('boom')) } }
    await expect(dumpDom(win, 'douyin', 'nav', { env: { MP_DOM_DUMP: '1' }, dir: tmpDir('boom') })).resolves.toBeNull()
  })

  it('页面返回非对象时返回 null', async () => {
    const win = { webContents: { getURL: () => 'https://x.test/p', executeJavaScript: vi.fn().mockResolvedValue('nope') } }
    await expect(dumpDom(win, 'douyin', 'nav', { env: { MP_DOM_DUMP: '1' }, dir: tmpDir('bad') })).resolves.toBeNull()
  })

  it('采集脚本本身是单个函数字面量（会被包成 (script)()）', () => {
    expect(COLLECT_SCRIPT.startsWith('function(){')).toBe(true)
    expect(COLLECT_SCRIPT.trimEnd().endsWith('}')).toBe(true)
    // 不得出现内容取值（只允许 length）
    expect(COLLECT_SCRIPT).not.toMatch(/\.value\b\s*[,}]/)
  })
})

describe('rpa-dom-dump — CCG 自扮演裁决整改（i6/i7）', () => {
  it('i6：写盘必须走异步（发布热路径被 await，不得用 writeFileSync 阻塞）', () => {
    const src = fs.readFileSync(require.resolve('./rpa-dom-dump'), 'utf8')
    expect(src).toContain('fs.promises.writeFile')
    expect(src).not.toMatch(/fs\.writeFileSync\(file/)
  })

  it('i7：保留策略只留最近 N 份，且只动本模块命名形态的 .json', async () => {
    const { pruneDumps } = require('./rpa-dom-dump')
    const dir = tmpDir('prune')
    for (let i = 0; i < 6; i++) {
      const f = path.join(dir, 'k-stage-' + (1700000000000 + i) + '.json')
      fs.writeFileSync(f, '{}')
      const t = new Date(1700000000000 + i * 1000)
      fs.utimesSync(f, t, t)
    }
    fs.writeFileSync(path.join(dir, 'keep-me.txt'), 'x')
    const dropped = await pruneDumps(dir, 2)
    expect(dropped).toBe(4)
    const left = fs.readdirSync(dir).sort()
    // 只剩最后 2 份（按 mtime 的最近）+ 非本模块的 txt
    expect(left.filter((n) => n.endsWith('.json'))).toEqual([
      'k-stage-1700000000004.json', 'k-stage-1700000000005.json',
    ])
    expect(left).toContain('keep-me.txt')
  })

  it('i7：目录不存在或读失败时静默返回 0（取证不得影响发布）', async () => {
    const { pruneDumps } = require('./rpa-dom-dump')
    await expect(pruneDumps(path.join(os.tmpdir(), 'mp-dom-dump-not-exist-' + Date.now()), 2)).resolves.toBe(0)
  })
})

describe('rpa-dom-dump — 第二轮自扮演裁决整改（i1/i2/i3/i5）', () => {
  it('i1：保留策略按 mtime 排序，而不是文件名字典序', () => {
    const src = fs.readFileSync(require.resolve('./rpa-dom-dump'), 'utf8')
    expect(src).toContain('mtimeMs')
    expect(src).not.toMatch(/names\.filter\(\(n\) => n\.endsWith\('\.json'\)\)\.sort\(\)/)
  })

  it('i1：前缀长度不同也按真实时间淘汰（字典序会判错的那种）', async () => {
    const { pruneDumps } = require('./rpa-dom-dump')
    const dir = tmpDir('mtime')
    // 构造「字典序」与「时间序」相反的两组名字
    fs.writeFileSync(path.join(dir, 'z-long-platform-nav-1700000000000.json'), '{}')
    await new Promise((r) => setTimeout(r, 20))
    fs.writeFileSync(path.join(dir, 'a-stage-1700000000001.json'), '{}')
    fs.utimesSync(path.join(dir, 'z-long-platform-nav-1700000000000.json'), new Date(1000), new Date(1000))
    fs.utimesSync(path.join(dir, 'a-stage-1700000000001.json'), new Date(2000), new Date(2000))
    const dropped = await pruneDumps(dir, 1)
    expect(dropped).toBe(1)
    expect(fs.readdirSync(dir)).toEqual(['a-stage-1700000000001.json'])
  })

  it('i2：只删本模块命名形态的 .json，别人的 .json 一律不碰', async () => {
    const { pruneDumps } = require('./rpa-dom-dump')
    const dir = tmpDir('own')
    for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(dir, 'douyin-nav-' + (1700000000000 + i) + '.json'), '{}')
    const foreign = ['notes.json', 'cache.json', 'douyin-nav-123.json']
    for (const n of foreign) fs.writeFileSync(path.join(dir, n), '{}')
    const dropped = await pruneDumps(dir, 1)
    expect(dropped).toBe(3)
    expect(fs.readdirSync(dir).filter((n) => foreign.includes(n)).sort()).toEqual([...foreign].sort())
  })

  it('i3：按钮只对发布类控件词表保留 preview，其余只留 textLength（防用户内容落盘）', () => {
    expect(COLLECT_SCRIPT).toContain('VOCAB')
    expect(COLLECT_SCRIPT).toContain('preview')
    expect(COLLECT_SCRIPT).toContain('textBucket:bucket(t.length)')
    expect(COLLECT_SCRIPT).not.toMatch(/text:cut\(e\.innerText,40\)/)
  })

  it('i5：采集脚本可被解析（语法守卫），不会把语法错误带进页面', () => {
    expect(() => new Function('return (' + COLLECT_SCRIPT + ')')).not.toThrow()
  })
})

describe('rpa-dom-dump — 第三轮自扮演裁决整改（i2/i3/i6）', () => {
  it('i2：长度分档（0 / 1-20 / 21-100 / 100+），不再落精确长度', () => {
    expect(COLLECT_SCRIPT).toContain('valueBucket')
    expect(COLLECT_SCRIPT).toContain('textBucket')
    expect(COLLECT_SCRIPT).toContain('"21-100"')
    expect(COLLECT_SCRIPT).not.toContain('valueLength')
  })

  it('i3：取证调用必须被 try/catch 包住（模块加载失败不得炸上传主链）', () => {
    const src = fs.readFileSync(require.resolve('./upload-waiter'), 'utf8')
    const line = src.split('\n').find((l) => l.includes("dumpDom(win, platform, 'uploaded'"))
    expect(line).toBeTruthy()
    expect(line).toContain('try {')
    const idx = src.indexOf("dumpDom(win, platform, 'uploaded'")
    const window = src.slice(Math.max(0, idx - 300), idx + 300)
    expect(window).toContain('catch')
  })

  it('i6：老化主键取文件名里的 epoch（时钟跳变不影响），mtime 仅兜底', () => {
    const src = fs.readFileSync(require.resolve('./rpa-dom-dump'), 'utf8')
    expect(src).toMatch(/DUMP_NAME_RE\.exec\(n\)/)
    expect(src).toContain('Number(m[2])')
  })
})

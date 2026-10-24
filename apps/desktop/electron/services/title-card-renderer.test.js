// @ts-check
/**
 * title-card-renderer 单测（node --test 风格，vitest 收集）
 *
 * 锁的核心契约是**标题安全区**：合成引擎默认动效 zoom-in 会把画面放大到 1.25 倍
 * 居中裁切，左右各裁 10% ⇒ 文字距边不足就会被**无声地切掉**
 * （实测：占位图的「好消息是」在成片里变成「消息是」，成片不报错、不降级、只是少字）。
 * 这个缺陷在流水线上没有任何断言能看见，所以在这里用纯函数层面钉死。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  renderTitleCard,
  computeCardLayout,
  wrapText,
  normalizeOptions,
  escapeDrawtextText,
  THEMES,
  SAFE_MARGIN_RATIO,
} = require('./title-card-renderer')

const { findFfmpeg } = require('./media-tool-paths')

/** zoom-in 1.25 居中裁切吃掉的单侧比例 —— 安全区必须大于它 */
const ZOOM_IN_CROP_RATIO = 0.1

describe('title-card-renderer 中文折行', () => {
  it('按估算宽度折行且不丢字', () => {
    const text = '你有没有过这样的时刻：明知道截止日期就在明天，手上这件事却怎么也推不动？'
    const lines = wrapText(text, 12)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe(text)
  })

  it('空串与纯空白返回空数组（不得产出含空串的数组）', () => {
    expect(wrapText('', 10)).toEqual([])
    expect(wrapText('   ', 10)).toEqual([])
    expect(wrapText(null, 10)).toEqual([])
  })

  it('半角字符比全角占更少宽度（英文不会被过早折断）', () => {
    const cjk = wrapText('一二三四五', 5)
    const ascii = wrapText('abcdefghij', 5)
    expect(cjk.length).toBe(1)
    expect(ascii.length).toBeGreaterThan(cjk.length)
  })

  it('宽度预算非法时回落到默认值而不是抛错', () => {
    expect(wrapText('测试文本', 0).length).toBeGreaterThan(0)
    expect(wrapText('测试文本', -5).length).toBeGreaterThan(0)
    expect(wrapText('测试文本', Number.NaN).length).toBeGreaterThan(0)
  })
})

describe('title-card-renderer drawtext 文本转义', () => {
  it('转义 ffmpeg 滤镜语法的定界符与 expansion 字符', () => {
    // 单引号在 ffmpeg 单引号语境里必须写成「闭合-转义-重开」（见实现处注释）：
    // 旧写法 \' 会提前闭合引号 ⇒ 后半段被当 filter 参数 ⇒ 渲染失败或**静默产出空白图**。
    expect(escapeDrawtextText("it's")).toBe("it'\\''s")
    expect(escapeDrawtextText('a:b')).toBe('a\\:b')
    expect(escapeDrawtextText('a,b')).toBe('a\\,b')
    expect(escapeDrawtextText('100%')).toBe('100\\%')
    expect(escapeDrawtextText('{x}')).toBe('\\{x\\}')
    // 逐字期望（与迁移前的 asset-generator 实现逐字一致）：
    // 输入字符 `C:\\path` ⇒ 先把两个反斜杠各自转义成两个（→4 个），再把 `:` 转义 ⇒ `C\:\\\\path`
    expect(escapeDrawtextText('C:\\\\path')).toBe('C\\:\\\\\\\\path')
  })

  it('换行折成空格（drawtext 的 text= 里换行不可靠，逐行渲染由调用方负责）', () => {
    expect(escapeDrawtextText('a\nb')).toBe('a b')
    expect(escapeDrawtextText('a\r\nb')).toBe('a b')
  })

  it('空值不炸', () => {
    expect(escapeDrawtextText('')).toBe('')
    expect(escapeDrawtextText(null)).toBe('')
    expect(escapeDrawtextText(undefined)).toBe('')
  })

  it('asset-generator 转发的是同一个函数（公共 API 不破）', () => {
    const { escapeDrawtextText: viaAssetGenerator } = require('./asset-generator')
    expect(viaAssetGenerator).toBe(escapeDrawtextText)
  })
})

describe('title-card-renderer 入参校验', () => {
  it('画幅有下限（再小排版无意义）', () => {
    const opts = normalizeOptions({ width: 10, height: 10 })
    expect(opts.width).toBeGreaterThanOrEqual(320)
    expect(opts.height).toBeGreaterThanOrEqual(240)
  })

  it('未知主题回落到默认主题而不是抛错', () => {
    expect(normalizeOptions({ theme: '不存在的孤儿主题' }).theme).toBe('cinematic')
    expect(normalizeOptions({ theme: 'anime' }).theme).toBe('anime')
  })

  it('safeMarginRatio 被夹在 [0, 0.4]', () => {
    expect(normalizeOptions({ safeMarginRatio: 5 }).safeMarginRatio).toBe(0.4)
    expect(normalizeOptions({ safeMarginRatio: -1 }).safeMarginRatio).toBe(0)
    expect(normalizeOptions({}).safeMarginRatio).toBe(SAFE_MARGIN_RATIO)
  })

  it('progress 被夹在 [0, 1]；未给时为 null（不画进度条）', () => {
    expect(normalizeOptions({ progress: 3 }).progress).toBe(1)
    expect(normalizeOptions({ progress: -1 }).progress).toBe(0)
    expect(normalizeOptions({}).progress).toBeNull()
  })

  it('缺 outputPath 或标题与副标题都为空时抛错', async () => {
    await expect(renderTitleCard({ title: 'x' })).rejects.toThrow(/outputPath/)
    await expect(renderTitleCard({ outputPath: '/tmp/x.png', title: '  ', subtitle: '' }))
      .rejects.toThrow(/至少要有一个非空/)
  })
})

describe('title-card-renderer 标题安全区（核心契约）', () => {
  it('默认边距必须大于 zoom-in 的裁切量', () => {
    expect(SAFE_MARGIN_RATIO).toBeGreaterThan(ZOOM_IN_CROP_RATIO)
  })

  it('所有文字的 x 坐标都落在安全区内', () => {
    const layout = computeCardLayout({
      title: '你有没有过这样的时刻：明知道截止日期就在明天',
      subtitle: '一段比较长的副标题，用来验证折行与边距',
      label: 'AI 讲解视频',
      counter: '场景 2 / 8',
      width: 1280,
      height: 720,
    })
    expect(layout.margin).toBeGreaterThanOrEqual(1280 * ZOOM_IN_CROP_RATIO)
    // drawtext 的 x 必须是字面量 margin 或含 margin 的表达式
    const textFilters = layout.filters.filter(f => f.startsWith('drawtext='))
    expect(textFilters.length).toBeGreaterThan(0)
    for (const filter of textFilters) {
      const x = /:x=([^:]*)/.exec(filter)
      expect(x).not.toBeNull()
      const value = x[1]
      if (value.startsWith('(')) {
        // 右下角计数：右边距同样是 margin
        expect(value).toContain(String(layout.margin))
      } else {
        expect(Number(value)).toBeGreaterThanOrEqual(layout.margin)
      }
    }
  })

  it('内容宽度不超过画幅减去两侧安全区', () => {
    const layout = computeCardLayout({ title: '标题', subtitle: '副标题', width: 1920, height: 1080 })
    expect(layout.contentWidth).toBeLessThanOrEqual(1920 - layout.margin * 2)
  })

  it('显式把边距调小是允许的（调用方有权覆盖），但不得为负', () => {
    const layout = computeCardLayout({ title: '标题', width: 1280, safeMarginRatio: 0 })
    expect(layout.margin).toBe(0)
  })

  it('标题超过行数上限时被截断（不无限撑高画面）', () => {
    const layout = computeCardLayout({ title: '很长很长的标题'.repeat(20), width: 1280, titleMaxLines: 2 })
    expect(layout.titleLines.length).toBeLessThanOrEqual(2)
  })
})

describe('title-card-renderer 实际渲染', () => {
  const ffmpeg = findFfmpeg()

  // ffmpeg 不可用时（本机没装 / CI 用 --ignore-scripts 装依赖）跳过渲染断言，
  // 但上面的纯函数契约仍然全部执行。
  const itWithFfmpeg = ffmpeg ? it : it.skip

  itWithFfmpeg('产出一张 PNG 且尺寸与请求一致', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'title-card-'))
    const out = path.join(dir, 'card.png')
    try {
      const card = await renderTitleCard({
        title: '拖延症不是懒：拖延背后的情绪调节机制',
        subtitle: '深夜卧室，蓝白色屏幕光映在年轻人的脸上',
        label: 'AI 讲解视频',
        counter: '场景 1 / 8',
        progress: 0.125,
        width: 640,
        height: 360,
        outputPath: out,
      })
      expect(card.path).toBe(out)
      expect(card.width).toBe(640)
      expect(card.height).toBe(360)
      expect(fs.existsSync(out)).toBe(true)
      const buffer = fs.readFileSync(out)
      // PNG 魔数
      expect(buffer.slice(1, 4).toString('ascii')).toBe('PNG')
      // 豆腐块（字体解析失败）会退化成极小的 PNG（实测 5495 → 765 字节），
      // 这里用下限挡住「渲染了但字全是方块」的静默失败。
      expect(buffer.length).toBeGreaterThan(3000)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  itWithFfmpeg('含 ffmpeg 滤镜特殊字符的文案不得让渲染炸掉', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'title-card-'))
    const out = path.join(dir, 'card.png')
    try {
      await renderTitleCard({
        title: '100% 的努力：path\\to\\file,with,commas',
        subtitle: "quote ' and {brace} and %percent",
        width: 640,
        height: 360,
        outputPath: out,
      })
      expect(fs.existsSync(out)).toBe(true)
      expect(fs.statSync(out).size).toBeGreaterThan(3000)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  itWithFfmpeg('带单引号的文案必须真渲染出内容（防「rc=0 但产出空白图」的静默失败）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'title-card-'))
    const out = path.join(dir, 'card.png')
    try {
      await renderTitleCard({
        title: "it's a trap: {brace} and 100%",
        subtitle: "quote ' here",
        width: 640,
        height: 360,
        outputPath: out,
      })
      const size = fs.statSync(out).size
      // 旧转义在这类文案上产出 630 字节的空白图（rc=0、不报错）；
      // 正常有文字的卡片在同尺寸下是数千字节 ⇒ 体积下限即「有没有画出字」的代理判据。
      expect(size).toBeGreaterThan(2000)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('主题表覆盖既有 imageStyle 取值域（流水线 style 传进来不能落空）', () => {
    for (const key of ['cinematic', 'realistic', 'cartoon', 'anime', 'cyberpunk', 'watercolor', 'minimalist']) {
      expect(THEMES[key]).toBeTruthy()
    }
  })
})

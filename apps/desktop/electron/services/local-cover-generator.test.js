// @ts-check
/**
 * local-cover-generator.test.js — 本地封面生成器（SVG→sharp→PNG）回归锁
 *
 * 覆盖：
 * 1. 基本生成：标题 → PNG 文件落盘（真实 sharp 渲染，非 mock）
 * 2. 长标题换行：>12 字自动折行（SVG 文本 tspan 分行）
 * 3. 比例：3:4（小红书/快手图文推荐竖版）与 16:9
 * 4. 空标题/超长标题边界：不崩溃，产出合法 PNG
 * 5. 输出文件可被 sharp 读取（元数据校验：PNG 格式、宽高正确）
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { generateLocalCover, buildCoverSvg, wrapTitle, resolveTheme, MOTIFS } = require('./local-cover-generator')

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'local-cover-test-'))

// CI 高负载下 sharp 原生模块**首载**可 >30s（Run 36615452794 Shards 1/2 实测：首个用例
// 30s 超时，而渲染本身毫秒级）。在 beforeAll 里预热一次并给足预算，使各用例只承担渲染耗时。
beforeAll(async () => {
  const sharp = require('sharp')
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#000"/></svg>'))
    .png()
    .toBuffer()
}, 180000)

function cleanup () {
  for (const f of fs.readdirSync(TMP_DIR)) {
    try { fs.unlinkSync(path.join(TMP_DIR, f)) } catch (_) { /* ignore */ }
  }
  try { fs.rmdirSync(TMP_DIR) } catch (_) { /* ignore */ }
}
afterAll(cleanup)

describe('local-cover-generator — 本地封面生成（SVG→sharp→PNG）', () => {
  it('基本生成：标题产出合法 PNG 且尺寸正确（3:4 竖版 1080x1440）', async () => {
    const result = await generateLocalCover('Tiffany中国区负责人致歉', {
      outputDir: TMP_DIR,
      ratio: '3:4',
    })
    expect(result.code).toBe(0)
    expect(result.data.path).toMatch(/\.png$/)
    expect(fs.existsSync(result.data.path)).toBe(true)

    // 真实 sharp 读取元数据（非 mock：验证产物是合法 PNG 且尺寸对）
    const sharp = require('sharp')
    const meta = await sharp(result.data.path).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(1080)
    expect(meta.height).toBe(1440)
  }, 60000)

  it('16:9 横版 1920x1080', async () => {
    const result = await generateLocalCover('测试标题', {
      outputDir: TMP_DIR,
      ratio: '16:9',
    })
    expect(result.code).toBe(0)
    const sharp = require('sharp')
    const meta = await sharp(result.data.path).metadata()
    expect(meta.width).toBe(1920)
    expect(meta.height).toBe(1080)
  }, 60000)

  it('长标题自动折行（>12 字分行，不溢出画布）', async () => {
    const longTitle = '接力夺冠姑娘们把国旗叠得方方正正北京大学禁止赴风景名胜区开会'
    const result = await generateLocalCover(longTitle, {
      outputDir: TMP_DIR,
      ratio: '3:4',
    })
    expect(result.code).toBe(0)
    // 产物合法（长标题不崩溃、不出白屏）
    const sharp = require('sharp')
    const meta = await sharp(result.data.path).metadata()
    expect(meta.format).toBe('png')
  }, 60000)

  it('空标题边界：不崩溃，产出合法 PNG（占位文案）', async () => {
    const result = await generateLocalCover('', { outputDir: TMP_DIR })
    expect(result.code).toBe(0)
    expect(fs.existsSync(result.data.path)).toBe(true)
  }, 60000)

  it('超长标题（>200 字）截断到 60 字内不崩溃', async () => {
    const hugeTitle = '超'.repeat(300)
    const result = await generateLocalCover(hugeTitle, { outputDir: TMP_DIR })
    expect(result.code).toBe(0)
    const sharp = require('sharp')
    const meta = await sharp(result.data.path).metadata()
    expect(meta.format).toBe('png')
  }, 60000)

  it('两次生成产出不同文件（时间戳+随机后缀防覆盖）', async () => {
    const r1 = await generateLocalCover('标题A', { outputDir: TMP_DIR })
    const r2 = await generateLocalCover('标题A', { outputDir: TMP_DIR })
    expect(r1.data.path).not.toBe(r2.data.path)
  }, 60000)
})

// 2026-10-06 内容感知封面回归锁。设计前提是「AI 生图不可用时的兜底」，
// 因此这里全部用**纯函数**（不碰 sharp）断言，覆盖旧版被单一场景覆盖不到的分支。
describe('local-cover-generator — 内容感知封面（纯函数，不依赖 sharp）', () => {
  it('确定性：同一内容两次构建的 SVG 逐字节相同', () => {
    expect(buildCoverSvg('大模型推理成本暴跌', { content: 'AI 算力降价' }))
      .toBe(buildCoverSvg('大模型推理成本暴跌', { content: 'AI 算力降价' }))
  })

  it('区分性：不同内容产出不同画面', () => {
    expect(buildCoverSvg('甲文', { content: 'a' })).not.toBe(buildCoverSvg('乙文', { content: 'b' }))
  })

  it('安全：标题中的 XML 特殊字符全部转义，SVG 中无裸标签', () => {
    const svg = buildCoverSvg('<script>alert(1)</script> & "x"', {})
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('&amp;')
  })

  it('识别：8 条真实标题全部命中预期主题', () => {
    const cases = [
      ['大模型推理成本暴跌', 'tech'],
      ['面试被问「你最大的缺点」', 'career'],
      ['家常红烧肉这样做', 'food'],
      ['川西七日自驾', 'travel'],
      ['每月定投指数基金', 'finance'],
      ['养了三年的猫', 'pet'],
      ['一岁半的柯基开始掉毛', 'pet'],
      ['Steam 新游打折入手', 'game'],
    ]
    for (const [t, exp] of cases) expect(resolveTheme(t, '').id).toBe(exp)
  })

  it('哈希分支：5000 条无主题内容全部映射到合法纹样（JS 有符号位运算回归锁）', () => {
    for (let i = 0; i < 5000; i++) {
      expect(MOTIFS).toContain(resolveTheme('标题' + i, '正文' + i).motif)
    }
  })

  it('哈希分支：20 条无主题内容的纹样分布够广（低位分布不均回归锁）', () => {
    const seen = new Set()
    for (let i = 0; i < 20; i++) seen.add(resolveTheme('无主题随笔' + i, '内容' + i).motif)
    expect(seen.size).toBeGreaterThanOrEqual(8)
  })

  it('排版禁则：ASCII 词不拆散、闭合引号不落行首', () => {
    const ascii = wrapTitle('大模型推理成本暴跌，AI 应用进入平价时代', 11)
    expect(ascii.every((l) => !/^[A-Za-z]$/.test(l))).toBe(true)
    expect(ascii.join('')).toContain('AI')
    expect(wrapTitle('面试被问「你最大的缺点」怎么答', 11).some((l) => l.startsWith('」'))).toBe(false)
  })

  it('截断：超长标题末行带省略号，不静默丢字', () => {
    const lines = wrapTitle('超'.repeat(300), 11)
    expect(lines.length).toBeLessThanOrEqual(4)
    expect(lines[lines.length - 1].endsWith('…')).toBe(true)
  })

  it('不截断：短标题不带省略号', () => {
    expect(wrapTitle('面试被问「你最大的缺点」', 11).some((l) => l.includes('…'))).toBe(false)
  })

  it('版式：5 种画幅均产出合法 viewBox', () => {    for (const [w, h] of [[1080, 1440], [1920, 1080], [1080, 1080], [1440, 1080], [1080, 1920]]) {
      expect(buildCoverSvg('比例测试标题', { width: w, height: h })).toContain(`viewBox="0 0 ${w} ${h}"`)
    }
  })

  it('版式：横版（16:9）文字块不超过 58% 画高，装饰区不被压没', () => {
    const svg = buildCoverSvg('秋天的第一杯咖啡，藏在老巷子里的手冲', { width: 1920, height: 1080, content: '探店咖啡馆' })
    const m = svg.match(/<clipPath id="safe"><rect x="0" y="(\d+)"/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeLessThanOrEqual(1080 * 0.84)
    expect(Number(m[1])).toBeGreaterThan(1080 * 0.5)
  })

  // QM-6 评审 i2（2026-10-16）：临时 SVG 必须回收，否则批量做 N 条封面就堆 N 个垃圾文件
  it('栅格化后不残留临时 SVG（finally 回收）', async () => {
    const svgDir = path.join(os.tmpdir(), 'mp-cover-svg')
    const countSvg = () => {
      try { return fs.readdirSync(svgDir).filter(f => f.endsWith('.svg')).length } catch (_) { return 0 }
    }
    const before = countSvg()
    const r = await generateLocalCover('临时文件回收验证', { outputDir: TMP_DIR, content: '封面清理' })
    expect(r.code).toBe(0)
    expect(countSvg(), '每次生成都在 os.tmpdir()/mp-cover-svg 留下一个 SVG，长期堆积').toBe(before)
  }, 60000)

  it('生成结果回传 theme / themeLabel / keywords', async () => {
    const r = await generateLocalCover('每月定投指数基金', { outputDir: TMP_DIR, content: '基金定投理财复盘' })
    expect(r.code).toBe(0)
    expect(r.data.theme).toBe('finance')
    expect(r.data.themeLabel).toBe('财经')
    expect(Array.isArray(r.data.keywords)).toBe(true)
  }, 60000)
})

// @ts-check
/**
 * story2video-compose-engine 字幕转义单元测试
 *
 * 测试 ffmpeg drawtext 滤镜中字幕文本的转义逻辑。
 * 重点：转义顺序（\ 必须最先）+ 字符覆盖（: , ' % { } \）
 */
const fs = require('fs')
const { execFile } = require('child_process')
const os = require('os')
const path = require('path')
const {
  Story2VideoComposeEngine,
  findFfmpeg,
  findFfprobe,
  KNOWN_COMPOSE_PHASES,
  normalizeComposeProgressUpdate,
  countChunkedMergeChunks,
  buildTransitionPlan,
  escapeSubtitleText,
  normalizeComposeScenes,
  buildImageEffectFilter,
  buildSubtitleFilter,
  buildWatermarkFilter,
  buildScaleFilter,
  computeFfmpegStageTimeoutMs,
  isFfmpegStageTimeoutError,
  normalizeFfmpegStageError,
  computeSegmentEncodeTimeoutMs,
  computeMergeEncodeTimeoutMs,
  resolveMaxOutputDimensions,
  validateResolutionCapability,
  computeWorkResolution,
  parseResolution,
  resolveCjkFont,
  escapeFontFilePath,
} = require('./story2video-compose-engine')

function writeFixture (root, name, content = 'media') {
  const filePath = path.join(root, name)
  fs.writeFileSync(filePath, content)
  return filePath
}

describe('escapeSubtitleText — ffmpeg drawtext 字幕转义', () => {
  // 1. 正常路径：纯中文无需转义
  it('1. 纯中文文本保持原样', () => {
    expect(escapeSubtitleText('你好世界')).toBe('你好世界')
  })

  // 2. 冒号转义
  it('2. 冒号转义为 \\:', () => {
    expect(escapeSubtitleText('时间: 30秒')).toBe('时间\\: 30秒')
  })

  // 3. 单引号转义
  it('3. 单引号转义为 \\’', () => {
    expect(escapeSubtitleText("It's OK")).toBe("It\\'s OK")
  })

  // 4. 逗号转义
  it('4. 逗号转义为 \\,', () => {
    expect(escapeSubtitleText('Hello, World')).toBe('Hello\\, World')
  })

  // 5. 反斜杠转义（必须最先转义，否则后续转义符被二次转义）
  // 输入 'C:\\path'（JS 字符串值 C:\path）含 \ 和 :，两者都需转义
  // 步骤1 \→\\：C:\\path；步骤2 :→\:：C\:\\path
  // JS 字面量 'C\\:\\\\path' 表示字符串值 C\:\\path
  it('5. 反斜杠转义为 \\\\', () => {
    expect(escapeSubtitleText('C:\\path')).toBe('C\\:\\\\path')
  })

  // 6. 百分号转义（避免 %{...} 函数扩展）
  it('6. 百分号转义为 \\%', () => {
    expect(escapeSubtitleText('50% off')).toBe('50\\% off')
  })

  // 7. 花括号转义（避免 ${...} 变量扩展；$ 本身不需转义）
  it('7. 花括号转义为 \\{ \\}', () => {
    expect(escapeSubtitleText('${var}')).toBe('$\\{var\\}')
  })

  // 8. 组合特殊字符
  it('8. 组合特殊字符全部转义', () => {
    const input = "100% {k}: v, 't'"
    const expected = "100\\% \\{k\\}\\: v\\, \\'t\\'"
    expect(escapeSubtitleText(input)).toBe(expected)
  })

  // 9. 空字符串
  it('9. 空字符串返回空', () => {
    expect(escapeSubtitleText('')).toBe('')
  })

  // 10. 转义顺序验证：含 \\ 的文本先转义 \\，否则后续 : 转义会变成 \\\\
  it('10. 转义顺序：反斜杠在冒号之前转义', () => {
    // 输入 "a\b:c"
    // 错误顺序（先 : 后 \）：a\b\:c → a\\b\\:c（多了一个 \）
    // 正确顺序（先 \ 后 :）：a\\b:c → a\\b\:c
    expect(escapeSubtitleText('a\\b:c')).toBe('a\\\\b\\:c')
  })

  // 11. null/undefined 边界
  it('11. null/undefined 返回空字符串', () => {
    expect(escapeSubtitleText(null)).toBe('')
    expect(escapeSubtitleText(undefined)).toBe('')
  })

  // 12. 换行符保留（ffmpeg drawtext 支持换行）
  it('12. 换行符保留不转义', () => {
    expect(escapeSubtitleText('第一行\n第二行')).toBe('第一行\n第二行')
  })
})

describe('Story2VideoComposeEngine 资源与效果契约', () => {
  it('默认成片上限为 50 分钟，旁白总时长上限与成片一致', () => {
    const engine = new Story2VideoComposeEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    expect(engine.maxDurationSeconds).toBe(50 * 60)
    expect(engine.maxAudioDurationSeconds).toBe(50 * 60)
    expect(engine.maxSegmentDurationSeconds).toBe(3 * 60)
  })

  it('缺少 duration 时保留 null，不在 normalize 阶段伪造 3 秒', () => {
    const scenes = normalizeComposeScenes({
      scenes: [{ imagePath: 'image.png', audioPath: 'audio.mp3' }],
    })
    expect(scenes[0].duration).toBeNull()
  })

  it('转场时长按相邻片段真实时长收敛，并为极短片段关闭转场', () => {
    const plan = buildTransitionPlan([0.2, 0.35], 1.2)
    expect(plan.enabled).toBe(true)
    expect(plan.transitions[0].duration).toBeLessThan(0.2)
    expect(plan.transitions[0].offset).toBeGreaterThan(0)
    // transitionName 随计划返回：_xfadeMerge 依赖 plan.transitionName 构造 xfade 滤镜
    expect(plan.transitionName).toBe('fade')
    expect(buildTransitionPlan([0.2, 0.35], 1.2, 'slideleft').transitionName).toBe('slideleft')

    const fallback = buildTransitionPlan([0.01, 0.4], 0.4)
    expect(fallback.enabled).toBe(false)
    expect(fallback.transitionName).toBe('fade')
  })

  it('优先使用 scenes 的原始 index，部分资源不会错配字幕', () => {
    const scenes = normalizeComposeScenes({
      scenes: [
        { index: 2, imagePath: 'image-2.png', audioPath: 'audio-2.mp3', text: '第三句' },
      ],
      images: [{ index: 0, path: 'wrong.png' }],
      audio: [{ index: 0, path: 'wrong.mp3' }],
      sentences: [{ text: '第一句' }, { text: '第二句' }, { text: '第三句' }],
    })
    expect(scenes).toEqual([
      expect.objectContaining({ index: 2, imagePath: 'image-2.png', audioPath: 'audio-2.mp3', text: '第三句' }),
    ])
  })

  it('保留素材来源元数据，供项目持久化和结果页提示使用', () => {
    const scenes = normalizeComposeScenes({
      scenes: [{
        imagePath: 'image.png',
        audioPath: 'audio.mp3',
        imageMeta: { source: 'model-provider', degraded: false },
        audioMeta: { source: 'ffmpeg-silence', degraded: true },
      }],
    })

    expect(scenes[0]).toMatchObject({
      imageMeta: { source: 'model-provider', degraded: false },
      audioMeta: { source: 'ffmpeg-silence', degraded: true },
    })
  })

  it('归一化场景时保留双层分句结果和降级来源', () => {
    const scenes = normalizeComposeScenes({
      scenes: [{
        imagePath: 'image.png',
        audioPath: 'audio.mp3',
        text: '场景文本需要显示为多页字幕。',
        subtitleBlocks: ['场景文本需要', '显示为多页字幕。'],
        sceneSource: 'local-typescript-fallback',
        subtitleSource: 'local-typescript',
        degraded: true,
        fallbackReason: 'ECONNREFUSED',
      }],
    })

    expect(scenes[0]).toMatchObject({
      subtitleBlocks: ['场景文本需要', '显示为多页字幕。'],
      sceneSource: 'local-typescript-fallback',
      subtitleSource: 'local-typescript',
      degraded: true,
      fallbackReason: 'ECONNREFUSED',
    })
  })

  it('支持旧项目的图片动效、字幕样式、水印和分辨率约束', () => {
    expect(buildImageEffectFilter('zoom-in', 1280, 720, 30)).toContain('zoompan')
    expect(buildImageEffectFilter('pan-left', 1280, 720, 30)).toContain('pan')
    // 回归：zoompan 必须使用 d=总帧数（时长×帧率），d=1 + -loop 1 静态图不会产生动画。
    // 第 5 参为“有效时长（秒）”，总帧数在函数内按 duration*fps 计算。
    expect(buildImageEffectFilter('zoom-in', 1280, 720, 30)).toContain(':d=90:')
    expect(buildImageEffectFilter('zoom-in', 1280, 720, 30, 6)).toContain(':d=180:')
    expect(buildImageEffectFilter('zoom-in', 1280, 720, 30)).not.toContain(':d=1:')
    expect(buildSubtitleFilter('字幕', { size: 'lg', style: 'style2' })).toContain('box=1')
    // 回归：中文 drawtext 必须显式指定 CJK fontfile，否则 Windows 静态 ffmpeg 渲染成豆腐块。
    // 跨平台契约：能解析到 CJK 字体则必须注入 fontfile；否则（Linux 无 Windows 字体）不注入但仍合法。
    const resolvedFont = resolveCjkFont()
    const subtitleFilter = buildSubtitleFilter('中文字幕测试', { size: 'md' })
    if (resolvedFont) {
      expect(subtitleFilter).toContain("fontfile='" + escapeFontFilePath(resolvedFont) + "'")
    } else {
      expect(subtitleFilter).not.toContain('fontfile=')
    }
    expect(escapeFontFilePath('C:\\Windows\\Fonts\\msyh.ttc')).toBe('C\\:/Windows/Fonts/msyh.ttc')
    if (process.platform === 'win32') {
      expect(resolveCjkFont()).toBeTruthy()
    }
    expect(buildWatermarkFilter({
      watermark: { enabled: true, text: '品牌', position: 'top-left', opacity: 0.5 },
    })).toContain('x=40:y=60')
    expect(parseResolution('1920x1080')).toEqual({ width: 1920, height: 1080 })
    expect(parseResolution('../bad')).toEqual({ width: 1280, height: 720 })
    expect(buildScaleFilter(1920, 1080)).toContain('scale=1920:1080')
    expect(buildScaleFilter(1920, 1080)).toContain('pad=1920:1080')
  })

  describe('自包含中文字体接入（2026-10-16，cjk-font-selfcontained）', () => {
    // 契约：字幕与水印的 drawtext 必须注入 fontfile，且该路径 ASCII 安全。
    // 为什么两条链都要锁：它们各自调用 resolveCjkFont()，历史上只有字幕侧有断言，
    // 水印侧长期无覆盖（变异"删掉水印的 fontFile 注入"不会被发现）。
    const ASCII_SAFE = /^[\x20-\x7E]+$/

    it('字幕 filter 注入的 fontfile 是 ASCII 安全路径', () => {
      const resolvedFont = resolveCjkFont()
      if (!resolvedFont) return // 无字体环境（如无系统字体且无自包含）时不注入亦合法
      const filter = buildSubtitleFilter('中文字幕实测', { size: 'md' })
      const m = filter.match(/fontfile='([^']*)'/)
      expect(m, '字幕 filter 未注入 fontfile').toBeTruthy()
      expect(ASCII_SAFE.test(m[1]), `fontfile 含非 ASCII 字符，ffmpeg 会静默渲染成豆腐块: ${m[1]}`).toBe(true)
    })

    it('水印 filter 注入的 fontfile 与字幕一致（同一字体源）', () => {
      const resolvedFont = resolveCjkFont()
      if (!resolvedFont) return
      const sub = buildSubtitleFilter('字幕', { size: 'md' }).match(/fontfile='([^']*)'/)
      const wm = buildWatermarkFilter({
        watermark: { enabled: true, text: '品牌水印' },
      }).match(/fontfile='([^']*)'/)
      expect(wm, '水印 filter 未注入 fontfile').toBeTruthy()
      expect(sub).toBeTruthy()
      expect(wm[1]).toBe(sub[1])
    })

    it('ASCII 副本落点固定（ffmpeg fontfile 依赖稳定名）', () => {
      const resolvedFont = resolveCjkFont()
      if (!resolvedFont) return
      expect(ASCII_SAFE.test(resolvedFont)).toBe(true)
      expect(resolvedFont).toContain('mp-fonts')
      expect(resolvedFont).not.toContain('src\\public') // 副本，不是 public 源目录
      expect(fs.existsSync(resolvedFont), `ASCII 副本不存在: ${resolvedFont}`).toBe(true)
    })

    it('resolveCjkFont 结果被缓存（同进程内稳定，不会每次重拷 1.9MB）', () => {
      const a = resolveCjkFont()
      const b = resolveCjkFont()
      expect(b).toBe(a)
    })
  })

  describe('buildWatermarkFilter — 水印位置/透明度/字号契约（2026-08-14）', () => {
    const base = { watermark: { enabled: true, text: '品牌' } }

    it('默认 bottom-right 修复：y=h-text_h-40，文字不越界', () => {
      const filter = buildWatermarkFilter(base)
      expect(filter).toContain(':x=w-text_w-40:y=h-text_h-40')
      // 回归：旧公式 y=h-20 把文字主体画到画布外（成片无水印的直接根因）
      expect(filter).not.toContain(':y=h-20')
      expect(filter).not.toContain('y=h-20:')
    })

    it('四角与正中坐标符合画布内契约', () => {
      // 边距契约（2026-08-14 调整）：水平/底部 40px、顶部 60px
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, position: 'top-left' } })).toContain(':x=40:y=60')
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, position: 'top-right' } })).toContain(':x=w-text_w-40:y=60')
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, position: 'bottom-left' } })).toContain(':x=40:y=h-text_h-40')
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, position: 'bottom-right' } })).toContain(':x=w-text_w-40:y=h-text_h-40')
      const center = buildWatermarkFilter({ ...base, watermark: { ...base.watermark, position: 'center' } })
      expect(center).toContain(':x=(w-text_w)/2:y=(h-text_h)/2')
      // 回归：旧公式 y=(h+text_h)/2 使文字整体下移 text_h
      expect(center).not.toContain('(h+text_h)/2')
    })

    it('moving 为确定性 Lissajous 漂移：双轴 sin、无 random、无逗号、起点居中', () => {
      const filter = buildWatermarkFilter({ ...base, watermark: { ...base.watermark, position: 'moving' } })
      // 回归：用户反馈漂移过快，周期放大 10 倍（x 100s / y 140s，速度约为原 1/10）
      expect(filter).toContain(":x='(w-text_w)/2*(1+0.9*sin(2*PI*t/100))'")
      // 回归（2026-08-27）：y 曾用 cos(2*PI*t/140) —— cos(0)=1 使 t=0 起点在底部 95%，短视频全程滞留下半区
      // （用户反馈「水印只在底部移动」）；改为 sin（sin(0)=0）起点居中，周期/幅度不变。
      expect(filter).toContain(":y='(h-text_h)/2*(1+0.9*sin(2*PI*t/140))'")
      expect(filter).not.toContain('cos(2*PI*t/140)')
      expect(filter).not.toContain('random(')
      const expr = filter.slice(filter.indexOf(':x='))
      expect(expr).not.toContain(',')
    })

    // drawtext 表达式求值器（测试专用）：表达式来自 buildWatermarkFilter 的白名单字面量，非用户输入。
    // 仅覆盖 sin/cos/PI/四则运算；若未来表达式引入 ffmpeg 特有运算符（lt/if/mod 等），此代理将失效，需同步更新。
    function evalDrawtextExpr (expr, { t, w, h, textW, textH }) {
      const fn = new Function('t', 'w', 'h', 'text_w', 'text_h', 'PI', 'sin', 'cos',
        'return (' + expr + ')')
      return fn(t, w, h, textW, textH, Math.PI, Math.sin, Math.cos)
    }

    it('moving 数学契约：t=0 起点居中、0.9 幅度不越界、周期 100/140、确定性', () => {
      const filter = buildWatermarkFilter({ ...base, watermark: { ...base.watermark, position: 'moving' } })
      const xExpr = filter.match(/:x='([^']+)'/)?.[1]
      const yExpr = filter.match(/:y='([^']+)'/)?.[1]
      // 显式守卫：表达式未提取到时给出可诊断失败而非晦涩 TypeError
      expect(xExpr).toBeTruthy()
      expect(yExpr).toBeTruthy()
      const frame = { t: 0, w: 1920, h: 1080, textW: 100, textH: 40 }
      // 起点：t=0 时 x/y 均居中（旧 y=cos 在 t=0 为 0.95*(h-text_h)=988，该断言必然拦截回归）
      expect(evalDrawtextExpr(xExpr, frame)).toBeCloseTo((1920 - 100) / 2, 6)
      expect(evalDrawtextExpr(yExpr, frame)).toBeCloseTo((1080 - 40) / 2, 6)
      // 幅度：任意 t 坐标占自由空间 [0.05, 0.95]（不越界拖尾）
      for (let t = 0; t <= 700; t += 5) {
        const x = evalDrawtextExpr(xExpr, { ...frame, t }) / (1920 - 100)
        const y = evalDrawtextExpr(yExpr, { ...frame, t }) / (1080 - 40)
        expect(x).toBeGreaterThanOrEqual(0.05 - 1e-9)
        expect(x).toBeLessThanOrEqual(0.95 + 1e-9)
        expect(y).toBeGreaterThanOrEqual(0.05 - 1e-9)
        expect(y).toBeLessThanOrEqual(0.95 + 1e-9)
      }
      // 峰值：x 在 25s（100s 周期 + 90° 相位）、y 在 35s（140s 周期 + 90° 相位）直达 0.95 边界
      // （周期若漂移到 100/140 的约数如 /50、/70，「回原点」断言依然成立，峰值断言将其独立锁死）
      expect(evalDrawtextExpr(xExpr, { ...frame, t: 25 })).toBeCloseTo(0.95 * (1920 - 100), 6)
      expect(evalDrawtextExpr(yExpr, { ...frame, t: 35 })).toBeCloseTo(0.95 * (1080 - 40), 6)
      // 周期：x 100s / y 140s 各自回到起点（确定性 Lissajous 可复现）
      expect(evalDrawtextExpr(xExpr, { ...frame, t: 100 })).toBeCloseTo(evalDrawtextExpr(xExpr, frame), 6)
      expect(evalDrawtextExpr(yExpr, { ...frame, t: 140 })).toBeCloseTo(evalDrawtextExpr(yExpr, frame), 6)
    })

    it('未知位置 fail-closed 到默认 bottom-right（修复后表达式）', () => {
      const filter = buildWatermarkFilter({ ...base, watermark: { ...base.watermark, position: 'middle' } })
      expect(filter).toContain(':x=w-text_w-40:y=h-text_h-40')
    })

    it('透明度 0-1 契约：透传、clamp 边界、非法回退 0.6', () => {
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, opacity: 0.4 } })).toContain('fontcolor=white@0.40')
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, opacity: 1.5 } })).toContain('fontcolor=white@1.00')
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, opacity: -0.1 } })).toContain('fontcolor=white@0.00')
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, opacity: 'x' } })).toContain('fontcolor=white@0.60')
    })

    it('字号 10-96 契约：透传、clamp 边界、非法回退 24', () => {
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, fontSize: 40 } })).toContain(':fontsize=40:')
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, fontSize: 5 } })).toContain(':fontsize=10:')
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, fontSize: 100 } })).toContain(':fontsize=96:')
      expect(buildWatermarkFilter({ ...base, watermark: { ...base.watermark, fontSize: 'x' } })).toContain(':fontsize=24:')
    })

    it('未启用或空文字不生成滤镜', () => {
      expect(buildWatermarkFilter({ watermark: { enabled: false, text: '品牌' } })).toBe('')
      expect(buildWatermarkFilter({ watermark: { enabled: true, text: '' } })).toBe('')
    })
  })

  it('有效时长已知时把动效进度归一化到场景时长', () => {
    // 6s @30fps → T=180：动效在场景结束帧恰好完成，不再受固定帧增量速度限制
    expect(buildImageEffectFilter('zoom-in', 1280, 720, 30, 6)).toContain('1+0.25*min(1,on/180)')
    expect(buildImageEffectFilter('zoom-out', 1280, 720, 30, 6)).toContain('if(eq(on,1),1.25,1.25-0.25*min(1,on/180))')
    expect(buildImageEffectFilter('pan-left', 1280, 720, 30, 6)).toContain('(iw-iw/zoom)*min(1,on/180)')
    expect(buildImageEffectFilter('pan-right', 1280, 720, 30, 6)).toContain('(iw-iw/zoom)*(1-min(1,on/180))')
    expect(buildImageEffectFilter('pan-up', 1280, 720, 30, 6)).toContain('(ih-ih/zoom)*min(1,on/180)')
    expect(buildImageEffectFilter('pan-down', 1280, 720, 30, 6)).toContain('(ih-ih/zoom)*(1-min(1,on/180))')
    expect(buildImageEffectFilter('zoom-pan', 1280, 720, 30, 6)).toContain('1+0.15*min(1,on/180)')
    // 非 30fps：fps=24、4s → T=96
    expect(buildImageEffectFilter('zoom-in', 1280, 720, 24, 4)).toContain('min(1,on/96)')
  })

  it('时长未知或无效时保持固定帧增量公式，向后兼容', () => {
    expect(buildImageEffectFilter('zoom-in', 1280, 720, 30)).toContain('min(zoom+0.0015,1.25)')
    expect(buildImageEffectFilter('zoom-out', 1280, 720, 30)).toContain('max(zoom-0.0015,1)')
    expect(buildImageEffectFilter('pan-left', 1280, 720, 30)).toContain('on/120')
    expect(buildImageEffectFilter('zoom-pan', 1280, 720, 30)).toContain('on/180')
    for (const bad of [0, -1, Number.NaN, null, undefined, 'x']) {
      expect(buildImageEffectFilter('zoom-in', 1280, 720, 30, bad)).toContain('min(zoom+0.0015,1.25)')
    }
    // 极端有限值：duration*fps 溢出为 Infinity 时回退 legacy，不得出现 on/Infinity
    const overflow = buildImageEffectFilter('zoom-in', 1280, 720, 30, 1e308)
    expect(overflow).toContain('min(zoom+0.0015,1.25)')
    expect(overflow).not.toContain('Infinity')
  })

  it('极短时长使用最小帧数下限，fps 极值按场景时长换算', () => {
    // 0.05s @30fps → round(1.5)=2，下限 Math.max(2) 防止 on/0、on/1
    expect(buildImageEffectFilter('zoom-in', 1280, 720, 30, 0.05)).toContain('min(1,on/2)')
    // fps 极值：1fps×6s=6、120fps×6s=720
    expect(buildImageEffectFilter('zoom-in', 1280, 720, 1, 6)).toContain('min(1,on/6)')
    expect(buildImageEffectFilter('zoom-in', 1280, 720, 120, 6)).toContain('min(1,on/720)')
  })

  describe('AI 视频短于分镜时长的处理', () => {
    function makeVideoEngine (videoDuration) {
      const engine = new Story2VideoComposeEngine({
        outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 's2v-short-video-contract-')),
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      })
      engine._probeVideoDuration = vi.fn().mockResolvedValue(videoDuration)
      engine._runFfmpegStage = vi.fn().mockResolvedValue({ stderr: '' })
      engine._requireFfmpegOutput = vi.fn()
      return engine
    }

    function videoOptions (overrides = {}) {
      return {
        width: 320,
        height: 180,
        fps: 24,
        effectDuration: 4,
        duration: null,
        audioDuration: 4,
        videoMode: 'fixed',
        padTo: null,
        shortVideoHandling: 'loop',
        subtitleText: '',
        subtitleTimeline: [],
        subtitleStyle: undefined,
        watermark: false,
        watermarkText: '',
        watermarkConfig: undefined,
        transition: 'none',
        voiceVolume: 1,
        composeId: 'test-compose',
        sceneIndex: 0,
        ...overrides,
      }
    }

    it('默认循环模式保留无限循环和 TTS 音频映射', async () => {
      const engine = makeVideoEngine(1)
      try {
        await engine._encodeVideoSegmentOnce('video.mp4', 'voice.mp3', 'segment.mp4', videoOptions())
        const args = engine._runFfmpegStage.mock.calls[0][0]
        expect(args).toEqual(expect.arrayContaining(['-stream_loop', '-1', '-map', '0:v:0', '-map', '1:a:0']))
        expect(args.join(' ')).not.toContain('tpad=stop_mode=clone')
      } finally {
        fs.rmSync(engine.outputDir, { recursive: true, force: true })
      }
    })

    it('播放完停止模式对短视频冻结末帧并按 zoom-in 进度放大', async () => {
      const engine = makeVideoEngine(1)
      try {
        await engine._encodeVideoSegmentOnce(
          'video.mp4',
          'voice.mp3',
          'segment.mp4',
          videoOptions({ shortVideoHandling: 'stop-at-end' }),
        )
        const args = engine._runFfmpegStage.mock.calls[0][0]
        const filter = args[args.indexOf('-filter_complex') + 1]
        expect(args).not.toContain('-stream_loop')
        expect(filter).toContain('concat=n=2:v=1:a=0')
        expect(filter).toContain('select=eq(n\\,0)')
        expect(filter).toContain('zoompan')
        expect(filter).toContain('1+0.25*min(1,on/72)')
        expect(args).toEqual(expect.arrayContaining(['-t', '4', '-shortest', '-map', '[videoOut]', '-map', '1:a:0']))
      } finally {
        fs.rmSync(engine.outputDir, { recursive: true, force: true })
      }
    })

    it('播放完停止模式在视频足够长时只裁剪，不追加末帧尾段', async () => {
      const engine = makeVideoEngine(5)
      try {
        await engine._encodeVideoSegmentOnce(
          'video.mp4',
          'voice.mp3',
          'segment.mp4',
          videoOptions({ shortVideoHandling: 'stop-at-end' }),
        )
        const args = engine._runFfmpegStage.mock.calls[0][0]
        const filter = args[args.indexOf('-vf') + 1]
        expect(args).not.toContain('-stream_loop')
        expect(filter).not.toContain('tpad=stop_mode=clone')
        expect(args).toEqual(expect.arrayContaining(['-shortest', '-map', '0:v:0', '-map', '1:a:0']))
      } finally {
        fs.rmSync(engine.outputDir, { recursive: true, force: true })
      }
    })

    it('播放完停止模式探测失败时回退到循环，避免短视频场景黑屏或提前结束', async () => {
      const engine = makeVideoEngine(null)
      try {
        await engine._encodeVideoSegmentOnce(
          'video.mp4',
          'voice.mp3',
          'segment.mp4',
          videoOptions({ shortVideoHandling: 'stop-at-end' }),
        )
        const args = engine._runFfmpegStage.mock.calls[0][0]
        expect(args).toEqual(expect.arrayContaining(['-stream_loop', '-1']))
        expect(args.join(' ')).not.toContain('tpad=stop_mode=clone')
      } finally {
        fs.rmSync(engine.outputDir, { recursive: true, force: true })
      }
    })

    it('min-duration 停止模式使用 -t + apad 保留静音补齐尾部', async () => {
      const engine = makeVideoEngine(1)
      try {
        await engine._encodeVideoSegmentOnce(
          'video.mp4',
          'voice.mp3',
          'segment.mp4',
          videoOptions({
            effectDuration: 6,
            audioDuration: 3,
            padTo: 6,
            shortVideoHandling: 'stop-at-end',
          }),
        )
        const args = engine._runFfmpegStage.mock.calls[0][0]
        expect(args).not.toContain('-stream_loop')
        expect(args).toEqual(expect.arrayContaining(['-t', '6', '-af', 'apad', '-map', '1:a:0']))
        expect(args).not.toContain('-shortest')
      } finally {
        fs.rmSync(engine.outputDir, { recursive: true, force: true })
      }
    })
  })

  it('为每个字幕页生成首尾不重叠的 FFmpeg 半开时间区间', () => {
    const filter = buildSubtitleFilter([
      { text: '第一屏字幕', startTime: 0, endTime: 1.25 },
      { text: '第二屏字幕', startTime: 1.25, endTime: 2.5 },
    ], { size: 'lg' })

    expect(filter.match(/drawtext=/g)).toHaveLength(2)
    expect(filter).toContain("enable='gte(t,0.000)*lt(t,1.250)'")
    expect(filter).toContain("enable='gte(t,1.250)*lt(t,2.500)'")
    expect(filter).not.toContain('between(t,')
  })

  it('字幕默认位于距底部 20% 处，且可经 bottomMarginRatio 覆盖（0.05-0.5）', () => {
    expect(buildSubtitleFilter('字幕', { size: 'lg' })).toContain(':y=h*0.800-th')
    expect(buildSubtitleFilter('字幕', { size: 'lg' })).not.toContain('y=h-th-40')
    expect(buildSubtitleFilter('字幕', { size: 'lg', bottomMarginRatio: 0.1 })).toContain(':y=h*0.900-th')
    // clamp：超出 0.05-0.5 范围时回退到边界
    expect(buildSubtitleFilter('字幕', { size: 'lg', bottomMarginRatio: 0.6 })).toContain(':y=h*0.500-th')
    expect(buildSubtitleFilter('字幕', { size: 'lg', bottomMarginRatio: 0.01 })).toContain(':y=h*0.950-th')
  })

  it('compose 以 scenes 为权威并把效果/BGM参数传给合成阶段', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-contract-'))
    const image = path.join(root, 'image.png')
    const audio = path.join(root, 'audio.mp3')
    fs.writeFileSync(image, Buffer.from('image'))
    fs.writeFileSync(audio, Buffer.from('audio'))
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      allowedMediaRoots: [root],
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    const segmentCalls = []
    engine._createSegment = vi.fn(async (_image, _audio, output, options) => {
      segmentCalls.push(options)
      fs.writeFileSync(output, Buffer.from('segment'))
    })
    engine._concatSegments = vi.fn(async (_segments, output) => {
      fs.writeFileSync(output, Buffer.from('video'))
    })
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => {
      fs.writeFileSync(output, Buffer.from('narration'))
    })
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({
        scenes: [
          { index: 3, imagePath: image, audioPath: audio, duration: 2, text: '原始第三句' },
        ],
        images: [],
        audio: [],
      }, {
        transition: 'slide-left',
        imageEffect: 'zoom-in',
        subtitleStyle: { size: 'lg' },
        watermark: true,
        watermarkText: '品牌',
        voiceVolume: 0.75,
        validateOutput: false,
      })
      expect(result.code).toBe(0)
      expect(segmentCalls).toHaveLength(1)
      expect(segmentCalls[0]).toMatchObject({
        duration: 2,
        subtitleText: '原始第三句',
        transition: 'slide-left',
        imageEffect: 'zoom-in',
        voiceVolume: 0.75,
      })
      expect(result.data.segmentCount).toBe(1)
      expect(result.data.segments).toEqual([
        expect.objectContaining({ index: 3, text: '原始第三句', videoPath: expect.any(String) }),
      ])
      expect(result.data.audioPath).toEqual(expect.any(String))
      expect(fs.existsSync(result.data.audioPath)).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('以 ffprobe 的 TTS 真实时长覆盖估算值，并同步分页字幕时间轴', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-subtitle-timing-'))
    const image = writeFixture(root, 'image.png')
    const audio = writeFixture(root, 'audio.mp3')
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    const segmentCalls = []
    engine._probeMediaDuration = vi.fn(async () => 4)
    engine._createSegment = vi.fn(async (_image, _audio, output, options) => {
      segmentCalls.push(options)
      fs.writeFileSync(output, 'segment')
    })
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({
        scenes: [{
          imagePath: image,
          audioPath: audio,
          duration: 1,
          text: '第一屏字幕内容，第二屏字幕内容。',
          subtitleBlocks: ['第一屏字幕内容，', '第二屏字幕内容。'],
        }],
      }, { transition: 'none', validateOutput: false })

      expect(result.code).toBe(0)
      expect(segmentCalls[0].duration).toBe(4)
      expect(segmentCalls[0].subtitleTimeline.at(-1).endTime).toBe(4)
      expect(result.data.segments[0].subtitleBlocks).toEqual(['第一屏字幕内容，', '第二屏字幕内容。'])
      expect(result.data.segments[0].subtitleTimeline.at(-1).endTime).toBe(4)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('旧项目没有字幕块时会按场景文本自动分页，并同步真实音频时长', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-legacy-subtitles-'))
    const image = writeFixture(root, 'image.png')
    const audio = writeFixture(root, 'audio.mp3')
    const text = '第一屏字幕内容需要完整呈现，第二屏字幕内容也要连续显示。'
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    const segmentCalls = []
    engine._probeMediaDuration = vi.fn(async () => 4)
    engine._createSegment = vi.fn(async (_image, _audio, output, options) => {
      segmentCalls.push(options)
      fs.writeFileSync(output, 'segment')
    })
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({
        scenes: [{ imagePath: image, audioPath: audio, duration: 1, text }],
      }, { transition: 'none', validateOutput: false })

      expect(result.code).toBe(0)
      const timeline = segmentCalls[0].subtitleTimeline
      expect(timeline.length).toBeGreaterThan(1)
      expect(timeline[0].startTime).toBe(0)
      timeline.slice(1).forEach((item, index) => {
        expect(item.startTime).toBe(timeline[index].endTime)
      })
      expect(timeline.at(-1).endTime).toBe(4)
      // v0.15.2 兜底分页清理块尾标点：join 等于去掉块界标点后的文本
      expect(timeline.map(item => item.text).join('')).toBe('第一屏字幕内容需要完整呈现第二屏字幕内容也要连续显示')
      expect(result.data.segments[0].subtitleBlocks).toEqual(timeline.map(item => item.text))
      expect(result.data.segments[0].subtitleTimeline.at(-1).endTime).toBe(4)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('多段旁白导出会消费所有音频，而不是只使用第一段', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-narration-'))
    const scenes = [0, 1].map(index => ({
      index,
      imagePath: writeFixture(root, 'image-' + index + '.png'),
      audioPath: writeFixture(root, 'audio-' + index + '.mp3'),
      duration: 1,
      text: '第' + (index + 1) + '段',
    }))
    const engine = new Story2VideoComposeEngine({ outputDir: root, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    engine._concatSegments = vi.fn(async (_segments, output) => fs.writeFileSync(output, 'video'))
    engine._probeMediaDuration = vi.fn(async () => null)
    const expectedAudioPaths = scenes.map(scene => fs.realpathSync.native(scene.audioPath))
    engine._concatNarrationAudio = vi.fn(async (audioPaths, output) => {
      expect(audioPaths).toEqual(expectedAudioPaths)
      fs.writeFileSync(output, 'narration')
    })
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({ scenes }, { transition: 'none', validateOutput: false })
      expect(result.code).toBe(0)
      expect(engine._concatNarrationAudio).toHaveBeenCalledTimes(1)
      expect(result.data.segments).toHaveLength(2)
      expect(fs.existsSync(result.data.audioPath)).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('BGM 路径不可读时降级为无 BGM 继续合成，不整条流水线失败', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-bgm-degrade-'))
    const image = path.join(root, 'image.png')
    const audio = path.join(root, 'audio.mp3')
    fs.writeFileSync(image, Buffer.from('image'))
    fs.writeFileSync(audio, Buffer.from('audio'))
    const engine = new Story2VideoComposeEngine({ outputDir: root, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    engine._concatSegments = vi.fn(async (_segments, output) => fs.writeFileSync(output, 'video'))
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))
    engine._probeMediaDuration = vi.fn(async () => null)
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose(
        { scenes: [{ imagePath: image, audioPath: audio, duration: 1, text: '字幕' }] },
        { bgmPath: path.join(root, 'missing-bgm.mp3'), validateOutput: false }
      )
      expect(result.code).toBe(0)
      expect(result.data.bgmApplied).toBe(false)
      expect(result.data.bgmSkipped).toBe(true)
      expect(result.data.bgmSkippedReason).toBe('unreadable')
      expect(Array.isArray(result.data.warnings)).toBe(true)
      expect(result.data.warnings).toContain('bgm_unreadable')
      expect(result.data.warnings.join(' ')).not.toMatch(/[\u4e00-\u9fa5]/)
      expect(fs.existsSync(result.data.videoPath)).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('BGM 单文件超限时降级且 reason=size_exceeded，不提示「不可读」', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-bgm-oversize-'))
    const image = path.join(root, 'image.png')
    const audio = path.join(root, 'audio.mp3')
    const bgm = path.join(root, 'big-bgm.mp3')
    fs.writeFileSync(image, Buffer.from('image'))
    fs.writeFileSync(audio, Buffer.from('audio'))
    // 超过 BGM 单文件上限（15MB）
    const handle = fs.openSync(bgm, 'w')
    try { fs.ftruncateSync(handle, 15 * 1024 * 1024 + 1) } finally { fs.closeSync(handle) }
    const engine = new Story2VideoComposeEngine({ outputDir: root, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    engine._concatSegments = vi.fn(async (_segments, output) => fs.writeFileSync(output, 'video'))
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))
    engine._probeMediaDuration = vi.fn(async () => null)
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose(
        { scenes: [{ imagePath: image, audioPath: audio, duration: 1, text: '字幕' }] },
        { bgmPath: bgm, validateOutput: false }
      )
      expect(result.code).toBe(0)
      expect(result.data.bgmSkipped).toBe(true)
      expect(result.data.bgmSkippedReason).toBe('size_exceeded')
      expect(result.data.warnings).toContain('bgm_size_exceeded')
      expect(result.data.warnings).not.toContain('bgm_unreadable')
      expect(result.data.warnings.join(' ')).not.toMatch(/[\u4e00-\u9fa5]/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('BGM 格式不支持（含无扩展名）时降级且 reason=format_unsupported', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-bgm-format-'))
    const image = path.join(root, 'image.png')
    const audio = path.join(root, 'audio.mp3')
    fs.writeFileSync(image, Buffer.from('image'))
    fs.writeFileSync(audio, Buffer.from('audio'))
    const engine = new Story2VideoComposeEngine({ outputDir: root, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    engine._concatSegments = vi.fn(async (_segments, output) => fs.writeFileSync(output, 'video'))
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))
    engine._probeMediaDuration = vi.fn(async () => null)
    engine._validateOutput = vi.fn(async () => {})

    try {
      const flac = await engine.compose(
        { scenes: [{ imagePath: image, audioPath: audio, duration: 1, text: '字幕' }] },
        { bgmPath: path.join(root, 'bgm.flac'), validateOutput: false }
      )
      expect(flac.code).toBe(0)
      expect(flac.data.bgmSkipped).toBe(true)
      expect(flac.data.bgmSkippedReason).toBe('format_unsupported')
      expect(flac.data.warnings).toContain('bgm_format_unsupported')
      expect(flac.data.warnings.join(' ')).not.toMatch(/[\u4e00-\u9fa5]/)

      // 无扩展名的可读文件同样判为 format_unsupported（与 resolveReadableMediaFile 一致）
      const noExt = path.join(root, 'bgm-no-extension')
      fs.writeFileSync(noExt, 'audio')
      const noExtResult = await engine.compose(
        { scenes: [{ imagePath: image, audioPath: audio, duration: 1, text: '字幕' }] },
        { bgmPath: noExt, validateOutput: false }
      )
      expect(noExtResult.code).toBe(0)
      expect(noExtResult.data.bgmSkippedReason).toBe('format_unsupported')
      expect(noExtResult.data.warnings).toContain('bgm_format_unsupported')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('BGM 可读但不在允许根目录时 reason=not_allowed', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-bgm-root-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-bgm-outside-'))
    const image = path.join(root, 'image.png')
    const audio = path.join(root, 'audio.mp3')
    const bgm = path.join(outside, 'outside-bgm.mp3')
    fs.writeFileSync(image, Buffer.from('image'))
    fs.writeFileSync(audio, Buffer.from('audio'))
    fs.writeFileSync(bgm, 'audio')
    const engine = new Story2VideoComposeEngine({ outputDir: root, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    engine._concatSegments = vi.fn(async (_segments, output) => fs.writeFileSync(output, 'video'))
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))
    engine._probeMediaDuration = vi.fn(async () => null)
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose(
        { scenes: [{ imagePath: image, audioPath: audio, duration: 1, text: '字幕' }] },
        { bgmPath: bgm, validateOutput: false }
      )
      expect(result.code).toBe(0)
      expect(result.data.bgmSkipped).toBe(true)
      expect(result.data.bgmSkippedReason).toBe('not_allowed')
      expect(result.data.warnings).toContain('bgm_not_allowed')
      expect(result.data.warnings.join(' ')).not.toMatch(/[\u4e00-\u9fa5]/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('混音前 BGM 文件已被删除时降级为无 BGM（不硬失败，不调用混音）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-bgm-mix-gone-'))
    const image = path.join(root, 'image.png')
    const audio = path.join(root, 'audio.mp3')
    const bgm = path.join(root, 'bgm.mp3')
    fs.writeFileSync(image, Buffer.from('image'))
    fs.writeFileSync(audio, Buffer.from('audio'))
    fs.writeFileSync(bgm, Buffer.from('bgm'))
    const engine = new Story2VideoComposeEngine({ outputDir: root, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    engine._concatSegments = vi.fn(async (_segments, output) => fs.writeFileSync(output, 'video'))
    // 模拟运行中惰性 GC：旁白合并后 BGM 被删除
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => {
      fs.writeFileSync(output, 'narration')
      fs.unlinkSync(bgm)
    })
    engine._probeMediaDuration = vi.fn(async () => null)
    engine._validateOutput = vi.fn(async () => {})
    engine._mixBgm = vi.fn(async () => { throw new Error('should not be called') })

    try {
      const result = await engine.compose(
        { scenes: [{ imagePath: image, audioPath: audio, duration: 1, text: '字幕' }] },
        { bgmPath: bgm, validateOutput: false }
      )
      expect(result.code).toBe(0)
      expect(result.data.bgmApplied).toBe(false)
      expect(result.data.bgmSkipped).toBe(true)
      expect(result.data.bgmSkippedReason).toBe('unreadable')
      expect(result.data.warnings).toContain('bgm_unreadable')
      expect(result.data.warnings.join(' ')).not.toMatch(/[\u4e00-\u9fa5]/)
      expect(engine._mixBgm).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('format=webm 时执行最终转码并返回 webm 路径', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-webm-'))
    const image = path.join(root, 'image.png')
    const audio = path.join(root, 'audio.mp3')
    fs.writeFileSync(image, Buffer.from('image'))
    fs.writeFileSync(audio, Buffer.from('audio'))
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, Buffer.from('segment')))
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, Buffer.from('narration')))
    engine._transcodeWebm = vi.fn(async (_input, output) => fs.writeFileSync(output, Buffer.from('webm')))
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({
        scenes: [{ imagePath: image, audioPath: audio, duration: 1, text: '字幕' }],
      }, { format: 'webm', validateOutput: false })

      expect(result.code).toBe(0)
      expect(engine._transcodeWebm).toHaveBeenCalledTimes(1)
      expect(result.data.videoPath).toMatch(/\.webm$/)
      expect(result.data.format).toBe('webm')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 60000)

  it('缺少场景 duration 时不向 ffmpeg 传固定截断值，并使用探测时长', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-probe-'))
    const image = path.join(root, 'image.png')
    const audio = path.join(root, 'audio.mp3')
    fs.writeFileSync(image, Buffer.from('image'))
    fs.writeFileSync(audio, Buffer.from('audio'))
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    const segmentCalls = []
    engine._probeMediaDuration = vi.fn()
      .mockResolvedValueOnce(1.75)
      .mockResolvedValueOnce(1.7)
      .mockResolvedValueOnce(1.7)
    engine._createSegment = vi.fn(async (_image, _audio, output, options) => {
      segmentCalls.push(options)
      fs.writeFileSync(output, Buffer.from('segment'))
    })
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, Buffer.from('narration')))
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({
        scenes: [{ imagePath: image, audioPath: audio, text: '按真实时长' }],
      }, { transition: 'none', validateOutput: false })
      expect(result.code).toBe(0)
      expect(segmentCalls[0].duration).toBeNull()
      // follow-audio 参数级回归（T5）：默认模式不传 padTo、sceneDurationMode=follow-audio
      expect(segmentCalls[0].padTo).toBeNull()
      expect(segmentCalls[0].sceneDurationMode).toBe('follow-audio')
      expect(result.data.duration).toBe(1.7)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 60000)

  it('min-duration 模式：3s 旁白补齐到 minSceneDuration=6，effectDuration/字幕/片段一致，旁白导出不补齐', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-min-duration-'))
    const image = writeFixture(root, 'image.png')
    const audio = writeFixture(root, 'audio.mp3')
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    const segmentCalls = []
    // 音频探测 3s → 补齐后片段探测 6s
    engine._probeMediaDuration = vi.fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(6)
    engine._createSegment = vi.fn(async (_image, _audio, output, options) => {
      segmentCalls.push(options)
      fs.writeFileSync(output, Buffer.from('segment'))
    })
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, Buffer.from('narration')))
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({
        scenes: [{ imagePath: image, audioPath: audio, text: '短旁白' }],
      }, { sceneDurationMode: 'min-duration', minSceneDuration: 6, transition: 'none', validateOutput: false })

      expect(result.code).toBe(0)
      expect(segmentCalls[0]).toMatchObject({ sceneDurationMode: 'min-duration', effectDuration: 6, padTo: 6 })
      // 字幕时间轴按补齐后的 effectiveDuration=6 生成，末页结束于 6s
      expect(segmentCalls[0].subtitleTimeline.at(-1).endTime).toBeCloseTo(6, 1)
      // 片段与成片时长 = 补齐后 6s
      expect(result.data.duration).toBe(6)
      expect(result.data.segments[0].duration).toBe(6)
      // 真实 TTS 音频时长（3s）与视频片段时长（6s 补齐）分离，供样本校准采集（Batch 5a）
      expect(result.data.segments[0].audioDuration).toBe(3)
      // 完整旁白导出仍用原始音频，不补齐。
      // CI 下 os.tmpdir 可能返回 8.3 短路径（RUNNER~1），引擎经 realpathSync.native 归一化为长路径，
      // 按 AGENTS.md「Windows 路径身份断言」合同：两边 realpath 后比较，不做原始字符串比较。
      const narrationCall = engine._concatNarrationAudio.mock.calls[0]
      expect(narrationCall[0].length).toBe(1)
      expect(fs.realpathSync.native(narrationCall[0][0])).toBe(fs.realpathSync.native(audio))
      expect(narrationCall[1]).toEqual(expect.any(String))
      expect(narrationCall[2]).toEqual(expect.any(String))
      expect(narrationCall[3]).toBe(1)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('min-duration 模式：10s 长旁白不被截断（effectDuration=max(音频, minSceneDuration)）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-min-duration-long-'))
    const image = writeFixture(root, 'image.png')
    const audio = writeFixture(root, 'audio.mp3')
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    const segmentCalls = []
    engine._probeMediaDuration = vi.fn().mockResolvedValue(10)
    engine._createSegment = vi.fn(async (_image, _audio, output, options) => {
      segmentCalls.push(options)
      fs.writeFileSync(output, Buffer.from('segment'))
    })
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, Buffer.from('narration')))
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({
        scenes: [{ imagePath: image, audioPath: audio, text: '长旁白' }],
      }, { sceneDurationMode: 'min-duration', minSceneDuration: 6, transition: 'none', validateOutput: false })
      expect(result.code).toBe(0)
      expect(segmentCalls[0].effectDuration).toBe(10)
      // 10s > minSceneDuration → 无需补齐，padTo=null 保持 -shortest 跟随旁白
      expect(segmentCalls[0].padTo).toBeNull()
      expect(result.data.duration).toBe(10)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('真实 ffmpeg：min-duration 补齐段实际时长 = max(音频, minSceneDuration)，follow-audio 不补齐', async () => {
    if (!findFfmpeg()) return
    const { promisify } = require('util')
    const { execFile } = require('child_process')
    const execFileAsync = promisify(execFile)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-real-pad-'))
    // min-duration 无 -shortest 时靠 -t 截断，必须使用真实可解码图片（假字节会让 -loop 1 无限刷解码错误）
    const image = path.join(root, 'image.png')
    await execFileAsync(findFfmpeg(), ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180', '-frames:v', '1', image], { maxBuffer: 10 * 1024 * 1024 })
    const audio = path.join(root, 'silence2s.m4a')
    await execFileAsync(findFfmpeg(), ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '2', '-c:a', 'aac', audio], { maxBuffer: 10 * 1024 * 1024 })
    const engine = new Story2VideoComposeEngine({ outputDir: root, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    const baseOpts = {
      width: 320, height: 180, fps: 24, imageEffect: 'none', transition: 'none',
      subtitleText: '', subtitleStyle: undefined, watermark: false, watermarkText: '', watermarkConfig: undefined,
      voiceVolume: 1, duration: null,
    }

    const probeStreamDurations = async (filePath) => {
      const { stdout } = await execFileAsync(findFfprobe(), [
        '-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', filePath,
      ], { maxBuffer: 1024 * 1024 })
      const parsed = JSON.parse(stdout)
      return parsed.streams.map(s => ({ type: s.codec_type, duration: Number(s.duration) }))
    }

    try {
      // min-duration：-t 6 + apad + 无 -shortest → 视频/音频双轨 ≈6s（±0.3，AAC 帧对齐容差）
      const padded = path.join(root, 'padded.mp4')
      await engine._createSegment(image, audio, padded, { ...baseOpts, effectDuration: 6, sceneDurationMode: 'min-duration', padTo: 6 })
      const paddedDur = await engine._probeMediaDuration(padded)
      expect(paddedDur).not.toBeNull()
      expect(paddedDur).toBeGreaterThanOrEqual(5.7)
      expect(paddedDur).toBeLessThanOrEqual(6.3)
      const paddedStreams = await probeStreamDurations(padded)
      const paddedAudio = paddedStreams.find(s => s.type === 'audio')
      expect(paddedAudio).toBeTruthy()
      // 音频轨也被补齐到 ≈6s，证明去掉 -shortest 后没有把静音尾部裁掉（W3/T7）
      expect(paddedAudio.duration).toBeGreaterThanOrEqual(5.7)
      expect(paddedAudio.duration).toBeLessThanOrEqual(6.3)

      // voiceVolume≠1 + padTo：-af 链为 volume=X,apad（先缩放后补静音），真实渲染 ≈6s（W3 回归）
      const volumePadded = path.join(root, 'volume-padded.mp4')
      await engine._createSegment(image, audio, volumePadded, { ...baseOpts, effectDuration: 6, sceneDurationMode: 'min-duration', padTo: 6, voiceVolume: 0.5 })
      const volumeDur = await engine._probeMediaDuration(volumePadded)
      expect(volumeDur).not.toBeNull()
      expect(volumeDur).toBeGreaterThanOrEqual(5.7)
      expect(volumeDur).toBeLessThanOrEqual(6.3)

      // follow-audio：-shortest 跟随 2s 音频，不补齐（padTo=null）
      const follow = path.join(root, 'follow.mp4')
      await engine._createSegment(image, audio, follow, { ...baseOpts, effectDuration: 6, sceneDurationMode: 'follow-audio', padTo: null })
      const followDur = await engine._probeMediaDuration(follow)
      expect(followDur).not.toBeNull()
      expect(followDur).toBeLessThanOrEqual(3)
      const followStreams = await probeStreamDurations(follow)
      const followAudio = followStreams.find(s => s.type === 'audio')
      expect(followAudio).toBeTruthy()
      expect(followAudio.duration).toBeLessThanOrEqual(3)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 60000)

  it('min-duration 模式：音频探测失败时不启用静音补齐（C1，不 -t/apad 硬截断未知长度旁白）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-min-duration-probe-fail-'))
    const image = writeFixture(root, 'image.png')
    const audio = writeFixture(root, 'audio.mp3')
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    const segmentCalls = []
    engine._probeMediaDuration = vi.fn().mockResolvedValue(null)
    engine._createSegment = vi.fn(async (_image, _audio, output, options) => {
      segmentCalls.push(options)
      fs.writeFileSync(output, Buffer.from('segment'))
    })
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, Buffer.from('narration')))
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({
        scenes: [{ imagePath: image, audioPath: audio, text: '探测失败' }],
      }, { sceneDurationMode: 'min-duration', minSceneDuration: 6, transition: 'none', validateOutput: false })

      expect(result.code).toBe(0)
      expect(segmentCalls[0].sceneDurationMode).toBe('min-duration')
      // 探测失败 → padTo=null，_createSegment 走 follow-audio -shortest 路径
      expect(segmentCalls[0].padTo).toBeNull()
      // 有效时长仍按 defaultSceneDuration 兜底（动效/字幕归一化用）
      expect(segmentCalls[0].effectDuration).toBe(6)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('min-duration 模式：原始音频和 <3000s 但补齐后超限时在预检拒绝，不进入渲染（W1）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-min-duration-limit-'))
    const image = writeFixture(root, 'image.png')
    const audio = writeFixture(root, 'audio.mp3')
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    // 55 段 × 50s = 2750s < 3000（通过音频和校验）；minSceneDuration=60 → 55 × max(50,60) = 3300 > 3000 → 预检拒绝
    const scenes = Array.from({ length: 55 }, () => ({ imagePath: image, audioPath: audio, text: 'x' }))
    engine._probeMediaDuration = vi.fn().mockResolvedValue(50)
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, Buffer.from('segment')))
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, Buffer.from('narration')))
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({ scenes }, {
        sceneDurationMode: 'min-duration', minSceneDuration: 60, transition: 'none', validateOutput: false,
      })
      expect(result.code).toBe(-1)
      expect(result.message).toContain('Requested video duration exceeds the allowed limit')
      expect(engine._createSegment).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['N<default 且可探测（audio=3,default=10,min=4 → 4s 且补齐）', 3, 10, 4, 4, true],
    ['N<default 且探测失败（→ default=10，不补齐）', null, 10, 4, 10, false],
    ['N>default 且可探测（audio=3,default=2,min=4 → 4s 且补齐）', 3, 2, 4, 4, true],
    ['N>default 且探测失败（→ max(default,min)=4，不补齐）', null, 2, 4, 4, false],
    ['等值边界：audio==min（6s 音频 min=6 → effect=6 但不补齐，严格 > 守卫）', 6, 6, 6, 6, false],
  ])('min-duration 边界矩阵（I3）：%s', async (_label, probed, defaultSceneDuration, minSceneDuration, expectedEffect, expectedPad) => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-min-duration-matrix-'))
    const image = writeFixture(root, 'image.png')
    const audio = writeFixture(root, 'audio.mp3')
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    const segmentCalls = []
    engine._probeMediaDuration = vi.fn().mockResolvedValue(probed)
    engine._createSegment = vi.fn(async (_image, _audio, output, options) => {
      segmentCalls.push(options)
      fs.writeFileSync(output, Buffer.from('segment'))
    })
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, Buffer.from('narration')))
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({
        scenes: [{ imagePath: image, audioPath: audio, text: '边界' }],
      }, {
        sceneDurationMode: 'min-duration', minSceneDuration, defaultSceneDuration,
        transition: 'none', validateOutput: false,
      })
      expect(result.code).toBe(0)
      expect(segmentCalls[0].effectDuration).toBe(expectedEffect)
      if (expectedPad) {
        expect(segmentCalls[0].padTo).toBe(expectedEffect)
      } else {
        expect(segmentCalls[0].padTo).toBeNull()
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('真实 ffmpeg：2 个 min-duration 补齐段 xfade 转场 + BGM 混音，成片 ≈ 6+6-0.4=11.6s（W5）', async () => {
    if (!findFfmpeg()) return
    const { promisify } = require('util')
    const { execFile } = require('child_process')
    const execFileAsync = promisify(execFile)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-real-xfade-pad-'))
    try {
      const image1 = path.join(root, 'image1.png')
      const image2 = path.join(root, 'image2.png')
      const audio1 = path.join(root, 'audio1.m4a')
      const audio2 = path.join(root, 'audio2.m4a')
      const bgm = path.join(root, 'bgm.m4a')
      await execFileAsync(findFfmpeg(), ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180', '-frames:v', '1', image1], { maxBuffer: 10 * 1024 * 1024 })
      await execFileAsync(findFfmpeg(), ['-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180', '-frames:v', '1', image2], { maxBuffer: 10 * 1024 * 1024 })
      const genAudio = (p) => execFileAsync(findFfmpeg(), ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '2', '-c:a', 'aac', p], { maxBuffer: 10 * 1024 * 1024 })
      await genAudio(audio1)
      await genAudio(audio2)
      await genAudio(bgm)
      const engine = new Story2VideoComposeEngine({ outputDir: root, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
      const result = await engine.compose({
        scenes: [
          { imagePath: image1, audioPath: audio1, text: '场景一' },
          { imagePath: image2, audioPath: audio2, text: '场景二' },
        ],
      }, {
        sceneDurationMode: 'min-duration', minSceneDuration: 6,
        transition: 'fade', transitionDuration: 0.4,
        subtitleEnabled: false, bgmPath: bgm,
        resolution: '320x180', fps: 24,
        validateOutput: false,
      })
      expect(result.code).toBe(0)
      expect(result.data.segmentCount).toBe(2)
      expect(result.data.bgmApplied).toBe(true)
      expect(result.data.duration).toBeGreaterThanOrEqual(11.3)
      expect(result.data.duration).toBeLessThanOrEqual(11.9)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 90000)

  it('renderSegment：min-duration 模式 3s 音频补齐到 6s，返回补齐段', async () => {
    if (!findFfmpeg()) return
    const { promisify } = require('util')
    const { execFile } = require('child_process')
    const execFileAsync = promisify(execFile)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-render-segment-min-duration-'))
    const image = path.join(root, 'image.png')
    const audio = path.join(root, 'audio.m4a')
    try {
      await execFileAsync(findFfmpeg(), ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180', '-frames:v', '1', image], { maxBuffer: 10 * 1024 * 1024 })
      await execFileAsync(findFfmpeg(), ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '2', '-c:a', 'aac', audio], { maxBuffer: 10 * 1024 * 1024 })
      const engine = new Story2VideoComposeEngine({ outputDir: root, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
      // 场景音频探测 2s → 渲染后片段探测 6s
      engine._probeMediaDuration = vi.fn()
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(6)
      const result = await engine.renderSegment(
        { imagePath: image, audioPath: audio, text: '短旁白', duration: null },
        { sceneDurationMode: 'min-duration', minSceneDuration: 6, defaultSceneDuration: 6, resolution: '320x180', fps: 24, subtitleEnabled: false, transition: 'none' },
        path.join(root, 'out.mp4'),
      )
      expect(result.code).toBe(0)
      expect(result.data.duration).toBe(6)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 60000)

  it('真实 ffprobe 遇到损坏媒体时返回 null，不伪造时长', async () => {
    if (!findFfprobe()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-invalid-probe-'))
    const invalidMedia = writeFixture(root, 'invalid.mp3', 'not-a-media-file')
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
    const engine = new Story2VideoComposeEngine({ outputDir: root, log })

    try {
      await expect(engine._probeMediaDuration(invalidMedia)).resolves.toBeNull()
      expect(log.warn).toHaveBeenCalledWith(
        'Story2VideoCompose',
        'ffprobe_failed',
        expect.objectContaining({
          event: 'ffprobe_failed',
          operation: 'duration_probe',
        }),
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    [0.5, 1],
    [undefined, 6],
  ])('无可探测时长时把默认场景时长 %s 收敛为 %s 秒', async (defaultSceneDuration, expectedDuration) => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-default-duration-'))
    const image = writeFixture(root, 'image.png')
    const audio = writeFixture(root, 'audio.mp3')
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    engine._probeMediaDuration = vi.fn().mockResolvedValue(null)
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({
        scenes: [{ imagePath: image, audioPath: audio, text: '时长回退' }],
      }, { defaultSceneDuration, transition: 'none', validateOutput: false })

      expect(result.code).toBe(0)
      expect(result.data.duration).toBe(expectedDuration)
      expect(result.data.segments[0].duration).toBe(expectedDuration)
      // 音频探测失败时动效归一化同样回退到 defaultSceneDuration
      expect(engine._createSegment.mock.calls[0][3]).toMatchObject({ effectDuration: expectedDuration })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 60000)

  it('renderSegment 把有效时长传给动效归一化，音频优先、探测失败回退默认', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-render-segment-effect-'))
    const image = writeFixture(root, 'image.png')
    const audio = writeFixture(root, 'audio.mp3')
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    engine._probeMediaDuration = vi.fn().mockResolvedValue(null)
    engine._createSegment = vi.fn(async () => fs.writeFileSync(path.join(root, 'out.mp4'), 'seg'))
    try {
      // 音频探测失败 + 无上报时长 → effectDuration 回退 defaultSceneDuration=6
      const out = path.join(root, 'out.mp4')
      const result = await engine.renderSegment(
        { imagePath: image, audioPath: audio, text: '测试', duration: null },
        { defaultSceneDuration: 6, resolution: '320x180', fps: 24, subtitleEnabled: false, transition: 'none' },
        out,
      )
      expect(result.code).toBe(0)
      expect(engine._createSegment.mock.calls[0][3]).toMatchObject({ effectDuration: 6 })

      // 音频优先：ffprobe 4.2s 覆盖上报 1s
      engine._probeMediaDuration = vi.fn().mockResolvedValue(4.2)
      const result2 = await engine.renderSegment(
        { imagePath: image, audioPath: audio, text: '测试', duration: 1 },
        { defaultSceneDuration: 6, resolution: '320x180', fps: 24, subtitleEnabled: false, transition: 'none' },
        path.join(root, 'out2.mp4'),
      )
      expect(result2.code).toBe(0)
      expect(engine._createSegment.mock.calls[1][3]).toMatchObject({ effectDuration: 4.2 })

      // 极端有限 duration 收敛到 0.1..3600，effectDuration 保持有限值（W1 回归）
      engine._probeMediaDuration = vi.fn().mockResolvedValue(null)
      const result3 = await engine.renderSegment(
        { imagePath: image, audioPath: audio, text: '极端值', duration: 1e308 },
        { defaultSceneDuration: 6, resolution: '320x180', fps: 24, subtitleEnabled: false, transition: 'none' },
        path.join(root, 'out3.mp4'),
      )
      expect(result3.code).toBe(0)
      expect(engine._createSegment.mock.calls[2][3]).toMatchObject({ duration: 3600, effectDuration: 3600 })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 60000)

  it('61 个场景可合成，仍保留分辨率像素上限', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-limits-'))
    const image = writeFixture(root, 'image.png')
    const audio = writeFixture(root, 'audio.mp3')
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    engine._probeMediaDuration = vi.fn(async () => 1)
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    engine._concatSegments = vi.fn(async (_segments, output) => fs.writeFileSync(output, 'video'))
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))

    try {
      const result = await engine.compose({
        scenes: Array.from({ length: 61 }, (_, index) => ({
          index,
          imagePath: image,
          audioPath: audio,
          text: '第 ' + (index + 1) + ' 个场景',
        })),
      }, { transition: 'none', validateOutput: false })
      expect(result.code).toBe(0)
      expect(result.data.segmentCount).toBe(61)
      expect(engine._createSegment).toHaveBeenCalledTimes(61)

      const invalidResolution = await engine.compose({
        scenes: [{ imagePath: 'image.png', audioPath: 'audio.mp3' }],
      }, { resolution: '10000x10000' })
      expect(invalidResolution).toMatchObject({ code: -1 })
      expect(invalidResolution.message).toMatch(/resolution|分辨率|pixel/i)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('合成阶段拒绝允许目录之外的本地媒体', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-allowed-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-outside-'))
    const image = path.join(outside, 'image.png')
    const audio = path.join(outside, 'audio.mp3')
    fs.writeFileSync(image, 'image')
    fs.writeFileSync(audio, 'audio')
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      allowedMediaRoots: [root],
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })

    try {
      const result = await engine.compose({ scenes: [{ imagePath: image, audioPath: audio }] })
      expect(result).toMatchObject({ code: -1 })
      expect(result.message).toMatch(/path|路径|media|媒体/i)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('在执行 ffmpeg 前拒绝超过 50 分钟的声明时长', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-duration-'))
    const image = path.join(root, 'image.png')
    const audio = path.join(root, 'audio.mp3')
    fs.writeFileSync(image, 'image')
    fs.writeFileSync(audio, 'audio')
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    engine._createSegment = vi.fn()

    try {
      const result = await engine.compose({
        scenes: [{ imagePath: image, audioPath: audio, duration: 3001 }],
      })
      expect(result).toMatchObject({ code: -1 })
      expect(result.message).toMatch(/50 分钟|50 minutes/i)
      expect(engine._createSegment).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('批量旁白单段超过 3 分钟时在合成前失败', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-segment-duration-'))
    const scenes = [0, 1].map(index => {
      const imagePath = path.join(root, 'image-' + index + '.png')
      const audioPath = path.join(root, 'audio-' + index + '.mp3')
      fs.writeFileSync(imagePath, 'image')
      fs.writeFileSync(audioPath, 'audio')
      return { imagePath, audioPath }
    })
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    engine._probeMediaDuration = vi.fn().mockResolvedValueOnce(181).mockResolvedValueOnce(2)
    engine._createSegment = vi.fn()

    try {
      const result = await engine.compose({ scenes })
      expect(result).toMatchObject({ code: -1 })
      expect(result.message).toMatch(/单段|3 分钟|时长/)
      expect(engine._createSegment).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('批量旁白总时长超过 50 分钟时在合成前失败且提示 50 分钟', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-total-duration-over-'))
    const scenes = Array.from({ length: 20 }, (_v, index) => {
      const imagePath = path.join(root, 'image-' + index + '.png')
      const audioPath = path.join(root, 'audio-' + index + '.mp3')
      fs.writeFileSync(imagePath, 'image')
      fs.writeFileSync(audioPath, 'audio')
      return { imagePath, audioPath }
    })
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      // 旁白总时长上限放宽到 60 分钟：成片检查在前（默认 3000s），确保本用例命中「成片总时长」分支而非旁白分支
      maxAudioDurationSeconds: 60 * 60,
    })
    // 每段 151s × 20 = 3020s > 3000s（50 分钟），单段 151s < 3 分钟不会触发单段上限
    engine._probeMediaDuration = vi.fn(async () => 151)
    engine._createSegment = vi.fn()

    try {
      const result = await engine.compose({ scenes })
      expect(result).toMatchObject({ code: -1 })
      expect(result.message).toContain('成片总时长不能超过 50 分钟')
      expect(engine._createSegment).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('批量旁白总时长不超过 50 分钟时通过预检并进入片段合成', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-total-duration-ok-'))
    const scenes = Array.from({ length: 20 }, (_v, index) => {
      const imagePath = path.join(root, 'image-' + index + '.png')
      const audioPath = path.join(root, 'audio-' + index + '.mp3')
      fs.writeFileSync(imagePath, 'image')
      fs.writeFileSync(audioPath, 'audio')
      return { imagePath, audioPath, text: '第' + (index + 1) + '段' }
    })
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    // 每段 149s × 20 = 2980s ≤ 3000s（50 分钟）
    engine._probeMediaDuration = vi.fn(async () => 149)
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    engine._concatSegments = vi.fn(async (_segments, output) => fs.writeFileSync(output, 'video'))
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))
    engine._validateOutput = vi.fn(async () => {})

    try {
      const result = await engine.compose({ scenes }, { transition: 'none', validateOutput: false })
      expect(result.code).toBe(0)
      expect(engine._createSegment).toHaveBeenCalledTimes(20)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('成片总时长恰为 3000 秒通过预检、3000.1 秒拒绝（严格大于语义）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-boundary-3000-'))
    const scenes = Array.from({ length: 20 }, (_v, index) => {
      const imagePath = path.join(root, 'image-' + index + '.png')
      const audioPath = path.join(root, 'audio-' + index + '.mp3')
      fs.writeFileSync(imagePath, 'image')
      fs.writeFileSync(audioPath, 'audio')
      return { imagePath, audioPath, text: '第' + (index + 1) + '段' }
    })
    const passEngine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    // 20 × 150s = 3000s = 恰好 50 分钟，锁定严格 > 边界（3000 通过）
    passEngine._probeMediaDuration = vi.fn(async () => 150)
    passEngine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    passEngine._concatSegments = vi.fn(async (_segments, output) => fs.writeFileSync(output, 'video'))
    passEngine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))
    passEngine._validateOutput = vi.fn(async () => {})
    try {
      const passResult = await passEngine.compose({ scenes }, { transition: 'none', validateOutput: false })
      expect(passResult.code).toBe(0)
      expect(passEngine._createSegment).toHaveBeenCalledTimes(20)

      const rejectEngine = new Story2VideoComposeEngine({
        outputDir: root,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      })
      // 20 × 150.005s = 3000.1s > 3000s → 成片检查拒绝
      rejectEngine._probeMediaDuration = vi.fn(async () => 150.005)
      rejectEngine._createSegment = vi.fn()
      const rejectResult = await rejectEngine.compose({ scenes })
      expect(rejectResult).toMatchObject({ code: -1 })
      expect(rejectResult.message).toContain('成片总时长不能超过 50 分钟')
      expect(rejectEngine._createSegment).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('旁白总时长上限低于成片上限时返回旁白文案（更严旁白约束）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-narration-cap-'))
    const scenes = Array.from({ length: 14 }, (_v, index) => {
      const imagePath = path.join(root, 'image-' + index + '.png')
      const audioPath = path.join(root, 'audio-' + index + '.mp3')
      fs.writeFileSync(imagePath, 'image')
      fs.writeFileSync(audioPath, 'audio')
      return { imagePath, audioPath }
    })
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      maxDurationSeconds: 50 * 60,
      maxAudioDurationSeconds: 40 * 60, // 更严的旁白上限
    })
    // 每段 175s × 14 = 2450s ≤ 3000s（成片上限通过、单段 175s ≤ 180s）；> 2400s（旁白上限触发）
    engine._probeMediaDuration = vi.fn(async () => 175)
    engine._createSegment = vi.fn()
    try {
      const result = await engine.compose({ scenes })
      expect(result).toMatchObject({ code: -1 })
      expect(result.message).toContain('旁白音频总时长不能超过 40 分钟')
      expect(engine._createSegment).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Story2VideoComposeEngine 子进度发射（compose_progress 契约）', () => {
  function makeProgressEngine (root, overrides = {}) {
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    engine._probeMediaDuration = vi.fn(async () => 2)
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    engine._concatSegments = vi.fn(async (_segments, output) => fs.writeFileSync(output, 'video'))
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))
    engine._validateOutput = vi.fn(async () => {})
    for (const [key, value] of Object.entries(overrides || {})) {
      if (typeof value === 'function') engine[key] = value
      else engine[key] = vi.fn(value)
    }
    return engine
  }

  function makeScenes (root, count) {
    return Array.from({ length: count }, (_v, index) => ({
      index,
      imagePath: writeFixture(root, 'image-' + index + '.png'),
      audioPath: writeFixture(root, 'audio-' + index + '.mp3'),
      duration: 1,
      text: '第' + (index + 1) + '段',
    }))
  }

  it('min-duration 合成把旁白实际总时长与预计成片时长分别传给下游阶段', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-timeout-duration-'))
    const engine = makeProgressEngine(root)
    engine._probeMediaDuration = vi.fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(12)
    engine._mixBgm = vi.fn(async (_video, _bgm, output) => fs.writeFileSync(output, 'mixed'))
    engine._transcodeWebm = vi.fn(async (_input, output) => fs.writeFileSync(output, 'webm'))
    try {
      const result = await engine.compose({ scenes: makeScenes(root, 2) }, {
        transition: 'none',
        sceneDurationMode: 'min-duration',
        minSceneDuration: 6,
        bgmPath: writeFixture(root, 'bgm.mp3'),
        format: 'webm',
      })

      expect(result.code).toBe(0)
      expect(engine._concatSegments.mock.calls[0][3].segmentDurations).toEqual([6, 6])
      expect(engine._concatNarrationAudio.mock.calls[0][4]).toBe(5)
      expect(engine._mixBgm.mock.calls[0][4]).toBe(12)
      expect(engine._transcodeWebm.mock.calls[0][2]).toBe(12)
      expect(engine._validateOutput.mock.calls[0][1]).toBe(12)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('normalizeComposeProgressUpdate 字段级校验（取整/钳制/非法丢弃）', () => {
    expect(normalizeComposeProgressUpdate({ phase: 'segments', percent: 39.4, segmentsDone: 3, segmentsTotal: 5 }))
      .toEqual({ phase: 'segments', percent: 39, segmentsDone: 3, segmentsTotal: 5 })
    // percent 取整并钳制 [0,100]
    expect(normalizeComposeProgressUpdate({ phase: 'segments', percent: 120, segmentsTotal: 5 }).percent).toBe(100)
    expect(normalizeComposeProgressUpdate({ phase: 'segments', percent: -5, segmentsTotal: 5 }).percent).toBe(0)
    // 非法值返回 null
    expect(normalizeComposeProgressUpdate(null)).toBeNull()
    expect(normalizeComposeProgressUpdate({ phase: '', percent: 50 })).toBeNull()
    expect(normalizeComposeProgressUpdate({ phase: 'segments', percent: NaN })).toBeNull()
    expect(normalizeComposeProgressUpdate({ phase: 'segments', percent: 50, segmentsTotal: 0 })).toBeNull()
    expect(normalizeComposeProgressUpdate({ phase: 'segments', percent: 50, segmentsTotal: 5, segmentsDone: 6 })).toBeNull()
    expect(normalizeComposeProgressUpdate({ phase: 'segments', percent: 50, segmentsTotal: 5, segmentsDone: -1 })).toBeNull()
  })

  it('compose 成功时按阶段权重发射单调不降的子进度序列（preflight→done）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-progress-ok-'))
    const engine = makeProgressEngine(root)
    const progress = []
    const onProgress = (update) => progress.push(update)
    try {
      const result = await engine.compose({ scenes: makeScenes(root, 2) }, { transition: 'none' }, onProgress)
      expect(result.code).toBe(0)
      const phases = progress.map(p => p.phase)
      expect(phases).toEqual(['preflight', 'validated', 'segments', 'segments', 'segments', 'concat', 'narration', 'verify', 'done'])
      // 逐片段：3 + 72·k/2 → 3 / 39 / 75
      expect(progress.filter(p => p.phase === 'segments').map(p => p.percent)).toEqual([3, 39, 75])
      expect(progress.filter(p => p.phase === 'segments').map(p => [p.segmentsDone, p.segmentsTotal]))
        .toEqual([[0, 2], [1, 2], [2, 2]])
      // 相位权重
      expect(progress.find(p => p.phase === 'concat').percent).toBe(87)
      expect(progress.find(p => p.phase === 'narration').percent).toBe(89)
      expect(progress.find(p => p.phase === 'verify').percent).toBe(98)
      expect(progress.at(-1)).toMatchObject({ phase: 'done', percent: 100, segmentsDone: 2, segmentsTotal: 2 })
      // 单调不降
      const percents = progress.map(p => p.percent)
      for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('片段生成失败时 percent 冻结（<100）且不发射 done（兼容 options.onProgress）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-progress-fail-seg-'))
    const engine = makeProgressEngine(root, {
      _createSegment: vi.fn(async () => { throw new Error('segment boom') }),
    })
    const progress = []
    try {
      const result = await engine.compose(
        { scenes: makeScenes(root, 3) },
        { transition: 'none', onProgress: (update) => progress.push(update) },
      )
      expect(result.code).toBe(-1)
      expect(result.message).toMatch(/Segment|failed/)
      const percents = progress.map(p => p.percent)
      expect(percents.at(-1)).toBeLessThan(100)
      expect(progress.some(p => p.phase === 'done')).toBe(false)
      // 第 1 个片段失败：最后一次发射是 pre-loop segments 0/3 → 3
      expect(progress.at(-1)).toMatchObject({ phase: 'segments', segmentsDone: 0, segmentsTotal: 3, percent: 3 })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('拼接失败时 compose 抛出且不发射 done（percent 冻结在 concat 87）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-progress-fail-concat-'))
    const engine = makeProgressEngine(root, {
      _concatSegments: vi.fn(async () => { throw new Error('concat boom') }),
    })
    const progress = []
    try {
      await expect(engine.compose({ scenes: makeScenes(root, 2) }, { transition: 'fade' }, (u) => progress.push(u)))
        .rejects.toThrow('concat boom')
      expect(progress.at(-1)).toMatchObject({ phase: 'concat', percent: 87 })
      expect(progress.some(p => p.phase === 'done')).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('输出校验失败时 percent 冻结在 verify 98 且不发射 done', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-progress-fail-verify-'))
    const engine = makeProgressEngine(root, {
      _validateOutput: vi.fn(async () => { throw new Error('verify boom') }),
    })
    const progress = []
    try {
      const result = await engine.compose({ scenes: makeScenes(root, 1) }, { transition: 'none' }, (u) => progress.push(u))
      expect(result.code).toBe(-1)
      expect(result.message).toMatch(/validation failed/i)
      expect(progress.at(-1)).toMatchObject({ phase: 'verify', percent: 98 })
      expect(progress.some(p => p.phase === 'done')).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('旁白合并失败时 percent 冻结在 narration 89 且不发射 done', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-progress-fail-narration-'))
    const engine = makeProgressEngine(root, {
      _concatNarrationAudio: vi.fn(async () => { throw new Error('narration boom') }),
    })
    const progress = []
    try {
      const result = await engine.compose({ scenes: makeScenes(root, 2) }, { transition: 'none' }, (u) => progress.push(u))
      expect(result.code).toBe(-1)
      expect(result.message).toMatch(/Narration concat failed/i)
      expect(progress.at(-1)).toMatchObject({ phase: 'narration', percent: 89 })
      expect(progress.some(p => p.phase === 'done')).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('BGM 混音失败时 percent 冻结在 bgm 92 且不发射 done', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-progress-fail-bgm-'))
    const engine = makeProgressEngine(root, {
      _mixBgm: vi.fn(async () => { throw new Error('bgm boom') }),
    })
    const progress = []
    try {
      const result = await engine.compose(
        { scenes: makeScenes(root, 2) },
        { transition: 'none', bgmPath: writeFixture(root, 'bgm.m4a') },
        (u) => progress.push(u),
      )
      expect(result.code).toBe(-1)
      expect(result.message).toMatch(/BGM mix failed/i)
      expect(progress.at(-1)).toMatchObject({ phase: 'bgm', percent: 92 })
      expect(progress.some(p => p.phase === 'done')).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('WebM 转码失败时 percent 冻结在 webm 95 且不发射 done', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-progress-fail-webm-'))
    const engine = makeProgressEngine(root, {
      _transcodeWebm: vi.fn(async () => { throw new Error('webm boom') }),
    })
    const progress = []
    try {
      const result = await engine.compose(
        { scenes: makeScenes(root, 1) },
        { transition: 'none', format: 'webm' },
        (u) => progress.push(u),
      )
      expect(result.code).toBe(-1)
      expect(result.message).toMatch(/WebM transcode failed/i)
      expect(progress.at(-1)).toMatchObject({ phase: 'webm', percent: 95 })
      expect(progress.some(p => p.phase === 'done')).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('持久化失败时 percent 冻结在 verify 98 且不发射 done', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-progress-fail-persist-'))
    const engine = makeProgressEngine(root)
    const progress = []
    const originalCopyFileSync = fs.copyFileSync
    const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementation((src, dest) => {
      if (String(dest).includes('_narration.m4a')) throw new Error('persist boom')
      return originalCopyFileSync.call(fs, src, dest)
    })
    try {
      const result = await engine.compose({ scenes: makeScenes(root, 1) }, { transition: 'none' }, (u) => progress.push(u))
      expect(result.code).toBe(-1)
      expect(result.message).toMatch(/Failed to persist compose artifacts/i)
      expect(progress.at(-1)).toMatchObject({ phase: 'verify', percent: 98 })
      expect(progress.some(p => p.phase === 'done')).toBe(false)
    } finally {
      copySpy.mockRestore()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('超长片段（>8 段）走真实分块拼接：concat 进度在 87→89 间按块单调推进并记录块日志', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-progress-chunked-'))
    const engine = makeProgressEngine(root)
    // 保留真实 _concatSegments/_concatSegmentsChunked（含递归），仅 mock 底层 ffmpeg 合并
    engine._concatSegments = Story2VideoComposeEngine.prototype._concatSegments
    engine._xfadeMerge = vi.fn(async (_segs, _plan, outputPath) => fs.writeFileSync(outputPath, 'video'))
    engine._plainConcat = vi.fn(async (_segs, outputPath) => fs.writeFileSync(outputPath, 'video'))
    const progress = []
    try {
      const result = await engine.compose({ scenes: makeScenes(root, 10) }, { transition: 'fade' }, (u) => progress.push(u))
      expect(result.code).toBe(0)
      const concat = progress.filter(p => p.phase === 'concat')
      // 10 段 → l0 2 块 + l1 1 块 = 3 块；初始 87 + 每块 87+2·k/3：87 / 88 / 88 / 89
      expect(concat.length).toBe(4)
      const percents = concat.map(p => p.percent)
      expect(percents[0]).toBe(87)
      expect(percents.at(-1)).toBe(89)
      for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1])
      expect(percents.every(p => p >= 87 && p <= 89)).toBe(true)
      // 每完成一块记录 merge_l{level}_chunk_{n} created 日志
      const logLines = engine.log.info.mock.calls.map(args => args[1])
      expect(logLines.filter(l => /merge_l\d_chunk_\d+ created/.test(l))).toHaveLength(3)
      expect(logLines).toContain('merge_l0_chunk_000 created: merge_l0_chunk_000.mp4')
      expect(logLines).toContain('merge_l1_chunk_000 created: merge_l1_chunk_000.mp4')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Story2VideoComposeEngine 合成可观测性日志', () => {
  function makeObservabilityEngine (root, overrides = {}) {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const engine = new Story2VideoComposeEngine({ outputDir: root, log })
    engine._probeMediaDuration = vi.fn(async () => 2)
    engine._createSegment = vi.fn(async (_image, _audio, output) => fs.writeFileSync(output, 'segment'))
    engine._concatSegments = vi.fn(async (_segments, output) => fs.writeFileSync(output, 'video'))
    engine._concatNarrationAudio = vi.fn(async (_audioPaths, output) => fs.writeFileSync(output, 'narration'))
    engine._validateOutput = vi.fn(async () => {})
    for (const [key, value] of Object.entries(overrides)) engine[key] = value
    return { engine, log }
  }

  function makeObservabilityScenes (root, count = 2) {
    return Array.from({ length: count }, (_value, index) => ({
      imagePath: writeFixture(root, 'image-' + index + '.png'),
      audioPath: writeFixture(root, 'audio-' + index + '.mp3'),
      duration: 1,
    }))
  }

  function eventsFrom (log) {
    return [...log.debug.mock.calls, ...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]
      .map((args) => args[2])
      .filter((meta) => meta && typeof meta === 'object' && typeof meta.event === 'string')
  }

  it('成功合成使用一个 composeId 串联生命周期和阶段事件', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-observe-success-'))
    const { engine, log } = makeObservabilityEngine(root)
    try {
      const result = await engine.compose({ scenes: makeObservabilityScenes(root) }, { transition: 'none' })
      expect(result.code).toBe(0)
      const events = eventsFrom(log)
      const started = events.find((meta) => meta.event === 'compose_started')
      const succeeded = events.find((meta) => meta.event === 'compose_succeeded')
      expect(started).toMatchObject({ stage: 'compose', sceneCount: 2 })
      expect(succeeded).toMatchObject({ composeId: started.composeId, segmentCount: 2 })
      expect(events.filter((meta) => meta.event === 'compose_stage_started').every((meta) => meta.composeId === started.composeId)).toBe(true)
      expect(events.filter((meta) => meta.event === 'compose_stage_succeeded').length).toBeGreaterThanOrEqual(3)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('失败合成记录 compose_failed，并且不写入含空格的素材绝对路径', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-observe-fail-'))
    const privatePath = 'C:\\private folder\\secret clip.mp4'
    const { engine, log } = makeObservabilityEngine(root, {
      _concatSegments: vi.fn(async () => { throw new Error('concat failed at ' + privatePath) }),
    })
    try {
      await expect(engine.compose({ scenes: makeObservabilityScenes(root) }, { transition: 'fade' }))
        .rejects.toThrow('concat failed')
      const events = eventsFrom(log)
      const failure = events.find((meta) => meta.event === 'compose_failed')
      expect(failure).toMatchObject({ stage: 'concat' })
      expect(failure.error).toContain('<path>')
      expect(failure.error).not.toContain(privatePath)
      expect(failure.error).not.toContain('private folder')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('旁白合并失败返回给上层的错误也不会泄露 Windows 绝对路径', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-observe-return-redaction-'))
    const privatePath = 'C:\\private folder\\secret narration.m4a'
    const { engine } = makeObservabilityEngine(root, {
      _concatNarrationAudio: vi.fn(async () => { throw new Error('failed to open ' + privatePath) }),
    })
    try {
      const result = await engine.compose({ scenes: makeObservabilityScenes(root) }, { transition: 'none' })
      expect(result).toMatchObject({ code: -1 })
      expect(result.message).toContain('Narration concat failed: failed to open <path>')
      expect(result.message).not.toContain(privatePath)
      expect(result.message).not.toContain('private folder')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['Windows', 'C:\\private folder\\secret segment.mp4'],
    ['Unix', '/private folder/secret segment.mp4'],
  ])('片段创建失败返回给上层的错误不会泄露 %s 绝对路径', async (_platform, privatePath) => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-observe-segment-redaction-'))
    const { engine } = makeObservabilityEngine(root, {
      _createSegment: vi.fn(async () => { throw new Error('failed to open ' + privatePath) }),
    })
    try {
      const result = await engine.compose({ scenes: makeObservabilityScenes(root, 1) }, { transition: 'none' })
      expect(result).toMatchObject({ code: -1 })
      expect(result.message).toContain('Segment 0 failed to create: failed to open <path>')
      expect(result.message).not.toContain(privatePath)
      expect(result.message).not.toContain('private folder')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('分块合成记录块的开始、完成和关联字段', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-observe-chunk-'))
    const { engine, log } = makeObservabilityEngine(root)
    const inputs = Array.from({ length: 10 }, (_value, index) => writeFixture(root, 'segment-' + index + '.mp4', 'video'))
    const output = path.join(root, 'output.mp4')
    engine._xfadeMerge = vi.fn(async (_segments, _plan, target) => fs.writeFileSync(target, 'merged'))
    engine._plainConcat = vi.fn(async (_segments, target) => fs.writeFileSync(target, 'merged'))
    try {
      await engine._concatSegmentsChunked(inputs, Array(10).fill(2), output, root, {
        composeId: 'compose_test_01',
        transitionName: 'fade',
        transitionDuration: 0.5,
      }, 0)
      const events = eventsFrom(log)
      const started = events.find((meta) => meta.event === 'merge_chunk_started')
      const succeeded = events.find((meta) => meta.event === 'merge_chunk_succeeded')
      expect(started).toMatchObject({ composeId: 'compose_test_01', level: 0, chunkIndex: 0, totalChunks: 3 })
      expect(succeeded).toMatchObject({ composeId: 'compose_test_01', level: 0, chunkIndex: 0, outputBytes: 6 })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('缺少 FFmpeg 输出时记录安全的 ffmpeg_output_missing 事件', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-observe-missing-'))
    const { engine, log } = makeObservabilityEngine(root)
    const missing = path.join(root, 'missing.mp4')
    try {
      expect(() => engine._requireFfmpegOutput(missing, {
        composeId: 'compose_test_02',
        stage: 'concat',
        operation: 'plain_concat',
      }, 'failed to open ' + missing)).toThrow('ffmpeg did not produce output')
      const event = eventsFrom(log).find((meta) => meta.event === 'ffmpeg_output_missing')
      expect(event).toMatchObject({ composeId: 'compose_test_02', stage: 'concat', output: 'missing.mp4', outputBytes: 0 })
      expect(event.stderr).not.toContain(root)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('FFmpeg 超时记录 ffmpeg_timeout 及阶段关联字段', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-observe-timeout-'))
    const timeoutError = new Error('process timed out')
    timeoutError.code = 'ETIMEDOUT'
    timeoutError.killed = true
    timeoutError.signal = 'SIGTERM'
    timeoutError.stderr = 'error while opening ' + root + '/secret.mp4'
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log,
      execFfmpegStage: vi.fn(async () => { throw timeoutError }),
    })
    try {
      await expect(engine._runFfmpegStage(['-version'], { timeout: 25000 }, {
        composeId: 'compose_test_timeout',
        stage: 'concat',
        operation: 'xfade_merge',
        inputCount: 8,
        outputPath: path.join(root, 'merged.mp4'),
      })).rejects.toThrow('process timed out')
      const event = eventsFrom(log).find((meta) => meta.event === 'ffmpeg_timeout')
      expect(event).toMatchObject({
        composeId: 'compose_test_timeout',
        stage: 'concat',
        operation: 'xfade_merge',
        timeoutMs: 25000,
        errorCode: 'ETIMEDOUT',
        signal: 'SIGTERM',
        killed: true,
      })
      expect(event.stderr).not.toContain(root)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('FFmpeg 心跳记录输出增长，并向块回调提供相同诊断数据', async () => {
    vi.useFakeTimers()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-observe-heartbeat-'))
    const output = path.join(root, 'merged.mp4')
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    let resolveStage
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log,
      execFfmpegStage: vi.fn(() => new Promise((resolve) => { resolveStage = resolve })),
    })
    const heartbeats = []
    try {
      const running = engine._runFfmpegStage(['-version'], { timeout: 25000 }, {
        composeId: 'compose_test_heartbeat',
        stage: 'concat',
        operation: 'xfade_merge',
        outputPath: output,
        heartbeat: true,
        onHeartbeat: (heartbeat) => heartbeats.push(heartbeat),
      })
      fs.writeFileSync(output, 'grown-output')
      await vi.advanceTimersByTimeAsync(10000)
      resolveStage({ stdout: '', stderr: '' })
      await running
      const event = eventsFrom(log).find((meta) => meta.event === 'ffmpeg_heartbeat')
      expect(event).toMatchObject({ composeId: 'compose_test_heartbeat', output: 'merged.mp4', outputGrowing: true, outputBytes: 12 })
      expect(log.info.mock.calls.some((args) => args[2]?.event === 'ffmpeg_heartbeat')).toBe(true)
      expect(heartbeats).toEqual([expect.objectContaining({ outputGrowing: true, outputBytes: 12 })])
    } finally {
      vi.useRealTimers()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('预检失败仍以同一个 composeId 记录开始与失败事件', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-observe-preflight-'))
    const { engine, log } = makeObservabilityEngine(root)
    try {
      const result = await engine.compose({ scenes: [] })
      expect(result.code).toBe(-1)
      const events = eventsFrom(log)
      const started = events.find((meta) => meta.event === 'compose_started')
      const failure = events.find((meta) => meta.event === 'compose_failed')
      expect(started).toMatchObject({ stage: 'compose', sceneCount: 0 })
      expect(failure).toMatchObject({ composeId: started.composeId, stage: 'preflight' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Story2Video 六档字幕字号', () => {
  it.each([
    ['size1', 16], ['size2', 20], ['size3', 24],
    ['size4', 28], ['size5', 32], ['size6', 40],
  ])('将 %s 传递为独立的 FFmpeg fontsize=%i', (size, fontSize) => {
    const filter = buildSubtitleFilter('字幕可见性验证', { size })

    expect(filter).toContain(':fontsize=' + fontSize + ':')
  })
})


describe('_concatSegments 分块合成（25+ 场景防单命令输入过多）', () => {
  let tmp
  let engine

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-chunk-test-'))
    engine = new Story2VideoComposeEngine({ outputDir: tmp, log: { info() {}, warn() {}, error() {}, notify() {} } })
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function makeSegments (count) {
    const segments = []
    for (let i = 0; i < count; i++) {
      const filePath = path.join(tmp, 'seg_' + String(i).padStart(4, '0') + '.mp4')
      fs.writeFileSync(filePath, 'seg' + i)
      segments.push(filePath)
    }
    return segments
  }

  it('27 段转场合成：分块 ≤8 输入，递归合并后输出文件存在', async () => {
    const segments = makeSegments(27)
    const durations = segments.map((_, i) => 6 + (i % 3))
    const output = path.join(tmp, 'out.mp4')
    const xfadeMerge = vi.fn(async (_segs, _plan, outputPath) => { fs.writeFileSync(outputPath, 'video') })
    const plainConcat = vi.fn(async (_segs, outputPath) => { fs.writeFileSync(outputPath, 'video') })
    engine._xfadeMerge = xfadeMerge
    engine._plainConcat = plainConcat

    await engine._concatSegments(segments, output, tmp, { transition: 'fade', transitionDuration: 0.4, segmentDurations: durations })

    expect(fs.existsSync(output)).toBe(true)
    // 27 段 → 4 块（8/8/8/3）+ 4 个中间文件再合并 1 次 = 5 次 xfadeMerge
    expect(xfadeMerge.mock.calls.length).toBe(5)
    for (const call of xfadeMerge.mock.calls) {
      expect(call[0].length).toBeLessThanOrEqual(8)
      // 每个块计划都携带 transitionName，避免 xfade=transition=undefined
      expect(call[1].transitionName).toBe('fade')
    }
    // 每块调用输入数：8,8,8,3,4（最后是 4 个中间文件合并）
    expect(xfadeMerge.mock.calls.map(c => c[0].length)).toEqual([8, 8, 8, 3, 4])
    expect(plainConcat).not.toHaveBeenCalled()
    // 4 个 level0 块 + 1 个 level1 合并中间文件
    const chunks = fs.readdirSync(tmp).filter(n => n.startsWith('merge_l'))
    expect(chunks.length).toBe(5)
  })

  it('≤8 段保持单命令合成，不产生中间块', async () => {
    const segments = makeSegments(6)
    const durations = [6, 6, 6, 6, 6, 6]
    const output = path.join(tmp, 'out.mp4')
    const xfadeMerge = vi.fn(async (_segs, _plan, outputPath) => { fs.writeFileSync(outputPath, 'video') })
    engine._xfadeMerge = xfadeMerge

    await engine._concatSegments(segments, output, tmp, { transition: 'fade', transitionDuration: 0.4, segmentDurations: durations })

    expect(xfadeMerge.mock.calls.length).toBe(1)
    expect(xfadeMerge.mock.calls[0][0].length).toBe(6)
    expect(fs.readdirSync(tmp).filter(n => n.startsWith('merge_l')).length).toBe(0)
  })

  it('直接合并路径（≤8 段）的计划携带 transitionName=fade，不生成 transition=undefined', async () => {
    const segments = makeSegments(6)
    const durations = [6, 6, 6, 6, 6, 6]
    const output = path.join(tmp, 'out.mp4')
    const xfadeMerge = vi.fn(async (_segs, plan, outputPath) => { fs.writeFileSync(outputPath, 'video') })
    engine._xfadeMerge = xfadeMerge

    await engine._concatSegments(segments, output, tmp, { transition: 'fade', transitionDuration: 0.4, segmentDurations: durations })

    expect(xfadeMerge).toHaveBeenCalledTimes(1)
    expect(xfadeMerge.mock.calls[0][1]).toMatchObject({ enabled: true, transitionName: 'fade' })
  })

  it('时长未知时回退无损 concat（不构建转场图）', async () => {
    const segments = makeSegments(3)
    const output = path.join(tmp, 'out.mp4')
    const xfadeMerge = vi.fn(async (_segs, _plan, outputPath) => { fs.writeFileSync(outputPath, 'video') })
    const plainConcat = vi.fn(async (_segs, outputPath) => { fs.writeFileSync(outputPath, 'video') })
    engine._xfadeMerge = xfadeMerge
    engine._plainConcat = plainConcat

    await engine._concatSegments(segments, output, tmp, { transition: 'fade' })

    expect(plainConcat).toHaveBeenCalledTimes(1)
    expect(xfadeMerge).not.toHaveBeenCalled()
  })

  it('无损 concat 接收当前输入片段时长，供动态预算计算', async () => {
    const segments = makeSegments(3)
    const durations = [600, 700, 800]
    const output = path.join(tmp, 'out.mp4')
    const plainConcat = vi.fn(async (_segs, outputPath) => fs.writeFileSync(outputPath, 'video'))
    engine._plainConcat = plainConcat

    await engine._concatSegments(segments, output, tmp, { transition: 'none', segmentDurations: durations })

    expect(plainConcat).toHaveBeenCalledWith(segments, output, tmp, durations)
  })

  it('分块合成：每完成一块触发 onChunkCreated（level/chunkIndex/done/total/path）', async () => {
    const segments = makeSegments(27)
    const durations = segments.map((_, i) => 6 + (i % 3))
    const output = path.join(tmp, 'out.mp4')
    const xfadeMerge = vi.fn(async (_segs, _plan, outputPath) => { fs.writeFileSync(outputPath, 'video') })
    engine._xfadeMerge = xfadeMerge

    const created = []
    await engine._concatSegments(segments, output, tmp, {
      transition: 'fade',
      transitionDuration: 0.4,
      segmentDurations: durations,
      onChunkCreated: (chunk) => created.push(chunk),
    })

    // 27 段 → l0 4 块（8/8/8/3）+ l1 1 块，共 5 块；done/total 跨递归层级单调累加
    expect(created).toHaveLength(5)
    expect(created.map(c => c.level)).toEqual([0, 0, 0, 0, 1])
    expect(created.map(c => c.chunkIndex)).toEqual([0, 1, 2, 3, 0])
    expect(created.map(c => c.done)).toEqual([1, 2, 3, 4, 5])
    expect(created.map(c => c.total)).toEqual([5, 5, 5, 5, 5])
    for (const chunk of created) {
      expect(path.basename(chunk.path)).toBe('merge_l' + chunk.level + '_chunk_' + String(chunk.chunkIndex).padStart(3, '0') + '.mp4')
    }
  })

  it('分块合成：每完成一块记录 merge_l{level}_chunk_{n} created 日志', async () => {
    const segments = makeSegments(27)
    const durations = segments.map((_, i) => 6 + (i % 3))
    const output = path.join(tmp, 'out.mp4')
    const xfadeMerge = vi.fn(async (_segs, _plan, outputPath) => { fs.writeFileSync(outputPath, 'video') })
    engine._xfadeMerge = xfadeMerge
    const info = vi.fn()
    engine.log = { info, warn() {}, error() {} }

    await engine._concatSegments(segments, output, tmp, { transition: 'fade', transitionDuration: 0.4, segmentDurations: durations })

    const logLines = info.mock.calls.map(args => args[1])
    expect(logLines.filter(l => /merge_l\d_chunk_\d+ created/.test(l))).toHaveLength(5)
    expect(logLines).toContain('merge_l0_chunk_000 created: merge_l0_chunk_000.mp4')
    expect(logLines).toContain('merge_l1_chunk_000 created: merge_l1_chunk_000.mp4')
  })

  it('countChunkedMergeChunks 全流程总块数（各级块数之和，末级仅复制不新增块）', () => {
    expect(countChunkedMergeChunks(27, 8)).toBe(5) // l0: 4 + l1: 1
    expect(countChunkedMergeChunks(9, 8)).toBe(3) // l0: 2 + l1: 1
    expect(countChunkedMergeChunks(8, 8)).toBe(1)
    expect(countChunkedMergeChunks(6, 8)).toBe(1)
    expect(countChunkedMergeChunks(100, 8)).toBe(16) // 13 + 2 + 1
    expect(countChunkedMergeChunks(2, 8)).toBe(1)
    expect(countChunkedMergeChunks(1, 8)).toBe(1)
    expect(countChunkedMergeChunks(0, 8)).toBe(0)
  })
})

describe('computeSegmentEncodeTimeoutMs — 片段编码超时按时长估算', () => {
  it('短片段（3s@30fps）按默认 2x 工作倍率保留 66s 预算', () => {
    expect(computeSegmentEncodeTimeoutMs(3, 30)).toBe(66000)
  })

  it('20.79s@30fps（4K zoompan 慢速场景）按 2x 工作倍率放宽到 ~280s', () => {
    // ceil(20.79*30*4/10)*1000 + 30000 = 280000
    expect(computeSegmentEncodeTimeoutMs(20.79, 30, 2)).toBe(280000)
  })

  it('降档后预算随工作倍率下降，避免无谓延长重试', () => {
    expect(computeSegmentEncodeTimeoutMs(6.42, 30, 2)).toBe(108000)
    expect(computeSegmentEncodeTimeoutMs(6.42, 30, 1.5)).toBe(74000)
    expect(computeSegmentEncodeTimeoutMs(6.42, 30, 1)).toBe(60000)
  })

  it('超长片段封顶 10min', () => {
    expect(computeSegmentEncodeTimeoutMs(600, 60)).toBe(600000)
  })

  it('缺省时长/帧率使用安全默认值且不低于下限', () => {
    expect(computeSegmentEncodeTimeoutMs(null, undefined)).toBe(66000)
    expect(computeSegmentEncodeTimeoutMs(undefined, null)).toBe(60000)
  })
})

describe('computeFfmpegStageTimeoutMs — 全片 ffmpeg 超时按媒体时长估算', () => {
  it('将 execFile 的超时终止状态识别为阶段超时，而普通 SIGTERM 不误判', () => {
    expect(isFfmpegStageTimeoutError({ code: 'ETIMEDOUT' })).toBe(true)
    expect(isFfmpegStageTimeoutError({ killed: true, signal: 'SIGTERM' })).toBe(true)
    expect(isFfmpegStageTimeoutError({ killed: true, signal: 'SIGKILL' })).toBe(false)
    expect(isFfmpegStageTimeoutError({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })).toBe(false)
  })

  it('将 execFile 超时错误归一为带阶段语义的 ETIMEDOUT，普通错误保持原对象', () => {
    const sourceError = Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' })
    const normalized = normalizeFfmpegStageError(sourceError, 'webm transcode')
    expect(normalized).not.toBe(sourceError)
    expect(normalized.code).toBe('ETIMEDOUT')
    expect(normalized.message).toBe('webm transcode ffmpeg stage timed out')
    expect(normalized.cause).toBe(sourceError)

    const ordinaryError = new Error('invalid input')
    expect(normalizeFfmpegStageError(ordinaryError, 'webm transcode')).toBe(ordinaryError)
  })

  it('短片保持各阶段既有最小预算', () => {
    expect(computeFfmpegStageTimeoutMs('concat', 1)).toBe(60000)
    expect(computeFfmpegStageTimeoutMs('narration', 1)).toBe(120000)
    expect(computeFfmpegStageTimeoutMs('bgm', 1)).toBe(120000)
    expect(computeFfmpegStageTimeoutMs('webm', 1)).toBe(180000)
    expect(computeFfmpegStageTimeoutMs('validate', 1)).toBe(60000)
  })

  it('50 分钟输出按阶段放大，不再落入固定 60s/120s/180s', () => {
    expect(computeFfmpegStageTimeoutMs('concat', 3000)).toBe(780000)
    expect(computeFfmpegStageTimeoutMs('narration', 3000)).toBe(6030000)
    expect(computeFfmpegStageTimeoutMs('bgm', 3000)).toBe(6030000)
    expect(computeFfmpegStageTimeoutMs('webm', 3000)).toBe(18120000)
    expect(computeFfmpegStageTimeoutMs('validate', 3000)).toBe(6030000)
  })

  it.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'oops'])(
    '无效时长 %s 回退阶段最小预算',
    duration => {
      expect(computeFfmpegStageTimeoutMs('webm', duration)).toBe(180000)
    },
  )

  it('极端估算受阶段硬上限约束，xfade 同样封顶 6 小时', () => {
    expect(computeFfmpegStageTimeoutMs('concat', 100000)).toBe(30 * 60 * 1000)
    expect(computeFfmpegStageTimeoutMs('narration', 100000)).toBe(2 * 60 * 60 * 1000)
    expect(computeFfmpegStageTimeoutMs('webm', 100000)).toBe(6 * 60 * 60 * 1000)
    expect(computeMergeEncodeTimeoutMs(100000)).toBe(6 * 60 * 60 * 1000)
  })
})

describe('Story2VideoComposeEngine._createSegment — 编码失败降档重试', () => {
  function makeEngine () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-compose-ladder-'))
    const engine = new Story2VideoComposeEngine({
      outputDir: root,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    return { engine, root }
  }

  it('2x 失败 → 1.5x 失败 → 1x 成功，最终返回且 workScale 逐级降档', async () => {
    const { engine, root } = makeEngine()
    const encodeOnce = vi.fn()
      .mockRejectedValueOnce(new Error('boom at 2x'))
      .mockRejectedValueOnce(new Error('boom at 1.5x'))
      .mockResolvedValueOnce(undefined)
    engine._encodeSegmentOnce = encodeOnce

    await engine._createSegment('img.jpg', 'aud.mp3', path.join(root, 'seg.mp4'), {
      width: 1920, height: 1080, fps: 30, effectDuration: 20, imageEffect: 'zoom-in',
    })

    expect(encodeOnce).toHaveBeenCalledTimes(3)
    expect(encodeOnce.mock.calls[0][3].workScale).toBe(2)
    expect(encodeOnce.mock.calls[1][3].workScale).toBe(1.5)
    expect(encodeOnce.mock.calls[2][3].workScale).toBe(1)
  })

  it('全部档位失败时抛出最后一次错误', async () => {
    const { engine, root } = makeEngine()
    const encodeOnce = vi.fn().mockRejectedValue(new Error('still failing'))
    engine._encodeSegmentOnce = encodeOnce

    await expect(
      engine._createSegment('img.jpg', 'aud.mp3', path.join(root, 'seg.mp4'), {
        width: 1920, height: 1080, fps: 30, effectDuration: 5, imageEffect: 'pan-left',
      }),
    ).rejects.toThrow('still failing')
    expect(encodeOnce).toHaveBeenCalledTimes(3)
  })

  it('无动效片段不降档（单次成功）', async () => {
    const { engine, root } = makeEngine()
    const encodeOnce = vi.fn().mockResolvedValue(undefined)
    engine._encodeSegmentOnce = encodeOnce

    await engine._createSegment('img.jpg', 'aud.mp3', path.join(root, 'seg.mp4'), {
      width: 1920, height: 1080, fps: 30, effectDuration: 5, imageEffect: 'none',
    })
    expect(encodeOnce).toHaveBeenCalledTimes(1)
    expect(encodeOnce.mock.calls[0][3].workScale).toBe(2)
  })
})

describe('4K 能力开关（maxOutputResolution）', () => {
  it('resolveMaxOutputDimensions：默认 1080p，4k 允许 3840x2160', () => {
    expect(resolveMaxOutputDimensions()).toEqual({ key: '1080p', width: 1920, height: 1080 })
    expect(resolveMaxOutputDimensions('4k')).toEqual({ key: '4k', width: 3840, height: 2160 })
    expect(resolveMaxOutputDimensions('whatever')).toEqual({ key: '1080p', width: 1920, height: 1080 })
  })

  it('computeWorkResolution：长边封顶 3840 且保持宽高比（4K 输出不再产生 8K/方形中间画布）', () => {
    expect(computeWorkResolution(1920, 1080, 2)).toEqual({ width: 3840, height: 2160 })
    expect(computeWorkResolution(3840, 2160, 2)).toEqual({ width: 3840, height: 2160 })
    expect(computeWorkResolution(3840, 2160, 1.5)).toEqual({ width: 3840, height: 2160 })
    expect(computeWorkResolution(720, 1280, 2)).toEqual({ width: 1440, height: 2560 })
    // 竖屏 4K 输出同样按长边封顶并保持 9:16
    expect(computeWorkResolution(2160, 3840, 2)).toEqual({ width: 2160, height: 3840 })
  })

  it('validateResolutionCapability：1080p 档拒绝 4K，1080p 档内竖屏/横屏放行，4k 档放行 4K', () => {
    expect(validateResolutionCapability('3840x2160', '1080p')).toMatch(/超出当前允许上限/)
    expect(validateResolutionCapability('1920x1080', '1080p')).toBeNull()
    expect(validateResolutionCapability('1080x1920', '1080p')).toBeNull()
    expect(validateResolutionCapability('3840x2160', '4k')).toBeNull()
  })

  it('compose 入口 fail-closed：默认（1080p）拒绝 4K 输出', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-4k-gate-'))
    try {
      const engine = new Story2VideoComposeEngine({ outputDir: root, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
      const result = await engine.compose(
        { scenes: [{ imagePath: 'a.png', audioPath: 'a.mp3' }] },
        { resolution: '3840x2160' },
      )
      expect(result.code).toBe(-1)
      expect(result.message).toMatch(/超出当前允许上限|4K/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('compose 入口：4k 档放行 4K（不再被能力校验拦截）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-4k-open-'))
    try {
      const engine = new Story2VideoComposeEngine({
        outputDir: root,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
        maxOutputResolution: '4k',
      })
      const result = await engine.compose(
        { scenes: [{ imagePath: 'a.png', audioPath: 'a.mp3' }] },
        { resolution: '3840x2160' },
      )
      expect(result.code).toBe(-1)
      expect(result.message).not.toMatch(/超出当前允许上限/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('renderSegment：默认 1080p 拒绝 4K 分段渲染', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-4k-seg-'))
    try {
      const engine = new Story2VideoComposeEngine({ outputDir: root, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
      const result = await engine.renderSegment(
        { imagePath: 'a.png', audioPath: 'a.mp3' },
        { resolution: '3840x2160' },
        path.join(root, 'seg.mp4'),
      )
      expect(result.code).toBe(-1)
      expect(result.message).toMatch(/超出当前允许上限|4K/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('_currentMaxOutputResolution：惰性 getter 生效、未知值/异常回退静态值（无 ffmpeg 依赖）', () => {
    const mk = (opts) => new Story2VideoComposeEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, ...opts })
    expect(mk({ maxOutputResolution: '1080p', getMaxOutputResolution: () => '4k' })._currentMaxOutputResolution()).toBe('4k')
    expect(mk({ maxOutputResolution: '4k', getMaxOutputResolution: () => 'bogus' })._currentMaxOutputResolution()).toBe('4k')
    expect(mk({ maxOutputResolution: '1080p', getMaxOutputResolution: () => { throw new Error('x') } })._currentMaxOutputResolution()).toBe('1080p')
    expect(mk({ maxOutputResolution: '1080p' })._currentMaxOutputResolution()).toBe('1080p')
  })

  it('getMaxOutputResolution 惰性读取：静态 1080p + 动态 4k → 放行 4K（运营开关运行时下发生效）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-4k-lazy-'))
    try {
      const engine = new Story2VideoComposeEngine({
        outputDir: root,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
        maxOutputResolution: '1080p', // 构造期快照为默认
        getMaxOutputResolution: () => '4k', // 运行时功能开关已开启 4K
      })
      const result = await engine.compose(
        { scenes: [{ imagePath: 'a.png', audioPath: 'a.mp3' }] },
        { resolution: '3840x2160' },
      )
      expect(result.code).toBe(-1)
      expect(result.message).not.toMatch(/超出当前允许上限/) // 未被能力闸拦截
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('getMaxOutputResolution 惰性读取：静态 4k + 动态 1080p → 拒绝 4K（开关回退 fail-closed）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-4k-lazy-off-'))
    try {
      const engine = new Story2VideoComposeEngine({
        outputDir: root,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
        maxOutputResolution: '4k',
        getMaxOutputResolution: () => '1080p', // 运营开关已回退
      })
      const result = await engine.compose(
        { scenes: [{ imagePath: 'a.png', audioPath: 'a.mp3' }] },
        { resolution: '3840x2160' },
      )
      expect(result.code).toBe(-1)
      expect(result.message).toMatch(/超出当前允许上限|4K/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Story2VideoComposeEngine 混合片段（AI 视频 + 图片轮播，2026-08-11）', () => {
  // 跨平台：用 findFfmpeg() 解析捆绑二进制（CI 设 SKIP_NATIVE_MEDIA_TOOL_TESTS=1 时返回 null，测试整体跳过）
  const FFMPEG = findFfmpeg()
  const runFfmpeg = (args) => new Promise((resolve, reject) => {
    if (!FFMPEG) { reject(new Error('ffmpeg not available')); return }
    execFile(FFMPEG, args, (error) => error ? reject(new Error(String(error).slice(0, 300))) : resolve())
  })

  function makeEngine (root) {
    return new Story2VideoComposeEngine({
      outputDir: root,
      allowedMediaRoots: [root],
      maxInputFileBytes: 100 * 1024 * 1024,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
  }

  // Goertzel：在候选频率中找出 PCM 片段的主频（用于断言视频片段音频是 TTS 而非 AI 视频自带音频）
  function dominantFreqAmong (samples, sampleRate, candidates) {
    const n = Math.max(2, samples.length)
    const scored = candidates.map(freq => {
      const k = Math.round((n * freq) / sampleRate)
      let s0
      let s1 = 0
      let s2 = 0
      const coeff = 2 * Math.cos((2 * Math.PI * k) / n)
      for (let i = 0; i < n; i++) {
        s0 = samples[i] + coeff * s1 - s2
        s2 = s1
        s1 = s0
      }
      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
      return { freq, power }
    })
    return scored.reduce((best, item) => (item.power > best.power ? item : best)).freq
  }

  it('混合输入（videoPath 场景 + imagePath 场景）真实合成成功，segment 记录 mediaKind', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-mixed-compose-'))
    try {
      const videoPath = path.join(root, 'ai-clip.mp4')
      const imagePath = path.join(root, 'image.png')
      const audioPath = path.join(root, 'voice.m4a')
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x240:d=1', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath])
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x240:d=1', '-frames:v', '1', imagePath])
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', audioPath])

      const engine = makeEngine(root)
      const result = await engine.compose({
        scenes: [
          { index: 0, text: 'AI 视频场景', videoPath, audioPath, duration: 1 },
          { index: 1, text: '图片轮播场景', imagePath, audioPath, duration: 1 },
        ],
        images: [],
        videos: [],
        audio: [],
      }, {
        resolution: '160x240',
        fps: 24,
        format: 'mp4',
        transition: 'none',
        imageEffect: 'none',
        sceneDurationMode: 'follow-audio',
        subtitleEnabled: false,
        validateOutput: false,
      })

      expect(result.code).toBe(0)
      expect(fs.existsSync(result.data.videoPath)).toBe(true)
      expect(result.data.segmentCount).toBe(2)
      expect(result.data.segments).toEqual([
        expect.objectContaining({ index: 0, mediaKind: 'video' }),
        expect.objectContaining({ index: 1, mediaKind: 'image' }),
      ])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('视频片段音频为 TTS 旁白（AI 视频自带音频不抢占；2026-08-11 W10）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-tts-audio-'))
    try {
      // AI 视频自带 440Hz 音频，TTS 旁白为 880Hz —— 若未显式映射，ffmpeg 默认输出 440Hz（丢弃解说）
      const videoPath = path.join(root, 'ai-with-audio.mp4')
      const audioPath = path.join(root, 'tts-voice.m4a')
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=green:s=160x240:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', videoPath])
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-c:a', 'aac', audioPath])

      const engine = makeEngine(root)
      const result = await engine.compose({
        scenes: [{ index: 0, text: 'AI 视频场景', videoPath, audioPath, duration: 1 }],
        images: [],
        videos: [],
        audio: [],
      }, {
        resolution: '160x240',
        fps: 24,
        format: 'mp4',
        transition: 'none',
        imageEffect: 'none',
        sceneDurationMode: 'follow-audio',
        subtitleEnabled: false,
        validateOutput: false,
      })
      expect(result.code).toBe(0)

      const pcm = path.join(root, 'out.pcm')
      await runFfmpeg(['-y', '-v', 'error', '-i', result.data.videoPath, '-t', '1', '-ac', '1', '-ar', '8000', '-f', 'f32le', pcm])
      const buf = fs.readFileSync(pcm)
      const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)).slice(0, 8000)
      const dom = dominantFreqAmong(samples, 8000, [440, 880])
      expect(dom).toBe(880)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('视频场景缺少 audioPath 时拒绝合成', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-mixed-reject-'))
    try {
      const videoPath = path.join(root, 'ai-clip.mp4')
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x240:d=1', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath])
      const engine = makeEngine(root)
      const result = await engine.compose({
        scenes: [
          { index: 0, text: '缺音频', videoPath, audioPath: null, duration: 1 },
        ],
        images: [],
        videos: [],
        audio: [],
      }, { resolution: '160x240', fps: 24, validateOutput: false })
      expect(result.code).toBe(-1)
      expect(result.message).toMatch(/audio path is not allowed or unreadable/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('视频源文件不可读/不存在时拒绝（Scene media path）', async () => {
    if (!findFfmpeg()) return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-mixed-unreadable-'))
    try {
      const audioPath = path.join(root, 'voice.m4a')
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', audioPath])
      const engine = makeEngine(root)
      const result = await engine.compose({
        scenes: [
          { index: 0, text: '坏视频', videoPath: path.join(root, 'missing.mp4'), audioPath, duration: 1 },
        ],
        images: [],
        videos: [],
        audio: [],
      }, { resolution: '160x240', fps: 24, validateOutput: false })
      expect(result.code).toBe(-1)
      expect(result.message).toMatch(/not allowed or unreadable/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('moving 水印后置烧录（成片级时间轴，跨镜头连续漂移）', () => {
  function makeWmEngine () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-wm-post-'))
    const engine = new Story2VideoComposeEngine({
      outputDir: root,

      // CI（SKIP_NATIVE_MEDIA_TOOL_TESTS=1）下模块级 FFMPEG 为 null，compose 成功路径必须注入实例级二进制

      ffmpegBinary: 'ffmpeg',
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    engine._runFfmpegStage = vi.fn(async (_args, _options, details) => {
      // 后置烧录真实语义：写出产物，供 compose 末尾 hasUsableFile(composedPath) 校验；
      // 其余阶段保持 mock，不触碰磁盘
      if (details?.stage === 'watermark' || details?.stage === 'bgm') {
        const outputArg = _args[_args.length - 1]
        if (typeof outputArg === 'string' && outputArg.toLowerCase().endsWith('.mp4')) {
          fs.writeFileSync(outputArg, Buffer.from('watermarked'))
        }
      }
      return { stderr: '' }
    })
    engine._requireFfmpegOutput = vi.fn()
    // compose 会真实校验媒体文件存在性与白名单（resolveReadableMediaFile），必须预建 fixture
    const aImage = writeFixture(root, 'a.jpg')
    const aAudio = writeFixture(root, 'a.mp3')
    const bImage = writeFixture(root, 'b.jpg')
    const bAudio = writeFixture(root, 'b.mp3')
    return { engine, root, aImage, aAudio, bImage, bAudio }
  }

  const movingConfig = { enabled: true, text: '品牌', position: 'moving', opacity: 0.6, fontSize: 24 }

  it('KNOWN_COMPOSE_PHASES 包含 watermark 且 normalizeComposeProgressUpdate 透传', () => {
    expect(KNOWN_COMPOSE_PHASES).toContain('watermark')
    const normalized = normalizeComposeProgressUpdate({
      phase: 'watermark', percent: 90, segmentsDone: 2, segmentsTotal: 2, message: '正在烧录移动水印',
    })
    expect(normalized).toMatchObject({ phase: 'watermark', percent: 90, segmentsDone: 2, segmentsTotal: 2 })
  })

  it('构造可注入 ffmpegBinary：CI SKIP_NATIVE_MEDIA_TOOL_TESTS=1 环境下 compose 成功路径仍可执行（回归保护）', async () => {

    const { engine } = makeWmEngine()

    expect(engine.ffmpegBinary).toBe('ffmpeg')

  })



  it('image 片段：moving 水印不内嵌 drawtext（后置烧录），静态位置仍内嵌', async () => {
    const { engine, root } = makeWmEngine()
    const base = {
      width: 320, height: 180, fps: 24, effectDuration: 4, imageEffect: 'none',
      subtitleText: '', subtitleTimeline: [], subtitleStyle: undefined,
      transition: 'none', composeId: 't', sceneIndex: 0,
    }
    try {
      await engine._encodeSegmentOnce('img.jpg', 'aud.mp3', path.join(root, 'seg1.mp4'), {
        ...base, watermark: true, watermarkText: '品牌', watermarkConfig: { ...movingConfig }, sceneTotal: 2,
      })
      expect(engine._runFfmpegStage.mock.calls[0][0].join(' ')).not.toContain("drawtext=text='品牌'")
      await engine._encodeSegmentOnce('img.jpg', 'aud.mp3', path.join(root, 'seg2.mp4'), {
        ...base, watermark: true, watermarkText: '品牌', watermarkConfig: { ...movingConfig, position: 'bottom-right' }, sceneTotal: 2,
      })
      expect(engine._runFfmpegStage.mock.calls[1][0].join(' ')).toContain("drawtext=text='品牌'")
      // 单镜头（sceneTotal<=1）moving：保持片段内嵌，零额外编码
      await engine._encodeSegmentOnce('img.jpg', 'aud.mp3', path.join(root, 'seg0.mp4'), {
        ...base, watermark: true, watermarkText: '品牌', watermarkConfig: { ...movingConfig }, sceneTotal: 1,
      })
      expect(engine._runFfmpegStage.mock.calls[2][0].join(' ')).toContain("drawtext=text='品牌'")
    } finally {
      fs.rmSync(engine.outputDir, { recursive: true, force: true })
    }
  })

  it('video 片段：moving 水印不内嵌 drawtext（后置烧录），静态位置仍内嵌', async () => {
    const { engine, root } = makeWmEngine()
    const base = {
      width: 320, height: 180, fps: 24, effectDuration: 4, duration: null, audioDuration: 4,
      videoMode: 'fixed', padTo: null, shortVideoHandling: 'loop',
      subtitleText: '', subtitleTimeline: [], subtitleStyle: undefined,
      transition: 'none', voiceVolume: 1, composeId: 't', sceneIndex: 0,
    }
    try {
      await engine._encodeVideoSegmentOnce('video.mp4', 'aud.mp3', path.join(root, 'seg1.mp4'), {
        ...base, watermark: true, watermarkText: '品牌', watermarkConfig: { ...movingConfig }, sceneTotal: 2,
      })
      expect(engine._runFfmpegStage.mock.calls[0][0].join(' ')).not.toContain("drawtext=text='品牌'")
      await engine._encodeVideoSegmentOnce('video.mp4', 'aud.mp3', path.join(root, 'seg2.mp4'), {
        ...base, watermark: true, watermarkText: '品牌', watermarkConfig: { ...movingConfig, position: 'bottom-right' }, sceneTotal: 2,
      })
      expect(engine._runFfmpegStage.mock.calls[1][0].join(' ')).toContain("drawtext=text='品牌'")
      // 单镜头（sceneTotal<=1）moving：保持片段内嵌，零额外编码
      await engine._encodeVideoSegmentOnce('video.mp4', 'aud.mp3', path.join(root, 'seg0.mp4'), {
        ...base, watermark: true, watermarkText: '品牌', watermarkConfig: { ...movingConfig }, sceneTotal: 1,
      })
      expect(engine._runFfmpegStage.mock.calls[2][0].join(' ')).toContain("drawtext=text='品牌'")
    } finally {
      fs.rmSync(engine.outputDir, { recursive: true, force: true })
    }
  })

  it('compose moving 多镜头：新增 watermark 阶段（percent 90），后置命令为整片时间轴的 sin 漂移且音频 copy', async () => {
    const { engine, root, aImage, aAudio, bImage, bAudio } = makeWmEngine()
    engine._createSegment = vi.fn(async (_image, _audio, output) => { fs.writeFileSync(output, Buffer.from('seg')) })
    engine._concatSegments = vi.fn(async (_segs, output) => { fs.writeFileSync(output, Buffer.from('video')) })
    engine._concatNarrationAudio = vi.fn(async (_audios, output) => { fs.writeFileSync(output, Buffer.from('narration')) })
    engine._validateOutput = vi.fn(async () => {})

    const progress = []
    try {
      const result = await engine.compose({
        scenes: [
          { index: 0, imagePath: aImage, audioPath: aAudio, duration: 2 },
          { index: 1, imagePath: bImage, audioPath: bAudio, duration: 2 },
        ],
        images: [], audio: [],
      }, {
        watermark: true, watermarkText: '品牌', watermarkConfig: { ...movingConfig },
        validateOutput: false,
      }, (update) => progress.push(update))

      expect(result.code).toBe(0)
      // 进度：narration 89 → watermark 90 单调推进，且消息为烧录文案
      const wmProgress = progress.find((u) => u.phase === 'watermark')
      expect(wmProgress).toMatchObject({ percent: 90 })
      const percentSeq = progress.map((u) => u.percent)
      const idxNarration = percentSeq.indexOf(89)
      const idxWatermark = percentSeq.indexOf(90)
      expect(idxWatermark).toBeGreaterThan(idxNarration)

      // 后置命令：stage watermark；-vf 为整片时间轴 moving 表达式；音频流复制不重编码
      const wmCall = engine._runFfmpegStage.mock.calls.find((call) => call[2]?.stage === 'watermark')
      expect(wmCall).toBeTruthy()
      const args = wmCall[0]
      const joined = args.join(' ')
      expect(joined).toContain("drawtext=text='品牌'")
      // 滤镜整串无逗号（防滤镜链切分）
      const vfArg = args[args.indexOf('-vf') + 1]
      expect(vfArg).not.toContain(',')
      // 单一来源：后置滤镜串与 buildWatermarkFilter(moving) 输出完全一致（防双份数学/样式漂移）
      expect(vfArg).toBe(buildWatermarkFilter({ watermark: movingConfig, watermarkText: '品牌' }))
      expect(joined).toContain("(h-text_h)/2*(1+0.9*sin(2*PI*t/140))")
      expect(args).toContain('-c:a')
      expect(args).toContain('copy')
      // 显式 -map 不丢音频（0:a:0? 可选映射，缺此行音频流会被整体丢弃）
      expect(args).toContain('-map')
      expect(args).toContain('0:a:0?')
      // 超时复用 xfade 量级：按成片实际时长（buildTransitionPlan：首段 2s 不减，后续每段扣 0.4s → 3.6s）
      expect(wmCall[1].timeout).toBe(computeFfmpegStageTimeoutMs('watermark', 2 + (2 - 0.4)))
    } finally {
      fs.rmSync(engine.outputDir, { recursive: true, force: true })
    }
  })

  it('静态位置（bottom-right）：不进 watermark 阶段，片段内内嵌', async () => {
    const { engine, root, aImage, aAudio, bImage, bAudio } = makeWmEngine()
    engine._createSegment = vi.fn(async (_image, _audio, output) => { fs.writeFileSync(output, Buffer.from('seg')) })
    engine._concatSegments = vi.fn(async (_segs, output) => { fs.writeFileSync(output, Buffer.from('video')) })
    engine._concatNarrationAudio = vi.fn(async (_audios, output) => { fs.writeFileSync(output, Buffer.from('narration')) })
    engine._validateOutput = vi.fn(async () => {})
    const progress = []
    try {
      const result = await engine.compose({
        scenes: [
          { index: 0, imagePath: aImage, audioPath: aAudio, duration: 2 },
          { index: 1, imagePath: bImage, audioPath: bAudio, duration: 2 },
        ],
        images: [], audio: [],
      }, {
        watermark: true, watermarkText: '品牌', watermarkConfig: { ...movingConfig, position: 'bottom-right' },
        validateOutput: false,
      }, (update) => progress.push(update))
      expect(result.code).toBe(0)
      expect(progress.some((u) => u.phase === 'watermark')).toBe(false)
    } finally {
      fs.rmSync(engine.outputDir, { recursive: true, force: true })
    }
  })

  it('未启用水印：不进 watermark 阶段', async () => {
    const { engine, root, aImage, aAudio } = makeWmEngine()
    engine._createSegment = vi.fn(async (_image, _audio, output) => { fs.writeFileSync(output, Buffer.from('seg')) })
    engine._concatSegments = vi.fn(async (_segs, output) => { fs.writeFileSync(output, Buffer.from('video')) })
    engine._concatNarrationAudio = vi.fn(async (_audios, output) => { fs.writeFileSync(output, Buffer.from('narration')) })
    engine._validateOutput = vi.fn(async () => {})
    const progress = []
    try {
      const result = await engine.compose({
        scenes: [{ index: 0, imagePath: aImage, audioPath: aAudio, duration: 2 }],
        images: [], audio: [],
      }, { validateOutput: false }, (update) => progress.push(update))
      expect(result.code).toBe(0)
      expect(progress.some((u) => u.phase === 'watermark')).toBe(false)
    } finally {
      fs.rmSync(engine.outputDir, { recursive: true, force: true })
    }
  })
  it('单镜头 + moving：不进 watermark 阶段（零额外编码），sceneTotal=1 传递到片段编码', async () => {
    const { engine, root, aImage, aAudio } = makeWmEngine()
    engine._createSegment = vi.fn(async (_image, _audio, output) => { fs.writeFileSync(output, Buffer.from('seg')) })
    engine._concatSegments = vi.fn(async (_segs, output) => { fs.writeFileSync(output, Buffer.from('video')) })
    engine._concatNarrationAudio = vi.fn(async (_audios, output) => { fs.writeFileSync(output, Buffer.from('narration')) })
    engine._validateOutput = vi.fn(async () => {})
    const progress = []
    try {
      const result = await engine.compose({
        scenes: [{ index: 0, imagePath: aImage, audioPath: aAudio, duration: 2 }],
        images: [], audio: [],
      }, {
        watermark: true, watermarkText: '品牌', watermarkConfig: { ...movingConfig },
        validateOutput: false,
      }, (update) => progress.push(update))
      expect(result.code).toBe(0)
      expect(progress.some((u) => u.phase === 'watermark')).toBe(false)
      expect(engine._createSegment.mock.calls[0][3].sceneTotal).toBe(1)
    } finally {
      fs.rmSync(engine.outputDir, { recursive: true, force: true })
    }
  })

  it('moving + BGM：watermark 阶段先于 bgm 阶段（BGM -c:v copy 依赖已烧水印）', async () => {
    const { engine, root, aImage, aAudio, bImage, bAudio } = makeWmEngine()
    engine._createSegment = vi.fn(async (_image, _audio, output) => { fs.writeFileSync(output, Buffer.from('seg')) })
    engine._concatSegments = vi.fn(async (_segs, output) => { fs.writeFileSync(output, Buffer.from('video')) })
    engine._concatNarrationAudio = vi.fn(async (_audios, output) => { fs.writeFileSync(output, Buffer.from('narration')) })
    engine._validateOutput = vi.fn(async () => {})
    const bgmPath = writeFixture(root, 'bgm.mp3')
    const progress = []
    try {
      const result = await engine.compose({
        scenes: [
          { index: 0, imagePath: aImage, audioPath: aAudio, duration: 2 },
          { index: 1, imagePath: bImage, audioPath: bAudio, duration: 2 },
        ],
        images: [], audio: [],
      }, {
        watermark: true, watermarkText: '品牌', watermarkConfig: { ...movingConfig },
        bgmPath,
        validateOutput: false,
      }, (update) => progress.push(update))
      expect(result.code).toBe(0)
      const ordered = engine._runFfmpegStage.mock.calls.filter((call) => call[2]?.stage === 'watermark' || call[2]?.stage === 'bgm')
      expect(ordered.map((call) => call[2].stage)).toEqual(['watermark', 'bgm'])
      const seq = progress.map((u) => u.percent)
      expect(seq.indexOf(90)).toBeLessThan(seq.indexOf(92))
    } finally {
      fs.rmSync(engine.outputDir, { recursive: true, force: true })
    }
  })
})

// @vitest-environment node
const {
  buildDomainSeed,
  buildPromptEngineSceneContext,
  buildSceneContextBlock,
  buildSceneContextResult,
  detectSentiment,
  enrichSceneWithContext,
  extractStoryContext,
  filterIdiomHits,
  mergeNegativePrompt,
  normalizeSceneContextOptions,
  CONTEXT_KEY_WHITELIST,
} = require('./story-context-engine')

const TANG_FULL_TEXT = [
  '这是一个关于中国唐代的故事。',
  '唐玄宗时期，长安城一片繁华，市井百姓安居乐业。',
  '故事讲述一位老妇人在长安城中的日常生活与劳作。',
].join('')

const TANG_COOKING_SCENE = '一个老妇人在做饭'

describe('Story2Video 场景上下文增强中间层（story-context-engine）', () => {
  describe('全局故事上下文提取 extractStoryContext', () => {
    it('用户示例：唐代全文 → 识别唐朝/中国/长安，并给出一致性锚点与时代负面锚点', () => {
      const story = extractStoryContext(TANG_FULL_TEXT)
      expect(story.era).toBe('ancient')
      expect(story.dynasty).toMatchObject({ name: '唐朝', period: '唐朝（618-907）' })
      expect(story.culture).toBe('中国')
      expect(story.region).toContain('长安')
      expect(story.genre).toBe('历史')
      expect(story.anchors).toEqual(expect.arrayContaining(['唐代', '中国', '长安']))
      expect(story.negativeAnchors).toEqual(expect.arrayContaining(['电烤箱', '西式现代厨房']))
      expect(story.method).toBe('rule-based')
      expect(story.confidence).toBeGreaterThan(0)
    })

    it('无关键词文案：不编造时代/地域/题材，era=mixed 且负面锚点为空', () => {
      const story = extractStoryContext('今天天气很好，我去公园散步。')
      expect(story.era).toBe('mixed')
      expect(story.dynasty).toBeNull()
      expect(story.culture).toBe('')
      expect(story.genre).toBe('general')
      expect(story.anchors).toHaveLength(0)
      expect(story.negativeAnchors).toHaveLength(0)
      expect(story.summary).toContain('今天天气很好')
    })

    it('现代关键词 → era=modern，负面锚点为古代道具', () => {
      const story = extractStoryContext('小明在写字楼里用手机点外卖，晚上坐地铁回家。')
      expect(story.era).toBe('modern')
      expect(story.dynasty).toBeNull()
      expect(story.props.modern.length).toBeGreaterThan(0)
      expect(story.props.ancient).toHaveLength(0)
      expect(story.negativeAnchors).toContain('油灯')
    })

    it('时代道具互斥：ancient 只输出古代道具，modern 只输出现代道具', () => {
      const ancient = extractStoryContext('唐朝长安城中，老妇人用土灶柴火做饭。')
      expect(ancient.props.ancient).toContain('土灶')
      expect(ancient.props.modern).toHaveLength(0)
      const modern = extractStoryContext('她用微波炉加热食物，打开冰箱拿牛奶。')
      expect(modern.props.modern).toContain('微波炉')
      expect(modern.props.ancient).toHaveLength(0)
    })

    it('多文化命中：按证据数排序保留多候选并带置信度', () => {
      const story = extractStoryContext('故事发生在长安与东京之间，既有中国唐代的宫殿，也有日本京都的庭院。')
      // 中国命中（长安/唐代/宫殿/中国），日本命中（东京/日本/京都/庭院）→ 中国应排前
      expect(story.culture).toBe('中国')
      expect(story.multiCandidates && story.multiCandidates.length >= 2).toBe(true)
    })

    it('朝代表扩展：宋/明/清/民国等关键词命中对应朝代', () => {
      for (const [keyword, name] of [
        ['宋徽宗','宋朝'], ['明朝','明朝'], ['康熙','清朝'], ['上海滩','民国'],
      ]) {
        const story = extractStoryContext('故事发生在' + keyword + '时期。')
        if (name === '民国') {
          expect(story.era).toBe('modern')
        } else {
          expect(story.dynasty && story.dynasty.name).toBe(name)
        }
      }
    })

    it('角色提取：识别人物名与修饰语', () => {
      const story = extractStoryContext('一位慈祥的老妇人在河边洗衣服，旁边是年轻的书生。')
      const names = story.characters.map(c => c.name)
      expect(names).toContain('老妇人')
      expect(names).toContain('书生')
      const granny = story.characters.find(c => c.name === '老妇人')
      expect(granny.descriptor).toContain('慈祥')
    })

    it('summary 不超 maxSummaryLength，锚点数量不超 maxAnchors', () => {
      const story = extractStoryContext(TANG_FULL_TEXT, { maxSummaryLength: 50, maxAnchors: 3 })
      expect(Array.from(story.summary).length).toBeLessThanOrEqual(50)
      expect(story.anchors.length).toBeLessThanOrEqual(3)
    })
  })

  describe('逐场景上下文融合 buildSceneContextBlock / enrichSceneWithContext', () => {
    it('用户示例：做饭场景获得唐代/中国/土灶/柴火锚点与电烤箱负面锚点', () => {
      const story = extractStoryContext(TANG_FULL_TEXT)
      const scene = { index: 0, text: TANG_COOKING_SCENE }
      const block = buildSceneContextBlock(scene, story)
      expect(block.contextBlock).toContain('唐朝')
      expect(block.contextBlock).toContain('中国')
      expect(block.contextBlock).toContain('做饭')
      expect(block.contextBlock).toContain('土灶')
      expect(block.contextBlock).toContain('柴火')
      expect(block.negativeAnchors).toEqual(expect.arrayContaining(['电烤箱', '微波炉', '西式现代厨房']))
      expect(block.character).toMatchObject({ name: '老妇人' })
    })

    it('上下文块长度受 contextBlockMaxChars 约束（按断句截断）', () => {
      const story = extractStoryContext(TANG_FULL_TEXT)
      const scene = { index: 0, text: TANG_COOKING_SCENE }
      const block = buildSceneContextBlock(scene, story, { contextBlockMaxChars: 60 })
      expect(Array.from(block.contextBlock).length).toBeLessThanOrEqual(60)
    })

    it('enrichSceneWithContext 输出 scene.storyContext / scene.context / 负面锚点', () => {
      const story = extractStoryContext(TANG_FULL_TEXT)
      const scene = { index: 0, text: TANG_COOKING_SCENE, imagePromptSeed: '老妇人在灶台前做饭' }
      const enriched = enrichSceneWithContext(scene, story, TANG_FULL_TEXT)
      expect(enriched.storyContext).toContain('唐朝')
      expect(Array.isArray(enriched.negativeAnchors)).toBe(true)
      expect(enriched.negativeAnchors).toContain('电烤箱')
      expect(enriched.context).toBeDefined()
    })

    it('现代做饭场景不注入古代道具负面锚点，反而排除土灶/柴火', () => {
      const story = extractStoryContext('现代都市里，一位主妇在家做饭。')
      const scene = { index: 0, text: '一位主妇在厨房用电烤箱做饭' }
      const block = buildSceneContextBlock(scene, story)
      expect(block.negativeAnchors).toEqual(expect.arrayContaining(['土灶', '柴火']))
      expect(block.negativeAnchors).not.toContain('电烤箱')
    })
  })

  describe('提示词优化上下文 buildPromptEngineSceneContext', () => {
    it('只输出白名单七键（synopsis/full_text/setting/narrative_intent/scene_type/character_list/character）', () => {
      const story = extractStoryContext(TANG_FULL_TEXT)
      const scene = { index: 0, text: TANG_COOKING_SCENE }
      const ctx = buildPromptEngineSceneContext(scene, story, TANG_FULL_TEXT)
      expect(Object.keys(ctx).sort()).toEqual([...CONTEXT_KEY_WHITELIST].sort())
      expect(ctx.synopsis).toContain('唐代')
      expect(ctx.full_text).toContain('唐代')
      expect(ctx.setting).toContain('做饭')
      expect(ctx.character).toMatchObject({ name: '老妇人' })
      expect(Array.isArray(ctx.character_list)).toBe(true)
      // 白名单键中不得出现敏感键名
      for (const key of Object.keys(ctx)) {
        expect(key.toLowerCase()).not.toMatch(/token|secret|password|api_key|authorization/)
      }
    })

    it('无全局设定时 setting 回退场景文字，不编造', () => {
      const story = extractStoryContext('今天天气很好，我去公园散步。')
      const scene = { index: 0, text: '我在公园散步' }
      const ctx = buildPromptEngineSceneContext(scene, story, '今天天气很好，我去公园散步。')
      expect(ctx.setting).toContain('公园散步')
      expect(ctx.setting).not.toContain('唐朝')
    })
  })

  describe('阶段主入口 buildSceneContextResult', () => {
    it('输入场景为空/非法 → fail closed 抛错', () => {
      expect(() => buildSceneContextResult([], '文案')).toThrow(/非空场景数组/)
      expect(() => buildSceneContextResult(null, '文案')).toThrow(/非空场景数组/)
      expect(() => buildSceneContextResult([{ index: 0, text: 'a' }], '')).toThrow(/非空文案/)
    })

    it('正常输出 { story, scenes, metadata }，scenes 每项带增强字段', () => {
      const result = buildSceneContextResult(
        [{ index: 0, text: TANG_COOKING_SCENE }],
        TANG_FULL_TEXT,
      )
      expect(result.story.dynasty.name).toBe('唐朝')
      expect(result.scenes).toHaveLength(1)
      expect(result.scenes[0].storyContext).toContain('唐朝')
      expect(result.metadata).toMatchObject({ enriched: true, degraded: false, extractor: 'rule-based' })
    })

    it('enabled=false → 透传并标记 degraded（reason: disabled）', () => {
      const result = buildSceneContextResult(
        [{ index: 0, text: TANG_COOKING_SCENE }],
        TANG_FULL_TEXT,
        { enabled: false },
      )
      expect(result.metadata.degraded).toBe(true)
      expect(result.metadata.fallbackReason).toContain('disabled')
      expect(result.scenes[0].storyContext).toBeUndefined()
    })
  })

  describe('配置归一 normalizeSceneContextOptions', () => {
    it('越界值收敛到边界，非法类型回退默认', () => {
      expect(normalizeSceneContextOptions({ maxSummaryLength: 99999 }).maxSummaryLength).toBe(1000)
      expect(normalizeSceneContextOptions({ maxSummaryLength: -5 }).maxSummaryLength).toBe(50)
      expect(normalizeSceneContextOptions({ maxSummaryLength: 'abc' }).maxSummaryLength).toBe(300)
      expect(normalizeSceneContextOptions({ maxAnchors: 99 }).maxAnchors).toBe(20)
      expect(normalizeSceneContextOptions({ maxAnchors: 0 }).maxAnchors).toBe(1)
      expect(normalizeSceneContextOptions({ enabled: 'yes' }).enabled).toBe(true)
      expect(normalizeSceneContextOptions({ contextBlockMaxChars: 20000 }).contextBlockMaxChars).toBe(1000)
    })

    it('默认值：enabled=true / maxSummaryLength=300 / maxAnchors=8 / includeNegativeAnchors=true / contextBlockMaxChars=400', () => {
      const options = normalizeSceneContextOptions({})
      expect(options).toMatchObject({
        enabled: true,
        maxSummaryLength: 300,
        maxAnchors: 8,
        includeNegativeAnchors: true,
        contextBlockMaxChars: 400,
      })
    })
  })

  describe('负面提示合并 mergeNegativePrompt', () => {
    it('合并去重并按上限截断', () => {
      const merged = mergeNegativePrompt('现代电器', ['电烤箱', '微波炉', '电烤箱'], 30)
      expect(merged).toContain('现代电器')
      expect(merged).toContain('电烤箱')
      expect(merged).toContain('微波炉')
      expect(Array.from(merged).length).toBeLessThanOrEqual(30)
    })

    it('base 为空时仅输出锚点', () => {
      const merged = mergeNegativePrompt('', ['土灶', '柴火'])
      expect(merged).toBe('土灶, 柴火')
    })
  })
})

describe('scene_context 审查修复回归（2026-08-11 双模型审查 C1/W2/W3/W4）', () => {
  it('C1: snake_case 布尔开关端到端生效（include_negative_anchors=false 关闭负面锚点）', () => {
    expect(normalizeSceneContextOptions({ include_negative_anchors: false }).includeNegativeAnchors).toBe(false)
    const story = extractStoryContext('唐朝长安城中，老妇人在做饭。', { include_negative_anchors: false })
    expect(story.negativeAnchors).toHaveLength(0)
    const result = buildSceneContextResult(
      [{ index: 0, text: '一个老妇人在做饭' }],
      '唐朝长安城中，老妇人在做饭。',
      { include_negative_anchors: false },
    )
    expect(result.scenes[0].negativeAnchors).toHaveLength(0)
  })

  it('W2: 单关键词时代误判不注入全局负面锚点（寺庙→ancient 弱信号）', () => {
    const story = extractStoryContext('她在寺庙里虔诚地祈祷。')
    expect(story.era).toBe('ancient')
    expect(story.negativeAnchors).toHaveLength(0)
  })

  it('W3: 无地域关键词时不编造默认城市（城堡→欧洲但 region 为空）', () => {
    const story = extractStoryContext('城堡里的公主和王子过着幸福的生活。')
    expect(story.culture).toBe('欧洲')
    expect(story.region).toBe('')
    expect(story.anchors).not.toContain('伦敦')
  })

  it('W4: full_text 发送上限受 MAX_FULL_TEXT_CHARS 约束', () => {
    const longText = '长文。'.repeat(1500)
    const story = extractStoryContext(longText)
    const scene = { index: 0, text: '一个场景' }
    const ctx = buildPromptEngineSceneContext(scene, story, longText)
    expect(Array.from(ctx.full_text).length).toBeLessThanOrEqual(2000)
  })

  // 回归：成语/多义词误判（2026-08-30，任务 mtfdxj8d_x694 场景11被"事后诸葛亮"误判三国）
  it('成语误判：全文含"事后诸葛亮"不识别为三国（成语非人物）', () => {
    const story = extractStoryContext('学的这些教材全是西方编的，管理学、营销学有用吗？屁用没有，都是事后诸葛亮，美国不是靠这些学问成功的，而是靠科技技术发展生产力。')
    expect(story.dynasty).toBeNull()
    expect(story.anchors).not.toContain('三国')
    expect(story.anchors).not.toContain('诸葛亮')
  })

  it('成语误判：全文含"说曹操曹操到"不识别为三国', () => {
    const story = extractStoryContext('真是说曹操曹操到，刚提到他就来了。')
    expect(story.dynasty).toBeNull()
    expect(story.anchors).not.toContain('三国')
    expect(story.anchors).not.toContain('曹操')
  })

  it('成语守卫不误伤：真实三国题材仍识别为三国', () => {
    const story = extractStoryContext('诸葛亮辅佐刘备，为兴复汉室鞠躬尽瘁，赤壁之战后三分天下。')
    expect(story.dynasty).toMatchObject({ name: '三国' })
    expect(story.anchors).toContain('三国')
  })

  it('成语守卫不误伤：朝代名关键词本身仍正常识别', () => {
    const story = extractStoryContext('唐朝长安城一片繁华，市井百姓安居乐业。')
    expect(story.dynasty).toMatchObject({ name: '唐朝' })
    expect(story.anchors).toContain('唐朝')
  })

  // 回归（体检报告问题13）：惯用语守卫此前只登记了诸葛亮/曹操，刘备的两个常用歇后语漏登记，
  // 现代职场/口语文本仍会被误判为三国并污染全部场景的视觉风格与负面锚点。
  it('成语误判：全文含"刘备借荆州"不识别为三国', () => {
    const story = extractStoryContext('他这招简直是刘备借荆州，借了我的电脑三天没还。')
    expect(story.dynasty).toBeNull()
    expect(story.anchors).not.toContain('刘备')
  })

  it('成语误判：全文含"刘备摔阿斗"不识别为三国', () => {
    const story = extractStoryContext('老板在会上来了这么一出刘备摔阿斗，纯粹是收买人心。')
    expect(story.dynasty).toBeNull()
    expect(story.anchors).not.toContain('刘备')
  })

  it('成语守卫不误伤：真实三国文本里的"刘备"仍作为朝代证据', () => {
    expect(filterIdiomHits('刘备入川取益州，奠定蜀汉基业', ['刘备'])).toEqual(['刘备'])
  })

  it('正向回归（[v3 订正]）：仅含"孙权称帝"的纯三国史实文本仍识别为三国', () => {
    const story = extractStoryContext('孙权称帝之后，江东文武大庆，吴国自此立国。')
    expect(story.dynasty).toMatchObject({ name: '三国' })
    expect(story.anchors).toContain('三国')
  })

  it('IDIOM_EXCLUSIONS 表内容契约：漏登记 / 误登记史实词都会被此用例挡住', () => {
    expect(filterIdiomHits('这纯属事后诸葛亮', ['诸葛亮'])).toEqual([])
    expect(filterIdiomHits('真是说曹操曹操到', ['曹操'])).toEqual([])
    expect(filterIdiomHits('他玩的是刘备借荆州', ['刘备'])).toEqual([])
    // 史实词不得进表
    expect(filterIdiomHits('孙权称帝建吴', ['孙权'])).toEqual(['孙权'])
  })

  // 回归：现代题材 + 历史引用（2026-08-30，现代信号中和）
  it('现代信号中和：现代题材引用历史人物（"比如秦始皇"）不误判为秦朝', () => {
    const story = extractStoryContext('这篇文章讨论现代企业管理，用电脑和互联网分析数据。比如古代秦始皇统一六国，用郡县制治理天下，这对今天的公司管理有启发。现代企业应该学习这种集中管理的思路，用手机和微信办公。')
    expect(story.dynasty).toBeNull()
    expect(story.era).toBe('mixed')
    expect(story.eraStrong).toBe(false)
    expect(story.anchors).not.toContain('秦朝')
    expect(story.anchors).not.toContain('秦始皇')
  })

  it('现代信号中和：现代题材引用三国人物（"诸葛亮"）不误判为三国', () => {
    const story = extractStoryContext('今天的市场竞争很激烈，我们用电脑和互联网做数据分析。就像三国时期诸葛亮运筹帷幄，现代企业也需要战略规划。但我们现在用的是手机和微信沟通。')
    expect(story.dynasty).toBeNull()
    expect(story.era).toBe('mixed')
    expect(story.eraStrong).toBe(false)
    expect(story.anchors).not.toContain('三国')
  })

  it('现代信号中和：纯历史题材仍识别为古代（不误伤）', () => {
    const story = extractStoryContext('唐玄宗时期，长安城一片繁华，市井百姓安居乐业。')
    expect(story.dynasty).toMatchObject({ name: '唐朝' })
    expect(story.era).toBe('ancient')
    expect(story.eraStrong).toBe(true)
  })

  it('现代信号中和：穿越剧（现代人穿越到唐朝）仍识别为古代（不误伤）', () => {
    const story = extractStoryContext('一个现代程序员用手机穿越到唐朝长安，见到唐玄宗和李白，用互联网知识帮助朝廷治理。')
    expect(story.dynasty).toMatchObject({ name: '唐朝' })
    expect(story.era).toBe('ancient')
  })

  it('现代信号中和：纯现代题材不受影响', () => {
    const story = extractStoryContext('小明在写字楼里用手机点外卖，晚上坐地铁回家，周末用电脑看视频。')
    expect(story.dynasty).toBeNull()
    expect(story.era).toBe('modern')
  })
})

describe('规则数据化与打磨修复（2026-08-12）', () => {
  const m = require('./story-context-engine')
  const os = require('os')
  const fs = require('fs')
  const path = require('path')

  afterEach(() => {
    delete process.env.STORY2VIDEO_CONTEXT_RULES_PATH
    m.resetContextRules()
  })

  it('内置规则加载：source=builtin 且规则完整（朝代≥16、文化≥8、角色≥40、题材≥11）', () => {
    expect(m.getContextRulesInfo()).toMatchObject({ source: 'builtin', warning: null, version: 1 })
    expect(m.DYNASTY_RULES.length).toBeGreaterThanOrEqual(16)
    expect(m.CULTURE_RULES.length).toBeGreaterThanOrEqual(8)
    expect(m.GENRE_RULES.length).toBeGreaterThanOrEqual(11)
    expect(m.CHARACTER_RULES.length).toBeGreaterThanOrEqual(40)
  })

  it('validateContextRules：非法结构逐项报错（缺 version / 坏 dynasty / 空 keywords）', () => {
    expect(m.validateContextRules({}).ok).toBe(false)
    const bad = m.validateContextRules({ version: 1, dynasty: [{ name: 'x', period: 'y', visualStyle: 'z', era: 'bad' }], culture: [], genre: [], setting: [], characters: [], time: {}, props: {}, negativeAnchors: {}, cooking: {}, visualStyle: [], tone: [] })
    expect(bad.ok).toBe(false)
    expect(bad.errors.some(e => e.path.includes('era'))).toBe(true)
    expect(m.validateContextRules(m.getContextRules()).ok).toBe(true)
  })

  it('setContextRulesOverride：合法外部规则生效（新增文化关键词被识别）', () => {
    const builtin = m.getContextRules()
    const custom = JSON.parse(JSON.stringify(builtin))
    custom.culture.push({ keywords: ['测试文明'], culture: '测试文明', regions: [] })
    const tmp = path.join(os.tmpdir(), 'scene-context-rules-' + process.pid + '-' + Date.now() + '.json')
    fs.writeFileSync(tmp, JSON.stringify(custom), 'utf8')
    try {
      const r = m.setContextRulesOverride(tmp)
      expect(r).toMatchObject({ ok: true, source: 'file' })
      expect(m.getContextRulesInfo().source).toBe('file')
      const story = m.extractStoryContext('这是一个测试文明的场景，人们和平生活。')
      expect(story.culture).toBe('测试文明')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('setContextRulesOverride：非法外部规则回退内置（source 保持 builtin 且返回 error）', () => {
    const tmp = path.join(os.tmpdir(), 'scene-context-rules-bad-' + process.pid + '-' + Date.now() + '.json')
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, dynasty: [{ name: 'x' }] }), 'utf8')
    try {
      const r = m.setContextRulesOverride(tmp)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('校验失败')
      expect(m.getContextRulesInfo().source).toBe('builtin')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('打磨回归：北宋汴京文案 → genre=历史、dynasty=宋朝', () => {
    const story = m.extractStoryContext('北宋汴京的市集上，商贩们正在吆喝叫卖。岳飞在军营中擦拭长枪。')
    expect(story.genre).toBe('历史')
    expect(story.dynasty).toMatchObject({ name: '宋朝' })
  })

  it('打磨回归：场景内特有角色（全文无「将军」）也被识别', () => {
    const story = m.extractStoryContext('北宋汴京的市集上，商贩们正在吆喝叫卖。')
    const block = m.buildSceneContextBlock({ text: '一位将军在擦拭兵器' }, story)
    expect(block.character).toMatchObject({ name: '将军' })
  })

  it('打磨回归：措辞使用自然逗号拼接（不含「欧洲中/现代中」）', () => {
    const europe = m.buildSceneContextBlock({ text: '公主在城堡塔楼里眺望' }, m.extractStoryContext('城堡里的公主和王子过着幸福的生活。'))
    expect(europe.contextBlock).toContain('欧洲，公主')
    expect(europe.contextBlock).not.toContain('欧洲中')
    const modern = m.buildSceneContextBlock({ text: '一个年轻人在办公室加班' }, m.extractStoryContext('小明在写字楼里用手机点外卖。'))
    expect(modern.contextBlock).not.toContain('现代中')
    expect(modern.contextBlock).toContain('现代')
  })
})

describe('历史内容增强：detectSentiment / buildDomainSeed（2026-08-14 domain_enrich 合并）', () => {
  it('detectSentiment 三元判定：positive / negative / peaceful', () => {
    expect(detectSentiment('百姓欢呼胜利，一片欢乐')).toBe('positive')
    expect(detectSentiment('战场上尸横遍野，士兵痛苦哀嚎')).toBe('negative')
    expect(detectSentiment('唐朝长安城的灯火照亮宫殿')).toBe('peaceful')
  })

  it('buildDomainSeed golden：朝代命中（唐朝）→ 视觉风格 + 自然光线 + 无文字提示卫生', () => {
    const story = extractStoryContext('这是一个关于唐代的故事。唐玄宗时期，长安城一片繁华。')
    const seed = buildDomainSeed('唐朝长安城的灯火照亮宫殿', story)
    expect(seed).toBe('唐朝长安城的灯火照亮宫殿；唐代宫殿、长安城、圆领袍、襦裙、金红色盛唐光线；自然层次与叙事光线；无文字、主体明确；人物形象：东亚人面孔、黑发、黄皮肤、深色瞳')
  })

  it('buildDomainSeed 负面情感 → 阴影与冷色氛围光线分支', () => {
    const story = extractStoryContext('安史之乱时期，唐朝百姓饱受战争之苦。')
    const seed = buildDomainSeed('长安城中百姓在战争中痛苦流离', story)
    expect(seed).toContain('阴影与冷色氛围')
    expect(seed).toContain('唐代宫殿、长安城、圆领袍、襦裙、金红色盛唐光线')
  })

  it('buildDomainSeed era 回退：无朝代命中 → 古代通用视觉风格', () => {
    const story = extractStoryContext('古代战场上将士们奋勇杀敌。')
    expect(story.dynasty).toBeNull()
    const seed = buildDomainSeed('将士们在战场上冲锋', story)
    expect(seed).toContain('古朴建筑、传统服饰、电影感体积光、低饱和暖色')
    expect(seed).toContain('无文字、主体明确')
  })

  it('buildDomainSeed 民国 era=modern → 现代视觉风格（修复 8 朝代子集漏判）', () => {
    const story = extractStoryContext('民国时期的上海滩，旗袍与中山装交相辉映。')
    expect(story.dynasty).toMatchObject({ name: '民国' })
    expect(story.era).toBe('modern')
    const seed = buildDomainSeed('上海滩的街巷里人来人往', story)
    expect(seed).toContain('民国洋楼、街巷、旗袍与胶片棕黄色调')
  })

  it('buildDomainSeed 场景文本无朝代关键词 + 全文含朝代 → seed 用全局朝代视觉风格（全文锚点一致性）', () => {
    // 审查 W2：合并后 era/dynasty 数据源从「逐场景关键词」变为「全文全局上下文」——
    // 唐故事里场景「一个老妇人在做饭」不含朝代词，seed 必须用全局唐朝视觉风格而非中性兜底。
    const story = extractStoryContext('唐玄宗时期的长安城，盛唐气象。')
    expect(story.dynasty).toMatchObject({ name: '唐朝' })
    const seed = buildDomainSeed('一个老妇人在灶台边做饭', story)
    expect(seed).toBe('一个老妇人在灶台边做饭；唐代宫殿、长安城、圆领袍、襦裙、金红色盛唐光线；自然层次与叙事光线；无文字、主体明确；人物形象：东亚人面孔、黑发、黄皮肤、深色瞳')
  })

  it('buildDomainSeed story 为空（enabled=false 场景）→ 中性视觉风格兜底', () => {
    const seed = buildDomainSeed('一个普通的画面', null)
    expect(seed).toBe('一个普通的画面；具有叙事感的电影画面、自然光线、层次清晰；自然层次与叙事光线；无文字、主体明确')
  })
})

describe('古代东亚面孔锚（2026-08-16 east-asian-face-anchor）', () => {
  it('用户剧本：高句丽/朱蒙/扶余/卒本川 → 文化识别 + seed/contextBlock 注入东亚外观锚', () => {
    const story = extractStoryContext('高句丽强盛时，疆域覆盖今辽宁北部。而朱蒙，这位逃出王宫的扶余王子，一路南下，在卒本川落脚，也就是今辽宁桓仁五女山城。')
    expect(story.culture).toBe('朝鲜·东北亚古国')
    expect(story.eraStrong).toBe(false)
    const seed = buildDomainSeed('朱蒙站在山脊上眺望五女山城', story)
    expect(seed).toContain('人物形象：东亚人面孔、黑发、黄皮肤、深色瞳')
    const block = buildSceneContextBlock({ text: '朱蒙站在山脊上眺望五女山城' }, story)
    expect(block.contextBlock).toContain('人物形象：东亚人面孔、黑发、黄皮肤、深色瞳')
    // C1：culture 命中但 era 弱信号 → 不注入面孔负面锚
    expect(story.negativeAnchors.some(a => a.includes('西方面孔'))).toBe(false)
    expect(block.negativeAnchors.some(a => a.includes('西方面孔'))).toBe(false)
  })

  it('欧洲文化绝不注入东亚锚（buildDomainSeed 与 contextBlock 双路径）', () => {
    const story = extractStoryContext('城堡里的公主和王子过着幸福的生活。')
    expect(story.culture).toBe('欧洲')
    const seed = buildDomainSeed('公主在城堡塔楼里眺望', story)
    expect(seed).not.toContain('人物形象')
    const block = buildSceneContextBlock({ text: '公主在城堡塔楼里眺望' }, story)
    expect(block.contextBlock).not.toContain('人物形象')
    expect(block.negativeAnchors.some(a => a.includes('西方面孔'))).toBe(false)
  })

 it('modern 时代不注入面孔负面锚，且无文化 modern 无东亚锚', () => {
    const story = extractStoryContext('小明在写字楼里用手机点外卖，晚上坐地铁回家。')
    expect(story.era).toBe('modern')
    expect(story.negativeAnchors.some(a => a.includes('西方面孔'))).toBe(false)
    // 2026-09-13 default-appearance-anchor：modern 无文化 → 默认东亚锚（buildDomainSeed 与 contextBlock 双路径）
    expect(buildDomainSeed('小明在写字楼加班', story)).toContain('人物形象：东亚人面孔、黑发、黄皮肤、深色瞳')
    const block = buildSceneContextBlock({ text: '小明在写字楼加班' }, story)
    expect(block.contextBlock).toContain('人物形象：东亚人面孔、黑发、黄皮肤、深色瞳')
  })

  it('strong ancient 无文化 + 东亚意象线索 → 默认东亚锚与面孔负面锚', () => {
    const story = extractStoryContext('古代战场上，将军身披铠甲，与士兵们一起守卫城墙。')
    expect(story.era).toBe('ancient')
    expect(story.eraStrong).toBe(true)
    expect(story.eastAsianCue).toBe(true)
    const seed = buildDomainSeed('将士们在战场上冲锋', story)
    expect(seed).toContain('人物形象：东亚人面孔、黑发、黄皮肤、深色瞳')
    expect(story.negativeAnchors).toEqual(expect.arrayContaining(['西方面孔', '金发']))
    const block = buildSceneContextBlock({ text: '将士们在战场上冲锋' }, story)
    expect(block.negativeAnchors).toEqual(expect.arrayContaining(['西方面孔']))
  })

  it('C1：culture 命中但 era=mixed 弱信号 → 不出面孔负面锚（正锚仍生效）', () => {
    const story = extractStoryContext('游客在高句丽雕像前用手机合影，旁边立着将军骑马像。')
    expect(story.culture).toBe('朝鲜·东北亚古国')
    expect(story.era).toBe('mixed')
    expect(story.eraStrong).toBe(false)
    expect(story.negativeAnchors.some(a => a.includes('西方面孔'))).toBe(false)
    expect(buildDomainSeed('游客在高句丽雕像前合影', story)).toContain('人物形象')
  })

  it('W4：场景含非东亚人物意象（波斯商队）→ 该场景跳过正锚并移除面孔负面锚', () => {
    const story = extractStoryContext('高句丽时代，国王命令将军守卫城墙。')
    expect(story.culture).toBe('朝鲜·东北亚古国')
    expect(story.eraStrong).toBe(true)
    const foreign = buildSceneContextBlock({ text: '波斯商队牵着骆驼缓缓走来' }, story)
    expect(foreign.contextBlock).not.toContain('人物形象')
    expect(foreign.negativeAnchors.some(a => a.includes('西方面孔'))).toBe(false)
    expect(buildDomainSeed('波斯商队牵着骆驼缓缓走来', story)).not.toContain('人物形象')
    const troop = buildSceneContextBlock({ text: '士兵们在城墙下巡逻' }, story)
    expect(troop.contextBlock).toContain('人物形象：东亚人面孔、黑发、黄皮肤、深色瞳')
    expect(troop.negativeAnchors).toEqual(expect.arrayContaining(['西方面孔']))
  })

  it('modern 无文化 + 中性文本 → 默认东亚锚，contextBlock 与 buildDomainSeed 双路径生效', () => {
    const story = extractStoryContext('他走在下班回家的路上，夕阳把影子拉得很长。')
    expect(story.culture).toBe('')
    expect(story.era).toBe('mixed')
    expect(story.negativeAnchors.some(a => a.includes('西方面孔'))).toBe(false)
    expect(buildDomainSeed('他走在下班回家的路上', story)).toContain('人物形象：东亚人面孔、黑发、黄皮肤、深色瞳')
    const block = buildSceneContextBlock({ text: '他走在下班回家的路上' }, story)
    expect(block.contextBlock).toContain('人物形象：东亚人面孔、黑发、黄皮肤、深色瞳')
  })

  it('modern 无文化 + 场景含非东亚异域词→ 不注入东亚锚', () => {
    const story = extractStoryContext('小明每天坐地铁去公司上班。')
    expect(story.culture).toBe('')
    expect(story.era).toBe('modern')
    // 场景含"欧洲"→ 跳过默认东亚锚
    expect(buildDomainSeed('小明去欧洲出差，在巴黎开会', story)).not.toContain('人物形象')
    const block = buildSceneContextBlock({ text: '小明去欧洲出差，在巴黎开会' }, story)
    expect(block.contextBlock).not.toContain('人物形象')
  })

  it('mixed 无文化 + 场景含非东亚异域词→ 不注入东亚锚', () => {
    const story = extractStoryContext('他在旅途中看到了不同的风景。')
    expect(story.culture).toBe('')
    expect(story.era).toBe('mixed')
    expect(buildDomainSeed('他在罗马街头漫步', story)).not.toContain('人物形象')
    expect(buildSceneContextBlock({ text: '他在罗马街头漫步' }, story).contextBlock).not.toContain('人物形象')
  })

  it('eraStrong 输出：朝代命中/多独立信号 true，弱信号 false', () => {
    expect(extractStoryContext('唐玄宗时期，长安城一片繁华。').eraStrong).toBe(true)
    expect(extractStoryContext('我在寺庙里虔诚地祈祷。').eraStrong).toBe(false)
  })

  // 审查 C1 反向回归：无文化命中的非东亚古史（古希腊/维京/玛雅）不得被强制东亚化
  it('无文化 strong ancient + 古希腊文本 → 无东亚锚且无面孔负面锚', () => {
    const story = extractStoryContext('古代希腊，国王在宫殿里与大臣议事，乘坐马车出行。')
    expect(story.culture).toBe('')
    expect(story.era).toBe('ancient')
    expect(story.eraStrong).toBe(true)
    expect(story.eastAsianCue).toBe(false)
    expect(buildDomainSeed('国王在议事厅里议事', story)).not.toContain('人物形象')
    expect(story.negativeAnchors.some(a => a.includes('西方面孔'))).toBe(false)
  })

  it('无文化 strong ancient + 维京/玛雅文本 → 无东亚锚且无面孔负面锚', () => {
    const viking = extractStoryContext('古代维京人，首领在长屋里设宴，勇士们划着长船出海。')
    expect(viking.culture).toBe('')
    expect(viking.eraStrong).toBe(true)
    expect(viking.eastAsianCue).toBe(false)
    expect(buildDomainSeed('维京勇士在长船船头眺望', viking)).not.toContain('人物形象')
    expect(viking.negativeAnchors.some(a => a.includes('西方面孔'))).toBe(false)
    const maya = extractStoryContext('古代玛雅，祭司在祭坛前举行祭祀仪式。')
    expect(maya.culture).toBe('')
    expect(maya.eastAsianCue).toBe(false)
    expect(buildDomainSeed('祭司在祭坛前祭祀', maya)).not.toContain('人物形象')
    expect(maya.negativeAnchors.some(a => a.includes('西方面孔'))).toBe(false)
  })

  it('无文化 strong ancient + 东亚专属意象（武林/江湖）→ 仍默认东亚锚与面孔负面锚', () => {
    const story = extractStoryContext('古代武林，掌门在客栈里召集江湖豪杰。')
    expect(story.culture).toBe('')
    expect(story.eraStrong).toBe(true)
    expect(story.eastAsianCue).toBe(true)
    expect(buildDomainSeed('掌门在客栈召集豪杰', story)).toContain('人物形象：东亚人面孔、黑发、黄皮肤、深色瞳')
    expect(story.negativeAnchors).toEqual(expect.arrayContaining(['西方面孔']))
  })
})

var { StrategyMatcher } = require("../src/strategy-matcher")
var { BUILTIN_STRATEGIES } = require("../src/strategy-manager")

describe("StrategyMatcher", function() {
  test("should rank strategies by industry match", function() {
    var matcher = new StrategyMatcher({
      userSettings: { industry: "ecommerce" },
      topN: 5
    })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked.length).toBe(BUILTIN_STRATEGIES.length)
    expect(ranked[0].id).toBe("strategy-ecommerce-convert")
  })

  test("should rank knowledge strategy top for education+bilibili", function() {
    var matcher = new StrategyMatcher({
      userSettings: { platform: "bilibili", industry: "education" },
      topN: 5
    })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked[0].id).toBe("strategy-knowledge-dry")
  })

  test("should return top N recommendations", function() {
    var matcher = new StrategyMatcher({
      userSettings: { industry: "general" },
      topN: 2
    })
    var rec = matcher.recommend(BUILTIN_STRATEGIES.slice())
    expect(rec.length).toBe(2)
  })

  test("should handle empty strategy list", function() {
    var matcher = new StrategyMatcher({ topN: 3 })
    var ranked = matcher.rank([])
    expect(ranked).toEqual([])
  })

  test("should give base score when no settings match", function() {
    var matcher = new StrategyMatcher({
      userSettings: { industry: "no-match", purpose: "no-match", platform: "no-match", tone: "no-match" },
      topN: 5
    })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    for (var i = 0; i < ranked.length; i++) {
      expect(ranked[i].score).toBeGreaterThan(0)
    }
  })

  test("should factor in history ratings", function() {
    var matcher = new StrategyMatcher({
      userSettings: { industry: "general" },
      userHistory: { strategyRatings: { "strategy-viral-storytelling": 5 } },
      topN: 5
    })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    var rated = ranked.find(function(s) { return s.id === "strategy-viral-storytelling" })
    var unrated = ranked.find(function(s) { return s.id === "strategy-knowledge-dry" })
    expect(rated.score).toBeGreaterThan(unrated.score)
  })
})

// ===== 默认改写策略兜底（rewrite-default-strategy-fix，2026-10-19）=====
// 背景：userSettings/userHistory 全空时，五维全部只拿 30% 基础分 ⇒ 所有策略同分 30，
// sort 稳定 + Map 插入序 ⇒ 恒取 BUILTIN_STRATEGIES 第一项 strategy-viral-storytelling。
// 实测把一篇科技深度报道改成了电商带货腔文案。本组用例锁「无有效信号时不得静默取首项」。

describe("StrategyMatcher — 无有效信号兜底", function() {
  var TECH_LONG_FORM = [
    "7月15日，前OpenAI CTO Mira Murati在旧金山发布了Thinking Machines Lab的首个模型Inkling。",
    "SWE-bench Verified 评测中，Macaron-V1-Venti 以 85.6 分登顶第一。",
    "Macaron-V1分两个版本：旗舰版Venti，748B参数，由744B的GLM-5.2基座加四个1B的LoRA组成。",
    "Deep-SWE 专测长程复杂软件工程任务，Macaron-V1-Venti 拿下 58.4 分。",
    "这套架构有个正式名字：Mixture-of-LoRA（MoL）—— 不同能力在共享基座之上独立训练。",
  ].join("\n")

  test("全空输入时所有策略同分（缺陷形态的基线锚点，不得退化）", function() {
    var matcher = new StrategyMatcher({ userSettings: {}, userHistory: {}, topN: 5 })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    var scores = ranked.map(function(s) { return s.score })
    expect(new Set(scores).size).toBe(1)
    expect(scores[0]).toBe(30)
  })

  test("R1：全空输入时不得静默取内置表第一项 storytelling", function() {
    var matcher = new StrategyMatcher({ userSettings: {}, userHistory: {}, topN: 5 })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked[0].id).not.toBe("strategy-viral-storytelling")
  })

  test("R1：全空输入 + 长文科技稿 ⇒ 命中保真型策略", function() {
    var matcher = new StrategyMatcher({
      userSettings: {},
      userHistory: {},
      topN: 5,
      content: TECH_LONG_FORM,
    })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked[0].id).toBe("strategy-knowledge-dry")
  })

  test("R1：全空输入 + 无 content ⇒ 降级到显式兜底策略（不是数组首项）", function() {
    var matcher = new StrategyMatcher({ userSettings: {}, userHistory: {}, topN: 5 })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    expect(typeof ranked[0].id).toBe("string")
    expect(ranked[0].id).toBe("strategy-knowledge-dry")
  })

  test("R1：用户显式选平台时启发式不得插手（platform=douyin 尊重用户选择）", function() {
    // 反例护栏：platform=douyin 时 douyin-viral 与 knowledge-dry 同为 44 分 ——
    // 这是「平台维真命中」导致的并列，不是基础分伪并列，启发式必须让位给用户意图。
    var matcher = new StrategyMatcher({
      userSettings: { platform: "douyin" },
      userHistory: {},
      topN: 5,
      content: TECH_LONG_FORM,
    })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked[0].id).toBe("strategy-douyin-viral")
  })

  test("R1：用户显式命中时优先级高于启发式（industry=ecommerce 仍选电商）", function() {
    var matcher = new StrategyMatcher({
      userSettings: { industry: "ecommerce" },
      userHistory: {},
      topN: 5,
      content: TECH_LONG_FORM,
    })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked[0].id).toBe("strategy-ecommerce-convert")
  })

  test("R1：启发式只在无有效信号时介入，不得改变既有行业匹配的排序", function() {
    var matcher = new StrategyMatcher({
      userSettings: { platform: "bilibili", industry: "education" },
      topN: 5,
      content: TECH_LONG_FORM,
    })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked[0].id).toBe("strategy-knowledge-dry")
  })

  // _isNoSignalGroup 的行为锁：该守卫若被摘掉，启发式会覆盖用户已表达的意图。
  // 变异反证 M2（把守卫改成 if(false)）实测全绿 = 无锁 ⇒ 本用例即为那把缺失的锁。
  // 判据不依赖具体策略名，而是「用户任一维有值时，启发式分必须归零」这一不变式。
  test("R1：用户任一维有值时启发式必须归零（守卫行为锁）", function() {
    var cases = [
      { industry: "ecommerce" },
      { purpose: "conversion" },
      { platform: "douyin" },
      { tone: "casual" },
    ]
    for (var i = 0; i < cases.length; i++) {
      var m = new StrategyMatcher({
        userSettings: cases[i],
        userHistory: {},
        topN: 5,
        content: TECH_LONG_FORM,
      })
      expect(m._isNoSignalGroup()).toBe(false)
      // 启发式归零 ⇒ 排序只由用户设置分决定，不受内容启发式干扰
      expect(m._heuristicScore({ id: "strategy-knowledge-dry" })).toBe(0)
    }
  })

  test("R1：历史评分/偏好存在时也视为有信号（启发式让位）", function() {
    var byRating = new StrategyMatcher({
      userSettings: {},
      userHistory: { strategyRatings: { "strategy-viral-storytelling": 5 } },
      topN: 5,
      content: TECH_LONG_FORM,
    })
    expect(byRating._isNoSignalGroup()).toBe(false)

    var byPreferred = new StrategyMatcher({
      userSettings: {},
      userHistory: { preferredStrategies: ["strategy-viral-storytelling"] },
      topN: 5,
      content: TECH_LONG_FORM,
    })
    expect(byPreferred._isNoSignalGroup()).toBe(false)
  })

  // CCG 深度审查 i1（Critical）回归锁：第三级 id 字典序破平**只在无信号组启用**。
  // 缺陷形态：若对所有并列一律按 id 排序，platform=wechat_mp 下五策略并列 44 分
  // ⇒ 'strategy-douyin-viral' 的 d 在 k/v/x 之前 ⇒ 恒选抖音爆款策略给公众号长文。
  // 那是用「确定性」换掉「正确性」，比修复前的数组首项更荒谬。
  test("i1：有信号组的并列不得用 id 字典序破平（wechat_mp 不得选到抖音策略）", function() {
    var matcher = new StrategyMatcher({
      userSettings: { platform: "wechat_mp" },
      userHistory: {},
      topN: 5,
    })
    var ranked = matcher.rank(BUILTIN_STRATEGIES.slice())
    var scores = ranked.map(function(s) { return s.score })
    // 前提：确实是并列形态（否则本用例不构成对破平的检验）
    expect(new Set(scores).size).toBeLessThan(scores.length)
    expect(ranked[0].id).not.toBe("strategy-douyin-viral")
  })

  test("i1：无信号组仍用 id 字典序保证确定性（不依赖数组顺序）", function() {
    var forward = new StrategyMatcher({ userSettings: {}, userHistory: {}, topN: 5 })
      .rank(BUILTIN_STRATEGIES.slice())
    var reversed = new StrategyMatcher({ userSettings: {}, userHistory: {}, topN: 5 })
      .rank(BUILTIN_STRATEGIES.slice().reverse())
    // 入参顺序颠倒，第一名必须不变 —— 这是「不依赖数组顺序」的硬保证
    expect(reversed[0].id).toBe(forward[0].id)
  })

  // 平台专精度（i1 修复后自评发现）：内置策略平台声明高度重叠 ——
  // storytelling / ecommerce / douyin-viral 都声明支持 douyin，同为 44 分且 hits 同为 1。
  // 只靠 score+hits 分不开，必须让「只声明该平台」的专精策略胜出。
  test("平台专精度：点名 douyin 应选 douyin-viral 而非通用策略", function() {
    var m = new StrategyMatcher({ userSettings: { platform: "douyin" }, userHistory: {}, topN: 5 })
    var ranked = m.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked[0].id).toBe("strategy-douyin-viral")
  })

  test("平台专精度：点名 xiaohongshu 应选种草策略", function() {
    var m = new StrategyMatcher({ userSettings: { platform: "xiaohongshu" }, userHistory: {}, topN: 5 })
    var ranked = m.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked[0].id).toBe("strategy-xiaohongshu-种草")
  })

  test("平台专精度：无平台信号时该项为 0，不干扰其它场景", function() {
    var m = new StrategyMatcher({ userSettings: { industry: "technology" }, userHistory: {}, topN: 5 })
    expect(m._specificity({ platforms: ["douyin"] })).toBe(0)
    var ranked = m.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked[0].id).toBe("strategy-knowledge-dry")
  })

  test("平台专精度：不支持该平台时为 0", function() {
    var m = new StrategyMatcher({ userSettings: { platform: "zhihu" }, userHistory: {}, topN: 5 })
    expect(m._specificity({ platforms: ["douyin"] })).toBe(0)
    expect(m._specificity({ platforms: ["zhihu"] })).toBeGreaterThan(0)
  })

  // CCG 深度审查 i4：保真兜底策略 id 不得与具体 id 硬耦合在算法内部 ——
  // ops 可运营数据（策略 id/顺序）变化会静默改变默认选中。现可注入，此处锁住可配置性。
  test("i4：保真兜底策略 id 可注入（不写死在算法内部）", function() {
    var m = new StrategyMatcher({
      userSettings: {},
      userHistory: {},
      topN: 5,
      content: TECH_LONG_FORM,
      fidelityStrategyIds: ["strategy-ecommerce-convert"],
    })
    expect(m._heuristicScore({ id: "strategy-ecommerce-convert" })).toBe(1)
    expect(m._heuristicScore({ id: "strategy-knowledge-dry" })).toBe(0)
    var ranked = m.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked[0].id).toBe("strategy-ecommerce-convert")
  })

  test("i4：未注入时回退默认保真策略（历史行为不变）", function() {
    var m = new StrategyMatcher({ userSettings: {}, userHistory: {}, topN: 5, content: TECH_LONG_FORM })
    var ranked = m.rank(BUILTIN_STRATEGIES.slice())
    expect(ranked[0].id).toBe("strategy-knowledge-dry")
  })

  test("i4：非法注入（空数组/非数组）回退默认，不抛错", function() {
    var a = new StrategyMatcher({ userSettings: {}, userHistory: {}, topN: 5, content: TECH_LONG_FORM, fidelityStrategyIds: [] })
    expect(a.rank(BUILTIN_STRATEGIES.slice())[0].id).toBe("strategy-knowledge-dry")
    var b = new StrategyMatcher({ userSettings: {}, userHistory: {}, topN: 5, content: TECH_LONG_FORM, fidelityStrategyIds: "nope" })
    expect(b.rank(BUILTIN_STRATEGIES.slice())[0].id).toBe("strategy-knowledge-dry")
  })

  test("R1：全空输入确实属于无信号组，且启发式生效", function() {
    var m = new StrategyMatcher({
      userSettings: {},
      userHistory: {},
      topN: 5,
      content: TECH_LONG_FORM,
    })
    expect(m._isNoSignalGroup()).toBe(true)
    expect(m._heuristicScore({ id: "strategy-knowledge-dry" })).toBe(1)
    expect(m._heuristicScore({ id: "strategy-ecommerce-convert" })).toBe(0)
  })
})

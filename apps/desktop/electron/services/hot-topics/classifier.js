// @ts-check
/**
 * 热门选题分类器 v3 — 原生映射分置信度 + 强/弱词打分 + 多标签
 *
 * 分类体系（11 类，顺序即 UI 默认排序）：
 *   general(综合) society(社会) finance(财经) tech(科技) ai(AI) entertainment(娱乐)
 *   sports(体育) emotion(情感) education(教育) health(健康) international(国际)
 *
 * v3 变更（修复「科技类混入不沾边内容」的四条机制级根因 + 新增 AI 分类）：
 *   1. **原生映射分两级置信度**。`RAW_CATEGORY_MAP` 是可信原生分类（榜单给什么就是什么，
 *      如头条「财经」）；`RAW_CATEGORY_WEAK_MAP` 是**宽泛桶**——它只代表「这个分区大概聊什么」，
 *      不能代表单条选题。宽泛桶仅在关键词零命中时兜底，关键词有信号时一律让位。
 *      被降级为宽泛桶的实测错配源：B站「知识」区（历史/法律/职场/财经混装）、
 *      「科学科普」（恐龙/地质/生物混装）、「汽车」（汽车 ≠ 科技）。
 *   2. **关键词分强弱**。strong 权重 = 词长 × 2，weak 权重 = 词长。分类名本身
 *      （科技/财经/健康…）与专有术语进 strong；泛化词（消费/比赛/父母…）进 weak。
 *   3. **MIN_SCORE 阈值**：总分低于阈值视为「无判别力信号」，不分类而是回落原生兜底或
 *      general。这让单个双字弱词不再单独成类（v2 的 `score += kw.length` 会让
 *      「消费」这类词把一条无关选题固定判进 finance）。
 *   4. **拉丁词走词边界匹配**（`_matchesLatin`）：v2 的 `text.includes('AI')` 是裸子串匹配，
 *      会命中 `AIR`/`said` 等；v3 要求前后不是 [A-Za-z0-9]。
 *
 * 兼容性：`classifyTopic` 仍返回单字符串（v1 契约），既有调用方零改动。
 * 跨端契约：`CATEGORY_KEYS` 的顺序必须与
 *   `apps/desktop/electron/services/content-categories.js`、
 *   `apps/desktop/src/features/content/content-categories.js`、
 *   `ops-center/backend/services/content_category_service.py` 的 CATALOG 严格一致。
 */

/**
 * 11 分类枚举。
 * ai 紧随 tech：AI 是从科技里切出来的子域，二者在 UI 上相邻便于对照。
 */
const CATEGORY_KEYS = [
  'general', 'society', 'finance', 'tech', 'ai', 'entertainment',
  'sports', 'emotion', 'education', 'health', 'international',
]

/**
 * 渠道原生分类 → 分类枚举（**可信原生**，优先于关键词）。
 * key 归一化：trim + toLowerCase；未命中先查通用名词表，再走关键词规则。
 */
const RAW_CATEGORY_MAP = {
  // 今日头条 hot-board 的 Category 字段（实测枚举；2026-09 起该字段偶发缺失，缺失走关键词兜底）
  toutiao: {
    '社会': 'society', '国际': 'international',
    '财经': 'finance', '科技': 'tech', '娱乐': 'entertainment',
    '体育': 'sports', '教育': 'education', '健康': 'health',
    '军事': 'international', '游戏': 'entertainment',
  },
  // 腾讯新闻 hot_ranking_list 领域字段（注意：线上 chlid 多为数字 ID，命中的是文本领域名）
  tencent: {
    '社会': 'society', '国际': 'international', '财经': 'finance',
    '科技': 'tech', '娱乐': 'entertainment', '体育': 'sports',
    '教育': 'education', '健康': 'health', '军事': 'international',
  },
  // 微博热搜 hot_band 的 category 字段（实测 2026-09 枚举 + v2 扩容）
  weibo: {
    '数码': 'tech', '电竞': 'entertainment', '国内时政': 'society',
    '演出': 'entertainment', '互联网': 'tech', '剧集': 'entertainment',
    '综艺': 'entertainment', '民生新闻': 'society', '体育': 'sports',
    '健康医疗': 'health', '舆论监督': 'society', '游戏': 'entertainment',
    '情感': 'emotion', '艺人': 'entertainment',
    '音乐': 'entertainment', '电影': 'entertainment', '电视剧': 'entertainment',
    '教育': 'education', '校园': 'education', '职场': 'society',
    '法律': 'society', '军事': 'international', '国际': 'international',
    '财经': 'finance', '股票': 'finance', '房地产': 'finance',
    '健身': 'health', '养生': 'health', '育儿': 'emotion',
  },
  // B站热门 tname 分区名（实测 2026-09，常见分区 → 分类映射；未命中分区走关键词规则）
  bilibili: {
    '科技': 'tech', '数码': 'tech', '软件应用': 'tech',
    '校园学习': 'education',
    '手机游戏': 'entertainment', '单机游戏': 'entertainment', '电子竞技': 'entertainment',
    '游戏': 'entertainment', '国产动画': 'entertainment', '影视杂谈': 'entertainment',
    '电影': 'entertainment', '电视剧': 'entertainment', '综艺': 'entertainment',
    '音乐综合': 'entertainment', '演奏': 'entertainment', '鬼畜剧场': 'entertainment',
    '同人·手书': 'entertainment', '小剧场': 'entertainment',
    '体育': 'sports', '社会': 'society', '搞笑': 'entertainment',
  },
}

/**
 * 宽泛原生分类 → 分类枚举（**弱置信**，仅关键词零命中时兜底）。
 *
 * 这些桶的共同特征：一个分类名下面混装了多个内容域，把它整体映射成某个分类必然产生
 * 「分类下有不沾边内容」。典型：B站「知识」区（历史/法律/职场/财经/科普混装）曾被
 * 整批映射成 tech，是「科技类混入不沾边内容」的头号来源。
 */
const RAW_CATEGORY_WEAK_MAP = {
  toutiao: {
    '热点': 'general', '汽车': 'general', '旅游': 'general',
  },
  weibo: {
    '汽车': 'general', '科学科普': 'general', '幽默': 'entertainment',
    '美食': 'general', '旅游': 'general', '宠物': 'general',
    '时尚': 'general', '美妆': 'general',
  },
  bilibili: {
    '知识': 'general', '科学科普': 'general', '人文历史': 'general',
    '预告·资讯': 'general', '日常': 'general', '生活': 'general',
    '美食制作': 'general', '美食记录': 'general', '美食侦探': 'general',
    '亲子': 'general', '动物二创': 'general', '出行': 'general', '手工': 'general',
  },
}

/**
 * 通用原生分类名词表：任意渠道的 category 字段直接写分类中文名时全渠道生效。
 * （百度垂类 tab、新浪财经 rawCategory='财经'、IT之家 rawCategory='科技' 等）
 */
const GENERIC_RAW_MAP = {
  '综合': 'general', '社会': 'society', '财经': 'finance', '科技': 'tech',
  '娱乐': 'entertainment', '体育': 'sports', '情感': 'emotion',
  '教育': 'education', '健康': 'health', '国际': 'international',
  'ai': 'ai', '人工智能': 'ai', 'AI': 'ai',
}

/**
 * 关键词词表（打分制）。
 *   strong：命中权重 = 词长 × STRONG_MULT —— 分类名本身与专有术语，判别力强；
 *   weak  ：命中权重 = 词长 —— 泛化词，需要与其它词叠加才足以成类。
 * 并列时按本数组声明顺序取主标签（V8 Array#sort 稳定）。
 */
const KEYWORD_RULES = [
  {
    category: 'ai',
    strong: [
      '人工智能', '大模型', '大语言模型', '生成式', 'AIGC', 'AGI', '多模态',
      '深度学习', '神经网络', '机器学习', '智能体', '算力', '智算',
      'AI芯片', 'AI绘画', 'AI视频', 'AI编程', 'AI手机', 'AI眼镜',
      '提示词', 'ChatGPT', 'GPT', 'OpenAI', 'DeepSeek', 'Claude', 'Gemini',
      'Midjourney', 'Stable Diffusion', 'Sora', 'Llama', 'Transformer', '英伟达',
      'AI',
    ],
    weak: [
      '豆包', '通义', '文心一言', 'Kimi', '智谱', '模型训练',
      '训练数据', '算法工程师', '推理成本', 'token',
    ],
  },
  {
    category: 'international',
    strong: [
      '外交部', '联合国', '北约', '欧盟', '制裁', '关税战', '撤侨', '大使馆',
      '白宫', '克里姆林宫', '俄乌冲突', '中东局势', '巴以', '朝鲜半岛',
      '台海', '中美关系', '中欧关系', '外交', '领土', '边境冲突', '军事演习',
      '国务院', '首相', '总统',
    ],
    weak: [
      '美国', '日本', '韩国', '俄罗斯', '乌克兰', '伊朗', '以色列', '巴勒斯坦',
      '朝鲜', '印度', '英国', '法国', '德国', '加拿大', '澳大利亚', '巴西',
      '国际', '海外', '全球', '峰会', '会谈', '访问', '难民',
    ],
  },
  {
    category: 'society',
    strong: [
      '警方', '法院', '检察院', '审判', '判决', '判刑', '嫌疑人', '拘留',
      '逮捕', '案发', '事故', '遇难', '身亡', '救援', '通报', '调查',
      '犯罪', '违法', '维权', '民生', '地震', '台风', '洪水', '火灾',
      '塌方', '爆炸', '失联', '寻人', '拐卖', '诈骗', '反腐', '落马', '纪委',
    ],
    weak: [
      '社会', '就业', '工资', '退休', '社保', '邻里', '纠纷', '物业',
      '业主', '城管', '赔偿', '法律', '律师', '打工人',
    ],
  },
  {
    category: 'finance',
    strong: [
      '股票', '股市', '股价', 'A股', '港股', '美股', '基金', '利率', '央行',
      '汇率', '人民币', '通胀', 'GDP', '财报', '营收', '净利润',
      'IPO', '融资', '市值', '涨停', '跌停', '楼市', '房价', '房地产',
      '关税', '外贸', '降准', '降息', '养老金', '债券', '经济', '金融',
      '新股', '上市公司', 'CPI', '物价',
    ],
    weak: [
      '银行', '投资', '理财', '消费', '税收', '黄金', '原油', '期货',
      '板块', '指数', '沪指', '创业板', '北交所', '财经',
      // 「上市」是跨域泛词（「新款车型上市」「新机上市」都不是财经）→ 降级为弱词，
      // 需与其它财经词叠加才成类（调研 B7 实测反例）
      '上市',
    ],
  },
  {
    category: 'tech',
    strong: [
      '科技', '芯片', '半导体', '光刻机', '操作系统', '浏览器', '数据库',
      '云计算', '区块链', '量子计算', '航天', '火箭', '卫星', '空间站',
      '探月', '火星', '自动驾驶', '新能源', '光伏', '储能', '电池',
      '5G', '6G', '通信', '开源', '程序员', '算法', '机器人',
      '人形机器人', '数码', '智能手机', 'GPU', '显卡', '折叠屏',
    ],
    weak: [
      '手机', '电脑', '笔记本', '互联网', '软件', '硬件', '黑科技',
      '无人机', '相机', '屏幕', '发布会', '科技圈',
    ],
  },
  {
    category: 'entertainment',
    strong: [
      '明星', '综艺', '电影', '电视剧', '演唱会', '票房', '偶像', '选秀',
      '歌手', '演员', '导演', '娱乐圈', '粉丝', '动漫', '动画', '影视',
      '剧组', '杀青', '官宣', '恋情', '绯闻', '红毯', '音乐节', '娱乐',
    ],
    weak: [
      '音乐', '游戏', '节目', '舞台', '歌曲', '专辑', '演出', '巡演', '剧集',
    ],
  },
  {
    category: 'sports',
    strong: [
      '足球', '篮球', '男篮', '女篮', '男足', '女足', '奥运', '世界杯',
      '欧洲杯', '亚洲杯', '冠军', '联赛', '球员', '教练', '夺冠', '金牌',
      '银牌', 'NBA', 'CBA', '国足', '运动员', '决赛', '半决赛', '世预赛',
      '中超', '英超', '西甲', '德甲', '意甲', '网球', '乒乓球', '羽毛球',
      '游泳', '田径', '马拉松', '体育', '电竞',
    ],
    weak: [
      '比赛', '赛季', '球队', '球迷', '比分', '转会', '赛事', '主场', '客场',
    ],
  },
  {
    category: 'emotion',
    strong: [
      '恋爱', '婚姻', '离婚', '结婚', '相亲', '情感', '爱情', '分手',
      '出轨', '婆媳', '亲子', '情侣', '表白', '失恋', '订婚', '彩礼',
      '家暴', '单亲', '原生家庭', '婚恋', '谈恋爱',
    ],
    weak: [
      '家庭', '父母', '孩子', '夫妻', '老公', '老婆', '男朋友', '女朋友',
      '婆婆', '丈母娘', '吵架', '育儿', '带娃',
    ],
  },
  {
    category: 'education',
    strong: [
      '高考', '中考', '考研', '考公', '考编', '开学', '毕业', '大学',
      '中学', '小学', '幼儿园', '招生', '录取', '分数线', '学费', '教师',
      '校园', '学生', '教育部', '双减', '留学', '保研', '毕业论文', '军训',
    ],
    weak: [
      '学校', '老师', '班级', '课堂', '课程', '培训', '考试', '成绩',
      '学位', '学历', '考生', '教育',
    ],
  },
  {
    category: 'health',
    strong: [
      '医院', '疫苗', '养生', '健康', '疾病', '疫情', '病毒', '癌症',
      '体检', '医生', '药品', '减肥', '健身', '卫健委', '疾控', '新药',
      '门诊', '手术', '医疗', '医保', '流感', '发热', '感染', '确诊',
      '中医', '血压', '血糖', '肿瘤', '抑郁症', '近视',
    ],
    weak: [
      '治疗', '康复', '营养', '免疫力', '患者', '义诊', '睡眠', '并发症',
    ],
  },
]

/** strong 关键词权重倍数 */
const STRONG_MULT = 2

/**
 * 成类最低分。双字弱词 = 2 分，双字强词 = 4 分。
 * 取 3 的语义：**单个双字弱词不足以成类**，需要强词或两个以上弱词叠加。
 */
const MIN_SCORE = 3

const LATIN_ONLY_RE = /^[A-Za-z0-9]+$/

/** 全角 ASCII（U+FF01–U+FF5E）→ 半角：中文输入法下「ＡＩ」很常见，不做归一会漏判 */
const FULLWIDTH_OFFSET = 0xFEE0

/**
 * 关键词匹配前的文本归一轮（当前只做全角→半角；不改动 CJK 字符本身）。
 * @param {string} text
 */
function normalizeForMatch (text) {
  return String(text || '').replace(/[\uFF01-\uFF5E]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - FULLWIDTH_OFFSET))
}

/**
 * 关键词命中判定。
 * 拉丁/数字词走词边界（前后不得是 [A-Za-z0-9]），中文词走子串包含。
 * @param {string} text 已归一化并小写化的文本
 * @param {string} kw 原始关键词
 */
function _matchesLatin (text, kw) {
  const k = kw.toLowerCase()
  let from = 0
  for (;;) {
    const i = text.indexOf(k, from)
    if (i === -1) return false
    const before = i > 0 ? text[i - 1] : ''
    const after = i + k.length < text.length ? text[i + k.length] : ''
    const boundary = (c) => c === '' || !/[a-z0-9]/.test(c)
    if (boundary(before) && boundary(after)) return true
    from = i + 1
  }
}

/**
 * 文本是否命中关键词（中文子串 / 拉丁词边界）。
 * @param {string} rawText 原文
 * @param {string} lowerText 小写化文本
 * @param {string} kw
 */
function matchesKeyword (rawText, lowerText, kw) {
  return LATIN_ONLY_RE.test(kw) ? _matchesLatin(lowerText, kw) : rawText.includes(kw)
}

/**
 * 关键词打分：返回按得分降序（并列保持规则优先级）的分类命中列表。
 * 低于 MIN_SCORE 的命中视为无判别力信号，直接丢弃。
 * @param {string} text
 * @returns {Array<{category: string, score: number}>}
 */
function _scoreKeywords (text) {
  const rawText = normalizeForMatch(text)
  const lowerText = rawText.toLowerCase()
  const hits = []
  for (const rule of KEYWORD_RULES) {
    let score = 0
    for (const kw of rule.strong) {
      if (matchesKeyword(rawText, lowerText, kw)) score += kw.length * STRONG_MULT
    }
    for (const kw of rule.weak) {
      if (matchesKeyword(rawText, lowerText, kw)) score += kw.length
    }
    if (score >= MIN_SCORE) hits.push({ category: rule.category, score })
  }
  hits.sort((a, b) => b.score - a.score) // V8 Array#sort 稳定，并列时保持 KEYWORD_RULES 声明顺序
  return hits
}

/**
 * 「域级泛称」原生分类：这些字符串是**整个栏目的名字**，不是单条选题的定性。
 * 一个「科技」栏目里必然混入与科技无关的条目（用户实测反馈的第一症状），
 * 因此它们不得作为主标签，也不得在关键词零命中时兜底 —— 此时落 general（综合）
 * 比落 tech 更不容易误导用户。`数码`/`软件应用`/`半导体`/`人工智能` 这类
 * **内容域明确**的原生分类不在此列，仍是可信原生。
 */
const DOMAIN_LEVEL_RAW = new Set([
  '科技', '互联网', '科学科普', '知识', '资讯', '热点',
])

/**
 * 渠道原生分类映射：可信表 → 通用名词表（皆强）→ 宽泛表（弱）；未命中返回 null。
 * 域级泛称（DOMAIN_LEVEL_RAW）不提供任何原生信息，一律返回 null —— 该条目的分类
 * 完全交由关键词裁决；关键词也无信号时落 general（综合）。
 * @param {string|null} rawCategory
 * @param {string} channel
 * @returns {{ category: string, weak: boolean } | null}
 */
function _mapNative (rawCategory, channel) {
  if (!rawCategory || typeof rawCategory !== 'string') return null
  const key = rawCategory.trim()
  if (!key) return null
  if (DOMAIN_LEVEL_RAW.has(key)) return null
  const lower = key.toLowerCase()
  const table = RAW_CATEGORY_MAP[channel]
  if (table && table[key]) return { category: table[key], weak: false }
  if (GENERIC_RAW_MAP[key]) return { category: GENERIC_RAW_MAP[key], weak: false }
  if (GENERIC_RAW_MAP[lower]) return { category: GENERIC_RAW_MAP[lower], weak: false }
  const weakTable = RAW_CATEGORY_WEAK_MAP[channel]
  if (weakTable && weakTable[key]) return { category: weakTable[key], weak: true }
  return null
}

/**
 * 分类单个选题（v1 兼容契约：返回单一主分类字符串）
 * @param {string|null} rawCategory 渠道原生分类（可空）
 * @param {string} channel 渠道 id
 * @param {string} topicText 选题文本
 * @returns {string} 11 分类枚举之一
 */
function classifyTopic (rawCategory, channel, topicText) {
  return classifyTopicMulti(rawCategory, channel, topicText).category
}

/**
 * 分类单个选题（多标签契约）。
 *
 * 主标签判定顺序（v3）：
 *   1. 可信原生分类（渠道明确声明领域）——最可靠，直接做主标签；
 *   2. 关键词最高分——原生缺失或原生只是「宽泛桶」时，以文本证据为准；
 *   3. 宽泛原生分类——文本没有任何判别力信号时的兜底（如 B站「知识」→综合）；
 *   4. general——确实无信号。
 *
 * @param {string|null} rawCategory
 * @param {string} channel
 * @param {string} topicText
 * @returns {{ category: string, categories: string[] }} 主分类 + 最多 3 个标签
 */
function classifyTopicMulti (rawCategory, channel, topicText) {
  const native = _mapNative(rawCategory, channel)
  const hits = _scoreKeywords(topicText)
  /** @type {string[]} */
  const categories = []
  /** @type {string|null} */
  let primary = null

  if (native && !native.weak) {
    primary = native.category
  } else if (hits.length) {
    primary = hits[0].category
  } else if (native) {
    primary = native.category
  }

  if (primary) categories.push(primary)
  for (const h of hits) {
    if (!categories.includes(h.category)) categories.push(h.category)
  }
  // general 是「无判别力信号」的专属桶（调研 B10）：只要文本给出了任何真实分类，
  // 就不得把 general 留在标签里 —— 「有信号但被 general 占位」会污染分类计数与空态判定。
  const real = categories.filter((c) => c !== 'general')
  const finalCats = (real.length ? real : ['general']).slice(0, 3)
  return {
    category: finalCats[0] || 'general',
    categories: finalCats.length ? finalCats : ['general'],
  }
}

module.exports = {
  CATEGORY_KEYS,
  RAW_CATEGORY_MAP,
  RAW_CATEGORY_WEAK_MAP,
  GENERIC_RAW_MAP,
  KEYWORD_RULES,
  STRONG_MULT,
  MIN_SCORE,
  matchesKeyword,
  classifyTopic,
  classifyTopicMulti,
}

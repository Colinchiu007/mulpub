// @ts-check
/**
 * 热门选题分类器 v2 — 渠道原生映射 + 多标签打分制关键词规则
 *
 * 分类体系（10 类）：
 *   general(综合) society(社会) finance(财经) tech(科技) entertainment(娱乐)
 *   sports(体育) emotion(情感) education(教育) health(健康) international(国际)
 *
 * v2 变更（方案A：修复结构性稀疏）：
 *   1. 关键词规则由「先到先得」升级为「打分制」：每分类得分 = 命中关键词长度之和，
 *      主标签取最高分（并列按规则优先级，V8 sort 稳定）；society 黑洞词（裸字'判'、
 *      泛化'通报/调查'）不再吞掉 health/finance 等更具体的分类。
 *   2. society 词表移除裸字「判」（"判定/判断/裁判"等中性词误伤），改用 审判/判决/判刑 强词。
 *   3. 新增 classifyTopicMulti：返回 { category, categories[] }（最多 3 个标签），
 *      供多标签过滤（方案E）与稀疏分类统计（方案B）使用。
 *   4. 渠道原生映射扩容（微博 情感/艺人/汽车 等）+ 通用分类名词表 GENERIC_RAW_MAP
 *      （渠道 category 字段直接写 10 类中文名时全渠道生效）。
 *
 * 兼容性：classifyTopic 仍返回单字符串（v1 契约），既有调用方零改动。
 */

/** 10 分类枚举 */
const CATEGORY_KEYS = [
  'general', 'society', 'finance', 'tech', 'entertainment',
  'sports', 'emotion', 'education', 'health', 'international',
]

/**
 * 渠道原生分类 → 10 类映射表。
 * key 归一化：trim + toLowerCase；未命中先查通用名词表，再走关键词规则。
 */
const RAW_CATEGORY_MAP = {
  // 今日头条 hot-board 的 Category 字段（实测枚举；2026-09 起该字段偶发缺失，缺失走关键词兜底）
  toutiao: {
    '热点': 'general', '社会': 'society', '国际': 'international',
    '财经': 'finance', '科技': 'tech', '娱乐': 'entertainment',
    '体育': 'sports', '汽车': 'tech', '教育': 'education', '健康': 'health',
    '军事': 'international', '游戏': 'entertainment', '旅游': 'general',
  },
  // 腾讯新闻 hot_ranking_list 领域字段（注意：线上 chlid 多为数字 ID，命中的是文本领域名）
  tencent: {
    '社会': 'society', '国际': 'international', '财经': 'finance',
    '科技': 'tech', '娱乐': 'entertainment', '体育': 'sports',
    '教育': 'education', '健康': 'health', '军事': 'international',
  },
  // 微博热搜 hot_band 的 category 字段（实测 2026-09 枚举 + v2 扩容情感/艺人/汽车等）
  weibo: {
    '数码': 'tech', '电竞': 'entertainment', '国内时政': 'society',
    '演出': 'entertainment', '互联网': 'tech', '剧集': 'entertainment',
    '综艺': 'entertainment', '民生新闻': 'society', '体育': 'sports',
    '幽默': 'entertainment', '科学科普': 'tech', '美食': 'general',
    '健康医疗': 'health', '舆论监督': 'society', '游戏': 'entertainment',
    // v2 扩容（实测 band_list 原生分类，直接修复 emotion=0 结构性缺失）
    '情感': 'emotion', '艺人': 'entertainment', '汽车': 'tech',
    '音乐': 'entertainment', '电影': 'entertainment', '电视剧': 'entertainment',
    '教育': 'education', '校园': 'education', '职场': 'society',
    '法律': 'society', '军事': 'international', '国际': 'international',
    '财经': 'finance', '股票': 'finance', '房地产': 'finance',
    '旅游': 'general', '宠物': 'general', '时尚': 'general', '美妆': 'general',
    '健身': 'health', '养生': 'health', '育儿': 'emotion',
  },
  // B站热门 tname 分区名（实测 2026-09，常见分区 → 10 类映射；未命中分区走关键词规则）
  bilibili: {
    '科技': 'tech', '数码': 'tech', '软件应用': 'tech', '科学科普': 'tech',
    '知识': 'tech', '人文历史': 'general', '校园学习': 'education',
    '手机游戏': 'entertainment', '单机游戏': 'entertainment', '电子竞技': 'entertainment',
    '游戏': 'entertainment', '国产动画': 'entertainment', '影视杂谈': 'entertainment',
    '电影': 'entertainment', '电视剧': 'entertainment', '综艺': 'entertainment',
    '音乐综合': 'entertainment', '演奏': 'entertainment', '鬼畜剧场': 'entertainment',
    '同人·手书': 'entertainment', '小剧场': 'entertainment', '预告·资讯': 'general',
    '体育': 'sports', '社会': 'society', '日常': 'general', '生活': 'general',
    '美食制作': 'general', '美食记录': 'general', '美食侦探': 'general',
    '亲子': 'general', '动物二创': 'general', '搞笑': 'entertainment',
    '出行': 'general', '手工': 'general',
  },
}

/**
 * 通用原生分类名词表：任意渠道的 category 字段直接写 10 类中文名时全渠道生效。
 * （百度垂类 tab、新浪财经 rawCategory='财经'、IT之家 rawCategory='科技' 等）
 */
const GENERIC_RAW_MAP = {
  '综合': 'general', '社会': 'society', '财经': 'finance', '科技': 'tech',
  '娱乐': 'entertainment', '体育': 'sports', '情感': 'emotion',
  '教育': 'education', '健康': 'health', '国际': 'international',
}

/**
 * 关键词词表（打分制：得分 = 命中关键词长度之和；并列按此优先级排序
 * 国际 > 社会 > 财经 > 科技 > 娱乐 > 体育 > 情感 > 教育 > 健康）。
 */
const KEYWORD_RULES = [
  { category: 'international', keywords: ['美国', '日本', '韩国', '国际', '俄罗斯', '乌克兰', '欧盟', '联合国', '海外', '全球', '外交部', '关税战'] },
  // v2：移除裸字「判」与泛化词误伤来源，保留强语义词
  { category: 'society', keywords: ['社会', '警方', '法院', '审判', '判决', '判刑', '案发', '事故', '遇难', '身亡', '救援', '通报', '调查', '违法', '犯罪', '拘留', '逮捕', '维权', '民生', '就业', '工资', '退休'] },
  { category: 'finance', keywords: ['股', '基金', 'A股', '港股', '美股', '楼市', '房价', '经济', '通胀', '利率', '央行', '人民币', '汇率', 'GDP', '上市', '融资', '营收', '利润', '关税', '贸易', '市值', '涨停', '跌停'] },
  { category: 'tech', keywords: ['AI', '人工智能', '大模型', '芯片', '半导体', '手机', '电脑', '互联网', '算法', '机器人', '新能源', '自动驾驶', '航天', '卫星', '火箭', '5G', '6G', '量子', '开源', '程序员', '数码'] },
  { category: 'entertainment', keywords: ['明星', '综艺', '电影', '电视剧', '演唱会', '票房', '偶像', '选秀', '音乐', '歌手', '演员', '导演', '娱乐圈', '粉丝', '游戏', '动漫'] },
  { category: 'sports', keywords: ['足球', '篮球', '奥运', '世界杯', '冠军', '联赛', '球员', '教练', '夺冠', '金牌', 'NBA', 'CBA', '国足', '运动员', '比赛', '赛季', '决赛', '世预赛'] },
  { category: 'emotion', keywords: ['恋爱', '婚姻', '离婚', '结婚', '相亲', '情感', '爱情', '分手', '出轨', '婆媳', '家庭', '亲子', '父母', '孩子', '情侣', '表白', '失恋'] },
  { category: 'education', keywords: ['高考', '考研', '开学', '毕业', '大学', '中学', '小学', '幼儿园', '招生', '录取', '分数线', '学费', '教师', '校园', '学生', '教育部', '考编'] },
  // v2：扩充 卫健委/疾控/新药 等强词，使「卫健委通报疫情」类选题主判 health 而非 society
  { category: 'health', keywords: ['医院', '疫苗', '养生', '健康', '疾病', '疫情', '病毒', '感冒', '癌症', '体检', '医生', '药品', '减肥', '健身', '卫健委', '疾控', '新药', '门诊', '手术', '医疗', '医保'] },
]

/**
 * 关键词打分：返回按得分降序（并列保持规则优先级）的分类命中列表
 * @param {string} text
 * @returns {Array<{category: string, score: number}>}
 */
function _scoreKeywords(text) {
  const hits = []
  for (const rule of KEYWORD_RULES) {
    let score = 0
    for (const kw of rule.keywords) {
      if (text.includes(kw)) score += kw.length
    }
    if (score > 0) hits.push({ category: rule.category, score })
  }
  hits.sort((a, b) => b.score - a.score) // V8 Array#sort 稳定，并列时保持 KEYWORD_RULES 声明顺序
  return hits
}

/** 渠道原生分类映射：渠道专属表 → 通用名词表；未命中返回 null */
function _mapNative(rawCategory, channel) {
  if (!rawCategory || typeof rawCategory !== 'string') return null
  const key = rawCategory.trim().toLowerCase()
  if (!key) return null
  const table = RAW_CATEGORY_MAP[channel]
  if (table && table[key]) return table[key]
  if (GENERIC_RAW_MAP[key]) return GENERIC_RAW_MAP[key]
  return null
}

/**
 * 分类单个选题（v1 兼容契约：返回单一主分类字符串）
 * @param {string|null} rawCategory 渠道原生分类（可空）
 * @param {string} channel 渠道 id
 * @param {string} topicText 选题文本
 * @returns {string} 10 分类枚举之一
 */
function classifyTopic(rawCategory, channel, topicText) {
  const native = _mapNative(rawCategory, channel)
  if (native) return native
  const hits = _scoreKeywords(String(topicText || ''))
  return hits.length ? hits[0].category : 'general'
}

/**
 * 分类单个选题（v2 多标签契约）
 * @param {string|null} rawCategory
 * @param {string} channel
 * @param {string} topicText
 * @returns {{ category: string, categories: string[] }} 主分类 + 最多 3 个标签
 *   规则：渠道原生分类优先为主标签；关键词命中按得分降序补充为次标签；全未命中 → general
 */
function classifyTopicMulti(rawCategory, channel, topicText) {
  const native = _mapNative(rawCategory, channel)
  const hits = _scoreKeywords(String(topicText || ''))
  /** @type {string[]} */
  const categories = []
  if (native) categories.push(native)
  for (const h of hits) {
    if (!categories.includes(h.category)) categories.push(h.category)
  }
  const finalCats = categories.slice(0, 3)
  return {
    category: finalCats[0] || 'general',
    categories: finalCats.length ? finalCats : ['general'],
  }
}

module.exports = {
  CATEGORY_KEYS,
  RAW_CATEGORY_MAP,
  GENERIC_RAW_MAP,
  KEYWORD_RULES,
  classifyTopic,
  classifyTopicMulti,
}

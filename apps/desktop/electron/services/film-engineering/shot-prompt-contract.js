// @ts-check

/**
 * 提示词接线的**契约与闭集**（常量单一真源）。
 *
 * 为什么要单独成文件：这些是**闭集**（变量名、缺失原因、长度上限）——
 * 散落在多个模块里就会出现「某个模块改了分类、另一个模块还按旧的判」这种漂移。
 * 拆出来的直接动因：本仓 `check-max-lines.js` 的 `NEW_OVER_LIMIT` 判据（单文件 ≤ 500 行）。
 *
 * ⚠ 缺失原因是**五类闭集**（第 10 轮 i1 起）：byDesign / assetMissing / templateVar / badVarName / oversizeVar。
 *   消费方（面板）按 reason 分派处置 ⇒ 新增一类必须同时改消费方与这里的断言。
 */

/** 任务名（`prompts/tasks/<taskId>/{zh,en}/{system,user}.md`） */
const SHOT_PROMPT_TASK_ID = 'generate_shot_prompt'
/** 尾帧约束的长度上限（与既有单字段上限同值，**不放宽**） */
const MAX_END_FRAME_LEN = 50000
/**
 * **流入提示词的 kit 自由文本的长度上限**（第 8 轮评审 i8：kit 不可信）。
 *
 * 色盘行与角色描述来自 `userData/film-kit`（用户/外部进程可写），kit-loader 只校验结构、
 * 不校验块文本长度 ⇒ 一个 10MB 的 `paletteLine` 会直接进逐镜 `promptVars`（落项目文件）。
 * ⇒ 超限**不提供**该变量（进 `missing` ⇒ `deliverable=false`），**不静默截断**。
 */
const MAX_KIT_VAR_LEN = 20000
/**
 * **逐镜字段的长度上限**（第 8 轮 i8 的同一条纪律，落到 `shot_json` 上）。
 *
 * `shot_json` 把镜头的 `title` / `characterNames` / `model` **原样**送进提示词，
 * 而这些字段来自**用户可编辑的项目文件**（同样是不可信输入）⇒ 与 kit 自由文本同一条纪律。
 * 超限 ⇒ **不提供** `shot_json`（⇒ 进 `missing` ⇒ `deliverable=false`），**不静默截断**。
 */
const MAX_SHOT_FIELD_LEN = 2000
/** 变量名（与 `generate_shot_prompt/user.md` 的 `{{var}}` 一一对应） */
const TASK_VARS = Object.freeze([
  'shot_json',
  'palette_line',
  'style_prefix',
  'geo_block',
  'character_descriptors',
  'duration_sec',
  'model',
])
/**
 * **设计上不填**的变量（不提供 ⇒ 渲染文本保留占位符）。
 *
 * `style_prefix`：没有资产形态（doctrine 的 `style` 块是规则描述，示例值不是可粘贴的资产）。
 * `geo_block`：**本批次不取**（跨模板取 GEO 块的选取规则未定义 —— 第 17 轮 i3 改判；
 *   原先归 `assetMissing` 会说成「资产里没有」，与事实不符）。
 */
const BY_DESIGN_VARS = Object.freeze(['style_prefix', 'geo_block'])
/** 缺失原因（闭集，消费方按它分派处置） */
const REASON_BY_DESIGN = 'byDesign'
const REASON_ASSET_MISSING = 'assetMissing'
const REASON_TEMPLATE_VAR = 'templateVar'
const REASON_BAD_VAR_NAME = 'badVarName'
/**
 * **第五类缺失原因**：变量**超长**（第 9 轮 i4）。
 *
 * 前四类都回答「这个变量**是什么**」，唯独「太大」是另一回事 ——
 * 把超长变量混进 `assetMissing` 会让面板显示「资产缺口（该资产尚未提供）」，
 * 而事实是「资产**有**，但太大，装不进提示词」。
 * ⇒ 独立一类 `oversizeVar`：**不静默截断**（截断会把「资产异常」伪装成「资产正常」），
 *   不提供该变量 ⇒ `deliverable=false`。
 */
const REASON_OVERSIZE_VAR = 'oversizeVar'
/** 尾帧约束的**来源**取值（闭集；第 13 轮 i5：source 来自 kit，必须有定义） */
const FRAME_CONSTRAINT_SOURCE = 'doctrine.frame_constraint'
/** 「**没有**任务模板」的显式标记（第 14 轮 i8：空串与「真·空模板」必须可区分） */
const ABSENT_TEMPLATE = '<absent>'
/** 哈希的序列化版本号：改键序/字段时 +1（v2：逐镜渲染哈希**加进**缺失清单，第 14 轮 i2） */
const HASH_VERSION = 'v2'
/** 回退来源分组（design D22：扁平列表分不清是 doctrine/palette/task 哪一处回退） */
const FALLBACK_SOURCES = Object.freeze(['doctrine', 'palette', 'task'])

/** 缺失原因的**变量名**的长度上限（第 12 轮 i5 · security） */
const MAX_MISSING_NAME_LEN = 64

/**
 * **清单里非任务变量条目的硬上限**（第 14 轮 i3 · feasibility）。
 *
 * 模板是**不可信**输入 ⇒ 它可以要 100 个变量 ⇒ 清单会被撑爆。
 * 「清单 ≤ 1,024 字节」与「非任务条目 ≤ 8」必须是**闸门**（实现里强制），
 * 而不只是**断言**（测试里查）—— 断言在实现没做时只会红，而**闸门**才是防线。
 */
const MAX_MISSING_ENTRIES = 8

/**
 * **清单的字节预算**（第 14 轮 i2 / 第 15 轮 i2 / 第 16 轮 i2）。
 *
 * 推导（三次修正，**每次都因为算漏了东西**）：
 * ① 第 14 轮：「8 × (64 字符名 + 开销) ≈ 560 B < 1 KiB」⇒ **漏算**了 7 条任务变量（总 15 条）**与 CJK 的 3 字节/字**。
 * ② 第 15 轮：改按 15 × (192 B 名 + 30 B) ≈ 3.3 KB ⇒ 预算提到 **4 KiB** ⇒ **又漏算**了 **JSON 转义**：
 *    名字里含引号/反斜杠时按 `\uXXXX` 记 **6 字节/字** ⇒ 单条最坏 ≈ 64×6 + 30 ≈ 414 B ⇒ 15 条 ≈ 6.2 KB > 4 KiB。
 * ③ 第 16 轮：预算提到 **8 KiB**（15 × 414 ≈ 6.2 KB < 8 KB）⇒ 这次把**转义**也算进去了。
 * ⚠ 名字的**控制字符已在落盘前剥除**（`sanitizeUntrustedText`）⇒ 最坏转义只剩引号/反斜杠。
 */
const MAX_MISSING_BYTES = 8192

module.exports = {
  SHOT_PROMPT_TASK_ID,
  MAX_END_FRAME_LEN,
  MAX_KIT_VAR_LEN,
  MAX_SHOT_FIELD_LEN,
  TASK_VARS,
  BY_DESIGN_VARS,
  REASON_BY_DESIGN,
  REASON_ASSET_MISSING,
  REASON_TEMPLATE_VAR,
  REASON_BAD_VAR_NAME,
  REASON_OVERSIZE_VAR,
  FRAME_CONSTRAINT_SOURCE,
  ABSENT_TEMPLATE,
  HASH_VERSION,
  FALLBACK_SOURCES,
  MAX_MISSING_NAME_LEN,
  MAX_MISSING_ENTRIES,
  MAX_MISSING_BYTES,
}

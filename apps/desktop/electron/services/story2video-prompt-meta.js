/**
 * optimize 阶段模型元数据白名单提取（s2v-result-model-info，2026-10-18）
 *
 * 存在理由：任务详情页（ResultView）要展示"本视频的文本模型"，其唯一权威来源是
 * prompt-engine 在 optimize 阶段返回的 `model_used`。此前 `generate_assets` 的
 * pairedScenes 不携带 `promptOptimizationMeta`，`Story2VideoProjectService` 虽已定义
 * 该白名单字段（safePromptOptimizationMeta）却从不被填值 ⇒ 详情页恒为空。
 * 本模块把 entry 收窄成同一份白名单，由 generate_assets 挂到 scene 上落盘。
 *
 * 合同锚点：01-docs/PRD-S2V-RESULT-MODEL-INFO-2026-10-18.md §3.1
 * 主 PRD：01-docs/PRD.md §7.1.39
 *
 * 两条硬约束：
 *   ① 白名单收窄 —— `optimized_prompt` / `truncated` / `optimize_note` / `degraded` /
 *      `index` 等流水线内部状态**不得**进入 meta（scene.prompt 已承载提示词本身），
 *      否则 run context 会被无用数据撑大，且 service 侧的 safePromptOptimizationMeta
 *      也会把它们丢掉——上游就收窄才能避免"带了但被丢"的浪费。
 *   ② fail-open —— 取不到 / 畸形 entry 一律返回 null，绝不因此让 generate_assets 失败。
 *      模型信息是展示层增强，不能因为它把整条流水线打死。
 */

/** 与 story2video-project-service.js 的 safePromptOptimizationMeta 白名单逐字段对齐。 */
const PROMPT_OPTIMIZATION_META_KEYS = [
  'strategy_used', 'key_source', 'cache_hit', 'model_used', 'caller', 'platform', 'style',
];

/**
 * 从单条 optimize entry 提取白名单 meta。
 *
 * @param {*} entry optimize 阶段该场景的结果项（可能是字符串、null、数组或对象）
 * @returns {object|null} 非空白名单 meta；无可用字段时返回 null
 */
function pickPromptOptimizationMeta (entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const meta = {};
  for (const key of PROMPT_OPTIMIZATION_META_KEYS) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) meta[key] = value.trim();
    else if (typeof value === 'boolean') meta[key] = value;
  }
  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * 按场景下标取 optimize meta。越界 / 非数组 / 畸形项均为 null（fail-open）。
 *
 * @param {Array<*>} optimizedPrompts optimize 阶段结果数组（已兼容 `{ results }` 包装）
 * @param {number} index 场景下标
 * @returns {object|null}
 */
function promptOptimizationMetaOf (optimizedPrompts, index) {
  if (!Array.isArray(optimizedPrompts)) return null;
  if (!Number.isInteger(index) || index < 0) return null;
  return pickPromptOptimizationMeta(optimizedPrompts[index]);
}

/**
 * 从单条 optimize 结果项提取提示词文本。
 *
 * 存在理由：optimize 结果可能含 `null` / 非对象项（上游异常），
 * 而 `typeof p === 'string' ? p : p.prompt || ...` 这种写法会在 `p === null` 时抛
 * `Cannot read properties of null`，把整阶段打成 `Asset scene generation failed`。
 * 两处消费点（generate_assets 的 pairedScenes 与 optimizedPrompts 映射）共用本函数。
 *
 * @param {*} item 单条 optimize 结果（字符串 / 对象 / null / 其他）
 * @returns {string} 提示词文本；畸形项返回空串（fail-open）
 */
function optimizeItemPrompt (item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  return String(item.prompt || item.optimized_prompt || item.optimized || '');
}

module.exports = {
  PROMPT_OPTIMIZATION_META_KEYS,
  pickPromptOptimizationMeta,
  promptOptimizationMetaOf,
  optimizeItemPrompt,
};

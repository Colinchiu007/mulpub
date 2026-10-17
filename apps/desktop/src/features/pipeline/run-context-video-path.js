// @ts-check
/**
 * 共享纯函数：从流水线 run context 提取成片路径。
 * 口径与 CreateView.extractOrchestrationVideoPath 逐字一致（2026-10-17 抽出来源）：
 * publish → compose → export → render → report；每阶段兼容 `{ data }` 包裹与扁平形态。
 *
 * 热门选题一键生成视频支持多流水线后，非 story2video 的成片可能落在 export/render/report，
 * 两处必须共用同一判据，否则「查看到成片」与「去发布预填」会有一侧取不到路径。
 * @param {unknown} context
 * @returns {string|null}
 */
export function extractRunContextVideoPath(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null
  const pick = (key) => {
    const raw = context[key]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw
  }
  const publish = pick('publish')
  const compose = pick('compose')
  const clipExport = pick('export')
  const render = pick('render')
  const report = pick('report')
  return publish?.videoPath || publish?.path ||
    compose?.videoPath || compose?.path ||
    clipExport?.videoPath || clipExport?.path ||
    render?.videoPath || render?.path ||
    report?.videoPath || report?.path || null
}

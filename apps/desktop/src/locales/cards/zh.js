/**
 * cards 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 P2-5「渲染层入口与文案」新增；zh/en 成对维护（CI Gate 7）。
 *
 * ★ 本域的失败文案必须**点名具体原因**，不得只写「生成失败」——
 *   分页器的 warnings（item-exceeds-page / page-limit-reached）意味着用户的文本
 *   超出一页或触达页数上限，用户必须知情（P2-5 规格「失败面」条）。
 */
export default {
  // 入口（选题/发布页的「生成图文卡片」按钮）
  entryLabel: '生成图文卡片',
  entryDesc: '把长文按页切成图文卡片，逐页导出 PNG',

  // 进度
  rendering: '正在生成图文卡片…',
  renderingStep: '第 {current} / {total} 页',

  // 结果
  resultTitle: '图文卡片已生成',
  resultCount: '共 {count} 张',
  resultHint: '已保存到临时目录，可在发布时选择使用',

  // 失败（按领域码取文案，主进程原样透传）
  failedTitle: '图文卡片生成失败',
  failedValidation: '入参不合法：{message}',
  failedService: '渲染服务暂不可用，请稍后重试',
  failedCount: '生成页数与预期不符（期望 {expected} 页，实际 {actual} 页），已放弃本次结果',
  failedUnknown: '生成失败：{message}',

  // ★ warnings（非空即必须展示 —— 不得静默）
  warningsTitle: '请注意以下情况',
  warningItemExceedsPage: '有内容单段就超出一页，已被单独成页（排版可能偏空）',
  warningPageLimitReached: '内容已达页数上限，后续内容未纳入卡片',
}

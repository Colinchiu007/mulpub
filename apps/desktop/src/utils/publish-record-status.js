/**
 * publish-record-status — 发布历史记录的状态归一（唯一实现）
 *
 * 从 `composables/usePublishRecordActions.js` 的内部闭包提出。提出动因：
 * `usePublishHistoryRowFormat` 也需要这两个判据（定时模式与失败计数都按状态派生），
 * 若继续靠调用方注入，视图里就出现「rowFormat 必须在 usePublishRecordActions 之后」
 * 这条隐形顺序耦合 —— 实测它会以 `Cannot access 'recordTitle' before initialization`
 * 的 TDZ 形态炸在挂载期。两者都是**纯函数**（不闭包任何依赖），本就该是模块级真源。
 *
 * 口径（不得改动）：`record.success === false` 优先于 `status` ——
 * 历史行有两条成功通道，老行只有 `success` 字段。
 */

export function statusValue (record) {
  if (record?.success === false) return 'failed'
  return String(record?.status || 'success').toLowerCase()
}

export function normalizedStatusGroup (record) {
  const value = statusValue(record)
  if (['success', 'completed', 'published'].includes(value)) return 'success'
  if (['failed', 'error'].includes(value)) return 'failed'
  return 'pending'
}

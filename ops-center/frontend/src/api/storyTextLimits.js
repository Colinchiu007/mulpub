import { createApiClient } from './http'

const api = createApiClient()

/**
 * 字数控制配置：列出各范围（scope）的文案字数上限。
 *
 * 契约来源（已落地）：ops-center/backend/routers/story_text_limits.py，
 * 管理接口字段为 snake_case（与运营中心其它管理接口一致）。真实返回：
 *
 *   {
 *     items: [{
 *       scope: 'story2video',
 *       label: '故事讲述',        // 展示名
 *       max_chars: 10000,
 *       warn_percent: 90,
 *       enabled: true,
 *       note: '',
 *       updated_at: '2026-10-18T...Z',
 *       updated_by: 'admin',
 *     }],
 *     count: 1,
 *     defaults: { max_chars: 10000, warn_percent: 90 },
 *     ranges: { max_chars: { min: 1000, max: 50000 },
 *               warn_percent: { min: 50, max: 99 }, note_max_len: 200 },
 *   }
 *
 * defaults / ranges 由后端常量提供，前端据此渲染区间与默认值（不在前端另抄一份数字）。
 */
export function listStoryTextLimits() {
  return api.get('/story-text-limits').then(r => r.data)
}

/**
 * 保存各范围的配置。
 * body: { items: [{ scope, max_chars, warn_percent, enabled, note }] }
 * 返回与 GET 相同的信封 { items, count, defaults, ranges }；任一条非法即整体 400。
 */
export function saveStoryTextLimits(items) {
  return api.put('/story-text-limits', { items }).then(r => r.data)
}

/**
 * 恢复某个范围的默认值（10000 字 / 90% / 启用）。
 * body: { scope }（省略 scope 时后端重置目录内全部范围）
 * 返回与 GET 相同的信封。
 */
export function resetStoryTextLimit(scope) {
  return api.post('/story-text-limits/reset', { scope }).then(r => r.data)
}

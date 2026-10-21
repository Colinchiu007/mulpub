/**
 * common 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/zh.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    save: '保存',
    cancel: '取消',
    delete: '删除',
    edit: '编辑',
    add: '添加',
    confirm: '确认',
    refresh: '刷新',
    loading: '加载中...',
    success: '成功',
    error: '错误',
    close: '关闭',
    backToTop: '回到顶部',
    pipelineBackgroundToast: '如果想查看该任务，请进入视频创作的历史记录',
    pageLoadFailed: '页面加载失败',
    pageLoadFailedMessage: '页面资源仍未加载成功，请重试或刷新应用。',
    // 离线横幅（UX 审计 1.7：原先硬编码在 OfflineIndicator.vue 模板里，英文用户看到中文）
    offlineBanner: '网络已断开 — 发布任务将被缓存，网络恢复后自动重试',
    offlinePendingCount: '{count} 个待发布',
  }

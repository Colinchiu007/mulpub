/**
 * publishDrafts 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/zh.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    loadFailed: '草稿读取失败',
    emptyTitleContent: '标题和内容不能都为空',
    saveFailed: '草稿保存失败',
    saved: '草稿已保存',
    notFound: '草稿不存在或已被删除',
    loaded: '已加载草稿',
    deleteFailed: '草稿删除失败',
    deleted: '草稿已删除',
    deleteConfirmTitle: '删除草稿',
    deleteConfirmMessage: '将永久删除草稿「{title}」。草稿不入回收站，删除后不可恢复。确认删除？',
    untitledDraft: '（无标题）',
    scheduleConflictTitle: '定时发布与草稿',
    scheduleConflictMessage: '已设置定时发布时间（{time}）。草稿是本地快照，不会在定时时间自动发布——定时只在点击「一键发布」时进入调度队列。保存前清除定时时间？',
    scheduleConflictClear: '清除定时并保存',
    scheduleConflictKeep: '保留定时保存',
    staleScheduleCleared: '草稿中的定时发布时间（{time}）已过期，已清除；发布前请重新设置',
  }

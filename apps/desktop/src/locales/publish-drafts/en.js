/**
 * publishDrafts 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/en.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    loadFailed: 'Failed to load drafts',
    emptyTitleContent: 'Title and content cannot both be empty',
    saveFailed: 'Failed to save draft',
    saved: 'Draft saved',
    notFound: 'Draft not found or already deleted',
    loaded: 'Draft loaded',
    deleteFailed: 'Failed to delete draft',
    deleted: 'Draft deleted',
    deleteConfirmTitle: 'Delete draft',
    deleteConfirmMessage: 'This will permanently delete the draft "{title}". Drafts are not moved to a trash and cannot be recovered. Delete it?',
    untitledDraft: '(untitled)',
    scheduleConflictTitle: 'Scheduled publish vs. draft',
    scheduleConflictMessage: 'A scheduled publish time is set ({time}). A draft is a local snapshot and will NOT publish automatically at that time — scheduling only takes effect when you click "Quick Publish". Clear the schedule before saving?',
    scheduleConflictClear: 'Clear schedule & save',
    scheduleConflictKeep: 'Keep schedule & save',
    staleScheduleCleared: 'The scheduled publish time in this draft ({time}) has already passed and was cleared; set it again before publishing',
  }

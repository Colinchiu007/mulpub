/**
 * common 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/en.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    confirm: 'Confirm',
    refresh: 'Refresh',
    loading: 'Loading...',
    success: 'Success',
    error: 'Error',
    close: 'Close',
    backToTop: 'Back to top',
    pipelineBackgroundToast: 'To check this task, open History in Video Creation',
    pageLoadFailed: 'Failed to load page',
    pageLoadFailedMessage: 'Page resources failed to load. Please retry or refresh the app.',
    // 离线横幅（UX 审计 1.7：与 zh 成对，原先硬编码在模板里）
    offlineBanner: 'You are offline — publish tasks will be cached and retried once the connection returns',
    offlinePendingCount: '{count} pending',
    offlineRecovered: 'Connection restored',
    // 未知地址兜底页（UX 审计 1.9）：与 pageLoadFailed 是两种故障，文案不得互相复用
    notFoundTitle: 'Page not found',
    notFoundMessage: 'No page in this app matches that address. It may be mistyped, renamed, or retired.',
    notFoundPathLabel: 'Unreachable address:',
    notFoundHint: 'Go back home, or reopen what you need from the sidebar.',
    notFoundBackHome: 'Back to home',
    notFoundGoBack: 'Go back',
  }

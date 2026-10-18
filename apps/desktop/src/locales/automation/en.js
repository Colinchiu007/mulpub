/**
 * automation 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/en.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    title: 'Automation',
    subtitle: 'Automate collect-to-publish: set triggers and a failure policy; tasks run in the background',
    resourceNotice: 'Automation tasks run in the background and do not interrupt your work, but they consume model quota and browser resources and may compete with manual publishing for platform rate limits.',
    create: 'New task',
    createTitle: 'New automation task',
    editTitle: 'Edit automation task',
    empty: 'No automation tasks yet. Click "New task" to automate collect-to-publish.',
    unreadable: 'Could not read the task list (not signed in, or storage unavailable). Nothing was written to avoid overwriting the source of truth.',
    saveFailed: 'Failed to save the task. Please retry.',

    colName: 'Name',
    colTrigger: 'Triggers',
    colAction: 'Action',
    colPolicy: 'Failure policy',
    colLastRun: 'Last run',
    colOps: 'Actions',
    actionPipeline: 'Full auto pipeline',

    fieldName: 'Task name',
    namePlaceholder: 'e.g. Daily tech topic auto-publish',
    fieldTriggers: 'Triggers (multiple allowed, all active)',
    triggersHint: 'Several triggers can be active at once, e.g. "On app start + daily 09:00". Each type can only be configured once.',
    triggerAppStart: 'On app start',
    triggerDaily: 'Daily',
    triggerWeekly: 'Weekly',
    triggerInterval: 'Every',
    minutesUnit: 'minutes',
    weekdays: { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' },

    fieldPolicy: 'Failure handling',
    policySkip: 'Skip and continue',
    policySkipHint: 'Good for batch collect/publish — one failure does not waste the whole run',
    policyAbort: 'Abort',
    policyAbortHint: 'Good for tightly dependent pipelines — continuing may produce half-finished output',

    fieldRetries: 'Retry attempts',
    retryNone: 'No retry',
    retryTimes: (ctx) => ctx.named('count') + ' retries',

    runNow: 'Run now',
    edit: 'Edit',
    delete: 'Delete',
    cancel: 'Cancel',
    save: 'Save',
    // Category tag editing (shared by account groups / collection library)
    tagsEdit: 'Edit tags',
    tagsSave: 'Save',
    tagsCancel: 'Cancel',
    running: 'Running',

    statusCompleted: 'Succeeded',
    statusFailed: 'Failed',
    statusCancelled: 'Cancelled',

    errNameEmpty: 'Please enter a task name',
    errNameTooLong: 'Task name cannot exceed 40 characters',
    errNoTrigger: 'Please select at least one trigger',
    errNoWeekday: 'Please select at least one weekday',
    errSaveFailed: 'Failed to save. Please retry',
    errRunFailed: 'Failed to start. Please retry',
    errDeleteFailed: 'Failed to delete. Please retry',
    removeConfirmTitle: 'Delete automation task',
    removeConfirmMessage: 'This deletes automation task "{name}" together with its trigger and failure-handling configuration. It cannot be recovered. Delete it?',
    errAlreadyRunning: 'The previous run is still active — this trigger was skipped',

    created: 'Task created',
    saved: 'Task saved',
    deleted: 'Task deleted',
    started: 'Task started in the background',
    notifyFailed: (ctx) => 'Automation task failed: ' + ctx.named('message'),
    notifyRecovered: (ctx) => 'Automation task recovered: ' + ctx.named('message'),
  }

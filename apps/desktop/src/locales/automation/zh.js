/**
 * automation 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/zh.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    title: '自动化',
    subtitle: '让采集到发布自动跑起来：设定触发方式与失败处理策略，任务在后台执行',
    resourceNotice: '自动化任务在后台执行，不打断当前操作；但会占用模型额度与浏览器资源，可能与手动发布竞争平台限流。',
    create: '新建任务',
    createTitle: '新建自动化任务',
    editTitle: '编辑自动化任务',
    empty: '还没有自动化任务。点击「新建任务」，让采集到发布自动跑起来。',
    unreadable: '任务列表读取失败，可能是未登录或存储不可用。为避免覆盖真源，本次未写入任何改动。',
    saveFailed: '任务保存失败，请重试。',

    colName: '名称',
    colTrigger: '触发方式',
    colAction: '动作',
    colPolicy: '失败策略',
    colLastRun: '上次运行',
    colOps: '操作',
    actionPipeline: '全自动流水线',

    fieldName: '任务名称',
    namePlaceholder: '如：每日科技选题自动发布',
    fieldTriggers: '触发方式（可多选，同时生效）',
    triggersHint: '多种触发方式可同时有效，例如「启动触发 + 每天 09:00」。同一方式只能配置一次。',
    triggerAppStart: '应用启动时',
    triggerDaily: '每天',
    triggerWeekly: '每周',
    triggerInterval: '每隔',
    minutesUnit: '分钟',
    weekdays: { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' },

    fieldPolicy: '失败处理',
    policySkip: '跳过继续',
    policySkipHint: '适合批量采集发布，个别失败不影响整体产出',
    policyAbort: '中断',
    policyAbortHint: '适合有强依赖的流水线，失败后继续可能产生半成品',

    fieldRetries: '失败重试次数',
    retryNone: '不重试',
    retryTimes: (ctx) => '重试 ' + ctx.named('count') + ' 次',

    runNow: '立即运行',
    edit: '编辑',
    delete: '删除',
    cancel: '取消',
    save: '保存',
    // 类别标签编辑（账号分组 / 采集库共用同一套文案）
    tagsEdit: '编辑标签',
    tagsSave: '保存',
    tagsCancel: '取消',
    running: '运行中',

    statusCompleted: '成功',
    statusFailed: '失败',
    statusCancelled: '已取消',

    errNameEmpty: '请填写任务名称',
    errNameTooLong: '任务名称不能超过 40 个字符',
    errNoTrigger: '请至少选择一种触发方式',
    errNoWeekday: '请至少选择一个星期',
    errSaveFailed: '保存失败，请重试',
    errRunFailed: '启动失败，请重试',
    errDeleteFailed: '删除失败，请重试',
    removeConfirmTitle: '删除自动化任务',
    removeConfirmMessage: '将删除自动化任务「{name}」。任务配置与其中保存的触发条件、失败处理策略一并移除且不可恢复。确认删除？',
    errAlreadyRunning: '该任务上一轮还在运行，已跳过本次触发',

    created: '任务已创建',
    saved: '任务已保存',
    deleted: '任务已删除',
    started: '任务已在后台开始运行',
    notifyFailed: (ctx) => '自动化任务失败：' + ctx.named('message'),
    notifyRecovered: (ctx) => '自动化任务已恢复：' + ctx.named('message'),
  }

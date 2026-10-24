/**
 * onboarding 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/zh.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    welcome: '欢迎使用汤姆鱼',
    step1: '添加账号',
    step2: '发布内容',
    step3: '完成设置',
    next: '下一步',
    skip: '跳过引导',
    // ux-audit-first-run-launch：向导不再声称会自动安装依赖，也不显示从未跑过的检测结论
    runtimeTitle: '运行环境',
    runtimeShortDesc: '应用自带运行时，无需安装依赖',
    runtimeNote: '应用自带运行环境（Python 依赖与浏览器内核随包分发），首启不做安装，也不显示检测结论。',
    saveFailedNotice: '首启状态未能保存，下次启动可能仍会进入向导',
  }

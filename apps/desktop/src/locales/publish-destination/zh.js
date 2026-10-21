/**
 * publishDestination 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/zh.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    title: '选择发布去向',
    subtitle: '改写内容已存入草稿箱，请选择下一步操作',
    article: '直接发图文',
    articleDesc: '打开图文发布页，改写内容将自动填入文案输入框',
    video: '生成视频',
    videoDesc: '打开视频创作流水线页，改写文本将自动填入文案输入框',
    pipelineLabel: '流水线选择',
    pipelineEmptyOption: '-- 选择流水线 --',
    // publish-config-picker（2026-10-21）：「配置选择」= 该流水线下已保存的命名组合配置。
    // 无配置时触发器显示「默认」且下拉内容为空，故这里的「默认」是**唯一**入口文案。
    configLabel: '配置选择',
    configDefaultOption: '默认',
    configEmpty: '该流水线还没有保存过配置，可在创作页用「保存配置」创建',
    configLoading: '正在加载配置…',
    configLoadFailed: '配置列表加载失败，暂时无法选择配置',
    close: '关闭',
  }

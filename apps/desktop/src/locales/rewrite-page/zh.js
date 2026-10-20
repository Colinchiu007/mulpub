/**
 * rewritePage 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/zh.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    title: '文案改写',
    subtitle: 'AI 驱动的多策略文案改写引擎，结合爆款库与个人经历提升原创性',
    inputSection: '输入文案',
    inputPlaceholder: '输入或粘贴需要改写的文案内容（最多 50000 字）...',
    configSection: '改写设置',
    useViralLibrary: '结合爆款库',
    useViralLibraryHint: '优先匹配爆款文案策略，提升内容吸引力和传播潜力',
    usePersonalExperience: '结合个人经历',
    usePersonalExperienceHint: '注入本地知识库中的个人偏好、写作风格和历史成功案例',
    modeLabel: '改写模式',
    modeImitate: '智能仿写',
    modeExpand: '扩写爆款',
    modeCreate: '选题创作',
    platformLabel: '目标平台',
    strategyLabel: '改写策略',
    strategyAuto: '自动匹配',
    strategyManual: '手动选择',
    strategyPreview: '将匹配策略',
    strategyPreviewColon: '：',
    strategySelectPlaceholder: '-- 选择策略 --',
    rewriteBtn: '🔄 开始改写',
    rewritingBtn: '改写中...',
    resultSection: '改写结果',
    // 改写结果标题（2026-09-18）：引擎提炼 ≤20 字标题，纯文字展示
    resultTitleLabel: '标题',
    metaStrategy: '策略',
    metaAiTaste: 'AI味等级',
    // 字数概览：原文 → 结果。经 i18n 命名插值渲染为「原文 8 字 → 结果 720 字」
    metaLength: '原文 {original} 字 → 结果 {result} 字',
    // 选题创作模式的同项文案：输入是「主题种子」而非待改写正文，用「原文」会造成概念误读
    metaLengthFromTopic: '主题 {original} 字 → 结果 {result} 字',
    saveDraft: '💾 存入草稿',
    goPublish: '🚀 去发布',
    goVideo: '🎬 视频创作',
    // 改写结果快捷操作（BUGFIX-REWRITE-QUALITY-UX：结果文本框下方新增复制按钮）
    copyResult: '📋 复制',
    copyResultDone: '✅ 已复制',
    copySuccess: '已复制到剪贴板',
    copyFailed: '复制失败，请手动选中文本后复制',
    copyEmpty: '暂无可复制的内容',
    draftSaved: '草稿已创建',
    draftSaveFailed: '存入草稿失败',
    needLogin: 'AI 改写需要登录后使用，是否立即登录？',
    contentEmpty: '请输入文案内容',
    charCount: '字',
    wordCountLabel: '字数控制',
    wordCountMinPlaceholder: '最小',
    wordCountMaxPlaceholder: '最大',
    wordCountUnit: '字',
    wordCountMinInvalid: '最小字数需为 0-49999 的整数',
    wordCountMaxInvalid: '最大字数需为 1-50000 的整数',
    wordCountMaxLtMin: '最大字数不能小于最小字数',
    // 输出截断可见化（rewrite-limits-50000，2026-10-19）：引擎按字数区间/策略上限砍尾时
    // 结果卡顶部横幅提示；length=实际输出字数，max=生效上限
    outputTruncated: '改写结果已按字数上限截断：实际输出 {length} 字（上限 {max} 字），原文后半部分未包含在结果中。如需完整改写，请调大「字数控制」上限。',
    // 模型侧截断可见化（rewrite-segment-and-finish-reason 第二刀）：provider 的
    // finish_reason 表示输出被模型自身上限截断（与引擎按字数区间砍尾是两回事）。
    // 这条不能建议「调大字数控制」——模型上限通常无法由用户设置改变。
    outputTruncatedByModel: '模型输出达到单次生成上限而截断：实际输出 {length} 字。这是模型侧的生成限制，调大「字数控制」不一定有效，建议分段改写。',
    // 分段改写（>50000 字输入）：事前提示 + 结果卡元信息
    rewriteSegmented: '正文共 {length} 字，超过单次改写上限 {max} 字，将分段改写。耗时与费用会相应增加，且分段期间其他 AI 功能可能变慢；分段改写可能有一致性折损。',
    segmentedMeta: '分段改写 ×{count}',
    // 取消通道（rewrite-cancel-and-truncation-summary）：协作式，当前片段完成后生效
    cancelRewriteBtn: '取消改写',
    cancellingBtn: '正在取消…',
    cancellingHint: '正在取消：当前片段会先完成，之后不再继续后续片段。',
    rewriteCancelled: '改写已取消：已完成的 {completed}/{total} 个片段不保留，已产生的模型费用不退。',
    // 分段路径下只有部分片段被模型截断：必须点名段号，否则用户会以为全文残缺
    outputTruncatedByModelSegments: '第 {segments} 段因模型单次生成上限被截断（合并后共 {length} 字）。这是模型侧的生成限制，建议缩短原文或拆成两次改写。',
    // ── 改写质量评估报告（content-quality-eval 桌面端闭环）──
    qualitySection: '质量评估',
    qualitySufficiency: '改写充分度',
    qualitySemantic: '语义保持度',
    qualityOriginality: '原创性',
    qualityVerdict: '结论',
    // 结论用词必须中性、无负面暗示：旧文案「不合格」使用户怀疑改写引擎可用性
    // （真实案例：选题创作模式下输入 4 字主题种子、输出 700 字成文，语义保持度天然偏低，
    //   被误判为不合格。详见 BUGFIX-REWRITE-QUALITY-UX）
    qualityVerdictPass: '合格',
    qualityVerdictWarn: '需注意',
    qualityVerdictFail: '建议优化',
    qualityMethod: '评估方式',
    qualityMethodSimhash: 'SimHash 指纹',
    qualityMethodEmbedding: '语义向量',
    qualitySuggestions: '改进建议',
    qualityNone: '本次改写未生成质量评估',
    // ── viral-rewrite-integration：标题参考 chip + 爆款潜力第 4 维（纯静态键，插值在模板拼接）──
    titleHintLabel: '标题参考',
    titleHintRemove: '移除',
    signalBadge: '已注入爆款信号',
    strengthRefLabel: '已带入爆款强度参考',
    qualityViralLabel: '爆款潜力',
    qualityViralBefore: '改写前',
    qualityViralAfter: '改写后',
    qualityViralDelta: '变化',
  }

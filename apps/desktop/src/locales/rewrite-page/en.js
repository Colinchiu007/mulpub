/**
 * rewritePage 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/en.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    title: 'Copy Rewrite',
    subtitle: 'AI-powered multi-strategy rewrite engine, combining viral library and personal experience for originality',
    inputSection: 'Input content',
    inputPlaceholder: 'Enter or paste content to rewrite (up to 50000 characters)...',
    configSection: 'Rewrite settings',
    useViralLibrary: 'Use viral library',
    useViralLibraryHint: 'Prioritize viral content strategies to boost appeal and reach',
    usePersonalExperience: 'Use personal experience',
    usePersonalExperienceHint: 'Inject local knowledge base preferences, writing style, and past successes',
    modeLabel: 'Rewrite mode',
    modeImitate: 'Smart imitation',
    modeExpand: 'Expand viral content',
    modeCreate: 'Topic creation',
    platformLabel: 'Target platform',
    strategyLabel: 'Rewrite strategy',
    strategyAuto: 'Auto match',
    strategyManual: 'Manual select',
    strategyPreview: 'Will match strategy',
    strategyPreviewColon: ': ',
    strategySelectPlaceholder: '-- Select strategy --',
    rewriteBtn: '🔄 Rewrite',
    rewritingBtn: 'Rewriting...',
    resultSection: 'Result',
    // Rewrite result title (2026-09-18): engine-generated <=20 char title, text display only
    resultTitleLabel: 'Title',
    metaStrategy: 'Strategy',
    metaAiTaste: 'AI-taste level',
    // Length overview: source → result. Rendered via i18n named interpolation,
    // e.g. "Source 8 → Result 720 chars".
    metaLength: 'Source {original} → Result {result} chars',
    // Same metric for topic-creation mode: the input is a topic seed, not the source text
    metaLengthFromTopic: 'Topic {original} → Result {result} chars',
    saveDraft: '💾 Save draft',
    goPublish: '🚀 Publish',
    goVideo: '🎬 Create Video',
    // Result quick actions (BUGFIX-REWRITE-QUALITY-UX: copy button under the result box)
    copyResult: '📋 Copy',
    copyResultDone: '✅ Copied',
    copySuccess: 'Copied to clipboard',
    copyFailed: 'Copy failed. Please select the text and copy manually',
    copyEmpty: 'Nothing to copy yet',
    draftSaved: 'Draft created',
    draftSaveFailed: 'Failed to save draft',
    needLogin: 'AI rewrite requires login. Sign in now?',
    contentEmpty: 'Please enter some content',
    charCount: 'chars',
    wordCountLabel: 'Word count',
    wordCountMinPlaceholder: 'Min',
    wordCountMaxPlaceholder: 'Max',
    wordCountUnit: 'chars',
    wordCountMinInvalid: 'Min must be an integer between 0 and 49999',
    wordCountMaxInvalid: 'Max must be an integer between 1 and 50000',
    wordCountMaxLtMin: 'Max cannot be less than min',
    // Output truncation visibility (rewrite-limits-50000, 2026-10-19): banner on the
    // result card when the engine trims output to the word-count/strategy cap;
    // length = actual output chars, max = effective cap
    outputTruncated: 'The rewrite was trimmed to the output limit: {length} chars written (limit {max}). The tail of the source text is not included. Raise the word-count cap for a full rewrite.',
    // Model-side truncation (rewrite-segment-and-finish-reason): provider finished with
    // a length/max_tokens reason — distinct from engine trimming; raising the cap may not help.
    outputTruncatedByModel: 'The model hit its own generation limit and stopped: {length} chars written. This is a provider-side limit; raising the word-count cap may not help — consider segmented rewriting.',
    // Segmented rewriting (input over 50000 chars): pre-run notice + result metadata
    rewriteSegmented: 'The text is {length} chars, over the {max}-char single-pass limit, so it will be rewritten in segments. It takes longer and costs more, other AI features may slow down while it runs, and cross-segment consistency may degrade.',
    segmentedMeta: 'Segmented rewrite ×{count}',
    // ── Rewrite quality report (content-quality-eval desktop loop) ──
    qualitySection: 'Quality Assessment',
    qualitySufficiency: 'Rewrite sufficiency',
    qualitySemantic: 'Semantic preservation',
    qualityOriginality: 'Originality',
    qualityVerdict: 'Verdict',
    // Neutral wording only: the previous "Failed" made users doubt the rewrite engine
    // (real case: topic-creation mode with a 4-char seed produced a 700-char article whose
    //  semantic preservation is naturally low, yet was flagged as a failure.
    //  See BUGFIX-REWRITE-QUALITY-UX)
    qualityVerdictPass: 'Pass',
    qualityVerdictWarn: 'Needs attention',
    qualityVerdictFail: 'Suggestions available',
    qualityMethod: 'Method',
    qualityMethodSimhash: 'SimHash fingerprint',
    qualityMethodEmbedding: 'Semantic vector',
    qualitySuggestions: 'Suggestions',
    qualityNone: 'No quality assessment was generated for this rewrite',
    // ── viral-rewrite-integration: title hint chip + viral potential 4th dimension (static keys, interpolation in template) ──
    titleHintLabel: 'Title hint',
    titleHintRemove: 'Remove',
    signalBadge: 'Viral signals injected',
    strengthRefLabel: 'Viral strength reference injected',
    qualityViralLabel: 'Viral potential',
    qualityViralBefore: 'Before',
    qualityViralAfter: 'After',
    qualityViralDelta: 'Delta',
  }

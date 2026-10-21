/**
 * publishDestination 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/en.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    title: 'Choose publish destination',
    subtitle: 'Rewritten content saved to drafts. Choose the next step',
    article: 'Publish image-text',
    articleDesc: 'Open the image-text publish page with content pre-filled',
    video: 'Generate video',
    videoDesc: 'Open the video pipeline page with text pre-filled',
    pipelineLabel: 'Pipeline',
    pipelineEmptyOption: '-- Choose a pipeline --',
    // publish-config-picker (2026-10-21): "Configuration" lists the saved named
    // configuration profiles of the selected pipeline. With none saved the trigger
    // reads "Default" and the dropdown is empty, so "Default" is the only entry text.
    configLabel: 'Configuration',
    configDefaultOption: 'Default',
    configEmpty: 'No saved configuration for this pipeline yet. Create one with "Save configuration" on the creation page.',
    configLoading: 'Loading configurations…',
    configLoadFailed: 'Could not load configurations. Selecting a configuration is unavailable for now.',
    close: 'Close',
  }

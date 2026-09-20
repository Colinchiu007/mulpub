/*
 * S2V 配置面板的父子契约（单一事实来源）。
 *
 * 存在理由：CreateView.vue 曾把整棵 .s2v-config-sections 子树内联在模板里（584 行），
 * 抽取为 S2vConfigPanels.vue 后，子组件不得各写一份 target/field 映射，否则形成双源真相。
 * 本模块登记「子组件被允许读取的父级状态键」与「被允许调用的父级方法名」，
 * 两侧共用同一份白名单：越界访问立即抛错（fail-closed），而不是静默丢字段。
 *
 * 约束：
 *  - 只做只读取值、显式 setState 回写与方法转发；配置对象的写路径沿用既有实现（模板内直接成员赋值），
 *    以保证 s2vConfig 的 deep watcher 与「上次选项」保存节流行为逐字节不变。
 *  - 模板里对 data 的标量直写（v-model / 内联赋值）经 setState 回写父实例，键仍受白名单约束。
 *  - 新增 optionKey 时必须同步 PRD-S2V-PIPELINE-PAGE-UX.md §9 分组目录。
 */

export const S2V_PANEL_KEY = 's2vPanel';

// 父级 CreateView 的 data / computed 只读投影（按字母序，便于 diff 审查）。
export const S2V_PANEL_STATE = [
  'activeOutputConfig',
  'mediaRequirementsBgmText',
  'outputResolutionOptions',
  's2vActiveConfigProfile',
  's2vBgmLibrary',
  's2vCloneOpen',
  's2vConfig',
  's2vCustomTemplateName',
  's2vImageProviderOptions',
  's2vImageProviders',
  's2vLegacyBgmPath',
  's2vMaxPromptLengthHint',
  's2vMaxPromptLengthLabel',
  's2vMaxPromptLengthOptions',
  's2vMinSceneDurationView',
  's2vOpenSections',
  's2vSceneDurationEnabled',
  's2vSplitCharsPerSecond',
  's2vSplitCharsView',
  's2vSplitEstimatedSeconds',
  's2vSplitMaxSeconds',
  's2vSplitSecondsView',
  's2vTemplateCategory',
  's2vTemplates',
  's2vVideoProviderOptions',
  's2vVideoProviders',
  's2vVoiceCapability',
  's2vVoiceCatalogError',
  's2vVoiceCatalogLoading',
  's2vVoiceCatalogRefreshable',
  's2vVoiceCloneError',
  's2vVoiceCloneLoading',
  's2vVoiceClonePending',
  's2vVoiceCloneRenameDraft',
  's2vVoiceCloneRenamingId',
  's2vVoiceCloneRequirements',
  's2vVoiceCloneSelection',
  's2vVoiceClones',
  's2vVoiceModelHidden',
  's2vVoiceModelOptions',
  's2vVoiceOptions',
  's2vVoiceProviderOptions',
  's2vVoiceProviders',
  'selectedPipeline',
  'selectedS2VTemplate',
  'story2videoImageStyleHint',
  'story2videoPromptStyleHint',
];

// 父级 CreateView 的方法转发（按字母序）。
export const S2V_PANEL_METHODS = [
  'applyS2VTemplate',
  'cancelS2VVoiceCloneRename',
  'chooseS2VVoiceCloneSamples',
  'deleteS2VVoiceClone',
  'handleS2VVideoProviderChange',
  'handleS2VVoiceModelChange',
  'handleS2VVoiceProviderChange',
  'handleS2VVoiceSelection',
  'isOrchestratedPipeline',
  'isS2VDefaultVoice',
  'openBgmLibraryDialog',
  'previewS2VVoice',
  'refreshS2VVoiceCatalog',
  'renameS2VVoiceClone',
  'requestTemplateDeletion',
  's2vOptionVisible',
  's2vSectionLabel',
  's2vSectionSummary',
  's2vSubgroupLabel',
  's2vVoiceCloneHint',
  's2vVoiceCloneStatusText',
  'saveCurrentS2VTemplate',
  'selectS2VVoice',
  'setS2VSectionOpen',
  'startS2VVoiceCloneRename',
  'translateWithLocaleFallback',
];

/**
 * 构建受控面板上下文。
 * @param {Instance} vm 父组件实例（Options API this）
 */
export function createS2VPanel(vm) {
  const state = {};
  for (const key of S2V_PANEL_STATE) {
    Object.defineProperty(state, key, {
      get: () => vm[key],
      enumerable: true,
      configurable: false,
    });
  }
  const fns = {};
  for (const key of S2V_PANEL_METHODS) {
    fns[key] = (...args) => vm[key](...args);
  }
  // 标量 data 的回写口：等价于原内联模板里的 this[key] = value，键越界即抛错。
  const setState = (key, value) => {
    if (!S2V_PANEL_STATE.includes(key)) {
      throw new Error(`[s2vPanel] state "${String(key)}" 不在父子契约白名单内，拒绝回写`);
    }
    vm[key] = value;
  };
  // 未登记键访问显式抛错：防止拼错的键静默返回 undefined 而丢失配置。
  const guard = (bag, kind) => new Proxy(bag, {
    get: (target, prop) => {
      if (typeof prop === 'symbol' || prop === '__v_isRef' || prop === 'then') return target[prop];
      if (!(prop in target)) {
        throw new Error(`[s2vPanel] ${kind} "${String(prop)}" 不在父子契约白名单内`);
      }
      return target[prop];
    },
    has: (target, prop) => prop in target,
  });
  return { state: guard(state, 'state'), fns: guard(fns, 'method'), setState };
}

/**
 * 子组件侧取用上下文；缺失即抛错（防止被挂到未 provide 的父级下静默渲染空白）。
 */
export function useS2VPanel(injectFn) {
  const panel = injectFn(S2V_PANEL_KEY, null);
  if (!panel) {
    throw new Error('[S2vConfigPanels] 缺少父级 provide 的 s2vPanel 上下文，拒绝静默渲染');
  }
  return panel;
}

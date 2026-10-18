import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import S2vConfigPanels from './S2vConfigPanels.vue';
import {
  S2V_PANEL_KEY,
  S2V_PANEL_STATE,
  S2V_PANEL_METHODS,
  createS2VPanel,
} from './s2v-panel-contract';

// 六个折叠区分组归属必须与 PRD-S2V-PIPELINE-PAGE-UX.md §9 目录一致。
const SECTIONS = ['basic', 'appearance', 'videoEnhance', 'voice', 'advanced', 'publish'];

const ARRAY_LIKE = /(Options|Providers|Platforms|Templates|Clones|Images|Categories)$/;

// 与 CreateView.vue data() 里的 s2vConfig 默认对象逐字段对齐（含嵌套 watermarkConfig / subtitleStyle），
// 面板模板直接读这些字段，一旦漏字段就会在测试里暴露而不是被静默掩盖。
const s2vConfigFixture = () => ({
  contentType: 'general', imageStyle: 'cinematic',
  imageProvider: '', imageModel: '',
  voiceId: '', voiceProvider: '', voiceModel: '',
  voiceSpeed: 1, voiceVolume: 1,
  templateId: '', imageEffect: 'zoom-in',
  videoMode: 'off', shortVideoHandling: 'loop', videoProvider: '', videoModel: '',
  videoFixedRatio: 25, videoMinRatio: 20, videoMaxRatio: 40, videoMaxScenes: 3,
  creationMode: 'auto', manualMaterialMode: 'all-images',
  splitLanguage: 'auto', splitMode: 'balanced', splitMaxSentenceLength: 200, splitTargetSeconds: 6,
  splitTargetCharsPerScene: 20, splitViewMode: 'seconds',
  splitMinWords: 10, splitMaxWords: 50,
  splitEnforceSentenceBoundary: true, splitOverflowToNext: true,
  sceneDurationMode: 'follow-audio', minSceneDuration: 6,
  splitSubtitleMinChars: 8, splitSubtitleMaxChars: 15, splitSubtitleTiming: 'proportional',
  promptStyle: 'realistic', negativePrompt: '', maxPromptLength: 2000,
  transition: 'fade', subtitleEnabled: true,
  subtitleSize: 'size3', subtitleStyleName: 'style1',
  subtitleStyle: { size: 'md', style: 'style1', color: 'white' },
  bgmPath: '', bgmVolume: 5, watermark: false, watermarkText: '',
  watermarkConfig: { enabled: false, position: 'bottom-right', fontSize: 24, opacity: 0.6, color: 'white' },
  platforms: [], publishEnabled: false, title: '', tagsText: '', publishContent: '', coverUrl: '',
});

const makeVm = (overrides = {}) => {
  const vm = reactive({});
  S2V_PANEL_STATE.forEach((key) => {
    if (key === 's2vConfig') {
      vm[key] = s2vConfigFixture();
    } else if (key === 'activeOutputConfig' || key === 's2vOutputConfig') {
      vm[key] = { resolution: '720x1280', fps: 30, format: 'mp4' };
    } else if (key === 's2vOpenSections') {
      vm[key] = { basic: true, appearance: false, videoEnhance: false, voice: false, advanced: false, publish: false };
    } else if (key === 'selectedPipeline') {
      vm[key] = { name: 'story2video-compose' };
    } else if (key === 's2vSceneDurationEnabled' || key === 's2vCloneOpen') {
      vm[key] = false;
    } else {
      vm[key] = ARRAY_LIKE.test(key) ? [] : '';
    }
  });
  S2V_PANEL_METHODS.forEach((key) => { vm[key] = () => ''; });
  Object.assign(vm, overrides);
  return vm;
};

const mountPanel = (vm) => mount(S2vConfigPanels, {
  global: {
    provide: { [S2V_PANEL_KEY]: createS2VPanel(vm) },
    mocks: { $t: (key) => (key === 'create.story2video.ui.sectionDefaultSuffix' ? '（默认）' : key) },
  },
});

// 面板默认使用真实父级语义的桩：所有选项可见、分组标签/摘要可读。
// 单独 makeVm 只会得到方法桩返回值 ''，导致 UiField 的 optionKey 守卫把控件隐藏。
const makeBoundVm = (overrides = {}) => makeVm({
  isOrchestratedPipeline: () => true,
  s2vOptionVisible: () => true,
  s2vSectionLabel: (section) => section,
  s2vSectionSummary: () => 'summary',
  s2vSectionAtDefault: () => false,
  translateWithLocaleFallback: (_key, zh) => zh,
  ...overrides,
});

describe('S2vConfigPanels', () => {
  let vm;

  beforeEach(() => {
    vm = makeBoundVm();
  });

  it('renders all six collapsible groups in the §9 order', () => {
    const w = mountPanel(vm);
    const ids = w.findAll('.s2v-config-section').map((n) => n.attributes('data-testid'));
    expect(ids).toEqual(SECTIONS.map((s) => `s2v-section-${s}`));
  });

  it('applies the persisted open/closed state from the parent', () => {
    const w = mountPanel(vm);
    expect(w.get('[data-testid="s2v-section-basic"]').attributes('open')).toBeDefined();
    expect(w.get('[data-testid="s2v-section-voice"]').attributes('open')).toBeUndefined();
  });

  it('drops an option entirely when the operation switch hides its optionKey', () => {
    vm.s2vOptionVisible = (key) => key !== 'basic.voiceSpeed';
    const w = mountPanel(vm);
    expect(w.find('[data-testid="s2v-voice-speed"]').exists()).toBe(false);
    // 同组其余选项不受影响
    expect(w.find('[data-testid="s2v-voice-volume"]').exists()).toBe(true);
  });

  it('writes slider changes through the shared config object, never a local copy', async () => {
    const w = mountPanel(vm);
    await w.get('[data-testid="s2v-voice-speed"]').setValue('1.4');
    expect(vm.s2vConfig.voiceSpeed).toBe(1.4);
  });

  it('writes scalar data through setState on the parent instance, and rejects unknown keys', () => {
    const ctx = createS2VPanel(vm);
    // 「按字数 / 按秒」一类标量直写必须回落到父实例，子组件不自持状态
    expect(() => ctx.setState('s2vSplitSecondsView', 12)).not.toThrow();
    expect(vm.s2vSplitSecondsView).toBe(12);
    expect(() => ctx.setState('notAContractKey', 1)).toThrow(/白名单/);
    // 未登记的方法 / 状态访问同样抛错（fail-closed）
    expect(() => ctx.fns.someUnknownMethod()).toThrow(/白名单/);
    expect(() => ctx.state.someUnknownKey).toThrow(/白名单/);
  });

  it('shows the default-value suffix only for untouched groups', () => {
    vm.s2vSectionAtDefault = (section) => section === 'basic';
    const w = mountPanel(vm);
    expect(w.get('[data-testid="s2v-section-basic"] .s2v-summary').text()).toBe('summary（默认）');
    expect(w.get('[data-testid="s2v-section-voice"] .s2v-summary').text()).toBe('summary');
  });

  it('is fail-closed when mounted outside the CreateView provider', () => {
    expect(() => mount(S2vConfigPanels)).toThrow(/s2vPanel/);
  });

  // ── 背景音乐分组归属与历史路径状态（s2v-bgm-legacy-repair，2026-10-17）──
  it('「背景音乐」与「背景音乐音量」归属「声音」分组，「画面」分组不再包含', () => {
    const w = mountPanel(vm);
    const voice = w.get('[data-testid="s2v-section-voice"]');
    expect(voice.find('[data-testid="s2v-bgm-select"]').exists()).toBe(true);
    expect(voice.find('[data-testid="s2v-bgm-volume"]').exists()).toBe(true);
    expect(voice.find('[data-testid="s2v-bgm-manage-button"]').exists()).toBe(true);

    const appearance = w.get('[data-testid="s2v-section-appearance"]');
    expect(appearance.find('[data-testid="s2v-bgm-select"]').exists()).toBe(false);
    expect(appearance.find('[data-testid="s2v-bgm-volume"]').exists()).toBe(false);
    expect(appearance.find('[data-testid="s2v-bgm-manage-button"]').exists()).toBe(false);
  });

  it('历史 BGM 可用：显示可用提示与「加入素材库」，不出现清除按钮', async () => {
    const adoptS2VLegacyBgm = vi.fn();
    vm = makeBoundVm({
      s2vLegacyBgmPath: 'C:/old.mp3',
      s2vLegacyBgmStatus: { state: 'available', path: 'C:/old.mp3', reason: 'ok', exists: true },
      adoptS2VLegacyBgm,
    });
    const w = mountPanel(vm);
    const status = w.get('[data-testid="s2v-bgm-legacy-status"]');
    expect(status.attributes('data-state')).toBe('available');
    expect(status.attributes('role')).toBe('status');
    expect(status.attributes('aria-live')).toBe('polite');
    expect(status.text()).toContain('create.story2video.bgmLibrary.legacyHintAvailable');
    expect(w.find('[data-testid="s2v-bgm-clear"]').exists()).toBe(false);
    await w.get('[data-testid="s2v-bgm-adopt"]').trigger('click');
    expect(adoptS2VLegacyBgm).toHaveBeenCalledTimes(1);
  });

  it('历史 BGM 已丢失：错误态提示 + 清除按钮，下拉选项文案切换为「文件已丢失」', async () => {
    const clearS2VLegacyBgm = vi.fn();
    vm = makeBoundVm({
      s2vLegacyBgmPath: 'C:/old.mp3',
      s2vLegacyBgmStatus: { state: 'missing', path: 'C:/old.mp3', reason: 'missing', exists: false },
      clearS2VLegacyBgm,
    });
    const w = mountPanel(vm);
    const status = w.get('[data-testid="s2v-bgm-legacy-status"]');
    expect(status.attributes('data-state')).toBe('missing');
    expect(status.text()).toContain('create.story2video.bgmLibrary.legacyHintMissing');
    expect(status.find('.inline-error').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-bgm-adopt"]').exists()).toBe(false);
    const options = w.get('[data-testid="s2v-bgm-select"]').findAll('option');
    expect(options.some((option) => option.text() === 'create.story2video.bgmLibrary.legacyMissing')).toBe(true);
    await w.get('[data-testid="s2v-bgm-clear"]').trigger('click');
    expect(clearS2VLegacyBgm).toHaveBeenCalledTimes(1);
  });

  it('历史 BGM 核验中：显示检查提示，不提供修复动作', () => {
    vm = makeBoundVm({
      s2vLegacyBgmPath: 'C:/old.mp3',
      s2vLegacyBgmStatus: { state: 'checking', path: 'C:/old.mp3', reason: '', exists: false },
    });
    const w = mountPanel(vm);
    const status = w.get('[data-testid="s2v-bgm-legacy-status"]');
    expect(status.attributes('data-state')).toBe('checking');
    expect(status.text()).toContain('create.story2video.bgmLibrary.legacyHintChecking');
    expect(w.find('[data-testid="s2v-bgm-adopt"]').exists()).toBe(false);
    expect(w.find('[data-testid="s2v-bgm-clear"]').exists()).toBe(false);
  });

  // ── 音色克隆入口按钮文案时序（voice-clone-pick-feedback，2026-10-18）──
  // 浏览系统文件选择器期间只应禁用按钮，不得改文案；文案只由实际添加态（pending）驱动。
  const clonePanelState = (overrides = {}) => ({
    s2vVoiceCapability: { type: 'user_clone', clone: { enabled: true } },
    s2vCloneOpen: true,
    ...overrides,
  });

  it('浏览文件期间（仅 loading、无 pending）入口按钮文案保持「选择本地音频文件」', () => {
    vm = makeBoundVm(clonePanelState({
      s2vVoiceCloneLoading: true,
      s2vVoiceClonePending: null,
      s2vVoiceCloneSelection: null,
    }));
    const w = mountPanel(vm);
    const button = w.get('[data-testid="s2v-voice-clone-choose-button"]');
    expect(button.text()).toContain('选择本地音频文件');
    expect(button.text()).not.toContain('正在添加…');
    expect(button.attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="s2v-voice-clone-status"]').exists()).toBe(false);
  });

  it('选定文件返回进入添加态（pending）后入口按钮切「正在添加…」，且优先于「重新选择」', () => {
    vm = makeBoundVm(clonePanelState({
      s2vVoiceCloneLoading: true,
      s2vVoiceClonePending: { id: 'pending-1', name: '音色001', sampleCount: 1 },
      s2vVoiceCloneSelection: { selectionId: 'sel-1', sampleCount: 1 },
      s2vVoiceCloneStatusText: () => '上传并添加中',
    }));
    const w = mountPanel(vm);
    const button = w.get('[data-testid="s2v-voice-clone-choose-button"]');
    expect(button.text()).toContain('正在添加…');
    expect(button.text()).not.toContain('重新选择音频文件');
    expect(w.find('[data-testid="s2v-voice-clone-status"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-voice-clone-pending-row"]').exists()).toBe(true);
  });

  it('添加结束后恢复已选样本态文案「重新选择音频文件」', () => {
    vm = makeBoundVm(clonePanelState({
      s2vVoiceCloneLoading: false,
      s2vVoiceClonePending: null,
      s2vVoiceCloneSelection: { selectionId: 'sel-1', sampleCount: 1 },
    }));
    const w = mountPanel(vm);
    expect(w.get('[data-testid="s2v-voice-clone-choose-button"]').text()).toContain('重新选择音频文件');
  });
});

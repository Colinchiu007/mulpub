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
// s2vSubgroupLabel 桩按真实父级口径返回 locale key（CreateView.s2vSubgroupLabel 用
// translateWithLocaleFallback 包 `create.story2video.subgroups.<name>`），
// 因此这里直接回 key 前缀 + 名字，与真实渲染同形。
const makeBoundVm = (overrides = {}) => makeVm({
  isOrchestratedPipeline: () => true,
  s2vOptionVisible: () => true,
  s2vSectionLabel: (section) => section,
  s2vSectionSummary: () => 'summary',
  s2vSectionAtDefault: () => false,
  s2vSubgroupLabel: (subgroup) => `create.story2video.subgroups.${subgroup}`,
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

  // voice-model-program-resolved（2026-10-18）：「语音模型」不再是用户可配置项。
  // 不论哪个 provider、模型是否可解析，面板都不得渲染该字段——这是本变更的 UI 契约。
  it('never renders a 「语音模型」 field: the model is resolved by the program', () => {
    // 场景 1：已选 provider 且模型可解析 → 「语音 / 音色 ID」在，但「语音模型」不在
    vm.s2vConfig.voiceProvider = 'minimax-multimodal';
    vm.s2vConfig.voiceModel = 'speech-2.8-turbo';
    vm.s2vVoiceContextModel = 'speech-2.8-turbo';
    let w = mountPanel(vm);
    const labels = (wrapper) => wrapper.findAll('.config-item label').map((n) => n.text());
    expect(labels(w)).toContain('语音生成器');
    expect(labels(w)).toContain('语音 / 音色 ID');
    expect(labels(w)).not.toContain('语音模型');
    w.unmount();

    // 场景 2：模型两个来源都为空 → 两个字段都不渲染，不留空白控件
    // （voice-model-program-resolved 修正，2026-10-19：正常路径由程序解析的 s2vVoiceContextModel
    // 提供；历史快照/配置档案回填尚未重算时由 s2vConfig.voiceModel 提供。二者皆空才视为未知。）
    vm.s2vVoiceContextModel = '';
    vm.s2vConfig.voiceModel = '';
    w = mountPanel(vm);
    expect(labels(w)).not.toContain('语音模型');
    expect(labels(w)).not.toContain('语音 / 音色 ID');
    w.unmount();

    // 场景 2b：仅 config.voiceModel 已知（未注册 provider 注册表 / 快照回填未重算）→ 字段照常渲染
    vm.s2vConfig.voiceModel = 'speech-2.8-turbo';
    w = mountPanel(vm);
    expect(labels(w)).toContain('语音 / 音色 ID');
    expect(labels(w)).not.toContain('语音模型');
    w.unmount();
    vm.s2vConfig.voiceModel = 'speech-2.8-turbo';

    // 场景 3：未选 provider → 同样不渲染
    vm.s2vConfig.voiceProvider = '';
    vm.s2vConfig.voiceModel = '';
    w = mountPanel(vm);
    expect(labels(w)).not.toContain('语音模型');
    w.unmount();
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

  // ── 声音区内部分区结构（s2v-voice-section-layout，2026-10-18）──
  // 用户报告：声音区四类控件（语音生成器/音色ID、背景音乐/音量、音色克隆）挤在同一
  // 自适应栅格里，「音色复制 / 克隆」只占半行宽、和「背景音乐音量」并排，看不出分组。
  // 修法：声音区内按「旁白设置 / 背景音乐 / 音色克隆」拆三个子分区，各子分区自带标题行，
  // 克隆面板满宽。断言锁 DOM 结构与顺序，防止回退成扁平栅格。
  const SUBGROUPS = ['voiceNarration', 'voiceBgm', 'voiceClone']

  it('「声音」区分拆为三个子分区，顺序为 旁白设置 → 背景音乐 → 音色克隆', () => {
    const w = mountPanel(vm);
    const voice = w.get('[data-testid="s2v-section-voice"]');
    const titles = voice.findAll('.s2v-subgroup-title').map((n) => n.text());
    expect(titles).toEqual([
      'create.story2video.subgroups.voiceNarration',
      'create.story2video.subgroups.voiceBgm',
      'create.story2video.subgroups.voiceClone',
    ]);
    // 子分区本体也带着可寻址的 data-testid（视觉回归/探针按它定位）
    expect(voice.findAll('.s2v-subgroup').map((n) => n.attributes('data-testid'))).toEqual(
      SUBGROUPS.map((s) => `s2v-subgroup-${s}`)
    );
  });

  it('三个子分区必须是「声音」分区的一级子节点（互不嵌套）', () => {
    // 2026-10-18 回归锁：本次实现期间曾因少写一个 </div>（末尾又恰好多一个，整体仍配平）
    // 使 voiceClone 被嵌进 voiceBgm 内部 —— 视觉上成了「卡片里套卡片」，
    // 用户要的「三个区域视觉上分开」直接落空。
    // ⚠️ 这个形态**测不出来**于「顺序 + testid」断言：findAll('.s2v-subgroup') 是深度优先，
    //    嵌套时 document order 依然是 narration → bgm → clone，全绿。
    //    所以判据必须落在**层级**上，不能落在顺序上。
    const w = mountPanel(vm);
    const voice = w.get('[data-testid="s2v-section-voice"]');
    // ① details 的直接元素子节点 = summary + 三个 .s2v-subgroup，顺序与集合一致
    const directSubgroups = [...voice.element.children]
      .filter((el) => el.classList && el.classList.contains('s2v-subgroup'))
      .map((el) => el.getAttribute('data-testid'));
    expect(directSubgroups).toEqual(SUBGROUPS.map((s) => `s2v-subgroup-${s}`));
    // ② 互不嵌套：任一子分区的祖先链上不得再出现 .s2v-subgroup
    for (const s of SUBGROUPS) {
      let el = w.get(`[data-testid="s2v-subgroup-${s}"]`).element.parentElement;
      while (el && el !== voice.element) {
        expect(el.classList.contains('s2v-subgroup')).toBe(false);
        el = el.parentElement;
      }
    }
  });

  it('「语音生成器」与「语音 / 音色 ID」同在「旁白设置」子分区', () => {
    // 「语音 / 音色 ID」仅在已选语音模型（或模型下拉被隐藏）时渲染，故显式给模型值。
    vm = makeBoundVm({ s2vConfig: s2vConfigFixture() });
    vm.s2vConfig.voiceProvider = 'minimax-multimodal';
    vm.s2vConfig.voiceModel = 'speech-2.8-turbo';
    const w = mountPanel(vm);
    const narration = w.get('[data-testid="s2v-subgroup-voiceNarration"]');
    expect(narration.text()).toContain('语音生成器');
    expect(narration.text()).toContain('语音 / 音色 ID');
    // 「背景音乐」子分区不得包含语音生成器（分区之间不得互相渗透）
    const bgm = w.get('[data-testid="s2v-subgroup-voiceBgm"]');
    expect(bgm.text()).not.toContain('语音生成器');
  });

  it('「背景音乐」与「背景音乐音量」同在「背景音乐」子分区', () => {
    const w = mountPanel(vm);
    const bgm = w.get('[data-testid="s2v-subgroup-voiceBgm"]');
    expect(bgm.find('[data-testid="s2v-bgm-select"]').exists()).toBe(true);
    expect(bgm.find('[data-testid="s2v-bgm-volume"]').exists()).toBe(true);
    expect(bgm.find('[data-testid="s2v-bgm-manage-button"]').exists()).toBe(true);
    // 与「音色复制 / 克隆」分区不共居
    const clone = w.get('[data-testid="s2v-subgroup-voiceClone"]');
    expect(clone.find('[data-testid="s2v-bgm-select"]').exists()).toBe(false);
  });

  it('「音色复制 / 克隆」独占满宽子分区（不与「背景音乐音量」并排）', () => {
    vm = makeBoundVm({
      s2vVoiceCapability: { type: 'user_clone', clone: { enabled: true } },
      s2vCloneOpen: true,
    });
    const w = mountPanel(vm);
    const clone = w.get('[data-testid="s2v-subgroup-voiceClone"]');
    // 克隆面板本体 + 展开后的克隆列表都归该子分区
    expect(clone.find('[data-testid="s2v-voice-clone-toggle"]').exists()).toBe(true);
    expect(clone.classes()).toContain('s2v-subgroup');
    // 分区体内只允许克隆自己的子项：不得出现 BGM 滑杆（这是本次用户报告的直接症状）
    expect(clone.find('[data-testid="s2v-bgm-volume"]').exists()).toBe(false);
  });

  it('「当前服务商尚未接入可用的音色克隆能力」提示归入克隆子分区', () => {
    vm = makeBoundVm({ s2vVoiceCapability: { type: 'user_clone', clone: { enabled: false } } });
    const w = mountPanel(vm);
    const clone = w.get('[data-testid="s2v-subgroup-voiceClone"]');
    expect(clone.text()).toContain('音色复制 / 克隆');
    expect(clone.text()).toContain('当前服务商尚未接入可用的音色克隆能力');
  });

  it('「个人音色槽位」说明归入克隆子分区', () => {
    vm = makeBoundVm({ s2vVoiceCapability: { type: 'provider_personal_slot' } });
    const w = mountPanel(vm);
    const clone = w.get('[data-testid="s2v-subgroup-voiceClone"]');
    expect(clone.text()).toContain('个人音色槽位');
  });

  it('声音区默认收缩：details 不带 open 属性', () => {
    const w = mountPanel(vm);
    expect(w.find('[data-testid="s2v-section-voice"]').attributes('open')).toBeUndefined();
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

  // QM-6 外部评审 Info：重选场景（已有样本时再次打开文件选择器）同样不得提前显示进行中文案。
  it('重选期间（仅 loading、已有 selection、无 pending）按钮文案保持「重新选择音频文件」', () => {
    vm = makeBoundVm(clonePanelState({
      s2vVoiceCloneLoading: true,
      s2vVoiceClonePending: null,
      s2vVoiceCloneSelection: { selectionId: 'sel-old', sampleCount: 1 },
    }));
    const w = mountPanel(vm);
    const button = w.get('[data-testid="s2v-voice-clone-choose-button"]');
    expect(button.text()).toContain('重新选择音频文件');
    expect(button.text()).not.toContain('正在添加…');
    expect(button.attributes('disabled')).toBeDefined();
  });
});

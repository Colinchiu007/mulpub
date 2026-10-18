import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import i18n from '@/i18n';

// Publish.vue 用 useRoute()，它要真实 router 插件才能拿到 route——只 mock $route 会让
// setup 里的 computed 在 route.query 上抛错，七条用例一起挂在夹具上（那种红没有归因价值）。
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: { template: '<div>home</div>' } },
    { path: '/publish', name: 'publish', component: { template: '<div>publish</div>' } },
  ],
});

/**
 * tasks 4.3②-b③ —— 发布页文本类分支的「一键出期」入口（PRD §7.10.3.4 ②-b③）
 *
 * 为什么要单开这份文件：Publish.test.js 那 1900 行没有一条用例引用过
 * activeChannelId / PodcastScriptEntry，这一枚入口在主干上处于「合同已写、零验收」的状态。
 * 下面的判据逐条对应 §7.10.3.4 的验收 1 / 2 / 4，外加这一枚独有的一条：
 * article.content 是**在途状态**（发布动作与改写面板双向改写它），入口必须只读。
 */

const podcastApi = vi.hoisted(() => ({
  episodePlanPreview: vi.fn(),
  episodePublishFromScript: vi.fn(),
  onEpisodePublishProgress: vi.fn(),
}));
vi.mock('@/api/podcast-channel', async (importOriginal) => Object.assign({}, await importOriginal(), podcastApi));

const suspension = vi.hoisted(() => ({ suspend: vi.fn(async () => {}), release: vi.fn(async () => {}) }));
vi.mock('@/composables/useEmbeddedViewSuspension', () => ({
  suspendEmbeddedViewsForOverlay: suspension.suspend,
  releaseEmbeddedViewsForOverlay: suspension.release,
}));

const channelState = vi.hoisted(() => ({}));
vi.mock('@/composables/usePodcastChannel', async (importOriginal) => {
  const { ref } = await import('vue');
  const original = await importOriginal();
  const activeChannelId = ref('');
  const ensureChannel = vi.fn(async () => { activeChannelId.value = 'ch_from_ensure'; return activeChannelId.value; });
  channelState.activeChannelId = activeChannelId;
  channelState.ensureChannel = ensureChannel;
  return { ...original, usePodcastChannel: () => ({ activeChannelId, ensureChannel }) };
});

import PublishView from './Publish.vue';
import PodcastScriptEntry from '@/components/PodcastScriptEntry.vue';

const avail = (result) => ({ available: true, result });
const ENTRY_TESTID = '[data-testid="btn-podcast-script-entry"]';
// 首尾各留一个空白：用来证「入口只读」不是「顺手 trim 了一下」也能过
const SENTINEL = '  MP_SENTINEL_发布页内存里这份正文_入口带出的必须逐字是它_末尾也不许追加_  \n';

async function factory() {
  const w = mount(PublishView, {
    global: {
      plugins: [router, createPinia(), i18n],
      mocks: { $router: { push: vi.fn(), replace: vi.fn() }, $route: { query: {}, path: '/publish' } },
      stubs: {
        teleport: true,
        'el-checkbox-group': { template: '<div><slot/></div>' },
        'el-checkbox': { template: '<label><input type="checkbox" /><slot/></label>' },
        'el-upload': { template: '<div><slot/></div>' },
        'el-icon': { template: '<span><slot/></span>' },
        ArticleEditor: true,
        TitleAssistantPanel: true,
        TemplatePicker: true,
        UpgradeModal: true,
        AiWriterPanel: true,
        TagSuggester: true,
        OptimalTimeTip: true,
      },
    },
  });
  await nextTick();
  await flushPromises();
  return w;
}

async function openEntry(w) {
  await w.find(ENTRY_TESTID).trigger('click');
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe('PublishView — 文本出期入口的合同（§7.10.3.4 ②-b③）', () => {
  beforeEach(() => {
    podcastApi.episodePlanPreview.mockReset();
    podcastApi.episodePublishFromScript.mockReset();
    podcastApi.onEpisodePublishProgress.mockReset();
    suspension.suspend.mockClear();
    suspension.release.mockClear();
    // 夹具自证：这份 mock 的工厂只有被测模块真的 import 了 usePodcastChannel 才会跑。
    // 缺这一句时「入口不存在」这类负向断言会对着未装配的夹具空转，读起来完全像通过。
    if (!channelState.activeChannelId) {
      throw new Error('夹具未装配：Publish.vue 没有 import usePodcastChannel ⇒ 本文件的负向断言全部无意义');
    }
    channelState.activeChannelId.value = '';
    channelState.ensureChannel.mockClear();
    podcastApi.episodePlanPreview.mockResolvedValue(avail({
      ok: true,
      plan: { totalBlocks: 4, totalCodepoints: 128 },
      voice: { providerId: 'p1', model: 'm1', voiceId: 'v1', origin: 'channel' },
    }));
    podcastApi.onEpisodePublishProgress.mockReturnValue(() => {});
    podcastApi.episodePublishFromScript.mockResolvedValue(avail({ state: 'success', feedUrl: 'https://example.com/f.xml' }));
    i18n.global.locale.value = 'zh';
  });

  it('判据 1：无默认频道 ⇒ 入口在 DOM 中不存在（不是 disabled）', async () => {
    const w = await factory();
    w.vm.article.content = SENTINEL;
    await nextTick();
    expect(channelState.activeChannelId.value, '夹具前提：这一档就是没有默认频道').toBe('');
    expect(w.find(ENTRY_TESTID).exists()).toBe(false);
  });

  it('判据 1 反向正控：有默认频道且有正文 ⇒ 入口出现（防上一条因选择器写错而空转）', async () => {
    channelState.activeChannelId.value = 'ch_a';
    const w = await factory();
    w.vm.article.content = SENTINEL;
    await nextTick();
    expect(w.find(ENTRY_TESTID).exists()).toBe(true);
  });

  it('判据 2：正文只有空白 ⇒ 入口不出现，且浮层实例根本没被挂载（挂载钩子 0 次的实例级写法）', async () => {
    channelState.activeChannelId.value = 'ch_a';
    const w = await factory();
    w.vm.article.content = '   \n\t ';
    await nextTick();
    expect(w.find(ENTRY_TESTID).exists()).toBe(false);
    expect(w.findComponent(PodcastScriptEntry).exists(), '正文缺席时浮层不得被挂载').toBe(false);
    expect(podcastApi.episodePlanPreview, '浮层没挂载就不该有预览调用').not.toHaveBeenCalled();
  });

  it('判据 4 前半：点开浮层 ⇒ 预览入参逐字带出这一页当时那份正文（含首尾空白）', async () => {
    channelState.activeChannelId.value = 'ch_a';
    const w = await factory();
    w.vm.article.content = SENTINEL;
    await nextTick();
    await openEntry(w);

    expect(w.findComponent(PodcastScriptEntry).exists()).toBe(true);
    const call = podcastApi.episodePlanPreview.mock.calls[0];
    expect(call, '浮层挂载了却没调预览 ⇒ 显示项无从而来').toBeTruthy();
    expect(call[0].channelId).toBe('ch_a');
    expect(call[0].script, '预览拿到的必须是内存里那份原文，不得被 trim/追加改写').toBe(SENTINEL);
  });

  it('判据 4 后半：从这枚入口点确认 ⇒ 出期载荷 copy.content 逐字等于那份正文，billingConfirmed 为真、runId 形态合规', async () => {
    channelState.activeChannelId.value = 'ch_a';
    const w = await factory();
    w.vm.article.content = SENTINEL;
    w.vm.article.title = '发布页当前标题';
    await nextTick();
    await openEntry(w);
    await w.find('[data-testid="podcast-script-confirm"]').trigger('click');
    await nextTick();
    await Promise.resolve();
    await nextTick();

    const sent = podcastApi.episodePublishFromScript.mock.calls[0];
    expect(sent, '确认按钮没把出期请求发出去 ⇒ 这条链是断的').toBeTruthy();
    const payload = sent[0];
    expect(payload.copy.content).toBe(SENTINEL);
    expect(payload.title, '标题必须与发布载荷同源（article.title 的当时值）').toBe('发布页当前标题');
    expect(payload.billingConfirmed).toBe(true);
    expect(payload.runId).toMatch(/^txt/);
    expect(payload.channelId).toBe('ch_a');
  });

  it('这一枚独有的副作用判据：入口全程只读，打开并确认后 article.content 逐字未变', async () => {
    channelState.activeChannelId.value = 'ch_a';
    const w = await factory();
    w.vm.article.content = SENTINEL;
    await nextTick();
    await openEntry(w);
    await w.find('[data-testid="podcast-script-confirm"]').trigger('click');
    await nextTick();
    await Promise.resolve();
    await nextTick();
    expect(w.vm.article.content, '出期不得为固化草稿而改写/归一化在途正文（§7.10.3.4 最后一行）').toBe(SENTINEL);
  });

  it('浮层常驻不卸载：关闭只收窗，不发第二次出期请求、也不销毁实例', async () => {
    channelState.activeChannelId.value = 'ch_a';
    const w = await factory();
    w.vm.article.content = SENTINEL;
    await nextTick();
    await openEntry(w);
    await w.find('[data-testid="podcast-script-cancel"]').trigger('click');
    await nextTick();
    expect(w.findComponent(PodcastScriptEntry).exists(), '关闭后组件应仍在树里（按需挂载、常驻）').toBe(true);
    expect(podcastApi.episodePublishFromScript).not.toHaveBeenCalled();
  });
});

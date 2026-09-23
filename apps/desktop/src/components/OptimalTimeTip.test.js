import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';

import { config as __vtuConfig } from '@vue/test-utils'
import { createI18n as __createI18n } from 'vue-i18n'
import __zhLocale from '@/locales/zh'
import __enLocale from '@/locales/en'
__vtuConfig.global.plugins = [
  ...(__vtuConfig.global.plugins || []),
  __createI18n({
    legacy: false,
    locale: 'zh',
    fallbackLocale: 'en',
    messages: { zh: __zhLocale, en: __enLocale },
  }),
]

// 组件已 import { intelligenceGetOptimalTime } from '@/api/publisher'
// 必须用 vi.mock 拦截 ESM import，globalThis 赋值无法拦截
// 工厂内创建 vi.fn()，通过 import 拿引用（vi.mock 是 hoisted，不能引用外部变量）
vi.mock('@/api/publisher', () => ({
  intelligenceGetOptimalTime: vi.fn(),
}));

import { intelligenceGetOptimalTime } from '@/api/publisher';
import OptimalTimeTip from './OptimalTimeTip.vue';

describe('OptimalTimeTip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(intelligenceGetOptimalTime).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders initial state (no keyword)', () => {
    const w = mount(OptimalTimeTip, { props: { keyword: '' } });
    expect(w.text()).toMatch(/输入更长|最佳发布时间/);
  });

  it('renders short keyword prompt', () => {
    const w = mount(OptimalTimeTip, { props: { keyword: 'a' } });
    expect(w.text()).toMatch(/输入更长|最佳发布时间/);
  });

  it('watcher triggers on keyword prop change', async () => {
    vi.mocked(intelligenceGetOptimalTime).mockResolvedValue({ code: 0, data: { recommendation: { topHours: [] } } });
    const w = mount(OptimalTimeTip, { props: { keyword: '' } });
    await w.setProps({ keyword: 'test' });
    await vi.advanceTimersByTimeAsync(600);
    expect(intelligenceGetOptimalTime).toHaveBeenCalled();
  });

  it('shows error when API fails', async () => {
    vi.mocked(intelligenceGetOptimalTime).mockRejectedValue(new Error('err'));
    const w = mount(OptimalTimeTip, { props: { keyword: '' } });
    await w.setProps({ keyword: 'test' });
    await vi.advanceTimersByTimeAsync(600);
    expect(w.text()).toMatch(/err|失败/);
  });

  it('shows results via prop change', async () => {
    vi.mocked(intelligenceGetOptimalTime).mockResolvedValue({
      code: 0,
      data: {
        recommendation: { topHours: [{ hourUTC: 2, hourCN: 10, score: 85 }], bestHourUTC: 2, bestHourCN: 10, dataPoints: 100 },
        bySource: { douyin: 60 },
      },
    });
    const w = mount(OptimalTimeTip, { props: { keyword: '' } });
    await w.setProps({ keyword: 'test' });
    await vi.advanceTimersByTimeAsync(600);
    expect(w.text()).toContain('10:00');
  });
});

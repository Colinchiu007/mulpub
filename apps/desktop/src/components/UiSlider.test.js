import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import UiSlider from './UiSlider.vue';

// 详情页数值型选项（语速 / 音量 / 占比）统一由 UiSlider 承载，
// 契约见 01-docs/PRD-S2V-PIPELINE-PAGE-UX.md §11。
const speed = (value, extra = {}) => ({
  props: { modelValue: value, min: 0.5, max: 2, step: 0.1, defaultValue: 1, suffix: 'x', ...extra },
});

describe('UiSlider', () => {
  it('renders head label and tabular value with suffix', () => {
    const w = mount(UiSlider, speed(1.5, { label: '旁白语速', testid: 's2v-voice-speed' }));
    expect(w.find('label.ui-slider-label').text()).toBe('旁白语速');
    expect(w.find('.ui-slider-value').text()).toBe('1.5x');
    expect(w.find('input[type=range]').attributes('data-testid')).toBe('s2v-voice-speed');
  });

  it('derives decimals from step (0.05 -> two digits)', () => {
    const w = mount(UiSlider, {
      props: { modelValue: 1, min: 0, max: 2, step: 0.05, defaultValue: 1 },
    });
    expect(w.find('.ui-slider-value').text()).toBe('1.00');
  });

  it('writes the filled percentage as --pct for the track gradient', () => {
    const w = mount(UiSlider, speed(1.25));
    expect(w.find('input[type=range]').attributes('style')).toMatch(/--pct:\s*50%/);
  });

  it('clamps out-of-range values back into [min, max]', () => {
    const w = mount(UiSlider, speed(9));
    expect(w.find('.ui-slider-value').text()).toBe('2.0x');
  });

  it('emits a number on input', async () => {
    const w = mount(UiSlider, speed(1));
    await w.find('input[type=range]').setValue('1.3');
    expect(w.emitted('update:modelValue').at(-1)).toEqual([1.3]);
  });

  it('double-click restores the default value', async () => {
    const w = mount(UiSlider, speed(1.5));
    await w.find('input[type=range]').trigger('dblclick');
    expect(w.emitted('update:modelValue').at(-1)).toEqual([1]);
    expect(w.emitted('change').at(-1)).toEqual([1]);
  });

  it('PageUp / PageDown step by 10x step, Home / End jump to bounds', async () => {
    const w = mount(UiSlider, speed(1));
    const input = w.find('input[type=range]');
    await input.trigger('keydown', { key: 'PageUp' });
    expect(w.emitted('update:modelValue').at(-1)).toEqual([2]);
    await input.trigger('keydown', { key: 'Home' });
    expect(w.emitted('update:modelValue').at(-1)).toEqual([0.5]);
    await input.trigger('keydown', { key: 'End' });
    expect(w.emitted('update:modelValue').at(-1)).toEqual([2]);
  });

  it('Alt+D resets to default', async () => {
    const w = mount(UiSlider, speed(1.8));
    await w.find('input[type=range]').trigger('keydown', { key: 'd', altKey: true });
    expect(w.emitted('update:modelValue').at(-1)).toEqual([1]);
  });

  it('is inert when disabled', async () => {
    const w = mount(UiSlider, speed(1.5, { disabled: true }));
    expect(w.classes()).toContain('is-disabled');
    await w.find('input[type=range]').trigger('dblclick');
    await w.find('input[type=range]').trigger('keydown', { key: 'PageUp' });
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });

  it('bare mode drops the built-in head but keeps an accessible name', () => {
    const w = mount(UiSlider, speed(25, {
      min: 10, max: 50, step: 5, defaultValue: 25, bare: true, suffix: '%', ariaLabel: 'AI 视频占比',
    }));
    expect(w.find('.ui-slider-head').exists()).toBe(false);
    expect(w.find('input[type=range]').attributes('aria-label')).toBe('AI 视频占比');
  });
});

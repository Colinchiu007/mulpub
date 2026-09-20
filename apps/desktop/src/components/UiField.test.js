import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import UiField from './UiField.vue';
import { S2V_PANEL_KEY } from '../views/video-creation/s2v-panel-contract';

const panel = (visible) => ({
  [S2V_PANEL_KEY]: { state: {}, fns: { s2vOptionVisible: (key) => visible(key) }, setState: () => {} },
});

describe('UiField', () => {
  it('always renders when no optionKey is given', () => {
    const w = mount(UiField, { props: { label: '标题' }, slots: { default: '<input />' } });
    expect(w.find('input').exists()).toBe(true);
    expect(w.find('label').text()).toBe('标题');
  });

  it('hides the whole field when the operation switch turns the option off', () => {
    const w = mount(UiField, {
      props: { label: '水印', optionKey: 'visual.watermarkText' },
      global: { provide: panel(() => false) },
      slots: { default: '<input />' },
    });
    // 根节点 v-if=false 时 Vue 只留一个注释占位节点，因此断言内部元素不存在
    expect(w.find('.ui-field').exists()).toBe(false);
    expect(w.find('input').exists()).toBe(false);
  });

  it('keeps the fail-open semantics when the parent reports the key unknown', () => {
    const w = mount(UiField, {
      props: { label: '水印', optionKey: 'visual.watermarkText' },
      global: { provide: panel(() => true) },
      slots: { default: '<input />' },
    });
    expect(w.find('input').exists()).toBe(true);
  });

  it('is fail-closed: an optionKey without a provider throws instead of silently hiding', () => {
    expect(() => mount(UiField, { props: { optionKey: 'basic.voiceSpeed' } })).toThrow(/s2vPanel/);
  });

  it('marks the error state, and only reserves the error row when asked', () => {
    const clean = mount(UiField, { props: { label: '标题' }, slots: { default: '<input />' } });
    // 密集栅格下默认不留 18px 死高：永不出错的字段不应白堆空白
    expect(clean.find('.ui-field-error').exists()).toBe(false);
    expect(clean.attributes('aria-invalid')).toBeUndefined();

    const reserved = mount(UiField, { props: { label: '标题', reserveError: true }, slots: { default: '<input />' } });
    expect(reserved.find('.ui-field-error').classes()).toContain('is-empty');

    const broken = mount(UiField, {
      props: { label: '标题', error: '超出取值范围' },
      slots: { default: '<input />' },
    });
    expect(broken.classes()).toContain('ui-field--error');
    expect(broken.attributes('aria-invalid')).toBe('true');
    expect(broken.find('.ui-field-error').text()).toBe('超出取值范围');
    // 有错误时错误位常驻：预留行高固定，避免提示出现时页面跳动
    expect(broken.find('.ui-field-error').classes()).not.toContain('is-empty');
  });

  it('exposes the required marker and inline layout switch', () => {
    const w = mount(UiField, { props: { label: '标题', required: true, inline: true } });
    expect(w.classes()).toContain('ui-field--inline');
    expect(w.find('.ui-field-required').exists()).toBe(true);
  });
});

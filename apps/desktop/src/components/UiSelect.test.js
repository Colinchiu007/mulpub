import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import UiSelect from './UiSelect.vue';
import { S2V_PANEL_KEY } from '../views/video-creation/s2v-panel-contract';

describe('UiSelect', () => {
  const options = ['option1', 'option2', 'option3'];

  it('renders select element', () => {
    const w = mount(UiSelect, { props: { options } });
    expect(w.find('select').exists()).toBe(true);
  });

  it('renders options from array of strings', () => {
    const w = mount(UiSelect, { props: { options } });
    const opts = w.findAll('option');
    expect(opts).toHaveLength(3);
    expect(opts[0].text()).toBe('option1');
    expect(opts[1].text()).toBe('option2');
    expect(opts[2].text()).toBe('option3');
  });

  it('renders options from array of objects', () => {
    const objOpts = [
      { value: 'cn', label: '中文' },
      { value: 'en', label: 'English' },
    ];
    const w = mount(UiSelect, { props: { options: objOpts } });
    const opts = w.findAll('option');
    expect(opts).toHaveLength(2);
    expect(opts[0].text()).toBe('中文');
    expect(opts[0].attributes('value')).toBe('cn');
    expect(opts[1].text()).toBe('English');
    expect(opts[1].attributes('value')).toBe('en');
  });

  it('renders placeholder option', () => {
    const w = mount(UiSelect, { props: { options, placeholder: '请选择' } });
    const opts = w.findAll('option');
    expect(opts).toHaveLength(4);
    expect(opts[0].text()).toBe('请选择');
    expect(opts[0].attributes('value')).toBe('');
    expect(opts[0].attributes('disabled')).toBeDefined();
  });

  it('renders label when provided', () => {
    const w = mount(UiSelect, { props: { options, label: '语言' } });
    expect(w.find('.ui-select-label').text()).toBe('语言');
  });

  it('emits update:modelValue on change', async () => {
    const w = mount(UiSelect, { props: { options, modelValue: '' } });
    await w.find('select').setValue('option2');
    expect(w.emitted('update:modelValue')).toBeTruthy();
    expect(w.emitted('update:modelValue')[0]).toEqual(['option2']);
  });

  it('disables select when disabled prop is true', () => {
    const w = mount(UiSelect, { props: { options, disabled: true } });
    expect(w.find('select').attributes('disabled')).toBeDefined();
  });

  it('applies disabled state on individual options', () => {
    const objOpts = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true },
    ];
    const w = mount(UiSelect, { props: { options: objOpts } });
    const opts = w.findAll('option');
    expect(opts[1].attributes('disabled')).toBeDefined();
  });

  it('passes modelValue to select value', () => {
    const w = mount(UiSelect, { props: { options, modelValue: 'option2' } });
    expect(w.find('select').element.value).toBe('option2');
  });

  // ---- 详情页迁移带回的契约（计划 B）----

  const pickOption = async (w, index) => {
    const el = w.find('select').element;
    el.selectedIndex = index;
    el.dispatchEvent(new Event('change'));
    await w.vm.$nextTick();
  };

  it('keeps boolean option values as booleans (subtitle switch)', async () => {
    const w = mount(UiSelect, {
      props: { modelValue: true },
      slots: { default: '<option :value="true">开启</option><option :value="false">关闭</option>' },
    });
    await pickOption(w, 1);
    const emitted = w.emitted('update:modelValue')[0][0];
    expect(emitted).toBe(false);
    expect(typeof emitted).toBe('boolean');
  });

  it('keeps numeric option values as numbers (watermark opacity)', async () => {
    const w = mount(UiSelect, {
      props: { modelValue: 0.1 },
      slots: { default: '<option :value="0.1">10%</option><option :value="0.9">90%</option>' },
    });
    await pickOption(w, 1);
    const emitted = w.emitted('update:modelValue')[0][0];
    expect(emitted).toBe(0.9);
    expect(typeof emitted).toBe('number');
  });

  it('applies the .number model modifier when the parent asks for it', async () => {
    const w = mount(UiSelect, {
      props: { options: ['24', '30'], modelValue: 24, modelModifiers: { number: true } },
    });
    await pickOption(w, 1);
    expect(w.emitted('update:modelValue')[0][0]).toBe(30);
  });

  it('puts data-testid on the native select so setValue() keeps working', () => {
    const w = mount(UiSelect, { props: { options, testid: 's2v-video-mode' } });
    expect(w.find('select[data-testid="s2v-video-mode"]').exists()).toBe(true);
    expect(w.find('div[data-testid="s2v-video-mode"]').exists()).toBe(false);
  });

  it('keeps the legacy form-select class for shared styling', () => {
    const w = mount(UiSelect, { props: { options } });
    expect(w.find('select').classes()).toContain('form-select');
  });

  it('honours optionKey through the panel contract and fails closed without a provider', () => {
    const provide = (visible) => ({ [S2V_PANEL_KEY]: { fns: { s2vOptionVisible: () => visible } } });
    const hidden = mount(UiSelect, { props: { options, optionKey: 'visual.transition' }, global: { provide: provide(false) } });
    expect(hidden.find('.ui-select-wrap').exists()).toBe(false);
    const shown = mount(UiSelect, { props: { options, optionKey: 'visual.transition' }, global: { provide: provide(true) } });
    expect(shown.find('select').exists()).toBe(true);
    expect(() => mount(UiSelect, { props: { options, optionKey: 'visual.transition' } })).toThrow(/s2vPanel/);
  });
});

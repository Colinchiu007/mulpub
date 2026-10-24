import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import i18n from '@/i18n'
import { config as vtuConfig } from '@vue/test-utils'

vtuConfig.global.plugins = [i18n]

/**
 * 模型服务商页契约（2026-10-24，change: model-provider-status-tristate）
 *
 * 锁两件事：
 *  ① 状态标签是**三态**而不是把数据库 `enabled` 布尔位直译：
 *     没配过 Key 的卡片显示「未配置」，不是「已禁用」。
 *  ② 卡片可点 ⇒ 直接打开配置界面填写；但卡片内的操作按钮
 *     （测试连接 / 编辑 / 设为默认 / 删除、多模态能力 chip）**不得**被覆盖层吞掉。
 *
 * ⚠️ 为什么点击目标是「名称按钮」而不是卡片根：
 * 整卡可点由**名称按钮的 ::after 覆盖层**实现（stretched button），
 * 卡片根**不挂 @click、不挂 role="button"**。理由见 ModelProviders.vue 里
 * `.provider-name-btn::after` 上方那段注释（button 是 leaf 角色，
 * 给含真按钮的容器加 role 会把卡片内的操作按钮从 a11y 树上抹掉；
 * 挂 @click 又会撞上键盘可达性合同）。覆盖层的命中区是 CSS，
 * jsdom 没有命中测试 ⇒ 「整卡可点」由静态契约锁（见下方「覆盖层形状」用例），
 * 动作本身由点名称按钮的用例锁。
 */

const _list = vi.hoisted(() => ({ data: [] }))

vi.mock('@/api/model-providers', () => ({
  modelProviderList: vi.fn(async () => ({ code: 0, data: _list.data })),
  modelProviderCreate: vi.fn(async () => ({ code: 0, data: {} })),
  modelProviderUpdate: vi.fn(async () => ({ code: 0, data: {} })),
  modelProviderDelete: vi.fn(async () => ({ code: 0 })),
  modelProviderSetDefault: vi.fn(async () => ({ code: 0 })),
  modelProviderSetCapabilityDefault: vi.fn(async () => ({ code: 0 })),
  modelProviderTest: vi.fn(async () => ({ code: 0, message: 'ok' })),
  modelProviderPresets: vi.fn(async () => ({ code: 0, data: [] })),
  modelProviderIsConfigured: vi.fn(async () => ({ code: 0, data: false })),
  modelProviderGetDefault: vi.fn(async () => ({ code: 0, data: null })),
  modelProviderGet: vi.fn(async () => ({ code: 0, data: null })),
}))

vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn(async () => true) },
}))

vi.mock('@element-plus/icons-vue', () => {
  const Icon = { name: 'Icon', template: '<span />' }
  return new Proxy({}, { get: () => Icon })
})

/**
 * 全局 `el-dialog` 桩（test-setup.js 里注册的）**永远渲染插槽**，
 * 于是「配置界面有没有打开」这条断言在它底下恒为真 —— 弹窗内容从头到尾都在 DOM 里。
 * 本文件把该桩换成认 modelValue 的版本：关闭时不渲染内容。
 * 用完必须还原：global.stubs 是**跨测试文件共享**的进程级状态，
 * 不还原就会把「dialog 永远开着」这条假前提漏给后面的测试文件。
 */
const _originalStubs = vtuConfig.global.stubs
beforeAll(() => {
  vtuConfig.global.stubs = {
    ...(_originalStubs || {}),
    'el-dialog': {
      props: ['modelValue'],
      template: '<div v-if="modelValue" class="el-dialog"><slot /><slot name="footer" /></div>',
    },
  }
})
afterAll(() => {
  vtuConfig.global.stubs = _originalStubs
})

const UNCONFIGURED = {
  id: 'anthropic',
  name: 'Anthropic',
  category: 'llm',
  base_url: 'https://api.anthropic.com',
  models: ['claude-sonnet-4-20250514'],
  enabled: false,
  is_default: false,
  is_preset: true,
  is_configured: false,
  api_key_masked: '',
  config: {},
  capabilities: [],
}

const CONFIGURED = {
  id: 'openai',
  name: 'OpenAI',
  category: 'llm',
  base_url: 'https://api.openai.com/v1',
  models: ['gpt-4o'],
  enabled: true,
  is_default: false,
  is_preset: true,
  is_configured: true,
  api_key_masked: 'sk-****abcd',
  config: {},
  capabilities: [],
}

const DISABLED_WITH_KEY = {
  id: 'gemini',
  name: 'Gemini',
  category: 'llm',
  base_url: 'https://generativelanguage.googleapis.com',
  models: ['gemini-2.0-flash'],
  enabled: false,
  is_default: false,
  is_preset: true,
  is_configured: false,
  api_key_masked: 'AIza****wxyz',
  config: {},
  capabilities: [],
}

// 多模态服务商：能力默认 chip 是卡片内**唯一不靠 .card-actions 保护**的可交互元素
// （它在 card-body 里）⇒ 它的 @click.stop 必须自己有回归锁
const MULTIMODAL = {
  id: 'minimax-multimodal',
  name: 'MiniMax 多模态',
  category: 'multimodal',
  base_url: 'https://api.minimaxi.com',
  models: ['abab6.5s-chat', 'speech-02-hd'],
  enabled: true,
  is_default: false,
  is_preset: true,
  is_configured: true,
  api_key_masked: 'sk-****mm01',
  config: { capability_defaults: [] },
  capabilities: ['llm', 'tts'],
}

async function mountView () {
  const { default: ModelProviders } = await import('@/views/ModelProviders.vue')
  const wrapper = mount(ModelProviders)
  await nextTick()
  await nextTick()
  // 切到「全部」页签，让三类卡片同时在场
  await wrapper.find('[data-testid="view-mode-all"]').trigger('click')
  await nextTick()
  return wrapper
}

function cardOf (wrapper, id) {
  return wrapper.findAll('.provider-card').find(c => c.find('code').text() === id)
}

// 配置界面（编辑弹窗）是否已打开 —— 弹窗内唯一的密码输入框是 API Key 输入框
function configDialogOpen (wrapper) {
  return wrapper.find('input[type="password"]').exists()
}

// 删除确认弹窗是否已打开（弹窗文案含服务商名）
function deleteDialogOpen (wrapper) {
  return wrapper.text().includes('确定要删除服务商')
}

// 卡片上的「名称按钮」—— 整卡可点的真实点击目标
function nameButtonOf (wrapper, id) {
  return cardOf(wrapper, id).find('.provider-name-btn')
}

describe('模型服务商页 — 状态三态 + 卡片可点', () => {
  beforeEach(() => {
    // 清调用计数（保留实现）：否则「能力默认 chip 确实调了 API」这条断言会读到上一个用例的残留
    vi.clearAllMocks()
    _list.data = [UNCONFIGURED, CONFIGURED, DISABLED_WITH_KEY, MULTIMODAL]
  })

  it('三态标签：没配过 Key 显示「未配置」，已配置显示「已启用」，Key 还在但停用显示「已停用」', async () => {
    const wrapper = await mountView()
    const texts = wrapper.findAll('.provider-card').map(c => c.find('.status-label').text())
    expect(texts).toContain('未配置')
    expect(texts).toContain('已启用')
    expect(texts).toContain('已停用')
    // 「已禁用」这个说法不该再出现在状态标签上
    expect(texts).not.toContain('已禁用')
    wrapper.unmount()
  })

  it('点未配置卡片上的名称（= 整卡可点的目标）⇒ 直接打开配置界面（可填写 API Key）', async () => {
    const wrapper = await mountView()
    expect(configDialogOpen(wrapper)).toBe(false)
    await nameButtonOf(wrapper, 'anthropic').trigger('click')
    await nextTick()
    expect(configDialogOpen(wrapper)).toBe(true)
    wrapper.unmount()
  })

  it('点已配置卡片上的名称 ⇒ 同样打开配置界面', async () => {
    const wrapper = await mountView()
    await nameButtonOf(wrapper, 'openai').trigger('click')
    await nextTick()
    expect(configDialogOpen(wrapper)).toBe(true)
    wrapper.unmount()
  })

  it('覆盖层形状：整卡可点由名称按钮的 ::after 覆盖层实现，卡片根不挂 @click', async () => {
    // 命中区是 CSS（jsdom 无命中测试）⇒ 这条用静态契约锁形状：
    // ① 卡片根是定位基准（覆盖层的 containing block）
    // ② 名称按钮的 ::after 是 absolute + inset:0（盖住整卡）
    // ③ 卡片内的可交互元素被抬到覆盖层之上（z-index 高于覆盖层），否则点不到
    // ⚠️ 路径必须走 fileURLToPath：Windows 上 new URL(import.meta.url).pathname 带前导斜杠
    // （'/D:/a/…'），再被 path.join 拼成**双盘符** 'D:\D:\a\…' ⇒ ENOENT。
    // 这条断言在 Linux 本机绿、在 Windows CI 红，是「只在本机成立的断言」的典型形态。
    // 读出来还要把 CRLF 归一：仓内 Windows checkout 的 .vue 是 CRLF，
    // 正则里的 \n 前瞻在 CRLF 下不匹配 ⇒ 同样只在 Linux 上成立。
    const here = path.dirname(fileURLToPath(import.meta.url))
    const src = fs.readFileSync(path.join(here, 'ModelProviders.vue'), 'utf8').replace(/\r\n/g, '\n')
    expect(src).toMatch(/\.provider-card\s*\{[^}]*position:\s*relative/)
    expect(src).toMatch(/\.provider-name-btn::after\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/)
    const overlayZ = Number(/\.provider-name-btn::after\s*\{[^}]*z-index:\s*(\d+)/.exec(src)?.[1] ?? '-1')
    const raisedZ = Number(/\.card-actions,\s*\n\.capability-default-chip\s*\{[^}]*z-index:\s*(\d+)/.exec(src)?.[1] ?? '-1')
    expect(overlayZ).toBeGreaterThanOrEqual(0)
    expect(raisedZ).toBeGreaterThan(overlayZ)
    // 卡片根不得挂 @click（那会把它变成「非原生可点元素」而撞键盘可达性合同）
    const cardTag = /<div\s+v-for="p in filteredProviders"[^>]*class="provider-card[^"]*"[^>]*>/.exec(src)?.[0] || ''
    expect(cardTag).not.toContain('@click')
    expect(cardTag).not.toContain('role="button"')
  })

  it('卡片内的删除按钮不被覆盖层吞掉 ⇒ 点它开的是删除确认，不是配置界面', async () => {
    const wrapper = await mountView()
    const del = cardOf(wrapper, 'anthropic').find('.cohere-icon-btn-danger')
    expect(del.exists()).toBe(true)
    await del.trigger('click')
    await nextTick()
    // 正向：删除确认真的开了（这条不是「什么都没发生」的恒真）
    expect(deleteDialogOpen(wrapper)).toBe(true)
    // 反向：配置界面没被误开
    expect(configDialogOpen(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('卡片内的「测试连接」按钮不被覆盖层吞掉 ⇒ 点它发起测试、且不开配置界面', async () => {
    const wrapper = await mountView()
    // ⚠️ 必须挑一个**按钮 enabled** 的卡片：未配置卡片的测试按钮是 disabled 的，
    // disabled 按钮**根本不派发 click 事件** ⇒ 断言「没开弹窗」会恒真（外部审查 M-1 命中过这个形态）。
    // 这里用已配置的 openai 卡片，并显式断言按钮确实 enabled，把「非恒真」写进用例本身。
    const test = cardOf(wrapper, 'openai').find('.card-actions .cohere-icon-btn')
    expect(test.exists()).toBe(true)
    expect(test.attributes('disabled')).toBeUndefined()
    await test.trigger('click')
    await nextTick()
    // 正向：测试真的发起了（不是「点了没反应」的恒真）
    const api = await import('@/api/model-providers')
    expect(api.modelProviderTest).toHaveBeenCalledWith('openai')
    // 反向：配置界面没被误开
    expect(configDialogOpen(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('多模态「能力默认」chip 不冒泡 ⇒ 切换能力默认的同时不会误开配置界面', async () => {
    const wrapper = await mountView()
    const chip = cardOf(wrapper, 'minimax-multimodal').find('.capability-default-chip')
    expect(chip.exists()).toBe(true)
    await chip.trigger('click')
    await nextTick()
    // 反向断言：这次点击**确实做了事**（不能是「压根没点着」的空断言）
    const api = await import('@/api/model-providers')
    expect(api.modelProviderSetCapabilityDefault).toHaveBeenCalledWith('minimax-multimodal', 'llm', true)
    expect(configDialogOpen(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('「已配置」页签下的状态标签也是三态（另一个调用点，不能只锁「全部」页签那一个）', async () => {
    const { default: ModelProviders } = await import('@/views/ModelProviders.vue')
    const wrapper = mount(ModelProviders)
    await nextTick()
    await nextTick()
    // 已配置页签只列 is_configured === true 的服务商 ⇒ 状态标签应全是「已启用」
    const texts = wrapper.findAll('.provider-card').map(c => c.find('.status-label').text())
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.every(t => t === '已启用')).toBe(true)
    wrapper.unmount()
  })

  it('「已配置」页签下的卡片同样可点开配置界面', async () => {
    const { default: ModelProviders } = await import('@/views/ModelProviders.vue')
    const wrapper = mount(ModelProviders)
    await nextTick()
    await nextTick()
    const card = wrapper.find('.provider-card')
    expect(card.exists()).toBe(true)
    await card.find('.provider-name-btn').trigger('click')
    await nextTick()
    expect(configDialogOpen(wrapper)).toBe(true)
    wrapper.unmount()
  })
})

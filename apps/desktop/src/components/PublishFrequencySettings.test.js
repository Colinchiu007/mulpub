import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

const api = vi.hoisted(() => ({
  getPublishFrequencyPolicy: vi.fn(),
  setPublishFrequencyPolicy: vi.fn(),
  emergencyReleasePublishWait: vi.fn(),
  getPublishEmergencyStatus: vi.fn(),
}))
vi.mock('@/api/publisher', () => api)
const messages = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const box = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ElMessage: messages, ElMessageBox: box }
})

import PublishFrequencySettings from './PublishFrequencySettings.vue'

const POLICY_RES = {
  code: 0,
  data: {
    // 夹具必须与**生产同形**（QM-6 前端轴 C2）：`platforms[p]` 就是
    // `ipc-handlers/publish-frequency.js` 把 `guard._intervals(p)` 原样转发的结果 ——
    // v4 起该返回含 `tier`；曾因夹具自行补了一个生产不存在的 tier 而让「档位名渲染成 undefined」全绿过关。
    // 数值按 v4 量级写（账号档 5′/3′/1′、平台档统一 1′、日配额 200/350/500），避免夹具停在旧世界。
    platforms: {
      wechat_mp: { tier: 'long', accountMinMs: 5 * 60000, platformMinMs: 1 * 60000, accountDailyMax: 200 },
      douyin: { tier: 'clip', accountMinMs: 3 * 60000, platformMinMs: 1 * 60000, accountDailyMax: 350 },
      weibo: { tier: 'short', accountMinMs: 1 * 60000, platformMinMs: 1 * 60000, accountDailyMax: 500 },
    },
    overrides: null,
    // v5 逐平台账号间隔的**默认表**由 getPolicy 下发（真源是策略模块的
    // PLATFORM_ACCOUNT_MIN_INTERVAL_MS）。夹具与生产同形：这里只是其子集，
    // 组件不得自带第二份数字 —— 缺字段时清单必须显示占位而不是猜一个值。
    accountMinDefaults: {
      wechat_mp: 5 * 60000,
      douyin: 3 * 60000,
      weibo: 1 * 60000,
    },
    jitterRatio: 0.4,
    releaseGraceMs: 60000,
    // 合法域上界由主进程下发（change: publish-frequency-unwired-surfaces）。
    // 夹具值刻意与策略模块真源**不同**（真源是 5000 / 10080）：若夹具照抄真源，
    // "UI 是否真的用下发值"这件事就测不出来 —— 组件哪怕自己硬编码 5000 也能过。
    dailyMaxUpperBound: 4321,
    intervalMaxMinutes: 3210,
  },
}

const STUBS = {
  // 暴露 min/max 到 DOM：否则"上界来自 IPC"这条判据在测试里不可观测
  'el-input-number': { props: ['min', 'max'], template: '<div class="stub-number" :data-max="max" :data-min="min" />' },
  'el-switch': { template: '<div class="stub-switch" />' },
  // 必须声明 emits: ['click']：否则 onClick 会作为 fallthrough 属性落到原生 <button> 上，
  // 与显式 $emit('click') 叠加 ⇒ 一次点击触发两次（本仓实测踩过）
  'el-button': {
    props: ['disabled'],
    emits: ['click'],
    template: '<button class="stub-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  'el-select': { template: '<div class="stub-select"><slot /></div>' },
  'el-option': { template: '<div />' },
  'el-input': { template: '<div class="stub-input" />' },
  'el-alert': { props: ['title'], template: '<div class="stub-alert">{{ title }}</div>' },
}

async function mountPage () {
  const wrapper = mount(PublishFrequencySettings, {
    global: { plugins: [i18n], stubs: STUBS },
  })
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
  return wrapper
}

describe('PublishFrequencySettings（发布频率设置页；刻意不带档位版本号，避免每版都留一个过期索引名）', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    api.getPublishFrequencyPolicy.mockReset().mockResolvedValue(POLICY_RES)
    api.setPublishFrequencyPolicy.mockReset().mockResolvedValue({ code: 0, data: { saved: true } })
    api.emergencyReleasePublishWait.mockReset().mockResolvedValue({ code: 0, data: { released: true, taskId: 't-1', used: 1, max: 1 } })
    api.getPublishEmergencyStatus.mockReset().mockResolvedValue({ code: 0, data: { dayKey: '2026-10-10', max: 1, cooldownMs: 600000, retryAfterMs: 0, perAccount: {} } })
    messages.success.mockReset()
    messages.error.mockReset()
    box.confirm.mockReset().mockResolvedValue('confirm')
  })

  it('紧急放行每日上限取自 emergencyStatus（评审 i8：此前读 getPolicy 不返回的字段 ⇒ 恒显示 —）', async () => {
    const wrapper = await mountPage()
    expect(api.getPublishEmergencyStatus).toHaveBeenCalled()
    const text = wrapper.find('[data-testid="pubfreq-emergency-quota"]').text()
    expect(text).toContain('1')
    expect(text).not.toBe('—')
  })

  it('emergencyStatus 取不到时保持 —（不编造数字）', async () => {
    api.getPublishEmergencyStatus.mockResolvedValue({ code: -1, message: '未初始化' })
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="pubfreq-emergency-quota"]').text()).toBe('—')
  })

  it('挂载即拉取策略，并展示按档位分组的当前口径', async () => {
    const wrapper = await mountPage()
    expect(api.getPublishFrequencyPolicy).toHaveBeenCalledTimes(1)
    const text = wrapper.find('[data-testid="pubfreq-current"]').text()
    // 三个档位各一行摘要（不是逐平台 15 行噪音）
    expect(text).toContain('long')
    expect(text).toContain('clip')
    expect(text).toContain('short')
    expect(text).toContain('5 min')
    // 整页不得出现字面量 undefined（QM-6 前端轴 C2：payload 缺 tier 时就是这样一句脏字）
    expect(wrapper.text()).not.toContain('undefined')
  })

  it('提示文字不得把旧默认值写成现状（QM-6 前端轴 C1：v3 后同屏矛盾）', async () => {
    const wrapper = await mountPage()
    const text = wrapper.text()
    // 页面上方显示的是动态读数（v4 夹具：200/350/500），alert 若仍写「3 / 5 / 20」就是同屏自相矛盾的可见假陈述
    expect(text).not.toMatch(/默认值\s*3\s*\/\s*5\s*\/\s*20/)
    expect(text).not.toMatch(/Defaults\s*3\s*\/\s*5\s*\/\s*20/)
    // 且新文案必须把用户指回动态读数，而不是另写一份数
    expect(text).toContain('当前档位')
  })

  it('平台档提示不得承诺"永不改变同账号结果"（QM-6 前端轴 W2）', async () => {
    const wrapper = await mountPage()
    const text = wrapper.text()
    // 守卫是**两桶取更严**：把平台档填得比账号档大时，同账号也会被它拦住 ——
    // 旧文案那句「同账号时账号档恒更严，该值不改变结果」是被用户自己的输入可以打破的保证
    expect(text).not.toContain('该值不改变结果')
    expect(text).toContain('较严者')
    // v4：短内容档的账号间隔与平台间隔**相等**（都是 1′），
    // 所以"默认各档账号档**更**严"这句从 v4 起是不准确的可见陈述 —— 正确说法是"不低于"。
    expect(text).not.toMatch(/默认各档账号档更严/)
    expect(text).toContain('不低于')
  })

  it('合法域上界必须来自 IPC 下发：模板里不得留第二份数字', async () => {
    // 动因：模板曾硬编码 :max="999"（日配额）与 :max="10080"（分钟）。同一个量在
    // 主进程（env 无上界、设置页覆盖无上界）与渲染层各有各的界 ⇒ UI 与真实合法域脱钩。
    // 正解＝上界只住策略模块，经 getPolicy 下发，UI 绑定它。
    const src = require('fs').readFileSync(require.resolve('./PublishFrequencySettings.vue'), 'utf8')
    // 只扫**代码行**：修动的注释里会引用旧写法（本次就引用了 `:max="999"`），
    // 不过滤等于把注释当代码扫 —— 本仓在别的结构锁上踩过同一形态两次。
    const code = src.split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l))
      .join('\n')
    expect(code).not.toMatch(/:max="999"/)
    expect(code).not.toMatch(/:max="10080"/)
    // 真用上：夹具故意给的是 4321 / 3210（不是真源数字），断言到就说明值真的在流动
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="pubfreq-daily-long"]').attributes('data-max')).toBe('4321')
    expect(wrapper.find('[data-testid="pubfreq-daily-clip"]').attributes('data-max')).toBe('4321')
    expect(wrapper.find('[data-testid="pubfreq-daily-short"]').attributes('data-max')).toBe('4321')
    expect(wrapper.find('[data-testid="pubfreq-account-min"]').attributes('data-max')).toBe('3210')
    expect(wrapper.find('[data-testid="pubfreq-platform-min"]').attributes('data-max')).toBe('3210')
  })

  it('v5 档位摘要仍按档位分组：同档内账号间隔不同时给区间，不得出现两条同名档位', async () => {
    // v5 把账号档改成逐平台后，摘要若继续按「三维元组」分组，视频号会自成第二条 clip 行
    // ——「clip（1 个平台，如 tencent_video）」对用户是假陈述（clip 档实际有 9 个平台）。
    const payload = {
      ...POLICY_RES,
      data: {
        ...POLICY_RES.data,
        platforms: {
          douyin: { tier: 'clip', accountMinMs: 3 * 60000, platformMinMs: 1 * 60000, accountDailyMax: 350 },
          tencent_video: { tier: 'clip', accountMinMs: 60 * 60000, platformMinMs: 1 * 60000, accountDailyMax: 350 },
        },
      },
    }
    api.getPublishFrequencyPolicy.mockResolvedValue(payload)
    const wrapper = await mountPage()
    const text = wrapper.find('[data-testid="pubfreq-current"]').text()
    expect((text.match(/clip/g) || []).length, `clip 档只应有一行摘要：${text}`).toBe(1)
    expect(text).toContain('2 个平台')
    expect(text).toContain('3–60 min')
  })

  // ── v5：逐平台同账号间隔（change: publish-frequency-per-platform-intervals）──────
  it('v5 逐平台清单：默认值与生效值都来自下发载荷，未覆盖时不打「已覆盖」标记', async () => {
    const wrapper = await mountPage()
    const row = wrapper.find('[data-testid="pubfreq-row-wechat_mp"]').text()
    expect(row).toContain('wechat_mp')
    expect(row).toContain('默认 5 min')
    expect(row).toContain('生效 5 min')
    expect(wrapper.findAll('[data-testid="pubfreq-overridden"]'), '无覆盖时不得凭空打标').toHaveLength(0)
  })

  it('v5 逐平台覆盖：该行显示生效≠默认并打标，输入框回填覆盖值；未覆盖平台必须留空', async () => {
    const payload = {
      ...POLICY_RES,
      data: {
        ...POLICY_RES.data,
        overrides: { accountMinMsByPlatform: { douyin: 30 * 60000 } },
        platforms: {
          ...POLICY_RES.data.platforms,
          douyin: { tier: 'clip', accountMinMs: 30 * 60000, platformMinMs: 1 * 60000, accountDailyMax: 350 },
        },
      },
    }
    api.getPublishFrequencyPolicy.mockResolvedValue(payload)
    const wrapper = await mountPage()
    const row = wrapper.find('[data-testid="pubfreq-row-douyin"]')
    expect(row.text()).toContain('默认 3 min')
    expect(row.text()).toContain('生效 30 min')
    expect(row.find('[data-testid="pubfreq-overridden"]').exists()).toBe(true)
    expect(wrapper.vm.form.accountByPlatform.douyin).toBe(30)
    // i3 同族：未覆盖的平台**不得**被回填成它的默认值 —— 预填等于下次保存时静默压平。
    // 判据写成"取出来要么没有、要么是 null"：组件只在有覆盖时才建键，二者都不构成回填。
    expect(wrapper.vm.form.accountByPlatform.wechat_mp ?? null).toBe(null)
    expect(wrapper.vm.form.accountByPlatform.weibo ?? null).toBe(null)
  })

  it('v5 提交：全部留空 ⇒ 不产生 accountMinMsByPlatform 键（未填 = 不覆盖，不是提交一份默认值）', async () => {
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="pubfreq-save"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.setPublishFrequencyPolicy).toHaveBeenCalledWith(null)
  })

  it('v5 提交：只提交填了的那几个平台，分钟按 60000 换算成毫秒', async () => {
    const wrapper = await mountPage()
    wrapper.vm.form.accountByPlatform.douyin = 7
    wrapper.vm.form.accountByPlatform.tencent_video = 90
    await nextTick()
    await wrapper.find('[data-testid="pubfreq-save"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    const payload = api.setPublishFrequencyPolicy.mock.calls[0][0]
    expect(Object.keys(payload).sort()).toEqual(['accountMinMsByPlatform'])
    expect(payload.accountMinMsByPlatform).toEqual({ douyin: 7 * 60000, tencent_video: 90 * 60000 })
  })

  it('v5 清单：载荷缺 accountMinDefaults 时显示占位 —，渲染层不得自带第二份数字', async () => {
    const payload = { ...POLICY_RES, data: { ...POLICY_RES.data } }
    delete payload.data.accountMinDefaults
    api.getPublishFrequencyPolicy.mockResolvedValue(payload)
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="pubfreq-row-wechat_mp"]').text()).toContain('默认 —')
    // 结构锁：逐平台数值只住策略模块；**代码行**里出现平台名或 60 分钟字面量即为第二份真源。
    // 只扫代码行（沿用同文件「:max=」那条锁的既有教训：修动的注释里会引用被禁写法本身）。
    const allLines = require('fs').readFileSync(require.resolve('./PublishFrequencySettings.vue'), 'utf8').split(/\r?\n/)
    const code = allLines.filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join('\n')
    expect(code).not.toMatch(/tencent_video/)
    expect(code).not.toMatch(/60 \* 60000/)
    // 反失明：过滤后的扫描域必须**非空且真含代码**（否则"把代码全滤掉"会让两条 not.toMatch 恒真）
    expect(code).toContain('platformRows')
    expect(code).toContain('accountByPlatform')
    expect(code.length).toBeGreaterThan(3000)
  })

  it('读失败时显示错误且不渲染表单（不静默降级成默认值糊弄用户）', async () => {
    api.getPublishFrequencyPolicy.mockResolvedValue({ code: -1, message: '守卫未初始化' })
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="pubfreq-load-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('守卫未初始化')
    expect(wrapper.find('[data-testid="pubfreq-save"]').exists()).toBe(false)
  })

  it('评审 i3：无覆盖时直接保存 ⇒ 提交 null，**不得**把首个平台档位压平到所有平台', async () => {
    // 覆盖对象是全局的：若按「首个平台」预填再保存，short 档（3 分钟 / 20 条）会被静默压成
    // 20 分钟 / 3 条，还提示「已保存并立即生效」。这条锁住「未填 = 不覆盖」。
    const wrapper = await mountPage()
    expect(wrapper.vm.form.accountMinutes).toBe(null)
    expect(wrapper.vm.form.dailyShort).toBe(null)
    await wrapper.find('[data-testid="pubfreq-save"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.setPublishFrequencyPolicy).toHaveBeenCalledWith(null)
  })

  it('只提交用户真正填了的字段（未填维度不被清掉）', async () => {
    const wrapper = await mountPage()
    wrapper.vm.form.accountMinutes = 15
    wrapper.vm.form.jitterOn = true
    await nextTick()
    await wrapper.find('[data-testid="pubfreq-save"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const payload = api.setPublishFrequencyPolicy.mock.calls[0][0]
    expect(Object.keys(payload).sort()).toEqual(['accountMinMs', 'jitterRatio'])
    expect(payload.accountMinMs).toBe(15 * 60000)
    expect(payload.dailyMax).toBeUndefined()
    expect(payload.platformMinMs).toBeUndefined()
  })

  it('保存时提交的字段名与主进程 resolvePolicyOverrides 逐一对应（自创字段名会被静默忽略）', async () => {
    const wrapper = await mountPage()
    wrapper.vm.form.accountMinutes = 20
    wrapper.vm.form.platformMinutes = 2
    wrapper.vm.form.dailyLong = 3
    wrapper.vm.form.dailyClip = 5
    wrapper.vm.form.dailyShort = 20
    wrapper.vm.form.jitterOn = true
    wrapper.vm.form.accountByPlatform.tencent_video = 12
    await nextTick()
    await wrapper.find('[data-testid="pubfreq-save"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(api.setPublishFrequencyPolicy).toHaveBeenCalledTimes(1)
    const payload = api.setPublishFrequencyPolicy.mock.calls[0][0]
    expect(Object.keys(payload).sort()).toEqual(['accountMinMs', 'accountMinMsByPlatform', 'dailyMax', 'jitterRatio', 'platformMinMs'])
    expect(payload).toMatchObject({ accountMinMs: 20 * 60000, platformMinMs: 2 * 60000, jitterRatio: 0.4 })
    expect(payload.dailyMax).toEqual({ long: 3, clip: 5, short: 20 })
    expect(payload.accountMinMsByPlatform).toEqual({ tencent_video: 12 * 60000 })
  })

  it('保存被主进程拒绝（全有或全无）⇒ 报错且**不报成功**', async () => {
    api.setPublishFrequencyPolicy.mockResolvedValue({ code: -2, message: '策略配置非法：已整体拒绝（未保存任何字段）' })
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="pubfreq-save"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(messages.error).toHaveBeenCalled()
    expect(messages.success).not.toHaveBeenCalled()
  })

  it('保存成功 ⇒ 成功提示 + 重新拉取（避免界面与生效值不一致）', async () => {
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="pubfreq-save"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(messages.success).toHaveBeenCalled()
    expect(api.getPublishFrequencyPolicy).toHaveBeenCalledTimes(2)
  })

  it('恢复默认提交 null（清空覆盖），不是提交一份「默认值」冒充', async () => {
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="pubfreq-reset"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.setPublishFrequencyPolicy).toHaveBeenCalledWith(null)
  })

  it('取消二次确认 ⇒ 不调用紧急放行 IPC、不提示（取消不是失败）', async () => {
    box.confirm.mockRejectedValue(new Error('cancel'))
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="pubfreq-emergency-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.emergencyReleasePublishWait).not.toHaveBeenCalled()
    expect(messages.error).not.toHaveBeenCalled()
  })

  it('紧急放行成功 ⇒ 明确回显成功', async () => {
    const wrapper = await mountPage()
    // 选一个平台（stub 下直接改组件状态不可行，改为不做选择时按钮 disabled 的验证）
    expect(wrapper.find('[data-testid="pubfreq-emergency-submit"]').attributes('disabled')).toBeDefined()
    wrapper.vm.emergency.platform = 'douyin'
    await nextTick()
    await wrapper.find('[data-testid="pubfreq-emergency-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.emergencyReleasePublishWait).toHaveBeenCalledWith(expect.objectContaining({ platform: 'douyin' }))
    expect(wrapper.find('[data-testid="pubfreq-emergency-result"]').text()).toContain('已解除等待')
  })

  it('紧急放行四态各自回显，且都不静默（exhausted / cooldown / no_waiting_window / disabled）', async () => {
    const cases = [
      { data: { released: false, reason: 'exhausted', max: 1 }, expect: '已用尽' },
      { data: { released: false, reason: 'cooldown', max: 1, retryAfterMs: 300000 }, expect: '距上次放行不足 5 分钟' },
      { data: { released: false, reason: 'no_waiting_window', max: 1 }, expect: '当前没有等待中的窗口' },
      { data: { released: false, reason: 'disabled', max: 0 }, expect: '已被关闭' },
    ]
    for (const c of cases) {
      api.emergencyReleasePublishWait.mockResolvedValue({ code: 0, data: c.data })
      const wrapper = await mountPage()
      wrapper.vm.emergency.platform = 'douyin'
      await nextTick()
      await wrapper.find('[data-testid="pubfreq-emergency-submit"]').trigger('click')
      await new Promise((r) => setTimeout(r, 0))
      const text = wrapper.find('[data-testid="pubfreq-emergency-result"]').text()
      expect(text, JSON.stringify(c.data)).toContain(c.expect)
      wrapper.unmount()
    }
  })

  it('紧急放行的 reason 透传，但 operator 不由渲染层自报（不给伪造操作者的入口）', async () => {
    const wrapper = await mountPage()
    wrapper.vm.emergency.platform = 'douyin'
    wrapper.vm.emergency.accountId = 'acc_1'
    wrapper.vm.emergency.reason = '客户催稿'
    await nextTick()
    await wrapper.find('[data-testid="pubfreq-emergency-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const payload = api.emergencyReleasePublishWait.mock.calls[0][0]
    expect(payload).toMatchObject({ platform: 'douyin', accountId: 'acc_1', reason: '客户催稿' })
    expect(payload).not.toHaveProperty('operator')
  })
})

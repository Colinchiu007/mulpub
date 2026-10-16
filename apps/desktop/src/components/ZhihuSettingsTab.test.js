/**
 * ZhihuSettingsTab — 设置页「知乎 API」分区行为锁
 *
 * 锁的是**用户看得见的三件事**：
 *   ① 状态说得准（已配置 / 未配置 / 已保存但读不出），而不是一律显示「已保存」；
 *   ② 明文永不回显（挂载后输入框为空、页面文本里没有明文、保存成功后输入框清空）；
 *   ③ 破坏性动作要二次确认，且确认前后都不误发请求。
 *
 * 用**真实 i18n**（@/i18n）而不是自造 messages：这样 `knowledgeBase.zhihu*` 这些键
 * 一旦在 zh.js / en.js 里缺失，本文件立刻变红（i18n 缺键会回退成 key 字面量）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'

const ZhihuSettingsTab = (await import('./ZhihuSettingsTab.vue')).default

const SECRET = 'zhihu-secret-abcdefgh-1234567890'

function cfg (overrides = {}) {
  return {
    code: 0,
    data: {
      configured: false,
      readable: false,
      maskedSecret: '',
      updatedAt: null,
      verifiedAt: null,
      favlistCount: null,
      legacyDetected: false,
      source: 'none',
      ...overrides,
    },
  }
}

function mountTab (api = {}) {
  window.electronAPI = api
  return mount(ZhihuSettingsTab, { global: { plugins: [i18n] } })
}

beforeEach(() => {
  i18n.global.locale.value = 'zh'
  vi.clearAllMocks()
  window.electronAPI = {}
})

describe('ZhihuSettingsTab 状态展示', () => {
  it('未配置：徽标「未配置」、无遮罩、无迁移/不可读提示、输入框为空', async () => {
    const w = mountTab({ zhihuGetConfig: vi.fn().mockResolvedValue(cfg()) })
    await flushPromises()
    expect(w.get('[data-testid="zhihu-status-badge"]').text()).toContain('未配置')
    expect(w.find('[data-testid="zhihu-masked-secret"]').exists()).toBe(false)
    expect(w.find('[data-testid="zhihu-legacy-notice"]').exists()).toBe(false)
    expect(w.find('[data-testid="zhihu-unreadable-hint"]').exists()).toBe(false)
    expect(w.get('[data-testid="zhihu-secret-input"]').element.value).toBe('')
  })

  it('已配置：徽标「已配置」+ 遮罩 + 保存时间 + 最近验证时间', async () => {
    const w = mountTab({
      zhihuGetConfig: vi.fn().mockResolvedValue(cfg({
        configured: true,
        readable: true,
        maskedSecret: 'zhih****7890',
        updatedAt: '2026-10-15T10:00:00.000Z',
        verifiedAt: '2026-10-15T10:05:00.000Z',
        favlistCount: 7,
        source: 'config',
      })),
    })
    await flushPromises()
    const text = w.text()
    expect(w.get('[data-testid="zhihu-status-badge"]').text()).toContain('已配置')
    expect(w.get('[data-testid="zhihu-masked-secret"]').text()).toContain('zhih****7890')
    expect(text).toContain('保存时间')
    expect(text).toContain('最近验证')
    // 明文绝不出现（遮罩里也没有完整密钥）
    expect(text).not.toContain(SECRET)
  })

  it('已保存但读不出：徽标为「已保存但无法读取」并给重存提示（不冒充「未配置」）', async () => {
    const w = mountTab({
      zhihuGetConfig: vi.fn().mockResolvedValue(cfg({
        configured: true, readable: false, maskedSecret: '', source: 'none',
      })),
    })
    await flushPromises()
    expect(w.get('[data-testid="zhihu-status-badge"]').text()).toContain('已保存但无法读取')
    expect(w.get('[data-testid="zhihu-unreadable-hint"]').exists()).toBe(true)
  })

  it('检测到旧版明文：显示迁移提示', async () => {
    const w = mountTab({
      zhihuGetConfig: vi.fn().mockResolvedValue(cfg({ legacyDetected: true, source: 'legacy', maskedSecret: 'last****cret' })),
    })
    await flushPromises()
    expect(w.get('[data-testid="zhihu-legacy-notice"]').exists()).toBe(true)
  })

  it('get-config 抛错时不崩、按未配置渲染', async () => {
    const w = mountTab({ zhihuGetConfig: vi.fn().mockRejectedValue(new Error('bridge down')) })
    await flushPromises()
    expect(w.get('[data-testid="zhihu-status-badge"]').text()).toContain('未配置')
  })

  it('get-config 返回非 0（许可证/未登录）→ 状态行说原因，不静默塌成未配置', async () => {
    // 根因（QM-6 跨家族评审 MINOR，与采集页 MAJOR #2 同根）：原先只在 code===0 时写状态，
    // 非 0 完全静默 ⇒ 用户看到「未配置」而问题其实是「没登录 / 许可证不足」。
    const w = mountTab({ zhihuGetConfig: vi.fn().mockResolvedValue({ code: -3, message: '许可证权限不足，无法调用 zhihuGetConfig' }) })
    await flushPromises()
    expect(w.get('[data-testid="zhihu-status-msg"]').text()).toContain('无权')
  })
})

describe('ZhihuSettingsTab 保存', () => {
  it('空输入点保存 → 提示必填且不发请求', async () => {
    const save = vi.fn()
    const w = mountTab({ zhihuGetConfig: vi.fn().mockResolvedValue(cfg()), zhihuSaveConfig: save })
    await flushPromises()
    await w.get('[data-testid="zhihu-save"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="zhihu-status-msg"]').text()).toContain('请先输入')
    expect(save).not.toHaveBeenCalled()
  })

  it('保存成功 → 调用 IPC、清空输入、刷新状态、提示成功', async () => {
    const getConfig = vi.fn()
      .mockResolvedValueOnce(cfg())
      .mockResolvedValueOnce(cfg({ configured: true, readable: true, maskedSecret: 'zhih****7890', source: 'config' }))
    const save = vi.fn().mockResolvedValue({ code: 0, data: { configured: true, maskedSecret: 'zhih****7890' } })
    const w = mountTab({ zhihuGetConfig: getConfig, zhihuSaveConfig: save })
    await flushPromises()

    await w.get('[data-testid="zhihu-secret-input"]').setValue(SECRET)
    await w.get('[data-testid="zhihu-save"]').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith(SECRET)
    expect(w.get('[data-testid="zhihu-secret-input"]').element.value).toBe('')
    expect(getConfig).toHaveBeenCalledTimes(2)
    expect(w.get('[data-testid="zhihu-status-msg"]').text()).toContain('已保存')
    expect(w.text()).not.toContain(SECRET)
  })

  it('保存失败 → 显示主进程返回的原因（不谎报成功）', async () => {
    const w = mountTab({
      zhihuGetConfig: vi.fn().mockResolvedValue(cfg()),
      zhihuSaveConfig: vi.fn().mockResolvedValue({ code: -1, message: '系统凭据保护不可用，无法加密保存知乎 Access Secret' }),
    })
    await flushPromises()
    await w.get('[data-testid="zhihu-secret-input"]').setValue(SECRET)
    await w.get('[data-testid="zhihu-save"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="zhihu-status-msg"]').text()).toContain('凭据保护不可用')
  })
})

describe('ZhihuSettingsTab 测试连接', () => {
  it('成功 → 用输入值测试并显示收藏夹数量', async () => {
    const test = vi.fn().mockResolvedValue({ code: 0, data: { ok: true, favlistCount: 7 } })
    const w = mountTab({ zhihuGetConfig: vi.fn().mockResolvedValue(cfg()), zhihuTestConnection: test })
    await flushPromises()
    await w.get('[data-testid="zhihu-secret-input"]').setValue(SECRET)
    await w.get('[data-testid="zhihu-test"]').trigger('click')
    await flushPromises()
    expect(test).toHaveBeenCalledWith(SECRET)
    const msg = w.get('[data-testid="zhihu-status-msg"]').text()
    expect(msg).toContain('连接成功')
    expect(msg).toContain('7')
  })

  it('输入为空时测试「已存配置」（不传参）', async () => {
    const test = vi.fn().mockResolvedValue({ code: 0, data: { ok: true, favlistCount: 0 } })
    const w = mountTab({ zhihuGetConfig: vi.fn().mockResolvedValue(cfg({ configured: true, readable: true, maskedSecret: 'zhih****7890' })), zhihuTestConnection: test })
    await flushPromises()
    await w.get('[data-testid="zhihu-test"]').trigger('click')
    await flushPromises()
    expect(test).toHaveBeenCalledWith(undefined)
  })

  it('失败 → 显示失败与原因', async () => {
    const w = mountTab({
      zhihuGetConfig: vi.fn().mockResolvedValue(cfg()),
      zhihuTestConnection: vi.fn().mockResolvedValue({ code: -1, message: '知乎 API 频率限制，请稍后重试', data: { ok: false } }),
    })
    await flushPromises()
    await w.get('[data-testid="zhihu-test"]').trigger('click')
    await flushPromises()
    const msg = w.get('[data-testid="zhihu-status-msg"]').text()
    expect(msg).toContain('连接失败')
    expect(msg).toContain('频率限制')
  })
})

describe('ZhihuSettingsTab 清除（两步确认）', () => {
  it('首次点击只进入确认态，不发请求；确认后才清除并刷新', async () => {
    const clear = vi.fn().mockResolvedValue({ code: 0, data: { cleared: true } })
    const getConfig = vi.fn()
      .mockResolvedValueOnce(cfg({ configured: true, readable: true, maskedSecret: 'zhih****7890', source: 'config' }))
      .mockResolvedValueOnce(cfg())
    const w = mountTab({ zhihuGetConfig: getConfig, zhihuClearConfig: clear })
    await flushPromises()

    await w.get('[data-testid="zhihu-clear"]').trigger('click')
    await flushPromises()
    expect(clear).not.toHaveBeenCalled()
    expect(w.find('[data-testid="zhihu-clear-confirm"]').exists()).toBe(true)

    await w.get('[data-testid="zhihu-clear-confirm"]').trigger('click')
    await flushPromises()
    expect(clear).toHaveBeenCalledTimes(1)
    expect(getConfig).toHaveBeenCalledTimes(2)
    expect(w.get('[data-testid="zhihu-status-badge"]').text()).toContain('未配置')
    expect(w.get('[data-testid="zhihu-status-msg"]').text()).toContain('已清除')
  })

  it('取消确认 → 退出确认态且不发请求', async () => {
    const clear = vi.fn()
    const w = mountTab({
      zhihuGetConfig: vi.fn().mockResolvedValue(cfg({ configured: true, readable: true, maskedSecret: 'zhih****7890' })),
      zhihuClearConfig: clear,
    })
    await flushPromises()
    await w.get('[data-testid="zhihu-clear"]').trigger('click')
    await w.get('[data-testid="zhihu-clear-cancel"]').trigger('click')
    await flushPromises()
    expect(clear).not.toHaveBeenCalled()
    expect(w.find('[data-testid="zhihu-clear-confirm"]').exists()).toBe(false)
  })
})

describe('ZhihuSettingsTab 权限与可读性', () => {
  it('被权限拦截（LicensePermissionError）→ 显示可读提示而不是抛异常', async () => {
    const permErr = () => {
      const e = new Error('许可证权限不足，无法调用 zhihuGetConfig')
      e.name = 'LicensePermissionError'
      return e
    }
    const w = mountTab({
      zhihuGetConfig: vi.fn().mockRejectedValue(permErr()),
      zhihuTestConnection: vi.fn().mockRejectedValue(permErr()),
    })
    await flushPromises()
    await w.get('[data-testid="zhihu-test"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="zhihu-status-msg"]').text()).toContain('请先登录或激活许可证')
  })
})

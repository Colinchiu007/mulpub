// @ts-check
/**
 * useProviderCrud.test.js — Provider CRUD composable 测试（Phase 4.2 TDD）
 *
 * 范式：mock @/api/providers + element-plus，验证 composable setup 行为
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 用 vi.hoisted 声明 mock 变量（避免 vi.mock 工厂 hoisting 引用问题）
const {
  mockProviderList,
  mockProviderCreate,
  mockProviderUpdate,
  mockProviderDelete,
  mockProviderTest,
  mockElMessage,
} = vi.hoisted(function () {
  return {
    mockProviderList: vi.fn(),
    mockProviderCreate: vi.fn(),
    mockProviderUpdate: vi.fn(),
    mockProviderDelete: vi.fn(),
    mockProviderTest: vi.fn(),
    mockElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
})

// mock @/api/providers
vi.mock('@/api/providers', function () {
  return {
    providerList: mockProviderList,
    providerCreate: mockProviderCreate,
    providerUpdate: mockProviderUpdate,
    providerDelete: mockProviderDelete,
    providerTest: mockProviderTest,
  }
})

// mock element-plus
vi.mock('element-plus', function () {
  return {
    ElMessage: mockElMessage,
    ElMessageBox: { confirm: vi.fn(function () { return Promise.resolve() }) },
  }
})

import { useProviderCrud } from '../composables/useProviderCrud'
import { messageIs, messageContains } from '../utils/toast-assert-helpers'

// formRef.validate 的共享 mock
const r_formRef_validate_mock = vi.fn()

describe('useProviderCrud — composable setup', () => {
  let originalElectronAPI

  beforeEach(() => {
    originalElectronAPI = window.electronAPI
    vi.clearAllMocks()
    window.electronAPI = {
      providerList: vi.fn(),
      providerCreate: vi.fn(),
      providerUpdate: vi.fn(),
      providerDelete: vi.fn(),
      providerTest: vi.fn(),
      providerSetUserKey: vi.fn(),
    }
  })

  afterEach(() => {
    window.electronAPI = originalElectronAPI
  })

  it('返回响应式状态和方法', () => {
    const r = useProviderCrud()
    expect(r.providers).toBeDefined()
    expect(r.loading).toBeDefined()
    expect(r.submitting).toBeDefined()
    expect(r.filterType).toBeDefined()
    expect(r.testResults).toBeDefined()
    expect(r.testingName).toBeDefined()
    expect(r.showFormDialog).toBeDefined()
    expect(r.isEditing).toBeDefined()
    expect(r.formRef).toBeDefined()
    expect(r.form).toBeDefined()
    expect(r.showDeleteDialog).toBeDefined()
    expect(r.deleteTarget).toBeDefined()
    expect(r.showUserKeyDialog).toBeDefined()
    expect(r.userKeyTarget).toBeDefined()
    expect(r.userKeyForm).toBeDefined()
    expect(r.filteredProviders).toBeDefined()
    expect(r.enabledCount).toBeDefined()
    expect(typeof r.loadProviders).toBe('function')
    expect(typeof r.openCreate).toBe('function')
    expect(typeof r.openEdit).toBe('function')
    expect(typeof r.submitForm).toBe('function')
    expect(typeof r.confirmDelete).toBe('function')
    expect(typeof r.doDelete).toBe('function')
    expect(typeof r.testProvider).toBe('function')
    expect(typeof r.openUserKey).toBe('function')
    expect(typeof r.saveUserKey).toBe('function')
  })

  it('初始状态', () => {
    const r = useProviderCrud()
    expect(r.providers.value).toEqual([])
    expect(r.loading.value).toBe(true)
    expect(r.submitting.value).toBe(false)
    expect(r.filterType.value).toBe('all')
    expect(r.testResults.value).toEqual({})
    expect(r.testingName.value).toBe('')
    expect(r.showFormDialog.value).toBe(false)
    expect(r.isEditing.value).toBe(false)
    expect(r.showDeleteDialog.value).toBe(false)
    expect(r.showUserKeyDialog.value).toBe(false)
    expect(r.form.value.provider_type).toBe('llm')
    expect(r.form.value.enabled).toBe(true)
  })

  // ─── loadProviders ────────────────────────────
  it('loadProviders 成功加载', async () => {
    mockProviderList.mockResolvedValueOnce({
      code: 0,
      data: [{ name: 'openai', provider_type: 'llm', enabled: true }],
    })
    const r = useProviderCrud()
    await r.loadProviders()
    expect(r.providers.value).toHaveLength(1)
    expect(r.providers.value[0].name).toBe('openai')
    expect(r.loading.value).toBe(false)
  })

  it('loadProviders code!=0 显示错误', async () => {
    mockProviderList.mockResolvedValueOnce({ code: 1, message: '加载失败' })
    const r = useProviderCrud()
    await r.loadProviders()
    expect(mockElMessage.error).toHaveBeenCalledWith(messageIs('加载失败'))
    expect(r.loading.value).toBe(false)
  })

  it('loadProviders 抛错显示错误消息', async () => {
    mockProviderList.mockRejectedValueOnce(new Error('网络错误'))
    const r = useProviderCrud()
    await r.loadProviders()
    expect(mockElMessage.error).toHaveBeenCalledWith(messageIs('网络错误'))
    expect(r.loading.value).toBe(false)
  })

  // ─── openCreate / openEdit ────────────────────
  it('openCreate 重置表单 + 显示对话框 + isEditing=false', () => {
    const r = useProviderCrud()
    r.openCreate()
    expect(r.isEditing.value).toBe(false)
    expect(r.form.value.name).toBe('')
    expect(r.form.value.provider_type).toBe('llm')
    expect(r.showFormDialog.value).toBe(true)
  })

  it('openEdit 填充表单 + isEditing=true', () => {
    const r = useProviderCrud()
    r.openEdit({
      name: 'openai',
      provider_type: 'llm',
      display_name: 'OpenAI',
      base_url: 'https://api.openai.com',
      models: ['gpt-4', 'gpt-3.5'],
      enabled: true,
      min_tier: 1,
      config: { timeout: 30 },
    })
    expect(r.isEditing.value).toBe(true)
    expect(r.form.value.name).toBe('openai')
    expect(r.form.value.display_name).toBe('OpenAI')
    expect(r.form.value.base_url).toBe('https://api.openai.com')
    expect(r.form.value.models).toBe('gpt-4\ngpt-3.5')
    expect(r.form.value.config).toBe('{\n  "timeout": 30\n}')
    expect(r.showFormDialog.value).toBe(true)
  })

  it('openEdit 无 config 时 config 为空字符串', () => {
    const r = useProviderCrud()
    r.openEdit({ name: 'test', provider_type: 'llm', models: [] })
    expect(r.form.value.config).toBe('')
  })

  // ─── submitForm ───────────────────────────────
  it('submitForm 创建 provider（isEditing=false）', async () => {
    r_formRef_validate_mock.mockResolvedValueOnce(true)
    mockProviderCreate.mockResolvedValueOnce({ code: 0 })
    const r = useProviderCrud()
    r.form.value = {
      name: 'test', provider_type: 'llm', display_name: 'Test',
      base_url: 'https://t.com', models: 'gpt-4', enabled: true,
      min_tier: 1, api_key: 'sk-123', config: '',
    }
    r.formRef.value = { validate: r_formRef_validate_mock }
    await r.submitForm()
    expect(mockProviderCreate).toHaveBeenCalledTimes(1)
    expect(r.showFormDialog.value).toBe(false)
    expect(mockElMessage.success).toHaveBeenCalledWith(messageIs('创建成功'))
  })

  it('submitForm 更新 provider（isEditing=true）', async () => {
    r_formRef_validate_mock.mockResolvedValueOnce(true)
    mockProviderUpdate.mockResolvedValueOnce({ code: 0 })
    const r = useProviderCrud()
    r.isEditing.value = true
    r.form.value = {
      name: 'openai', provider_type: 'llm', display_name: 'OpenAI',
      base_url: 'https://api.openai.com', models: 'gpt-4', enabled: true,
      min_tier: 1, api_key: '', config: '',
    }
    r.formRef.value = { validate: r_formRef_validate_mock }
    await r.submitForm()
    expect(mockProviderUpdate).toHaveBeenCalledWith('openai', expect.any(Object))
    expect(r.showFormDialog.value).toBe(false)
    expect(mockElMessage.success).toHaveBeenCalledWith(messageIs('更新成功'))
  })

  it('submitForm 验证失败时不调用 API', async () => {
    r_formRef_validate_mock.mockResolvedValueOnce(false)
    const r = useProviderCrud()
    r.formRef.value = { validate: r_formRef_validate_mock }
    await r.submitForm()
    expect(mockProviderCreate).not.toHaveBeenCalled()
  })

  it('submitForm API 返回 code!=0 显示错误（对话框保持打开）', async () => {
    r_formRef_validate_mock.mockResolvedValueOnce(true)
    mockProviderCreate.mockResolvedValueOnce({ code: 1, message: '创建失败' })
    const r = useProviderCrud()
    r.openCreate() // 先打开对话框
    r.form.value = {
      name: 'test', provider_type: 'llm', display_name: 'Test',
      base_url: 'https://t.com', models: 'm1', enabled: true,
      min_tier: 1, api_key: '', config: '',
    }
    r.formRef.value = { validate: r_formRef_validate_mock }
    await r.submitForm()
    expect(mockElMessage.error).toHaveBeenCalledWith(messageIs('创建失败'))
    expect(r.showFormDialog.value).toBe(true)
  })

  it('submitForm API 抛错显示错误', async () => {
    r_formRef_validate_mock.mockResolvedValueOnce(true)
    mockProviderCreate.mockRejectedValueOnce(new Error('网络错误'))
    const r = useProviderCrud()
    r.form.value = {
      name: 'test', provider_type: 'llm', display_name: 'Test',
      base_url: 'https://t.com', models: 'm1', enabled: true,
      min_tier: 1, api_key: '', config: '',
    }
    r.formRef.value = { validate: r_formRef_validate_mock }
    await r.submitForm()
    expect(mockElMessage.error).toHaveBeenCalledWith(messageIs('网络错误'))
  })

  it('submitForm 含 api_key 时传入', async () => {
    r_formRef_validate_mock.mockResolvedValueOnce(true)
    mockProviderCreate.mockResolvedValueOnce({ code: 0 })
    const r = useProviderCrud()
    r.form.value = {
      name: 'test', provider_type: 'llm', display_name: 'Test',
      base_url: 'https://t.com', models: 'm1', enabled: true,
      min_tier: 1, api_key: 'sk-secret', config: '',
    }
    r.formRef.value = { validate: r_formRef_validate_mock }
    await r.submitForm()
    const callArgs = mockProviderCreate.mock.calls[0][0]
    expect(callArgs.api_key).toBe('sk-secret')
  })

  it('submitForm 无 api_key 时不传该字段', async () => {
    r_formRef_validate_mock.mockResolvedValueOnce(true)
    mockProviderCreate.mockResolvedValueOnce({ code: 0 })
    const r = useProviderCrud()
    r.form.value = {
      name: 'test', provider_type: 'llm', display_name: 'Test',
      base_url: 'https://t.com', models: 'm1', enabled: true,
      min_tier: 1, api_key: '', config: '',
    }
    r.formRef.value = { validate: r_formRef_validate_mock }
    await r.submitForm()
    const callArgs = mockProviderCreate.mock.calls[0][0]
    expect(callArgs.api_key).toBeUndefined()
  })

  it('submitForm config 为 JSON 字符串时解析为对象', async () => {
    r_formRef_validate_mock.mockResolvedValueOnce(true)
    mockProviderCreate.mockResolvedValueOnce({ code: 0 })
    const r = useProviderCrud()
    r.form.value = {
      name: 'test', provider_type: 'llm', display_name: 'Test',
      base_url: 'https://t.com', models: 'm1', enabled: true,
      min_tier: 1, api_key: '', config: '{"key":"value"}',
    }
    r.formRef.value = { validate: r_formRef_validate_mock }
    await r.submitForm()
    const callArgs = mockProviderCreate.mock.calls[0][0]
    expect(callArgs.config).toEqual({ key: 'value' })
  })

  it('submitForm models 按换行分割', async () => {
    r_formRef_validate_mock.mockResolvedValueOnce(true)
    mockProviderCreate.mockResolvedValueOnce({ code: 0 })
    const r = useProviderCrud()
    r.form.value = {
      name: 'test', provider_type: 'llm', display_name: 'Test',
      base_url: 'https://t.com', models: 'gpt-4\ngpt-3.5', enabled: true,
      min_tier: 1, api_key: '', config: '',
    }
    r.formRef.value = { validate: r_formRef_validate_mock }
    await r.submitForm()
    const callArgs = mockProviderCreate.mock.calls[0][0]
    expect(callArgs.models).toEqual(['gpt-4', 'gpt-3.5'])
  })

  // ─── confirmDelete / doDelete ─────────────────
  it('confirmDelete 设置 deleteTarget + 显示对话框', () => {
    const r = useProviderCrud()
    r.confirmDelete({ name: 'openai' })
    expect(r.deleteTarget.value.name).toBe('openai')
    expect(r.showDeleteDialog.value).toBe(true)
  })

  it('doDelete 成功删除', async () => {
    mockProviderDelete.mockResolvedValueOnce({ code: 0 })
    const r = useProviderCrud()
    r.deleteTarget.value = { name: 'openai' }
    await r.doDelete()
    expect(mockProviderDelete).toHaveBeenCalledWith('openai')
    expect(r.showDeleteDialog.value).toBe(false)
    expect(r.deleteTarget.value).toBeNull()
    expect(mockElMessage.success).toHaveBeenCalledWith(messageIs('已删除'))
  })

  it('doDelete API code!=0 显示错误', async () => {
    mockProviderDelete.mockResolvedValueOnce({ code: 1, message: '删除失败' })
    const r = useProviderCrud()
    r.deleteTarget.value = { name: 'openai' }
    await r.doDelete()
    expect(mockElMessage.error).toHaveBeenCalledWith(messageIs('删除失败'))
  })

  it('doDelete 无 deleteTarget 时直接返回', async () => {
    const r = useProviderCrud()
    r.deleteTarget.value = null
    await r.doDelete()
    expect(mockProviderDelete).not.toHaveBeenCalled()
    expect(r.submitting.value).toBe(false)
  })

  // ─── testProvider ─────────────────────────────
  it('testProvider 成功', async () => {
    mockProviderTest.mockResolvedValueOnce({ code: 0, message: 'ok' })
    const r = useProviderCrud()
    await r.testProvider('openai')
    expect(r.testResults.value.openai.success).toBe(true)
    expect(r.testResults.value.openai.message).toBe('ok')
    expect(r.testingName.value).toBe('')
  })

  it('testProvider code!=0 标记失败', async () => {
    mockProviderTest.mockResolvedValueOnce({ code: 1, message: 'refused' })
    const r = useProviderCrud()
    await r.testProvider('openai')
    expect(r.testResults.value.openai.success).toBe(false)
    expect(r.testResults.value.openai.message).toBe('refused')
  })

  it('testProvider 抛错标记失败', async () => {
    mockProviderTest.mockRejectedValueOnce(new Error('network'))
    const r = useProviderCrud()
    await r.testProvider('openai')
    expect(r.testResults.value.openai.success).toBe(false)
    expect(r.testResults.value.openai.message).toBe('network')
  })

  // ─── openUserKey / saveUserKey ────────────────
  it('openUserKey 设置 target + 显示对话框', () => {
    const r = useProviderCrud()
    r.openUserKey({ name: 'openai' })
    expect(r.userKeyTarget.value.name).toBe('openai')
    expect(r.userKeyForm.value.apiKey).toBe('')
    expect(r.userKeyForm.value.baseUrl).toBe('')
    expect(r.showUserKeyDialog.value).toBe(true)
  })

  it('saveUserKey 成功保存', async () => {
    window.electronAPI.providerSetUserKey.mockResolvedValueOnce(undefined)
    const r = useProviderCrud()
    r.userKeyTarget.value = { name: 'openai' }
    r.userKeyForm.value = { apiKey: 'sk-123', baseUrl: '' }
    await r.saveUserKey()
    expect(window.electronAPI.providerSetUserKey).toHaveBeenCalledWith('openai', 'sk-123', '')
    expect(r.showUserKeyDialog.value).toBe(false)
    expect(mockElMessage.success).toHaveBeenCalledWith(messageIs('用户 Key 已保存'))
  })

  it('saveUserKey 抛错显示错误', async () => {
    window.electronAPI.providerSetUserKey.mockRejectedValueOnce(new Error('fail'))
    const r = useProviderCrud()
    r.userKeyTarget.value = { name: 'openai' }
    await r.saveUserKey()
    expect(mockElMessage.error).toHaveBeenCalledWith(messageIs('fail'))
  })

  it('saveUserKey 无 target 时直接返回', async () => {
    const r = useProviderCrud()
    r.userKeyTarget.value = null
    await r.saveUserKey()
    expect(window.electronAPI.providerSetUserKey).not.toHaveBeenCalled()
  })

  // ─── filteredProviders / enabledCount ─────────
  it('filteredProviders 按 filterType 过滤', () => {
    const r = useProviderCrud()
    r.providers.value = [
      { name: 'a', provider_type: 'llm' },
      { name: 'b', provider_type: 'video' },
    ]
    expect(r.filteredProviders.value).toHaveLength(2)
    r.filterType.value = 'llm'
    expect(r.filteredProviders.value).toHaveLength(1)
    expect(r.filteredProviders.value[0].name).toBe('a')
    r.filterType.value = 'video'
    expect(r.filteredProviders.value).toHaveLength(1)
    expect(r.filteredProviders.value[0].name).toBe('b')
  })

  it('enabledCount 统计启用数量', () => {
    const r = useProviderCrud()
    r.providers.value = [
      { name: 'a', enabled: true },
      { name: 'b', enabled: false },
      { name: 'c', enabled: true },
    ]
    expect(r.enabledCount.value).toBe(2)
  })
})

// @ts-check
/**
 * useModelProviderCrud.test.js — 模型服务商 CRUD 测试
 *
 * 回归测试：修复 "An object could not be cloned" IPC 序列化错误
 * 根因：Vue ref 嵌套对象是 reactive proxy，直接传给 ipcRenderer.invoke() 会报错
 * 修复：submitForm 中用 JSON.parse(JSON.stringify()) 脱壳
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'

// ─── Mock API ──────────────────────────────────────────────
vi.mock('@/api/model-providers', function () {
  return {
    modelProviderList: vi.fn(function () {
      return Promise.resolve({ code: 0, data: [] })
    }),
    modelProviderCreate: vi.fn(function (data) {
      // 关键验证：传入的 data 必须是纯对象（非 reactive proxy）
      // structured clone 会在这里模拟
      try {
        const clone = structuredClone(data)
        return Promise.resolve({ code: 0, data: clone })
      } catch (e) {
        return Promise.resolve({ code: -1, message: e.message })
      }
    }),
    modelProviderUpdate: vi.fn(function (id, data) {
      try {
        structuredClone(data)
        return Promise.resolve({ code: 0, data: { id } })
      } catch (e) {
        return Promise.resolve({ code: -1, message: e.message })
      }
    }),
    modelProviderDelete: vi.fn(function () {
      return Promise.resolve({ code: 0 })
    }),
    modelProviderSetDefault: vi.fn(function () {
      return Promise.resolve({ code: 0 })
    }),
    modelProviderGetDefault: vi.fn(function () {
      return Promise.resolve({ code: 0, data: null })
    }),
    modelProviderTest: vi.fn(function () {
      return Promise.resolve({ code: 0, data: { ok: true } })
    }),
    modelProviderPresets: vi.fn(function () {
      return Promise.resolve({ code: 0, data: [] })
    }),
    modelProviderIsConfigured: vi.fn(function () {
      return Promise.resolve({ code: 0, data: false })
    }),
  }
})

// ─── Mock publisher（多模态优先开关读写）───────────────────────
vi.mock('@/api/publisher', function () {
  return {
    storeGetSetting: vi.fn(function () { return Promise.resolve({ code: -1, message: 'electronAPI not available', data: null }) }),
    storeSetSetting: vi.fn(function () { return Promise.resolve({ code: 0 }) }),
  }
})

// ─── Mock Element Plus ─────────────────────────────────────
vi.mock('element-plus', function () {
  return {
    ElMessage: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
    },
    ElMessageBox: {
      confirm: vi.fn(function () { return Promise.resolve() }),
    },
  }
})

import { useModelProviderCrud } from '../composables/useModelProviderCrud'
import {
  modelProviderCreate,
  modelProviderUpdate,
  modelProviderList,
  modelProviderSetDefault,
  modelProviderTest,
} from '@/api/model-providers'

describe('useModelProviderCrud', function () {
  let crud
  let hostWrapper

  // useModelProviderCrud 内部调用 useI18n()，必须在组件 setup 上下文中实例化
  const Host = defineComponent({
    setup () {
      crud = useModelProviderCrud()
      return {}
    },
  })

  beforeEach(function () {
    i18n.global.locale.value = 'zh'
    hostWrapper = mount(Host, { global: { plugins: [i18n] } })
    vi.clearAllMocks()
  })

  // ─── 回归测试：IPC 序列化安全 ────────────────────────
  describe('IPC 序列化安全（"An object could not be cloned" 回归）', function () {
    it('submitForm 创建时传给 API 的 data 必须是纯对象', async function () {
      // 设置表单数据
      crud.form.value = {
        id: 'doubao-llm',
        name: '豆包',
        category: 'llm',
        base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        api_key: 'sk-test123',
        models: ['doubao-pro-128k'],
        modelsText: 'doubao-pro-128k, doubao-pro-32k',
        config: { temperature: 0.7 },
      }

      await crud.submitForm()

      expect(modelProviderCreate).toHaveBeenCalledTimes(1)
      const calledData = modelProviderCreate.mock.calls[0][0]

      // 验证 1：data 是纯对象（不包含 proxy、函数、Symbol 等）
      expect(typeof calledData).toBe('object')
      expect(calledData).not.toBeNull()

      // 验证 2：可以安全 structuredClone（模拟 Electron IPC 序列化）
      expect(function () { structuredClone(calledData) }).not.toThrow()

      // 验证 3：字段值正确
      expect(calledData.id).toBe('doubao-llm')
      expect(calledData.name).toBe('豆包')
      expect(calledData.category).toBe('llm')
      expect(calledData.models).toEqual(['doubao-pro-128k', 'doubao-pro-32k'])
      expect(calledData.config).toEqual({ temperature: 0.7 })
    })

    it('submitForm 更新时传给 API 的 data 必须是纯对象', async function () {
      crud.isEditing.value = true
      crud.form.value = {
        id: 'doubao-llm',
        name: '豆包',
        category: 'llm',
        base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        api_key: '',
        models: ['doubao-pro-128k'],
        modelsText: 'doubao-pro-128k',
        config: { temperature: 0.7 },
      }

      await crud.submitForm()

      expect(modelProviderUpdate).toHaveBeenCalledTimes(1)
      const calledId = modelProviderUpdate.mock.calls[0][0]
      const calledData = modelProviderUpdate.mock.calls[0][1]

      // ID 必须是字符串
      expect(typeof calledId).toBe('string')

      // data 必须可 structuredClone
      expect(function () { structuredClone(calledData) }).not.toThrow()
    })

    it('编辑保存时 API Key 留空不得上送空值', async function () {
      crud.isEditing.value = true
      crud.form.value = {
        id: 'minimax-image', name: 'MiniMax Image', category: 'image', base_url: '',
        api_key: '', models: ['image-01'], modelsText: 'image-01', config: {},
      }

      await crud.submitForm()

      const calledData = modelProviderUpdate.mock.calls[0][1]
      expect(calledData).not.toHaveProperty('api_key')
    })

    it('form.config 为 reactive proxy 时也能安全传递', async function () {
      // 模拟 Vue ref 包装后的 config 是 proxy
      crud.form.value = {
        id: 'test-provider',
        name: 'Test',
        category: 'llm',
        base_url: '',
        api_key: 'sk-test',
        models: [],
        modelsText: '',
        config: { nested: { deep: true } },
      }

      await crud.submitForm()

      const calledData = modelProviderCreate.mock.calls[0][0]
      // config 应该是深拷贝后的纯对象
      expect(calledData.config).toEqual({ nested: { deep: true } })
      // 验证不是同一个引用
      expect(calledData.config).not.toBe(crud.form.value.config)
    })

    it('submitForm 在 form.config 为 undefined 时不崩溃', async function () {
      crud.form.value = {
        id: 'test-provider',
        name: 'Test',
        category: 'llm',
        base_url: '',
        api_key: 'sk-test',
        models: [],
        modelsText: '',
        config: undefined,
      }

      await crud.submitForm()
      expect(modelProviderCreate).toHaveBeenCalledTimes(1)
      const calledData = modelProviderCreate.mock.calls[0][0]
      expect(calledData.config).toEqual({})
    })
  })

  // ─── 基本 CRUD 测试 ──────────────────────────────────
  describe('基本功能', function () {
    it('loadProviders 加载列表', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [{ id: 'test', name: 'Test', category: 'llm' }],
      })

      await crud.loadProviders()

      expect(crud.providers.value).toHaveLength(1)
      expect(crud.providers.value[0].id).toBe('test')
      expect(crud.loading.value).toBe(false)
    })

    it('新增远程服务商未填写 API Key 时阻止保存', async function () {
      crud.form.value = {
        id: 'minimax-image', name: 'MiniMax Image', category: 'image', base_url: 'https://api.minimaxi.com/v1',
        api_key: '   ', models: ['image-01'], modelsText: 'image-01', config: {},
      }

      await crud.submitForm()

      expect(modelProviderCreate).not.toHaveBeenCalled()
    })

    it('新增本地免 Key 预设遇到种子冲突时启用该服务商', async function () {
      modelProviderCreate.mockResolvedValueOnce({ code: 1, message: 'provider already exists' })
      modelProviderUpdate.mockResolvedValueOnce({ code: 0 })
      modelProviderList.mockResolvedValueOnce({ code: 0, data: [{ id: 'piper', name: 'Piper', category: 'tts', enabled: true, is_configured: true }] })
      crud.form.value = { id: 'piper', name: 'Piper', category: 'tts', base_url: '', api_key: '', models: ['piper'], modelsText: 'piper', config: {} }

      await crud.submitForm()

      expect(modelProviderUpdate).toHaveBeenCalledWith('piper', expect.objectContaining({ enabled: true }))
    })

    it('新增远程服务商成功后刷新列表包含新增项', async function () {
      modelProviderCreate.mockResolvedValueOnce({
        code: 0,
        data: { id: 'custom-image', name: 'Custom Image', category: 'image' },
      })
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [{ id: 'custom-image', name: 'Custom Image', category: 'image', is_preset: false, is_configured: true, api_key_masked: 'sk-***' }],
      })
      crud.form.value = {
        id: 'custom-image', name: 'Custom Image', category: 'image', base_url: 'https://api.example.com/v1',
        api_key: 'sk-test', models: [], modelsText: '', config: {},
      }

      await crud.submitForm()

      expect(crud.providers.value.map(p => p.id)).toContain('custom-image')
      expect(crud.filteredProviders.value.map(p => p.id)).toContain('custom-image')
    })

    it('新增后清除旧分类筛选，确保新服务商在返回列表中可见', async function () {
      modelProviderCreate.mockResolvedValueOnce({
        code: 0,
        data: { id: 'custom-llm', name: 'Custom LLM', category: 'llm' },
      })
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'existing-tts', name: 'Existing TTS', category: 'tts', is_preset: true, is_configured: true },
          { id: 'custom-llm', name: 'Custom LLM', category: 'llm', is_preset: false, is_configured: true },
        ],
      })
      crud.viewMode.value = 'configured'
      crud.filterCategory.value = 'tts'
      crud.form.value = {
        id: 'custom-llm', name: 'Custom LLM', category: 'llm', base_url: 'https://api.example.com/v1',
        api_key: 'sk-test', models: ['custom-llm-v1'], modelsText: 'custom-llm-v1', config: {},
      }

      await crud.submitForm()

      expect(crud.filterCategory.value).toBe('all')
      expect(crud.filteredProviders.value.map(p => p.id)).toContain('custom-llm')
    })
    it('filteredProviders 按类别过滤', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'a', name: 'A', category: 'llm' },
          { id: 'b', name: 'B', category: 'tts' },
        ],
      })
      await crud.loadProviders()

      crud.viewMode.value = 'all'
      crud.filterCategory.value = 'llm'
      expect(crud.filteredProviders.value).toHaveLength(1)
      expect(crud.filteredProviders.value[0].id).toBe('a')
    })

    it('submitForm 名称为空时显示警告', async function () {
      crud.form.value = { ...crud.form.value, name: '', id: '' }
      await crud.submitForm()
      expect(modelProviderCreate).not.toHaveBeenCalled()
    })

    it('loadProviders 返回异常格式时提示错误并结束加载态', async function () {
      modelProviderList.mockResolvedValueOnce({})

      await expect(crud.loadProviders()).resolves.toBeUndefined()

      const { ElMessage } = await import('element-plus')
      expect(ElMessage.error).toHaveBeenCalledWith('加载失败')
      expect(crud.providers.value).toEqual([])
      expect(crud.loading.value).toBe(false)
    })

    it('loadProviders 请求拒绝时提示格式化错误并结束加载态', async function () {
      modelProviderList.mockRejectedValueOnce(new Error('IPC 不可用'))

      await expect(crud.loadProviders()).resolves.toBeUndefined()

      const { ElMessage } = await import('element-plus')
      // 自然语言原因文本经统一文案格式化后原样透传（保留具体原因）
      expect(ElMessage.error).toHaveBeenCalledWith('IPC 不可用')
      expect(crud.loading.value).toBe(false)
    })

    it('submitForm 创建失败时保留对话框并复位提交状态', async function () {
      modelProviderCreate.mockResolvedValueOnce({ code: 1, message: '密钥无效' })
      crud.showFormDialog.value = true
      crud.form.value = {
        id: 'bad-provider', name: 'Bad', category: 'llm', base_url: '',
        api_key: 'bad-key', models: [], modelsText: '', config: {},
      }

      await crud.submitForm()

      const { ElMessage } = await import('element-plus')
      // 自然语言原因文本经统一文案格式化后原样透传（保留具体原因）
      expect(ElMessage.error).toHaveBeenCalledWith('密钥无效')
      expect(crud.showFormDialog.value).toBe(true)
      expect(crud.submitting.value).toBe(false)
    })

    it('submitForm 创建响应异常时显示默认错误且不崩溃', async function () {
      modelProviderCreate.mockResolvedValueOnce({})
      crud.form.value = {
        id: 'bad-response', name: 'Bad Response', category: 'llm', base_url: '',
        api_key: 'sk-test', models: [], modelsText: '', config: {},
      }

      await expect(crud.submitForm()).resolves.toBeUndefined()

      const { ElMessage } = await import('element-plus')
      expect(ElMessage.error).toHaveBeenCalledWith('保存失败')
      expect(crud.submitting.value).toBe(false)
    })

    it('编辑保存时 API Key 留空不得上送空值（避免清除已保存 Key）', async function () {
      crud.isEditing.value = true
      crud.form.value = {
        id: 'minimax-image',
        name: 'MiniMax Image',
        category: 'image',
        base_url: 'https://api.minimaxi.com/v1',
        api_key: '', // 用户未填写新 Key，按“留空保持不变”语义
        models: ['image-01', 'image-01-live'],
        modelsText: 'image-01, image-01-live',
        config: {},
      }

      await crud.submitForm()

      expect(modelProviderUpdate).toHaveBeenCalledTimes(1)
      const calledData = modelProviderUpdate.mock.calls[0][1]
      expect(calledData).not.toHaveProperty('api_key')
    })

    it('预设已存在时自动改为更新并刷新列表', async function () {
      modelProviderCreate.mockResolvedValueOnce({ code: 1, message: 'provider already exists' })
      modelProviderUpdate.mockResolvedValueOnce({ code: 0 })
      modelProviderList.mockResolvedValueOnce({ code: 0, data: [] })
      crud.showFormDialog.value = true
      crud.showAddDialog.value = true
      crud.form.value = {
        id: 'openai', name: 'OpenAI', category: 'llm', base_url: '',
        api_key: 'sk-test', models: [], modelsText: '', config: {},
      }

      await crud.submitForm()

      expect(modelProviderUpdate).toHaveBeenCalledWith('openai', expect.objectContaining({ api_key: 'sk-test' }))
      expect(modelProviderList).toHaveBeenCalledTimes(1)
      expect(crud.showFormDialog.value).toBe(false)
      expect(crud.showAddDialog.value).toBe(false)
    })

    it('loadAvailablePresets 转发 IPC 返回的非空预设列表', async function () {
      const { modelProviderPresets } = await import('@/api/model-providers')
      modelProviderPresets.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'flux', name: 'Flux', category: 'image', base_url: 'https://api.bfl.ml/v1', models: ['flux-pro'] },
          { id: 'dall-e', name: 'DALL-E', category: 'image', base_url: 'https://api.openai.com/v1', models: ['dall-e-3'] },
        ],
      })
      crud.addCategory.value = 'image'

      await crud.loadAvailablePresets()

      expect(modelProviderPresets).toHaveBeenCalledWith('image')
      expect(crud.availablePresets.value.map(p => p.id)).toEqual(['flux', 'dall-e'])
      expect(crud.availablePresets.value[0].base_url).toBeTruthy()
    })

    it('setDefault 在未配置密钥时拦截 IPC', async function () {
      await crud.setDefault({ id: 'openai', category: 'llm', api_key: '', api_key_masked: '' })

      const { ElMessage } = await import('element-plus')
      expect(ElMessage.warning).toHaveBeenCalledWith('请先配置 API Key 后再设为默认')
      expect(modelProviderSetDefault).not.toHaveBeenCalled()
    })

    it('OpenRouter 设为默认成功后，用重载列表立即更新默认卡片数据', async function () {
      const openRouter = { id: 'openrouter', name: 'OpenRouter', category: 'llm', is_configured: true, is_default: false }
      crud.providers.value = [
        { id: 'minimax-multimodal', name: 'MiniMax', category: 'multimodal', is_configured: true, is_default: true },
        openRouter,
      ]
      modelProviderSetDefault.mockResolvedValueOnce({ code: 0 })
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'minimax-multimodal', name: 'MiniMax', category: 'multimodal', is_configured: true, is_default: false },
          { ...openRouter, is_default: true },
        ],
      })

      await crud.setDefault(openRouter)

      expect(modelProviderSetDefault).toHaveBeenCalledWith('llm', 'openrouter')
      expect(modelProviderList).toHaveBeenCalledTimes(1)
      expect(crud.providers.value.find(provider => provider.id === 'openrouter').is_default).toBe(true)
      expect(crud.providers.value.find(provider => provider.id === 'minimax-multimodal').is_default).toBe(false)
    })

    it('testProvider 请求拒绝时记录稳定失败结果并复位 testingId', async function () {
      modelProviderTest.mockRejectedValueOnce(new Error('连接超时'))

      await crud.testProvider('openai')

      // formatUserError 把原始「连接超时」映射为当前语言（测试环境按系统语言 en）的
      // 「原因 + 建议」文案，不直出原始技术文本
      const testResult = crud.testResults.value.openai
      expect(testResult.success).toBe(false)
      expect(testResult.code).toBe(-1)
      expect(testResult.message).not.toBe('连接超时')
      expect(testResult.message.length).toBeGreaterThan(0)
      expect(testResult.detail).toBeNull()
      expect(crud.testingId.value).toBe('')
    })

  // ─── 视图模式分组测试 ──────────────────────────────
  describe('视图模式分组', function () {
    it('默认 viewMode 为 configured', function () {
      expect(crud.viewMode.value).toBe('configured')
    })

    it('配置状态只信任主进程的 is_configured，不能由掩码或遗留 api_key 推断', function () {
      crud.providers.value = [
        { id: 'disabled-with-key', name: 'Disabled', category: 'llm', enabled: false, is_configured: false, api_key_masked: 'sk-***' },
        { id: 'configured', name: 'Configured', category: 'llm', enabled: true, is_configured: true, api_key_masked: 'sk-***' },
      ]

      expect(crud.configuredProviders.value.map(p => p.id)).toEqual(['configured'])
    })

    it('configuredProviders 只返回主进程标记为已配置的服务商', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'a', name: 'A', category: 'llm', is_preset: 1, api_key: 'sk-1', is_configured: true },
          { id: 'b', name: 'B', category: 'llm', is_preset: 1, api_key: '' },
          { id: 'c', name: 'C', category: 'tts', is_preset: 0, api_key: 'sk-3', is_configured: true },
        ],
      })
      await crud.loadProviders()
      expect(crud.configuredProviders.value).toHaveLength(2)
      expect(crud.configuredProviders.value.map(p => p.id)).toEqual(['a', 'c'])
    })

    it('本地免 Key 服务商以主进程的 is_configured 状态显示为已配置', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [{ id: 'piper', name: 'Piper', category: 'tts', is_preset: true, is_configured: true, api_key_masked: '' }],
      })

      await crud.loadProviders()

      expect(crud.configuredProviders.value.map(p => p.id)).toEqual(['piper'])
      expect(crud.configuredCount.value).toBe(1)
    })

    it('unconfiguredPresets 只返回未配置的预设', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'a', name: 'A', category: 'llm', is_preset: 1, api_key: 'sk-1', is_configured: true },
          { id: 'b', name: 'B', category: 'llm', is_preset: 1, api_key: '' },
          { id: 'c', name: 'C', category: 'tts', is_preset: 0, api_key: '' },
        ],
      })
      await crud.loadProviders()
      expect(crud.unconfiguredPresets.value).toHaveLength(1)
      expect(crud.unconfiguredPresets.value[0].id).toBe('b')
    })

    it('customProviders 只返回非预设的', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'a', name: 'A', category: 'llm', is_preset: 1, api_key: 'sk-1', is_configured: true },
          { id: 'custom', name: 'Custom', category: 'llm', is_preset: 0, api_key: 'sk-c', is_configured: true },
        ],
      })
      await crud.loadProviders()
      expect(crud.customProviders.value).toHaveLength(1)
      expect(crud.customProviders.value[0].id).toBe('custom')
    })

    it('filteredProviders 在 configured 模式下只返回已配置的', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'a', name: 'A', category: 'llm', is_preset: 1, api_key: 'sk-1', is_configured: true },
          { id: 'b', name: 'B', category: 'llm', is_preset: 1, api_key: '' },
        ],
      })
      await crud.loadProviders()
      crud.viewMode.value = 'configured'
      expect(crud.filteredProviders.value).toHaveLength(1)
      expect(crud.filteredProviders.value[0].id).toBe('a')
      crud.viewMode.value = 'all'
      expect(crud.filteredProviders.value).toHaveLength(2)
    })

    it('已配置模式排序：默认模型置顶，其余按 updated_at 倒序，缺失时间的排最后', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'old', name: 'Old', category: 'llm', is_configured: true, updated_at: '2026-01-01 10:00:00' },
          { id: 'default-one', name: 'Default', category: 'llm', is_configured: true, is_default: true, updated_at: '2026-01-01 09:00:00' },
          { id: 'newest', name: 'Newest', category: 'tts', is_configured: true, updated_at: '2026-01-02 10:00:00' },
          { id: 'no-ts', name: 'NoTs', category: 'llm', is_configured: true },
        ],
      })
      await crud.loadProviders()
      crud.viewMode.value = 'configured'
      crud.filterCategory.value = 'all'
      expect(crud.filteredProviders.value.map(p => p.id)).toEqual(['default-one', 'newest', 'old', 'no-ts'])
    })

    it('已配置模式排序：updated_at 相同时按名称拼音兜底', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'b', name: '百度', category: 'llm', is_configured: true, updated_at: '2026-01-01 10:00:00' },
          { id: 'a', name: '阿里', category: 'llm', is_configured: true, updated_at: '2026-01-01 10:00:00' },
        ],
      })
      await crud.loadProviders()
      crud.viewMode.value = 'configured'
      expect(crud.filteredProviders.value.map(p => p.id)).toEqual(['a', 'b'])
    })

    it('全部模式排序：无 sort_order 时中文按拼音、英文按字母升序', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'z', name: 'Zebra' },
          { id: 'a', name: 'Apple' },
          { id: 'c', name: '阿里' },
          { id: 'b', name: '百度' },
        ],
      })
      await crud.loadProviders()
      crud.viewMode.value = 'all'
      crud.filterCategory.value = 'all'
      const names = crud.filteredProviders.value.map(p => p.name)
      expect(names.indexOf('阿里')).toBeLessThan(names.indexOf('百度'))
      expect(names.indexOf('Apple')).toBeLessThan(names.indexOf('Zebra'))
    })

    it('全部模式排序：config.sort_order 优先于拼音序，非法值视为未排序', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'x', name: 'Xing', config: { sort_order: 5 } },
          { id: 'first', name: 'Zzz', config: { sort_order: 0 } },
          { id: 'str', name: 'Bbb', config: { sort_order: '1' } },
          { id: 'neg', name: 'Ccc', config: { sort_order: -2 } },
          { id: 'plain', name: 'Aaa' },
        ],
      })
      await crud.loadProviders()
      crud.viewMode.value = 'all'
      crud.filterCategory.value = 'all'
      expect(crud.filteredProviders.value.map(p => p.id)).toEqual(['first', 'x', 'plain', 'str', 'neg'])
    })

    it('全部模式排序：sort_order 相同时按名称拼音稳定兜底', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'b2', name: 'Beta', config: { sort_order: 0 } },
          { id: 'a1', name: 'Alpha', config: { sort_order: 0 } },
        ],
      })
      await crud.loadProviders()
      crud.viewMode.value = 'all'
      crud.filterCategory.value = 'all'
      expect(crud.filteredProviders.value.map(p => p.id)).toEqual(['a1', 'b2'])
    })

    it('configuredCategoryCounts 按类别统计已配置的', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'a', name: 'A', category: 'llm', is_preset: 1, api_key: 'sk-1', is_configured: true },
          { id: 'b', name: 'B', category: 'tts', is_preset: 1, api_key: 'sk-2', is_configured: true },
          { id: 'c', name: 'C', category: 'tts', is_preset: 1, api_key: '' },
        ],
      })
      await crud.loadProviders()
      expect(crud.configuredCategoryCounts.value).toEqual({ all: 2, llm: 1, tts: 1 })
    })

    it('activeCategoryCounts 随当前视图显示对应的类别计数', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'a', name: 'A', category: 'llm', is_preset: 1, is_configured: true, api_key_masked: 'sk-***' },
          { id: 'b', name: 'B', category: 'tts', is_preset: 1, api_key_masked: '' },
        ],
      })
      await crud.loadProviders()

      expect(crud.activeCategoryCounts.value).toEqual({ all: 1, llm: 1 })
      crud.viewMode.value = 'all'
      expect(crud.activeCategoryCounts.value).toEqual({ all: 2, llm: 1, tts: 1 })
    })

    it('presetCount 统计全部预设数量', async function () {
      modelProviderList.mockResolvedValueOnce({
        code: 0,
        data: [
          { id: 'a', name: 'A', category: 'llm', is_preset: 1, api_key: 'sk-1', is_configured: true },
          { id: 'b', name: 'B', category: 'llm', is_preset: 0, api_key: 'sk-2', is_configured: true },
          { id: 'c', name: 'C', category: 'tts', is_preset: 1, api_key: '' },
        ],
      })
      await crud.loadProviders()
      expect(crud.presetCount.value).toBe(2)
    })
  })

  // ─── 回归测试：composable 导出完整性 ──────────────────────
  describe('composable 导出完整性（防止模板解构遗漏）', function () {
    it('必须导出所有模板中使用的属性和方法', function () {
      // 此列表从 ModelProviders.vue 的 script setup 解构中提取
      const expectedExports = [
        // 常量
        'CATEGORY_OPTIONS', 'CATEGORY_LABELS', 'MULTIMODAL_CAPABILITY_LABELS',
        // 数据状态
        'providers', 'loading', 'submitting', 'filterCategory', 'viewMode',
        'testResults', 'testingId', 'safeStorageAvailable',
        // 表单状态
        'showFormDialog', 'isEditing', 'form',
        // 删除状态
        'showDeleteDialog', 'deleteTarget',
        // 新增对话框
        'showAddDialog', 'addStep', 'addCategory', 'addPresetId',
        'availablePresets', 'isCustomAdd',
        // 计算属性
        'configuredProviders', 'unconfiguredPresets', 'customProviders',
        'filteredProviders', 'configuredCount', 'presetCount',
        'categoryCounts', 'configuredCategoryCounts', 'activeCategoryCounts',
        'isMiniMaxMultimodal',
        // 方法
        'loadProviders', 'toggleCapabilityDefault',
        'openAdd', 'nextAddStep', 'loadAvailablePresets',
        'selectPreset', 'selectCustom', 'openEdit',
        'submitForm', 'confirmDelete', 'doDelete',
        'toggleEnabled', 'setDefault', 'testProvider',
      ]

      for (const key of expectedExports) {
        expect(crud).toHaveProperty(key)
        expect(crud[key]).toBeDefined()
      }
    })

    it('viewMode 默认为 configured', function () {
      expect(crud.viewMode.value).toBe('configured')
    })

    it('configuredProviders 初始为空数组（mock 返回空）', function () {
      expect(crud.configuredProviders.value).toEqual([])
    })

    it('unconfiguredPresets 初始为空数组', function () {
      expect(crud.unconfiguredPresets.value).toEqual([])
    })

    it('customProviders 初始为空数组', function () {
      expect(crud.customProviders.value).toEqual([])
    })

    it('presetCount 初始为 0', function () {
      expect(crud.presetCount.value).toBe(0)
    })

    it('configuredCategoryCounts 初始为 { all: 0 }', function () {
      expect(crud.configuredCategoryCounts.value).toEqual({ all: 0 })
    })

    // ─── 多模态模型类别与优先开关 ────────────────────────────
    it('CATEGORY_OPTIONS 包含多模态模型类别与本地化标签', function () {
      const option = crud.CATEGORY_OPTIONS.value.find(opt => opt.value === 'multimodal')
      expect(option).toBeDefined()
      expect(option.label).toBe('多模态模型')
      expect(crud.CATEGORY_LABELS.value.multimodal).toBe('多模态模型')
      expect(crud.MULTIMODAL_CAPABILITY_LABELS.value.tts).toBe('TTS语音')
      // en 语言下标签切换为英文
      i18n.global.locale.value = 'en'
      expect(crud.CATEGORY_LABELS.value.multimodal).toBe('Multimodal Models')
    })


  })
  })
  describe('多模态「支持生成视频」开关（默认关闭）', function () {
    it('默认关闭（false）', function () {
      expect(crud.multimodalVideoEnabled.value).toBe(false)
    })
    it('set true/false 写入 form.config.capability_enabled.video', function () {
      crud.form.value = { config: {} }
      crud.multimodalVideoEnabled.value = true
      expect(crud.form.value.config.capability_enabled.video).toBe(true)
      expect(crud.multimodalVideoEnabled.value).toBe(true)
      crud.multimodalVideoEnabled.value = false
      expect(crud.form.value.config.capability_enabled.video).toBe(false)
    })
    it('读取已有配置的开关状态', function () {
      crud.form.value = { config: { capability_enabled: { video: true } } }
      expect(crud.multimodalVideoEnabled.value).toBe(true)
    })
    it('selectPreset 新建 minimax-multimodal 时默认 capability_enabled.video=false', async function () {
      const { modelProviderPresets } = await import('@/api/model-providers')
      modelProviderPresets.mockResolvedValueOnce({ code: 0, data: [{ id: 'minimax-multimodal', name: 'MiniMax', category: 'multimodal', base_url: 'x', models: [], capabilities: ['llm', 'tts', 'image', 'video'], capability_models: {} }] })
      crud.addCategory.value = 'multimodal'
      await crud.loadAvailablePresets()
      crud.selectPreset('minimax-multimodal')
      expect(crud.form.value.config.capability_enabled.video).toBe(false)
      expect(crud.multimodalVideoEnabled.value).toBe(false)
    })

    it('isMiniMaxMultimodal：minimax-multimodal 为 true，其它服务商为 false（模型列表只读分支）', async function () {
      const { modelProviderPresets } = await import('@/api/model-providers')
      modelProviderPresets.mockResolvedValueOnce({ code: 0, data: [{ id: 'minimax-multimodal', name: 'MiniMax', category: 'multimodal', base_url: 'x', models: [], capabilities: ['llm', 'tts', 'image', 'video'], capability_models: {} }] })
      crud.addCategory.value = 'multimodal'
      await crud.loadAvailablePresets()
      crud.selectPreset('minimax-multimodal')
      expect(crud.isMiniMaxMultimodal.value).toBe(true)

      // 编辑非 MiniMax 多模态服务商 → false（仍渲染模型列表输入框）
      crud.openEdit({ id: 'openai', name: 'OpenAI', category: 'multimodal', models: ['gpt-4o'], config: {} })
      expect(crud.isMiniMaxMultimodal.value).toBe(false)

      // 编辑 MiniMax 多模态服务商 → true（模型列表只读，不渲染输入框）
      crud.openEdit({
        id: 'minimax-multimodal', name: 'MiniMax', category: 'multimodal',
        models: [], modelsText: '', config: {},
      })
      expect(crud.isMiniMaxMultimodal.value).toBe(true)
    })

    it('导出完整性：multimodalVideoEnabled 可访问', function () {
      expect('value' in crud.multimodalVideoEnabled).toBe(true)
    })
    it('编辑 MiniMax 多模态时提交 config 携带 capability_enabled.video', async function () {
      const { modelProviderUpdate } = await import('@/api/model-providers')
      crud.form.value = {
        id: 'minimax-multimodal', name: 'MiniMax', category: 'multimodal',
        base_url: 'https://api.minimaxi.com/v1', models: [], modelsText: '', config: {},
      }
      crud.isEditing.value = true
      crud.multimodalVideoEnabled.value = true
      await crud.submitForm()
      expect(modelProviderUpdate).toHaveBeenCalled()
      const [id, data] = modelProviderUpdate.mock.calls[0]
      expect(id).toBe('minimax-multimodal')
      expect(data.config.capability_enabled.video).toBe(true)
    })
  })

  // ─── 用户默认模型（双默认语义 2026-08-27）─────────────────
  describe('用户默认模型', function () {
    it('openEdit 从 provider.config.user_default_model 初始化表单', async function () {
      crud.openEdit({
        id: 'openai', name: 'OpenAI', category: 'llm',
        models: ['gpt-4o', 'gpt-4o-mini'],
        config: { user_default_model: 'gpt-4o-mini', default_model: 'gpt-4o' },
      })
      expect(crud.form.value.user_default_model).toBe('gpt-4o-mini')
      expect(crud.form.value.models).toEqual(['gpt-4o', 'gpt-4o-mini'])
    })

    it('openEdit 无用户默认时初始化为空（跟随运营默认）', async function () {
      crud.openEdit({
        id: 'openai', name: 'OpenAI', category: 'llm',
        models: ['gpt-4o'], config: { default_model: 'gpt-4o' },
      })
      expect(crud.form.value.user_default_model).toBe('')
    })

    it('selectPreset 新建时 user_default_model 初始为空', async function () {
      const { modelProviderPresets } = await import('@/api/model-providers')
      modelProviderPresets.mockResolvedValueOnce({ code: 0, data: [{ id: 'flux', name: 'Flux', category: 'image', base_url: 'x', models: ['flux-pro'], capabilities: [] }] })
      crud.addCategory.value = 'image'
      await crud.loadAvailablePresets()
      crud.selectPreset('flux')
      expect(crud.form.value.user_default_model).toBe('')
    })

    it('submitForm 用户选择默认模型时写入 config.user_default_model（∈ models）', async function () {
      const { modelProviderUpdate } = await import('@/api/model-providers')
      crud.isEditing.value = true
      crud.form.value = {
        id: 'openai', name: 'OpenAI', category: 'llm', base_url: '',
        api_key: '', models: ['gpt-4o', 'gpt-4o-mini'], modelsText: 'gpt-4o, gpt-4o-mini',
        user_default_model: 'gpt-4o-mini', config: { default_model: 'gpt-4o' },
      }
      await crud.submitForm()
      expect(modelProviderUpdate).toHaveBeenCalledTimes(1)
      const [id, data] = modelProviderUpdate.mock.calls[0]
      expect(id).toBe('openai')
      expect(data.config.user_default_model).toBe('gpt-4o-mini')
      expect(data.config.default_model).toBe('gpt-4o') // 运营默认保留
    })

    it('submitForm 用户默认模型不在模型列表时拦截并提示（不发请求）', async function () {
      const { modelProviderUpdate } = await import('@/api/model-providers')
      const { ElMessage } = await import('element-plus')
      crud.isEditing.value = true
      crud.form.value = {
        id: 'openai', name: 'OpenAI', category: 'llm', base_url: '',
        api_key: '', models: ['gpt-4o'], modelsText: 'gpt-4o',
        user_default_model: 'gpt-4o-mini', config: {},
      }
      await crud.submitForm()
      expect(ElMessage.warning).toHaveBeenCalledWith('默认模型必须属于该服务商的模型列表')
      expect(modelProviderUpdate).not.toHaveBeenCalled()
    })

    it('submitForm 未选择默认模型时删除 config.user_default_model（跟随运营默认）', async function () {
      const { modelProviderUpdate } = await import('@/api/model-providers')
      crud.isEditing.value = true
      crud.form.value = {
        id: 'openai', name: 'OpenAI', category: 'llm', base_url: '',
        api_key: '', models: ['gpt-4o'], modelsText: 'gpt-4o',
        user_default_model: '', config: { user_default_model: 'gpt-4o', default_model: 'gpt-4o' },
      }
      await crud.submitForm()
      expect(modelProviderUpdate).toHaveBeenCalledTimes(1)
      const [id, data] = modelProviderUpdate.mock.calls[0]
      expect(id).toBe('openai')
      expect(data.config.user_default_model).toBeUndefined()
      expect(data.config.default_model).toBe('gpt-4o')
    })

    it('新增预设保存时 config 携带 user_default_model（配置下沉路径）', async function () {
      const { modelProviderCreate } = await import('@/api/model-providers')
      modelProviderCreate.mockResolvedValueOnce({ code: 0 })
      crud.isEditing.value = false
      crud.form.value = {
        id: 'flux', name: 'Flux', category: 'image', base_url: 'https://api.bfl.ml/v1',
        api_key: 'sk-test', models: ['flux-pro'], modelsText: 'flux-pro',
        user_default_model: 'flux-pro', config: {},
      }
      await crud.submitForm()
      expect(modelProviderCreate).toHaveBeenCalledTimes(1)
      const [data] = modelProviderCreate.mock.calls[0]
      expect(data.config.user_default_model).toBe('flux-pro')
    })
  })

  // ─── 多模态能力声明保留（Agnes 能力显示丢失回归）──────────────
  // 根因：selectPreset 把 capabilities 放在 form 顶层，submitForm 构造 data 时
  // 未写入 config.capabilities/capability_models；走「添加已有预设」流程时
  // PROVIDER_EXISTS 降级 updateProvider 整体替换 config，存量能力声明被抹掉，
  // 模型列表卡片的能力 chips 与能力默认按钮消失。
  describe('多模态能力声明保留（Agnes 能力显示丢失回归）', function () {
    it('submitForm 保存多模态预设时 config 必须携带 capabilities 与 capability_models', async function () {
      crud.isEditing.value = false
      crud.form.value = {
        id: 'agnes-multimodal', name: 'Agnes-AI', category: 'multimodal',
        base_url: 'https://api.agnes-ai.cn/v1', api_key: 'sk-test',
        models: ['agnes-3.0-flash', 'agnes-image-2.5-flash', 'agnes-video-2.5-flash'],
        modelsText: 'agnes-3.0-flash, agnes-image-2.5-flash, agnes-video-2.5-flash',
        capabilities: ['llm', 'image', 'video'],
        capability_models: { llm: 'agnes-3.0-flash', image: 'agnes-image-2.5-flash', video: 'agnes-video-2.5-flash' },
        config: { capability_enabled: { video: false } },
      }

      await crud.submitForm()

      expect(modelProviderCreate).toHaveBeenCalledTimes(1)
      const [data] = modelProviderCreate.mock.calls[0]
      expect(data.config.capabilities).toEqual(['llm', 'image', 'video'])
      expect(data.config.capability_models).toEqual({
        llm: 'agnes-3.0-flash', image: 'agnes-image-2.5-flash', video: 'agnes-video-2.5-flash',
      })
      // 原有 capability_enabled 不得丢失
      expect(data.config.capability_enabled).toEqual({ video: false })
    })

    it('添加已有预设降级更新时不得抹掉存量能力声明（PROVIDER_EXISTS 路径）', async function () {
      // 模拟预设行已存在（种子已插入），create 返回 PROVIDER_EXISTS
      modelProviderCreate.mockResolvedValueOnce({ code: -1, errorCode: 'PROVIDER_EXISTS', message: '服务商 ID「agnes-multimodal」已存在' })
      modelProviderUpdate.mockResolvedValueOnce({ code: 0 })
      modelProviderList.mockResolvedValueOnce({ code: 0, data: [] })

      crud.isEditing.value = false
      crud.form.value = {
        id: 'agnes-multimodal', name: 'Agnes-AI', category: 'multimodal',
        base_url: 'https://api.agnes-ai.cn/v1', api_key: 'sk-test',
        models: ['agnes-3.0-flash', 'agnes-image-2.5-flash', 'agnes-video-2.5-flash'],
        modelsText: 'agnes-3.0-flash, agnes-image-2.5-flash, agnes-video-2.5-flash',
        capabilities: ['llm', 'image', 'video'],
        capability_models: { llm: 'agnes-3.0-flash', image: 'agnes-image-2.5-flash', video: 'agnes-video-2.5-flash' },
        config: { capability_enabled: { video: false } },
      }

      await crud.submitForm()

      // 降级更新路径必须被触发
      expect(modelProviderUpdate).toHaveBeenCalledTimes(1)
      const [updateId, updateData] = modelProviderUpdate.mock.calls[0]
      expect(updateId).toBe('agnes-multimodal')
      // 关键断言：降级更新的 config 必须保留能力声明
      expect(updateData.config.capabilities).toEqual(['llm', 'image', 'video'])
      expect(updateData.config.capability_models).toEqual({
        llm: 'agnes-3.0-flash', image: 'agnes-image-2.5-flash', video: 'agnes-video-2.5-flash',
      })
    })

    it('编辑多模态服务商时 config 中已有的能力声明不得丢失', async function () {
      crud.isEditing.value = true
      // 模拟 openEdit 加载的 provider：config 已含能力声明（种子回填）
      crud.form.value = {
        id: 'agnes-multimodal', name: 'Agnes-AI', category: 'multimodal',
        base_url: 'https://api.agnes-ai.cn/v1', api_key: '',
        models: ['agnes-3.0-flash', 'agnes-image-2.5-flash', 'agnes-video-2.5-flash'],
        modelsText: 'agnes-3.0-flash, agnes-image-2.5-flash, agnes-video-2.5-flash',
        user_default_model: '',
        config: {
          capabilities: ['llm', 'image', 'video'],
          capability_models: { llm: 'agnes-3.0-flash', image: 'agnes-image-2.5-flash', video: 'agnes-video-2.5-flash' },
          capability_enabled: { video: true },
        },
      }

      await crud.submitForm()

      expect(modelProviderUpdate).toHaveBeenCalledTimes(1)
      const [, data] = modelProviderUpdate.mock.calls[0]
      // 编辑路径：config 原有能力声明原样保留
      expect(data.config.capabilities).toEqual(['llm', 'image', 'video'])
      expect(data.config.capability_models).toEqual({
        llm: 'agnes-3.0-flash', image: 'agnes-image-2.5-flash', video: 'agnes-video-2.5-flash',
      })
    })

    it('form 顶层无 capabilities 时不注入空数组（不覆盖运营下发值）', async function () {
      crud.isEditing.value = true
      crud.form.value = {
        id: 'minimax-multimodal', name: 'MiniMax', category: 'multimodal',
        base_url: '', api_key: '',
        models: ['MiniMax-M2.7'], modelsText: 'MiniMax-M2.7',
        user_default_model: '',
        config: { capabilities: ['llm', 'tts', 'image', 'video'] },
      }

      await crud.submitForm()

      const [, data] = modelProviderUpdate.mock.calls[0]
      // config 已有能力声明 → 原样保留，不被 undefined/空数组覆盖
      expect(data.config.capabilities).toEqual(['llm', 'tts', 'image', 'video'])
    })
  })
})

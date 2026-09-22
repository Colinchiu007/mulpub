// @ts-check
/**
 * model-provider-apply-catalog.test.js — ModelProviderManager.applyCatalog（运行时同步写入）
 *
 * 覆盖：目录配置合并（限流/能力/模型/默认模型）、不覆盖 api_key/enabled/is_default/base_url、
 * 缺失行插入（is_preset=1/enabled=0）、本地独有行不清除、限流清空回退、governor 重应用。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import initSqlJs from 'sql.js'

__enableElectronMock()
__registerMock('./logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn() })
__registerMock('./crypto', {
  isAvailable: () => true,
  encrypt: (key) => (key ? Buffer.from('enc_' + key) : null),
  decrypt: (value) => (value ? Buffer.from(value).toString('utf8').replace(/^enc_/, '') : ''),
  mask: (key) => (key ? key.slice(0, 4) + '****' + key.slice(-4) : '****'),
  setSafeStorage: () => {},
})

class SqlJsAdapter {
  constructor (database) { this.database = database }
  prepare (sql) {
    const database = this.database
    return {
      run (...params) {
        const statement = database.prepare(sql)
        if (params.length) statement.bind(params)
        statement.step()
        const changes = database.getRowsModified()
        statement.free()
        return { changes }
      },
      get (...params) {
        const statement = database.prepare(sql)
        if (params.length) statement.bind(params)
        const row = statement.step() ? statement.getAsObject() : undefined
        statement.free()
        return row
      },
      all (...params) {
        const rows = []
        const statement = database.prepare(sql)
        if (params.length) statement.bind(params)
        while (statement.step()) rows.push(statement.getAsObject())
        statement.free()
        return rows
      },
    }
  }
  exec (sql) { this.database.exec(sql) }
}

let database
let db
let manager

function row (id) {
  const stmt = database.prepare('SELECT * FROM model_providers WHERE id = ?')
  stmt.bind([id])
  const r = stmt.step() ? stmt.getAsObject() : null
  stmt.free()
  return r
}

beforeAll(async () => {
  const SQL = await initSqlJs()
  database = new SQL.Database()
  const { SCHEMA_SQL } = require('./store-schema')
  db = new SqlJsAdapter(database)
  for (const statement of SCHEMA_SQL) db.exec(statement)

  const store = { db, _ready: true, getSetting: () => null, setSetting: () => {} }
  manager = new (require('./model-provider-manager').ModelProviderManager)(store)
  manager.setGovernor({
    setProviderLimits: vi.fn(),
    setProviderTokenWindows: vi.fn(),
    removeProviderLimits: vi.fn(),
  })
  manager.init()
})

afterAll(() => { if (database) database.close() })

describe('ModelProviderManager.applyCatalog', () => {
  it('合并目录配置到已有行：限流/能力/模型/默认模型，不覆盖 api_key/enabled/is_default/base_url', () => {
    const before = row('openai')
    // 本地已有用户配置（Key/启用/默认/URL）
    db.prepare(
      "UPDATE model_providers SET api_key = 'sk-local', api_key_enc = NULL, enabled = 1, is_default = 1, base_url = 'https://local.example/v1', models = ?, config = ?, updated_at = datetime('now') WHERE id = 'openai'"
    ).run(JSON.stringify(['gpt-4o-local']), JSON.stringify({ rate_per_minute: 5, foo: 'keep' }))

    const res = manager.applyCatalog([
      {
        id: 'openai', name: 'OpenAI', category: 'llm', base_url: 'https://catalog.example/v1',
        models: ['gpt-4o', 'gpt-4o-mini'], default_model: 'gpt-4o',
        rate_per_minute: 30, limit_per_5h: 600,
        capabilities: ['llm'], capability_models: { llm: 'gpt-4o' },
      },
    ])
    expect(res.code).toBe(0)
    expect(res.updated).toBe(1)

    const after = row('openai')
    expect(after.api_key).toBe('sk-local')          // 不覆盖
    expect(after.enabled).toBe(1)                    // 不覆盖
    expect(after.is_default).toBe(1)                 // 不覆盖
    expect(after.base_url).toBe('https://local.example/v1') // 不覆盖
    expect(JSON.parse(after.models)).toEqual(['gpt-4o', 'gpt-4o-mini'])
    const cfg = JSON.parse(after.config)
    expect(cfg.rate_per_minute).toBe(30)
    expect(cfg.limit_per_5h).toBe(600)
    expect(cfg.default_model).toBe('gpt-4o')
    expect(cfg.capabilities).toEqual(['llm'])
    expect(cfg.capability_models).toEqual({ llm: 'gpt-4o' })
    expect(cfg.foo).toBe('keep')                     // 本地自定义键保留
    expect(before).toBeTruthy()
  })

  it('运营未配置限流（null/空串/0）→ 清除本地值，governor 回退默认', () => {
    db.prepare(
      "UPDATE model_providers SET config = ?, updated_at = datetime('now') WHERE id = 'openai'"
    ).run(JSON.stringify({ rate_per_minute: 88, limit_per_5h: 999 }))
    const res = manager.applyCatalog([{ id: 'openai', rate_per_minute: null, limit_per_5h: '' }])
    expect(res.code).toBe(0)
    const cfg = JSON.parse(row('openai').config)
    expect(cfg.rate_per_minute).toBeUndefined()
    expect(cfg.limit_per_5h).toBeUndefined()
    // governor 预算重应用（覆盖全部行）
    expect(manager._governor.setProviderLimits).toHaveBeenCalled()
  })

  it('目录有但本地缺失 → 插入 is_preset=1 / enabled=0 行', () => {
    expect(row('catalog-only-provider')).toBeNull()
    const res = manager.applyCatalog([
      {
        id: 'catalog-only-provider', name: '目录新服务商', category: 'tts', base_url: 'https://cat.example',
        models: ['m1'], default_model: 'm1', rate_per_minute: 12,
      },
    ])
    expect(res.code).toBe(0)
    expect(res.inserted).toBe(1)
    const r = row('catalog-only-provider')
    expect(r.is_preset).toBe(1)
    expect(r.enabled).toBe(0)
    expect(r.category).toBe('tts')
    expect(JSON.parse(r.models)).toEqual(['m1'])
    expect(JSON.parse(r.config).rate_per_minute).toBe(12)
  })

  it('目录缺失的本地行不清除；非法 item（无 id）跳过', () => {
    const res = manager.applyCatalog([
      { foo: 'bar' },
      { id: 'openai', name: 'OpenAI' },
    ])
    expect(res.code).toBe(0)
    expect(res.updated).toBe(0) // 仅 openai 命中，且内容无变化 → 跳过 UPDATE
    expect(res.unchanged).toBe(1)
    expect(row('catalog-only-provider')).toBeTruthy() // 仍存在
  })

  it('畸形目录项（缺 models 字段）不清空本地模型列表（fail-closed）', () => {
    db.prepare(
      "UPDATE model_providers SET models = ?, config = ?, updated_at = datetime('now') WHERE id = 'openai'"
    ).run(JSON.stringify(['gpt-4o', 'gpt-4o-mini']), JSON.stringify({ rate_per_minute: 12 }))
    const res = manager.applyCatalog([{ id: 'openai', name: 'OpenAI', rate_per_minute: 30 }])
    expect(res.code).toBe(0)
    expect(JSON.parse(row('openai').models)).toEqual(['gpt-4o', 'gpt-4o-mini']) // 模型保留
    expect(JSON.parse(row('openai').config).rate_per_minute).toBe(30)           // 限流照常合并
  })

  it('sort_order：目录数字写入 config，null/缺失时删除（目录权威）', () => {
    let res = manager.applyCatalog([{ id: 'openai', sort_order: 3 }])
    expect(res.code).toBe(0)
    expect(JSON.parse(row('openai').config).sort_order).toBe(3)
    res = manager.applyCatalog([{ id: 'openai', sort_order: null }])
    expect(res.code).toBe(0)
    expect(JSON.parse(row('openai').config).sort_order).toBeUndefined()
  })

  it('内容无实质变化的重放跳过 UPDATE 不 bump updated_at；有变化才 bump', () => {
    db.prepare("UPDATE model_providers SET models = ?, config = ?, updated_at = '2000-01-01 00:00:00' WHERE id = 'openai'")
      .run(JSON.stringify(['m1']), JSON.stringify({ rate_per_minute: 7, sort_order: 2 }))
    const same = manager.applyCatalog([{ id: 'openai', models: ['m1'], rate_per_minute: 7, sort_order: 2 }])
    expect(same.updated).toBe(0)
    expect(same.unchanged).toBe(1)
    expect(row('openai').updated_at).toBe('2000-01-01 00:00:00')

    const changed = manager.applyCatalog([{ id: 'openai', models: ['m1'], rate_per_minute: 7, sort_order: 1 }])
    expect(changed.updated).toBe(1)
    expect(row('openai').updated_at).not.toBe('2000-01-01 00:00:00')
    expect(JSON.parse(row('openai').config).sort_order).toBe(1)
  })

  it('未就绪 / 非数组 → fail-closed', () => {
    const notReady = new (require('./model-provider-manager').ModelProviderManager)({ db: database })
    expect(notReady.applyCatalog([{ id: 'x' }]).code).toBe(-1)
    expect(manager.applyCatalog('not-array').code).toBe(-1)
    expect(manager.applyCatalog(null).code).toBe(-1)
  })
})

describe('ModelProviderManager.updateProvider persist', () => {
  it('updateProvider 写入 key 后立即调用 persist() 防止非正常退出丢失', () => {
    const persistSpy = vi.fn()
    db.persist = persistSpy
    const result = manager.updateProvider('openai', { api_key: 'sk-test-new-key' })
    expect(result.code).toBe(0)
    expect(persistSpy).toHaveBeenCalledTimes(1)
    // key 已加密写入
    const r = row('openai')
    expect(r.api_key).toBe('')
    expect(r.api_key_enc).toBeTruthy()
  })
})
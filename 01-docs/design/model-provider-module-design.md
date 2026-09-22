# 模型供应商管理模块化设计文档

> **Phase 1.1 技术架构设计** — 质量节拍
> **日期**: 2026-07-15
> **作者**: Phase 0 探索期分析 → Phase 1 规划期
> **状态**: ✅ /plan-eng-review 审查通过 (8.7/10)
>
> ## 审查记录
> - **审查日期**: 2026-07-15 Phase 1.2
> - **综合评分**: 8.7/10 (通过 7.0 门禁)
> - **6 个审查发现已整合到下方设计**:
>   1. P1: `ai-generator.js` 应完全删除 `_configs` 内存 Map，直接调用 `modelProviderManager`
>   2. P2: `crypto.js` 支持注入 mock safeStorage（测试用）
>   3. P2: 迁移脚本先备份 SQLite + 验证 decrypt 成功才清空明文
>   4. P3: `router._logCall` 应通过 IPC 事件通知前端 UI 更新
>   5. P1: 先写"删除 PROVIDERS 后行为不变"测试再改代码（TDD）
>   6. P2: safeStorage 不可用时拒绝存储 + UI 显示警告（非降级明文）

---

## 一、背景与现状诊断

### 1.1 项目背景

Multi-Publish 是一站式视频生成平台（Electron + Vue3 + Node.js），已有 14 个发布管线 + Python sidecar 桥接（smart-sentence-splitter / prompt-engine）。项目需要管理 5 类 AI 模型供应商：

| 类别 | 用途 | 供应商示例 |
|------|------|-----------|
| `llm` | 文本生成、标题优化、内容润色 | OpenAI, Anthropic, DeepSeek, Qwen, Doubao |
| `tts` | 配音、播报 | ElevenLabs, OpenAI TTS, Doubao TTS |
| `speech_recognition` | 语音转文字 | Whisper, Google STT, Doubao STT |
| `image` | 封面图、配图生成 | Flux, DALL-E, Recraft, ComfyUI |
| `video` | 短视频、动画制作 | Hunyuan, CogVideo, Kling, Runway |

### 1.2 现有实现（已有，非从零开始）

项目**已有完整的模型供应商管理实现**，分布在以下 8 个文件：

| 层 | 文件 | 职责 |
|----|------|------|
| 数据层 | `electron/services/store-schema.js` | `model_providers` SQLite 表 + 索引 |
| 种子数据 | `electron/services/model-provider-seeds.js` | 30+ 预设供应商（5 类） |
| Manager | `electron/services/model-provider-manager.js` | CRUD + 默认设置 + testConnection（占位） |
| IPC | `electron/ipc-handlers/model-provider.js` | 8 个 handler |
| 前端 API | `src/api/model-providers.js` | 10 个封装函数 |
| Vue 组件 | `src/views/ModelProviders.vue` | 设置页 UI |
| Composable | `src/composables/useModelProviderCrud.js` | CRUD 逻辑 |
| 测试 | `tests/model-provider-manager.test.js` | 单元测试 |

### 1.3 双轨制问题（核心痛点）

```
轨道 A（新，SQLite）                轨道 B（旧，内存 Map）
──────────────────────────         ──────────────────────────
model-provider-manager.js          ai-generator.js
  └─ model_providers 表              └─ PROVIDERS 硬编码注册表（30+ 供应商）
  └─ 5 类模型分类                    └─ _configs Map（运行时配置）
  └─ api_key 明文存储 ⚠️ 安全风险     └─ apiKey/baseUrl/enabled
  └─ 无 Adapter 抽象 ⚠️ 扩展难       └─ 无 Adapter 抽象 ⚠️
  └─ testConnection 占位 ⚠️          └─ setModelProviderManager() 桥接
  └─ 无路由策略 ⚠️                   └─ 桥接 Python sidecar 调用
```

**6 个具体问题：**

| # | 问题 | 严重性 | 位置 |
|---|------|--------|------|
| P1 | **数据双源** — `ai-generator.js` PROVIDERS 注册表 vs `model-provider-seeds.js` SQLite 种子，两份供应商列表容易不同步 | 高 | ai-generator.js:12-52 |
| P2 | **API Key 明文存储** — SQLite `api_key` 字段未加密，违反安全规范 | 高 | store-schema.js:81-94 |
| P3 | **无 Adapter 抽象** — 每个供应商 API 差异散落在调用方，新增供应商需改 3 处代码 | 中 | ai-generator.js + Python llm_client.py |
| P4 | **testConnection 占位** — 只检查配置非空，不真正调用供应商 API | 中 | model-provider-manager.js:310-325 |
| P5 | **无路由策略** — 只能手动设默认，无自动故障转移/负载均衡 | 中 | model-provider-manager.js:244-282 |
| P6 | **5 类模型分散调用** — LLM 走 Python bridge；TTS/Image/Video 各有独立路径，未统一 | 中 | ai-generator.js 桥接逻辑 |

### 1.4 参考项目调研结论

| 项目 | 核心设计 | 可复用度 | 许可证 |
|------|---------|---------|--------|
| **one-api** | Adaptor 接口（9 方法）+ Channel GORM 模型 | ⭐⭐⭐⭐⭐ | MIT |
| **new-api** | 最丰富适配器 + TaskAdaptor 异步任务 | ⭐⭐⭐⭐ 仅参考 | AGPLv3 ⚠️ |
| **APIPark** | YAML 驱动配置 + MaskConfig 密钥遮罩 + 分片锁 | ⭐⭐⭐⭐ | Apache-2.0 |
| **CoAI** | 工厂注册表 + PreflightSequence 预检路由 | ⭐⭐⭐⭐ | Apache-2.0 |
| **LocalAI** | 模块化 Backend + 60+ 后端集成 | ⭐⭐ | MIT |

**融合策略**: one-api Adaptor 接口 + APIPark MaskConfig 加密 + CoAI 工厂注册与路由

---

## 二、目标架构设计

### 2.1 模块目录结构

```
apps/desktop/electron/services/model-provider/    ← 新模块根目录
├── index.js                    ← 模块入口，导出 ModelProviderModule
├── manager.js                  ← 从 model-provider-manager.js 迁移，调用 Adapter
├── seeds.js                    ← 从 model-provider-seeds.js 迁移
├── schema.js                   ← model_providers 表结构（加密版）
├── crypto.js                   ← Electron safeStorage 加密/解密
├── router.js                   ← 路由策略：默认/轮询/故障转移
├── adapters/                   ← 供应商适配器
│   ├── base.js                 ← IModelProvider 抽象接口
│   ├── registry.js             ← 工厂注册表（map 形式）
│   ├── openai.js               ← OpenAI 兼容（含 DeepSeek/Qwen/Doubao）
│   ├── anthropic.js            ← Anthropic Claude
│   ├── elevenlabs.js           ← TTS
│   ├── flux.js                 ← 图片生成
│   └── hunyuan.js              ← 视频
└── __tests__/
    ├── manager.test.js
    ├── crypto.test.js
    ├── router.test.js
    └── adapters/
        ├── openai.test.js
        └── registry.test.js
```

### 2.2 数据模型（SQLite schema 升级）

```sql
-- model_providers 表（v2，新增 api_key_enc 加密字段）
CREATE TABLE IF NOT EXISTS model_providers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,           -- llm/tts/speech_recognition/image/video
  base_url      TEXT DEFAULT '',
  api_key       TEXT DEFAULT '',         -- ⚠️ 保留用于数据迁移，v2 后弃用
  api_key_enc   BLOB,                    -- ✅ 新增：Electron safeStorage 加密后的密钥
  models        TEXT DEFAULT '[]',       -- JSON 数组
  enabled       INTEGER DEFAULT 0,
  is_default    INTEGER DEFAULT 0,
  is_preset     INTEGER DEFAULT 0,
  config        TEXT DEFAULT '{}',       -- JSON：额外配置（如 timeout, proxy, retry）
  priority      INTEGER DEFAULT 0,       -- ✅ 新增：路由优先级（数字越大越优先）
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- ✅ 新增：调用日志表（参考 APIPark 可观测性）
CREATE TABLE IF NOT EXISTS model_provider_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id   TEXT NOT NULL,
  category      TEXT NOT NULL,
  model         TEXT,
  action        TEXT NOT NULL,           -- chat/tts/image/video/test
  status        TEXT NOT NULL,           -- success/error/timeout
  latency_ms    INTEGER,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  cost          REAL,
  error_message TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (provider_id) REFERENCES model_providers(id)
);

CREATE INDEX IF NOT EXISTS idx_model_providers_category ON model_providers(category);
CREATE INDEX IF NOT EXISTS idx_model_provider_logs_provider ON model_provider_logs(provider_id);
CREATE INDEX IF NOT EXISTS idx_model_provider_logs_created ON model_provider_logs(created_at);
```

**数据迁移策略**:
```javascript
// 迁移脚本：启动时检测 api_key_enc 为空但 api_key 非空的记录，加密后清空明文
async function migrateApiKeyEncryption(db, safeStorage) {
  const rows = db.prepare("SELECT id, api_key FROM model_providers WHERE api_key != '' AND api_key_enc IS NULL").all();
  if (rows.length === 0) return;

  const stmt = db.prepare('UPDATE model_providers SET api_key_enc = ?, api_key = "" WHERE id = ?');
  for (const row of rows) {
    const encrypted = safeStorage.encryptString(row.api_key);
    stmt.run(encrypted, row.id);
  }
  log.info('ModelProviderMigration', `Migrated ${rows.length} API keys to encrypted storage`);
}
```

### 2.3 Adapter 抽象接口（核心，参考 one-api）

```javascript
// adapters/base.js
/**
 * IModelProvider — 所有供应商适配器必须实现
 * 参考 one-api Adaptor 接口，简化为 9 个核心方法
 *
 * @interface
 */
class IModelProvider {
  /**
   * 供应商 ID（如 'openai', 'anthropic'）
   * @returns {string}
   */
  id() {}

  /**
   * 显示名称
   * @returns {string}
   */
  displayName() {}

  /**
   * 支持的模型列表
   * @returns {string[]}
   */
  models() {}

  /**
   * 支持的类别（llm/tts/speech_recognition/image/video）
   * @returns {string[]}
   */
  categories() {}

  /**
   * 测试连接（真正调用供应商 API，返回延迟和可用模型）
   * @param {object} config - { api_key, base_url, model }
   * @returns {Promise<{ ok: boolean, latencyMs: number, models?: string[], error?: string }>}
   */
  async testConnection(config) {}

  /**
   * 聊天补全（LLM 类专用）
   * @param {object} params - { messages, model, temperature, max_tokens, stream }
   * @param {object} config - { api_key, base_url }
   * @returns {Promise<{ content: string, usage: { prompt_tokens, completion_tokens }, model: string }>}
   */
  async chatCompletion(params, config) {}

  /**
   * 流式聊天（SSE 透传，async generator）
   * @param {object} params
   * @param {object} config
   * @returns {AsyncGenerator<{ delta: string, done: boolean }>}
   */
  async *streamChat(params, config) {}

  /**
   * 语音合成（TTS 类专用）
   * @param {string} text
   * @param {object} config - { api_key, base_url, voice, speed }
   * @returns {Promise<{ audio: Buffer, format: string }>}
   */
  async synthesize(text, config) {}

  /**
   * 生成图片（Image 类专用）
   * @param {string} prompt
   * @param {object} config - { api_key, base_url, size, quality }
   * @returns {Promise<{ url: string, revised_prompt?: string }>}
   */
  async generateImage(prompt, config) {}

  /**
   * 生成视频（Video 类专用）
   * @param {object} params - { prompt, duration, resolution }
   * @param {object} config
   * @returns {Promise<{ url: string, duration: number }>}
   */
  async generateVideo(params, config) {}

  /**
   * 估算成本
   * @param {object} usage - { tokens_in, tokens_out, duration }
   * @param {string} model
   * @returns {number} 成本（美元）
   */
  estimateCost(usage, model) {}

  /**
   * 请求前的配置校验
   * @param {object} config
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateConfig(config) {}
}
```

### 2.4 工厂注册表（参考 CoAI）

```javascript
// adapters/registry.js
const adapters = new Map();
const categoryAdapters = new Map(); // category -> adapter[]

function registerAdapter(AdapterClass) {
  const instance = new AdapterClass();
  const id = instance.id();

  if (adapters.has(id)) {
    throw new Error(`Adapter "${id}" already registered`);
  }

  adapters.set(id, instance);

  // 按类别索引
  for (const category of instance.categories()) {
    if (!categoryAdapters.has(category)) {
      categoryAdapters.set(category, []);
    }
    categoryAdapters.get(category).push(instance);
  }
}

function getAdapter(providerId) {
  return adapters.get(providerId) || null;
}

function getAdaptersByCategory(category) {
  return categoryAdapters.get(category) || [];
}

function listAdapters() {
  return Array.from(adapters.values());
}

module.exports = { registerAdapter, getAdapter, getAdaptersByCategory, listAdapters };
```

### 2.5 密钥加密（参考 APIPark MaskConfig）

```javascript
// crypto.js
const { safeStorage } = require('electron');

/**
 * 加密 API Key
 * safeStorage 使用操作系统级加密：
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: libsecret
 *
 * 加密后的数据只能由同一应用在同一机器解密
 */
function encrypt(apiKey) {
  if (!apiKey) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('ModelProviderCrypto', 'safeStorage not available, storing plaintext');
    return Buffer.from(apiKey, 'utf-8'); // 降级方案
  }
  return safeStorage.encryptString(apiKey);
}

function decrypt(encrypted) {
  if (!encrypted) return '';
  const buf = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(encrypted);
  if (!safeStorage.isEncryptionAvailable()) {
    return buf.toString('utf-8'); // 降级方案
  }
  try {
    return safeStorage.decryptString(buf);
  } catch (e) {
    log.error('ModelProviderCrypto', 'Decrypt failed: ' + e.message);
    return '';
  }
}

/** 返回遮罩后的 API Key（用于显示，如 sk-****1234） */
function mask(apiKey) {
  if (!apiKey || apiKey.length < 8) return '****';
  const prefix = apiKey.substring(0, 4);
  const suffix = apiKey.substring(apiKey.length - 4);
  return `${prefix}****${suffix}`;
}

module.exports = { encrypt, decrypt, mask };
```

### 2.6 路由策略（参考 CoAI PreflightSequence）

```javascript
// router.js
/**
 * Provider 路由策略
 *
 * 策略类型：
 * 1. default     — 使用 is_default=1 的供应商
 * 2. priority    — 按 priority 字段降序尝试，失败则降级
 * 3. round_robin — 轮询所有 enabled 的供应商
 * 4. failover    — 默认优先，失败自动切换到下一个 enabled 的
 */

class ProviderRouter {
  constructor(manager) {
    this._manager = manager;
    this._lastUsedIndex = new Map(); // category -> index
  }

  /**
   * 获取下一个可用的 provider
   * @param {string} category
   * @param {string} strategy - default/priority/round_robin/failover
   * @param {string} [excludeId] - 故障转移时排除的 provider ID
   * @returns {object|null} provider config（含 api_key）
   */
  getNext(category, strategy = 'default', excludeId = null) {
    const providers = this._manager.listEnabledProviders(category)
      .filter(p => p.id !== excludeId);

    if (providers.length === 0) return null;

    switch (strategy) {
      case 'default':
        return this._manager.getDefault(category) || providers[0];

      case 'priority':
        return providers.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];

      case 'round_robin': {
        const idx = (this._lastUsedIndex.get(category) || 0) % providers.length;
        this._lastUsedIndex.set(category, idx + 1);
        return providers[idx];
      }

      case 'failover': {
        // 默认优先，排除 excludeId 后取第一个
        const def = this._manager.getDefault(category);
        if (def && def.id !== excludeId) return def;
        return providers[0];
      }

      default:
        return providers[0];
    }
  }

  /**
   * 执行带故障转移的调用
   * @param {string} category
   * @param {Function} fn - async (provider) => result
   * @param {object} options - { maxRetries, strategy }
   */
  async executeWithFailover(category, fn, options = {}) {
    const { maxRetries = 3, strategy = 'failover' } = options;
    let lastError = null;
    let excludeId = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const provider = this.getNext(category, strategy, excludeId);
      if (!provider) {
        throw new Error(`No available provider for category "${category}"`);
      }

      try {
        const result = await fn(provider);
        // 记录成功日志
        this._logCall(provider, 'success');
        return result;
      } catch (e) {
        lastError = e;
        excludeId = provider.id;
        this._logCall(provider, 'error', e.message);
      }
    }

    throw lastError;
  }

  _logCall(provider, status, error = null) {
    // 写入 model_provider_logs 表
  }
}

module.exports = { ProviderRouter };
```

---

## 三、迁移计划（3 阶段，每阶段独立可验证）

### 3.1 阶段总览

| 阶段 | 目标 | 改动范围 | 风险 | 回归验证 |
|------|------|---------|------|---------|
| **P1** | 统一数据源 | 删除 ai-generator.js 的 PROVIDERS，全部从 SQLite 读取 | 低 | 1982 测试全过 |
| **P2** | 密钥加密 | crypto.js + safeStorage + 数据迁移脚本 | 中 | 加密/解密单测 + 现有功能 |
| **P3** | Adapter 抽象 | 逐个供应商迁移到 Adapter 模式 | 中 | 每个 Adapter 单测 + E2E |

### 3.2 P1: 统一数据源（最小改动，快速验证）

**目标**: 消除双轨制，所有供应商数据从 SQLite `model_providers` 表读取。

**改动清单**:
1. `ai-generator.js`:
   - 删除 `PROVIDERS` 硬编码注册表（第 12-52 行）
   - `_initDefaults()` 改为从 `modelProviderManager.listProviders()` 读取
   - 保留 `setModelProviderManager()` 桥接（已有）
2. `model-provider-manager.js`:
   - 新增 `listEnabledProviders(category)` 方法（router.js 需要）
3. 测试: `ai-generator.test.js` 验证从 SQLite 读取

**验收标准**:
- `ai-generator.js` 中不再有任何硬编码供应商列表
- 所有 1982 个现有测试通过
- `modelProviderList()` 返回的供应商数量 = `model-provider-seeds.js` 的预设数量

### 3.3 P2: 密钥加密（安全加固）

**目标**: API Key 使用 Electron safeStorage 加密存储，明文字段清空。

**改动清单**:
1. 新增 `crypto.js`（encrypt/decrypt/mask）
2. `store-schema.js`:
   - 新增 `api_key_enc` BLOB 字段
   - 新增 `priority` INTEGER 字段
   - 新增 `model_provider_logs` 表
3. `model-provider-manager.js`:
   - `createProvider()` / `updateProvider()`: api_key → encrypt → 存 api_key_enc
   - `getProviderWithKey()`: api_key_enc → decrypt → 返回明文
   - `_safeRow()`: 返回 `api_key_masked`（遮罩后的 key，用于显示）
   - 启动时执行 `migrateApiKeyEncryption()` 迁移脚本
4. `ModelProviders.vue`:
   - API Key 输入框改为 password 类型
   - 显示时用遮罩 `sk-****1234`
5. 测试: `crypto.test.js`（encrypt → decrypt 往返测试）

**验收标准**:
- SQLite 中 `api_key` 字段全部为空，`api_key_enc` 存储加密数据
- `decrypt(encrypt(key)) === key` 单测通过
- 现有功能（LLM 调用、TTS 等）正常工作
- `ModelProviders.vue` 显示遮罩 key

### 3.4 P3: Adapter 抽象（供应商扩展性）

**目标**: 每个供应商的 API 差异封装在 Adapter 中，新增供应商只需新增 1 个文件。

**改动清单**:
1. 新增 `adapters/base.js`（IModelProvider 接口）
2. 新增 `adapters/registry.js`（工厂注册表）
3. 逐个迁移供应商（按优先级）:
   - **P3.1**: `openai.js`（LLM，兼容 DeepSeek/Qwen/Doubao）— 覆盖 80% 用量
   - **P3.2**: `anthropic.js`（LLM）
   - **P3.3**: `elevenlabs.js`（TTS）
   - **P3.4**: `flux.js`（图片）
   - **P3.5**: `hunyuan.js`（视频）
4. `model-provider-manager.js`:
   - `testConnection()` 改为调用 `adapter.testConnection()`
   - 新增 `callAdapter(providerId, method, params)` 统一调用入口
5. 新增 `router.js`（路由策略 + 故障转移）
6. 测试: 每个 Adapter 独立单测 + `router.test.js`

**验收标准**:
- `testConnection()` 真正调用供应商 API（不再是占位）
- 新增供应商只需 1 个 Adapter 文件 + 注册 1 行代码
- `router.executeWithFailover()` 故障转移测试通过
- 全量回归测试通过

---

## 四、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| P2 safeStorage 在测试环境不可用 | 中 | 中 | 降级方案：Buffer.from 明文存储 + warn 日志 |
| P3 Adapter 迁移破坏现有 Python bridge | 低 | 高 | P3.1 先验证 LLM 链路（最高用量），保留 Python bridge 作为回退 |
| 数据迁移脚本误删 api_key | 低 | 高 | 迁移前自动备份 SQLite 文件；迁移后验证 decrypt 成功才清空 |
| Electron 升级后 safeStorage API 变化 | 低 | 中 | v43 已验证 safeStorage 可用；添加 isEncryptionAvailable() 检查 |
| Adapter 接口设计过度抽象 | 中 | 中 | 参考 one-api 9 方法接口，不过度设计；YAGNI 原则 |

---

## 五、测试策略

### 5.1 单元测试

| 模块 | 测试文件 | 覆盖率目标 |
|------|---------|-----------|
| crypto.js | crypto.test.js | 100%（encrypt/decrypt/mask 往返） |
| registry.js | registry.test.js | 100%（注册/获取/重复注册异常） |
| router.js | router.test.js | 90%（4 种策略 + 故障转移） |
| openai.js | openai.test.js | 90%（chatCompletion/streamChat/testConnection） |
| manager.js | manager.test.js | 85%（已有测试迁移） |

### 5.2 集成测试

- `testConnection` E2E: 配置真实 API Key → 调用 testConnection → 验证延迟和模型列表
- `executeWithFailover` E2E: 模拟主 provider 超时 → 自动切换到备用 → 验证日志记录

### 5.3 回归门禁

每个阶段完成后的全量回归：
- JS: `vitest run` — 1982 passed / 0 failed
- Python: `pytest` — 2183 passed / 0 failed
- TSC: `tsc --noEmit` — 零错误
- Lint: `ruff check` — 零错误

---

## 七、Phase 1.3 UI 设计审查记录

> **审查日期**: 2026-07-15
> **审查目标**: `apps/desktop/src/views/ModelProviders.vue`（606 行）
> **审查方法**: 7 维度评估（信息层级 / 交互状态 / 响应式 / 可访问性 / 视觉一致性 / 微交互 / 错误处理）
> **门禁标准**: 7.0/10
> **审查结论**: 不通过（综合 4.9/10）— 需 P2 改造后复审
> **完整报告**: [model-provider-ui-review.md](./model-provider-ui-review.md)

### 7.1 综合评分

| 维度 | 评分 | 关键短板 |
|------|------|---------|
| 1. 信息层级 | 6/10 | API Key 明文显示、models 撑高卡片、status 双指示器混淆 |
| 2. 交互状态 | 5/10 | 加载态简陋、步骤无进度、禁用无降级、测试结果无超时 |
| 3. 响应式 | 4/10 | 零 @media、固定宽度对话框、窄屏溢出 |
| 4. 可访问性 | 4/10 | 图标无 aria-label、色盲不友好、无 aria-pressed/current/live |
| 5. 视觉一致性 | 6/10 | 硬编码颜色、颜色语义重复、局部样式未抽取 |
| 6. 微交互 | 4/10 | hover 单薄、硬切多、无 :active、rotating 未验证 |
| 7. 错误处理 | 5/10 | 加密失败未处理、表单验证不足、并发无锁 |
| **综合** | **4.9/10** | **低于 7.0 门禁** |

### 7.2 关键发现汇总（19 项）

**P0 — 安全 和 必须修复（4 项）**：
1. API Key 显示遮罩 sk-****1234（第 74-76 行）
2. safeStorage 不可用时 UI 显示警告横幅
3. 5 个图标按钮补 aria-label（第 85-103 行）
4. status-dot 色盲友好（形状区分，第 52 行）

**P1 — UX 关键（9 项）**：
1. 添加对话框步骤进度指示器
2. 加载状态升级为骨架屏（第 33 行）
3. 禁用卡片视觉降级（opacity 0.6 + grayscale）
4. 表单验证：base_url 格式、API Key 格式提示
5. models 字段截断 + tooltip（第 70 行）
6. 响应式断点 @media (max-width: 768px)
7. card hover 微动效（translateY + border-color）
8. 测试结果超时自动清理（30s 后淡出）
9. 保存成功 toast 反馈

**P2 — 体验提升（6 项）**：
1. 类型 badge 颜色改用 CSS 变量
2. default-badge dark mode 适配
3. 测试结果淡入过渡
4. 步骤切换过渡动画
5. aria 属性补全（aria-pressed / aria-current / aria-live）
6. 测试失败重试按钮

**P3 — 抛光（3 项）**：
1. 测试结果持久化（localStorage）
2. 焦点管理（对话框打开聚焦首输入框）
3. 抽取 category-card / preset-item 到全局 cohere 系统

### 7.3 与设计文档差距

设计文档 P2 阶段原已覆盖 2 项（API Key 遮罩 + safeStorage 警告），本次审查新增 19 项发现。

P2 阶段 UI 改造清单扩展：原设计文档仅标注 API Key 显示遮罩，现扩展为 P0(4) + P1(9) + P2(6) + P3(3) = 22 项完整改造清单。

### 7.4 复审条件

P2 改造完成后需复审，通过条件：
1. P0 全部 4 项修复
2. P1 至少 6/9 项修复
3. 综合评分 >= 7.0/10
4. 响应式 + 可访问性维度各自 >= 6/10

---

## 八、Phase 1.4 DX 设计审查记录

> **审查日期**: 2026-07-15
> **审查目标**: Adapter 抽象设计（2.3 IModelProvider + 2.4 工厂注册表 + 3.4 P3 实施计划）
> **审查方法**: 7 维度评估（上手门槛 / 接口设计 / 错误反馈 / 测试体验 / 文档示例 / 调试支持 / 版本演进）
> **门禁标准**: 7.0/10
> **审查结论**: 不通过（综合 4.9/10）- 需 P3 实施前改进
> **完整报告**: [model-provider-devex-review.md](./model-provider-devex-review.md)

### 8.1 综合评分

| 维度 | 评分 | 关键短板 |
|------|------|---------|
| 1. 上手门槛 | 5/10 | 无脚手架、无模板、无概念图 |
| 2. 接口设计 | 6/10 | 9 方法过度耦合、无默认实现、config 双职责 |
| 3. 错误反馈 | 4/10 | 错误类型未定义、无错误码字典、解密失败静默 |
| 4. 测试体验 | 5/10 | 无 mock 基础设施、无 contract 测试、E2E 依赖真实 key |
| 5. 文档示例 | 5/10 | 无完整 Adapter 示例、无 README、无迁移指南 |
| 6. 调试支持 | 4/10 | 无结构化日志、无 request ID、无调试钩子 |
| 7. 版本演进 | 5/10 | 无接口版本号、无能力协商、无 schema 迁移框架 |
| **综合** | **4.9/10** | **低于 7.0 门禁** |

### 8.2 关键发现汇总（24 项）

**P0 - 必须在 P3 实施前解决（6 项）**：
1. 接口隔离: 拆分 9 方法为 IModelProvider（基础 7 方法）+ ILlmAdapter + ITtsAdapter + IImageAdapter + IVideoAdapter
2. 脚手架命令: npm run new-adapter <name> 自动生成 Adapter + 测试 + 注册代码
3. 错误类型定义: ProviderError 类（code/category/retryable）+ ERROR_CODES 常量
4. 完整 Adapter 示例: 附录 C 提供 openai.js 完整实现
5. mock 基础设施: test-utils.js 含 createMockConfig/assertAdapterContract/MockTransport
6. 接口版本号: IModelProvider.version = 1 + registry 兼容性检查

**P1 - P3 实施时同步解决（9 项）**：
1. base.js 方法体改为抛 NotImplementedError
2. config 参数分离为 credentials + options
3. validateConfig 在 registerAdapter 时自动调用
4. registry 重复注册错误包含已注册文件路径
5. adapters/README.md 目录约定 + 新增流程
6. 现有 PROVIDERS 迁移指南（附录 D）
7. 结构化日志 schema
8. request ID 贯穿 router -> adapter -> log
9. adapter.supports(method) 能力协商

**P2 - 体验提升（6 项）**：
1. adapters/_template.js 模板文件
2. adapter.capabilities() 返回支持的方法列表
3. estimateCost 标注为可选
4. ERROR_CODES 常量字典
5. beforeCall/afterCall/onError 调试钩子
6. adapter.dryRun(method, params) 验证参数

**P3 - 抛光（3 项）**：
1. yeoman/inquirer 交互式生成器
2. OpenTelemetry trace 集成
3. semver 策略 + 兼容性回归测试

### 8.3 与设计文档差距

设计文档已覆盖 3 项（9 方法接口签名、工厂注册表、测试覆盖率目标），本次审查新增 24 项发现。

P3 阶段 Adapter 改造清单扩展：原设计文档仅定义 9 方法接口，现扩展为 P0(6) + P1(9) + P2(6) + P3(3) = 24 项完整 DX 改进清单。

### 8.4 复审条件

P3 实施前需复审，通过条件：
1. P0 全部 6 项修复
2. P1 至少 6/9 项修复
3. 综合评分 >= 7.0/10
4. 接口设计 + 错误反馈 + 测试体验维度各自 >= 6/10

---

## 六、后续待办

- [x] /plan-eng-review 架构审查（本文档，8.7/10 通过 @ 2026-07-15）
- [x] /plan-design-review UI 审查（ModelProviders.vue 改造，4.9/10 需 P2 改造 @ 2026-07-15）
- [x] /plan-devex-review 开发者体验审查（Adapter 开发体验，4.9/10 需 P3 前改进 @ 2026-07-15）
- [ ] P1 实施前补充 TDD 测试用例
- [ ] 评估是否需要 Python 端同步改造（llm_client.py）

---

## 附录 A: 参考项目关键代码引用

### one-api Adaptor 接口（MIT，可直接移植）
- `one-api/relay/adaptor/interface.go` — 9 方法接口定义
- `one-api/model/channel.go` — Channel GORM 数据模型

### APIPark MaskConfig（Apache-2.0）
- `APIPark/ai-provider/model-runtime/provider.go` — IProvider + MaskConfig

### CoAI 工厂注册（Apache-2.0）
- `CoAI/adapter/adapter.go` — 工厂注册表
- `CoAI/channel/manager.go` — PreflightSequence 路由

### new-api TaskAdaptor（AGPLv3，仅参考设计）
- `new-api/relay/channel/adapter.go` — 最丰富适配器接口

---

## 附录 B: 现有文件迁移映射

| 原文件 | 目标文件 | 操作 |
|--------|---------|------|
| `electron/services/model-provider-manager.js` | `electron/services/model-provider/manager.js` | 迁移 + 改造（调用 Adapter） |
| `electron/services/model-provider-seeds.js` | `electron/services/model-provider/seeds.js` | 迁移（无改动） |
| `electron/services/store-schema.js` (model_providers 部分) | `electron/services/model-provider/schema.js` | 迁移 + 新增字段 |
| `electron/services/ai-generator.js` (PROVIDERS) | 删除 | 统一到 SQLite |
| `electron/ipc-handlers/model-provider.js` | 保持不变 | IPC 层不改 |
| `src/api/model-providers.js` | 保持不变 | 前端 API 不改 |
| `src/views/ModelProviders.vue` | P2 改造 | API Key 遮罩 + safeStorage 警告 + aria-label + 响应式 + 骨架屏等 22 项（详见 UI 审查报告） |
| `src/composables/useModelProviderCrud.js` | P2 改造 | 适配遮罩显示 + 表单验证 + 测试结果超时清理 |

---

## 九、模型设置页文案与标签页 UI/UE 规范（2026-09-22 settings-model-tabs-polish）

本节记录「设置 → 模型设置」弹窗（`SettingsDialog.vue` 内嵌 `ModelProviders.vue`）的文案契约与标签页视觉/交互规范，作为显示项、提示文字、交互逻辑的单一真源。

### 9.1 文案契约（i18n，zh/en 成对）

| 位置 | locale key | 显示文案（zh） | 显示文案（en） | 校验/约束 |
|------|-----------|----------------|----------------|-----------|
| 页面副标题 | `modelProviders.pageSubtitle` | 文字推理 / TTS语音 / 语音识别 / 图片生成 / 视频模型 / 音频生成 / 多模态模型 7类 AI 服务商 | Manage 7 types of AI providers: Text Reasoning / TTS / Speech Recognition / Image / Video / Audio / Multimodal | 首项统一为「文字推理」（与能力标签 `capLlm` 术语一致），数量用阿拉伯数字「7类」，禁止「管理推理」「七类」旧写法 |
| 添加按钮 | `modelProviders.addProvider` | + 添加服务商 | + Add Provider | 前缀为**半角 `+` + 一个空格**；全角「＋」禁止；文案中 `+` 只允许出现一次 |

**「++ 添加服务商」双加号根因与修复：**
- 根因：`ModelProviders.vue` 模板在按钮里硬编码了 `＋ {{ t('modelProviders.addProvider') }}`，而 locale 值 `addProvider` 本身又带 `＋` 前缀，两处叠加渲染成「＋＋ 添加服务商」。
- 修复：模板改为纯 `{{ t('modelProviders.addProvider') }}`（去掉硬编码 `＋`），前缀符号统一由 locale 值维护，保证 zh/en 一致且可翻译。
- 回归保护：`src/locales/model-providers-copy.test.js` 断言 ① locale 值等于 `+ 添加服务商` 且只含一个 `+`、无全角＋；② pageSubtitle 含「文字推理」「7类」且不含旧文案；③ 模板不再出现 `＋ {{` 硬编码前缀。

**数据校验要点：**
- locale 成对修改：改 `zh.js` 必须同步改 `en.js`（CI Gate 7 `check-locale-sync.js --pair-base` 拦截）。
- 渲染端 `src/` 非 locales 文件禁止新增中文字面量；符号（`+`）与文案一律进 locale。

### 9.2 设置弹窗标签页 UI/UE 规范（`SettingsDialog.vue` 左侧导航）

**结构**：`UiModal`（size xl，width 1100px）→ 左 `nav.settings-tabs`（宽 200px，纵向）+ 右 `.settings-panel`。

**标签项（自上而下，共 5 项）**：

| key | 文案 | 图标（@element-plus/icons-vue） | 可用状态 |
|-----|------|-------------------------------|---------|
| model | 模型设置 | Connection | 启用（默认激活） |
| general | 通用设置 | Setting | 启用 |
| feishu | 飞书 API | Link | 启用 |
| publish | 发布设置 | Upload | 禁用（徽标「敬请期待」） |
| account | 账号设置 | User | 禁用（徽标「敬请期待」） |

**视觉规范（全部取设计 token，禁止裸色值/裸尺寸，暗色模式覆盖）**：
- 导航容器：背景 `--color-bg-inset`，右边框 `--border-light`，项间距 `gap: 4px`，内边距 16px/12px。
- 标签项：`icon + label + (badge)` 三段式；圆角 `--radius-sm`；字号 `--font-size-sm`；文字色 `--text-muted`；过渡 180ms（background/color/box-shadow）。
- hover（可点击且未激活）：浅主色底 `--primary-light` + 主色文字。
- active：卡片白底 `--color-bg-card` + `--shadow-sm` 浮起 + 主色文字加粗 + 左侧 3px 主色强调条（`::before`）+ 图标 `scale(1.08)` 微放大反馈。
- disabled：`opacity .55` + `cursor: not-allowed`，右侧「敬请期待」胶囊徽标（`--radius-full`，次级底色）。
- 可访问性：`nav` 带 `aria-label`；激活项 `aria-current="true"`；`:focus-visible` 2px 主色外描边（键盘可达）。
- 图标位禁止 emoji（遵循 `icon-usage.test.js` 与 frontend-interaction-spec 图标语义），占位面板图标由 🚧 改为 `Compass` el-icon。

**交互逻辑**：
- 点击标签切换 `activeTab`；禁用项点击直接 return，不切换激活态（回归由 `SettingsDialog.test.js`「点击禁用 Tab 不切换激活态」保护）。
- 面板内容按 `activeTab` 条件渲染对应子组件；未实现项渲染占位面板（图标 + `settings.placeholder`）。

**回归测试覆盖（`src/components/SettingsDialog.test.js`）**：
- 渲染 5 个 Tab、默认激活「模型设置」、禁用项带「敬请期待」徽标且 disabled；
- 点击禁用项不切换；切换到通用设置渲染日志面板；en 语言文案为英文；
- 新增：每个 `.settings-tab` 渲染 `.tab-icon` 图标位（共 5），守护图标不回退。

### 9.3 变更影响面

- 纯前端展示层文案与样式，无 IPC / 数据模型 / 后端改动，无迁移。
- 视觉测试选择器（`button:has-text("添加服务商")`、`.settings-tab`、`.provider-card`）为子串/类名匹配，文案由「＋＋」改「+」及新增图标不影响命中。

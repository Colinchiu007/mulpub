# PRD：Agnes-AI 多模态模型能力显示与能力默认按钮丢失修复（自动获取机制）

**日期**：2026-09-19
**状态**：已实现（分支 `agnes-multimodal-capability-display`）
**关联**：`PRD-AGNES-AI-MULTIMODAL-2026-09-16.md`（Agnes-AI 多模态预设原始 PRD）；`CHANGELOG.md` 2026-09-19 fix 条目
**严重级别**：P1（新功能交付后核心 UI 显示缺失，用户无法看到能力标签、无法设置能力默认）

---

## 1. 背景与问题

PR #1896（2026-09-17 合并）交付了 Agnes-AI 多模态预设（`agnes-multimodal`），种子数据正确声明了 `capabilities: ['llm', 'image', 'video']` 与对应 `capability_models`。但用户在模型设置弹窗 → 模型设置 → 模型列表中看到的现象是：**Agnes-AI 卡片没有像 MiniMax 多模态那样的「能力」显示（文字推理、生图、生成视频标签）和「能力默认」操作按钮**。

### 1.1 根因（第一性原因）

`useModelProviderCrud.js` 的 `submitForm()` 存在数据丢失 bug：

```
selectPreset()                    submitForm()                     后端
─────────────                     ────────────                     ────
form.capabilities = [..]  ──✗──>  data.config = {                  updateProvider()
form.capability_models         capability_enabled: {...}    ──>    config 列整体替换
  = {...}                    }                                    capabilities 丢失
```

1. `selectPreset()`（添加流程步骤 3）把预设的 `capabilities` / `capability_models` 放在 **form 顶层**（仅用于模板展示：能力徽章、视频开关判断）；
2. `submitForm()` 构造上送数据时只序列化 `form.config`，**能力声明从未被写入 config**；
3. 用户通过「添加服务商」配置 Agnes-AI 的 API Key 时，`createProvider` 返回 `PROVIDER_EXISTS`（种子行已存在）→ 前端自动降级调用 `updateProvider`；
4. `updateProvider` 对 config 列做**整体替换**（`config = ?`），行内原有的 `capabilities` / `capability_models`（由 `_seedPresets` / `_syncPresetCapabilities` / `applyCatalog` 写入）被抹掉；
5. `ModelProviders.vue` 的能力 chips 与能力默认按钮渲染条件是 `p.capabilities && p.capabilities.length > 0`（数据驱动）→ capabilities 为空 → **UI 不渲染**。

**MiniMax 未受影响的原因**：其行的能力声明由旧版本 `_syncPresetCapabilities`（2026-09-05 引入）在用户走添加流程**之前**就已回填，且用户此后未再走 MiniMax 的添加/编辑保存流程触发覆盖。

### 1.2 用户诉求（第二层：自动获取机制）

用户要求：新增多模态模型时，只要在代码里声明了能力（seeds 的 `capabilities` / `capability_models`），模型列表中的能力显示与能力默认按钮就应**自动获取**，无需每次手工修改前端代码。

**现状评估**：该机制在架构上已经存在——UI 是纯数据驱动的（`v-if="p.capabilities && p.capabilities.length > 0"`），任何多模态 provider 只要 config 里有能力声明就会自动显示。本次丢失是**数据链路断裂**（submitForm 丢字段），不是 UI 硬编码。修复数据链路即恢复自动获取语义。

## 2. 修复方案

### 2.1 前端修复（`useModelProviderCrud.js` submitForm）

在构造 `userConfig` 后、深拷贝脱壳前，增加能力声明保留逻辑：

```javascript
if (form.value.category === 'multimodal') {
  // form 顶层有能力声明且 config 里没有 → 写入（添加预设路径）
  if (Array.isArray(form.value.capabilities) && form.value.capabilities.length > 0
    && !Array.isArray(userConfig.capabilities)) {
    userConfig.capabilities = [...form.value.capabilities]
  }
  if (form.value.capability_models && typeof form.value.capability_models === 'object'
    && Object.keys(form.value.capability_models).length > 0
    && !(userConfig.capability_models && typeof userConfig.capability_models === 'object')) {
    userConfig.capability_models = { ...form.value.capability_models }
  }
}
```

**合并策略（保守，不覆盖已有值）**：
- config 已有 `capabilities`（运营后台 `applyCatalog` 下发或种子回填）→ **以 config 为准**，不被预设静态种子覆盖；
- config 缺失且 form 顶层有（`selectPreset` 从预设目录带入）→ 写入；
- 两者都无 → 不注入空数组（避免覆盖运营下发的合法空态）。

### 2.2 存量数据自愈（无需迁移脚本）

用户升级到修复版后，`ModelProviderManager.init()` → `_syncPresetCapabilities()` 的 diff-merge 逻辑自动回填：

- `existingCaps = []`（被抹掉）+ 种子 `['llm','image','video']` → `merged` 长度不等 → 写入 `config.capabilities`；
- `existingModels = null` + 种子 `{llm:..., image:..., video:...}` → 逐项填入 → 写入 `config.capability_models`。

即：**用户重启应用即自愈**，无需手工干预。

### 2.3 自动获取机制（既有架构，本次确认无需改动）

```
新增多模态模型（开发者操作）                用户侧自动获取
──────────────────────                    ──────────────
1. seeds.js 声明 capabilities +           应用启动
   capability_models                        │
2. ops-center PRESET_CATALOG 同步声明  ──>  _seedPresets（INSERT OR IGNORE）
3. （可选）注册 Adapter 工厂                _syncPresetCapabilities（diff-merge 回填）
                                           applyCatalog（运营下发，含能力字段）
                                           │
                                           ▼
                                           listProviders → _safeRow
                                           → capabilities: [...config.capabilities]
                                           │
                                           ▼
                                           ModelProviders.vue
                                           v-if="p.capabilities.length > 0"
                                           → 能力 chips + 能力默认按钮 自动渲染
```

开发者只需完成第 1-3 步（声明数据），UI 显示零代码改动。

## 3. 数据校验

### 3.1 前端（submitForm 新增逻辑）

| 校验项 | 规则 | 失败行为 |
|--------|------|---------|
| category | `=== 'multimodal'` 才进入能力保留分支 | 其他类别不受影响 |
| capabilities 来源 | form 顶层 `Array.isArray && length > 0` | 非数组/空数组不注入 |
| capabilities 冲突 | config 已有数组 → 保留 config 值 | 不覆盖运营下发 |
| capability_models 来源 | form 顶层为对象且 `Object.keys().length > 0` | 空对象不注入 |
| capability_models 冲突 | config 已有对象 → 保留 config 值 | 不覆盖运营下发 |

### 3.2 回归测试锁定（`useModelProviderCrud.test.js` 新增 4 用例）

| 用例 | 断言 |
|------|------|
| 保存多模态预设时 config 必须携带能力声明 | `data.config.capabilities` 深等于 `['llm','image','video']`；`capability_models` 深等于三能力映射；`capability_enabled` 不丢失 |
| PROVIDER_EXISTS 降级更新不得抹掉能力声明 | 降级 `updateProvider` 的 `config.capabilities` / `capability_models` 完整 |
| 编辑多模态服务商时能力声明不丢失 | config 原有能力声明原样保留 |
| form 顶层无 capabilities 时不注入空数组 | config 已有 `['llm','tts','image','video']` 原样保留（不被 undefined 覆盖） |

## 4. 交互逻辑与显示项（修复后）

### 4.1 模型列表卡片（Agnes-AI，与 MiniMax 一致）

| 显示项 | 值 | 来源 |
|--------|-----|------|
| 能力标签 | `文字推理` `生图` `生成视频` 三个 chips | `MULTIMODAL_CAPABILITY_LABELS[cap]`（locale `capLlm`/`capImage`/`capVideo`） |
| 能力默认按钮 | 三个可点击 chips，激活态带 ✓ | `toggleCapabilityDefault(p, cap)` → IPC `model-provider:set-capability-default` |
| 激活条件 | `config.capability_defaults.includes(cap) \|\| is_default` | 后端 `setCapabilityDefault` 维护 |
| 点击未激活 chip | 设为该能力默认（清除其他 provider 同能力默认） | 后端 `_clearCapabilityDefaultForCapability` |
| 点击已激活 chip | 取消该能力默认 | 从 `capability_defaults` 移除 |
| 未配置 API Key 时点击 | 提示「请先配置 API Key」 | `notifyWarning('modelProviders.configureFirst')` |

### 4.2 提示文字（既有，无新增）

| 场景 | 文案 |
|------|------|
| 能力默认设置成功 | `能力默认设置成功` |
| 能力默认取消 | `能力默认已取消` |
| 未配置 Key 点击能力默认 | `请先在「模型设置」中配置 API Key` |
| 设为默认确认弹窗 | `将此多模态模型设为默认，会同时将它的所有能力…都设为该能力类型的默认模型…` |

## 5. 测试与验证

- **TDD 红灯**：4 个新回归测试在修复前失败（`data.config.capabilities` 为 `undefined`），精确复现 bug；
- **绿灯**：修复后 `useModelProviderCrud.test.js` 58/58 通过；
- **后端回归**：`model-provider-multimodal.test.js` 26/26 通过；
- **全量套件**：10283 通过 / 1 失败（`accounts-compile.test.js` 的 vite build 测试在全量并行时资源竞争超时；单独跑 6/6 通过，与本次改动无关，预存问题）；
- **存量数据自愈验证**：`_syncPresetCapabilities` diff-merge 逻辑覆盖空 capabilities 回填（代码路径分析确认，用户重启即生效）。

## 6. 影响范围

| 范围 | 影响 |
|------|------|
| 修改文件 | `apps/desktop/src/composables/useModelProviderCrud.js`（+20 行）、`useModelProviderCrud.test.js`（+100 行） |
| 受影响流程 | 添加多模态预设（含 PROVIDER_EXISTS 降级）、编辑多模态服务商 |
| 不受影响 | 非多模态类别（llm/tts/image/video/audio 单类别）、MiniMax 既有行为、能力默认切换 IPC、运营后台目录下发 |
| 存量用户 | 重启应用后 `_syncPresetCapabilities` 自动回填被抹掉的能力声明 |

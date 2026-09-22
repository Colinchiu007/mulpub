<template>
  <div>
    <!-- 页面头部 -->
    <div class="cohere-page-header">
      <div>
        <div class="page-title" data-testid="model-providers-title">{{ t('modelProviders.pageTitle') }}</div>
        <div class="page-subtitle">{{ t('modelProviders.pageSubtitle') }}</div>
      </div>
      <div class="page-actions">
        <button class="cohere-btn-secondary" data-testid="refresh-providers" @click="loadProviders">⟳ {{ t('modelProviders.refresh') }}</button>
        <button class="cohere-btn-primary" data-testid="add-provider" @click="openAdd">{{ t('modelProviders.addProvider') }}</button>
      </div>
    </div>

    <!-- P0: safeStorage 不可用警告横幅 -->
    <div v-if="!safeStorageAvailable" class="safe-storage-warning" role="alert">
      {{ t('modelProviders.safeStorageWarning') }}
    </div>


    <!-- 视图模式 Tab + 分类筛选 -->
    <div class="view-mode-tabs" v-if="!loading">
      <button
        class="view-mode-tab"
        data-testid="view-mode-configured"
        :class="{ active: viewMode === 'configured' }"
        @click="viewMode = 'configured'"
      >
        <span class="tab-icon">✓</span>
        <span>{{ t('modelProviders.configuredTab') }}</span>
        <span class="tab-count">{{ configuredCount }}</span>
      </button>
      <button
        class="view-mode-tab"
        data-testid="view-mode-all"
        :class="{ active: viewMode === 'all' }"
        @click="viewMode = 'all'"
      >
        <span class="tab-icon">📦</span>
        <span>{{ t('modelProviders.allTab') }}</span>
        <span class="tab-count">{{ providers.length }}</span>
      </button>
      <button
        class="cohere-btn-secondary selfcheck-entry"
        data-testid="open-self-check"
        :title="t('modelProviders.selfCheckTitle')"
        @click="openSelfCheck"
      >
{{ t('modelProviders.selfCheck') }}
      </button>
    </div>

    <!-- 分类筛选条 -->
    <div class="cohere-filter-bar" v-if="!loading">
      <button
        v-for="opt in CATEGORY_OPTIONS" :key="opt.value"
        class="filter-chip"
        :class="{ active: filterCategory === opt.value }"
        @click="filterCategory = opt.value"
      >
        <span class="chip-label">{{ opt.label }}</span>
        <span class="chip-count" v-if="opt.value !== 'all'">{{ activeCategoryCounts[opt.value] || 0 }}</span>
        <span class="chip-count" v-else>{{ activeCategoryCounts.all || 0 }}</span>
      </button>
    </div>
    <!-- 内容区 -->
    <div class="cohere-content" style="margin-top: var(--space-lg)">
      <!-- P1: 骨架屏加载（统一 UiSkeleton + styles/skeleton.css 令牌） -->
      <div v-if="loading" class="provider-grid" aria-live="polite" data-testid="model-providers-loading">
        <div v-for="i in 3" :key="'skeleton-' + i" class="provider-card skeleton-card">
          <div class="card-top">
            <UiSkeleton variant="paragraph" :rows="3" />
          </div>
          <div class="card-body">
            <UiSkeleton variant="paragraph" :rows="3" />
          </div>
        </div>
      </div>

      <!-- ===== 已配置模式：引导 + 已配置卡片 + 快速添加 ===== -->
      <template v-else-if="viewMode === 'configured'">
        <!-- 引导状态：一个都没配置 -->
        <EmptyState
          v-if="configuredProviders.length === 0"
          data-testid="model-providers-onboarding-empty"
          icon=""
          :title="t('modelProviders.noProvidersTitle')"
          :description="t('modelProviders.noProvidersHint')"
          :action-text="t('modelProviders.browseAll')"
          @action="viewMode = 'all'"
        />

        <!-- 已配置卡片 -->
        <div v-else>
          <!-- 统计摘要 -->
          <div class="configured-stats">
            <span class="stats-primary">{{ t('modelProviders.configuredStats', { count: configuredCount }) }}</span>
            <span class="stats-separator">·</span>
            <span class="stats-secondary">{{ t('modelProviders.presetsAvailable', { count: unconfiguredPresets.length }) }}</span>
            <span v-if="customProviders.length > 0" class="stats-separator">·</span>
            <span v-if="customProviders.length > 0" class="stats-secondary">{{ t('modelProviders.customCount', { count: customProviders.length }) }}</span>
          </div>
          <div class="provider-grid">
            <div
              v-for="p in filteredProviders" :key="p.id"
              class="provider-card card-configured"
              :class="{ 'card-disabled': !p.enabled }"
            >
              <div class="card-top">
                <div class="card-header">
                  <div class="provider-type-badge" :class="'type-' + p.category">
                    {{ CATEGORY_LABELS[p.category] || p.category }}
                  </div>
                  <div class="card-badges">
                    <span v-if="p.is_default" class="default-badge" :title="t('modelProviders.defaultBadge')">★ {{ t('modelProviders.defaultBadge') }}</span>
                    <span class="configured-badge" :title="t('modelProviders.configuredBadge')">✓ {{ t('modelProviders.configuredBadge') }}</span>
                    <span v-if="!p.is_preset" class="custom-badge" :title="t('modelProviders.customBadge')">{{ t('modelProviders.customBadge') }}</span>
                  </div>
                </div>
                <div class="provider-name">{{ p.name }}</div>
                <div class="provider-id">
                  <code>{{ p.id }}</code>
                  <span class="status-label" :class="p.enabled ? 'enabled' : 'disabled'">
                    {{ p.enabled ? t('modelProviders.enabled') : t('modelProviders.disabled') }}
                  </span>
                </div>
              </div>
              <div class="card-body">
                <div class="provider-field">
                  <span class="field-label">{{ t('modelProviders.baseUrlLabel') }}</span>
                  <span class="field-value mono">{{ p.base_url || '-' }}</span>
                </div>
                <div class="provider-field">
                  <span class="field-label">{{ t('modelProviders.modelsLabel') }}</span>
                  <span class="field-value" :title="(p.models || []).join(', ')">
                    {{ formatModels(p.models) }}
                  </span>
                </div>
                <div class="provider-field">
                  <span class="field-label">{{ t('modelProviders.effectiveDefaultModelLabel') }}</span>
                  <span class="field-value mono">{{ effectiveDefaultModel(p) }}</span>
                </div>
                <div v-if="p.capabilities && p.capabilities.length > 0" class="provider-field">
                  <span class="field-label">{{ t('modelProviders.capabilityLabel') }}</span>
                  <span class="field-value capability-list">
                    <span v-for="cap in p.capabilities" :key="cap" class="capability-chip">{{ MULTIMODAL_CAPABILITY_LABELS[cap] || cap }}</span>
                  </span>
                <!-- 多模态模型：按能力设置默认 -->
                <div v-if="p.category === 'multimodal' && p.capabilities && p.capabilities.length > 0" class="provider-field capability-defaults">
                  <span class="field-label">{{ t('modelProviders.capabilityDefaultLabel') }}</span>
                  <span class="field-value capability-default-toggles">
                    <span
                      v-for="cap in p.capabilities" :key="'def-' + cap"
                      class="capability-default-chip"
                      :class="{ active: ((p.config && Array.isArray(p.config.capability_defaults) ? p.config.capability_defaults : []).includes(cap) || p.is_default) }"
                      @click.stop="toggleCapabilityDefault(p, cap)"
                      :title="((p.config && Array.isArray(p.config.capability_defaults) ? p.config.capability_defaults : []).includes(cap) || p.is_default) ? t('modelProviders.unsetDefault') : t('modelProviders.setDefault')"
                    >
                      {{ MULTIMODAL_CAPABILITY_LABELS[cap] || cap }}
                      <span v-if="((p.config && Array.isArray(p.config.capability_defaults) ? p.config.capability_defaults : []).includes(cap) || p.is_default)" class="capability-default-check">&#10003;</span>
                    </span>
                  </span>
                </div>
                </div>
                <div class="provider-field">
                  <span class="field-label">{{ t('modelProviders.apiKeyLabel') }}</span>
                  <span class="field-value mono configured">
                    {{ p.api_key_masked || (p.is_configured ? t('modelProviders.localNoKey') : (p.api_key ? t('modelProviders.configuredKey') : t('modelProviders.notConfiguredKey'))) }}
                  </span>
                </div>
              </div>
              <div v-if="testResults[p.id]" class="card-test-result" :class="testResults[p.id].success ? 'success' : 'fail'">
                <div class="test-result-line">
                  {{ testResults[p.id].success ? '✅' : '❌' }}
                  {{ testResults[p.id].message }}
                </div>
                <div v-if="testResults[p.id].detail" class="test-detail">{{ testResults[p.id].detail }}</div>
              </div>
              <div class="card-actions">
                <button class="cohere-icon-btn" :aria-label="t('modelProviders.testConnection')" :title="t('modelProviders.testConnection')"
                  @click="testProvider(p.id)" :disabled="!(isProviderConfigured(p))">
                  <span v-if="testingId !== p.id"><el-icon><Lightning /></el-icon></span>
                  <span v-else class="rotating"><el-icon class="rotating"><Loading /></el-icon></span>
                </button>
                <button class="cohere-icon-btn" :aria-label="t('modelProviders.edit')" :title="t('modelProviders.edit')" @click="openEdit(p)">✎</button>
                <button class="cohere-icon-btn" :class="{ 'default-active': p.is_default }"
                  :aria-label="p.is_default ? t('modelProviders.isDefault') : t('modelProviders.setDefault')"
                  :title="p.is_default ? t('modelProviders.isDefault') : t('modelProviders.setDefault')"
                  @click="setDefault(p)"
                  :disabled="!(isProviderConfigured(p))"
                >★</button>
                <button class="cohere-icon-btn cohere-icon-btn-danger"
                  :aria-label="t('modelProviders.delete')" :title="t('modelProviders.delete')" @click="confirmDelete(p)"
                >✕</button>
              </div>
            </div>
          </div>

          <!-- 快速添加区域 -->
          <div v-if="unconfiguredPresets.length > 0" class="quick-add-section">
            <div class="quick-add-header">
              <span class="quick-add-title">{{ t('modelProviders.moreProviders') }}</span>
              <span class="quick-add-meta">{{ t('modelProviders.presetsAvailableMeta', { count: unconfiguredPresets.length }) }}</span>
            </div>
            <div class="quick-add-grid">
              <button
                v-for="p in unconfiguredPresets.slice(0, 12)" :key="p.id"
                class="quick-add-card"
                @click="viewMode = 'all'"
              >
                <span class="quick-add-icon"><el-icon><component :is="categoryIcon(p.category)" /></el-icon></span>
                <span class="quick-add-name">{{ p.name }}</span>
                <span class="quick-add-category">{{ CATEGORY_LABELS[p.category] }}</span>
              </button>
              <button v-if="unconfiguredPresets.length > 12"
                class="quick-add-card quick-add-more"
                @click="viewMode = 'all'"
              >
                <span class="quick-add-icon">···</span>
                <span class="quick-add-name">{{ t('modelProviders.viewAll', { count: unconfiguredPresets.length }) }}</span>
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== 全部服务商模式：平铺展示 ===== -->
      <template v-else>
        <EmptyState
          v-if="filteredProviders.length === 0"
          data-testid="model-providers-empty"
          icon="🔌"
          :title="t('modelProviders.noProvidersEmpty')"
          :description="t('modelProviders.noProvidersEmptyHint')"
          :action-text="t('modelProviders.addProvider')"
          @action="openAdd"
        />
        <div v-else class="provider-grid">
          <div
            v-for="p in filteredProviders" :key="p.id"
            class="provider-card"
            :class="{ 'card-disabled': !p.enabled }"
          >
            <div class="card-top">
              <div class="card-header">
                <div class="provider-type-badge" :class="'type-' + p.category">
                  {{ CATEGORY_LABELS[p.category] || p.category }}
                </div>
                <div class="card-badges">
                  <span v-if="p.is_default" class="default-badge" :title="t('modelProviders.defaultBadge')">★ {{ t('modelProviders.defaultBadge') }}</span>
                  <span v-if="isProviderConfigured(p)" class="configured-badge" :title="t('modelProviders.configuredBadge')">✓ {{ t('modelProviders.configuredBadge') }}</span>
                  <span v-if="!p.is_preset" class="custom-badge" :title="t('modelProviders.customBadge')">{{ t('modelProviders.customBadge') }}</span>
                  <span v-if="p.is_preset && !(isProviderConfigured(p))" class="preset-badge" :title="t('modelProviders.presetBadge')">{{ t('modelProviders.presetBadge') }}</span>
                </div>
              </div>
              <div class="provider-name">{{ p.name }}</div>
              <div class="provider-id">
                <code>{{ p.id }}</code>
                <span class="status-label" :class="p.enabled ? 'enabled' : 'disabled'">
                  {{ p.enabled ? t('modelProviders.enabled') : t('modelProviders.disabled') }}
                </span>
              </div>
            </div>
            <div class="card-body">
              <div class="provider-field">
                <span class="field-label">{{ t('modelProviders.baseUrlLabel') }}</span>
                <span class="field-value mono">{{ p.base_url || '-' }}</span>
              </div>
              <div class="provider-field">
                <span class="field-label">{{ t('modelProviders.modelsLabel') }}</span>
                <span class="field-value" :title="(p.models || []).join(', ')">
                  {{ formatModels(p.models) }}
                </span>
              </div>
              <!-- 多模态模型：能力列表 -->
              <div v-if="p.category === 'multimodal' && p.capabilities && p.capabilities.length > 0" class="provider-field">
                <span class="field-label">{{ t('modelProviders.capabilityLabel') }}</span>
                <span class="field-value capability-list">
                  <span v-for="cap in p.capabilities" :key="cap" class="capability-chip">{{ MULTIMODAL_CAPABILITY_LABELS[cap] || cap }}</span>
                </span>
              </div>
              <!-- 多模态模型：按能力设置默认 -->
              <div v-if="p.category === 'multimodal' && p.capabilities && p.capabilities.length > 0" class="provider-field capability-defaults">
                <span class="field-label">{{ t('modelProviders.capabilityDefaultLabel') }}</span>
                <span class="field-value capability-default-toggles">
                  <span
                    v-for="cap in p.capabilities" :key="'def-' + cap"
                    class="capability-default-chip"
                    :class="{ active: ((p.config && Array.isArray(p.config.capability_defaults) ? p.config.capability_defaults : []).includes(cap) || p.is_default) }"
                    @click.stop="toggleCapabilityDefault(p, cap)"
                    :title="((p.config && Array.isArray(p.config.capability_defaults) ? p.config.capability_defaults : []).includes(cap) || p.is_default) ? t('modelProviders.unsetDefault') : t('modelProviders.setDefault')"
                  >
                    {{ MULTIMODAL_CAPABILITY_LABELS[cap] || cap }}
                    <span v-if="((p.config && Array.isArray(p.config.capability_defaults) ? p.config.capability_defaults : []).includes(cap) || p.is_default)" class="capability-default-check">&#10003;</span>
                  </span>
                </span>
              </div>
              <div class="provider-field">
                <span class="field-label">{{ t('modelProviders.apiKeyLabel') }}</span>
                <span class="field-value mono" :class="(isProviderConfigured(p)) ? 'configured' : 'not-configured'">
                  {{ p.api_key_masked || (p.is_configured ? t('modelProviders.localNoKey') : (p.api_key ? t('modelProviders.configuredKey') : t('modelProviders.notConfiguredKey'))) }}
                </span>
              </div>
            </div>
            <div v-if="testResults[p.id]" class="card-test-result" :class="testResults[p.id].success ? 'success' : 'fail'">
              <div class="test-result-line">
                {{ testResults[p.id].success ? '✅' : '❌' }}
                {{ testResults[p.id].message }}
              </div>
              <div v-if="testResults[p.id].detail" class="test-detail">{{ testResults[p.id].detail }}</div>
            </div>
            <div class="card-actions">
              <button class="cohere-icon-btn" :aria-label="t('modelProviders.testConnection')" :title="t('modelProviders.testConnection')"
                @click="testProvider(p.id)" :disabled="!(isProviderConfigured(p))">
                <span v-if="testingId !== p.id"><el-icon><Lightning /></el-icon></span>
                <span v-else class="rotating"><el-icon class="rotating"><Loading /></el-icon></span>
              </button>
              <button class="cohere-icon-btn" :aria-label="t('modelProviders.edit')" :title="t('modelProviders.edit')" @click="openEdit(p)">✎</button>
              <button class="cohere-icon-btn" :class="{ 'default-active': p.is_default }"
                :aria-label="p.is_default ? t('modelProviders.isDefault') : t('modelProviders.setDefault')"
                :title="p.is_default ? t('modelProviders.isDefault') : t('modelProviders.setDefault')"
                @click="setDefault(p)"
                :disabled="!(isProviderConfigured(p))"
              >★</button>
              <button class="cohere-icon-btn cohere-icon-btn-danger"
                :aria-label="t('modelProviders.delete')" :title="t('modelProviders.delete')" @click="confirmDelete(p)"
              >✕</button>
            </div>
          </div>
        </div>
      </template>
    </div>
    <!-- 添加服务商对话框（多步骤） -->
    <el-dialog v-model="showAddDialog" :title="t('modelProviders.addDialogTitle')" class="responsive-dialog" :close-on-click-modal="false">
      <!-- P1: 步骤进度指示器 -->
      <div class="step-progress">
        <div v-for="n in 3" :key="n" class="step-indicator" :class="{ active: addStep >= n, current: addStep === n }">
          <span class="step-number">{{ n }}</span>
          <span class="step-text">{{ [t('modelProviders.stepChooseCategory'), t('modelProviders.stepChoosePreset'), t('modelProviders.stepFillConfig')][n - 1] }}</span>
        </div>
      </div>

      <!-- 步骤 1: 选择类别 -->
      <div v-if="addStep === 1" class="add-step">
        <p class="step-hint">{{ t('modelProviders.step1Hint') }}</p>
        <div class="category-grid">
          <button
            v-for="opt in CATEGORY_OPTIONS.filter(o => o.value !== 'all')" :key="opt.value"
            class="category-card" :class="{ active: addCategory === opt.value }"
            @click="addCategory = opt.value"
          >
            <span class="category-icon"><el-icon><component :is="categoryIcon(opt.value)" /></el-icon></span>
            <span class="category-label">{{ opt.label }}</span>
          </button>
        </div>
      </div>

      <!-- 步骤 2: 选择预设或自定义 -->
      <div v-if="addStep === 2" class="add-step">
        <p class="step-hint">{{ t('modelProviders.step2Hint') }}</p>
        <div v-if="availablePresets.length > 0" class="preset-grid">
          <button
            v-for="preset in availablePresets" :key="preset.id"
            class="preset-card" :class="{ active: addPresetId === preset.id }"
            @click="selectPreset(preset.id)"
          >
            <div class="preset-card-name">{{ preset.name }}</div>
            <div class="preset-card-url">{{ preset.base_url || '本地' }}</div>
            <div class="preset-card-models">{{ (preset.models || []).length }} 个模型</div>
            <div v-if="preset.capabilities && preset.capabilities.length > 0" class="preset-card-capabilities">
              <span v-for="cap in preset.capabilities" :key="cap" class="capability-chip">{{ MULTIMODAL_CAPABILITY_LABELS[cap] || cap }}</span>
            </div>
          </button>
        </div>
        <div v-else class="no-presets">{{ t('modelProviders.noPresets') }}</div>
        <div class="divider">{{ t('modelProviders.or') }}</div>
        <button class="preset-card custom" :class="{ active: isCustomAdd }" @click="selectCustom">
          <div class="preset-card-name">{{ t('modelProviders.customProvider') }}</div>
          <div class="preset-card-url">{{ t('modelProviders.customProviderHint') }}</div>
        </button>
      </div>

      <!-- 步骤 3: 填写配置 -->
      <div v-if="addStep === 3" class="add-step">
        <p class="step-hint">{{ t('modelProviders.step3Hint') }}</p>
        <div class="form-fields">
          <label class="input-label">{{ t('modelProviders.idLabel') }}</label>
          <input class="input" v-model="form.id" :placeholder="t('modelProviders.idPlaceholder')" :disabled="!!addPresetId" />
          <label class="input-label">{{ t('modelProviders.nameLabel') }}</label>
          <input class="input" v-model="form.name" :placeholder="t('modelProviders.namePlaceholder')" />
          <template v-if="form.category !== 'multimodal'">
            <label class="input-label">{{ t('modelProviders.baseUrlLabel2') }}</label>
            <input class="input" v-model="form.base_url" :placeholder="t('modelProviders.baseUrlPlaceholder2')" />
          </template>
          <template v-if="form.id === 'doubao-tts' || form.id === 'doubao-stt'">
            <label class="input-label">{{ t('modelProviders.doubaoAppId') }}</label>
            <input class="input" v-model.trim="form.config.appId" :placeholder="t('modelProviders.doubaoAppIdPlaceholder')" />
          </template>
          <label class="input-label">{{ form.id === 'doubao-tts' || form.id === 'doubao-stt' ? t('modelProviders.doubaoAccessToken') : t('modelProviders.apiKeyLabel2') }}</label>
          <input class="input" v-model="form.api_key" type="password" :placeholder="form.id === 'doubao-tts' || form.id === 'doubao-stt' ? t('modelProviders.accessTokenPlaceholder') : t('modelProviders.apiKeyPlaceholder2')" />
          <template v-if="form.category === 'multimodal'">
            <div class="form-hint">{{ t('modelProviders.multimodalHint', { caps: (form.capabilities || []).map(cap => MULTIMODAL_CAPABILITY_LABELS[cap] || cap).join(' / ') || '—' }) }}</div>
            <label v-if="(form.capabilities || (form.config && form.config.capabilities) || []).includes('video')" class="multimodal-preference" title="部分多模态套餐（如 MiniMax 特殊套餐）不支持视频生成。开启后该模型才参与视频模型默认解析；关闭时视频默认使用独立视频模型（如 Agnes Video）。">
              <input type="checkbox" v-model="multimodalVideoEnabled" />
              <span>支持生成视频（默认关闭）</span>
            </label>
          </template>
          <template v-if="isMiniMaxMultimodal">
            <div class="form-hint">{{ t('modelProviders.multimodalModelsHint') }}</div>
            <div class="form-hint muted-hint">{{ t('modelProviders.currentModels', { models: form.modelsText || '—' }) }}</div>
          </template>
          <template v-if="addPresetId">
            <div class="form-hint muted-hint">{{ t('modelProviders.currentModels', { models: form.modelsText || '—' }) }}</div>
            <div class="form-hint muted-hint">{{ t('modelProviders.opsReadonlyHint') }}</div>
          </template>
          <template v-else-if="form.models.length === 1">
            <div class="form-hint">{{ t('modelProviders.singleModelHint', { models: form.modelsText }) }}</div>
            <div v-if="syncConfigured && isPresetEditing" class="form-hint muted-hint">{{ t('modelProviders.syncManagedModelsHint') }}</div>
          </template>
          <template v-else>
            <label class="input-label">{{ t('modelProviders.modelsLabel2') }}</label>
            <input class="input" v-model="form.modelsText" placeholder="model-1, model-2" />
          </template>
          <div v-if="form.models.length > 0" class="form-field">
            <label class="input-label">{{ t('modelProviders.userDefaultModelLabel') }}</label>
            <el-select v-model="form.user_default_model" clearable
              :placeholder="t('modelProviders.userDefaultModelPlaceholder')" class="w-full">
              <el-option v-for="m in form.models" :key="m" :label="m" :value="m" />
            </el-select>
            <div class="form-hint muted-hint">{{ t('modelProviders.userDefaultModelHint') }}</div>
          </div>
          <div class="form-hint">限流策略（每分钟连接次数 / 5小时限额次数）由运营后台同步下发或使用服务商默认值，无需在此填写。</div>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <button class="cohere-btn-secondary" @click="showAddDialog = false">{{ t('modelProviders.cancel') }}</button>
          <button v-if="addStep > 1" class="cohere-btn-secondary" @click="addStep--">上一步</button>
          <button v-if="addStep < 3" class="cohere-btn-primary" @click="nextAddStep" :disabled="addStep === 1 && !addCategory">下一步</button>
          <button v-if="addStep === 3" class="cohere-btn-primary" @click="submitForm" :disabled="submitting">
            {{ submitting ? t('modelProviders.saving') : t('modelProviders.save') }}
          </button>
        </div>
      </template>
    </el-dialog>

    <!-- 编辑对话框 -->
    <el-dialog v-model="showFormDialog" title="编辑服务商" class="responsive-dialog">
      <div class="form-fields">
        <label class="input-label">{{ t('modelProviders.nameLabel') }}</label>
        <input class="input" v-model="form.name" />
        <template v-if="form.category !== 'multimodal'">
          <label class="input-label">{{ t('modelProviders.baseUrlLabel2') }}</label>
          <input class="input" v-model="form.base_url" />
        </template>
        <template v-if="form.id === 'doubao-tts' || form.id === 'doubao-stt'">
          <label class="input-label">{{ t('modelProviders.doubaoAppId') }}</label>
          <input class="input" v-model.trim="form.config.appId" :placeholder="t('modelProviders.doubaoAppIdPlaceholder')" />
        </template>
        <label class="input-label">{{ form.id === 'doubao-tts' || form.id === 'doubao-stt' ? t('modelProviders.doubaoAccessToken') : t('modelProviders.apiKeyLabel2') }}</label>
        <input class="input" v-model="form.api_key" type="password" :placeholder="form.id === 'doubao-tts' || form.id === 'doubao-stt' ? '留空保持原 Token' : '留空保持不变'" />
        <template v-if="form.category === 'multimodal' && ((form.capabilities || (form.config && form.config.capabilities) || []).includes('video'))">
          <label class="multimodal-preference" title="部分多模态套餐（如 MiniMax 特殊套餐）不支持视频生成。开启后该模型才参与视频模型默认解析；关闭时视频默认使用独立视频模型（如 Agnes Video）。">
            <input type="checkbox" v-model="multimodalVideoEnabled" />
            <span>支持生成视频（默认关闭）</span>
          </label>
        </template>
        <template v-if="isMiniMaxMultimodal || (isPresetEditing && form.models.length > 1)">
          <div v-if="isMiniMaxMultimodal" class="form-hint">{{ t('modelProviders.multimodalModelsHint') }}</div>
          <div class="form-hint muted-hint">{{ t('modelProviders.currentModels', { models: form.modelsText || '—' }) }}</div>
          <div class="form-hint muted-hint">{{ t('modelProviders.opsReadonlyHint') }}</div>
        </template>
        <template v-else-if="form.models.length === 1">
          <div class="form-hint">{{ t('modelProviders.singleModelHint', { models: form.modelsText }) }}</div>
          <div v-if="syncConfigured && isPresetEditing" class="form-hint muted-hint">{{ t('modelProviders.syncManagedModelsHint') }}</div>
        </template>
        <template v-else>
          <label class="input-label">{{ t('modelProviders.modelsLabel2') }}</label>
          <input class="input" v-model="form.modelsText" :disabled="syncConfigured && isPresetEditing" />
          <div v-if="syncConfigured && isPresetEditing" class="form-hint muted-hint">{{ t('modelProviders.opsReadonlyHint') }}</div>
        </template>
        <div v-if="form.models.length > 0" class="form-field">
          <label class="input-label">{{ t('modelProviders.userDefaultModelLabel') }}</label>
          <el-select v-model="form.user_default_model" clearable
            :placeholder="t('modelProviders.userDefaultModelPlaceholder')" class="w-full">
            <el-option v-for="m in form.models" :key="m" :label="m" :value="m" />
          </el-select>
          <div class="form-hint muted-hint">{{ t('modelProviders.userDefaultModelHint') }}</div>
        </div>
        <div class="form-hint">{{ t('modelProviders.ratePerMinuteLabel') }}：{{ form.config.rate_per_minute ?? t('modelProviders.notConfiguredRate') }}</div>
        <div class="form-hint">{{ t('modelProviders.limitPer5hLabel') }}：{{ form.config.limit_per_5h ?? t('modelProviders.notConfiguredRate') }}</div>
        <div class="form-hint muted-hint">{{ t('modelProviders.rateHint') }}</div>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <button class="cohere-btn-secondary" @click="showFormDialog = false">{{ t('modelProviders.cancel') }}</button>
          <button class="cohere-btn-primary" @click="submitForm" :disabled="submitting">
            {{ submitting ? t('modelProviders.saving') : t('modelProviders.save') }}
          </button>
        </div>
      </template>
    </el-dialog>

    <!-- 删除确认对话框 -->
    <el-dialog v-model="showDeleteDialog" :title="t('modelProviders.deleteDialogTitle')" class="responsive-dialog-sm">
      <p>{{ t('modelProviders.deleteConfirmText', { name: deleteTarget?.name }) }}</p>
      <p style="font-size: var(--font-size-sm);color:var(--muted)">
        {{ t('modelProviders.deleteIrreversible') }}
        <template v-if="deleteTarget?.is_preset">{{ t('modelProviders.presetDeleteHint') }}</template>
      </p>
      <template #footer>
        <div class="dialog-footer">
          <button class="cohere-btn-secondary" @click="showDeleteDialog = false">{{ t('modelProviders.cancel') }}</button>
          <button class="cohere-btn-danger" @click="doDelete" :disabled="submitting">
            {{ submitting ? t('modelProviders.deleting') : t('modelProviders.confirmDelete') }}
          </button>
        </div>
      </template>
    </el-dialog>

    <!-- 限流自检（P2）：真实 governor + 假 adapter，零额度零网络 -->
    <el-dialog v-model="showSelfCheckDialog" :title="t('modelProviders.selfCheckDialogTitle')" class="responsive-dialog-sm">
      <p style="font-size: var(--font-size-sm);color:var(--muted);margin-bottom:12px">
        {{ t('modelProviders.selfCheckHint') }}
      </p>
      <div class="selfcheck-form">
        <div class="selfcheck-row"><label>{{ t('modelProviders.rpmLabel') }}</label><el-input-number v-model="selfCheckForm.rpm" :min="1" :max="100000" /></div>
        <div class="selfcheck-row"><label>{{ t('modelProviders.maxConcurrentLabel') }}</label><el-input-number v-model="selfCheckForm.maxConcurrent" :min="1" :max="8" /></div>
        <div class="selfcheck-row"><label>{{ t('modelProviders.requestCountLabel') }}</label><el-input-number v-model="selfCheckForm.requestCount" :min="1" :max="1000" /></div>
        <div class="selfcheck-row"><label>{{ t('modelProviders.requestDurationLabel') }}</label><el-input-number v-model="selfCheckForm.requestDurationMs" :min="0" :max="60000" /></div>
        <div class="selfcheck-row"><label>{{ t('modelProviders.inject429Label') }}</label><el-input-number v-model="selfCheckForm.inject429At" :min="1" :max="1000" /></div>
        <div class="selfcheck-row"><label>{{ t('modelProviders.limitPer5hLabel2') }}</label><el-input-number v-model="selfCheckForm.limitPer5h" :min="1" :max="10000000" /></div>
      </div>
      <div v-if="selfCheckRunning" style="color:var(--muted);font-size: var(--font-size-sm)">{{ t('modelProviders.selfCheckRunning') }}</div>
      <div v-if="selfCheckResult" style="margin-top:12px">
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px">
          <span>{{ t('modelProviders.maxConcurrent') }}：<b>{{ selfCheckResult.data.metrics.max_concurrent_observed }}</b></span>
          <span>{{ t('modelProviders.rateLimited') }}：<b>{{ selfCheckResult.data.metrics.rate_limited_count }}</b></span>
          <span>{{ t('modelProviders.quotaExceeded') }}：<b>{{ selfCheckResult.data.metrics.quota_exceeded_count }}</b></span>
          <span>{{ t('modelProviders.totalDuration') }}：<b>{{ selfCheckResult.data.metrics.total_duration_ms }}ms</b></span>
        </div>
        <div v-for="a in selfCheckResult.data.assertions" :key="a.name" style="display:flex;gap:8px;align-items:center;font-size: var(--font-size-sm);padding:2px 0">
          <el-tag :type="a.pass ? 'success' : 'danger'" size="small">{{ a.pass ? t('modelProviders.passTag') : t('modelProviders.failTag') }}</el-tag>
          <span>{{ a.name }}：{{ a.message }}</span>
        </div>
        <div v-if="selfCheckReportMsg" style="margin-top:6px;font-size: var(--font-size-sm);color:var(--primary)">{{ selfCheckReportMsg }}</div>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <button class="cohere-btn-secondary" @click="showSelfCheckDialog = false">{{ t('modelProviders.close') }}</button>
          <button class="cohere-btn-secondary" @click="runSelfCheck" :disabled="selfCheckRunning">{{ t('modelProviders.runSelfCheck') }}</button>
          <button class="cohere-btn-primary" @click="reportSelfCheck" :disabled="!selfCheckResult || selfCheckRunning">{{ t('modelProviders.reportSelfCheck') }}</button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { Bell, Box, Connection, Cpu, Lightning, Loading, Microphone, Picture, Service, VideoCamera } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getApi } from '@/api/electron-bridge'
import { useModelProviderCrud } from '@/composables/useModelProviderCrud'
import { useOpsCenterSync } from '@/composables/useOpsCenterSync'

const { t } = useI18n()

// 编辑中的服务商是否为预设（预设行的模型/限流由运营后台同步下发，字段只读）
const isPresetEditing = computed(() => {
  const p = providers.value.find(item => item.id === form.value.id)
  return p ? p.is_preset === true : false
})

const {
  CATEGORY_OPTIONS,
  CATEGORY_LABELS,
  MULTIMODAL_CAPABILITY_LABELS,
  providers,
  loading,
  submitting,
  filterCategory,
  viewMode,
  testResults,
  testingId,
  safeStorageAvailable,
  multimodalVideoEnabled,
  isMiniMaxMultimodal,
  showFormDialog,
  isEditing,
  form,
  showDeleteDialog,
  deleteTarget,
  showAddDialog,
  addStep,
  addCategory,
  addPresetId,
  availablePresets,
  isCustomAdd,
  filteredProviders,
  configuredCount,
  configuredProviders,
  unconfiguredPresets,
  customProviders,
  presetCount,
  activeCategoryCounts,
  isProviderConfigured,
  loadProviders,
  openAdd,
  nextAddStep,
  selectPreset,
  selectCustom,
  openEdit,
  submitForm,
  confirmDelete,
  doDelete,
  toggleEnabled,
  setDefault,
  toggleCapabilityDefault,
  testProvider,
} = useModelProviderCrud()

// 运营同步对用户透明：配置卡片已隐藏；此处仅保留只读门控所需的 syncConfigured（同步下来的官方模型列表不可手改）
const { syncConfigured } = useOpsCenterSync()

// ─── P2 限流自检：真实 governor + 假 adapter（零额度零网络） ───
const showSelfCheckDialog = ref(false)
const selfCheckRunning = ref(false)
const selfCheckResult = ref(null)
const selfCheckReportMsg = ref('')
const selfCheckForm = ref({
  rpm: 20,
  maxConcurrent: null,
  requestCount: 10,
  requestDurationMs: 100,
  inject429At: null,
  limitPer5h: null,
})

function openSelfCheck () {
  selfCheckResult.value = null
  selfCheckReportMsg.value = ''
  showSelfCheckDialog.value = true
}

async function runSelfCheck () {
  selfCheckRunning.value = true
  selfCheckReportMsg.value = ''
  try {
    if (!getApi() || typeof getApi().rateLimitSelfCheck !== 'function') {
      ElMessage.warning(t('modelProviders.noElectronApiSelfCheck'))
      return
    }
    const res = await getApi().rateLimitSelfCheck({
      ...selfCheckForm.value,
      maxConcurrent: selfCheckForm.value.maxConcurrent || null,
      inject429At: selfCheckForm.value.inject429At || null,
      limitPer5h: selfCheckForm.value.limitPer5h || null,
    })
    if (res.code !== 0) {
      ElMessage.error(res.message || t('modelProviders.selfCheckFailed'))
      return
    }
    selfCheckResult.value = res
    const pass = res.data.assertions.filter(a => a.pass).length
    ElMessage.success(t('modelProviders.selfCheckDone', { pass, total: res.data.assertions.length }))
  } catch (e) {
    ElMessage.error(t('modelProviders.selfCheckFailedDetail', { msg: e.message || e }))
  } finally {
    selfCheckRunning.value = false
  }
}

async function reportSelfCheck () {
  if (!selfCheckResult.value) return
  try {
    if (!getApi() || typeof getApi().rateLimitReport !== 'function') {
      ElMessage.warning(t('modelProviders.noElectronApiReport'))
      return
    }
    const res = await getApi().rateLimitReport({
      preset_id: null,
      params: { ...selfCheckForm.value },
      result: selfCheckResult.value.data,
    })
    if (res.code !== 0) {
      ElMessage.error(res.message || t('modelProviders.reportFailed'))
      return
    }
    selfCheckReportMsg.value = t('modelProviders.reportDone', { id: res.run_id })
    ElMessage.success(t('modelProviders.reportSuccess'))
  } catch (e) {
    ElMessage.error(t('modelProviders.reportFailedDetail', { msg: e.message || e }))
  }
}

// T1-5：分类图标改用 @element-plus/icons-vue（返回组件对象，模板 <component :is> 渲染）
function categoryIcon (cat) {
  const icons = { llm: Cpu, tts: Bell, speech_recognition: Microphone, image: Picture, video: VideoCamera, audio: Service, multimodal: Connection }
  return icons[cat] || Box
}

// P1: models 截断显示 — 最多 3 个，其余 +N
function formatModels (models) {
  if (!models || models.length === 0) return '-'
  if (models.length <= 3) return models.join(', ')
  return models.slice(0, 3).join(', ') + ' +' + (models.length - 3)
}

// 当前生效默认模型（双默认语义 2026-08-27）：用户选择 > 运营预设 > 能力默认（多模态）> 首个模型
function effectiveDefaultModel (p) {
  const models = Array.isArray(p.models) ? p.models : []
  const cfg = p.config && typeof p.config === 'object' ? p.config : {}
  const user = typeof cfg.user_default_model === 'string' ? cfg.user_default_model.trim() : ''
  if (user && models.includes(user)) return user
  const ops = typeof cfg.default_model === 'string' ? cfg.default_model.trim() : ''
  if (ops && models.includes(ops)) return ops
  if (p.category === 'multimodal') {
    const cap = p.capabilities && p.capabilities[0]
    const byCap = p.capability_models && cap ? p.capability_models[cap] : ''
    return byCap || '—'
  }
  return models[0] || '—'
}

onMounted(() => {
  loadProviders()
})
</script>

<style scoped>
/* P0: safeStorage 警告横幅 */
.safe-storage-warning {
  background: #fff3e0;
  color: #e65100;
  padding: 10px var(--space-xxl);
  font-size: var(--font-size-sm);
  font-weight: 500;
  border-bottom: 1px solid #ffcc80;
}
[data-theme="dark"] .safe-storage-warning {
  background: #3c2a1a;
  color: #ffb74d;
  border-bottom-color: #5d4037;
}

/* 多模态优先开关 */
.multimodal-preference {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  color: var(--text, #333);
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e2e2e2);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.multimodal-preference input {
  accent-color: var(--primary, #1a73e8);
  cursor: pointer;
}

/* 多模态能力标签 */
.capability-chip {
  display: inline-block;
  background: #ede7f6;
  color: #5e35b1;
  border-radius: 4px;
  padding: 1px 7px;
  font-size: var(--font-size-xs);
  margin-right: 4px;
  white-space: nowrap;
}
[data-theme="dark"] .capability-chip {
  background: #311b4d;
  color: #b39ddb;
}
.preset-card-capabilities {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.capability-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

/* Provider 卡片网格 */
.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: var(--space-lg);
  padding: var(--space-lg) var(--space-xxl);
}

.provider-card {
  background: var(--canvas, var(--surface));
  border: 1px solid var(--hairline, var(--border));
  border-radius: 12px;
  overflow: hidden;
  transition: box-shadow 0.15s, transform 0.15s, border-color 0.15s;
}
/* P1: card hover 微动效 */
.provider-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  transform: translateY(-2px);
  border-color: var(--primary, #1a73e8);
}
/* P1: 禁用卡片视觉降级 */
.provider-card.card-disabled {
  opacity: 0.6;
  filter: grayscale(0.5);
}

/* P1: 骨架屏外壳（骨块外观统一由 UiSkeleton + styles/skeleton.css 提供） */
.skeleton-card {
  pointer-events: none;
}

.card-top {
  padding: var(--space-lg);
  border-bottom: 1px solid var(--hairline, var(--border));
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-sm);
}

.card-badges {
  display: flex;
  align-items: center;
  gap: 8px;
}

.provider-type-badge {
  font-size: var(--font-size-xs);
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 20px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.type-llm { background: var(--primary-light); color: #1a73e8; }
.type-tts { background: #fff3e0; color: #e65100; }
.type-speech_recognition { background: #e8f5e9; color: #2e7d32; }
.type-image { background: #e6f4ea; color: #137333; }
.type-video { background: var(--secondary-light); color: #d93025; }
.type-audio { background: #f3e5f5; color: #7b1fa2; }

[data-theme="dark"] .type-llm { background: #1a3a5c; color: #8ab4f8; }
[data-theme="dark"] .type-tts { background: #3c2a1a; color: #ffb74d; }
[data-theme="dark"] .type-speech_recognition { background: #1a3c1a; color: #81c995; }
[data-theme="dark"] .type-image { background: #1a3c2a; color: #81c995; }
[data-theme="dark"] .type-video { background: #3c1a1a; color: #f28b82; }
[data-theme="dark"] .type-audio { background: #2a1a2e; color: #ce93d8; }

.default-badge {
  font-size: var(--font-size-xs);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
  background: #ffd700;
  color: #333;
}

.provider-name {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--ink, #222);
  margin-bottom: 4px;
}

.provider-id {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  color: var(--muted, var(--text-muted));
}
.provider-id code {
  font-size: var(--font-size-xs);
  background: var(--soft-stone, var(--bg));
  padding: 1px 6px;
  border-radius: 4px;
}

/* P0: 色盲友好 status-dot — 用形状+颜色双重区分 */
.status-dot-icon {
  font-size: var(--font-size-sm);
  line-height: 1;
  display: inline-block;
}
.status-dot-icon.configured { color: #34a853; }
.status-dot-icon.not-configured { color: #999; }

.status-label {
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  border-radius: 4px;
}
.status-label.enabled { color: #34a853; }
.status-label.disabled { color: #999; }

.card-body {
  padding: var(--space-md) var(--space-lg);
}

.provider-field {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  font-size: var(--font-size-sm);
}
.provider-field:last-child { margin-bottom: 0; }

.field-label {
  color: var(--muted, var(--text-muted));
  flex-shrink: 0;
  min-width: 70px;
}
.field-value {
  color: var(--ink, #222);
  word-break: break-all;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
}
.field-value.mono {
  font-family: 'SF Mono', 'JetBrains Mono', monospace;
  font-size: var(--font-size-xs);
}
.field-value.configured { color: #34a853; font-weight: 500; }
.field-value.not-configured { color: #999; }

/* 测试结果条 */
.card-test-result {
  padding: 8px var(--space-lg);
  font-size: var(--font-size-sm);
}
.card-test-result.success { background: #e6f4ea; color: #137333; }
.card-test-result.fail { background: var(--secondary-light); color: #d93025; }
[data-theme="dark"] .card-test-result.success { background: #1a3c2a; color: #81c995; }
[data-theme="dark"] .card-test-result.fail { background: #3c1a1a; color: #f28b82; }
.test-result-line { display: flex; align-items: center; gap: 6px; font-weight: 500; }
.test-code { font-size: var(--font-size-xs); padding: 1px 6px; border-radius: 4px; background: rgba(0,0,0,0.08); font-family: monospace; }
.test-detail { font-size: var(--font-size-xs); color: var(--muted); margin-top: 4px; word-break: break-all; }

/* 操作按钮 */
.card-actions {
  display: flex;
  gap: 4px;
  padding: var(--space-sm) var(--space-lg);
  border-top: 1px solid var(--hairline, var(--border));
  flex-wrap: wrap;
}

.cohere-icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--hairline, var(--border));
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--muted, var(--text-muted));
  transition: all 0.12s;
}
.cohere-icon-btn:hover:not(:disabled) {
  background: var(--soft-stone, var(--bg));
  color: var(--ink, #222);
}
/* P1: 按钮 :active 反馈 */
.cohere-icon-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.cohere-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cohere-icon-btn.default-active {
  background: #ffd700;
  color: #333;
  border-color: #ffd700;
}
.cohere-icon-btn-danger:hover:not(:disabled) {
  background: var(--secondary-light);
  color: #d93025;
}

/* P1: 步骤进度指示器 */
.step-progress {
  display: flex;
  justify-content: space-between;
  margin-bottom: 20px;
  padding: 0 8px;
}
.step-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0.4;
  transition: opacity 0.2s;
}
.step-indicator.active { opacity: 0.7; }
.step-indicator.current { opacity: 1; }
.step-number {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: var(--hairline, #e0e0e0);
  color: var(--muted, #999);
}
.step-indicator.active .step-number {
  background: var(--primary, #1a73e8);
  color: #fff;
}
.step-text {
  font-size: var(--font-size-xs);
  color: var(--muted, #999);
}
.step-indicator.current .step-text {
  color: var(--ink, #222);
  font-weight: 500;
}

/* 添加对话框步骤 */
.add-step {
  padding: 8px 0;
}
.step-hint {
  font-size: var(--font-size-sm);
  color: var(--muted);
  margin-bottom: 16px;
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.category-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 12px;
  border: 2px solid var(--border);
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
}
.category-card:hover { border-color: var(--primary); }
.category-card.active {
  border-color: var(--primary);
  background: var(--primary-light);
}
.category-icon { font-size: var(--font-size-xl); }
.category-label { font-size: var(--font-size-sm); font-weight: 500; }

.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
}
.preset-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: all 0.12s;
}
.preset-card:hover { border-color: var(--primary); background: var(--primary-light); }
.preset-card.active { border-color: var(--primary); background: var(--primary-light); }
.preset-card-name { font-weight: 500; font-size: var(--font-size-sm); }
.preset-card-url { font-size: var(--font-size-xs); color: var(--muted); word-break: break-all; }
.preset-card-models { font-size: var(--font-size-xs); color: var(--muted); }
.no-presets {
  text-align: center;
  padding: 24px;
  color: var(--muted);
}

.divider {
  text-align: center;
  color: var(--muted);
  font-size: var(--font-size-xs);
  margin: 12px 0;
  position: relative;
}
.divider::before, .divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 40%;
  height: 1px;
  background: var(--border);
}
.divider::before { left: 0; }
.divider::after { right: 0; }

.form-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.input-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--ink);
}
.form-hint {
  font-size: var(--font-size-sm);
  color: var(--slate, #6b7280);
  background: var(--soft-stone, #f5f5f0);
  padding: 10px 12px;
  border-radius: var(--r-sm, 8px);
  line-height: 1.5;
}
.input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: var(--font-size-sm);
  background: var(--canvas);
  color: var(--ink);
}
.input:focus {
  outline: none;
  border-color: var(--primary);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.cohere-btn-danger {
  padding: 8px 20px;
  background: #d93025;
  color: var(--surface);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: 500;
}
.cohere-btn-danger:hover { background: #b3261e; }
.cohere-btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

.cohere-empty {
  text-align: center;
  padding: 80px 20px;
  color: var(--muted, var(--text-muted));
}
.cohere-empty .empty-icon { font-size: 48px; margin-bottom: var(--space-md); }
.cohere-empty h3 { font-size: var(--font-size-md); font-weight: 500; margin: 0 0 8px; color: var(--ink); }
.cohere-empty p { font-size: var(--font-size-sm); margin: 0; }

.rotating {
  display: inline-block;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* P1: 响应式断点 */
@media (max-width: 768px) {
  .provider-grid {
    grid-template-columns: 1fr;
    padding: var(--space-md);
  }
  .cohere-page-header {
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }
  .cohere-filter-bar {
    flex-wrap: wrap;
    gap: 6px;
  }
  .category-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .step-text {
    display: none;
  }
  .step-progress {
    justify-content: center;
    gap: 24px;
  }
}

/* P1: 响应式对话框 */
:deep(.responsive-dialog) {
  width: 90vw !important;
  max-width: 560px;
}
:deep(.responsive-dialog-sm) {
  width: 90vw !important;
  max-width: 400px;
}
@media (max-width: 768px) {
  :deep(.responsive-dialog),
  :deep(.responsive-dialog-sm) {
    width: 95vw !important;
    margin: 0 auto;
  }
}

/* ===== 视图模式 Tab ===== */
.view-mode-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: var(--space-md);
  background: var(--soft-stone, #f0f0ec);
  border-radius: 10px;
  padding: 3px;
  width: fit-content;
}
.view-mode-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted, #999);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.view-mode-tab:hover { color: var(--ink, #222); }
.view-mode-tab.active {
  background: var(--color-bg-card);
  color: var(--ink, #222);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.tab-icon { font-size: var(--font-size-xs); }
.tab-count {
  font-size: var(--font-size-xs);
  background: var(--soft-stone, #e8e8e4);
  padding: 1px 6px;
  border-radius: 10px;
  color: var(--muted, #999);
}
.view-mode-tab.active .tab-count {
  background: var(--primary-light, #e8f0fe);
  color: var(--primary, #1a73e8);
}

/* ===== 分类筛选条 ===== */
.cohere-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
  padding: 0;
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 16px;
  background: var(--bg, #fff);
  font-size: var(--font-size-xs);
  color: var(--muted, #666);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.filter-chip:hover {
  border-color: var(--primary, #1a73e8);
  color: var(--primary, #1a73e8);
}
.filter-chip.active {
  background: var(--primary-light, #e8f0fe);
  border-color: var(--primary, #1a73e8);
  color: var(--primary, #1a73e8);
  font-weight: 500;
}
.chip-label { font-size: var(--font-size-xs); }
.chip-count {
  font-size: var(--font-size-xs);
  background: var(--bg-secondary, #f0f0f0);
  padding: 1px 5px;
  border-radius: 8px;
  color: var(--muted, #999);
}
.filter-chip.active .chip-count {
  background: rgba(26, 115, 232, 0.15);
  color: var(--primary, #1a73e8);
}
[data-theme="dark"] .filter-chip {
  border-color: #444;
  background: #2a2a3e;
  color: #aaa;
}
[data-theme="dark"] .filter-chip.active {
  background: #1a3a5c;
  border-color: #8ab4f8;
  color: #8ab4f8;
}

/* ===== 卡片徽章 ===== */
.configured-badge {
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  border-radius: 4px;
  background: #e6f4ea;
  color: #137333;
  font-weight: 500;
}
.preset-badge {
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  border-radius: 4px;
  background: #f1f3f4;
  color: #5f6368;
  font-weight: 500;
}
.custom-badge {
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  border-radius: 4px;
  background: #e8f0fe;
  color: #1a73e8;
  font-weight: 500;
}
.card-configured {
  border-left: 3px solid #34a853;
}

/* ===== 引导空状态 ===== */
.onboarding-empty {
  text-align: center;
  padding: 60px 20px;
}
.onboarding-icon { font-size: 56px; margin-bottom: 16px; }
.onboarding-empty h3 {
  font-size: var(--font-size-md);
  font-weight: 500;
  margin: 0 0 8px;
  color: var(--ink);
}
.configured-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: var(--bg-secondary, #f8f9fa);
  border-radius: 8px;
  font-size: var(--font-size-sm);
  color: var(--muted, #666);
}
.configured-stats strong {
  color: var(--ink, #222);
  font-weight: 600;
}
.stats-separator { color: #ccc; }
.stats-primary { color: var(--ink, #222); }
.stats-secondary { color: var(--muted, #666); }
[data-theme="dark"] .configured-stats {
  background: #1e1e2e;
}
[data-theme="dark"] .configured-stats strong { color: #e0e0e0; }
.onboarding-empty p {
  font-size: var(--font-size-sm);
  color: var(--muted);
  margin: 0 0 20px;
}

/* ===== 快速添加区域 ===== */
.quick-add-section {
  margin-top: var(--space-xl);
  padding-top: var(--space-lg);
  border-top: 1px solid var(--border);
}
.quick-add-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--space-md);
}
.quick-add-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--ink, #222);
}
.quick-add-meta {
  font-size: var(--font-size-xs);
  color: var(--muted, #999);
}
.quick-add-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}
.quick-add-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  border: 1px dashed var(--border, #ddd);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  transition: all 0.12s;
  color: var(--ink);
}
.quick-add-card:hover {
  border-color: var(--primary, #1a73e8);
  border-style: solid;
  background: var(--primary-light, #f0f6ff);
}
.quick-add-icon { font-size: var(--font-size-lg); }
.quick-add-name { font-size: var(--font-size-xs); font-weight: 500; }
.quick-add-category { font-size: var(--font-size-xs); color: var(--muted, #999); }
.quick-add-more {
  border-color: var(--muted, #999);
  color: var(--muted, #999);
}

/* 运营后台同步卡片 */
.ops-sync-card {
  margin: 0 var(--space-xxl) var(--space-lg);
  padding: 14px 18px;
  background: var(--surface, #fff);
  border: 1px solid var(--hairline, var(--border));
  border-radius: 12px;
}
.ops-sync-configured {
  border-color: var(--primary, #1a73e8);
  background: var(--primary-light, #f0f6ff);
}
.ops-sync-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.ops-sync-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--ink, #222);
}
.ops-sync-meta {
  font-size: var(--font-size-xs);
  color: var(--muted, #666);
}
.ops-sync-meta.muted { color: var(--muted, #999); }
.ops-sync-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ops-sync-fields {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
  margin-top: 10px;
}
.ops-sync-status {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: var(--font-size-sm);
}
.ops-sync-status.success {
  background: #e6f4ea;
  color: #137333;
}
.ops-sync-status.error {
  background: #fce8e6;
  color: #c5221f;
}
[data-theme="dark"] .ops-sync-status.success { background: #1a3c2a; color: #81c995; }
[data-theme="dark"] .ops-sync-status.error { background: #3c1a1a; color: #f28b82; }
.ops-sync-hint {
  margin-top: 10px;
  font-size: var(--font-size-xs);
  color: var(--muted, #666);
  line-height: 1.6;
}
.form-hint.muted-hint {
  color: var(--muted, #999);
  font-size: var(--font-size-xs);
}
@media (max-width: 720px) {
  .ops-sync-fields { grid-template-columns: 1fr; }
  .ops-sync-actions { margin-left: 0; }
}

/* ===== 多模态能力默认切换 ===== */
.capability-defaults {
  flex-wrap: wrap;
}
.capability-default-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.capability-default-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid var(--border, #ddd);
  border-radius: 14px;
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: all 0.15s;
  color: var(--muted, #999);
  background: transparent;
  user-select: none;
}
.capability-default-chip:hover {
  border-color: var(--primary, #1a73e8);
  color: var(--primary, #1a73e8);
}
.capability-default-chip.active {
  background: #ffd700;
  border-color: #ffd700;
  color: #333;
  font-weight: 500;
}
.capability-default-check {
  font-size: var(--font-size-xs);
  font-weight: 700;
}
[data-theme="dark"] .capability-default-chip {
  border-color: #555;
  color: #aaa;
}
[data-theme="dark"] .capability-default-chip:hover {
  border-color: #8ab4f8;
  color: #8ab4f8;
}
[data-theme="dark"] .capability-default-chip.active {
  background: #8a7a2a;
  border-color: #bba830;
  color: #fff;
}

/* 方案C 零配置化：自动连接只读样式 */
.ops-sync-auto .auto-readonly-value {
  display: inline-block;
  padding: 4px 8px;
  background: var(--el-fill-color-light, #f5f5f5);
  border-radius: 4px;
  font-size: var(--font-size-sm);
  color: var(--el-text-color-regular, #606266);
  font-family: monospace;
}
.auto-connected-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--el-color-success-light-9, #f0f9eb);
  color: var(--el-color-success, #67c23a);
  border-radius: 4px;
  font-size: var(--font-size-sm);
  font-weight: 500;
}
.login-to-enable-hint {
  font-size: var(--font-size-xs);
  color: var(--el-text-color-secondary, #909399);
  font-style: italic;
}

/* 限流自检弹窗表单：label 与输入框同行对齐、输入框等宽。
   此前 .selfcheck-form/.selfcheck-row 只有类名无任何样式定义，
   label 与 el-input-number 随机换行、宽度参差（用户反馈布局混乱）。 */
.selfcheck-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 4px;
}
.selfcheck-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.selfcheck-row label {
  flex: 0 0 230px;
  font-size: var(--font-size-sm);
  color: var(--muted);
  line-height: 1.4;
}
.selfcheck-row .el-input-number {
  width: 150px;
  flex-shrink: 0;
}
</style>

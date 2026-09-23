<template>
  <div class="nav-bar" data-testid="nav-bar" aria-label="导航栏">
    <div class="nav-bar-left">
      <button
        type="button"
        class="nav-btn"
        :disabled="!canGoBack"
        title="后退"
        aria-label="后退"
        data-testid="nav-back"
        @click="$emit('go-back')"
      >
        ←
      </button>
      <button
        type="button"
        class="nav-btn"
        :disabled="!canGoForward"
        title="前进"
        aria-label="前进"
        data-testid="nav-forward"
        @click="$emit('go-forward')"
      >
        →
      </button>
      <button
        v-if="!isHome"
        type="button"
        class="nav-btn"
        title="刷新"
        aria-label="刷新"
        data-testid="nav-reload"
        @click="$emit('reload')"
      >
        ⟳
      </button>
      <button
        type="button"
        class="nav-btn"
        title="返回首页"
        aria-label="返回首页"
        data-testid="nav-home"
        @click="$emit('go-home')"
      >
        <el-icon><HomeFilled /></el-icon>
      </button>
    </div>

    <div class="nav-bar-center">
      <div class="url-bar" :class="{ focused: urlFocused, 'is-home': isHome }">
        <span class="url-icon" aria-hidden="true"><el-icon><Search /></el-icon></span>
        <input
          ref="urlInput"
          type="text"
          class="url-input"
          :value="displayUrl"
          :disabled="isHome"
          :placeholder="isHome ? t('nav.home') : (currentTitle || t('nav.searchPlaceholder'))"
          data-testid="nav-url-input"
          @focus="onFocus"
          @blur="onBlur"
          @keydown.enter="onSubmit"
          @mouseup="onMouseUp"
        />
        <button
          v-if="currentUrl && !isHome"
          type="button"
          class="url-copy"
          title="复制网址"
          aria-label="复制网址"
          @click="copyUrl"
        >
          <el-icon v-if="copied"><Check /></el-icon><el-icon v-else><CopyDocument /></el-icon>
        </button>
      </div>
    </div>

    <div class="nav-bar-right">
      <span v-if="loading" class="nav-loading" aria-label="加载中">⟳</span>
      <button
        v-if="isLoginTab"
        type="button"
        class="save-account-btn"
        :class="{ 'save-account-btn--pulse': accountUnsaved && !saving }"
        :disabled="saving"
        data-testid="nav-save-account"
        @click="$emit('save-account')"
      >
        {{ saving ? t('nav.savingAccount') : t('nav.saveAccount') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { Check, CopyDocument, HomeFilled, Search } from '@element-plus/icons-vue'
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  currentUrl: { type: String, default: '' },
  currentTitle: { type: String, default: '' },
  canGoBack: { type: Boolean, default: false },
  canGoForward: { type: Boolean, default: false },
  isHome: { type: Boolean, default: true },
  loading: { type: Boolean, default: false },
  // 登录标签态（对齐参考产品）：导航栏右侧显示「保存账号」蓝色按钮
  isLoginTab: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  // 账号标签存在未保存凭证时：保存按钮加脉冲动画（方案三，提醒点击）
  accountUnsaved: { type: Boolean, default: false }
})

const emit = defineEmits(['go-back', 'go-forward', 'reload', 'go-home', 'navigate', 'save-account'])

const urlInput = ref(null)
const urlFocused = ref(false)
const editedUrl = ref('')
const copied = ref(false)
const hasEdited = ref(false)

const displayUrl = computed(() => {
  if (hasEdited.value) return editedUrl.value
  if (props.isHome) return ''
  return props.currentUrl || ''
})

function onFocus() {
  urlFocused.value = true
  hasEdited.value = false
  editedUrl.value = props.currentUrl || ''
  setTimeout(() => urlInput.value?.select(), 0)
}

function onBlur() {
  urlFocused.value = false
  hasEdited.value = false
}

function onMouseUp(e) {
  // 防止选中文本时触发 blur
  if (!hasEdited.value) {
    e.preventDefault()
    hasEdited.value = true
    editedUrl.value = props.currentUrl || ''
    setTimeout(() => urlInput.value?.focus(), 0)
  }
}

function onSubmit() {
  const query = editedUrl.value.trim()
  if (query) {
    emit('navigate', query)
  }
  urlInput.value?.blur()
}

async function copyUrl() {
  if (!props.currentUrl) return
  try {
    await navigator.clipboard.writeText(props.currentUrl)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch (e) {
    console.error('Copy URL failed:', e)
  }
}
</script>

<style scoped>
.nav-bar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 40px;
  gap: 8px;
  padding: 0 10px;
  background: var(--color-bg-inset);
  border-bottom: 1px solid #e8eaf2;
  user-select: none;
}

.nav-bar-left {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.nav-btn {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #6b7280;
  font-size: var(--font-size-base);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.nav-btn:hover:not(:disabled) {
  background: #e5e7eb;
  color: #374151;
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.nav-bar-center {
  flex: 1;
  min-width: 0;
}

.url-bar {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 10px;
  border-radius: 15px;
  background: #eef0f4;
  transition: background 0.2s, box-shadow 0.2s;
}

.url-bar.focused {
  background: var(--color-bg-card);
  box-shadow: 0 0 0 2px rgba(80, 72, 229, 0.3);
}

/* 首页只读态：地址栏置灰、不可输入，仅作视觉占位（前进/后退仍由 SPA 历史驱动） */
.url-bar.is-home {
  background: var(--color-bg-inset);
  border: 1px solid var(--color-border);
}

.url-bar.is-home .url-input {
  color: var(--color-text-muted);
  cursor: default;
}

.url-icon {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  margin-right: 6px;
  color: #9ca3af;
}

.url-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: #374151;
  font-size: var(--font-size-sm);
  outline: none;
}

.url-input::placeholder {
  color: #9ca3af;
}

.url-copy {
  flex-shrink: 0;
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #9ca3af;
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.url-copy:hover {
  background: #e5e7eb;
  color: #374151;
}

.nav-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.nav-loading {
  animation: spin 1s linear infinite;
  font-size: var(--font-size-sm);
  color: #6b7280;
}

.save-account-btn {
  height: 28px;
  padding: 0 16px;
  border: none;
  border-radius: 14px;
  background: #409eff;
  color: #fff;
  font-size: var(--font-size-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.save-account-btn:hover:not(:disabled) {
  background: #337ecc;
}

.save-account-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.save-account-btn--pulse {
  animation: save-pulse 1.4s ease-in-out infinite;
}

@keyframes save-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(64, 158, 255, 0.5); transform: scale(1); }
  50% { box-shadow: 0 0 0 6px rgba(64, 158, 255, 0); transform: scale(1.04); }
}

@media (prefers-reduced-motion: reduce) {
  .save-account-btn--pulse { animation: none; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>

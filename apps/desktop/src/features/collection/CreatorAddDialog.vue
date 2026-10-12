<template>
  <div v-if="visible" class="cm-modal-mask" data-testid="creator-add-dialog">
    <div class="cm-modal" role="dialog" aria-modal="true" aria-labelledby="cm-add-title">
      <div id="cm-add-title" class="cm-modal-title">{{ $t('collection.creatorAddTitle') }}</div>
      <p class="cm-modal-intro">{{ $t('collection.creatorAddDialogIntro') }}</p>

      <!-- 平台选择（PRD §7）：URL 可自动识别时高亮；视频号 unsupported → 禁用 chip -->
      <div class="cm-field" data-testid="creator-add-platform-group">
        <label class="cm-field-label">{{ $t('collection.creatorPlatformLabel') }}</label>
        <div class="cm-platform-row">
          <button
            v-for="p in platforms"
            :key="p.id"
            type="button"
            class="cm-platform-chip"
            :class="{ active: platform === p.id, unsupported: !p.supported }"
            :data-testid="'creator-add-platform-' + p.id"
            :disabled="submitting || !p.supported"
            @click="selectPlatform(p)"
          >
            {{ $t('collection.' + p.localeKey) }}
            <span
              v-if="p.supported && !p.hasSession"
              class="cm-chip-dot"
              :data-testid="'creator-add-needlogin-' + p.id"
              :title="$t('collection.creatorErrCredentialMissingForPlatform', { platform: p.label || $t('collection.' + p.localeKey) })"
            />
          </button>
        </div>
        <div v-if="detectedPlatform" class="cm-hint" data-testid="creator-add-platform-auto">
          {{ $t('collection.creatorAddPlatformAuto', { platform: detectedLabel }) }}
        </div>
      </div>

      <div class="cm-field">
        <label class="cm-field-label" for="creator-add-input">{{ $t('collection.creatorAddLabel') }}</label>
        <input
          id="creator-add-input"
          v-model="input"
          class="cm-input"
          data-testid="creator-add-input"
          :placeholder="$t('collection.creatorAddPlaceholder')"
          :disabled="submitting"
          @keyup.enter="submit"
        />
        <div class="cm-hint">{{ $t('collection.creatorAddHint') }}</div>
        <div v-if="shownError" class="cm-field-error" data-testid="creator-add-error">{{ shownError }}</div>
      </div>

      <div class="cm-modal-actions">
        <button class="cohere-btn-secondary" data-testid="creator-add-cancel" :disabled="submitting" @click="close">
          {{ $t('collection.creatorAddCancel') }}
        </button>
        <button
          class="cohere-btn-primary"
          data-testid="creator-add-confirm"
          :disabled="submitting || !canSubmit"
          @click="submit"
        >
          {{ submitting ? $t('collection.creatorAddSubmitting') : $t('collection.creatorAddSubmit') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * CreatorAddDialog.vue —「添加博主」弹窗
 *
 * ## 为什么必须有这个组件（而不是继续用 window.prompt）
 *
 * 旧实现只有一行：`const input = window.prompt(t('collection.creatorAddPlaceholder'))`。
 * **Electron 渲染进程不支持 `window.prompt`** —— 调用即抛
 * `Error: prompt() is and will not be supported.`（`alert` / `confirm` 可用，`prompt` 被移除）。
 * 于是「关注」按钮点了没有任何反应（异常进的是未处理的 promise），
 * 用户看到的就是「我不知道怎么新增要监控的博主」。这不是文案问题，是路径不存在。
 *
 * ## 校验分层（与主进程一致，不重复造边界）
 *
 * | 层 | 判据 | 谁负责 |
 * | --- | --- | --- |
 * | 空输入 | 按钮禁用，不发请求 | 本组件 |
 * | 超长（> 512） | 内联报错，不发请求 | 本组件 |
 * | 形态是否可识别（链接 / @handle / UC ID） | 主进程 `parseChannelInput` fail-closed | 主进程，reason 回传后由父组件映射文案 |
 *
 * ⚠ 本组件**不做**「看起来像不像频道」的本地猜测：形态判定只有一份实现
 * （`creator-collector.parseChannelInput`），渲染层再抄一份必然漂移。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const MAX_INPUT_LENGTH = 512

const { t } = useI18n()

const props = defineProps({
  visible: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  /** 父组件回传的服务端错误文案（已 i18n） */
  error: { type: String, default: '' },
  /** 平台清单（creator:platforms，含 supported/hasSession）；缺省按三平台静态渲染 */
  platforms: { type: Array, default: () => ([
    { id: 'youtube', localeKey: 'creatorPlatformYoutube', supported: true },
    { id: 'douyin', localeKey: 'creatorPlatformDouyin', supported: true },
    { id: 'xiaohongshu', localeKey: 'creatorPlatformXiaohongshu', supported: true },
  ]) },
})
const emit = defineEmits(['update:visible', 'submit'])

const input = ref('')
/** 本地校验只可能有这一种失败（超长），故存布尔而不是 key —— 避免把 key 直接渲染出去 */
const tooLong = ref(false)
/** 显式所选平台（缺省 youtube，与主进程的缺省一致） */
const platform = ref('youtube')

/** 输入 URL 的平台自动识别（本地只做「提示与预选」——最终判定在主进程 fail-closed）。
 *  自动识别后**自动切换**所选平台：否则默认 YouTube + 抖音链接必然 wrong_platform，
 *  用户要先理解「要先手动选平台」才能用，违背 PRD §7「识别时高亮并允许改」。 */
const detectedPlatform = computed(() => {
  const s = input.value.trim()
  if (/douyin\.com/i.test(s)) return 'douyin'
  if (/xiaohongshu\.com|xhslink/i.test(s)) return 'xiaohongshu'
  if (/youtube\.com|youtu\.be/i.test(s)) return 'youtube'
  return ''
})
const detectedLabel = computed(() => {
  const p = props.platforms.find((x) => x.id === detectedPlatform.value)
  if (!p) return ''
  // label 由主进程下发（已是平台展示名），localeKey 仅在静态缺省 props 里存在
  return p.label || t('collection.' + p.localeKey)
})
// 识别到平台且当前选择与它不同 → 自动切过去（用户仍可手动改）
watch(detectedPlatform, (p) => { if (p) platform.value = p })

function selectPlatform (p) {
  if (!p.supported) return
  platform.value = p.id
}

/** 每次打开都清空：上次失败留下的输入不该在下次打开时"复活"（用户会以为已提交过） */
watch(() => props.visible, (open) => {
  if (open) {
    input.value = ''
    tooLong.value = false
    platform.value = 'youtube'
  }
})

/**
 * 只按「非空」禁用按钮：**不**把超长也塞进 disabled。
 * 若超长即禁用，用户点下去毫无反应且看不到原因（正是本特性最初「点了没反应」的同型体验）；
 * 也**不用** `maxlength` 截断 —— 静默截断会把一条 600 字的粘贴内容无声改成 512 字，
 * 用户看到的是"关注成功了但频道不对"。正解是：允许点，点完给明确的内联报错。
 */
const canSubmit = computed(() => input.value.trim().length > 0)
/** 本地错误优先：它比上一次的服务端错误更贴近当前输入 */
const shownError = computed(() => (tooLong.value ? t('collection.creatorErrInputTooLong') : props.error))

function close () {
  if (props.submitting) return
  emit('update:visible', false)
}

function submit () {
  if (props.submitting) return
  const value = input.value.trim()
  if (!value) return
  if (value.length > MAX_INPUT_LENGTH) {
    tooLong.value = true
    return
  }
  tooLong.value = false
  emit('submit', { input: value, platform: platform.value })
}

defineExpose({ submit })
</script>

<style scoped>
.cm-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.cm-modal {
  width: 460px;
  max-width: calc(100vw - 32px);
  background: var(--el-bg-color, #fff);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.cm-modal-title { font-weight: 600; font-size: var(--font-size-lg); }
.cm-modal-intro { margin: 0; color: var(--el-text-color-secondary, #909399); font-size: var(--font-size-xs); }
.cm-field { display: flex; flex-direction: column; gap: 4px; }
.cm-field-label { font-size: var(--font-size-sm); }
.cm-input {
  padding: 6px 8px;
  border: 1px solid var(--border, #dcdfe6);
  border-radius: 4px;
  font-size: var(--font-size-sm);
}
.cm-hint { color: var(--el-text-color-secondary, #909399); font-size: var(--font-size-xs); }
.cm-field-error { color: var(--el-color-danger, #f56c6c); font-size: var(--font-size-xs); }
.cm-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.cm-platform-row { display: flex; gap: 8px; }
.cm-platform-chip {
  padding: 4px 12px;
  border: 1px solid var(--border, #dcdfe6);
  border-radius: 999px;
  background: transparent;
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.cm-platform-chip.active { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.cm-platform-chip.unsupported { opacity: 0.5; cursor: not-allowed; }
/* 未登录小标：提醒「该平台需要先在账号管理登录」（PRD §7 hasSession 消费点） */
.cm-chip-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 4px;
  border-radius: 50%;
  background: var(--el-color-warning);
  vertical-align: middle;
}
</style>

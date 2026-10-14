<template>
  <div class="cohere-card col-panel" data-testid="cards-render-panel">
    <div class="cohere-section-title col-section-title col-section-title--flex">
      <span>{{ $t('cards.entryLabel') }}</span>
    </div>
    <div class="cards-desc">{{ $t('cards.entryDesc') }}</div>

    <!-- 入口：rendering 时禁用（不得让用户重复点击） -->
    <div class="cards-actions">
      <button
        class="cohere-btn-primary"
        :disabled="rendering || pages.length === 0"
        :data-testid="'cards-render-run'"
        @click="onRender"
      >
        {{ rendering ? $t('cards.rendering') : $t('cards.entryLabel') }}
      </button>
    </div>

    <!-- 进度 -->
    <div v-if="rendering" class="cards-progress" data-testid="cards-render-progress">
      {{ $t('cards.rendering') }}
    </div>

    <!-- warnings 非空必须可见（不得静默） -->
    <div v-if="hasWarnings" class="cards-warnings" data-testid="cards-render-warnings">
      <div class="cards-warnings-title">{{ $t('cards.warningsTitle') }}</div>
      <ul>
        <li v-for="w in warnings" :key="w" :data-testid="'cards-warning-' + w">
          {{ warningText(w) }}
        </li>
      </ul>
    </div>

    <!-- 失败点名原因 -->
    <div v-if="failed" class="col-error-banner" data-testid="cards-render-error">
      {{ failureText }}
    </div>

    <!-- 结果 -->
    <div v-if="hasResult" class="cards-result" data-testid="cards-render-result">
      <div class="cards-result-title">{{ $t('cards.resultTitle') }}</div>
      <div class="cards-result-count">
        {{ $t('cards.resultCount', { count: resultFiles.length }) }}
      </div>
      <div class="cards-result-hint">{{ $t('cards.resultHint') }}</div>
    </div>
  </div>
</template>

<script setup>
/**
 * 图文卡片分页渲染面板（P2-5 第三批）
 *
 * 交互逻辑全部在 useCardsRender（同目录 composable），本组件只做：
 *   - 把 composable 的状态映射到模板
 *   - 把「领域码 / warning 键」翻译成 locale 文案
 *
 * 三条硬契约在模板层的落点：
 *   1. warnings 非空 => 必须渲染 cards.warningsTitle 区块（P2-5 规格「失败面」条：
 *      用户的文本超出一页时必须知情，不得静默丢弃）
 *   2. 失败 => 必须点名原因（按 failure.key 取 locale，不写死「生成失败」）
 *   3. rendering => 按钮禁用 + 进度可见（不得让用户重复点击）
 *
 * 形态照 QuickCollectPanel.vue：cohere-* 设计系统类名 + data-testid + $t()。
 *
 * 不在组件里拼中文句子 —— 文案集中在 locales/cards/{zh,en}.js，由 $t() 取。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCardsRender } from './useCardsRender'

const props = defineProps({
  // 分页结果（每页是块数组）；由父页面（选题/发布页）喂入
  pages: { type: Array, required: true },
  widthPx: { type: Number, default: undefined },
  heightPx: { type: Number, default: undefined },
})

const { t } = useI18n()
const {
  rendering,
  resultFiles,
  warnings,
  failure,
  hasResult,
  hasWarnings,
  failed,
  render,
} = useCardsRender()

/** warning 键到 locale 键的映射（新增 warning 只改这里 + locale） */
const WARNING_KEYS = {
  'item-exceeds-page': 'warningItemExceedsPage',
  'page-limit-reached': 'warningPageLimitReached',
}

function warningText (w) {
  const key = WARNING_KEYS[w]
  // 未知 warning：如实回显其标识，不得静默丢弃也不得伪装成已知文案
  return key ? t('cards.' + key) : w
}

const failureText = computed(() => {
  const f = failure.value
  if (!f) return ''
  return t('cards.' + f.key, f.vars || {})
})

async function onRender () {
  await render({
    pages: props.pages,
    ...(props.widthPx === undefined ? {} : { widthPx: props.widthPx }),
    ...(props.heightPx === undefined ? {} : { heightPx: props.heightPx }),
  })
}
</script>

<style scoped>
.cards-desc { margin: 0 0 12px; opacity: 0.75; }
.cards-actions { display: flex; gap: 8px; }
.cards-progress { margin-top: 12px; opacity: 0.85; }
.cards-warnings { margin-top: 12px; }
.cards-warnings-title { font-weight: 600; margin-bottom: 4px; }
.cards-warnings ul { margin: 0; padding-left: 20px; }
.cards-result { margin-top: 12px; }
.cards-result-title { font-weight: 600; }
.cards-result-hint { opacity: 0.75; margin-top: 4px; }
</style>

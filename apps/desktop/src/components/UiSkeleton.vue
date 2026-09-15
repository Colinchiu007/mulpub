<template>
  <component
    :is="tag"
    class="mp-skeleton"
    :class="[`mp-skeleton--${variant}`, { 'mp-skeleton--static': !animated }]"
    role="status"
    aria-busy="true"
    data-testid="ui-skeleton"
  >
    <!-- 单行文本 -->
    <span
      v-if="variant === 'text'"
      class="mp-skeleton__bar mp-skeleton-surface"
      :style="{ width: size(width, '100%'), height: size(height, '') }"
    />

    <!-- 段落：多行，末行收口 -->
    <span v-else-if="variant === 'paragraph'" class="mp-skeleton__lines">
      <span
        v-for="i in rows"
        :key="i"
        class="mp-skeleton__bar mp-skeleton-surface"
        :style="{ width: i === rows && rows > 1 ? '62%' : '100%' }"
      />
    </span>

    <!-- 单块：矩形 / 圆形 -->
    <span
      v-else-if="variant === 'rect' || variant === 'circle'"
      class="mp-skeleton__block mp-skeleton-surface"
      :style="blockStyle"
    />

    <!-- 卡片：媒体区 + 两行标题/摘要 -->
    <span v-else-if="variant === 'card'" class="mp-skeleton__card">
      <span
        class="mp-skeleton__media mp-skeleton-surface"
        :style="{ height: size(height, 'var(--skeleton-media-height)') }"
      />
      <span class="mp-skeleton__lines mp-skeleton__card-lines">
        <span class="mp-skeleton__bar mp-skeleton-surface" style="width: 72%" />
        <span class="mp-skeleton__bar mp-skeleton-surface" style="width: 45%" />
      </span>
    </span>

    <!-- 列表项：头像 + 两行正文 + 右侧操作位（收藏/榜单/草稿/历史通用） -->
    <span v-else-if="variant === 'list'" class="mp-skeleton__list">
      <span v-for="i in count" :key="i" class="mp-skeleton__row">
        <span class="mp-skeleton__avatar mp-skeleton-surface" />
        <span class="mp-skeleton__row-main">
          <span class="mp-skeleton__bar mp-skeleton-surface" style="width: 32%" />
          <span class="mp-skeleton__bar mp-skeleton-surface" style="width: 96%" />
          <span class="mp-skeleton__bar mp-skeleton-surface" style="width: 58%" />
        </span>
        <span class="mp-skeleton__action mp-skeleton-surface" />
      </span>
    </span>

    <!-- 表格：表头 + N 行 × M 列 -->
    <span v-else-if="variant === 'table'" class="mp-skeleton__table">
      <span class="mp-skeleton__table-row mp-skeleton__table-row--head">
        <span v-for="c in columns" :key="`h${c}`" class="mp-skeleton__bar mp-skeleton-surface" />
      </span>
      <span v-for="r in count" :key="r" class="mp-skeleton__table-row">
        <span v-for="c in columns" :key="`r${r}c${c}`" class="mp-skeleton__bar mp-skeleton-surface" />
      </span>
    </span>

    <!-- 图表：柱状占位（底对齐） -->
    <span v-else-if="variant === 'chart'" class="mp-skeleton__chart">
      <span
        v-for="(h, i) in CHART_HEIGHTS"
        :key="i"
        class="mp-skeleton__column mp-skeleton-surface"
        :style="{ height: `${h}%` }"
      />
    </span>

    <!-- custom：调用方用默认插槽自行拼装 -->
    <slot v-else />

    <span class="mp-skeleton__sr">{{ srLabel }}</span>
  </component>
</template>

<script setup>
import { computed } from 'vue'
import i18n from '@/i18n'

/**
 * 统一加载占位组件。
 *
 * 视觉全部来自 styles/skeleton.css 的 --skeleton-* 令牌 + .mp-skeleton-surface，
 * 组件自身只负责结构与尺寸，因此明暗主题、动画时长、圆角都只有一个改点。
 */
const CHART_HEIGHTS = [42, 66, 48, 82, 56, 92, 46, 70]

const props = defineProps({
  /** text | paragraph | rect | circle | card | list | table | chart | custom */
  variant: {
    type: String,
    default: 'text',
    // 白名单内联（defineProps 不能引用局部变量，会被提升到 setup 之外）；
    // 写错变体在开发态直接告警，而不是静默渲染空白。
    validator: (value) =>
      ['text', 'paragraph', 'rect', 'circle', 'card', 'list', 'table', 'chart', 'custom'].includes(value)
  },
  /** 根元素标签，表格场景可传 'tr' / 'tbody' */
  tag: { type: String, default: 'div' },
  /** paragraph 行数 */
  rows: { type: Number, default: 3 },
  /** list / table 条目数 */
  count: { type: Number, default: 3 },
  /** table 列数 */
  columns: { type: Number, default: 4 },
  /** 自定义宽度（数字按 px，字符串原样） */
  width: { type: [String, Number], default: '' },
  /** 自定义高度（数字按 px，字符串原样） */
  height: { type: [String, Number], default: '' },
  /** 自定义圆角（字符串原样） */
  radius: { type: String, default: '' },
  /** 是否播放流光动画 */
  animated: { type: Boolean, default: true },
  /** 无障碍朗读文案（视觉隐藏），默认取 i18n common.loading */
  label: { type: String, default: '' }
})

// 骨架屏对辅助技术只暴露"加载中"这一句：视觉隐藏但留在 DOM 中，
// 使 role="status" 区域有可朗读名称（i18n 单例与 composables 用法一致）。
const srLabel = computed(() => props.label || i18n.global.t('common.loading'))

function size(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback
  return typeof value === 'number' ? `${value}px` : value
}

const blockStyle = computed(() => ({
  width: size(props.width, '100%'),
  height: size(props.height, '48px'),
  ...(props.radius ? { borderRadius: props.radius } : {})
}))
</script>

<style scoped>
.mp-skeleton {
  display: block;
  /* 默认撑满父容器：骨架常被放进 flex/grid 容器（原先的 spinner 行、面板内），
     宽度塌陷会让百分比骨块变成 0 宽。需要内联使用时用 style="width:auto" 覆盖。 */
  width: 100%;
}

/* --- 基础骨块 --- */
.mp-skeleton__bar {
  display: block;
  height: var(--skeleton-bar-height);
  border-radius: var(--skeleton-radius);
}

.mp-skeleton__block {
  display: block;
  border-radius: var(--skeleton-radius-block);
}

.mp-skeleton--circle .mp-skeleton__block {
  border-radius: 9999px;
}

.mp-skeleton__lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* --- card --- */
.mp-skeleton__card {
  display: flex;
  flex-direction: column;
}

.mp-skeleton__media {
  display: block;
  width: 100%;
  border-radius: inherit;
}

.mp-skeleton__card-lines {
  padding: 12px 14px 0;
}

/* --- list --- */
.mp-skeleton__list {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.mp-skeleton__row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.mp-skeleton__avatar {
  width: 36px;
  height: 36px;
  border-radius: 9999px;
  flex: 0 0 auto;
}

.mp-skeleton__row-main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.mp-skeleton__action {
  width: 72px;
  height: 28px;
  border-radius: 9999px;
  flex: 0 0 auto;
}

/* --- table --- */
.mp-skeleton__table {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

.mp-skeleton__table-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.mp-skeleton__table-row .mp-skeleton__bar {
  flex: 1 1 0;
}

.mp-skeleton__table-row--head .mp-skeleton__bar {
  height: 12px;
}

/* --- chart --- */
.mp-skeleton__chart {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 180px;
}

.mp-skeleton__column {
  flex: 1 1 0;
  border-radius: var(--skeleton-radius) var(--skeleton-radius) 0 0;
}

/* --- 无障碍：视觉隐藏文案 --- */
.mp-skeleton__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* animated=false：关闭流光，仅保留静态骨块 */
.mp-skeleton--static .mp-skeleton-surface {
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  .mp-skeleton-surface {
    animation: none;
  }
}
</style>

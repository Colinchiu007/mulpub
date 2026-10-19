<template>
  <div
    v-if="visible"
    class="ui-field"
    :class="{ 'ui-field--inline': inline, 'ui-field--error': !!error }"
    :aria-invalid="error ? 'true' : undefined"
  >
    <label v-if="label" class="ui-field-label" :for="resolvedForId || undefined">
      {{ label }}
      <span v-if="required" class="ui-field-required" aria-hidden="true">*</span>
    </label>
    <div class="ui-field-control">
      <slot />
      <slot name="suffix" />
    </div>
    <!-- 错误位：有错误时常驻；reserveError 为真时即使无错也预留固定 18px 行高（避免布局跳动）。
         默认不预留：详情页密集栅格下，永不会出错的字段不应白堆 18px 死高（字段级修正，PRD §11 已登记）。 -->
    <p v-if="error || reserveError" class="ui-field-error" :class="{ 'is-empty': !error }">{{ error || '' }}</p>
    <p v-if="hint" class="ui-field-hint">{{ hint }}</p>
  </div>
</template>

<script setup>
// 展示容器 + 运营隐藏守卫：optionKey 为空时始终渲染；非空时走父子契约的 s2vOptionVisible（fail-open），
// 与抽取前的 v-if="s2vOptionVisible(...)" 语义逐字一致，不得绕过。
import { computed, inject, provide, ref } from 'vue';
import { S2V_PANEL_KEY } from '../views/video-creation/s2v-panel-contract';
import { UI_FIELD_CONTROL_ID } from './uiFieldControlId';

defineOptions({ name: 'UiField' });

const props = defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  required: Boolean,
  forId: { type: String, default: '' },
  inline: Boolean,
  reserveError: Boolean,
  optionKey: { type: String, default: '' },
});

// ── label ↔ 控件的 id 通道（audit-29 / 阶段 4.3）────────────────────────
// 控件（UiInput）在 setup 期把自己的 id 登记进来；登记发生后标签才有 for。
// 两条硬约束：
//  ① **宁可没有 for，也不能有指向不存在元素的 for** —— 所以没有登记时 `:for` 整个属性缺席，
//     渲染成 `for=""` 会被辅助技术读成"关联到一个不存在的控件"，比缺失更坏；
//  ② 登记优先于 `forId`：`forId` 的正当用途是"控件不在我的槽里、在别处"，
//     这时标签本就该指那个外部 id；而**槽里真有控件时**，控件的实际 id 才是唯一正确答案，
//     让标签去指一个控件并没有采用的 forId，等于制造坏关联。
// 时序说明（不是缺陷，测试里作为显式断言钉住）：父组件先渲染、子组件在挂载阶段才登记，
// 所以首帧的 label 没有 for，登记触发的重渲染在同一微任务里补上 —— 用户看不到中间态
// （`for` 不是可视属性），但"下一帧必须成立"要有锁，否则以后谁改成一次性渲染就会静默失效。
const claimedId = ref('');
const resolvedForId = computed(() => claimedId.value || props.forId);
provide(UI_FIELD_CONTROL_ID, {
  // 先到先得：一个 label 只能描述一个控件，第二个控件仍有自己的 id，只是不被这个标签指向
  claim: (id) => { if (id && !claimedId.value) claimedId.value = id; },
});

const panel = props.optionKey ? inject(S2V_PANEL_KEY) : null;
if (props.optionKey && !panel) {
  // fail-closed：带 optionKey 却不在 CreateView 子树内，立即抛错而不是静默隐藏（静默会让 Bug 藏到运行时）。
  throw new Error(`[UiField] optionKey="${props.optionKey}" 需要父级 provide ${S2V_PANEL_KEY}，当前未提供`);
}

const visible = computed(() => {
  if (!props.optionKey) return true;
  const fn = panel?.fns?.s2vOptionVisible;
  return typeof fn === 'function' ? Boolean(fn(props.optionKey)) : true;
});
</script>

<style scoped>
/* 只消费 tokens.css 的权威 --color-* 令牌。 */
.ui-field { display: flex; flex-direction: column; min-width: 0; gap: var(--spacing-1, 4px); }
.ui-field--inline { flex-direction: row; align-items: center; gap: var(--spacing-2, 8px); }
.ui-field--inline .ui-field-control { flex: 1 1 auto; min-width: 0; }
.ui-field-label { font-size: var(--font-size-sm); font-weight: 600; color: var(--ink, var(--text)); }
.ui-field--inline .ui-field-label { white-space: nowrap; }
.ui-field-required { color: var(--color-danger, #ef5757); margin-left: 2px; }
.ui-field-control { min-width: 0; }
.ui-field-error { margin: 0; min-height: 18px; line-height: 18px; font-size: var(--font-size-xs); color: var(--color-danger, #ef5757); overflow-wrap: anywhere; }
.ui-field-error.is-empty { visibility: hidden; }
.ui-field-hint { margin: 0; font-size: var(--font-size-xs); color: var(--muted, var(--color-text-secondary)); line-height: 1.4; }
.ui-field--error :deep(select),
.ui-field--error :deep(input),
.ui-field--error :deep(textarea) { border-color: var(--color-danger, #ef5757); }
</style>

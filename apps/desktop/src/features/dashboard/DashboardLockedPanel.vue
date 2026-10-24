<template>
  <div class="dash-locked" :data-testid="`dashboard-locked-${name}`" role="status">
    <div class="dash-locked-head">
      <el-icon><Lock /></el-icon>
      <span class="dash-locked-title">{{ title }}</span>
    </div>
    <p class="dash-locked-hint">{{ t('dashboard.lockedHint', { name: title }) }}</p>
    <button type="button" class="dash-locked-cta" @click="$emit('upgrade')">
      {{ t('dashboard.lockedCta') }}
    </button>
  </div>
</template>

<script setup>
/**
 * 套餐未解锁区块的占位（dash-full-entitlement）。
 *
 * 形态决策（PRD §3.3，三条候选里的唯一诚实解）：
 *   ① 整块隐藏 → 用户不知道「原来还有这个」，也失去升级动机；
 *   ② 骨架假数据 → 欺骗，且假数字会被读成真数据；
 *   ③ 占位 + 说明能解锁什么 → 诚实且有转化价值，采此条。
 *
 * 注意：本组件**不发起**任何 IPC。未解锁时不该去拿拿不到的数据
 * （省流量，也避免「请求了但被权益拒绝」的歧义状态）。
 */
import { Lock } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'

defineProps({
  /** 区块标题，同时用于占位文案与 data-testid 后缀 */
  title: { type: String, required: true },
  /** testid 语义名（英文短名），如 trend / platform / perf / pattern */
  name: { type: String, required: true },
})

defineEmits(['upgrade'])

const { t } = useI18n()
</script>

<style scoped>
/* ⚠️ 本组件配色经 CI Gate 7c（暗色文本对比度）实测修过一轮，改色前必读：
 *
 * 首版两处都在暗色下不达标（实测 fg/bg/ratio 由 CI 精确报出）：
 *   ① .dash-locked-head 用 var(--deep-purple) = #1e1b4b —— 该变量是 Dashboard.vue
 *      在 :global(:root) 里写死的**亮色值**，暗色主题下不切换 ⇒ 深紫字压暗卡底
 *      (#26262d)，ratio **1.06**，标题几乎隐形。
 *      修法：改用语义 token var(--color-text-primary)，它在 tokens.css 里亮
 *      (#1e1b4b) 暗 (#e8e8ed) 双档都有定义，随主题自动切换。
 *   ② .dash-locked-cta 用描边式（透明底 + var(--lavender-primary) 紫字）⇒
 *      #7c5cbf 压 #26262d 只有 **2.96**，差 0.04 不达标。
 *      修法：改**实底 + 白字**。这样对比度恒为 5.07，与主题无关 ——
 *      同已删除的 TrialBanner 第 3 轮的结论（该组件随 ux-audit-dead-components-retire 撤下，
 *      取证见 `git log -p --follow -- apps/desktop/src/components/TrialBanner.vue`）：白字在固定底色下对「暗色主题是否覆盖了
 *      某个 token」完全免疫，描边式做不到这点。
 *
 * 关于 CTA 底色为何是字面量而非 token（CCG i5 提出，已评估）：
 *   · `--lavender-primary`（#7c5cbf）**只在 Dashboard.vue 的 scoped :global(:root) 里**，
 *     不是全局 token，子组件取不到（会 fallback 到 --color-primary，暗色下 = #8b85ff，
 *     白字仅 3.04:1，离阈值太近）。
 *   · `--color-primary` 随主题切换（亮 #5048E5 / 暗 #8b85ff），白字对比度 6.29 / 3.04 —— 
 *     暗色档太贴阈值，任何调色都会翻车。
 *   折中：提为**组件级变量**集中管理（下方 --dash-cta-bg），既不改全局 token，
 *   也不让字面量散落在规则里。改色只需改这一处。
 */
.dash-locked {
  --dash-cta-bg: #7c5cbf;
  margin-bottom: var(--space-md);
  padding: 16px;
  /* 旧：1px dashed 虚线框 —— 视觉上像"这里坏了/还没做完"，不像"这是付费功能"。
   * 新：实线发丝描边 + 极浅的暖紫底 + 左侧品牌色条，表达"未解锁但完整"。 */
  border: 1px solid var(--hairline);
  border-left: 3px solid var(--color-primary);
  border-radius: var(--radius-lg, 16px);
  background: var(--surface-sunken);
  box-shadow: var(--elevation-1);
}
.dash-locked-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 8px);
  font-weight: 600;
  font-size: var(--font-size-base, 15px);
  /* 语义 token：亮 #1e1b4b / 暗 #e8e8ed，随主题切换（勿改回 --deep-purple） */
  color: var(--color-text-primary);
}
.dash-locked-hint {
  margin: var(--space-sm, 8px) 0 var(--space-md, 12px);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
.dash-locked-cta {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--dash-cta-bg);
  /* 实底 + 白字：对比度恒 5.07，对主题覆盖免疫（见文件头说明） */
  background: var(--dash-cta-bg);
  color: #fff;
  cursor: pointer;
  padding: 6px 14px;
  border-radius: var(--radius-pill, 32px);
  font-size: var(--font-size-xs);
  font-weight: 500;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}
.dash-locked-cta:hover {
  filter: brightness(0.88);
  transform: translateY(-1px);
}
</style>

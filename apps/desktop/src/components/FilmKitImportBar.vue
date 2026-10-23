<script setup>
/**
 * FilmKitImportBar — 影视工程「资产导入」入口（PR-3b · F-J 写路径）
 *
 * 放在「项目案例」标签（`FilmEngineeringView.vue`）**顶部** ⇒ 那里是**看**资产的地方，
 * 导入是同一件事的另一半；「自动」标签是**只读规划区**，写操作不入只读区。
 *
 * 交互（与方案 `pr3b-import-design.md` §一 边界⑤ 一致）：
 *   ① 入口按钮 → ② **确认框**（写路径的第一道用户确认：注入脚本无法替用户点确认）
 *      → ③ 系统目录对话框（路径只能由用户选）→ ④ **不可中断模态**（无关闭/无取消）
 *      → ⑤ 成功 toast（自动刷新）/ 失败 toast + **恢复指引告警**。
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFilmKitImport } from '@/composables/useFilmKitImport'

const props = defineProps({
  /** 导入成功后由父组件刷新（重读分镜库 / 状态 / 方法论） */
  onImported: { type: Function, default: null },
})

const { t } = useI18n()
const {
  importing,
  kitImportReason,
  kitImportRecoveryHint,
  importKitAssets,
  importReasonText,
} = useFilmKitImport({ onImported: props.onImported })

const confirmVisible = ref(false)
/** 导入中模态：**不可中断** ⇒ v-model 的 setter 是空实现（关不掉） */
const importingVisible = computed({
  get: () => importing.value,
  set: () => {},
})

async function onConfirm () {
  confirmVisible.value = false
  await importKitAssets()
}
</script>

<template>
  <div class="fe-import-bar" data-testid="fe-kit-import-bar">
    <el-button
      type="primary"
      plain
      size="small"
      :disabled="importing"
      data-testid="fe-kit-import-btn"
      @click="confirmVisible = true"
    >{{ t('filmEngineering.filmKitImport.entry') }}</el-button>
    <span class="fe-import-hint">{{ t('filmEngineering.filmKitImport.hint') }}</span>
  </div>

  <!-- 导入失败后的恢复指引（残留档位 ⇒ 具体步骤；主进程回传 recoveryState/recoveryPath） -->
  <el-alert
    v-if="kitImportReason"
    class="fe-import-alert"
    type="warning"
    show-icon
    :closable="false"
    data-testid="fe-kit-import-recovery"
    :title="t('filmEngineering.filmKitImport.failed', { reason: importReasonText(kitImportReason) })"
  >
    <span v-if="kitImportRecoveryHint">{{ kitImportRecoveryHint }}</span>
  </el-alert>

  <!-- 导入确认框：写路径的**第一道用户确认** -->
  <el-dialog
    v-model="confirmVisible"
    :title="t('filmEngineering.filmKitImport.confirmTitle')"
    width="480px"
    data-testid="fe-kit-import-confirm"
  >
    <p class="fe-import-confirm-text">{{ t('filmEngineering.filmKitImport.confirm') }}</p>
    <!-- ⚠ 按钮放**默认插槽**而不是 `#footer`：el-dialog 在测试环境按自定义元素渲染，
         `#footer` 具名插槽不会渲染 ⇒ 按钮取不到（会让交互测试假阴性）。 -->
    <div class="fe-import-confirm-actions">
      <el-button data-testid="fe-kit-import-cancel" @click="confirmVisible = false">
        {{ t('common.cancel') }}
      </el-button>
      <el-button type="primary" data-testid="fe-kit-import-ok" @click="onConfirm">
        {{ t('common.confirm') }}
      </el-button>
    </div>
  </el-dialog>

  <!-- 导入中模态：**不可中断**（无关闭按钮 / 点遮罩不关 / ESC 不关，也没有取消按钮）
       ⚠ 对应主进程的「⓪ 之后没有取消通道」契约 ⇒ 文案必须说清「勿关闭应用」。 -->
  <el-dialog
    v-model="importingVisible"
    :title="t('filmEngineering.filmKitImport.importing')"
    width="420px"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    data-testid="fe-kit-importing"
  >
    <p class="fe-importing-hint">{{ t('filmEngineering.filmKitImport.importingHint') }}</p>
  </el-dialog>
</template>

<style scoped>
.fe-import-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.fe-import-hint { color: #909399; font-size: var(--font-size-sm); }
.fe-import-alert { margin-bottom: 12px; }
.fe-import-confirm-text { margin: 0; line-height: 1.7; }
.fe-import-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.fe-importing-hint { margin: 0; line-height: 1.7; color: #909399; }
</style>

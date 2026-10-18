<template>
  <div>
    <h1 style="margin-bottom:16px">字数控制</h1>
    <p style="color:var(--color-text-placeholder);margin-bottom:16px;font-size: var(--font-size-sm)">
      {{ description }}
    </p>

    <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px">
      <template #title>行为与生效说明</template>
      <div class="limit-hint">
        <div>· 文案输入框的<strong>实时计数上限</strong>取自本页配置，输入过程中即可看到已用字数与上限。</div>
        <div>· 已用字数达到<strong>预警阈值</strong>（如 90%）时，输入框会提示接近上限；<strong>超出上限的内容会被截断并提示</strong>。</div>
        <div>· {{ EFFECT_NOTICE_SAVE }}</div>
      </div>
    </el-alert>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="color:var(--color-text-secondary);font-size: var(--font-size-xs)">
          共 {{ items.length }} 项
          <span v-if="dirty" style="color:var(--color-warning);margin-left:8px">● 有未保存的修改</span>
          <span v-if="hasErrors" style="color:var(--color-danger);margin-left:8px">● 有不合法的输入，请先修正标红项</span>
        </div>
        <div>
          <el-button :loading="loading" :disabled="saving || resettingScope !== ''" @click="load">刷新</el-button>
          <el-button
            type="primary"
            :loading="saving"
            :disabled="loading || resettingScope !== '' || hasErrors"
            @click="saveAll"
          >保存</el-button>
        </div>
      </div>

      <!-- 数值输入刻意不设 :min/:max，也**不设** :precision：
           两者都会让组件「静默纠正」用户输入 —— :min/:max 把越界值夹到边界、:precision="0" 把
           小数四舍五入（1000.5 会显示成 1001），运营者会误以为自己设的值已原样生效
           （PRD §11 E5「clamp 会让『运营配错了』看起来像生效了」要防的正是这个形态）。
           越界/非整数原样保留在输入框里，由行内校验提示 + 保存按钮禁用拦截。 -->
      <el-table v-loading="loading" :data="items" border size="small" :empty-text="EMPTY_TEXT">
        <el-table-column label="范围名称" min-width="180">
          <template #default="{ row }">
            <span style="font-weight:500">{{ row.scopeLabel || row.scope }}</span>
            <el-tag v-if="row.scope" size="small" type="info" style="margin-left:6px">{{ row.scope }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="字数上限（字）" width="200">
          <template #default="{ row }">
            <el-input-number
              v-model="row.maxChars"
              :class="{ 'cell-input-error': errorOf(row).maxChars }"
              :controls="false"
              :step="100"
              :placeholder="`${limits.ranges.maxChars.min}~${limits.ranges.maxChars.max}`"
              style="width:100%"
              @change="markDirty"
            />
            <div v-if="errorOf(row).maxChars" class="cell-error">{{ errorOf(row).maxChars }}</div>
          </template>
        </el-table-column>

        <el-table-column label="预警阈值（%）" width="180">
          <template #default="{ row }">
            <el-input-number
              v-model="row.warnPercent"
              :class="{ 'cell-input-error': errorOf(row).warnPercent }"
              :controls="false"
              :step="1"
              :placeholder="`${limits.ranges.warnPercent.min}~${limits.ranges.warnPercent.max}`"
              style="width:100%"
              @change="markDirty"
            />
            <div v-if="errorOf(row).warnPercent" class="cell-error">{{ errorOf(row).warnPercent }}</div>
          </template>
        </el-table-column>

        <el-table-column label="启用" width="90" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" @change="markDirty" />
          </template>
        </el-table-column>

        <el-table-column label="备注" min-width="220">
          <template #default="{ row }">
            <el-input
              v-model="row.note"
              size="small"
              :maxlength="limits.ranges.noteMaxLen"
              show-word-limit
              placeholder="可选，如：为长篇小说准备的更高上限"
              @input="markDirty"
            />
            <div v-if="errorOf(row).note" class="cell-error">{{ errorOf(row).note }}</div>
          </template>
        </el-table-column>

        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">
            <div>{{ formatUpdatedAt(row.updatedAt) }}</div>
            <div v-if="row.updatedBy" style="color:var(--color-text-secondary);font-size: var(--font-size-xs)">
              操作人：{{ row.updatedBy }}
            </div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              :loading="resettingScope === row.scope"
              :disabled="saving || loading"
              @click="resetRow(row)"
            >恢复默认</el-button>
          </template>
        </el-table-column>
      </el-table>

      <p class="limit-footnote">
        允许范围：字数上限 {{ rangesText }}，预警阈值 {{ warnText }}（均须为整数）。
        输入框不会自动纠正取值：越界、小数或非法的值会被原样保留，并以行内提示拦截保存。
      </p>
    </el-card>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listStoryTextLimits, saveStoryTextLimits, resetStoryTextLimit } from '../api/storyTextLimits'
import { apiErrorMessage } from '../api/http'
// 保存/恢复默认的提示统一走既有「重启生效」装配层（单一真源见 constants/runtime-delivery.js）
import { emitSaveMessage } from './AppMenu.save-message'
import {
  DEFAULT_LIMITS,
  DEFAULT_RANGES,
  EFFECT_NOTICE_SAVE,
  EMPTY_TEXT,
  collectRowErrors,
  formatUpdatedAt,
  normalizeItems,
  pageDescription,
  parseLimitsEnvelope,
  resetDoneMessage,
  toSavePayload,
} from './story-text-limit-utils'

const items = ref([])
const loading = ref(false)
const saving = ref(false)
/** 正在恢复默认的 scope（空串 = 无操作进行中） */
const resettingScope = ref('')
const dirty = ref(false)
/**
 * 区间与默认值：**以后端下发的 defaults / ranges 为准**（后端调区间时前端自动跟随），
 * 只有响应缺这些字段时才用本地兜底常量（见 parseLimitsEnvelope）。
 */
const limits = ref({ ranges: DEFAULT_RANGES, defaults: DEFAULT_LIMITS })

const description = computed(() => pageDescription(limits.value.defaults))
const rangesText = computed(() => `${limits.value.ranges.maxChars.min}~${limits.value.ranges.maxChars.max}（整数）`)
const warnText = computed(() => `${limits.value.ranges.warnPercent.min}~${limits.value.ranges.warnPercent.max}（整数）`)

/**
 * 行内校验（随输入实时计算）：不合法的行在对应输入框飘红 + 行内中文提示，
 * 并禁用「保存」——越界值既不被组件改写，也不会被提交。
 */
const validationErrors = computed(() => {
  const map = {}
  for (const error of collectRowErrors(items.value, limits.value.ranges)) map[error.scope] = error
  return map
})
const hasErrors = computed(() => Object.keys(validationErrors.value).length > 0)

function errorOf(row) {
  return validationErrors.value[row.scope] || {}
}

function markDirty() {
  dirty.value = true
}

onMounted(load)

function applyEnvelope(data) {
  limits.value = parseLimitsEnvelope(data)
}

async function load() {
  loading.value = true
  try {
    const data = await listStoryTextLimits()
    applyEnvelope(data)
    items.value = normalizeItems(data?.items)
    dirty.value = false
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '加载字数控制配置失败'))
  } finally {
    loading.value = false
  }
}

async function saveAll() {
  if (!items.value.length) {
    ElMessage.warning('暂无可保存的配置')
    return
  }
  // 兜底校验（按钮已按 hasErrors 禁用；键盘/程序化触发仍走同一条判据）
  const rowErrors = collectRowErrors(items.value, limits.value.ranges)
  if (rowErrors.length) {
    ElMessage.error(rowErrors[0].messages[0])
    return
  }
  saving.value = true
  try {
    const payload = toSavePayload(items.value)
    const result = await saveStoryTextLimits(payload)
    applyEnvelope(result)
    const saved = normalizeItems(result?.items)
    items.value = saved.length ? saved : normalizeItems(payload)
    dirty.value = false
    // 「已保存 N 项；<重启生效提示>」，duration 6000ms（见 AppMenu.save-message.js / PRD-restart-hint）
    emitSaveMessage({ ok: true, count: result?.count ?? payload.length }, ElMessage)
  } catch (e) {
    emitSaveMessage({ ok: false, detail: apiErrorMessage(e, '保存失败') }, ElMessage)
  } finally {
    saving.value = false
  }
}

async function resetRow(row) {
  const label = row.scopeLabel || row.scope
  const { maxChars, warnPercent } = limits.value.defaults
  try {
    await ElMessageBox.confirm(
      `将「${label}」恢复为默认值：字数上限 ${maxChars} 字 / 预警阈值 ${warnPercent}%。`
        + '此操作会立即覆盖当前的已保存配置，是否继续？',
      '恢复默认',
      { type: 'warning', confirmButtonText: '恢复默认', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  resettingScope.value = row.scope
  try {
    const result = await resetStoryTextLimit(row.scope)
    applyEnvelope(result)
    const restored = normalizeItems(result?.items)
    if (restored.length) items.value = restored
    dirty.value = false
    // 「已恢复默认（N 字 / P%）；<重启生效提示>」
    emitSaveMessage(
      { ok: true, count: restored.length || 1 },
      ElMessage,
      resetDoneMessage(limits.value.defaults),
    )
  } catch (e) {
    emitSaveMessage({ ok: false, detail: apiErrorMessage(e, '恢复默认失败') }, ElMessage)
  } finally {
    resettingScope.value = ''
  }
}
</script>

<style scoped>
.limit-hint {
  line-height: 1.8;
  font-size: var(--font-size-sm);
}
.limit-footnote {
  margin-top: 12px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}
.cell-error {
  margin-top: 2px;
  color: var(--color-danger, #f56c6c);
  font-size: var(--font-size-xs);
  line-height: 1.3;
}
/* 校验不通过时输入框飘红（Element Plus 的 wrapper 是内层元素，需 :deep 穿透） */
:deep(.cell-input-error .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}
</style>

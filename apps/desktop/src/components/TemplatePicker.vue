<template>
  <div class="cohere-card" style="cursor:default;padding:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-md);padding-bottom:var(--space-sm);border-bottom:1px solid var(--border)">
      <span style="font-weight:600;font-size: var(--font-size-sm)"><el-icon><Document /></el-icon> 内容模板</span>
      <button class="cohere-btn-ghost" @click="$emit('close')" style="font-size: var(--font-size-xs);padding:2px 6px">✕</button>
    </div>

    <!-- Loading -->
    <div v-if="loading" style="padding:8px 0" data-testid="template-picker-loading">
      <UiSkeleton variant="list" :count="3" />
    </div>

    <!-- Error -->
    <div v-else-if="error" style="padding:12px 0;font-size: var(--font-size-sm);color:var(--coral)">
      {{ error }}
    </div>

    <!-- Templates by category -->
    <div v-else-if="Object.keys(grouped).length > 0">
      <div v-for="(list, cat) in grouped" :key="cat" style="margin-bottom:var(--space-md)">
        <div style="font-size: var(--font-size-xs);font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:6px">
          {{ categoryLabel(cat) }}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <div
            v-for="tpl in list"
            :key="tpl.id"
            class="template-item"
            @click="apply(tpl)"
            style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all 0.15s;background:var(--surface,#fff)"
            @mouseenter="$event.currentTarget.style.borderColor='var(--coral)'"
            @mouseleave="$event.currentTarget.style.borderColor='var(--border)'"
          >
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-weight:500;font-size: var(--font-size-sm)">{{ tpl.name }}</span>
              <span v-if="tpl.builtin" class="cohere-tag cohere-tag-info" style="font-size: var(--font-size-xs);padding:1px 6px">内置</span>
            </div>
            <div style="font-size: var(--font-size-xs);color:var(--muted);margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">
              {{ tpl.title || '(无标题)' }}
            </div>
            <div v-if="tpl.platforms && tpl.platforms.length > 0" style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">
              <span v-for="p in tpl.platforms" :key="p" class="cohere-tag cohere-tag-secondary" style="font-size: var(--font-size-xs);padding:1px 5px">{{ p }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty -->
    <div v-else style="padding:20px 0;text-align:center;font-size: var(--font-size-sm);color:var(--muted)">
      暂无模板。<br/>
      <button class="cohere-btn-ghost" @click="resetDefaults" style="font-size: var(--font-size-xs);margin-top:8px">恢复默认模板</button>
    </div>
  </div>
</template>

<script setup>
import { Document } from '@element-plus/icons-vue'
import { ref, computed, onMounted } from "vue"
import { getApi } from '@/api/electron-bridge'
import { useTemplateStore } from "@/stores/templates"
import { reportError } from "@/utils/report-error"
import { formatUserError } from "@/utils/user-facing-error"

const emit = defineEmits(["close", "apply"])

const store = useTemplateStore()
const loading = ref(false)
const error = ref(null)

const grouped = computed(() => store.byCategory)

function categoryLabel(cat) {
  const labels = { report: "报告", marketing: "营销", education: "教育", social: "社交" }
  return labels[cat] || cat
}

async function apply(tpl) {
  emit("apply", {
    title: tpl.title || "",
    content: tpl.content || "",
    platforms: tpl.platforms ? [...tpl.platforms] : [],
    tags: tpl.tags ? [...tpl.tags] : [],
  })
}

async function resetDefaults() {
  loading.value = true
  error.value = null
  try {
    const api = getApi()
    if (!api) return
    const presetsRes = await api.templateGetPresets()
    if (presetsRes && presetsRes.code === 0 && presetsRes.data) {
      for (const p of presetsRes.data) {
        await api.templateAdd(p)
      }
    }
    await store.load()
  } catch (e) {
    error.value = formatUserError(e, { fallback: '恢复默认模板失败' }).message
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await store.load()
  } catch (e) {
    reportError('加载模板库失败', e)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.template-item:hover {
  background: var(--soft-stone, #f8f4ff) !important;
}
</style>

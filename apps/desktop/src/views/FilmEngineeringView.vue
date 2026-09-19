<template>
  <div class="film-engineering-view">
    <h1 class="fe-title">{{ t('filmEngineering.title') }}</h1>
    <p class="fe-subtitle">{{ t('filmEngineering.subtitle') }}</p>

    <ConfigProfileManager
      pipeline-id="film-engineering"
      :pipeline-label="t('pipelines.names.film-engineering')"
      :snapshot="filmEngineeringProfileSnapshot"
      :dirty="filmEngineeringProfileDirty"
      test-id-prefix="film-engineering-config-profile"
      :on-list="loadConfigProfiles"
      :on-save="saveFilmEngineeringProfile"
      :on-apply="applyFilmEngineeringProfile"
      :on-rename="renameConfigProfile"
      :on-delete="deleteFilmEngineeringProfile"
    />

    <!-- 空态：kit 不可用 -->
    <el-card v-if="status && !status.available && !statusLoading" class="fe-card" shadow="never">
      <el-alert :title="t('filmEngineering.unavailable')" :description="t('filmEngineering.unavailableDesc')" type="error" show-icon :closable="false">
        <template #default>
          <div class="fe-empty-detail" v-if="status.error">{{ status.error }}</div>
        </template>
      </el-alert>
      <div class="fe-actions">
        <el-button type="primary" :loading="statusLoading" @click="refreshAll">{{ t('filmEngineering.retry') }}</el-button>
      </div>
    </el-card>

    <!-- 头部元信息 -->
    <el-card v-else-if="status && status.available" class="fe-card" shadow="never">
      <div class="fe-meta">
        <div class="fe-meta-title">{{ status.filmMeta.title }}</div>
        <div class="fe-meta-logline">{{ status.filmMeta.logline }}</div>
        <div class="fe-meta-row">
          <el-tag size="small">{{ t('filmEngineering.stats.duration') }} {{ formatDuration(status.filmMeta.durationSec) }}</el-tag>
          <el-tag size="small" type="info">{{ t('filmEngineering.stats.scenes') }} {{ status.sceneCount }}</el-tag>
          <el-tag size="small" type="info">{{ t('filmEngineering.stats.shots') }} {{ status.shotCount }}</el-tag>
          <el-tag size="small" type="info">{{ t('filmEngineering.stats.references') }} {{ status.referenceCount }}</el-tag>
          <el-link v-if="status.filmMeta.source && status.filmMeta.source.projectUrl" :href="status.filmMeta.source.projectUrl" target="_blank" type="primary" class="fe-meta-link">
            {{ t('filmEngineering.source') }}
          </el-link>
        </div>
        <div v-if="status.filmMeta.characters && status.filmMeta.characters.length" class="fe-meta-row">
          <span class="fe-meta-label">{{ t('filmEngineering.characters') }}：</span>
          <el-tooltip v-for="c in status.filmMeta.characters" :key="c.name" :content="c.descriptor || ''" placement="top">
            <el-tag size="small" effect="plain" class="fe-char-tag">{{ c.name }}</el-tag>
          </el-tooltip>
        </div>
      </div>
    </el-card>

    <el-tabs v-if="status && status.available" class="fe-tabs">
      <!-- ============ 分镜库 ============ -->
      <el-tab-pane :label="t('filmEngineering.tabs.library')">
        <div class="fe-layout">
          <!-- 场景树 -->
          <div class="fe-scenes">
            <div class="fe-pane-title">{{ t('filmEngineering.stats.scenes') }}（{{ scenes.length }}）</div>
            <el-tree
              :data="sceneTree"
              :props="{ label: 'name', children: 'children' }"
              node-key="id"
              highlight-current
              default-expand-all
              :expand-on-click-node="false"
              :loading="scenesLoading"
              @node-click="onSceneClick"
            >
              <template #default="{ data }">
                <span class="fe-scene-node">
                  <span class="fe-scene-name">{{ data.name }}</span>
                  <span v-if="data.shotCount" class="fe-scene-badge">{{ data.shotCount }}</span>
                </span>
              </template>
            </el-tree>
          </div>

          <!-- 分镜列表 -->
          <div class="fe-shots">
            <div v-if="!selectedSceneId" class="fe-empty">{{ t('filmEngineering.library.selectScene') }}</div>
            <template v-else>
              <div class="fe-toolbar">
                <el-checkbox :model-value="allSelectedInScene" :indeterminate="someSelectedInScene" @change="toggleAllInScene">
                  {{ t('filmEngineering.library.selectAll') }}
                </el-checkbox>
                <el-select v-model="copyMode" size="small" class="fe-mode-select">
                  <el-option :label="t('filmEngineering.library.copyModeFull')" value="full" />
                  <el-option :label="t('filmEngineering.library.copyModeBlocks')" value="blocks" />
                  <el-option :label="t('filmEngineering.library.copyModeCharacters')" value="characters" />
                  <el-option :label="t('filmEngineering.library.copyModeGeo')" value="geo" />
                </el-select>
                <el-button size="small" data-testid="fe-copy-selected" :disabled="selectedShotIds.length === 0" @click="copySelected">{{ t('filmEngineering.library.copySelected') }}（{{ selectedShotIds.length }}）</el-button>
                <el-button size="small" data-testid="fe-export-json" :disabled="selectedShotIds.length === 0" :loading="exportLoading" @click="() => exportSelected('json')">{{ t('filmEngineering.library.exportJson') }}</el-button>
                <el-button size="small" data-testid="fe-export-markdown" :disabled="selectedShotIds.length === 0" :loading="exportLoading" @click="() => exportSelected('markdown')">{{ t('filmEngineering.library.exportMd') }}</el-button>
                <el-button size="small" type="primary" data-testid="fe-generate" :disabled="selectedShotIds.length === 0 || selectedShotIds.length > 20" :loading="generating" @click="onGenerate">
                  {{ t('filmEngineering.library.generate') }}
                </el-button>
              </div>
              <div v-if="shotsLoading" v-loading="shotsLoading" class="fe-shots-loading" />
              <div v-else-if="shots.length === 0" class="fe-empty">{{ t('filmEngineering.library.empty') }}</div>
              <div v-else class="fe-shot-list">
                <div v-for="s in shots" :key="s.shotId" class="fe-shot-card" :class="{ 'is-selected': selectedShotIds.includes(s.shotId) }">
                  <el-checkbox :model-value="selectedShotIds.includes(s.shotId)" @change="() => toggleShot(s.shotId)" class="fe-shot-check" />
                  <div class="fe-shot-body" @click="onOpenShot(s.shotId)">
                    <div class="fe-shot-head">
                      <el-tag size="small" type="info">{{ s.model }}</el-tag>
                      <el-tag v-if="s.width && s.height" size="small" effect="plain">{{ s.width }}×{{ s.height }}</el-tag>
                      <span class="fe-shot-id">{{ s.shotId.slice(0, 8) }}</span>
                    </div>
                    <div class="fe-shot-prompt">{{ promptPreview(s.prompt) }}</div>
                  </div>
                  <el-button size="small" class="fe-shot-copy" @click="copyText(s.shotId, 'full')">{{ t('filmEngineering.library.copyFull') }}</el-button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </el-tab-pane>

      <!-- ============ 剧本套用 ============ -->
      <el-tab-pane :label="t('filmEngineering.tabs.adapt')">
        <div class="fe-adapt">
          <el-card shadow="never" class="fe-card">
            <template #header>{{ t('filmEngineering.adapt.scriptLabel') }}</template>
            <el-input
              v-model="adapt.script"
              type="textarea"
              :rows="8"
              maxlength="10000"
              show-word-limit
              :placeholder="t('filmEngineering.adapt.scriptPlaceholder')"
            />
            <div class="fe-adapt-roles">
              <div class="fe-adapt-roles-title">
                {{ t('filmEngineering.adapt.roleMapTitle') }}
                <span class="fe-hint">{{ t('filmEngineering.adapt.roleMapHint') }}</span>
              </div>
              <div v-for="(entry, i) in roleEntries" :key="'role-' + i" class="fe-role-row">
                <el-input v-model="entry.key" size="small" :placeholder="t('filmEngineering.adapt.roleKeyPlaceholder')" class="fe-role-key" />
                <el-input v-model="entry.value" size="small" :placeholder="t('filmEngineering.adapt.roleValuePlaceholder')" class="fe-role-value" />
                <el-button v-if="i >= 4" size="small" text type="danger" @click="removeRole(i)">{{ t('filmEngineering.adapt.removeRole') }}</el-button>
              </div>
              <el-button v-if="roleEntries.length < 10" size="small" text type="primary" @click="addRole">{{ t('filmEngineering.adapt.addRole') }}</el-button>
            </div>
            <div class="fe-adapt-actions">
              <el-checkbox v-model="adapt.llmEnabled">{{ t('filmEngineering.adapt.llmEnabled') }}</el-checkbox>
              <el-button type="primary" :loading="adapt.loading" @click="onAdapt">{{ t('filmEngineering.adapt.adaptBtn') }}</el-button>
            </div>
          </el-card>

          <el-card v-if="adapt.adaptedShots.length" shadow="never" class="fe-card">
            <template #header>{{ t('filmEngineering.adapt.resultTitle') }}（{{ adapt.adaptedShots.length }} {{ t('filmEngineering.adapt.resultCount') }}）</template>
            <el-alert v-if="adapt.warnings.length" :title="t('filmEngineering.adapt.warningsTitle')" type="warning" :closable="false" class="fe-warn">
              <div v-for="(w, i) in adapt.warnings" :key="i" class="fe-warn-item">{{ w }}</div>
            </el-alert>
            <div v-for="(shot, i) in adapt.adaptedShots" :key="shot.shotId" class="fe-adapted-card">
              <div class="fe-adapted-head">
                <span class="fe-adapted-no">#{{ i + 1 }}</span>
                <el-tag size="small" type="info">{{ shot.model }}</el-tag>
                <el-tag v-if="shot.sourceTemplateId" size="small" effect="plain">{{ shot.sourceTemplateId.slice(0, 8) }}</el-tag>
                <el-button size="small" class="fe-adapted-copy" @click="copyAdaptedShot(shot, i)">{{ t('filmEngineering.adapt.copyShot') }}</el-button>
              </div>
              <div class="fe-adapted-prompt">{{ promptPreview(shot.prompt) }}</div>
            </div>
          </el-card>
          <el-empty v-else-if="!adapt.loading" :description="t('filmEngineering.adapt.noResult')" />
        </div>
      </el-tab-pane>

      <!-- ============ 方法论 ============ -->
      <el-tab-pane :label="t('filmEngineering.tabs.doctrine')">
        <div v-if="doctrine" class="fe-doctrine">
          <el-card shadow="never" class="fe-card">
            <template #header>{{ t('filmEngineering.doctrine.blocks') }}</template>
            <div v-for="b in doctrine.blocks" :key="b.key" class="fe-doctrine-block">
              <div class="fe-doctrine-label">{{ b.label }}</div>
              <div class="fe-doctrine-zh">{{ b.zh }}</div>
              <div class="fe-doctrine-en">{{ t('filmEngineering.doctrine.en') }}：{{ b.en }}</div>
            </div>
          </el-card>
          <el-card shadow="never" class="fe-card">
            <template #header>{{ t('filmEngineering.doctrine.rules') }}</template>
            <div v-for="(r, i) in doctrine.rules" :key="r.key" class="fe-doctrine-rule">
              <b>{{ i + 1 }}. {{ r.title }}</b>
              <div class="fe-doctrine-zh">{{ r.zh }}</div>
            </div>
          </el-card>
          <el-card shadow="never" class="fe-card">
            <template #header>{{ t('filmEngineering.doctrine.glossary') }}</template>
            <div v-for="g in doctrine.glossary" :key="g.term" class="fe-doctrine-glossary">
              <el-tag size="small" type="info">{{ g.term }}</el-tag>
              <span class="fe-doctrine-glossary-zh">{{ g.zh }}</span>
            </div>
            <div class="fe-hint fe-doctrine-note">{{ t('filmEngineering.doctrine.linkNote') }}</div>
          </el-card>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 分镜详情抽屉 -->
    <el-drawer v-model="detailOpen" :title="t('filmEngineering.library.shotDetail')" size="min(720px, 92vw)">
      <div v-if="shotDetail" v-loading="detailLoading" class="fe-detail">
        <div class="fe-detail-head">
          <el-tag size="small" type="info">{{ shotDetail.model }}</el-tag>
          <el-tag v-if="shotDetail.width && shotDetail.height" size="small" effect="plain">{{ shotDetail.width }}×{{ shotDetail.height }}</el-tag>
          <span class="fe-shot-id">{{ shotDetail.shotId }}</span>
        </div>
        <div class="fe-detail-copies">
          <el-button size="small" data-testid="fe-detail-copy" @click="copyText(shotDetail.shotId, 'full')">{{ t('filmEngineering.library.copyFull') }}</el-button>
          <el-button size="small" @click="copyText(shotDetail.shotId, 'blocks')">{{ t('filmEngineering.library.copyBlocks') }}</el-button>
          <el-button size="small" @click="copyText(shotDetail.shotId, 'characters')">{{ t('filmEngineering.library.copyCharacters') }}</el-button>
          <el-button size="small" @click="copyText(shotDetail.shotId, 'geo')">{{ t('filmEngineering.library.copyGeo') }}</el-button>
        </div>
        <div class="fe-detail-section">
          <div class="fe-pane-title">{{ t('filmEngineering.library.refTokens') }}</div>
          <div v-if="shotDetail.resolvedRefs && shotDetail.resolvedRefs.length" class="fe-refs">
            <div v-for="ref in shotDetail.resolvedRefs" :key="ref.token" class="fe-ref">
              <img v-if="ref.entry.imageUrls && ref.entry.imageUrls.length" :src="ref.entry.imageUrls[0]" class="fe-ref-img" loading="lazy" referrerpolicy="no-referrer" alt="" />
              <div class="fe-ref-meta">
                <div class="fe-ref-name">
                  <el-tag size="small" :type="ref.entry.kind === 'unknown' ? 'danger' : 'info'">{{ ref.entry.name || t('filmEngineering.library.refUnknown') }}</el-tag>
                  <el-tag v-if="ref.entry.kind !== 'unknown'" size="small" effect="plain">{{ ref.entry.kind }}</el-tag>
                </div>
                <div class="fe-ref-token">
                  <code>{{ ref.token }}</code>
                  <el-button size="small" text type="primary" @click="copyRefToken(ref.token)">{{ t('filmEngineering.library.copyToken') }}</el-button>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="fe-empty">{{ t('filmEngineering.library.refUnknown') }}</div>
        </div>
        <div class="fe-detail-section">
          <div class="fe-pane-title">{{ t('filmEngineering.library.copyModeFull') }}</div>
          <div class="fe-prompt-box">
            <pre class="fe-prompt-text">{{ expanded ? shotDetail.prompt : promptPreview(shotDetail.prompt, 4000) }}</pre>
            <el-button size="small" text type="primary" @click="expanded = !expanded">
              {{ expanded ? t('filmEngineering.library.collapsePrompt') : t('filmEngineering.library.expandPrompt') }}
            </el-button>
          </div>
        </div>
      </div>
    </el-drawer>

    <!-- 生成结果 -->
    <el-dialog v-model="generateDialogOpen" :title="t('filmEngineering.library.generateResultTitle')" width="560px">
      <div v-if="generateResults" class="fe-gen-results">
        <div v-for="r in generateResults" :key="r.index" class="fe-gen-row">
          <span class="fe-gen-shot">{{ r.shotId ? r.shotId.slice(0, 8) : r.index }}</span>
          <el-tag :type="r.code === 0 ? 'success' : 'danger'" size="small">
            {{ r.code === 0 ? t('filmEngineering.library.generateSuccess') : t('filmEngineering.library.generateFail') }}
          </el-tag>
          <span class="fe-gen-msg">{{ r.message || '' }}</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFilmEngineering } from '@/composables/useFilmEngineering'
import ConfigProfileManager from '@/components/ConfigProfileManager.vue'

const { t } = useI18n()
const {
  status, statusLoading, scenes, scenesLoading, selectedSceneId, shots, shotsLoading,
  shotDetail, detailLoading, doctrine, selectedShotIds, copyMode,
  generating, exportLoading, adapt,
  refreshAll, selectScene, openShot, toggleShot, toggleAllInScene,
  copyText, copySelected, exportSelected, generateSelected, adaptScript, copyAdaptedShot,
  buildConfigProfileSnapshot, applyConfigProfileSnapshot,
  loadConfigProfiles, saveConfigProfile, renameConfigProfile, deleteConfigProfile,
} = useFilmEngineering()

const detailOpen = ref(false)
const expanded = ref(false)
const generateDialogOpen = ref(false)
const generateResults = ref(null)

// 角色映射输入（前 4 个为 Hell Grind 主角预设）
const roleEntries = reactive([
  { key: 'ROKO', value: '' },
  { key: 'JAXX', value: '' },
  { key: 'LULU', value: '' },
  { key: 'REIN', value: '' },
])

const filmEngineeringProfileSnapshot = computed(() => buildConfigProfileSnapshot(roleEntries))
const filmEngineeringProfileDirty = computed(() => (
  copyMode.value !== 'full' ||
  adapt.llmEnabled === true ||
  roleEntries.some((entry) => Boolean(String(entry?.key || '').trim() && String(entry?.value || '').trim()))
))

function saveFilmEngineeringProfile (name, options = {}) {
  return saveConfigProfile(name, roleEntries, options)
}

function applyFilmEngineeringProfile (profile) {
  return applyConfigProfileSnapshot(profile?.snapshot, roleEntries)
}

function deleteFilmEngineeringProfile (profile) {
  return deleteConfigProfile(profile?.id)
}

const sceneTree = computed(() => {
  const map = new Map()
  const roots = []
  for (const s of scenes.value) {
    map.set(s.id, { id: s.id, name: s.name, count: s.count, shotCount: s.shotCount, children: [] })
  }
  for (const s of scenes.value) {
    const node = map.get(s.id)
    const parent = map.get(s.parentId)
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  return roots
})

const allSelectedInScene = computed(() => {
  const ids = shots.value.map((s) => s.shotId)
  return ids.length > 0 && ids.every((id) => selectedShotIds.value.includes(id))
})
const someSelectedInScene = computed(() => {
  const ids = shots.value.map((s) => s.shotId)
  return ids.some((id) => selectedShotIds.value.includes(id)) && !allSelectedInScene.value
})

function formatDuration (sec) {
  if (!Number.isFinite(Number(sec))) return String(sec)
  const m = Math.floor(Number(sec) / 60)
  const s = Number(sec) % 60
  return m + 'm' + String(Math.round(s)).padStart(2, '0') + 's'
}

function promptPreview (text, max = 260) {
  const t2 = String(text || '')
  if (t2.length <= max) return t2
  return t2.slice(0, max) + ' …'
}

function onSceneClick (node) {
  selectScene(node.id)
}

async function onOpenShot (shotId) {
  detailOpen.value = true
  await openShot(shotId)
}

function onGenerate () {
  generateSelected().then((data) => {
    if (data) {
      generateResults.value = data.results || []
      generateDialogOpen.value = true
    }
  })
}

function onAdapt () {
  if (!adapt.script || !adapt.script.trim()) return
  adapt.characterMap = {}
  for (const entry of roleEntries) {
    if (entry.key && entry.key.trim() && entry.value && entry.value.trim()) {
      adapt.characterMap[entry.key.trim()] = entry.value.trim()
    }
  }
  adaptScript()
}

function addRole () {
  if (roleEntries.length >= 10) return
  roleEntries.push({ key: '', value: '' })
}

function removeRole (i) {
  roleEntries.splice(i, 1)
}

async function copyRefToken (token) {
  try {
    await navigator.clipboard.writeText(token)
  } catch (_) {
    /* 静默 */
  }
}

onMounted(() => {
  refreshAll()
})
</script>

<style scoped>
.film-engineering-view { max-width: 1240px; margin: 24px auto; padding: 0 16px; }
.fe-title { font-size: 20px; margin-bottom: 4px; }
.fe-subtitle { color: #909399; font-size: 13px; margin-bottom: 16px; }
.fe-card { margin-bottom: 16px; }
.fe-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.fe-meta-title { font-size: 18px; font-weight: 600; }
.fe-meta-logline { color: #606266; font-size: 13px; margin: 6px 0 10px; }
.fe-meta-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.fe-meta-label { color: #606266; font-size: 13px; }
.fe-char-tag { margin-right: 4px; }
.fe-meta-link { margin-left: 8px; }
.fe-layout { display: flex; gap: 16px; align-items: flex-start; }
.fe-scenes { width: 300px; min-width: 240px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 12px; max-height: 70vh; overflow: auto; }
.fe-shots { flex: 1; min-width: 0; }
.fe-pane-title { font-weight: 600; margin-bottom: 8px; font-size: 14px; }
.fe-scene-node { display: flex; align-items: center; gap: 6px; flex: 1; }
.fe-scene-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fe-scene-badge { background: var(--el-color-primary-light-8); color: var(--el-color-primary); border-radius: 8px; padding: 0 6px; font-size: 12px; }
.fe-empty { color: #909399; padding: 24px 0; text-align: center; }
.fe-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.fe-mode-select { width: 150px; }
.fe-shots-loading { min-height: 120px; }
.fe-shot-list { display: flex; flex-direction: column; gap: 8px; }
.fe-shot-card { display: flex; align-items: flex-start; gap: 8px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px 12px; }
.fe-shot-card.is-selected { border-color: var(--el-color-primary); }
.fe-shot-check { margin-top: 4px; }
.fe-shot-body { flex: 1; min-width: 0; cursor: pointer; }
.fe-shot-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.fe-shot-id { color: #c0c4cc; font-size: 12px; }
.fe-shot-prompt { color: #606266; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.fe-shot-copy { flex-shrink: 0; }
.fe-adapt-roles { margin-top: 14px; }
.fe-adapt-roles-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.fe-hint { color: #909399; font-size: 12px; font-weight: 400; margin-left: 8px; }
.fe-role-row { display: flex; gap: 8px; margin-bottom: 8px; }
.fe-role-key { width: 200px; }
.fe-role-value { flex: 1; }
.fe-adapt-actions { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.fe-warn { margin-bottom: 12px; }
.fe-warn-item { font-size: 13px; }
.fe-adapted-card { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.fe-adapted-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.fe-adapted-no { font-weight: 600; }
.fe-adapted-copy { margin-left: auto; }
.fe-adapted-prompt { color: #606266; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.fe-doctrine-block, .fe-doctrine-rule { margin-bottom: 14px; }
.fe-doctrine-label { font-weight: 600; color: var(--el-color-primary); font-size: 14px; }
.fe-doctrine-zh { color: #303133; font-size: 13px; margin-top: 4px; line-height: 1.6; }
.fe-doctrine-en { color: #909399; font-size: 12px; margin-top: 2px; }
.fe-doctrine-glossary { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.fe-doctrine-glossary-zh { font-size: 13px; color: #303133; }
.fe-doctrine-note { margin-top: 12px; }
.fe-detail-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.fe-detail-copies { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.fe-detail-section { margin-bottom: 18px; }
.fe-refs { display: flex; flex-direction: column; gap: 8px; }
.fe-ref { display: flex; gap: 10px; align-items: flex-start; }
.fe-ref-img { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; background: #f2f3f5; }
.fe-ref-meta { min-width: 0; }
.fe-ref-name { display: flex; gap: 6px; margin-bottom: 4px; }
.fe-ref-token { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #909399; }
.fe-ref-token code { word-break: break-all; }
.fe-prompt-box { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px; }
.fe-prompt-text { margin: 0 0 8px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; max-height: 46vh; overflow: auto; }
.fe-gen-results { max-height: 50vh; overflow: auto; }
.fe-gen-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.fe-gen-shot { font-family: monospace; font-size: 12px; width: 80px; }
.fe-gen-msg { color: #909399; font-size: 12px; }
.fe-empty-detail { color: #909399; font-size: 12px; margin-top: 8px; word-break: break-all; }
.fe-actions { margin-top: 14px; }
</style>

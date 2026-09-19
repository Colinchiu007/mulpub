<template>
  <section class="override-panel" aria-label="平台差异化内容">
    <div class="override-panel__header">
      <div>
        <h3 class="override-panel__title">平台差异化内容</h3>
        <p class="override-panel__hint">为不同平台设置独立标题或正文，留空时使用默认内容。</p>
      </div>
    </div>

    <div class="override-list">
      <article v-for="platform in platforms" :key="platform.id" class="override-item">
        <div class="override-item__header">
          <label class="override-toggle">
            <input
              :data-testid="'override-toggle-' + platform.id"
              type="checkbox"
              :checked="isEnabled(platform.id)"
              @change="toggle(platform.id)"
            />
            <span>{{ platform.label }}</span>
          </label>
          <span v-if="isEnabled(platform.id)" class="override-state">已启用</span>
        </div>

        <div v-if="isEnabled(platform.id)" class="override-fields">
          <label class="override-field">
            <span>标题 <small v-if="platform.titleMax">最多 {{ platform.titleMax }} 字</small></span>
            <input
              :data-testid="'override-title-' + platform.id"
              :value="getValue(platform.id, 'title')"
              type="text"
              :maxlength="platform.titleMax || undefined"
              placeholder="使用默认标题"
              @input="updateField(platform.id, 'title', $event.target.value)"
            />
          </label>
          <label class="override-field">
            <span>正文 <small v-if="platform.contentMax">最多 {{ platform.contentMax }} 字</small></span>
            <textarea
              :data-testid="'override-content-' + platform.id"
              :value="getValue(platform.id, 'content')"
              :maxlength="platform.contentMax || undefined"
              rows="4"
              placeholder="使用默认正文"
              @input="updateField(platform.id, 'content', $event.target.value)"
            />
          </label>
          <template v-if="platform.id === 'zhihu'">
            <label class="override-field">
              <span>评论权限</span>
              <select
                :data-testid="'override-comment-permission-' + platform.id"
                :value="getValue(platform.id, 'commentPermission')"
                @change="updateField(platform.id, 'commentPermission', $event.target.value)"
              >
                <option value="anyone">允许所有人评论</option>
              </select>
            </label>
            <label class="override-field">
              <span>创作声明</span>
              <select
                :data-testid="'override-declare-' + platform.id"
                :value="getValue(platform.id, 'declare')"
                @change="updateField(platform.id, 'declare', $event.target.value)"
              >
                <option v-for="statement in zhihuStatements" :key="statement.value" :value="statement.value">
                  {{ statement.label }}
                </option>
              </select>
            </label>
            <label class="override-field">
              <span>话题</span>
              <input
                :data-testid="'override-topics-' + platform.id"
                :value="getValue(platform.id, 'topics').join(', ')
                "
                type="text"
                placeholder="用逗号分隔话题"
                @input="updateField(platform.id, 'topics', $event.target.value)"
              />
            </label>
            <label class="override-check">
              <input
                :data-testid="'override-draft-' + platform.id"
                :checked="Boolean(getValue(platform.id, 'draft'))"
                type="checkbox"
                @change="updateField(platform.id, 'draft', $event.target.checked)"
              />
              <span>保存为草稿</span>
            </label>
          </template>
          <template v-else-if="platform.id === 'douyin'">
            <label class="override-check">
              <input
                :data-testid="'override-draft-' + platform.id"
                :checked="Boolean(getValue(platform.id, 'draft'))"
                type="checkbox"
                @change="updateField(platform.id, 'draft', $event.target.checked)"
              />
              <span>保存为草稿</span>
            </label>
          </template>
          <template v-else-if="platform.id === 'wechat_mp'">
            <label class="override-field">
              <span>摘要 <small>最多 120 字，留空自动取正文开头</small></span>
              <textarea
                :data-testid="'override-digest-' + platform.id"
                :value="getValue(platform.id, 'digest')"
                rows="2"
                maxlength="120"
                placeholder="公众号图文摘要（选填）"
                @input="updateField(platform.id, 'digest', $event.target.value)"
              />
            </label>
            <label class="override-check">
              <input
                :data-testid="'override-mass-send-' + platform.id"
                :checked="Boolean(getValue(platform.id, 'massSend'))"
                type="checkbox"
                @change="updateField(platform.id, 'massSend', $event.target.checked)"
              />
              <span>保存草稿后群发</span>
            </label>
            <label class="override-check">
              <input
                :data-testid="'override-open-comment-' + platform.id"
                :checked="getValue(platform.id, 'openComment') !== false"
                type="checkbox"
                @change="updateField(platform.id, 'openComment', $event.target.checked)"
              />
              <span>开启留言（评论）</span>
            </label>
          </template>
          <template v-else-if="platform.id === 'bilibili'">
            <label class="override-field">
              <span>分区</span>
              <select
                :data-testid="'override-category-' + platform.id"
                :value="getValue(platform.id, 'category')"
                @change="updateField(platform.id, 'category', $event.target.value)"
              >
                <option v-for="cat in bilibiliCategories" :key="cat.value" :value="cat.value">
                  {{ cat.label }}
                </option>
              </select>
            </label>
            <label class="override-field">
              <span>版权声明</span>
              <select
                :data-testid="'override-copyright-' + platform.id"
                :value="getValue(platform.id, 'copyright')"
                @change="updateField(platform.id, 'copyright', $event.target.value)"
              >
                <option :value="2">转载</option>
                <option :value="1">自制</option>
              </select>
            </label>
            <label class="override-field">
              <span>加入合集（可选）</span>
              <div class="collection-picker">
                <button
                  type="button"
                  class="collection-picker__btn"
                  :data-testid="'override-collection-fetch-' + platform.id"
                  :disabled="collectionLoading[platform.id]"
                  @click="fetchCollections(platform.id)"
                >{{ collectionLoading[platform.id] ? '拉取中…' : '拉取我的合集' }}</button>
                <select
                  :data-testid="'override-collection-id-' + platform.id"
                  :value="getValue(platform.id, 'collectionId')"
                  @change="updateField(platform.id, 'collectionId', $event.target.value)"
                >
                  <option value="">不加入合集</option>
                  <option v-if="!collectionOptions[platform.id] || collectionOptions[platform.id].length === 0" :value="getValue(platform.id, 'collectionId')">
                    {{ getValue(platform.id, 'collectionId') ? 'ID: ' + getValue(platform.id, 'collectionId') : '（先拉取或手输）' }}
                  </option>
                  <option v-for="col in collectionOptions[platform.id] || []" :key="col.id" :value="col.id">
                    {{ col.name }}（{{ col.id }}）
                  </option>
                </select>
              </div>
              <input
                :data-testid="'override-collection-id-input-' + platform.id"
                :value="getValue(platform.id, 'collectionId')"
                type="text"
                inputmode="numeric"
                placeholder="或手输合集 ID"
                @input="updateField(platform.id, 'collectionId', $event.target.value)"
              />
            </label>
          </template>
          <template v-else-if="platform.id === 'youtube'">
            <label class="override-field">
              <span>分类</span>
              <select
                :data-testid="'override-category-id-' + platform.id"
                :value="getValue(platform.id, 'categoryId')"
                @change="updateField(platform.id, 'categoryId', $event.target.value)"
              >
                <option v-for="cat in youtubeCategories" :key="cat.value" :value="cat.value">
                  {{ cat.label }}
                </option>
              </select>
            </label>
            <label class="override-field">
              <span>可见性</span>
              <select
                :data-testid="'override-privacy-' + platform.id"
                :value="getValue(platform.id, 'privacy')"
                @change="updateField(platform.id, 'privacy', $event.target.value)"
              >
                <option value="public">公开</option>
                <option value="unlisted">不公开列出</option>
                <option value="private">私享</option>
              </select>
            </label>
            <label class="override-field">
              <span>播放列表（可选，填播放列表 ID）</span>
              <input
                :data-testid="'override-playlist-id-' + platform.id"
                :value="getValue(platform.id, 'playlistId')"
                type="text"
                placeholder="播放列表 ID，如 PLabc123"
                @input="updateField(platform.id, 'playlistId', $event.target.value)"
              />
            </label>
          </template>
          <template v-else-if="platform.id === 'tiktok'">
            <label class="override-field">
              <span>可见性</span>
              <select
                :data-testid="'override-privacy-level-' + platform.id"
                :value="getValue(platform.id, 'privacyLevel')"
                @change="updateField(platform.id, 'privacyLevel', $event.target.value)"
              >
                <option value="PUBLIC">所有人可见</option>
                <option value="FRIENDS">朋友可见</option>
                <option value="PRIVATE">仅自己可见</option>
              </select>
            </label>
          </template>
          <template v-else-if="platform.id === 'baijiahao'">
            <label class="override-check">
              <input
                :data-testid="'override-original-' + platform.id"
                :checked="Boolean(getValue(platform.id, 'original'))"
                type="checkbox"
                @change="updateField(platform.id, 'original', $event.target.checked)"
              />
              <span>原创声明</span>
            </label>
            <label class="override-field">
              <span>位置（可选，留空不声明）</span>
              <input
                :data-testid="'override-location-' + platform.id"
                :value="getValue(platform.id, 'locationName')"
                type="text"
                placeholder="如：北京·三里屯"
                @input="updateField(platform.id, 'locationName', $event.target.value)"
              />
            </label>
            <label class="override-field">
              <span>加入合集（可选）</span>
              <div class="collection-picker">
                <button
                  type="button"
                  class="collection-picker__btn"
                  :data-testid="'override-collection-fetch-' + platform.id"
                  :disabled="collectionLoading[platform.id]"
                  @click="fetchCollections(platform.id)"
                >{{ collectionLoading[platform.id] ? '拉取中…' : '拉取我的合集' }}</button>
              </div>
              <input
                :data-testid="'override-collection-id-' + platform.id"
                :value="getValue(platform.id, 'collectionIdText')"
                type="text"
                placeholder="格式：合集ID 或 合集ID:名称"
                @input="updateField(platform.id, 'collectionIdText', $event.target.value)"
              />
            </label>
          </template>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { reactive } from 'vue'
import { listPlatformCollections } from '@/api/publisher'

const props = defineProps({
  platforms: { type: Array, default: () => [] },
  modelValue: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['update:modelValue'])

// P3-7：合集列表拉取状态
const collectionOptions = reactive({})
const collectionLoading = reactive({})

async function fetchCollections (platformId) {
  if (collectionLoading[platformId]) return
  collectionLoading[platformId] = true
  try {
    const result = await listPlatformCollections(platformId)
    if (result?.code === 0 && Array.isArray(result.data)) {
      collectionOptions[platformId] = result.data
    }
  } catch (_) {
    collectionOptions[platformId] = []
  } finally {
    collectionLoading[platformId] = false
  }
}

const zhihuStatements = [
  { value: 0, label: '无申明' },
  { value: 1, label: '包含剧透' },
  { value: 2, label: '包含医疗建议' },
  { value: 3, label: '虚构创作' },
  { value: 4, label: '包含理财内容' },
  { value: 5, label: '包含 AI 辅助创作' },
]

// B站分区（tid）：常用分区映射（参考产品 subCategory.sourceId → parseInt → tid）
const bilibiliCategories = [
  { value: 21, label: '日常' },
  { value: 17, label: '单机游戏' },
  { value: 171, label: '电子竞技' },
  { value: 124, label: '影视' },
  { value: 231, label: '科技·数码·手机' },
  { value: 138, label: '搞笑' },
  { value: 119, label: '鬼畜' },
  { value: 217, label: '动物圈' },
  { value: 207, label: '时尚' },
  { value: 251, label: '资讯' },
]

// YouTube 分类（categoryId）：常用分类（默认 22 = People & Blogs）
const youtubeCategories = [
  { value: '22', label: '人物与博客' },
  { value: '10', label: '音乐' },
  { value: '20', label: '游戏' },
  { value: '24', label: '娱乐' },
  { value: '28', label: '科技' },
  { value: '27', label: '教育' },
  { value: '17', label: '体育' },
  { value: '19', label: '旅行' },
  { value: '23', label: '喜剧' },
  { value: '25', label: '新闻政治' },
]

function defaultOverride (platformId) {
  if (platformId === 'zhihu') {
    return { title: '', content: '', commentPermission: 'anyone', declare: 0, topics: [], draft: false }
  }
  if (platformId === 'bilibili') return { title: '', content: '', category: 21, copyright: 2, collectionId: '' }
  if (platformId === 'youtube') return { title: '', content: '', categoryId: '22', privacy: 'public', playlistId: '' }
  if (platformId === 'tiktok') return { title: '', content: '', privacyLevel: 'PUBLIC' }
  if (platformId === 'baijiahao') return { title: '', content: '', original: false, locationName: '', collectionIdText: '' }
  if (platformId === 'wechat_mp') return { title: '', content: '', digest: '', massSend: false, openComment: true }
  return { title: '', content: '' }
}

function normalizeValue (platformId, field, value) {
  if (platformId === 'zhihu' && field === 'declare') {
    const number = Number(value)
    return Number.isInteger(number) && number >= 0 && number <= 5 ? number : 0
  }
  if (platformId === 'zhihu' && field === 'commentPermission') return 'anyone'
  if (platformId === 'zhihu' && field === 'topics') {
    return [...new Set(String(value || '').split(/[,，]/).map(item => item.trim()).filter(Boolean))]
  }
  if ((platformId === 'zhihu' || platformId === 'douyin') && field === 'draft') return Boolean(value)
  if (platformId === 'wechat_mp' && field === 'massSend') return Boolean(value)
  if (platformId === 'wechat_mp' && field === 'digest') return String(value || '').slice(0, 120)
  if (platformId === 'wechat_mp' && field === 'openComment') return Boolean(value)
  if (platformId === 'bilibili' && field === 'category') {
    const n = Number(value)
    return Number.isInteger(n) && n > 0 ? n : 21
  }
  if (platformId === 'bilibili' && field === 'copyright') {
    const n = Number(value)
    return n === 1 || n === 2 ? n : 2
  }
  if (platformId === 'bilibili' && field === 'collectionId') {
    const s = String(value || '').trim()
    return /^\d+$/.test(s) ? Number(s) : ''
  }
  if (platformId === 'youtube' && field === 'categoryId') {
    const s = String(value || '').trim()
    return /^\d{1,2}$/.test(s) ? s : '22'
  }
  if (platformId === 'youtube' && field === 'privacy') {
    return ['public', 'unlisted', 'private'].includes(value) ? value : 'public'
  }
  if (platformId === 'tiktok' && field === 'privacyLevel') {
    return ['PUBLIC', 'PRIVATE', 'FRIENDS'].includes(value) ? value : 'PUBLIC'
  }
  if (platformId === 'youtube' && field === 'playlistId') {
    return String(value || '').trim().slice(0, 60)
  }
  if (platformId === 'baijiahao' && field === 'original') return Boolean(value)
  if (platformId === 'baijiahao' && field === 'locationName') return String(value || '').slice(0, 60)
  // 百家号合集输入：'ID' 或 'ID:名称' → collection 对象
  if (platformId === 'baijiahao' && field === 'collectionIdText') {
    return String(value || '').slice(0, 100)
  }
  return value
}

function cloneModel () {
  return JSON.parse(JSON.stringify(props.modelValue || {}))
}

function isEnabled (platformId) {
  return Boolean(props.modelValue && props.modelValue[platformId])
}

function getValue (platformId, field) {
  const current = props.modelValue?.[platformId]
  if (current && current[field] !== undefined) return current[field]
  return defaultOverride(platformId)[field] ?? ''
}

function toggle (platformId) {
  const next = cloneModel()
  if (next[platformId]) delete next[platformId]
  else next[platformId] = defaultOverride(platformId)
  emit('update:modelValue', next)
}

function updateField (platformId, field, value) {
  const next = cloneModel()
  next[platformId] = {
    ...defaultOverride(platformId),
    ...(next[platformId] || {}),
    [field]: normalizeValue(platformId, field, value),
  }
  emit('update:modelValue', next)
}
</script>

<style scoped>
.override-panel { display: flex; flex-direction: column; gap: 12px; }
.override-panel__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.override-panel__title { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary, #202124); }
.override-panel__hint { margin: 4px 0 0; color: var(--muted, #8a8f98); font-size: 12px; }
.override-list { display: grid; gap: 8px; }
.override-item { border: 1px solid var(--border-light, #e8eaed); border-radius: 6px; padding: 10px 12px; background: var(--surface, #fff); }
.override-item__header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.override-toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--text-primary, #202124); }
.override-toggle input { accent-color: var(--coral, #f56c6c); }
.override-state { color: var(--action-blue, #1890ff); font-size: 11px; }
.override-fields { display: grid; gap: 10px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-light, #f0f1f2); }
.override-field { display: grid; gap: 5px; font-size: 12px; color: var(--muted, #73777d); }
.override-field small { margin-left: 6px; color: var(--muted, #9aa0a6); }
.override-field input, .override-field textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--border-light, #e0e0e0); border-radius: 4px; padding: 7px 9px; color: var(--text-primary, #202124); background: var(--surface, #fff); font: inherit; resize: vertical; }
.override-field select { width: 100%; box-sizing: border-box; border: 1px solid var(--border-light, #e0e0e0); border-radius: 4px; padding: 7px 9px; color: var(--text-primary, #202124); background: var(--surface, #fff); font: inherit; }
.override-check { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted, #73777d); }
.override-check input { accent-color: var(--coral, #f56c6c); }
.collection-picker { display: flex; gap: 8px; align-items: center; }
.collection-picker__btn { white-space: nowrap; padding: 6px 10px; border: 1px solid var(--border-light, #e0e0e0); border-radius: 4px; background: var(--surface, #fff); color: var(--text-primary, #202124); font: inherit; font-size: 12px; cursor: pointer; }
.collection-picker__btn:disabled { opacity: 0.6; cursor: wait; }
.collection-picker select { flex: 1; border: 1px solid var(--border-light, #e0e0e0); border-radius: 4px; padding: 6px 8px; font: inherit; }
.override-field input:focus, .override-field textarea:focus { outline: 2px solid color-mix(in srgb, var(--action-blue, #1890ff) 25%, transparent); border-color: var(--action-blue, #1890ff); }
.override-field select:focus { outline: 2px solid color-mix(in srgb, var(--action-blue, #1890ff) 25%, transparent); border-color: var(--action-blue, #1890ff); }
</style>

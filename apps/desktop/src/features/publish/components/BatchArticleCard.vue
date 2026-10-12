<template>
  <!-- 批量模式的一条待发布内容（编号/操作/标题/正文/标签话题@好友/扩展字段面/发布目标/定时）。
       抽成组件的原因：Publish.vue 在「点名还账」清单内（零增长容差），
       该卡片是本视图里最大的自洽模板块。 -->
  <div class="cohere-card cohere-card-static">
    <div class="article-card-row">
      <span class="cohere-tag cohere-tag-info">#{{ index + 1 }}</span>
      <span v-if="article.publishTime" class="cohere-tag cohere-tag-warning">⏰ {{ t('publishPage.scheduled') }}</span>
      <div class="flex-spacer"></div>
      <UiButton :data-testid="`batch-copy-${index}`" variant="ghost" size="sm" :title="t('publishPage.copy')" @click="emit('duplicate')"><el-icon><CopyDocument /></el-icon></UiButton>
      <UiButton v-if="canDelete" :data-testid="`batch-delete-${index}`" variant="ghost" size="sm" :title="t('publishPage.delete')" class="coral-text" @click="emit('remove')">✕</UiButton>
    </div>

    <div class="cohere-form">
      <div class="cohere-form-item">
        <div class="title-row">
          <label class="cohere-form-label no-margin-bottom">{{ t('publishPage.title') }}</label>
          <button class="cohere-btn-ghost template-pick-button" @click="emit('open-template')">
            <el-icon><EditPen /></el-icon> {{ t('publishPage.template') }}
          </button>
        </div>
        <UiInput :model-value="article.title" :placeholder="t('publishPage.titlePlaceholder')" @update:model-value="value => emit('update:title', value)" />
      </div>
      <div class="cohere-form-item">
        <label class="cohere-form-label">{{ t('publishPage.content') }}</label>
        <UiInput type="textarea" :model-value="article.content" :placeholder="t('publishPage.contentPlaceholder')" :rows="5" @update:model-value="value => emit('update:content', value)" />
      </div>
      <div class="cohere-form-item batch-metadata-grid">
        <div>
          <label class="cohere-form-label">{{ t('publishPage.tags') }}</label>
          <UiInput :model-value="article.tagsText" :placeholder="t('publishPage.tagsPlaceholder')" @update:model-value="value => emit('update:tags-text', value)" />
          <!-- 话题标签统一（topic-tag-unify）：#添加话题 / 常用话题标签，写入目标=本篇 -->
          <div class="topic-tag-actions">
            <UiButton variant="ghost" size="sm" :data-testid="`batch-add-topic-hash-${index}`" @click="emit('add-topic-hash')">{{ t('publishPage.topicTag.addHash') }}</UiButton>
            <UiButton variant="ghost" size="sm" :data-testid="`batch-open-topic-tag-manager-${index}`" @click="emit('open-topic-tag-manager')">{{ t('publishPage.topicTag.manage') }}</UiButton>
          </div>
        </div>
        <div>
          <label class="cohere-form-label">{{ t('publishPage.mentions') }}</label>
          <UiInput :model-value="article.mentionsText" :placeholder="t('publishPage.mentionsPlaceholder')" @update:model-value="value => emit('update:mentions-text', value)" />
        </div>
      </div>
      <!-- P2-7 批量条目扩展字段面：封面 / 无标题提示 / 支持度徽标 / 可见性 / 平台差异化。
           写入一律经 useBatchPublish 的 setter，让「UI 写点」与「payload 构造点」同侧，
           被同一条键集 parity 回归锁覆盖（修复前 cover_* 只有读点、没有写点，恒为空）。 -->
      <BatchArticleFields
        :article="article"
        :index="index"
        :platform-catalog="platformCatalog"
        @update:cover="payload => emit('update:cover', payload)"
        @update:cover-url="value => emit('update:cover-url', value)"
        @update:visibility="value => emit('update:visibility', value)"
        @update:overrides="next => emit('update:overrides', next)"
        @clear-cover="emit('clear-cover')"
        @open-preview="emit('open-preview')"
      />
      <BatchTargetPicker
        :platforms="platformCatalog"
        :selected-platforms="article.platforms"
        :index="index"
        :get-accounts="getAccounts"
        :is-account-selected="isAccountSelected"
        :resolve-account-name="resolveAccountName"
        @toggle-account="(pid, aid) => emit('toggle-account', pid, aid)"
      />
      <div class="cohere-form-item">
        <label class="cohere-form-label">{{ t('publishPage.schedule') }}</label>
        <UiInput type="datetime-local" :model-value="article.publishTime" class="input-max-260" @update:model-value="value => emit('update:publish-time', value)" />
        <span class="publish-time-hint">{{ scheduleHint }}</span>
        <p v-if="scheduleCapabilityHint" class="no-title-hint" data-testid="batch-schedule-capability">{{ scheduleCapabilityHint }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { CopyDocument, EditPen } from '@element-plus/icons-vue'
import UiButton from '@/components/UiButton.vue'
// UiInput 在 Publish.vue 里是**局部导入**（未全局注册）：子组件必须各自导入，
// 否则 <UiInput> 会被当成未知元素渲染（输入框不出现/值为空，而单测夹具全局注册会掩盖它）。
import UiInput from '@/components/UiInput.vue'
import BatchArticleFields from './BatchArticleFields.vue'
import BatchTargetPicker from './BatchTargetPicker.vue'

defineProps({
  /** 条目对象（就地编辑，与既有批量模式同语义） */
  article: { type: Object, required: true },
  index: { type: Number, default: 0 },
  platformCatalog: { type: Array, default: () => [] },
  canDelete: { type: Boolean, default: false },
  getAccounts: { type: Function, required: true },
  isAccountSelected: { type: Function, required: true },
  resolveAccountName: { type: Function, required: true },
  /** 定时提示（按本条所选平台计算） */
  scheduleHint: { type: String, default: '' },
  /** 定时能力提示（无则空串） */
  scheduleCapabilityHint: { type: String, default: '' },
})
const emit = defineEmits([
  'duplicate', 'remove', 'open-template', 'update:title', 'update:content', 'update:mentions-text',
  'update:publish-time', 'update:tags-text',
  'update:cover', 'update:cover-url', 'update:visibility', 'update:overrides',
  'clear-cover', 'open-preview', 'toggle-account',
  // 话题标签统一（topic-tag-unify）：#添加话题 与 常用话题标签弹窗（写入目标=本篇）
  'add-topic-hash', 'open-topic-tag-manager',
])
const { t } = useI18n()
</script>

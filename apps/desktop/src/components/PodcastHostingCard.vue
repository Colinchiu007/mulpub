<template>
  <section class="podcast-hosting" data-testid="podcast-hosting-card" aria-labelledby="podcast-hosting-heading">
    <h2 id="podcast-hosting-heading">{{ t('podcast.hosting.sectionTitle') }}</h2>
    <p class="podcast-hosting-hint">{{ t('podcast.hosting.sectionHint') }}</p>

    <p
      class="podcast-hosting-state"
      :data-state="configured ? 'configured' : 'not-configured'"
      data-testid="podcast-hosting-configured"
    >
      {{ configured ? t('podcast.hosting.configured', { key: hosting && hosting.maskedAccessKeyId ? hosting.maskedAccessKeyId : '' }) : t('podcast.hosting.notConfigured') }}
    </p>

    <div class="podcast-hosting-grid">
      <label class="podcast-hosting-field">
        <span>{{ t('podcast.hosting.provider') }}</span>
        <select v-model="form.provider" data-testid="podcast-hosting-provider">
          <option value="oss">{{ t('podcast.hosting.providerOss') }}</option>
          <option value="cos" disabled :title="t('podcast.hosting.providerCosDisabled')">{{ t('podcast.hosting.providerCos') }}</option>
        </select>
      </label>
      <label class="podcast-hosting-field">
        <span>{{ t('podcast.hosting.endpoint') }}</span>
        <input v-model="form.endpoint" data-testid="podcast-hosting-endpoint" :placeholder="t('podcast.hosting.endpointPlaceholder')" maxlength="200">
      </label>
      <label class="podcast-hosting-field">
        <span>{{ t('podcast.hosting.bucket') }}</span>
        <input v-model="form.bucket" data-testid="podcast-hosting-bucket" maxlength="120">
      </label>
      <label class="podcast-hosting-field">
        <span>{{ t('podcast.hosting.pathPrefix') }}</span>
        <input v-model="form.pathPrefix" data-testid="podcast-hosting-prefix" maxlength="160">
      </label>
      <label class="podcast-hosting-field">
        <span>{{ t('podcast.hosting.accessKeyId') }}</span>
        <input v-model="form.accessKeyId" type="text" autocomplete="off" data-testid="podcast-hosting-akid" :placeholder="t('podcast.hosting.secretKeepPlaceholder')" maxlength="160">
      </label>
      <label class="podcast-hosting-field">
        <span>{{ t('podcast.hosting.accessKeySecret') }}</span>
        <input v-model="form.accessKeySecret" type="password" autocomplete="new-password" data-testid="podcast-hosting-aksecret" :placeholder="t('podcast.hosting.secretKeepPlaceholder')" maxlength="200">
      </label>
    </div>
    <p class="podcast-hosting-note">{{ t('podcast.hosting.secretKeepHint') }}</p>

    <div class="podcast-hosting-actions">
      <button type="button" data-testid="podcast-hosting-save" :disabled="savingHosting" @click="onSave">{{ t('podcast.hosting.save') }}</button>
      <button type="button" data-testid="podcast-hosting-check" :disabled="checking || !configured" @click="onCheck">{{ t('podcast.hosting.check') }}</button>
      <button type="button" data-testid="podcast-hosting-publish" :disabled="publishing || !channelId" @click="onPublish">{{ t('podcast.hosting.publish') }}</button>
      <button type="button" data-testid="podcast-hosting-clear" :disabled="savingHosting || !configured" @click="onClear">{{ t('podcast.hosting.clearSecret') }}</button>
    </div>

    <p v-if="hostingError" class="podcast-hosting-error" data-testid="podcast-hosting-error">{{ errorText(hostingError) }}</p>
    <ul v-if="hostingIssues.length" class="podcast-hosting-issues" data-testid="podcast-hosting-issues">
      <li v-for="(it, i) in hostingIssues" :key="i">{{ issueLabel(it) }}</li>
    </ul>
    <p v-if="checkResult" class="podcast-hosting-check" :data-state="checkState" data-testid="podcast-hosting-check-result">{{ checkText }}</p>
    <p v-if="publishResult" class="podcast-hosting-publish" :data-state="publishResult.state" data-testid="podcast-hosting-publish-result">
      {{ publishText }}
      <span v-if="publishResult.state === 'success' && publishResult.prevExists && !publishResult.backupCreated" data-testid="podcast-hosting-no-backup">{{ t('podcast.hosting.backupMissing') }}</span>
      <span v-else-if="publishResult.state === 'success' && !publishResult.prevExists" data-testid="podcast-hosting-no-previous">{{ t('podcast.hosting.noPrevious') }}</span>
    </p>
  </section>
</template>

<script setup>
/**
 * 托管卡片：全局一份凭证 + 按频道发布 feed。
 *
 * 为什么是子组件而不是塞进播客页：页面已经贴着逐文件行数门禁的上限，且两者的状态生命周期
 * 不同（凭证跨频道共用、发布按频道触发）。**样式刻意自带**而不是复用父级 scoped 类 ——
 * Vue 的 scoped 样式不作用于子组件元素，靠父级类名会渲染成「有结构无样式」，像素基线也会跟着漂。
 */
import { computed, onMounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

import { errorCodeText, issueText } from '@/composables/usePodcastChannel'
import { makeHostingForm, usePodcastHosting } from '@/composables/usePodcastHosting'

const props = defineProps({
  channelId: { type: String, default: '' },
})
const emit = defineEmits(['published'])

const { t } = useI18n()
const {
  hosting,
  hostingError,
  hostingIssues,
  savingHosting,
  checking,
  publishing,
  checkResult,
  publishResult,
  configured,
  formFromHosting,
  loadHosting,
  saveHosting,
  checkHosting,
  publishFeed,
} = usePodcastHosting()

const form = reactive(Object.assign(makeHostingForm(), formFromHosting()))
const errorText = (code) => errorCodeText(code)
const issueLabel = (it) => issueText(it)

const checkState = computed(() => {
  if (!checkResult.value) return ''
  if (!checkResult.value.checked) return 'skipped'
  return checkResult.value.ok ? 'ok' : 'failed'
})

const checkText = computed(() => {
  const r = checkResult.value
  if (!r) return ''
  if (r.reason === 'PODCAST_HOSTING_NOT_CONFIGURED') return t('podcast.hosting.checkNotConfigured')
  if (!r.checked) return t('podcast.hosting.checkSkipped')
  return r.ok ? t('podcast.hosting.checkOk') : t('podcast.hosting.checkFailed', { status: r.status == null ? t('podcast.hosting.checkNoStatus') : r.status })
})

// 三种出口三句话：成功 / PUT 失败（公网未变、可重试）/ 其他（带码可见）。压成「成功或失败」两态会掩盖 partial。
const publishText = computed(() => {
  const r = publishResult.value
  if (!r) return ''
  if (r.state === 'success') return t('podcast.hosting.publishSuccess', { count: r.itemCount || 0 })
  if (r.state === 'failed') return t('podcast.hosting.publishFailed', { status: r.status == null ? t('podcast.hosting.checkNoStatus') : r.status })
  return t('podcast.hosting.publishFailed', { status: r.code || '' })
})

async function refillForm () {
  Object.assign(form, makeHostingForm(), formFromHosting())
}

async function onSave () {
  await saveHosting(form)
  await refillForm()
}

async function onClear () {
  await saveHosting(form, { clearSecret: true })
  await refillForm()
}

async function onCheck () {
  await checkHosting()
}

async function onPublish () {
  const res = await publishFeed(props.channelId)
  emit('published', res)
}

onMounted(async () => {
  await loadHosting()
  await refillForm()
})
</script>

<style scoped>
.podcast-hosting { margin-bottom: 28px; }
.podcast-hosting-hint,
.podcast-hosting-note { margin: 6px 0; color: var(--el-text-color-secondary); font-size: var(--font-size-sm); }
.podcast-hosting-state { margin: 6px 0; font-size: var(--font-size-sm); }
.podcast-hosting-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; }
.podcast-hosting-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-size-sm); }
.podcast-hosting-field input,
.podcast-hosting-field select { padding: 4px 8px; border: 1px solid var(--el-border-color); border-radius: var(--radius-sm); }
.podcast-hosting-actions { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.podcast-hosting-actions button { padding: 4px 12px; border: 1px solid var(--el-border-color); border-radius: var(--radius-sm); background: var(--el-fill-color-blank); cursor: pointer; }
.podcast-hosting-error { color: var(--el-color-danger); font-size: var(--font-size-sm); }
.podcast-hosting-issues { margin: 6px 0; padding-left: 18px; color: var(--el-color-warning); font-size: var(--font-size-sm); }
.podcast-hosting-check,
.podcast-hosting-publish { margin: 6px 0; font-size: var(--font-size-sm); }
</style>

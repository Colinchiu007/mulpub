<template>
  <!--
    形象克隆面板（avatar-voice-clone，2026-10-22）。

    从 CreateView.vue 抽出：CreateView 已 5359 行（债务基线 maxFileLines），
    再内联会把该指标推过线；且克隆面板自成一块（列表 + 合规提示 + 创建表单），
    抽成组件后可独立单测。

    状态与动作全部由父组件经 props/emit 传入/回传，本组件不自己持 store——
    与 S2vConfigPanels / SceneAssetSelection 同型的「展示组件 + composable 持状态」分工。
  -->
  <div class="config-item config-item--full" data-testid="avatar-clone-panel">
    <h4>{{ t('avatarCloneSectionTitle') }}</h4>

    <!-- 一次性合规提示：不强制勾选，只提示 + 记录已阅（用户明确要求不做强制确认） -->
    <div v-if="!noticeAcked" class="clone-notice" data-testid="avatar-clone-notice">
      <strong>{{ t('avatarCloneNoticeTitle') }}</strong>
      <p>{{ t('avatarCloneNoticeBody') }}</p>
      <button
        type="button"
        class="s2v-btn-secondary s2v-btn-sm"
        data-testid="avatar-clone-notice-ack"
        @click="$emit('ack-notice')"
      >{{ t('avatarCloneNoticeAck') }}</button>
    </div>

    <div v-if="clones.length === 0" class="config-hint" data-testid="avatar-clone-empty">
      {{ t('avatarCloneEmpty') }}：{{ t('avatarCloneEmptyHint') }}
    </div>
    <ul v-else class="clone-list" data-testid="avatar-clone-list">
      <li v-for="item in clones" :key="item.id">
        <span class="clone-name">{{ item.name }}</span>
        <span v-if="item.trainingState === 'training'" class="clone-tag">{{ t('avatarCloneTraining') }}</span>
        <span v-else-if="invalidKey(item)" class="clone-tag clone-tag--warn">{{ t(invalidKey(item)) }}</span>
        <button
          type="button"
          class="s2v-btn-secondary s2v-btn-sm"
          :data-testid="'avatar-clone-delete-' + item.id"
          @click="$emit('delete', item.id)"
        >{{ t('avatarCloneDelete') }}</button>
      </li>
    </ul>

    <!-- 声音克隆入口提示（change: digital-human-multiprovider）：
         形象与声音是两条独立链路，声音克隆的 UI 在配音面板；这里只告知能力，
         不重复造一个上传入口（那会造出两份选择器、两套样本存储）。 -->
    <p class="config-hint" data-testid="avatar-clone-voice-hint">
      {{ voiceCloneSupported ? t('avatarCloneVoiceHint') : t('avatarCloneVoiceUnsupported') }}
    </p>

    <!-- 创建：名称 + 两种素材入口（照片 / 视频） -->
    <div class="clone-create">
      <input
        :value="nameDraft"
        type="text"
        class="form-input"
        data-testid="avatar-clone-name"
        :placeholder="t('avatarCloneNamePlaceholder')"
        :disabled="creating"
        @input="$emit('update:nameDraft', $event.target.value)"
      />
      <button
        type="button"
        class="s2v-btn-secondary s2v-btn-sm"
        data-testid="avatar-clone-create-photo"
        :disabled="creating"
        @click="$emit('create', 'photo')"
      >{{ t('avatarCloneTypePhoto') }}</button>
      <button
        type="button"
        class="s2v-btn-secondary s2v-btn-sm"
        data-testid="avatar-clone-create-video"
        :disabled="creating"
        @click="$emit('create', 'digital_twin')"
      >{{ t('avatarCloneTypeVideo') }}</button>
    </div>
    <span v-if="createError" class="inline-error" data-testid="avatar-clone-create-error">
      {{ t(createError) }}
    </span>
  </div>
</template>

<script>
export default {
  name: 'AvatarClonePanel',
  props: {
    clones: { type: Array, default: () => [] },
    noticeAcked: { type: Boolean, default: false },
    nameDraft: { type: String, default: '' },
    creating: { type: Boolean, default: false },
    createError: { type: String, default: '' },
    /** 失效标记 → locale key 的映射函数（逻辑在 useAvatarClone，这里只调用） */
    invalidKeyOf: { type: Function, default: () => '' },
    /** 当前数字人服务商是否支持克隆声音（父组件按 tts-voice-catalog 判定后传入） */
    voiceCloneSupported: { type: Boolean, default: false },
  },
  methods: {
    t(key) {
      return typeof this.$t === 'function' ? this.$t('create.story2video.ui.' + key) : key
    },
    invalidKey(item) {
      return typeof this.invalidKeyOf === 'function' ? this.invalidKeyOf(item) : ''
    },
  },
}
</script>

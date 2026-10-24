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

    <!-- 声音素材（change: avatar-voice-clone-bundled）：
         支持时内联上传入口，不支持时只给一句说明。整个区块按能力显隐，
         不置灰——置灰会让用户以为「再点点就能用」。 -->
    <template v-if="voiceCloneSupported">
      <AvatarVoiceClone
        :creating="creating"
        :voice-selection-id="voiceSelectionId"
        :create-error="voiceCreateError"
        :provider-name="providerName"
        @choose-voice-media="$emit('choose-voice-media')"
      />
    </template>
    <p v-else class="config-hint" data-testid="avatar-clone-voice-unsupported">
      {{ t('avatarCloneVoiceUnsupported') }}
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
      {{ t(createError).replace('{name}', providerName) }}
    </span>
  </div>
</template>

<script>
import AvatarVoiceClone from './AvatarVoiceClone.vue'

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
    /**
     * 当前数字人服务商显示名（change: hifly-voice-subtitle-parity）。
     * 用于代入文案里的 {name} 占位符——错误提示要点名是哪一家不可用，
     * 但不能在 locale 里写死任何一家。
     */
    providerName: { type: String, default: '' },
    /** 已选中的录音 selectionId（change: avatar-voice-clone-bundled） */
    voiceSelectionId: { type: String, default: '' },

    voiceCreateError: { type: String, default: '' },

  },
  emits: ['choose-voice-media'],
  // 同步 import 而非异步：这是个常驻小块（克隆面板的一个区），
  // 异步加载会让「打开面板那一刻它还没就绪」，用户看到面板缺一块。
  components: { AvatarVoiceClone },
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

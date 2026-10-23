<template>
  <!--
    数字人面板内联「声音克隆」（change: hifly-voice-subtitle-parity）。

    为什么内联到数字人面板：形象与声音在用户眼里是「一个数字人」的两半。
    此前声音克隆入口只在配音面板（S2vConfigPanels），用户在数字人面板克隆了
    形象后得不到任何提示，也找不到配自己声音的地方——两个面板来回跳。

    为什么**不**是「把配音面板那个搬过来」：那个面板面向 TTS provider 系
    （elevenlabs/minimax…），带 model 选择、requirements 提示、列表/重命名/删除
    一整套。数字人面板只需要「上传一段录音 → 得到一个可用音色」这个最小闭环，
    且 provider/model 由当前数字人服务商决定，不给用户选。
  -->
  <div class="clone-voice" data-testid="avatar-clone-voice-panel">
    <h5>{{ t('avatarCloneVoiceTitle') }}</h5>
    <p class="config-hint">{{ t('avatarCloneVoiceHintInline') }}</p>

    <div class="clone-voice-create">
      <input
        :value="nameDraft"
        type="text"
        class="form-input"
        data-testid="avatar-clone-voice-name"
        :placeholder="t('avatarCloneVoiceNamePlaceholder')"
        :disabled="creating"
        @input="$emit('update:nameDraft', $event.target.value)"
      />
      <button
        type="button"
        class="s2v-btn-secondary s2v-btn-sm"
        data-testid="avatar-clone-voice-choose"
        :disabled="creating"
        @click="$emit('create')"
      >{{ t('avatarCloneVoiceChoose') }}</button>
    </div>

    <span v-if="createError" class="inline-error" data-testid="avatar-clone-voice-error">
      {{ t(createError).replace('{name}', providerName) }}
    </span>
    <span v-if="createdName" class="config-hint" data-testid="avatar-clone-voice-created">
      {{ t('avatarCloneVoiceCreated').replace('{name}', createdName) }}
    </span>
  </div>
</template>

<script>
export default {
  name: 'AvatarVoiceClone',
  props: {
    /** 音色名草稿（父组件持有，创建成功后清空） */
    nameDraft: { type: String, default: '' },
    creating: { type: Boolean, default: false },
    /** 错误 locale key（来自 useAvatarClone.friendlyError） */
    createError: { type: String, default: '' },
    /** 当前数字人服务商显示名（代入 {name} 占位符） */
    providerName: { type: String, default: '' },
    /** 最近一次创建成功的音色名（用于成功提示） */
    createdName: { type: String, default: '' },
  },
  emits: ['update:nameDraft', 'create'],
  methods: {
    // 与 AvatarClonePanel 同型防御：无 i18n 上下文时不崩
    t(key) {
      return typeof this.$t === 'function' ? this.$t('create.story2video.ui.' + key) : key
    },
  },
}
</script>

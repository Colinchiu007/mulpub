<template>
  <!--
    数字人面板的声音克隆区（change: avatar-voice-clone-bundled）。

    用户约束：**声音必须和形象走同一家 provider、绑在一起创建**，这样才能用上
    飞影的整体克隆能力。所以这里不是「独立克隆一个音色」的入口，而是
    「给这次形象克隆配一段录音」的入口。

    流程：点「选择本地录音文件」→ 主进程对话框 → 拿 voiceSelectionId
    → 与形象的 selectionId 一起交给「创建」按钮，一次请求建完两样。
    录音没选也能创建（只要形象），向后兼容。

    素材走两段式（对话框 → selectionId）而非直传路径：renderer 不得碰文件路径。
  -->
  <div class="clone-voice" data-testid="avatar-clone-voice-panel">
    <h5>{{ t('avatarCloneVoiceTitle') }}</h5>
    <p class="config-hint">{{ t('avatarCloneVoiceHintBundled') }}</p>

    <!-- 素材要求（change: hifly-clone-material-hints）。
         为什么必须主动提示：飞影克隆失败时 message 是空串（真实首跑实测），
         用户上传静音/超时文件后只会拿到一个无原因的失败，无从下手。
         三个硬约束（格式 / 大小 / 时长）+ 「必须含人声」都要点明。 -->
    <p class="config-hint" data-testid="avatar-clone-voice-material-hint">
      {{ t('avatarCloneVoiceMaterialHint') }}
    </p>

    <div class="clone-voice-create">
      <button
        type="button"
        class="s2v-btn-secondary s2v-btn-sm"
        data-testid="avatar-clone-voice-choose-media"
        :disabled="creating"
        @click="$emit('choose-voice-media')"
      >{{ t('avatarCloneVoiceChooseMedia') }}</button>
      <span v-if="voiceSelectionId" class="config-hint" data-testid="avatar-clone-voice-selected">
        {{ t('avatarCloneVoiceSelected') }}
      </span>
    </div>

    <span v-if="createError" class="inline-error" data-testid="avatar-clone-voice-error">
      {{ t(createError).replace('{name}', providerName) }}
    </span>
  </div>
</template>

<script>
export default {
  name: 'AvatarVoiceClone',
  props: {
    creating: { type: Boolean, default: false },
    /** 已选中的录音 selectionId（空串表示还没选） */
    voiceSelectionId: { type: String, default: '' },
    /** 错误 locale key（来自 useAvatarClone.friendlyError） */
    createError: { type: String, default: '' },
    /** 当前数字人服务商显示名（代入 {name} 占位符） */
    providerName: { type: String, default: '' },
  },
  emits: ['choose-voice-media'],
  methods: {
    // 与 AvatarClonePanel 同型防御：无 i18n 上下文时不崩
    t(key) {
      return typeof this.$t === 'function' ? this.$t('create.story2video.ui.' + key) : key
    },
  },
}
</script>

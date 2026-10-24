<template>
  <!--
    数字人字幕面板（change: hifly-voice-subtitle-parity）。

    只对支持字幕的服务商渲染（当前仅飞影 HiFly）——HeyGen 的
    create_by_tts 契约里没有 st_* 字段，给它看一堆字幕选项等于骗人。

    交互取舍：默认整个面板不展开，只露一个「添加字幕」开关。用户开了才出现
    参数项。理由是字幕是少数人的需求，一上来铺 9 个控件会把数字人配置区
    撑得很难读；而「默认关闭」也让不关心字幕的人不受干扰。
  -->
  <div class="clone-subtitle" data-testid="avatar-subtitle-panel">
    <button
      type="button"
      class="voice-clone-toggle"
      :aria-expanded="String(show)"
      data-testid="avatar-subtitle-toggle"
      @click="$emit('update:show', !show)"
    >
      <span>{{ show ? t('avatarSubtitleHide') : t('avatarSubtitleShow') }}</span>
    </button>

    <div v-if="show" class="clone-subtitle-params" data-testid="avatar-subtitle-params">
      <p class="config-hint">{{ t('avatarSubtitleHint') }}</p>

      <div class="clone-subtitle-grid">
        <label>
          {{ t('avatarSubtitleFontName') }}
          <input
            :value="fontName"
            type="text"
            class="form-input"
            data-testid="avatar-subtitle-font-name"
            :placeholder="t('avatarSubtitleFontNamePlaceholder')"
            @input="$emit('update:fontName', $event.target.value)"
          />
        </label>
        <label>
          {{ t('avatarSubtitleFontSize') }}
          <input
            :value="fontSize"
            type="number"
            min="1"
            max="400"
            class="form-input"
            data-testid="avatar-subtitle-font-size"
            @input="$emit('update:fontSize', Number($event.target.value))"
          />
        </label>
        <label>
          {{ t('avatarSubtitlePrimaryColor') }}
          <input
            :value="primaryColor"
            type="color"
            class="form-input"
            data-testid="avatar-subtitle-primary-color"
            @input="$emit('update:primaryColor', $event.target.value)"
          />
        </label>
        <label>
          {{ t('avatarSubtitleOutlineColor') }}
          <input
            :value="outlineColor"
            type="color"
            class="form-input"
            data-testid="avatar-subtitle-outline-color"
            @input="$emit('update:outlineColor', $event.target.value)"
          />
        </label>
      </div>
      <p class="config-hint">{{ t('avatarSubtitleAdvancedNote') }}</p>
    </div>
  </div>
</template>

<script>
export default {
  name: 'AvatarSubtitlePanel',
  props: {
    /** 是否显示字幕（开关态由父组件持有，随启动参数一起下发） */
    show: { type: Boolean, default: false },
    fontName: { type: String, default: '' },
    fontSize: { type: Number, default: 100 },
    primaryColor: { type: String, default: '#ffffff' },
    outlineColor: { type: String, default: '#000000' },
  },
  emits: ['update:show', 'update:fontName', 'update:fontSize', 'update:primaryColor', 'update:outlineColor'],
  methods: {
    // 与 AvatarClonePanel 同型防御：无 i18n 上下文时不崩
    t(key) {
      return typeof this.$t === 'function' ? this.$t('create.story2video.ui.' + key) : key
    },
  },
}
</script>

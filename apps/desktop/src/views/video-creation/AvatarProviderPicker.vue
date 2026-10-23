<template>
  <!--
    数字人服务商选择器（change: digital-human-multiprovider）。

    从 CreateView.vue 抽出：CreateView 已逼近债务基线 maxFileLines，且这块
    （下拉 + 「只有一家」提示 + 切换后提示）自成一体，抽成组件后可独立单测。

    分工：本组件只负责**展示与发事件**；「谁是数字人服务商」的筛选与
    「切换后要重拉什么」的编排都在 CreateView（那边持有目录缓存与克隆状态）。
  -->
  <div class="config-item" data-testid="avatar-provider-item">
    <label>{{ t('avatarProviderLabel') }}</label>
    <select
      :value="modelValue"
      class="form-select"
      data-testid="avatar-provider-select"
      :disabled="loading || options.length <= 1"
      @change="$emit('change', $event.target.value)"
    >
      <option v-for="item in options" :key="item.id" :value="item.id">{{ item.name }}</option>
    </select>
    <span v-if="options.length <= 1" class="config-hint" data-testid="avatar-provider-single">
      {{ t('avatarProviderSingle') }}
    </span>
    <span v-else-if="switched" class="config-hint" data-testid="avatar-provider-switched">
      {{ t('avatarProviderSwitched').replace('{name}', switchedName) }}
    </span>
  </div>
</template>

<script>
export default {
  name: 'AvatarProviderPicker',
  props: {
    /** 可选的数字人服务商（已按 capability 筛过） */
    options: { type: Array, default: () => [] },
    /** 当前选中的 provider id */
    modelValue: { type: String, default: '' },
    loading: { type: Boolean, default: false },
    /** 是否刚发生过切换（决定显示哪条提示） */
    switched: { type: Boolean, default: false },
    /** 切换到的服务商名（用于提示文案） */
    switchedName: { type: String, default: '' },
  },
  emits: ['change'],
  methods: {
    // 与 CreateView.avatarText 同型防御：无 i18n 上下文时不崩
    t(key) {
      return typeof this.$t === 'function' ? this.$t('create.story2video.ui.' + key) : key
    },
  },
}
</script>

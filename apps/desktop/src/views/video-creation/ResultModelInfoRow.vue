<template>
  <!--
    视频信息区的「格式 + 模型信息」行（s2v-result-model-info，2026-10-18）。

    与「格式」同一行：模型摘要拼在格式值之后，用内联分隔符连接。容器放不下时由
    浏览器自然折行，不撑破布局——不用 JS 测宽，也不用 CSS 媒体查询猜断点
    （容器宽度 ≠ 视口宽度，侧边栏折叠就会让猜的断点失效）。

    四项模型全空时 `modelSummaryText` 为空串，模板不输出分隔符也不输出模型 span，
    整行退化为「格式: MP4」，与本次改动前的 DOM 同形（零视觉回归的行为级依据）。

    取值口径、视频模型 videoMode 门控与脏数据防御都在 useResultModelInfo.js，
    可独立测；本组件只负责把文本摆进这一行。
  -->
  <p data-testid="video-format-models">
    <span data-testid="video-format">{{ formatLabelText }}: {{ formatLabel }}</span><template v-if="modelSummaryText"> · </template><span v-if="modelSummaryText" data-testid="video-models">{{ modelSummaryText }}</span>
  </p>
</template>

<script>
import { resolveModelSummaryParts } from './composables/useResultModelInfo'

export default {
  name: 'ResultModelInfoRow',
  props: {
    // 项目对象（story2video:get-project 返回值）；null 表示纯文件预览模式
    project: { type: Object, default: null },
    // 前端分段数组，含 provider 实际返回的 imageMeta/audioMeta/videoMeta
    segments: { type: Array, default: () => [] },
    // 由视频路径派生的格式标签（如 MP4）
    formatLabel: { type: String, default: '' },
  },
  computed: {
    // 「格式」标签走 locale：它与模型信息在同一行展示，随本次改动一并从 ResultView.vue
    // 的硬编码收口到 locales（zh/en 成对），避免按文件匹配的 CJK 基线失配。
    // 与 ResultView.tOrKey 同一防御：无 i18n 上下文（部分单测直接 mount 不注入 $t）时回落 key，
    // 不得让整个组件渲染崩掉。
    formatLabelText() {
      return this.translate('create.story2video.modelInfo.format')
    },
    modelSummaryText() {
      return resolveModelSummaryParts(this.project, this.segments, key => this.translate('create.story2video.modelInfo.' + key)).join(' · ')
    },
  },
  methods: {
    translate(key) {
      return typeof this.$t === 'function' ? this.$t(key) : key
    },
  },
}
</script>

<template>
  <span class="podcast-episode-entry">
    <UiButton v-if="canPublish" variant="ghost" data-testid="podcast-episode-entry" @click="open">
      {{ t('podcast.episode.entry') }}
    </UiButton>
    <PodcastPublishAction
      v-if="openedOnce"
      :visible="visible"
      :project="project"
      :segments="segments"
      :video-path="videoPath"
      :title="title"
      @close="visible = false"
    />
  </span>
</template>

<script>
/**
 * 「发布为播客单集」入口 + 浮层的成对装配（刀 3 第 4 片，PRD §6.4 显示项）。
 *
 * 为什么要有这一层：入口按钮与浮层是同一个动作的两半，宿主视图（结果页 / 创作页）
 * 只需要「有没有成片」这一个条件。若把 visible、标题提取、浮层注册抄在每个宿主里，
 * 两处就会各自漂移——而本仓的既有纪律正是「入口与浮层成对，宿主不持有第二份状态」。
 * 标题在这里取 `buildPublishFromProject`，与「去发布」共用同一个唯一提取点（不在这里另写一份）。
 */
import UiButton from '../components/UiButton.vue'
import { useI18n } from 'vue-i18n'
import PodcastPublishAction from './PodcastPublishAction.vue'
import { buildPublishFromProject } from '@/features/publish/publish-from-project'

export default {
  setup () {
    // 与 PodcastPublishAction.vue 同源：本仓 i18n 非 legacy 装配，模板要用 t 必须由 setup 暴露
    let t = (key) => key
    try {
      t = useI18n().t
    } catch (e) {
      // 没有 i18n 插件的挂载（既有 ResultView 测试夹具就是这种，实测缺它会有 62 个 error）
      // 退化成回显键名而不是抛错：真实应用始终装插件，这里不是给生产路径开的旁路，
      // 而是「一个可选展示面不得把整棵挂载树炸掉」的收口。
    }
    return { t }
  },
  name: 'PodcastEpisodeEntry',
  components: { UiButton, PodcastPublishAction },
  props: {
    project: { type: Object, default: null },
    segments: { type: Array, default: () => [] },
    videoPath: { type: String, default: '' },
  },
  data () {
    // openedOnce：浮层**首次打开后常驻**。
    // 为什么必须按需挂载——宿主视图（结果页/创作页）的测试环境里没有播客 preload 面，
    // 浮层的 setup 会在建立期抛错并把整个宿主的用例一起拖红；
    // 而真实产品语义上也不该在用户没点入口时就构造浮层状态机。
    // 为什么挂载后不再卸载——关闭浮层**不取消**本次发布（链在主进程），
    // 用 v-if=visible 会把进行中的进度与结果一起销毁。
    return { visible: false, openedOnce: false }
  },
  methods: {
    open () {
      this.openedOnce = true
      this.visible = true
    },
  },
  computed: {
    // 缺项目或缺成片都没有「音轨来源」，入口不出现（不是点下去再报错）
    canPublish () { return Boolean(this.project && this.videoPath) },
    title () { return buildPublishFromProject(this.project || {}).title },
  },
}
</script>

<style scoped>
.podcast-episode-entry {
  display: inline-flex;
  align-items: center;
}
</style>

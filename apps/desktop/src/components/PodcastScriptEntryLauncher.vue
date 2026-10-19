<template>
  <button
    v-if="available"
    type="button"
    class="cohere-btn-ghost template-pick-button"
    data-testid="btn-podcast-script-entry"
    @click="open"
  >
    {{ t('podcast.episode.entry') }}
  </button>
  <Teleport to="body">
    <!-- 按需挂载、常驻不卸载：关闭只收窗，不打断已在途的出期（§7.10.3.4 交互行）。
         走 Teleport 是因为本组件被放进 .title-row 深处，浮层必须落在 body 才不受祖先
         transform/backdrop-filter 影响（仓内同族先例：UiModal / PublishDestinationModal）。 -->
    <PodcastScriptEntry
      v-if="openedOnce"
      v-model:visible="visible"
      :channel-id="channelId"
      :script="frozenScript"
      :title="frozenTitle"
    />
  </Teleport>
</template>

<script setup>
/**
 * 文本出期入口（tasks 4.3②-b③，PRD §7.10.3.4 ②-b③）——触发按钮 + 浮层的合体。
 *
 * 为什么把按钮和浮层装在一个组件里，而不是像 ②-b② 那样由视图自己挂：
 * `Publish.vue` 是 `check-max-lines` 的**点名还账**对象（`targets` 天花板 1773、容差 0），
 * 真实余量只有 2 行，写不下「谓词 + 快照 + 状态 + 两处模板」。仓内同族先例
 * （`hot-topics-publish-handoff`、`pub-record-republish`、`publish-add-account-entry`）在这一格
 * 一律选**结构性拆分**而不是上调 targets——上调等于给这个文件再送免涨额度，与立项目的冲突。
 * 拆出来的边界也确实是内聚的：可见性判据、点开时的快照、常驻挂载这三件事本就是一个入口。
 *
 * 判据只写这一处（模板 `v-if` 与 `open` 早退共用 `available`）：另起一份 trim 逻辑就是
 * 给下一次改口径留两条腿。
 *
 * 频道一律取 `usePodcastChannel` 的既有解析（§7.10.3.2 不变量 2）：没有默认频道时动作整块
 * 不出现，而不是弹一个必被宿主①层拒掉的框，也**不得**为了显示动作去 `ensureChannel()`
 * 解析出一个频道来。
 *
 * 正文只读：`script`/`title` 由调用方按**当前值**传入（含编辑器里未保存的改动），本组件在
 * 点击那一刻取一次快照后不再跟随——该字段被发布动作与改写面板双向改写，是在途状态；
 * 出期不为它做归一化、不固化草稿（要固化必须另立切片并先补发布链幂等判据）。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PodcastScriptEntry from './PodcastScriptEntry.vue'
import { usePodcastChannel } from '@/composables/usePodcastChannel'

const props = defineProps({
  script: { type: String, default: '' },
  title: { type: String, default: '' },
})

const { t } = useI18n()
const podcast = usePodcastChannel()

const visible = ref(false)
const openedOnce = ref(false)
const frozenScript = ref('')
const frozenTitle = ref('')
const channelId = ref('')

// 取源只有一处：`sourceText` 逐字等于 props.script 的原值（含首尾空白）。
// 谓词与快照都必须走它——前端轴 QM6 线索 L1 抓的就是「两处各推一遍 String(props.script||'')」，
// 那种形状下只要有一处加了 trim/归一化，显示判据与出期载荷就会分叉（变异 M2b 钉住）。
const sourceText = computed(() => String(props.script || ''))
// trim 只参与「有没有正文」这一判据，绝不代表要改写它。
const available = computed(
  () => Boolean(podcast.activeChannelId.value) && sourceText.value.trim().length > 0,
)

function open() {
  if (!available.value) return
  // 名字与 props.script / props.title 刻意错开：模板里裸写 script/title 会直接取到 props（实时值），
  // 浮层就变成跟随在途编辑——实测这条被「快照时机」用例抓了个正着。
  frozenScript.value = sourceText.value
  frozenTitle.value = props.title || ''
  channelId.value = podcast.activeChannelId.value
  openedOnce.value = true
  visible.value = true
}
</script>

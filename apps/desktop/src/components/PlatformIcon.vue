<template>
  <img
    v-if="iconSrc"
    :src="iconSrc"
    :alt="displayLabel"
    :class="['pi', 'pi-img', sizeClass]"
    :title="displayLabel"
  >
  <div
    v-else
    :class="['pi', sizeClass]"
    :style="{ background: bgColor }"
    :title="displayLabel"
  >
    {{ letter }}
  </div>
</template>

<script setup>
import { computed } from "vue";
import { getPlatformIconUrl } from "@/composables/usePlatformIconUrl";

const props = defineProps({
  platform: { type: String, required: true },
  label: { type: String, default: "" },
  size: { type: String, default: "md" },
});

const PLATFORM_COLORS = {
  douyin: "#7c5cbf",
  xiaohongshu: "#f472b6",
  tencent_video: "#34d399",
  kuaishou: "#fbbf24",
  toutiao: "#3b82f6",
  bilibili: "#fb7299",
  baijiahao: "#f59e0b",
  weibo: "#e6162d",
  zhihu: "#0066ff",
  youtube: "#ff0000",
  tiktok: "#000000",
  twitter: "#1da1f2",
  wechat_mp: "#34d399",
  shipinhao: "#34d399",
  souhu: "#f5a623",
  wangyi: "#e74c3c",
  aiqiyi: "#06c15e",
  dayu: "#ff6a00",
  qiehao: "#ff4d4f",
  pipixia: "#ff7d00",
  meipai: "#ff3366",
  acfun: "#fd4c5b",
  dewu: "#f5a623",
  chejiahao: "#ff6600",
  yichehao: "#0066ff",
  meiyou: "#999999",
  xhs_shangjia: "#f472b6",
  xigua: "#fe6c38",
  duoduo: "#e74c3c",
  yidianhao: "#ff6a00",
  souhu_shipin: "#f5a623",
  tengxun_shipin: "#34d399",
  weishi: "#34d399",
};

const PLATFORM_LETTERS = {
  douyin: "抖",
  xiaohongshu: "红",
  tencent_video: "视",
  kuaishou: "快",
  toutiao: "头",
  bilibili: "B",
  baijiahao: "百",
  weibo: "微",
  zhihu: "知",
  youtube: "Y",
  tiktok: "T",
  twitter: "X",
  wechat_mp: "微",
  shipinhao: "视",
  souhu: "搜",
  wangyi: "网",
  aiqiyi: "爱",
  dayu: "樟",
  qiehao: "切",
  pipixia: "啼",
  meipai: "美",
  acfun: "A",
  dewu: "得",
  chejiahao: "车",
  yichehao: "Y",
  meiyou: "M",
  xhs_shangjia: "商",
  xigua: "西",
  duoduo: "多",
  yidianhao: "点",
  souhu_shipin: "搜",
  tengxun_shipin: "腾",
  weishi: "微",
};

const iconSrc = computed(() => getPlatformIconUrl(props.platform));
const displayLabel = computed(() => props.label || PLATFORM_LETTERS[props.platform] || props.platform);
const bgColor = computed(() => PLATFORM_COLORS[props.platform] || "#7c5cbf");
const letter = computed(() => {
  if (props.label) return props.label[0];
  return PLATFORM_LETTERS[props.platform] || props.platform[0].toUpperCase();
});
const sizeClass = computed(() => "pi-" + props.size);
</script>

<style scoped>
.pi {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #fff;
  font-weight: 700;
  flex-shrink: 0;
  user-select: none;
}
.pi-sm { width: 24px; height: 24px; font-size: 11px; border-radius: 6px; }
.pi-md { width: 32px; height: 32px; font-size: 14px; }
.pi-lg { width: 40px; height: 40px; font-size: 18px; border-radius: 10px; }
.pi-img { object-fit: contain; border-radius: 4px; background: transparent; }
</style>
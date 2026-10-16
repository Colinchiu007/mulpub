import { ref } from 'vue'

// ⚠️ 非 Pinia store：这是普通模块级单例信号（无 defineStore / useXxx），
// 放在 stores/ 下仅为与其它状态模块集中管理；消费方直接 import { settingsDialogRevision }。
/**
 * 设置弹窗关闭版本号 — 「设置」弹窗（SettingsDialog）每次关闭时 +1。
 *
 * 背景（2026-08-12 Bug 修复）：图片轮播创作页（CreateView）只在 mounted() 加载一次
 * 模型服务商列表；用户在当前页打开「设置 → 模型设置」新增/启用多模态模型（如 MiniMax）
 * 并关闭弹窗后，创作页的图片生成器/语音生成器下拉仍是旧列表——新模型不出现、
 * 音色克隆能力（依赖已选语音 provider）也不刷新。
 *
 * 依赖弹窗内模型配置的视图 watch 本版本号，在关闭弹窗后重新拉取服务商列表，
 * 保证「新增模型 → 关闭弹窗 → 下拉立即可见」。
 */
export const settingsDialogRevision = ref(0)

/** 通知「设置」弹窗已关闭（App.vue 在 @close 时调用）。 */
export function notifySettingsDialogClosed () {
  settingsDialogRevision.value += 1
}

/**
 * 「就地打开设置」请求 — 页面需要把用户直接送到某个具体 Tab 时使用
 * （例如采集页知乎区块的「前往设置」要求落在「知乎 API」）。
 *
 * 形状是 `{ tab, seq }` 而不是裸字符串：**同一个 Tab 被连续请求两次**时，
 * 给 ref 赋同一个字符串不会触发 watch（值相等），用户第二次点击就会没反应；
 * seq 让每次请求的对象身份都不同。
 */
export const settingsDialogRequest = ref(null)

/**
 * 请求打开「设置」弹窗并定位到指定 Tab。
 * @param {string} [tab] Tab key（model / general / feishu / zhihu / publish）；不存在或禁用时回落默认 Tab
 */
export function requestSettingsDialog (tab = 'model') {
  const prev = settingsDialogRequest.value
  settingsDialogRequest.value = { tab, seq: prev ? prev.seq + 1 : 1 }
}

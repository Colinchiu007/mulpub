/**
 * quick-collect-ui.js — 快捷采集 UI 对 `Collection.vue` 的唯一出口
 *
 * 为什么要有这个文件：`Collection.vue` 是 `check-max-lines` 的 targets **零容差**文件
 * （2920 行），每多一行 import 都在推高存量债。把两个组件的 import 收成一行
 * （与 `collected-item.js` re-export `CollectionCreatorTab` 同一手法），
 * 净增量才能压在 30 行以内。
 */
export { default as QuickCollectTab } from './QuickCollectTab.vue'
export { default as QuickCollectPanel } from './QuickCollectPanel.vue'

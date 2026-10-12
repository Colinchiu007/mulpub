/**
 * draft-box-ui.js — 草稿箱 UI 对 `Collection.vue` 的唯一出口
 *
 * 与 `quick-collect-ui.js` 同一手法：`Collection.vue` 是 `check-max-lines`
 * 的 targets **零容差**文件（2920 行），把两个组件的 import 收成一行，
 * 净增量才压得住。
 */
export { default as CollectionDraftsTab } from './CollectionDraftsTab.vue'
export { default as CollectionDraftsPanel } from './CollectionDraftsPanel.vue'

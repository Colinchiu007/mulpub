/**
 * draft-box-ui.js — 草稿箱 UI 对 `Collection.vue` 的唯一出口
 *
 * 与 `quick-collect-ui.js` 同一手法：`Collection.vue` 是 `check-max-lines`
 * 的 targets **零容差**文件，把组件的 import 收成一行，净增量才压得住。
 *
 * PRD-UI-FLOW-CLARITY S1c：`CollectionDraftsPanel` 已删除 —— 采集页不再自渲染
 * 草稿列表，点击「草稿箱」页签直接跳转 `/publish?tab=drafts`（唯一整页实现）。
 * 仅保留页签按钮组件（它仍是页签行的一部分，带条数角标）。
 */
export { default as CollectionDraftsTab } from './CollectionDraftsTab.vue'

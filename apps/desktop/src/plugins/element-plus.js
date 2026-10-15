/**
 * element-plus 按需装配（fix-newtab-home-slow，2026-10-15）
 *
 * 背景：点击顶部「+」新增标签后 3-4 秒才显示应用主页。根因之一是渲染进程首屏
 * 载荷：element-plus 原为**全量**引入（`import ElementPlus from 'element-plus'`
 * + `element-plus/dist/index.css`），把 124 个组件全部打进主 chunk。
 * 真机实测打包产物：
 *   - index.js  = 1.84 MB（其中 EP 全量 min 后约 877 KB）
 *   - index.css =  503 KB（其中 EP 全量 index.css 349 KB）
 * 而本仓 src 实际只用到 37 个组件。全量引入让用户为 87 个从不渲染的组件
 * 付出下载 + 解析 + 执行成本——这正是「新标签 3-4 秒」的最大单一来源。
 *
 * 本模块把装配改为**显式按需**：只注册真正用到的组件 + 只导入它们的**完整样式闭包**。
 * 实测收益（vite build 后对比）：
 *   - index.js  1.84 MB → 约 1.33 MB
 *   - index.css  503 KB → 约 300 KB（EP 部分 349 KB → 约 175 KB）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 四条硬约束（改动前必读）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ① **新增 EP 组件必须在此登记**：模板里写 `<el-xxx>` 而不在这里注册，
 *    控制台会报 "Failed to resolve component: el-xxx"，页面直接渲染失败。
 *    回归锁见 `src/plugins/element-plus.test.js` 的 P3。
 *
 * ② **命令式用法必须显式导入**：`ElMessage` / `ElMessageBox` 不走 app.component，
 *    由文件末单独导出（本项目使用点：useNotify、App.vue）。
 *
 * ③ **样式必须导「闭包」而不是「模板用到的组件」** ⚠️ 最容易漏的一条。
 *    EP 的组件之间有**纯样式依赖**：内部组件（`scrollbar` / `popper` / `overlay` /
 *    `option-group` / `text` / `badge`）从不出现在模板里，但缺了它们的 CSS 就会
 *    视觉回归。权威来源是 `element-plus/es/components/<name>/style/index.mjs`，
 *    它声明该组件依赖哪些兄弟组件的样式（如 `select` → base/scrollbar/popper/tag/
 *    option/option-group；`dialog` → base/overlay；`tooltip` → base/popper）。
 *
 *    **2026-10-15 实测教训**：第一版只导模板用到的 36 个组件 CSS，QG Visual 当场红 3 处
 *    （podcast-channel 21.63% / create-editor 9.48% / create-pipeline 9.47%），
 *    根因就是漏了 `el-scrollbar` / `el-popper` / `el-overlay` / `el-option-group` /
 *    `el-text` / `el-radio` 本体 / `el-config-provider` 这 7 个。
 *    回归锁见 `element-plus.test.js` 的 P4（按 style/index.mjs 重算闭包，断言不缺不多）。
 *
 * ④ **不得改回全量引入**：那会立刻让 bundle 回到 1.84 MB。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 与 unplugin-vue-components / unplugin-auto-import 的关系
 * ─────────────────────────────────────────────────────────────────────────
 * 本项目未装这两个插件，也不打算为此新增依赖（QM-2「生产依赖闭包」审计成本），
 * 因此用这份显式清单替代自动扫描。代价是新增组件要手动登记——用契约测试
 * 把这个代价变成「漏登记会红」，而不是「线上白屏」。
 */

import {
  ElAlert,
  ElButton,
  ElCard,
  ElCheckbox,
  ElCollapse,
  ElCollapseItem,
  ElConfigProvider,
  ElDialog,
  ElDrawer,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElLink,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElPopover,
  ElProgress,
  // ElRadioButton / ElRadioGroup 在 EP 里是 withNoopInstall（不占全局注册表），
  // 由 ElRadio 作为子组件附带；只注册 ElRadio 即可让 <el-radio-group> /
  // <el-radio-button> 解析。写进 app.use 是无效劳动（其 install 是 no-op）。
  ElRadio,
  ElSelect,
  ElStep,
  ElSteps,
  ElSwitch,
  ElTabPane,
  ElTable,
  ElTableColumn,
  ElTabs,
  ElTag,
  ElTooltip,
  ElTree,
  ElUpload,
} from 'element-plus/es'

// ── 共享样式底座 ──
// 变量（el-var）+ reset（el-reset）+ 过渡/动画基类（base）。
// 这三个不是组件样式，是 EP 全部组件的地基，最先导入。
import 'element-plus/theme-chalk/el-var.css'
import 'element-plus/theme-chalk/el-reset.css'
import 'element-plus/theme-chalk/base.css'

// ── 组件样式（= 权威闭包，含 7 个纯样式依赖内部组件）──
// 顺序无关（EP 组件样式是扁平的 .el-xxx 规则，无层叠依赖），按字母序排列便于查找。
import 'element-plus/theme-chalk/el-alert.css'
import 'element-plus/theme-chalk/el-button.css'
import 'element-plus/theme-chalk/el-card.css'
import 'element-plus/theme-chalk/el-checkbox.css'
import 'element-plus/theme-chalk/el-collapse.css'
import 'element-plus/theme-chalk/el-collapse-item.css'
import 'element-plus/theme-chalk/el-config-provider.css'
import 'element-plus/theme-chalk/el-dialog.css'
import 'element-plus/theme-chalk/el-drawer.css'
import 'element-plus/theme-chalk/el-empty.css'
import 'element-plus/theme-chalk/el-form.css'
import 'element-plus/theme-chalk/el-form-item.css'
import 'element-plus/theme-chalk/el-icon.css'
import 'element-plus/theme-chalk/el-input.css'
import 'element-plus/theme-chalk/el-input-number.css'
import 'element-plus/theme-chalk/el-link.css'
// message / message-box 是命令式 API，不在组件闭包里，但运行时确实要渲染 → 必须导。
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import 'element-plus/theme-chalk/el-option.css'
import 'element-plus/theme-chalk/el-option-group.css'
import 'element-plus/theme-chalk/el-overlay.css'
import 'element-plus/theme-chalk/el-pagination.css'
import 'element-plus/theme-chalk/el-popover.css'
import 'element-plus/theme-chalk/el-popper.css'
import 'element-plus/theme-chalk/el-progress.css'
import 'element-plus/theme-chalk/el-radio.css'
import 'element-plus/theme-chalk/el-radio-button.css'
import 'element-plus/theme-chalk/el-radio-group.css'
import 'element-plus/theme-chalk/el-scrollbar.css'
import 'element-plus/theme-chalk/el-select.css'
import 'element-plus/theme-chalk/el-step.css'
import 'element-plus/theme-chalk/el-steps.css'
import 'element-plus/theme-chalk/el-switch.css'
import 'element-plus/theme-chalk/el-tab-pane.css'
import 'element-plus/theme-chalk/el-table.css'
import 'element-plus/theme-chalk/el-table-column.css'
import 'element-plus/theme-chalk/el-tabs.css'
import 'element-plus/theme-chalk/el-tag.css'
import 'element-plus/theme-chalk/el-text.css'
import 'element-plus/theme-chalk/el-tooltip.css'
import 'element-plus/theme-chalk/el-tree.css'
import 'element-plus/theme-chalk/el-upload.css'

/** 模板组件清单：与上面 import 的组件一一对应，按字母序便于比对。 */
const COMPONENTS = [
  ElAlert,
  ElButton,
  ElCard,
  ElCheckbox,
  ElCollapse,
  ElCollapseItem,
  ElConfigProvider,
  ElDialog,
  ElDrawer,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElLink,
  ElOption,
  ElPagination,
  ElPopover,
  ElProgress,
  // ElRadioButton / ElRadioGroup 在 EP 里是 withNoopInstall（不占全局注册表），
  // 由 ElRadio 作为子组件附带；只注册 ElRadio 即可让 <el-radio-group> /
  // <el-radio-button> 解析。写进 app.use 是无效劳动（其 install 是 no-op）。
  ElRadio,
  ElSelect,
  ElStep,
  ElSteps,
  ElSwitch,
  ElTabPane,
  ElTable,
  ElTableColumn,
  ElTabs,
  ElTag,
  ElTooltip,
  ElTree,
  ElUpload,
]

/**
 * Vue 插件：装配按需 EP。
 *
 * 为什么用插件形式而不是 main.js 里逐个 app.component：
 * main.js 要同时装配 pinia、router、i18n 与三个业务全局组件，把 34 行组件注册
 * 塞进去会让「启动装配」这一件事失去可读性；且契约测试需要一处稳定的入口
 * 来断言「注册面 = 清单」。
 */
export default {
  install (app) {
    for (const component of COMPONENTS) {
      app.use(component)
    }
  },
}

// 命令式 API 单独导出：它们不是组件，不会被 app.component 注册。
// ElMessage / ElMessageBox 在本项目的使用点：
//   - useNotify（全仓通知统一出口）
//   - App.vue 的 ElMessage.error / ElMessageBox.confirm
export { ElMessage, ElMessageBox }

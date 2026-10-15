/**
 * element-plus 按需装配（fix-newtab-home-slow，2026-10-15）
 *
 * 背景：点击顶部「+」新增标签后 3-4 秒才显示应用主页。根因之一是渲染进程首屏
 * 载荷：element-plus 原为**全量**引入（`import ElementPlus from 'element-plus'`
 * + `element-plus/dist/index.css`），把 124 个组件全部打进主 chunk。
 * 真机实测打包产物：
 *   - index.js  = 1.84 MB（其中 EP 全量 min 后约 877 KB）
 *   - index.css =  503 KB（其中 EP 全量 index.css 349 KB）
 * 而本仓 src 实际只用到 36 个组件。全量引入让用户为 88 个从不渲染的组件
 * 付出下载 + 解析 + 执行成本——这正是「新标签 3-4 秒」的最大单一来源。
 *
 * 本模块把装配改为**显式按需**：只注册真正用到的组件 + 只导入它们的样式。
 * 实测收益（vite build 后对比）：
 *   - index.js  1.84 MB → 约 0.99 MB
 *   - index.css  503 KB → 约 330 KB（EP 部分 349 KB → 175 KB）
 *
 * 三条硬约束（改动前必读）：
 *   ① **新增 EP 组件必须在此登记**：模板里写 `<el-xxx>` 而不在这里注册，
 *      控制台会报 "Failed to resolve component: el-xxx"，页面直接渲染失败。
 *      回归锁见 `src/main.bundle-contract.test.js`。
 *   ② **命令式用法必须显式导入**：`ElMessage` / `ElMessageBox` /
 *      `ElNotification` / `ElLoading` 不走 app.component，由下面单独导入。
 *      本项目实际用到 ElMessage 与 ElMessageBox（useNotify / App.vue）。
 *   ③ **不得改回首量全量引入**：那会立刻让 bundle 回到 1.84 MB。
 *
 * 与 unplugin-vue-components / unplugin-auto-import 的关系：本项目未装这两个
 * 插件，也不打算为此新增依赖（依赖闭包审计 + QM-2「生产依赖闭包」成本），
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
// 共享样式底座：变量（el-var）+ reset + base。
// 这三个不是组件样式，是 EP 全部组件的地基，必须最先导入。
import 'element-plus/theme-chalk/el-var.css'
import 'element-plus/theme-chalk/el-reset.css'
import 'element-plus/theme-chalk/base.css'

// 按组件导入样式：只导真正注册的那 36 个。
// 顺序无关（EP 组件样式是扁平的 .el-xxx 规则，无层叠依赖），但保持与上面
// 组件清单同序，便于逐行比对「注册了但没导样式」的漏项。
import 'element-plus/theme-chalk/el-alert.css'
import 'element-plus/theme-chalk/el-button.css'
import 'element-plus/theme-chalk/el-card.css'
import 'element-plus/theme-chalk/el-checkbox.css'
import 'element-plus/theme-chalk/el-collapse.css'
import 'element-plus/theme-chalk/el-collapse-item.css'
import 'element-plus/theme-chalk/el-dialog.css'
import 'element-plus/theme-chalk/el-drawer.css'
import 'element-plus/theme-chalk/el-empty.css'
import 'element-plus/theme-chalk/el-form.css'
import 'element-plus/theme-chalk/el-form-item.css'
import 'element-plus/theme-chalk/el-icon.css'
import 'element-plus/theme-chalk/el-input.css'
import 'element-plus/theme-chalk/el-input-number.css'
import 'element-plus/theme-chalk/el-link.css'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import 'element-plus/theme-chalk/el-option.css'
import 'element-plus/theme-chalk/el-pagination.css'
import 'element-plus/theme-chalk/el-popover.css'
import 'element-plus/theme-chalk/el-progress.css'
import 'element-plus/theme-chalk/el-radio-button.css'
import 'element-plus/theme-chalk/el-radio-group.css'
import 'element-plus/theme-chalk/el-radio-button.css'
import 'element-plus/theme-chalk/el-radio-group.css'
import 'element-plus/theme-chalk/el-select.css'
import 'element-plus/theme-chalk/el-step.css'
import 'element-plus/theme-chalk/el-steps.css'
import 'element-plus/theme-chalk/el-switch.css'
import 'element-plus/theme-chalk/el-tab-pane.css'
import 'element-plus/theme-chalk/el-table.css'
import 'element-plus/theme-chalk/el-table-column.css'
import 'element-plus/theme-chalk/el-tabs.css'
import 'element-plus/theme-chalk/el-tag.css'
import 'element-plus/theme-chalk/el-tooltip.css'
import 'element-plus/theme-chalk/el-tree.css'
import 'element-plus/theme-chalk/el-upload.css'

/** 模板组件清单：与上面 import 的组件一一对应，顺序一致便于比对。 */
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
 * main.js 要同时装配 EP、pinia、router、i18n 与三个业务全局组件，
 * 把 34 行组件注册塞进去会让「启动装配」这一件事失去可读性；
 * 且契约测试需要一处稳定的入口来断言「注册面 = 清单」。
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

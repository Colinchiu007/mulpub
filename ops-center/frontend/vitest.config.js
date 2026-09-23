import { defineConfig } from 'vitest/config'

// ops-center 前端单元测试配置。
// 当前仅覆盖 stores/menu.js 的纯逻辑（reorder/move/reset），
// 不需要 @vitejs/plugin-vue（不渲染 .vue），localStorage 由测试内 mock。
export default defineConfig({
  test: {
    // 默认 node（纯逻辑用例更快、且 src/stores/menu*.test.js 自带内存版 localStorage）；
    // 需要 DOM/localStorage 的文件在顶部用 `// @vitest-environment jsdom` docblock 单独声明。
    environment: 'node',
    // tests/ 必须显式列入：历史上 include 只有 src/**，导致 tests/ 下 6 个用例文件
    // 从未被 `npm test` 执行（门禁空转）。
    include: ['src/**/*.test.js', 'tests/**/*.test.js'],
    globals: false,
  },
})

import { defineConfig } from 'vitest/config'

// ops-center 前端单元测试配置。
// 当前仅覆盖 stores/menu.js 的纯逻辑（reorder/move/reset），
// 不需要 @vitejs/plugin-vue（不渲染 .vue），localStorage 由测试内 mock。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    globals: false,
  },
})

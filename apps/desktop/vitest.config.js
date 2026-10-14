// @ts-nocheck
// 
const { defineConfig } = require('vitest/config');
const vue = require('@vitejs/plugin-vue');
const path = require('path');

module.exports = defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
    ...(process.env.CI ? { reporters: ['verbose'] } : {}),
    deps: { inline: ['electron', 'axios'] },
    globals: true,
    // 顺序敏感：语言确定性必须最先执行（详见 test-setup-locale.js 头注释）
    // 末位是时钟位移 oracle：`MP_TEST_NOW_SHIFT_MS` 未设时它**完全不碰 Date**（只记一条
    // __mpClockShift.enabled=false），所以常态跑法零影响；设了才把整个进程的"现在"推后。
    setupFiles: ['./test-setup-locale.js', './test-setup.js', './test-setup-clock-shift.js'],
    include: [
      'src/**/*.test.{js,ts}', 'src/**/*.spec.{js,ts}',
      'electron/services/**/*.test.{js,ts}',
      'electron/publishers/**/*.test.{js,ts}',
      'electron/ipc-handlers/**/*.test.{js,ts}',
      'electron/preload/**/*.test.{js,ts}',
      'electron/core/**/*.test.{js,ts}',
      'electron/bootstrap/**/*.test.{js,ts}',
      'electron/bootstrap.test.{js,ts}',
      'electron/window.test.{js,ts}',
      'electron/shutdown.test.{js,ts}',
      'electron/main.test.{js,ts}',
      'electron/startup-compat.test.{js,ts}',
      'electron/preload.test.{js,ts}',
      // 内嵌主页壳态 preload（PRD-TAB-INDEPENDENT-HOME S1/S2）：与 electron/preload.test 同级显式纳入
      'electron/home-shell-preload.test.{js,ts}',
      'electron/tests/**/*.test.{js,ts}',
      'tests/**/*.test.{js,ts}',
    ],
    exclude: [
      'tests/visual-testing/views/**',
      'tests/visual-testing/workflows/**',
      'tests/visual-testing/providers/**',
      'tests/visual-testing/scripts/**',
      'tests/path-utils.test.js',
      'tests/e2e/**',
      'tests/smoke/**',
      'electron/tests/e2e-bridge-integration.test.js',
      'electron/tests/e2e-full-pipeline.test.js',
      'electron/tests/e2e-pipeline-orchestrator.test.js',
      'src/__tests__/ipc-handlers.test.js',
      'node_modules/**',
      'dist/**',
    ],
    alias: {
      '@': path.resolve(__dirname, 'src')
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        statements: 55,
        branches: 40,
        functions: 60,
        lines: 55,
      },
      include: [
        'electron/services/**/*.js',
        'electron/ipc-handlers/**/*.js',
        'electron/core/**/*.js',
        'electron/bootstrap/**/*.js',
        'electron/bootstrap.js',
        'electron/main.js',
        'electron/window.js',
        'electron/shutdown.js',
        'src/stores/**/*.js',
        'src/composables/**/*.js',
        // Stage 3.1：将 src/views、src/components、src/domain 纳入覆盖率统计
        'src/views/**/*.js',
        'src/components/**/*.js',
        'src/domain/**/*.js',
        // M-6：Vue 单文件组件此前完全不在统计范围内 —— 本仓 src 下 146 个 .vue
        // 对覆盖率的贡献恒为 0，而它们承载了绝大部分界面逻辑（渲染分支、事件处理、
        // 生命周期、computed 推导）。补上后 coverage 才真正覆盖到 SFC。
        // 注意：这会显著拉低总覆盖率数字（旧阈值是在「只统计 .js」的更小文件集上
        // 标定的），阈值按新基线重标，见 openspec/records/m6-coverage-sfc.md。
        'src/**/*.vue',
      ],
      exclude: [
        '**/*.test.*',
        '**/*.spec.*',
        'vite.config.*',
        'test-setup.js',
        // ast-v8-to-istanbul 对 preload/video-clone.js 的 sourcemap 映射触发 `column must be >= 0` 崩溃
        // （@jridgewell/trace-mapping 负 column，Node 22 + vitest 4.1.x；1.0.4/1.0.5 均未修复）。
        // 该文件不在 include 范围（preload 非 coverage 目标），排除仅绕开 V8 coverage 转换崩溃。
        '**/preload/video-clone.js',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});

import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import prettier from "eslint-config-prettier";

const vueEssential = pluginVue.configs["flat/essential"];

export default [
  // preload/home-shell bundle 是 esbuild 生成物（scripts/build-preload.js），不参与 lint
  { ignores: ["dist/", "dist-ts/", "node_modules/", "*.config.*", ".playwright-browsers/", "electron/**/*.bundle.js"] },

  // JS backend (electron/ — Node.js CommonJS)
  {
    files: ["electron/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: { ...globals.node, ...globals.commonjs },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "warn",
      eqeqeq: ["warn", "smart"],
    },
  },

  // Preload scripts (browser-like env) — 覆盖顶层 *-preload.js 与 preload/ 子目录
  {
    files: ["electron/*-preload.js", "electron/preload/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: { ...globals.browser, ...globals.node, ...globals.commonjs },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },

  // Vue plugin base
  vueEssential[0],

  // Vue + JS frontend (src/ — Electron renderer has browser + limited node)
  {
    files: ["src/**/*.{js,vue}"],
    ...vueEssential[1],
    rules: {
      ...js.configs.recommended.rules,
      ...vueEssential[1].rules,
      ...vueEssential[2].rules,
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "prefer-const": "warn",
      "no-var": "warn",
      eqeqeq: ["warn", "smart"],
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "error",
      "no-console": "off",
    },
  },
  // Override globals for src/ files (renderer has window/document + electron API)
  {
    files: ["src/**/*.{js,vue}", "!src/**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  // 视觉巡检脚本（tests/visual-testing/scripts/ — CommonJS + Node）
  //
  // 为什么单列一段：这段目录**以前完全不在 lint 范围内**
  // （lint 脚本只扫 `electron/ src/`），于是「探针文件引用了另一个文件里的常量」
  // 这类错误没有任何门禁能看见 —— 拆分巡检脚本时漏带 READY_TIMEOUT，
  // 采集脚本对每条路由都抛「READY_TIMEOUT is not defined」，一张图都采不出来，
  // 而 CI 的冒烟测试只测「模块能不能被 require」，照样全绿。
  // 这里把 no-undef（js.configs.recommended 自带）落到这一段：未定义的标识符 = 错。
  {
    files: ["tests/visual-testing/scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.commonjs },
    },
    rules: {
      // 只开 no-undef（未定义的标识符 = 错）：这是能抓住上面那类缺陷的规则。
      // 不整包启用 js.configs.recommended —— 那会把这一段目录里既有的
      // no-useless-assignment / no-empty 等无关告警一并变成错，
      // 属于借修缺陷之名扩大改动面。这里只补**缺的那一条**。
      "no-undef": "error",
    },
  },

  // Test files
  {
    files: ["**/*.test.js", "**/*.spec.js", "**/__mocks__/**"],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "prefer-const": "off",
      "no-var": "off",
    },
  },

  prettier,
];

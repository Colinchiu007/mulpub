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

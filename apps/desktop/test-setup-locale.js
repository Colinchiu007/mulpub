// @ts-check
/**
 * test-setup-locale.js — 语言确定性前置（必须是 vitest `setupFiles` 的**第一项**）
 *
 * 为什么单独成文件：`resolveAppLocale()`（src/i18n/index.js）在 **模块首次被 import 时**
 * 就按 navigator.language 决定 locale。ESM 的 import 会被提升到文件顶部执行，因此把
 * `navigator.language = 'zh-CN'` 写在 test-setup.js 的函数体里**无法**先于它自身的
 * import 生效——只要有组件链在 test-setup.js 里 import 了 @/i18n，整个测试进程的
 * 默认语言就会漂移成 en，中文文案断言随机失败。
 *
 * 这里把语言固定在第一个 setup 文件里，使 locale 解析与「谁先 import」彻底解耦。
 */
try {
  if (typeof navigator !== 'undefined') {
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
  }
} catch (_) {
  // 非 jsdom 环境（如 node）没有 navigator，忽略
}

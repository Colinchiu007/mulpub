// @ts-check
/**
 * quick-render-constants.js — 快速渲染面板的常量与映射
 *
 * 单独成文件的原因：这些是**判据**（输出平台→画幅映射、体积护栏、时长范围、错误码→locale key），
 * 放在 .vue 的 <script setup> 里会让面板文件迅速膨胀到 500 行门禁之上，
 * 且判据与渲染逻辑混在一起时，改判据容易漏改渲染。
 *
 * ⚠️ 本文件**不得出现中文字符串字面量**（渲染端 CJK 门禁按 file+content 增量比对基线，
 * 新文件里的中文即视为新增硬编码）。用户可见文案一律走 locale。
 */

/**
 * 输出平台 → Agnes 画幅。
 * 6 个平台映射到 6 个合法 aspect_ratio（21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16）。
 * 「输出平台」在 AI 视频路径上必须真正生效——修掉「选了平台、成片画幅却不变」的缺陷。
 * @type {Readonly<Record<string, string>>}
 */
export const PROFILE_ASPECT_RATIO = Object.freeze({
  'youtube-landscape': '16:9',
  'youtube-shorts': '9:16',
  'tiktok': '9:16',
  'bilibili': '16:9',
  'wechat': '9:16',
  'xiaohongshu': '3:4',
})

/** 画幅兜底（映射表未命中时） */
export const DEFAULT_ASPECT_RATIO = '16:9'

/**
 * 单文件体积护栏。
 * Base64 编码后约膨胀 33%，Agnes 单请求 <50MB ⇒ 参考图 ≤5MB（5 张 ≈ 33MB）、
 * 参考音频 ≤10MB（3 段 ≈ 30MB），留足余量。
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024

/** 时长可选范围（Agnes Video 2.5 要求 4–12 秒） */
export const SECONDS_MIN = 4
export const SECONDS_MAX = 12

/** 模式默认值 */
export const DEFAULT_SECONDS = 5
export const DEFAULT_PROFILE = 'youtube-landscape'
export const DEFAULT_THEME = 'clean-professional'

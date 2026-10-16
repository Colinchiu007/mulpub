// @ts-check
/**
 * stealth/index.js — 主世界反检测统一入口
 *
 * 消费方（sandbox preload / RPA 窗口 preload）只 require 本入口，不直接触达子模块，
 * 便于后续替换实现而不改动多处。
 */
module.exports = {
  ...require('./evasions'),
  ...require('./inject'),
}
